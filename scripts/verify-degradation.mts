/**
 * §9.5's graceful-degradation checklist, proven by killing each dependency.
 * Phase 9 (specs/09-hardening.md §9.5, acceptance criterion 6).
 *
 *   pnpm dev            (or `pnpm build && pnpm start`)
 *   pnpm verify:degradation
 *
 * ── Why this is a script and not a test ──
 * It stops and starts Docker containers. That is not something a `vitest` run or a
 * Playwright worker may do — every other suite on the machine is talking to the same
 * Postgres and the same Redis — so it is a deliberate, serial, single-operator command, in
 * the shape Phase 7 and 8 established with `verify-upload` and `verify-bill`.
 *
 * ── What §9.5 asks for, and what is actually being claimed ──
 *   Redis down        → slower, functional
 *   worker down       → synchronous fallback
 *   SMS provider down → email OTP still works
 *   image CDN down    → branded empty frames, no broken layout
 *
 * Three of those are proved here. The fourth cannot be: "no broken layout" is a statement
 * about rendered geometry, and curl cannot see geometry. It lives in
 * `e2e/degradation.spec.ts`, which aborts every request to the CDN host in a real browser.
 *
 * Postgres is killed too, though §9.5 does not list it. It is the one dependency with NO
 * fallback, and the checklist is only meaningful if it also records where degradation stops:
 * an outage that takes the site down should be *known* to take the site down.
 *
 * ⚠ DEVELOPMENT ONLY. It stops your database. Never point it at production.
 */
import { config } from 'dotenv';

config({ path: '.env', quiet: true });

const { QUEUE, enqueueOrRun, queueFor, closeQueues } =
  await import('../lib/queue/index.ts');
const { db } = await import('../lib/db.ts');
const { redis } = await import('../lib/redis.ts');

const ORIGIN = process.env.VERIFY_ORIGIN ?? 'http://localhost:3000';

/**
 * The address the auth probes claim to come from.
 *
 * TEST-NET-3 (RFC 5737), so it is a documentation address that can never be a real visitor,
 * and PUBLIC — `clientIpFromHeaders` (SEC-032) refuses to treat a loopback or private address
 * as an identity, so `127.0.0.1` would land every probe in whatever bucket the fallback
 * chooses rather than in a key this script can clear.
 */
const PROBE_IP = '203.0.113.55';

let failures = 0;
const results: { scenario: string; claim: string; ok: boolean; detail: string }[] = [];

function check(scenario: string, claim: string, ok: boolean, detail = ''): void {
  results.push({ scenario, claim, ok, detail });
  if (!ok) failures += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${claim}${detail ? ` — ${detail}` : ''}`);
}

// ───────────────────────────────────────────────────────────── docker helpers

async function compose(args: string[]): Promise<void> {
  const { run } = await import('./lib/pg.mts');
  const { code, stderr } = await run('docker', ['compose', ...args]);
  if (code !== 0) throw new Error(`docker compose ${args.join(' ')} failed: ${stderr}`);
}

async function waitHealthy(container: string, seconds = 40): Promise<boolean> {
  const { run } = await import('./lib/pg.mts');
  for (let i = 0; i < seconds; i += 1) {
    const { stdout } = await run('docker', [
      'inspect',
      '-f',
      '{{.State.Health.Status}}',
      container,
    ]);
    if (stdout.trim() === 'healthy') return true;
    await sleep(1000);
  }
  return false;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ─────────────────────────────────────────────────────────────── http helpers

interface Probe {
  status: number;
  ms: number;
  body: string;
}

async function probe(path: string, init?: RequestInit): Promise<Probe> {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${ORIGIN}${path}`, {
      ...init,
      // Never reuse a cached answer — the question is what the SERVER does right now.
      cache: 'no-store',
      headers: { 'cache-control': 'no-cache', ...(init?.headers ?? {}) },
    });
    return {
      status: response.status,
      ms: Date.now() - startedAt,
      body: await response.text(),
    };
  } catch (error) {
    return { status: 0, ms: Date.now() - startedAt, body: String(error) };
  }
}

