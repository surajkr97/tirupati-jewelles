/**
 * /admin/bills — the invoice book.
 * Created by Phase 8 (specs/08-billing-whatsapp.md §8.5), redesigned by Stage 5E.
 *
 * §8.5: "Search by phone, order number, customer name. Filters: date range, sent/unsent,
 * claimed/unclaimed. Row: order no, customer, total, sent status, claimed status."
 *
 * Every filter lives in the URL, the same pattern Phase 6 used for the catalogue: the form
 * is a plain GET, so a filtered view survives a reload, a back button and being pasted into
 * a message. There is no filter state that only exists in a component.
 *
 * ── This is the order book, and it is labelled as one ──
 *
 * There is no `/admin/orders` and Stage 5E does not invent one: `lib/bills/create.ts` writes
 * the `Order` row when the admin raises a bill, so the bill IS the order from the shop's
 * side. The heading says "Bills & orders" — which is true about this page — and the route is
 * unchanged. See specs/ROUTE-MAP.md and UI_REDESIGN_DEBT-004.
 *
 * ── Status is not a wall of green ──
 *
 * Phase 7 gave every row two filled badges: `Sent`/`Not sent` and `Claimed`/`Unclaimed`, the
 * positives in `up` green. Every ordinary bill therefore carried two coloured chips saying
 * nothing had gone wrong, which is the state §5 warns about — when everything is highlighted
 * the eye stops reading any of it. Only the exceptions get a badge now (void, not sent); the
 * ordinary outcomes are a quiet line of text.
 */
import { Ban, ChevronRight, Plus, Send, SlidersHorizontal, X } from 'lucide-react';
import Link from 'next/link';

import type { Metadata } from 'next';

import { Section } from '@/components/shell';
import { Badge, Button, buttonClasses, Card, EmptyState, Input, Select } from '@/components/ui';
import { listBills, parseBillFilters, type BillFilters } from '@/lib/bills/query';
import { formatShopDateTime } from '@/lib/datetime';
import { formatINR } from '@/lib/money';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Bills' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Rebuild the query string with one value changed — used by the pager and the export. */
function withPage(filters: BillFilters, page: number): string {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.sent !== 'all') params.set('sent', filters.sent);
  if (filters.claim !== 'all') params.set('claim', filters.claim);
  if (filters.voided !== 'active') params.set('voided', filters.voided);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (page > 1) params.set('page', String(page));

  const query = params.toString();
  return query ? `/admin/bills?${query}` : '/admin/bills';
}

/** The same query with one filter dropped, for the pill that removes it. */
function withoutFilter(filters: BillFilters, drop: keyof BillFilters): string {
  const reset: BillFilters = {
    ...filters,
    page: 1,
    ...(drop === 'q' ? { q: '' } : {}),
    ...(drop === 'sent' ? { sent: 'all' as const } : {}),
    ...(drop === 'claim' ? { claim: 'all' as const } : {}),
    ...(drop === 'voided' ? { voided: 'active' as const } : {}),
    // The two dates are one control to a person, so one pill clears the pair.
    ...(drop === 'from' || drop === 'to' ? { from: '', to: '' } : {}),
  };
  return withPage(reset, 1);
}

const SENT_LABEL = { sent: 'Sent only', unsent: 'Not sent only' } as const;
const CLAIM_LABEL = { claimed: 'Claimed only', unclaimed: 'Unclaimed only' } as const;
const VOID_LABEL = { voided: 'Voided only', all: 'Including voided' } as const;

