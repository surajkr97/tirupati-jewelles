/**
 * Health check — what an uptime monitor and an alert rule need to see.
 * Created by Phase 1 (specs/01-cleanup-scaffold.md §1.7). Extended by Phase 9 §9.4.
 *
 * Redis being down is reported but does NOT make the service unhealthy: per MASTER-SPEC §7
 * the site is expected to run without it, just slower. Postgres being down does.
 *
 * ── Why the alert conditions live here rather than in a monitoring config ──
 * §9.4 asks for alerts on "DB connection failures, Redis down, queue depth, **rates not
 * updated in 24h**". Three of those are infrastructure and the fourth is not: a stale gold
 * rate is, in the spec's own words, "a business incident, not a technical one". No uptime
 * service can see it, because it is a fact about this shop's data.
 *
 * So the endpoint answers all four. An external checker then needs one rule — "is this 200
 * and is `status` ok" — rather than four integrations, and the definition of "stale" lives
 * next to the code that sets rates instead of in a dashboard nobody diffs.
 *
 * ── What makes it 503, and what deliberately does not ──
 * Only Postgres. A stale rate, a full queue and a dead Redis are all reported as `warn` with
 * a 200, because a 503 tells a load balancer to take the instance out of rotation and none
 * of those is fixed by doing that — it would turn "the owner forgot to update the gold rate"
 * into "the site is offline", which is a strictly worse outcome than the thing being alerted
 * on. `checks[].status` is what an alert rule reads; the HTTP code is for the load balancer.
 */
import { Role } from '@prisma/client';
import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { QUEUE, queueFor } from '@/lib/queue';
import { redisHealthy } from '@/lib/redis';

export const dynamic = 'force-dynamic';

/**
 * §9.4: "rates not updated in 24h". §7.2's dashboard alert uses 48h; this is tighter on
 * purpose — the dashboard tells the owner when they next look, and this pages someone.
 */
const RATE_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * A queue deeper than this has stopped draining. Generous: the shop raises a handful of
 * bills a day, so anything approaching this means the worker is not running rather than
 * that it is busy.
 */
const QUEUE_DEPTH_LIMIT = 100;

type CheckStatus = 'ok' | 'warn' | 'down';

interface Check {
  status: CheckStatus;
  detail?: string;
}

async function checkDatabase(): Promise<Check> {
  try {
    await db.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  } catch {
    return { status: 'down' };
  }
}

async function checkRedis(): Promise<Check> {
  return (await redisHealthy()) ? { status: 'ok' } : { status: 'down' };
}

/** The business signal. Never 503 — see the header. */
async function checkRates(): Promise<Check> {
  try {
    const newest = await db.metalRate.findFirst({
      select: { effectiveAt: true },
      orderBy: { effectiveAt: 'desc' },
    });

    if (!newest) return { status: 'warn', detail: 'no rate has ever been set' };

    const ageMs = Date.now() - newest.effectiveAt.getTime();
    const hours = Math.floor(ageMs / (60 * 60 * 1000));

    return ageMs > RATE_STALE_AFTER_MS
      ? { status: 'warn', detail: `last set ${hours}h ago` }
      : { status: 'ok', detail: `last set ${hours}h ago` };
  } catch {
    // The database check above already reports this; not repeated as a second failure.
    return { status: 'warn', detail: 'unavailable' };
  }
}

/**
 * Queue depth across every queue. §9.4 calls it "Celery queue depth"; it is BullMQ (D-042).
 *
 * Counts waiting + delayed + failed. Failed matters most: those are the dead-letter jobs
 * §9.3 deliberately keeps rather than discarding, and a growing pile of them is the signal
 * that retries are not working — which nothing else surfaces.
 */
async function checkQueues(): Promise<Check> {
  try {
    const counts = await Promise.all(
      Object.values(QUEUE).map(async (name) => {
        const { wait, delayed, failed } = await queueFor(name).getJobCounts(
          'wait',
          'delayed',
          'failed',
        );
        return { name, depth: (wait ?? 0) + (delayed ?? 0), failed: failed ?? 0 };
      }),
    );

    const deepest = counts.reduce((worst, entry) =>
      entry.depth > worst.depth ? entry : worst,
    );
    const failed = counts.reduce((total, entry) => total + entry.failed, 0);

    if (deepest.depth > QUEUE_DEPTH_LIMIT) {
      return { status: 'warn', detail: `${deepest.name} has ${deepest.depth} waiting` };
    }
    if (failed > 0) return { status: 'warn', detail: `${failed} in the dead-letter set` };

    return { status: 'ok' };
  } catch {
    // The broker is unreachable. §9.3's `enqueueOrRun` means the application still works —
    // it does the job inline — so this is a warning, not an outage.
    return { status: 'warn', detail: 'broker unreachable' };
  }
}

/**
 * SEC-041. The free-text `detail` is for whoever is on call, not for the internet.
 *
 * An anonymous caller needs exactly one thing from this endpoint: is the service up, and is
 * any check unhealthy. That is `status` and `checks.<name>.status`, and both stay public
 * because §9.4 built this so an external uptime service needs ONE rule, and DEBT-047's
 * registered check reads exactly those fields.
 *
 * `detail` is different. It carries specifics — `last set 81h ago`, `cleanup.expire_shares
 * has 143 waiting`, `4 in the dead-letter set` — which tell a stranger how this shop is
 * doing and what its internals are called, and buy an uptime checker nothing. Admin sessions
 * still see it, which is when anyone actually wants it.
 *
 * ── What is deliberately still public, and the trade it makes ──
 * `checks.redis.status` stays visible, and it is the sharpest item here: the GLOBAL rate
 * limiter fails OPEN (`lib/security/global-limit.ts`), so `redis: down` announces the window
 * in which per-IP limits are not being enforced. Removing it would be defence in depth —
 * but it is the field §9.4's alert exists for, an attacker can infer the same fact by
 * observing that limits stopped applying, and the alert being registered against it now is a
 * concrete good against a weak, inferable signal. Recorded as SEC-041 rather than traded
 * away quietly; if the shop is ever a target worth polling, the answer is an authenticated
 * checker, not a coarser body.
 */
async function canSeeDetail(): Promise<boolean> {
  try {
    const user = await getCurrentUser();
    return user?.role === Role.ADMIN;
  } catch {
    // An unreadable session is not an admin, and a health check must not fail because the
    // session store is the thing that is down.
    return false;
  }
}

function publicise(check: Check, withDetail: boolean): Check {
  return withDetail ? check : { status: check.status };
}

export async function GET() {
  const [database, redis, rates, queues, detailed] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkRates(),
    checkQueues(),
    canSeeDetail(),
  ]);

  const checks = {
    database: publicise(database, detailed),
    redis: publicise(redis, detailed),
    rates: publicise(rates, detailed),
    queues: publicise(queues, detailed),
  };
  // Computed from the RAW checks, not the publicised copy — the HTTP code and the summary
  // must not depend on who is asking.
  const healthy = database.status === 'ok';
  const degraded = [database, redis, rates, queues].some(
    (check) => check.status !== 'ok',
  );

  return NextResponse.json(
    {
      // `ok` | `degraded` — one field an uptime rule can watch.
      status: healthy ? (degraded ? 'degraded' : 'ok') : 'down',
      checks,
      // Kept for the Phase 1 shape, which `e2e/smoke.spec.ts` and the compose healthcheck
      // both read. Removing them would be a silent break in two places at once.
      database: database.status === 'ok' ? 'ok' : 'down',
      redis: redis.status === 'ok' ? 'ok' : 'down',
      timestamp: new Date().toISOString(),
    },
    {
      status: healthy ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