function json(body: string): Record<string, unknown> {
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** `checks.redis.status` out of a /api/health body, without pretending to type it. */
function checkStatus(body: string, name: string): string {
  const checks = json(body).checks as Record<string, { status?: string }> | undefined;
  return checks?.[name]?.status ?? 'missing';
}

// ─────────────────────────────────────────────────────────────────── scenarios

/** Pages a customer can reach that must survive every dependency but Postgres. */
const STOREFRONT = ['/', '/rates', '/collections', '/calculator'];

async function baseline(): Promise<Record<string, number>> {
  console.log('\n── Baseline: everything up ───────────────────────────────────');
  const latency: Record<string, number> = {};

  for (const path of STOREFRONT) {
    const result = await probe(path);
    latency[path] = result.ms;
    check(
      'baseline',
      `${path} serves`,
      result.status === 200,
      `${result.status} in ${result.ms}ms`,
    );
  }

  const health = await probe('/api/health');
  check(
    'baseline',
    '/api/health reports the database up',
    health.status === 200 && checkStatus(health.body, 'database') === 'ok',
    `${health.status}, redis ${checkStatus(health.body, 'redis')}`,
  );

  return latency;
}

/**
 * §9.5: "Redis down → slower, functional." And §9.5 item 3: "the app must survive total
 * Redis loss. Verify by killing Redis in staging and browsing the site."
 */
async function redisDown(baselineLatency: Record<string, number>): Promise<void> {
  console.log('\n── Redis stopped ─────────────────────────────────────────────');
  await compose(['stop', 'redis']);

  try {
    for (const path of STOREFRONT) {
      const result = await probe(path);
      const before = baselineLatency[path] ?? 0;
      check(
        'redis down',
        `${path} still serves`,
        result.status === 200,
        `${result.status} in ${result.ms}ms (baseline ${before}ms)`,
      );
    }

    /**
     * The load-bearing one. `/api/rates` is cache-aside on `rates:current`, so with Redis
     * gone it must fall through to Postgres and return the SAME figure — not an empty list,
     * not a 500. Compared against the row in the database rather than against itself.
     */
    const stored = await db.metalRate.findFirst({ orderBy: { effectiveAt: 'desc' } });
    const rates = await probe('/api/rates');
    const served = JSON.stringify(json(rates.body));
    check(
      'redis down',
      '/api/rates still returns the true rate from Postgres',
      rates.status === 200 &&
        stored !== null &&
        served.includes(String(stored.ratePerGram)),
      `${rates.status}, looking for ${stored?.metal} ${stored?.purity} = ${stored?.ratePerGram}`,
    );

    const health = await probe('/api/health');
    check(
      'redis down',
      '/api/health stays 200 and reports redis down, not the site down',
      health.status === 200 &&
        checkStatus(health.body, 'redis') === 'down' &&
        checkStatus(health.body, 'database') === 'ok',
      `${health.status}, status "${String(json(health.body).status)}", redis ${checkStatus(health.body, 'redis')}`,
    );

    /**
     * The documented EXCEPTION, asserted rather than glossed over.
     *
     * `lib/auth/rate-limit.ts` fails CLOSED on purpose (Phase 3 SECURITY, SEC-005): a
     * limiter that fails open hands unlimited OTP and password attempts to anyone who can
     * pressure Redis. So authentication is refused while Redis is down, and the honest
     * statement of §9.5's "slower, functional" is "browsing, rates and the calculator stay
     * up; signing in does not".
     *
     * 429 is the correct answer and a 500 is not — one is a designed refusal a client can
     * retry, the other is an unhandled fault.
     */
    const login = await probe('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        identifier: 'degradation@example.com',
        password: 'not-a-real-one',
      }),
    });
    check(
      'redis down',
      'login fails CLOSED with 429, by design — not 500',
      login.status === 429,
      `${login.status} ${json(login.body).error ?? ''}`,
    );

    /**
     * §9.3's promise, exercised against a genuinely dead broker: "a dead worker must not
     * mean a dead billing feature". `enqueueOrRun` must give up inside its 1s deadline and
     * run the work here instead of hanging.
     */
    const startedAt = Date.now();
    const outcome = await enqueueOrRun(
      QUEUE.cleanup,
      'degradation-probe',
      {},
      async () => 'ran-inline',
    );
    const elapsed = Date.now() - startedAt;
    check(
      'redis down',
      'enqueueOrRun falls back to running the job inline',
      outcome.mode === 'inline' && outcome.result === 'ran-inline',
      `mode "${outcome.mode}" after ${elapsed}ms`,
    );
    check(
      'redis down',
      'the fallback is bounded — it does not hold the request open',
      elapsed < 3000,
      `${elapsed}ms, deadline 1000ms`,
    );
  } finally {
    await compose(['start', 'redis']);
    const healthy = await waitHealthy('tirupati-redis');
    check('recovery', 'redis comes back healthy', healthy);
    // The ready-gate in lib/redis.ts is settled per process; the SERVER's gate reopens on
    // its own reconnect. Give ioredis its retry window before asserting recovery.
    await sleep(3000);
    const health = await probe('/api/health');
    check(
      'recovery',
      'the app reconnects to Redis without a restart',
      checkStatus(health.body, 'redis') === 'ok',
      `redis ${checkStatus(health.body, 'redis')}`,
    );
  }
}

