/**
 * /admin — the dashboard.
 * Created by Phase 7 (specs/07-admin-panel.md §7.2).
 *
 * §7.2: "Big soft stat cards, not a data grid."
 *
 * The ordering is by how often the owner needs it, not by how the data model is arranged:
 * the rates shortcut is near the top because §7.2 calls updating them "the most frequent
 * daily action, so it belongs on the home screen", and the alerts are above the chart
 * because an alert is something to do and a chart is something to look at.
 */
import type { Metadata } from 'next';
import Link from 'next/link';

import { Section } from '@/components/shell';
import { Badge, Card } from '@/components/ui';
import { formatShopDate } from '@/lib/datetime';
import { db } from '@/lib/db';
import { formatINR } from '@/lib/money';
import { getCurrentRates, RATE_FACES } from '@/lib/rates';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Dashboard' };

/** §7.2: "rates not updated in 48h". */
const STALE_RATE_MS = 48 * 60 * 60 * 1000;

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export default async function AdminDashboardPage() {
  const now = new Date();
  const today = startOfDay(now);
  const weekAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const thirtyDaysAgo = new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000);

  /**
   * All aggregation happens in the database.
   *
   * §7 TEST: "Dashboard totals match a direct SQL aggregation" — which is easiest to
   * guarantee by the dashboard *being* the SQL aggregation rather than summing rows in JS.
   */
  const [
    rates,
    todayAgg,
    weekAgg,
    monthAgg,
    allTimeAgg,
    billsThisMonth,
    enquiriesThisMonth,
    recentOrders,
    productsWithoutImages,
    dailyRaw,
  ] = await Promise.all([
    getCurrentRates(),
    db.order.aggregate({
      _sum: { grandTotal: true },
      _count: true,
      where: { createdAt: { gte: today } },
    }),
    db.order.aggregate({
      _sum: { grandTotal: true },
      _count: true,
      where: { createdAt: { gte: weekAgo } },
    }),
    db.order.aggregate({
      _sum: { grandTotal: true },
      _count: true,
      where: { createdAt: { gte: monthStart } },
    }),
    db.order.aggregate({ _sum: { grandTotal: true }, _count: true }),
    db.order.count({ where: { sentViaWa: true, sentAt: { gte: monthStart } } }),
    db.enquiry.count({ where: { createdAt: { gte: monthStart } } }),
    db.order.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        orderNo: true,
        customerName: true,
        customerPhone: true,
        grandTotal: true,
        createdAt: true,
      },
    }),
    db.product.count({ where: { isActive: true, images: { none: {} } } }),
    db.$queryRaw<{ day: Date; total: bigint | null }[]>`
      SELECT date_trunc('day', "createdAt") AS day, SUM("grandTotal") AS total
      FROM "Order"
      WHERE "createdAt" >= ${thirtyDaysAgo}
      GROUP BY 1
      ORDER BY 1 ASC
    `,
  ]);

  const allTimeCount = allTimeAgg._count;
  const averageOrder =
    allTimeCount > 0 ? (allTimeAgg._sum.grandTotal ?? 0n) / BigInt(allTimeCount) : 0n;

  /** §7.2: "rates not updated in 48h". */
  const staleRates = RATE_FACES.filter((face) => {
    const at = new Date(rates[face.key].effectiveAt).getTime();
    return !Number.isFinite(at) || at === 0 || now.getTime() - at > STALE_RATE_MS;
  });

  // Fill the gaps so the chart has one bar per day rather than only the days with sales.
  const byDay = new Map(
    dailyRaw.map((row) => [startOfDay(row.day).getTime(), row.total ?? 0n]),
  );
  const series = Array.from({ length: 30 }, (_, index) => {
    const day = new Date(thirtyDaysAgo.getTime() + index * 24 * 60 * 60 * 1000);
    return { day, total: byDay.get(startOfDay(day).getTime()) ?? 0n };
  });
  const peak = series.reduce((max, point) => (point.total > max ? point.total : max), 1n);

  return (
    <Section className="pt-6 pb-0">
      <div className="flex flex-col gap-6">
        <h1 className="text-h1 font-semibold tracking-tight text-ink">Dashboard</h1>

        {/* §7.2: "Current rates with an inline 'update' shortcut — the most frequent daily
            action, so it belongs on the home screen." */}
        <Card className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-h3 font-semibold text-ink">Today&rsquo;s rates</h2>
            <Link
              href="/admin/rates"
              className="text-small font-semibold text-taupe-deep"
            >
              Update →
            </Link>
          </div>
          <dl className="flex flex-col gap-2">
            {RATE_FACES.map((face) => (
              <div key={face.key} className="flex items-baseline justify-between gap-4">
                <dt className="text-body text-muted">{face.label}</dt>
                <dd className="text-body font-semibold text-ink tabular">
                  {formatINR(rates[face.key].display)}
                </dd>
              </div>
            ))}
          </dl>
        </Card>

        {/* §7.2: "Low-signal alerts". Shown only when there is something to act on — an
            always-present "0 problems" panel is noise that trains people to skip it. */}
        {(staleRates.length > 0 || productsWithoutImages > 0) && (
          <Card className="flex flex-col gap-3">
            <h2 className="text-h3 font-semibold text-ink">Worth a look</h2>
            <ul className="flex flex-col gap-2">
              {staleRates.length > 0 && (
                <li className="text-body text-ink">
                  <Badge>Rates</Badge> {staleRates.map((f) => f.label).join(', ')} not
                  updated in 48 hours.{' '}
                  <Link
                    href="/admin/rates"
                    className="font-medium text-taupe-deep underline"
                  >
                    Update
                  </Link>
                </li>
              )}
              {productsWithoutImages > 0 && (
                <li className="text-body text-ink">
                  <Badge>Photos</Badge> {productsWithoutImages}{' '}
                  {productsWithoutImages === 1 ? 'piece has' : 'pieces have'} no image.{' '}
                  <Link
                    href="/admin/products"
                    className="font-medium text-taupe-deep underline"
                  >
                    Add photos
                  </Link>
                </li>
              )}
            </ul>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Stat
            label="Sold today"
            value={formatINR(todayAgg._sum.grandTotal ?? 0n)}
            sub={`${todayAgg._count} orders`}
          />
          <Stat
            label="This week"
            value={formatINR(weekAgg._sum.grandTotal ?? 0n)}
            sub={`${weekAgg._count} orders`}
          />
          <Stat
            label="This month"
            value={formatINR(monthAgg._sum.grandTotal ?? 0n)}
            sub={`${monthAgg._count} orders`}
          />
          <Stat
            label="All time"
            value={formatINR(allTimeAgg._sum.grandTotal ?? 0n)}
            sub={`${allTimeCount} orders`}
          />
          <Stat label="Average order" value={formatINR(averageOrder)} sub="all time" />
          <Stat
            label="Bills sent"
            value={String(billsThisMonth)}
            sub="this month, on WhatsApp"
          />
          <Stat label="Enquiries" value={String(enquiriesThisMonth)} sub="this month" />
        </div>

        {/* §7.2: "Simple sales bar chart, last 30 days." Hand-rolled, like the Phase 4
            sparkline — a charting dependency for thirty bars is not a trade worth making. */}
        <Card className="flex flex-col gap-4">
          <h2 className="text-h3 font-semibold text-ink">Last 30 days</h2>
          {peak === 1n ? (
            <p className="text-body text-muted">No sales recorded yet.</p>
          ) : (
            <div
              className="flex h-32 items-end gap-1"
              role="img"
              aria-label="Daily sales for the last 30 days"
            >
              {series.map((point) => (
                <div
                  key={point.day.toISOString()}
                  className="flex-1 rounded-t-[2px] bg-taupe-lt"
                  style={{
                    // Scaled against the peak; `Number` on a bigint is safe because this is
                    // only ever a bar height.
                    height: `${Math.max(2, (Number(point.total) / Number(peak)) * 100)}%`,
                  }}
                  title={`${formatShopDate(point.day)}: ${formatINR(point.total)}`}
                />
              ))}
            </div>
          )}
        </Card>

        <Card className="flex flex-col gap-4">
          <h2 className="text-h3 font-semibold text-ink">Recent orders</h2>
          {recentOrders.length === 0 ? (
            <p className="text-body text-muted">
              No orders yet. They appear here once you send a bill.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {recentOrders.map((order) => (
                <li
                  key={order.id}
                  className="flex items-center justify-between gap-4 border-b border-line pb-3 last:border-0 last:pb-0"
                >
                  <div className="flex min-w-0 flex-col">
                    <p className="truncate text-body font-medium text-ink tabular">
                      {order.orderNo}
                    </p>
                    <p className="truncate text-small text-muted">
                      {order.customerName || order.customerPhone} ·{' '}
                      {formatShopDate(order.createdAt)}
                    </p>
                  </div>
                  <p className="shrink-0 text-body font-semibold text-ink tabular">
                    {formatINR(order.grandTotal)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="flex flex-col gap-3">
          <h2 className="text-h3 font-semibold text-ink">More</h2>
          <div className="flex flex-wrap gap-2">
            {[
              ['/admin/categories', 'Collections'],
              ['/admin/media', 'Images'],
              ['/admin/settings', 'Settings'],
              ['/admin/audit', 'Audit log'],
            ].map(([href, label]) => (
              <Link
                key={href}
                href={href!}
                className="inline-flex h-tap items-center rounded-pill bg-taupe-lt/50 px-4 text-small font-semibold text-ink"
              >
                {label}
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </Section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card className="flex flex-col gap-1">
      <p className="text-small text-muted">{label}</p>
      <p className="text-h2 font-semibold text-ink tabular">{value}</p>
      <p className="text-small text-muted">{sub}</p>
    </Card>
  );
}
