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
import { Badge, buttonClasses, Card } from '@/components/ui';
import { getSalesTotals, NOT_VOIDED, shopStartOfDay } from '@/lib/bills/totals';
import { isRateStale } from '@/lib/admin/rate-freshness';
import { formatShopDate } from '@/lib/datetime';
import { db } from '@/lib/db';
import { formatINR } from '@/lib/money';
import { getCurrentRates, RATE_FACES } from '@/lib/rates';
import { cn } from '@/lib/utils/cn';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Dashboard' };

/** Local midnight, for bucketing the 30-day chart. `shopStartOfDay` handles the boundaries. */
function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export default async function AdminDashboardPage() {
  const now = new Date();
  const today = shopStartOfDay(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const thirtyDaysAgo = new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000);

  /**
   * All aggregation happens in the database.
   *
   * §7 TEST: "Dashboard totals match a direct SQL aggregation" — which is easiest to
   * guarantee by the dashboard *being* the SQL aggregation rather than summing rows in JS.
   *
   * Phase 8 §8.7 moved the sold totals into `lib/bills/totals.ts`: they are cached in Redis
   * for 60s, invalidated on every new bill and every void, and — the part that matters —
   * they exclude voided orders. Every query on this page now carries `NOT_VOIDED`, because
   * one that does not makes the shop's month look bigger than its year.
   */
  const [
    rates,
    totals,
    billsThisMonth,
    enquiriesThisMonth,
    recentOrders,
    productsWithoutImages,
    dailyRaw,
  ] = await Promise.all([
    getCurrentRates(),
    getSalesTotals(),
    db.order.count({
      where: { ...NOT_VOIDED, sentViaWa: true, sentAt: { gte: monthStart } },
    }),
    db.enquiry.count({ where: { createdAt: { gte: monthStart } } }),
    db.order.findMany({
      where: NOT_VOIDED,
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
    /**
     * `::bigint` is load-bearing, not tidiness.
     *
     * Postgres widens `SUM()` over a bigint column to `numeric`, which Prisma hands back as
     * a Decimal — and every money helper in this codebase takes a `bigint` (MASTER-SPEC §4).
     * Without the cast, `formatINR` threw `Cannot mix BigInt and other types` and the whole
     * dashboard 500'd.
     *
     * It was latent from Phase 7 and could not fire until this shop had a sale: the chart is
     * only rendered when `peak` is non-zero, and the development database had no orders in
     * it until Phase 8 started raising bills. Found by the Phase 8 E2E run, three routes away
     * from anything it was testing.
     */
    db.$queryRaw<{ day: Date; total: bigint | null }[]>`
      SELECT date_trunc('day', "createdAt") AS day, SUM("grandTotal")::bigint AS total
      FROM "Order"
      WHERE "createdAt" >= ${thirtyDaysAgo} AND "voidedAt" IS NULL
      GROUP BY 1
      ORDER BY 1 ASC
    `,
  ]);

  // §7.2's 48-hour rule, shared with /admin/rates so the two cannot disagree (Stage 5C).
  const staleRates = RATE_FACES.filter((face) =>
    isRateStale(rates[face.key].effectiveAt, now),
  );

  // Fill the gaps so the chart has one bar per day rather than only the days with sales.
  const byDay = new Map(
    dailyRaw.map((row) => [startOfDay(row.day).getTime(), row.total ?? 0n]),
  );
  const series = Array.from({ length: 30 }, (_, index) => {
    const day = new Date(thirtyDaysAgo.getTime() + index * 24 * 60 * 60 * 1000);
    return { day, total: byDay.get(startOfDay(day).getTime()) ?? 0n };
  });
  const peak = series.reduce((max, point) => (point.total > max ? point.total : max), 1n);

  const staleKeys = new Set(staleRates.map((f) => f.key));

  return (
    <Section className="pt-6 pb-0">
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-h1 font-semibold tracking-tight text-ink">Dashboard</h1>
          {/* Context, not a greeting. §4 rejects "Welcome to your dashboard". */}
          <p className="text-body text-muted">
            Today&rsquo;s rates, sales and recent orders.
          </p>
        </div>

        {/*
          ── The rates panel, and the page's primary action ──

          §7.2 calls updating rates "the most frequent daily action", and Stage 5B §5 asks
          that action to be visually stronger than the rest. It used to be a small "Update →"
          text link in a card corner — the same weight as everything else on the page.

          Units are shown per face (§13): "₹1,49,840" alone does not say per what, and the
          three rows here are quoted in two different units.
        */}
        <Card className="flex flex-col gap-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-col gap-1">
              <h2 className="text-h3 font-semibold text-ink">Today&rsquo;s rates</h2>
              <p className="text-small text-muted">
                Every price on the site and in the calculator follows these.
              </p>
            </div>
            <Link
              href="/admin/rates"
              className={buttonClasses({ variant: 'accent', className: 'shrink-0' })}
            >
              Set today&rsquo;s rates
            </Link>
          </div>

          <dl className="flex flex-col">
            {RATE_FACES.map((face) => {
              const stale = staleKeys.has(face.key);
              return (
                <div
                  key={face.key}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line py-4 first:border-t-0 first:pt-0"
                >
                  <dt className="flex min-w-0 flex-col">
                    <span className="text-body font-medium text-ink">{face.label}</span>
                    <span className="text-small text-muted">{face.unit}</span>
                  </dt>
                  <dd className="flex shrink-0 items-center gap-4">
                    <span className="text-h3 font-semibold text-ink num">
                      {formatINR(rates[face.key].display)}
                    </span>
                    {/*
                      A badge only for the exception; a date for everything else.

                      Freshness is a word either way — §14 and §18: a state carried only by a
                      red dot is invisible to a screen reader and to anyone who cannot
                      separate the hue from the surface. But a green "Updated" on all three
                      rows every ordinary day is a traffic light nobody reads, and it buries
                      the one row that does need attention. The date says more anyway: "set
                      this morning" and "set on Tuesday" are different facts, and only one of
                      them is a problem.
                    */}
                    {stale ? (
                      <Badge tone="down">Needs update</Badge>
                    ) : (
                      <span className="text-small text-muted">
                        Set{' '}
                        <time dateTime={rates[face.key].effectiveAt}>
                          {formatShopDate(new Date(rates[face.key].effectiveAt))}
                        </time>
                      </span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </Card>

        {/*
          §7.2: "Low-signal alerts". Shown only when there is something to act on — an
          always-present "0 problems" panel is noise that trains people to skip it.

          `unsent` and `unclaimed` come from `getSalesTotals()`, which has computed them
          since Phase 8 with a comment saying "the dashboard shows them as alerts". It never
          did. They are the two most actionable things on this page: a bill nobody sent, and
          a purchase sitting against a phone number with no account behind it.
        */}
        {(staleRates.length > 0 ||
          productsWithoutImages > 0 ||
          totals.unsent > 0 ||
          totals.unclaimed > 0) && (
          <Card className="flex flex-col gap-4">
            <h2 className="text-h3 font-semibold text-ink">Worth a look</h2>
            <ul className="flex flex-col gap-2">
              {staleRates.length > 0 && (
                <Alert label="Rates" href="/admin/rates" action="Update">
                  {staleRates.map((f) => f.label).join(', ')} not updated in 48 hours.
                </Alert>
              )}
              {totals.unsent > 0 && (
                <Alert label="Bills" href="/admin/bills" action="Open bills">
                  <span className="num">{totals.unsent}</span>{' '}
                  {totals.unsent === 1 ? 'bill has' : 'bills have'} not been sent on
                  WhatsApp.
                </Alert>
              )}
              {totals.unclaimed > 0 && (
                <Alert label="Orders" href="/admin/bills" action="Open bills">
                  <span className="num">{totals.unclaimed}</span>{' '}
                  {totals.unclaimed === 1 ? 'order is' : 'orders are'} waiting for a
                  customer to claim them.
                </Alert>
              )}
              {productsWithoutImages > 0 && (
                <Alert label="Photos" href="/admin/products" action="Add photos">
                  <span className="num">{productsWithoutImages}</span>{' '}
                  {productsWithoutImages === 1 ? 'piece has' : 'pieces have'} no image.
                </Alert>
              )}
            </ul>
          </Card>
        )}

        {/*
          §8.7: "Total sold — today / week / month / all time, from `SUM(grandTotal)`.
          Exclude voided orders."

          ── Hierarchy, not a wall (§6) ──

          Seven identical tiles gave every figure the same weight, so the one an owner opens
          the page for — what sold today — was indistinguishable from all-time takings. Today
          is now the anchor and the rest are the comparison beneath it.

          ── What did NOT change, and must not ──

          The money tiles still run full width below `sm`. DEBT-038 and D-036: a half-width
          tile at 375px leaves 112px of text, which holds about ₹9,99,999 — so that grid was
          already too narrow for an ordinary lakh figure, and a shop past a crore overflowed
          the page. `e2e/admin.spec.ts` substitutes ₹1000 crore into every tile and measures
          it, which is why the anchor's larger type is `md:` only: at 375px it stays exactly
          the size that test proved fits.
        */}
        <div className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-h3 font-semibold text-ink">Sales</h2>
            <Link
              href="/admin/bills"
              className="flex h-tap items-center text-small font-semibold text-rose-deep hover:underline"
            >
              Bills &amp; orders →
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Stat
              label="Sold today"
              value={formatINR(totals.today.total)}
              sub={`${totals.today.count} ${totals.today.count === 1 ? 'order' : 'orders'}`}
              money
              anchor
            />
            <Stat
              label="This week"
              value={formatINR(totals.week.total)}
              sub={`${totals.week.count} orders`}
              money
            />
            <Stat
              label="This month"
              value={formatINR(totals.month.total)}
              sub={`${totals.month.count} orders`}
              money
            />
            <Stat
              label="All time"
              value={formatINR(totals.allTime.total)}
              sub={`${totals.allTime.count} orders`}
              money
            />
            <Stat
              label="Average order"
              value={formatINR(totals.averageOrder)}
              sub="all time"
              money
            />
            <Stat
              label="Bills sent"
              value={String(billsThisMonth)}
              sub="this month, on WhatsApp"
            />
            <Stat label="Enquiries" value={String(enquiriesThisMonth)} sub="this month" />
          </div>
        </div>

        {/* §7.2: "Simple sales bar chart, last 30 days." Hand-rolled, like the Phase 4
            sparkline — a charting dependency for thirty bars is not a trade worth making. */}
        <Card className="flex flex-col gap-4">
          <h2 className="text-h3 font-semibold text-ink">Last 30 days</h2>
          {peak === 1n ? (
            <p className="text-body text-muted">No sales recorded yet.</p>
          ) : (
            <div
              className="flex h-[128px] items-end gap-1"
              role="img"
              aria-label="Daily sales for the last 30 days"
            >
              {series.map((point) => (
                <div
                  key={point.day.toISOString()}
                  className="flex-1 rounded-t-[2px] bg-rose-tint"
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
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-h3 font-semibold text-ink">Recent orders</h2>
            {recentOrders.length > 0 && (
              <Link
                href="/admin/bills"
                className="flex h-tap items-center text-small font-semibold text-rose-deep hover:underline"
              >
                View all →
              </Link>
            )}
          </div>
          {recentOrders.length === 0 ? (
            /* §15 — an empty state that says what to do, not a zero. */
            <div className="flex flex-col items-start gap-4">
              <p className="text-body text-muted">
                No orders yet. They appear here once you send a bill.
              </p>
              <Link href="/admin/bills/new" className={buttonClasses({ variant: 'outline' })}>
                Create the first bill
              </Link>
            </div>
          ) : (
            <ul className="flex flex-col gap-4">
              {recentOrders.map((order) => (
                <li
                  key={order.id}
                  className="flex items-center justify-between gap-4 border-b border-line pb-2 last:border-0 last:pb-0"
                >
                  <div className="flex min-w-0 flex-col">
                    <p className="truncate text-body font-medium text-ink num">
                      {order.orderNo}
                    </p>
                    <p className="truncate text-small text-muted">
                      {order.customerName || order.customerPhone} ·{' '}
                      {formatShopDate(order.createdAt)}
                    </p>
                  </div>
                  <p className="shrink-0 text-body font-semibold text-ink num">
                    {formatINR(order.grandTotal)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/*
          The "More" card is gone.

          It listed Collections, Images, Settings and Audit as chips — which is exactly what
          the rail and the mobile drawer now carry, on every admin screen (5A). §10: quick
          actions should reduce repeated navigation, not duplicate the navigation. It existed
          because those four routes had nowhere else to live; they do now.
        */}
      </div>
    </Section>
  );
}

/**
 * One line in "Worth a look".
 *
 * A label, what happened, and the one place to go and fix it. The action is a real link
 * rather than a button, because every one of them is a navigation — §10's "quick actions
 * should reduce repeated navigation", not duplicate it.
 */
function Alert({
  label,
  href,
  action,
  children,
}: {
  label: string;
  href: string;
  action: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-body text-ink">
      <Badge>{label}</Badge>
      <span>{children}</span>
      <Link href={href} className="font-medium text-rose-deep hover:underline">
        {action}
      </Link>
    </li>
  );
}

/**
 * One stat tile.
 *
 * `money` widens the tile to the full row below `sm`, rather than shrinking the figure or
 * abbreviating it to `₹1.39 Cr` (D-036). The figure is the thing the owner came for; the
 * type scale and the exact rupees both stay intact and the tile gives up the space instead.
 * A column of five money tiles also shares one left edge, so the figures compare by eye —
 * which a 2-up grid never did.
 *
 * `data-stat` is the regression test's hook: DEBT-038 hid inside real data, so
 * `e2e/admin.spec.ts` substitutes a worst-case figure rather than trusting the seed.
 */
function Stat({
  label,
  value,
  sub,
  money = false,
  anchor = false,
}: {
  label: string;
  value: string;
  sub: string;
  /** A rupee figure, which grows with the shop. Counts do not. */
  money?: boolean;
  /**
   * The figure the page exists to show — "sold today".
   *
   * Wider and larger, but **only from `sm` upward**. At 375px it renders exactly as every
   * other money tile does, because that is the size DEBT-038's regression test measured a
   * ₹1000-crore figure against; growing the type there would reintroduce the overflow that
   * test was written to catch.
   */
  anchor?: boolean;
}) {
  return (
    <Card
      className={cn(
        'flex flex-col gap-1',
        money && 'col-span-2 sm:col-span-1',
        anchor && 'sm:col-span-2',
      )}
      data-stat={label}
      data-stat-kind={money ? 'money' : 'count'}
    >
      <p className="text-small text-muted">{label}</p>
      <p
        className={cn('text-h2 font-semibold text-ink num', anchor && 'md:text-display')}
        data-stat-value
      >
        {value}
      </p>
      <p className="text-small text-muted">{sub}</p>
    </Card>
  );
}