/**
 * The other half of "worker down", and the half that is easy to conflate with the first.
 *
 * A dead BROKER is what `enqueueOrRun` catches. A dead WORKER with a live broker looks
 * completely different: the push succeeds, the job is accepted, and then nothing runs it.
 * There is no fallback for that by design — the job is durable and will run when a worker
 * returns — so what must exist instead is visibility, which is §9.4's queue-depth alert.
 */
async function workerDown(): Promise<void> {
  console.log('\n── Broker up, no worker running ──────────────────────────────');

  const queue = queueFor(QUEUE.cleanup);
  const before = await queue.getJobCounts('wait', 'delayed');
  const outcome = await enqueueOrRun(
    QUEUE.cleanup,
    'degradation-probe',
    {},
    async () => 'inline',
  );
  check(
    'worker down',
    'the job is ACCEPTED rather than run inline — the broker is healthy',
    outcome.mode === 'queued',
    `mode "${outcome.mode}", job ${outcome.jobId ?? '—'}`,
  );

  const after = await queue.getJobCounts('wait', 'delayed');
  const waiting = (after.wait ?? 0) + (after.delayed ?? 0);
  check(
    'worker down',
    'it waits in the queue instead of being lost',
    waiting > (before.wait ?? 0) + (before.delayed ?? 0),
    `${waiting} waiting on ${QUEUE.cleanup}`,
  );

  const health = await probe('/api/health');
  check(
    'worker down',
    '/api/health can see the queue depth §9.4 alerts on',
    ['ok', 'warn'].includes(checkStatus(health.body, 'queues')),
    `queues ${checkStatus(health.body, 'queues')}`,
  );

  /**
   * ── The count above is 2, not 1, and that is the interesting part ──
   *
   * Only one job was pushed here. The other is the one `redisDown()` pushed at a dead
   * broker: `enqueueOrRun` gave up on its 1-second deadline and ran the work inline, and
   * then the buffered `add()` LANDED anyway once Redis came back.
   *
   * That is not a bug and it is not a surprise — `lib/queue/index.ts` states it as the price
   * of the deadline: "if the push lands after the deadline, the job runs twice — once here
   * and once on the worker. That is exactly why §9.3 requires every task to be idempotent."
   * This run is that sentence happening. `cleanup.expire_shares` deleting already-deleted
   * rows deletes nothing, so the duplicate is harmless, which is the property §9.3 required
   * rather than hoped for.
   *
   * Worth recording because it was found by accident, by a cleanup check that compared
   * against a baseline and failed — and the first reading of that failure was "the removal
   * is broken", which it was not.
   */
  const strays = await queue.getJobs(['wait', 'delayed', 'failed']);
  const probes = strays.filter((job) => job.name === 'degradation-probe');
  const late = probes.length - 1;
  for (const job of probes) await job.remove();

  const remaining = await queue.getJobs(['wait', 'delayed', 'failed']);
  check(
    'worker down',
    'every probe job is cleaned up — the queue is left as it was found',
    remaining.every((job) => job.name !== 'degradation-probe'),
    `${probes.length} removed${late > 0 ? `, ${late} of them a late-landing push from the dead-broker case (by design)` : ''}`,
  );
}

/**
 * Not on §9.5's list, and measured anyway: this is where degradation STOPS.
 *
 * Everything else here has a fallback. Postgres does not — it is the source of truth for
 * rates, catalogue, orders and invoices. What is worth knowing is how it fails: whether the
 * whole site goes dark, or whether ISR keeps serving already-rendered HTML to browsers while
 * the dynamic paths return errors.
 */
async function postgresDown(): Promise<void> {
  console.log('\n── Postgres stopped ──────────────────────────────────────────');
  await compose(['stop', 'db']);

  try {
    const health = await probe('/api/health');
    check(
      'postgres down',
      '/api/health returns 503 so a load balancer pulls the instance',
      health.status === 503 && checkStatus(health.body, 'database') === 'down',
      `${health.status}, database ${checkStatus(health.body, 'database')}`,
    );

    for (const path of STOREFRONT) {
      const result = await probe(path);
      // Recorded, not asserted: whether a given page answers depends on whether its ISR
      // entry is still warm, which is a property of the run rather than of the code.
      console.log(
        `    · ${path} → ${result.status} in ${result.ms}ms${result.status === 200 ? ' (served from the ISR cache)' : ''}`,
      );
    }
  } finally {
    await compose(['start', 'db']);
    const healthy = await waitHealthy('tirupati-db');
    check('recovery', 'postgres comes back healthy', healthy);
    await sleep(2000);
    const health = await probe('/api/health');
    check(
      'recovery',
      'the app reconnects to Postgres without a restart',
      checkStatus(health.body, 'database') === 'ok',
      `database ${checkStatus(health.body, 'database')}`,
    );
  }
}

