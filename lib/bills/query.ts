/**
 * The bills list — search, filters, and the CSV the accountant gets.
 * Created by Phase 8 (specs/08-billing-whatsapp.md §8.5).
 *
 * §8.5: "Search by phone, order number, customer name. Filters: date range, sent/unsent,
 * claimed/unclaimed." And: "Export CSV for the accountant."
 *
 * Every filter is an allowlisted token parsed from the URL, the same shape Phase 6 used for
 * the catalogue: a link to a filtered view survives being pasted into WhatsApp, and there
 * is no filter state that only exists in a component.
 */
import 'server-only';

import type { Prisma } from '@prisma/client';

import { NOT_VOIDED } from '@/lib/bills/totals';
import { normalisePhone } from '@/lib/auth/identifier';
import { formatShopDateTime } from '@/lib/datetime';
import { db } from '@/lib/db';
import { formatAmountDigits } from '@/lib/money';

export const SENT_FILTERS = ['all', 'sent', 'unsent'] as const;
export const CLAIM_FILTERS = ['all', 'claimed', 'unclaimed'] as const;
export const VOID_FILTERS = ['active', 'voided', 'all'] as const;

export type SentFilter = (typeof SENT_FILTERS)[number];
export type ClaimFilter = (typeof CLAIM_FILTERS)[number];
export type VoidFilter = (typeof VOID_FILTERS)[number];

export interface BillFilters {
  q: string;
  sent: SentFilter;
  claim: ClaimFilter;
  voided: VoidFilter;
  /** `YYYY-MM-DD`, inclusive. */
  from: string;
  to: string;
  page: number;
}

export const BILLS_PAGE_SIZE = 25;

function pick<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A date that exists, not merely one shaped like a date (SEC-033).
 *
 * The regex alone accepted `9999-99-99`, which `billsWhere` turned into `new Date(…)` →
 * `Invalid Date` → a Prisma throw → **500 on `/admin/bills` and on the CSV export**. Probed
 * against the real database during the Phase 9 §9.1 pass; the comment below this function
 * claimed "a hand-edited URL cannot 500", and it could.
 *
 * Round-tripping through `Date` is what closes it: `2026-02-30` parses without complaint and
 * comes back as 2 March, so comparing the formatted result against the input is the only
 * cheap check that rejects a day that does not exist in that month.
 */
function validDate(value: string | undefined): string {
  if (!value || !ISO_DATE.test(value)) return '';

  // Parsed as UTC deliberately — this is a calendar check, not a moment in time. Using the
  // shop's zone here would make 1 January reject or accept depending on the server's clock.
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return '';

  // `2026-02-30` → 2026-03-02. If it did not survive the round trip, it was never a date.
  return parsed.toISOString().slice(0, 10) === value ? value : '';
}

/** Parse the query string. Anything unrecognised falls back rather than erroring. */
export function parseBillFilters(
  params: Record<string, string | undefined>,
): BillFilters {
  const page = Number(params.page);

  return {
    q: (params.q ?? '').trim().slice(0, 80),
    sent: pick(params.sent, SENT_FILTERS, 'all'),
    claim: pick(params.claim, CLAIM_FILTERS, 'all'),
    voided: pick(params.voided, VOID_FILTERS, 'active'),
    from: validDate(params.from),
    to: validDate(params.to),
    // Bounded as well as positive: `skip` is an Int in Prisma, and an absurd page is a
    // pointless sequential scan even where it does not overflow.
    page: Number.isInteger(page) && page > 0 && page <= 100_000 ? page : 1,
  };
}

/**
 * The Prisma filter.
 *
 * ── Why the search term is normalised as a phone first ──
 * §8.5 searches "by phone, order number, customer name", and an admin types the number the
 * way the customer said it: `98765 43210`. Stored values are E.164. Without normalising,
 * the one search the shop uses most — look up a customer by their number — matches nothing.
 * The raw term is still matched as a substring, so a partial number still works.
 */
