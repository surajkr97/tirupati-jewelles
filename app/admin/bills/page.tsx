/**
 * /admin/bills — the invoice book.
 * Created by Phase 8 (specs/08-billing-whatsapp.md §8.5).
 *
 * §8.5: "Search by phone, order number, customer name. Filters: date range, sent/unsent,
 * claimed/unclaimed. Row: order no, customer, total, sent status, claimed status."
 *
 * Every filter lives in the URL, the same pattern Phase 6 used for the catalogue: the form
 * is a plain GET, so a filtered view survives a reload, a back button and being pasted into
 * a message. There is no filter state that only exists in a component.
 */
import type { Metadata } from 'next';
import Link from 'next/link';

import { Section } from '@/components/shell';
import { Badge, Button, Card, EmptyState } from '@/components/ui';
import {
  BILLS_PAGE_SIZE,
  listBills,
  parseBillFilters,
  type BillFilters,
} from '@/lib/bills/query';
import { formatShopDateTime } from '@/lib/datetime';
import { formatINR } from '@/lib/money';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Bills' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Rebuild the query string with one value changed — used by the pager. */
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

  return (
    <Section className="pt-6 pb-0">
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-h1 font-semibold tracking-tight text-ink">Bills</h1>
          <Link href="/admin/bills/new">
            <Button variant="accent" size="md">
              New bill
            </Button>
          </Link>
        </div>

        {/* A plain GET form. No JavaScript required, and the result is a shareable URL. */}
        <Card>
          <form method="get" className="flex flex-col gap-4">
            <input
              type="search"
              name="q"
              defaultValue={filters.q}
              placeholder="Invoice number, name or phone"
              aria-label="Search bills"
              maxLength={80}
              className="h-control w-full rounded-field bg-white px-4 text-body text-ink ring-1 ring-line ring-inset placeholder:text-muted focus:ring-2 focus:ring-ink focus:outline-none"
            />

            <div className="grid grid-cols-2 gap-4">
              <FilterSelect
                name="sent"
                label="Sent"
                value={filters.sent}
                options={[
                  ['all', 'All'],
                  ['sent', 'Sent'],
                  ['unsent', 'Not sent'],
                ]}
              />
              <FilterSelect
                name="claim"
                label="Claimed"
                value={filters.claim}
                options={[
                  ['all', 'All'],
                  ['claimed', 'Claimed'],
                  ['unclaimed', 'Unclaimed'],
                ]}
              />
              <FilterSelect
                name="voided"
                label="Status"
                value={filters.voided}
                options={[
                  ['active', 'Active'],
                  ['voided', 'Voided'],
                  ['all', 'All'],
                ]}
              />
              <div className="flex flex-col gap-2">
                <span className="text-small font-medium text-ink">Dated</span>
                <div className="flex gap-2">
                  <DateInput name="from" label="From" value={filters.from} />
                  <DateInput name="to" label="To" value={filters.to} />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" variant="primary" size="md">
                Apply
              </Button>
              <Link href="/admin/bills">
                <Button type="button" variant="ghost" size="md">
                  Clear
                </Button>
              </Link>
              {/* §8.5: "Export CSV for the accountant." Same filters as the screen. */}
              <a
                href={`/admin/bills/export${withPage(filters, 1).replace('/admin/bills', '')}`}
                className="ml-auto inline-flex h-tap items-center rounded-pill px-4 text-small font-semibold text-rose-deep hover:underline"
              >
                Export CSV
              </a>
            </div>
          </form>
        </Card>

        <p className="text-small text-muted">
          {total} {total === 1 ? 'bill' : 'bills'}
          {total > BILLS_PAGE_SIZE && ` · page ${filters.page} of ${pages}`}
        </p>

        {rows.length === 0 ? (
          <EmptyState
            title="No bills match"
            description="Change the filters, or raise the first bill of the day."
            action={
              <Link href="/admin/bills/new">
                <Button variant="accent" size="md">
                  New bill
                </Button>
              </Link>
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li key={row.id}>
                <Link href={`/admin/bills/${row.id}`} className="block">
                  <Card className="flex flex-col gap-2">
                    <div className="flex items-baseline justify-between gap-4">
                      <p className="text-body font-semibold text-ink tabular">
                        {row.orderNo}
                      </p>
                      <p className="text-h3 font-semibold text-ink tabular">
                        {formatINR(row.grandTotal)}
                      </p>
                    </div>

                    <p className="truncate text-small text-muted">
                      {row.customerName || 'Walk-in'} · {row.customerPhone} ·{' '}
                      {row._count.items} {row._count.items === 1 ? 'item' : 'items'}
                    </p>

                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={row.sentViaWa ? 'up' : 'neutral'}>
                        {row.sentViaWa ? 'Sent' : 'Not sent'}
                      </Badge>
                      <Badge tone={row.userId ? 'up' : 'neutral'}>
                        {row.userId ? 'Claimed' : 'Unclaimed'}
                      </Badge>
                      {row.voidedAt && <Badge tone="down">Void</Badge>}
                      <span className="ml-auto text-small text-muted tabular">
                        {formatShopDateTime(row.createdAt)}
                      </span>
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between gap-4">
            {filters.page > 1 ? (
              <Link href={withPage(filters, filters.page - 1)}>
                <Button variant="outline" size="md">
                  Previous
                </Button>
              </Link>
            ) : (
              <span />
            )}
            {filters.page < pages && (
              <Link href={withPage(filters, filters.page + 1)}>
                <Button variant="outline" size="md">
                  Next
                </Button>
              </Link>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}

function FilterSelect({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string;
  options: [string, string][];
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-small font-medium text-ink">{label}</span>
      <select
        name={name}
        defaultValue={value}
        className="h-control w-full appearance-none rounded-field bg-white px-4 text-body text-ink ring-1 ring-line ring-inset focus:ring-2 focus:ring-ink focus:outline-none"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function DateInput({
  name,
  label,
  value,
}: {
  name: string;
  label: string;
  value: string;
}) {
  return (
    <input
      type="date"
      name={name}
      defaultValue={value}
      aria-label={label}
      className="h-control w-full min-w-0 rounded-field bg-white px-4 text-small text-ink ring-1 ring-line ring-inset focus:ring-2 focus:ring-ink focus:outline-none"
    />
  );
}
