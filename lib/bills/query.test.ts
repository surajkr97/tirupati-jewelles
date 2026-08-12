/**
 * The bills-list filter parser — SEC-033.
 * Phase 9 §9.1 (specs/09-hardening.md).
 *
 * ── Why this file exists separately from the route test ──
 * `test/route-validation.test.ts` drives `/admin/bills/export` with `from=9999-99-99` and
 * passes. It passes against the BROKEN parser too, because `requireAdmin()` answers 404
 * before the query string is ever parsed — mutation-checked, and it is the reason this file
 * was written. A route whose authorisation boundary is in front of its validation cannot
 * have its validation tested through the route.
 *
 * So the parser is tested where it lives. `parseBillFilters` and `billsWhere` had no test at
 * all before this, which is how the defect survived Phase 8.
 *
 * The defect: `/^\d{4}-\d{2}-\d{2}$/` accepts `9999-99-99`, which becomes `Invalid Date`,
 * which Prisma throws on — so the bills list and the accountant's CSV export both 500 on a
 * hand-edited URL, contradicting the parser's own comment.
 */
import { describe, expect, it } from 'vitest';

import { billsWhere, parseBillFilters } from '@/lib/bills/query';

/**
 * The property that matters, stated once.
 *
 * Not "the filter equals this string" — what breaks Prisma is a `Date` that is `Invalid
 * Date`, so that is what gets asserted. A parser change that produced a different but still
 * valid date would be a bug this does not catch, and a separate assertion covers the values.
 */
function everyDateIsReal(params: Record<string, string | undefined>): boolean {
  const where = billsWhere(parseBillFilters(params));
  const range = where.createdAt as { gte?: Date; lt?: Date } | undefined;
  if (!range) return true;

  return [range.gte, range.lt]
    .filter((d): d is Date => d instanceof Date)
    .every((d) => !Number.isNaN(d.getTime()));
}

describe('parseBillFilters — dates', () => {
  it.each([
    ['a month that does not exist', '9999-99-99'],
    ['month 13', '2026-13-01'],
    ['day 45', '2026-01-45'],
    ['all zeroes', '0000-00-00'],
    ['30 February', '2026-02-30'],
    ['31 April', '2026-04-31'],
    ['29 February in a non-leap year', '2025-02-29'],
  ])('rejects %s rather than producing an Invalid Date', (_name, value) => {
    // Confirmed to FAIL against the pre-fix parser for every case except the impossible
    // days, which JS rolls forward silently — see the separate assertion below.
    expect(everyDateIsReal({ from: value })).toBe(true);
    expect(everyDateIsReal({ to: value })).toBe(true);
  });

  it('does not silently roll an impossible day into the next month', () => {
    /**
     * The quieter half of the bug. `new Date('2026-02-30')` does not throw — it returns
     * 2 March. So an admin filtering "to 30 February" would have got results from March and
     * no indication anything was wrong. Rejecting is the honest answer: the filter is
     * dropped and the screen shows the unfiltered range it says it is showing.
     */
    expect(parseBillFilters({ from: '2026-02-30' }).from).toBe('');
    expect(parseBillFilters({ from: '2025-02-29' }).from).toBe('');
  });

  it('accepts real dates, including a genuine leap day', () => {
    // The positive control. Without it, a parser that rejected everything would pass above.
    expect(parseBillFilters({ from: '2026-08-06' }).from).toBe('2026-08-06');
    expect(parseBillFilters({ to: '2026-12-31' }).to).toBe('2026-12-31');
    expect(parseBillFilters({ from: '2024-02-29' }).from).toBe('2024-02-29');
  });

  it('builds a real range for a real pair', () => {
    const where = billsWhere(parseBillFilters({ from: '2026-01-01', to: '2026-01-31' }));
    const range = where.createdAt as { gte: Date; lt: Date };

    expect(Number.isNaN(range.gte.getTime())).toBe(false);
    expect(Number.isNaN(range.lt.getTime())).toBe(false);
    // `to` is inclusive of the whole day — what "to 31 January" means to a person.
    expect(range.lt.getTime()).toBeGreaterThan(
      new Date('2026-01-31T00:00:00+05:30').getTime(),
    );
  });
});

describe('parseBillFilters — the other fields', () => {
  it('falls back on unrecognised tokens rather than erroring', () => {
    const filters = parseBillFilters({
      sent: 'maybe',
      claim: 'perhaps',
      voided: 'sometimes',
    });

    expect(filters.sent).toBe('all');
    expect(filters.claim).toBe('all');
    expect(filters.voided).toBe('active');
  });

  it('bounds the page number', () => {
    // `skip` is an Int in Prisma and an absurd page is a pointless sequential scan even
    // where it does not overflow.
    expect(parseBillFilters({ page: '99999999999' }).page).toBe(1);
    expect(parseBillFilters({ page: '-1' }).page).toBe(1);
    expect(parseBillFilters({ page: 'abc' }).page).toBe(1);
    expect(parseBillFilters({ page: '0' }).page).toBe(1);
    expect(parseBillFilters({ page: '7' }).page).toBe(7);
  });

  it('bounds the search term', () => {
    expect(parseBillFilters({ q: 'x'.repeat(500) }).q).toHaveLength(80);
  });
});

/**
 * Searching by name must not return the whole ledger — Stage 5E.
 *
 * `filters.q.replace(/\D/g, '')` is `''` for a term with no digits, and Prisma's
 * `contains: ''` compiles to `LIKE '%%'`, which matches every row. So the `OR` always
 * contained one clause that was true for every bill in the shop, and §8.5's "search by
 * customer name" silently returned everything — on the screen AND in the accountant's CSV,
 * which shares this function.
 *
 * Verified against the real database before it was fixed: `q=zzzznotabill` matched 120 of
 * 120 active orders. Asserted on the shape of the `where` rather than through a query,
 * because the defect is structural and a fixture-dependent count would rot.
 */
describe('billsWhere — the search term', () => {
  const clauses = (q: string) =>
    (billsWhere(parseBillFilters({ q })).OR ?? []) as Record<string, unknown>[];

  const phoneSubstring = (q: string) =>
    clauses(q).find(
      (clause) =>
        typeof clause.customerPhone === 'object' && clause.customerPhone !== null,
    ) as { customerPhone: { contains: string } } | undefined;

  it('never asks the database for `customerPhone contains ""`', () => {
    for (const q of ['zzzznotabill', 'Priya', 'Priya Sharma', 'JW-', '  name  ']) {
      const clause = phoneSubstring(q);
      expect(clause?.customerPhone.contains, `"${q}" produced a match-everything clause`)
        .not.toBe('');
    }
  });

  it('a name search looks at the name and the invoice number, and nothing else', () => {
    const keys = clauses('Priya Sharma').map((clause) => Object.keys(clause)[0]);
    expect(keys).toEqual(['orderNo', 'customerName']);
  });

  it('a number still searches the phone, both as typed and normalised', () => {
    const keys = clauses('98765 43210').map((clause) => Object.keys(clause)[0]);
    // orderNo, customerName, the digit substring, and the E.164 form.
    expect(keys).toEqual(['orderNo', 'customerName', 'customerPhone', 'customerPhone']);
    expect(phoneSubstring('98765 43210')?.customerPhone.contains).toBe('9876543210');
  });

  it('a mixed term keeps its digits', () => {
    // "JW-2026-0041" is an invoice number, and its digits are still a usable phone
    // substring — the OR is a union, so an extra clause costs nothing but a miss does.
    expect(phoneSubstring('JW-2026-0041')?.customerPhone.contains).toBe('20260041');
  });
});
