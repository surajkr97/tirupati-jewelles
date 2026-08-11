/**
 * The nightly sweep, triggered by Vercel Cron instead of a worker process. D-055.
 *
 * ── What replaced what ──
 * §9.3 built this as a BullMQ job on a beat schedule, run by `pnpm worker` — a long-lived
 * process. The deploy target is Vercel, which is serverless and has no such thing. Rather
 * than keep a second host running solely to delete a few hundred rows a year, the same
 * handler is called on a schedule by Vercel Cron.
 *
 * **The work itself is unchanged.** `runExpireShares` is the function the worker called,
 * imported directly — not reimplemented, and not routed through the queue, which would add a
 * broker round trip to a job with exactly one caller. `lib/queue/` stays as it is (§9.3 is
 * signed off, and the day something needs a real queue the machinery is there and tested).
 *
 * ── Why the deletion is safe to run unattended ──
 * `readShare` already refuses anything past `expiresAt`, so an expired link is dead whether
 * or not this ever runs; only the row lingers. The handler is idempotent by shape — deleting
 * rows that are already gone deletes nothing — so a double-fire, a retry, or a manual run
 * mid-sweep are all harmless. Nothing personal is in these rows: item labels, weights and a
 * frozen rate (see `CalculatorShare` in `schema.prisma`).
 */
import { NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { log } from '@/lib/log';
import { runExpireShares } from '@/lib/queue/jobs';

export const dynamic = 'force-dynamic';

/**
 * Vercel sends `Authorization: Bearer $CRON_SECRET` when that variable is set on the project.
 *
 * The check is deliberately not optional-when-unset: an unauthenticated endpoint that deletes
 * rows is a public delete button, and "we forgot to set the secret" is exactly how one ships.
 * With no secret configured this refuses everything, which fails closed — the same choice
 * `lib/auth/rate-limit.ts` makes and for the same reason.
 *
 * Compared with `timingSafeEqual`-grade care? No — this guards a sweep of already-dead rows,
 * not a credential. The refusal matters more than the comparison.
 */
function authorised(request: Request): boolean {
  if (!env.CRON_SECRET) return false;
  return request.headers.get('authorization') === `Bearer ${env.CRON_SECRET}`;
}

export async function GET(request: Request) {
  if (!authorised(request)) {
    // 404, not 401: an endpoint that announces itself invites attention, and a scheduler
    // that is configured correctly never sees this. Same reasoning as the admin routes.
    return new NextResponse(null, { status: 404 });
  }

  try {
    const { deleted } = await runExpireShares({});
    log.info('cron.cleanup.expire_shares', { deleted });
    return NextResponse.json({ deleted }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    log.error('cron.cleanup.failed', { error: String(error) });
    // 500 so a failed sweep shows up in Vercel's cron history rather than reading as success.
    return NextResponse.json({ error: 'cleanup failed' }, { status: 500 });
  }
}