export default async function BillsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  // Next 16: `searchParams` is async (D-002).
  const raw = await searchParams;
  const flat = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );

  const filters = parseBillFilters(flat);
  const { rows, total, pages } = await listBills(filters);

  /**
   * `voided: 'active'` is the DEFAULT, not a filter somebody chose, so it does not count
   * towards "are we looking at a filtered view" — otherwise every visit to this page would
   * arrive already claiming to be filtered, and "Clear all" would never be off.
   */
  const refined =
    filters.sent !== 'all' ||
    filters.claim !== 'all' ||
    filters.voided !== 'active' ||
    Boolean(filters.from) ||
    Boolean(filters.to);
  const filtered = refined || Boolean(filters.q);

  return (
    <Section className="pt-6 pb-0">
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-h1 font-semibold tracking-tight text-ink">
              Bills &amp; orders
            </h1>
            <p className="text-body text-muted">
              Every invoice raised here. Totals are what the customer was charged, GST
              included.
            </p>
          </div>
          <Link
            href="/admin/bills/new"
            className={buttonClasses({ variant: 'accent', size: 'md' })}
          >
            <Plus className="size-4" aria-hidden="true" />
            New bill
          </Link>
        </div>

        {/* A plain GET form. No JavaScript required, and the result is a shareable URL. */}
        <Card padded={false}>
          <form method="get" className="flex flex-col gap-4 p-4 md:p-6">
            {/*
              Search stays out in the open; the refinements fold away.

              §6 asks that filters not consume most of a phone screen, and five controls
              plus a date pair did — stacked, the panel ran past 380px at 320px wide before
              a single bill appeared. Looking a customer up by the number they just read out
              is the thing this page is opened for, so that one control stays visible and the
              rest live behind a native `<details>`, which needs no JavaScript and still
              submits its fields while closed.
            */}
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
              <Input
                type="search"
                name="q"
                label="Search"
                defaultValue={filters.q}
                maxLength={80}
                placeholder="Invoice number, name or phone"
              />
              <Button variant="primary" size="md" type="submit" full className="lg:w-auto">
                Search
              </Button>
            </div>

            <details open={refined || undefined} className="flex flex-col gap-4">
              <summary className="flex h-tap w-fit cursor-pointer list-none items-center gap-2 text-small font-semibold text-rose-deep [&::-webkit-details-marker]:hidden">
                <SlidersHorizontal className="size-4" aria-hidden="true" />
                More filters
              </summary>

              <div className="grid grid-cols-2 gap-4 pt-2 lg:grid-cols-5">
                <Select name="sent" label="Sent" defaultValue={filters.sent}>
                  <option value="all">All</option>
                  <option value="sent">Sent</option>
                  <option value="unsent">Not sent</option>
                </Select>
                <Select name="claim" label="Claimed" defaultValue={filters.claim}>
                  <option value="all">All</option>
                  <option value="claimed">Claimed</option>
                  <option value="unclaimed">Unclaimed</option>
                </Select>
                <Select name="voided" label="Void" defaultValue={filters.voided}>
                  <option value="active">Active only</option>
                  <option value="voided">Voided only</option>
                  <option value="all">Both</option>
                </Select>
                <Input type="date" name="from" label="From" defaultValue={filters.from} />
                <Input type="date" name="to" label="To" defaultValue={filters.to} />
              </div>

              <div className="pt-4">
                <Button variant="outline" size="md" type="submit" full className="lg:w-auto">
                  Apply filters
                </Button>
              </div>
            </details>
          </form>
        </Card>

        {/*
          §6 — what is applied, in words, each piece removable on its own. A `<select>`
          reading "Not sent" is easy to miss on a page that otherwise looks like the whole
          book, and "why is this bill missing" is an expensive question in an invoice list.
        */}
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-small text-muted">
            <span className="num">{total}</span> {total === 1 ? 'bill' : 'bills'}
            {pages > 1 && (
              <>
                {' '}
                · page <span className="num">{filters.page}</span> of{' '}
                <span className="num">{pages}</span>
              </>
            )}
          </p>

          {filters.q && (
            <FilterPill label={`“${filters.q}”`} href={withoutFilter(filters, 'q')} />
          )}
          {filters.sent !== 'all' && (
            <FilterPill
              label={SENT_LABEL[filters.sent]}
              href={withoutFilter(filters, 'sent')}
            />
          )}
          {filters.claim !== 'all' && (
            <FilterPill
              label={CLAIM_LABEL[filters.claim]}
              href={withoutFilter(filters, 'claim')}
            />
          )}
          {filters.voided !== 'active' && (
            <FilterPill
              label={VOID_LABEL[filters.voided]}
              href={withoutFilter(filters, 'voided')}
            />
          )}
          {(filters.from || filters.to) && (
            <FilterPill
              label={`${filters.from || 'start'} → ${filters.to || 'today'}`}
              href={withoutFilter(filters, 'from')}
            />
          )}
          {filtered && (
            <Link
              href="/admin/bills"
              className="flex h-tap items-center px-2 text-small font-semibold text-rose-deep hover:underline"
            >
              Clear all
            </Link>
          )}

          {/* §8.5: "Export CSV for the accountant." Same filters as the screen. */}
          <a
            href={`/admin/bills/export${withPage(filters, 1).replace('/admin/bills', '')}`}
            className="ml-auto flex h-tap items-center text-small font-semibold text-rose-deep hover:underline"
          >
            Export CSV
          </a>
        </div>

        {/* §20 — an empty book and an empty search are different problems. */}
        {rows.length === 0 ? (
          <Card padded={false}>
            {filtered ? (
              <EmptyState
                title="No bills match"
                description="Nothing in the book fits those filters. Widen them, or search for the customer's number instead."
                action={
                  <Link
                    href="/admin/bills"
                    className={buttonClasses({ variant: 'outline', size: 'md' })}
                  >
                    Clear filters
                  </Link>
                }
              />
            ) : (
              <EmptyState
                title="No bills yet"
                description="Raise one at the counter and it appears here, with its invoice and its WhatsApp link."
                action={
                  <Link
                    href="/admin/bills/new"
                    className={buttonClasses({ variant: 'accent', size: 'md' })}
                  >
                    Create the first bill
                  </Link>
                }
              />
            )}
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              // A named row: `getByRole('listitem')` also matches the admin navigation's
              // items, which are the first list on the page.
              <li key={row.id} data-testid="bill-row">
                <Link
                  href={`/admin/bills/${row.id}`}
                  className="block rounded-card focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none"
                >
                  <Card
                    interactive
                    padded={false}
                    className="flex items-center gap-4 p-4 md:p-6"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <p className="text-body font-semibold text-ink num">
                          {row.orderNo}
                        </p>
                        {/* §4 — the amount is the second thing read, so it is the second
                            thing on the row and it is the largest. */}
                        <p className="text-h3 font-semibold text-ink num">
                          {formatINR(row.grandTotal)}
                        </p>
                      </div>

                      {/*
                        The number never truncates.

                        `truncate` on this line clipped it to "+9195367…" at 320px — and for
                        a walk-in with no name the phone IS the identity, as well as being
                        the claim key and the thing an admin searches by. The line wraps
                        instead, and `wrap-break-word` keeps a 120-character name from pushing
                        the card sideways.
                      */}
                      <p className="text-small wrap-break-word text-ink">
                        {row.customerName || 'Walk-in'}{' '}
                        <span className="whitespace-nowrap text-muted num">
                          {row.customerPhone}
                        </span>
                      </p>

                      <p className="text-small text-muted">
                        <span className="num">{row._count.items}</span>{' '}
                        {row._count.items === 1 ? 'item' : 'items'} ·{' '}
                        <time dateTime={row.createdAt.toISOString()} className="num">
                          {formatShopDateTime(row.createdAt)}
                        </time>
                        {/* The ordinary outcomes, stated quietly rather than badged. */}
                        {!row.voidedAt && row.sentViaWa && ' · Sent'}
                        {!row.voidedAt && row.userId && ' · Claimed'}
                      </p>

                      {(row.voidedAt || (!row.voidedAt && !row.sentViaWa)) && (
                        <div className="flex flex-wrap gap-2">
                          {row.voidedAt ? (
                            <Badge tone="down">
                              <Ban className="size-4" aria-hidden="true" />
                              Void
                            </Badge>
                          ) : (
                            /* Outline, not red: an unsent bill is a job still to do, not a
                               failure. §7.2's dashboard alert already counts them. */
                            <Badge tone="outline">
                              <Send className="size-4" aria-hidden="true" />
                              Not sent
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>

                    {/* §4's "primary action": opening the bill IS the action, and the row
                        should look like it leads somewhere. */}
                    <ChevronRight
                      className="size-icon shrink-0 text-muted"
                      aria-hidden="true"
                    />
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {pages > 1 && (
          <nav
            aria-label="Bill pages"
            className="flex items-center justify-between gap-4"
          >
            {filters.page > 1 ? (
              <Link
                href={withPage(filters, filters.page - 1)}
                className={buttonClasses({ variant: 'outline', size: 'md' })}
              >
                Previous
              </Link>
            ) : (
              <span />
            )}
            <p className="text-small text-muted">
              Page <span className="num">{filters.page}</span> of{' '}
              <span className="num">{pages}</span>
            </p>
            {filters.page < pages ? (
              <Link
                href={withPage(filters, filters.page + 1)}
                className={buttonClasses({ variant: 'outline', size: 'md' })}
              >
                Next
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </div>
    </Section>
  );
}

/** One applied filter, removable on its own. A link, so it works with JavaScript off. */
function FilterPill({ label, href }: { label: string; href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-tap items-center gap-2 rounded-pill bg-rose-tint px-4 text-small font-medium text-ink transition-colors duration-fast ease-standard hover:bg-rose/15"
    >
      {label}
      <X className="size-4" aria-hidden="true" />
      <span className="sr-only">— remove this filter</span>
    </Link>
  );
}
