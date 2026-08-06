/**
 * Dashboard sales totals.
 * Created by Phase 8 (specs/08-billing-whatsapp.md §8.7).
 *
 * §8.7: "Total sold — today / week / month / all time, from `SUM(grandTotal)`. Exclude
 * voided orders. Cache in Redis 60s; invalidate on new bill."
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  EVERY FIGURE IS A DATABASE AGGREGATION.
 *
 *  Phase 7 established the rule and §8 TEST repeats it — "Dashboard totals match direct
 *  SQL" — which is guaranteed rather than checked when the dashboard *is* the SQL. Summing
 *  rows in JavaScript would also mean loading every order the shop has ever raised into
 *  memory to show one number.
 *
 *  ── The voided filter is the part that can silently rot ──
 *  `voidedAt: null` has to appear on every one of these aggregates. Miss it on one and the
 *  shop's month looks larger than its year. So there is exactly one `where` fragment,
 *  `NOT_VOIDED`, and every query spreads it.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import 'server-only';

import type { Prisma } from '@prisma/client';

import { db } from '@/lib/db';
import { cached } from '@/lib/redis';

/** §8.7: "Cache in Redis 60s; invalidate on new bill." */
export const DASHBOARD_TOTALS_KEY = 'dash:totals';
export const DASHBOARD_TOTALS_TTL = 60;

/** §8.7: "Exclude voided orders." One definition, spread into every aggregate below. */
export const NOT_VOIDED = { voidedAt: null } satisfies Prisma.OrderWhereInput;

export interface PeriodTotal {
  total: bigint;
  count: number;
}

export interface SalesTotals {
  today: PeriodTotal;
  week: PeriodTotal;
  month: PeriodTotal;
  allTime: PeriodTotal;
  averageOrder: bigint;
  /** §8.5's list needs the counts; the dashboard shows them as alerts. */
  unsent: number;
  unclaimed: number;
}

/**
 * Midnight in the shop's timezone, not the server's.
 *
 * A UTC host's `setHours(0,0,0,0)` is 5:30am IST, so "sold today" would silently exclude
 * every sale made before breakfast and include the previous evening's. D-014 pinned every
 * displayed timestamp to `Asia/Kolkata` for the same reason; a boundary that decides which
 * day a sale belongs to matters more than a label.
 */
export function shopStartOfDay(at: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(at);

  // IST is UTC+5:30 with no daylight saving, so midnight IST is 18:30 UTC the day before.
  return new Date(`${parts}T00:00:00+05:30`);
}

async function loadTotals(): Promise<SalesTotals> {
  const today = shopStartOfDay();
  const weekAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
  const monthStart = shopStartOfDay(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12),
  );

  const period = (where: Prisma.OrderWhereInput) =>
    db.order.aggregate({
      _sum: { grandTotal: true },
      _count: true,
      where: { ...NOT_VOIDED, ...where },
    });

  const [todayAgg, weekAgg, monthAgg, allTimeAgg, unsent, unclaimed] = await Promise.all([
    period({ createdAt: { gte: today } }),
    period({ createdAt: { gte: weekAgo } }),
    period({ createdAt: { gte: monthStart } }),
    period({}),
    db.order.count({ where: { ...NOT_VOIDED, sentViaWa: false } }),
    db.order.count({ where: { ...NOT_VOIDED, userId: null } }),
  ]);

  const shape = (agg: {
    _sum: { grandTotal: bigint | null };
    _count: number;
  }): PeriodTotal => ({ total: agg._sum.grandTotal ?? 0n, count: agg._count });

  const allTime = shape(allTimeAgg);

  return {
    today: shape(todayAgg),
    week: shape(weekAgg),
    month: shape(monthAgg),
    allTime,
    averageOrder: allTime.count > 0 ? allTime.total / BigInt(allTime.count) : 0n,
    unsent,
    unclaimed,
  };
}

/**
 * The cached read.
 *
 * `cached()` never throws, so a Redis outage makes the dashboard slower rather than
 * broken — and the 60s window is short enough that a shop owner refreshing after a sale
 * sees it, which is the only staleness anyone here would notice.
 */
export async function getSalesTotals(): Promise<SalesTotals> {
  return cached(DASHBOARD_TOTALS_KEY, DASHBOARD_TOTALS_TTL, loadTotals);
}