export function billsWhere(filters: BillFilters): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {};

  if (filters.voided === 'active') Object.assign(where, NOT_VOIDED);
  if (filters.voided === 'voided') where.voidedAt = { not: null };

  if (filters.sent !== 'all') where.sentViaWa = filters.sent === 'sent';
  if (filters.claim !== 'all') {
    where.userId = filters.claim === 'claimed' ? { not: null } : null;
  }

  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: new Date(`${filters.from}T00:00:00+05:30`) } : {}),
      // `to` is inclusive of the whole day, which is what "to 5 August" means to a person.
      ...(filters.to ? { lt: new Date(`${filters.to}T23:59:59.999+05:30`) } : {}),
    };
  }

  if (filters.q) {
    const asPhone = normalisePhone(filters.q);

    /**
     * ── The digits clause only exists when there ARE digits (Stage 5E) ──
     *
     * `filters.q.replace(/\D/g, '')` is `''` for any term without a number in it, and
     * `contains: ''` is `LIKE '%%'` — which matches every row in the table. So searching the
     * invoice book by CUSTOMER NAME, one of the three things §8.5 promises, returned the
     * entire ledger: the header read "120 bills", every bill was listed, and it looked like
     * no filter had been applied rather than like a broken one.
     *
     * The same `billsWhere` backs `/admin/bills/export`, so the accountant's CSV for a name
     * search was also the whole book.
     *
     * Measured against the real database before changing anything: `q=zzzznotabill` matched
     * 120 of 120 active orders. A name search now matches on `customerName` and `orderNo`
     * alone, which is what it was always meant to do.
     */
    const digits = filters.q.replace(/\D/g, '');

    where.OR = [
      { orderNo: { contains: filters.q, mode: 'insensitive' } },
      { customerName: { contains: filters.q, mode: 'insensitive' } },
      ...(digits ? [{ customerPhone: { contains: digits } }] : []),
      ...(asPhone ? [{ customerPhone: asPhone }] : []),
    ];
  }

  return where;
}

export const BILL_ROW_SELECT = {
  id: true,
  orderNo: true,
  customerName: true,
  customerPhone: true,
  grandTotal: true,
  sentViaWa: true,
  sentAt: true,
  userId: true,
  voidedAt: true,
  billPdfKey: true,
  createdAt: true,
  _count: { select: { items: true } },
} as const;

export async function listBills(filters: BillFilters) {
  const where = billsWhere(filters);

  const [rows, total] = await Promise.all([
    db.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (filters.page - 1) * BILLS_PAGE_SIZE,
      take: BILLS_PAGE_SIZE,
      select: BILL_ROW_SELECT,
    }),
    db.order.count({ where }),
  ]);

  return { rows, total, pages: Math.max(1, Math.ceil(total / BILLS_PAGE_SIZE)) };
}

// ── CSV (§8.5: "Export CSV for the accountant") ────────────────────────────

/**
 * Escape one field.
 *
 * ── This is not only about quotes ──
 * A customer name is admin-entered free text and the file opens in Excel, where a leading
 * `=`, `+`, `-` or `@` makes the cell a FORMULA. `=HYPERLINK(...)` in an accountant's
 * spreadsheet is a real attack (CSV injection), not a theoretical one, so those four are
 * prefixed with a tab — the standard neutralisation, invisible in the cell, and it survives
 * a round trip through Excel and Sheets alike.
 */
export function csvField(value: string): string {
  const neutralised = /^[=+\-@\t\r]/.test(value) ? `\t${value}` : value;
  return `"${neutralised.replace(/"/g, '""')}"`;
}

const CSV_HEADERS = [
  'Invoice',
  'Date',
  'Customer',
  'Phone',
  'Items',
  'Taxable (Rs.)',
  'GST (Rs.)',
  'Total (Rs.)',
  'Sent',
  'Claimed',
  'Status',
];

export interface CsvRow {
  orderNo: string;
  createdAt: Date;
  customerName: string | null;
  customerPhone: string;
  subtotal: bigint;
  gstAmount: bigint;
  grandTotal: bigint;
  sentViaWa: boolean;
  userId: string | null;
  voidedAt: Date | null;
  _count: { items: number };
}

export function toCsv(rows: CsvRow[]): string {
  const lines = [CSV_HEADERS.map(csvField).join(',')];

  for (const row of rows) {
    lines.push(
      [
        csvField(row.orderNo),
        csvField(formatShopDateTime(row.createdAt)),
        csvField(row.customerName ?? ''),
        csvField(row.customerPhone),
        csvField(String(row._count.items)),
        csvField(formatAmountDigits(row.subtotal)),
        csvField(formatAmountDigits(row.gstAmount)),
        csvField(formatAmountDigits(row.grandTotal)),
        csvField(row.sentViaWa ? 'Yes' : 'No'),
        csvField(row.userId ? 'Yes' : 'No'),
        csvField(row.voidedAt ? 'VOID' : 'Active'),
      ].join(','),
    );
  }

  // CRLF, which is what RFC 4180 specifies and what Excel on Windows expects.
  return `${lines.join('\r\n')}\r\n`;
}

/** The CSV export reads the same filters as the screen, so what you see is what you get. */
export async function exportBillsCsv(filters: BillFilters): Promise<string> {
  const rows = await db.order.findMany({
    where: billsWhere(filters),
    orderBy: { createdAt: 'desc' },
    // A bounded export. An accountant asking for "everything" gets the most recent 5,000
    // rows and a date filter, rather than a request that times out at the proxy.
    take: 5000,
    select: {
      orderNo: true,
      createdAt: true,
      customerName: true,
      customerPhone: true,
      subtotal: true,
      gstAmount: true,
      grandTotal: true,
      sentViaWa: true,
      userId: true,
      voidedAt: true,
      _count: { select: { items: true } },
    },
  });

  return toCsv(rows);
}
