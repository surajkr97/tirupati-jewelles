/**
 * Invoice numbering — `JW-2026-0001`.
 * Created by Phase 8 (specs/08-billing-whatsapp.md §8.2).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  §8.2: "sequence from a DB counter inside the transaction. **Do not derive it from
 *  `COUNT(*)`** — concurrent bills will collide."
 *
 *  §8 TEST makes that a hard case: "50 concurrent bill creations → 50 unique sequential
 *  numbers, no gaps, no duplicates. **Run this with real concurrency, not a loop.**"
 *
 *  Two things are needed for that and neither is optional:
 *
 *    1. The read and the write are ONE statement. `SELECT next` then `UPDATE next + 1` is
 *       two, and between them another transaction reads the same value. `INSERT … ON
 *       CONFLICT DO UPDATE … RETURNING` is atomic, and its row lock is held for the rest of
 *       the caller's transaction — so fifty concurrent bills queue on this row rather than
 *       racing.
 *    2. It runs on the CALLER'S transaction client, not on `db`. A counter incremented
 *       outside the transaction that writes the order would hand out a number and then lose
 *       the order to a rollback — a gap in a legally numbered invoice series.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import 'server-only';

import type { Prisma } from '@prisma/client';

/** §8.2's format. The prefix is configurable in Settings (§7.9); the shape is not. */
export const SEQUENCE_PAD = 4;

export function formatOrderNo(prefix: string, year: number, sequence: number): string {
  return `${prefix}-${year}-${String(sequence).padStart(SEQUENCE_PAD, '0')}`;
}

/**
 * Take the next number for `year`, atomically.
 *
 * @param tx   a transaction client — passing `db` would defeat the whole mechanism
 * @param year the calendar year the invoice is dated in
 *
 * The row stores the NEXT number to hand out, so a fresh year inserts `2` and returns the
 * `1` it just reserved. Reading the post-increment value and subtracting one is what lets
 * the insert and the update share a single `RETURNING` clause.
 */
export async function nextSequence(
  tx: Prisma.TransactionClient,
  year: number,
): Promise<number> {
  const rows = await tx.$queryRaw<{ next: number }[]>`
    INSERT INTO "BillSequence" ("year", "next")
    VALUES (${year}, 2)
    ON CONFLICT ("year") DO UPDATE SET "next" = "BillSequence"."next" + 1
    RETURNING "next"
  `;

  const row = rows[0];
  if (!row) {
    // Unreachable: the statement either inserts or updates, and both RETURN. Thrown rather
    // than defaulted, because silently starting again at 1 would duplicate every number in
    // the series.
    throw new Error('Bill sequence did not return a value.');
  }

  return row.next - 1;
}

/**
 * The year an invoice is numbered in.
 *
 * `Asia/Kolkata`, not the server's zone (D-014). A bill raised at 1am IST on 1 January is a
 * bill of the new year; on a UTC host `new Date().getFullYear()` still says December, and
 * the series would restart four and a half hours late — visible in the invoice book
 * forever.
 */
export function shopYear(at: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    }).format(at),
  );
}