/**
 * §9.5: "SMS provider down → email OTP still works."
 *
 * The premise does not hold in this application and that is the finding, not a pass. There
 * is no SMS provider (D-011) — `SmsNotifier` throws — so SMS is permanently "down", and the
 * question §9.5 is really asking is whether a customer who identifies themselves by PHONE
 * can still get a code. They must, by email, because the account has one.
 */
async function smsDown(): Promise<void> {
  console.log('\n── SMS channel unavailable (permanently — D-011) ─────────────');

  const user = await db.user.findFirst({
    where: { phone: { not: null }, email: { not: null } },
    select: { phone: true, email: true },
  });

  if (!user?.phone) {
    check(
      'sms down',
      'a phone-bearing account exists to probe with',
      false,
      'none found',
    );
    return;
  }

  /**
   * Clear the OTP send counters for exactly the two identifiers this probe touches.
   *
   * §3.2 allows 3 sends per identifier per 15 minutes and the limiter fails closed, so a
   * second run of this script inside that window answers 429 to both requests — and 429 vs
   * 429 is "the same answer", which would let the enumeration check below PASS while proving
   * nothing at all. Found by running the script twice in a row.
   *
   * Scoped to these keys, in the shape Phase 7's `e2e/admin.setup.ts` established for the
   * same reason: the limiter itself is tested in Phase 3, and a harness that disables it
   * wholesale is a harness that stops noticing when it breaks.
   */
  const UNKNOWN_PHONE = '+919999900002';
  await redis.del(
    `rl:otp:send:id:${user.phone}`,
    `rl:otp:send:id:${UNKNOWN_PHONE}`,
    `rl:otp:send:ip:${PROBE_IP}`,
  );

  const forgot = await probe('/api/auth/password/forgot', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': PROBE_IP },
    body: JSON.stringify({ identifier: user.phone }),
  });

  check(
    'sms down',
    'password reset by PHONE does not 500 when the SMS channel is unavailable',
    forgot.status === 200,
    `${forgot.status} for a real account`,
  );

  /**
   * The same request for a number that has no account. Both must be identical — §3's
   * enumeration rule — and a 500 on one side of that branch is what makes them differ.
   */
  const unknown = await probe('/api/auth/password/forgot', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': PROBE_IP },
    body: JSON.stringify({ identifier: UNKNOWN_PHONE }),
  });
  check(
    'sms down',
    'a registered and an unregistered number get the same answer',
    forgot.status === unknown.status && forgot.body === unknown.body,
    `${forgot.status} vs ${unknown.status}`,
  );
}

// ─────────────────────────────────────────────────────────────────────── main

async function main(): Promise<void> {
  console.log(`Degradation checklist — ${ORIGIN}\n`);

  const up = await probe('/api/health');
  if (up.status === 0) {
    console.error(
      `Nothing is answering at ${ORIGIN}. Start the app first (\`pnpm dev\`, or\n` +
        `\`pnpm build && pnpm start\` for the production behaviour §9.5 is about),\n` +
        `or set VERIFY_ORIGIN.`,
    );
    process.exitCode = 1;
    return;
  }

  try {
    const latency = await baseline();
    await redisDown(latency);
    await workerDown();
    await smsDown();
    await postgresDown();
  } finally {
    // Whatever went wrong, the machine is left as it was found.
    await compose(['start', 'redis']);
    await compose(['start', 'db']);
    await closeQueues();
    await db.$disconnect();
    redis.disconnect();
  }

  console.log('\n── Summary ───────────────────────────────────────────────────');
  for (const scenario of [...new Set(results.map((r) => r.scenario))]) {
    const rows = results.filter((r) => r.scenario === scenario);
    const failed = rows.filter((r) => !r.ok).length;
    console.log(
      `  ${failed === 0 ? '✓' : '✗'} ${scenario.padEnd(14)} ${rows.length - failed}/${rows.length}`,
    );
  }

  console.log(
    '\nThe image-CDN case is not here: "no broken layout" is a statement about\n' +
      'geometry, which needs a browser. Run `pnpm test:e2e degradation`.',
  );

  if (failures) {
    console.error(`\n${failures} check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log('\nEvery dependency killed, every fallback held.');
  }
}

await main();
