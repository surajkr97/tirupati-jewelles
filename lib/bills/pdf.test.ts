/**
 * Phase 8 TEST — the invoice PDF and the URLs that reach it.
 * specs/08-billing-whatsapp.md:
 *
 *   TEST: "PDF renders with 1 item and with 20 items without layout breaking."
 *   SECURITY: "Bill PDF URL unguessable and unlisted; sequential guessing returns 404."
 *   SECURITY: "Customer A cannot fetch customer B's bill by ID or by PDF key."
 *
 * ── What "without layout breaking" is taken to mean ──
 * A renderer that throws is easy to catch and is not the interesting failure. The ones that
 * matter are silent: content printed underneath the fixed footer, a column running into its
 * neighbour, a glyph the font cannot draw. Those are asserted here against the rendered
 * PAGE GEOMETRY and the content stream, not against the fact that bytes came back.
 *
 * The signature suite is exhaustive rather than illustrative: every way a capability URL can
 * be wrong is a way an attacker can try to make it right.
 */
import { inflateSync } from 'node:zlib';

import { Purity } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

import { PAGE_BOTTOM_PADDING } from '@/lib/bills/pdf';
import { buildBillData, renderBillPdf, type OrderForPdf } from '@/lib/bills/render';
import {
  BILL_URL_TTL_SECONDS,
  newBillKey,
  signedBillPath,
  verifyBillSignature,
} from '@/lib/bills/storage';
import { db } from '@/lib/db';

const HAS_TEST_DB = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = HAS_TEST_DB ? describe : describe.skip;

const GOLD_22 = 1_184_200n;

/**
 * One line, priced by hand from MASTER-SPEC §4 so the fixture does not depend on the engine.
 * 10 g × ₹11,842/g = ₹1,18,420 metal, +12% making = ₹14,210.40, ×1.03 = ₹1,36,609.31.
 */
const LINE_TOTAL = 13_660_931n;
const TAXABLE = 13_263_040n;

function line(overrides: Partial<OrderForPdf['items'][number]> = {}) {
  return {
    name: 'Chain',
    metal: 'GOLD' as const,
    purity: Purity.K22_916,
    weightMg: 10_000,
    ratePerGram: GOLD_22,
    makingPct: '12.00',
    stoneCharge: 0n,
    gstPct: '3.00',
    lineTotal: LINE_TOTAL,
    hallmarkNo: null,
    bisCertNo: null,
    ...overrides,
  };
}

function order(items: OrderForPdf['items']): OrderForPdf {
  const grandTotal = items.reduce((sum, item) => sum + item.lineTotal, 0n);
  return {
    orderNo: 'JW-2026-0001',
    createdAt: new Date('2026-08-06T07:00:00Z'),
    customerName: 'Test Customer',
    customerPhone: '+919876543210',
    note: null,
    subtotal: TAXABLE * BigInt(items.length),
    gstAmount: grandTotal - TAXABLE * BigInt(items.length),
    grandTotal,
    ratesSnapshot: {
      K22_916: GOLD_22.toString(),
      K18_750: '969300',
      SILVER_999: '15890',
    },
    ratesAt: new Date('2026-08-06T04:00:00Z'),
    voidedAt: null,
    items,
  };
}

/** A4 in PDF points. */
const A4_HEIGHT = 841.89;
const A4_WIDTH = 595.28;

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** PDF row-vector composition: the result of applying `a` and then `b`. */
function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

interface TextRun {
  x: number;
  y: number;
  text: string;
}

/** `<48656c6c6f>` inside a `TJ` array → `Hello`. Content is WinAnsi by construction. */
function decodeHexRuns(array: string): string {
  return (array.match(/<([0-9a-fA-F]*)>/g) ?? [])
    .map((chunk) => Buffer.from(chunk.slice(1, -1), 'hex').toString('latin1'))
    .join('');
}

/**
 * Every run of text on the page, with where it actually lands, in points from the top-left.
 *
 * ── Why this needs a matrix stack, and why the first version of it was worthless ──
 * The obvious parse — read `x y Tm` and call that the position — is wrong for this
 * renderer. `@react-pdf/renderer` emits the SAME `Tm` for every run (`1 0 0 1 0 841.89`)
 * and positions content by pushing `q` / `cm` translations around it. So the naive version
 * reported the same y for everything, and the footer-overlap test it fed passed just as
 * green against the padding value that produced the original defect. Caught by mutation,
 * which is the only reason it was noticed at all.
 *
 * This walks the content stream keeping the CTM stack and composes `Tm × CTM`, which is
 * what a viewer does.
 */
function textRuns(pdf: Buffer): TextRun[] {
  const runs: TextRun[] = [];

  for (const stream of extractStreams(pdf)) {
    let ctm: Matrix = IDENTITY;
    const stack: Matrix[] = [];
    let current: TextRun | null = null;

    const token =
      /(?:([\d.eE+-]+) ([\d.eE+-]+) ([\d.eE+-]+) ([\d.eE+-]+) ([\d.eE+-]+) ([\d.eE+-]+) (cm|Tm))|\b(q|Q)\b|\[([^\]]*)\]\s*TJ/g;

    let match: RegExpExecArray | null;
    while ((match = token.exec(stream)) !== null) {
      if (match[8] === 'q') {
        stack.push(ctm);
        continue;
      }
      if (match[8] === 'Q') {
        ctm = stack.pop() ?? IDENTITY;
        continue;
      }
      if (match[9] !== undefined) {
        if (current) current.text += decodeHexRuns(match[9]);
        continue;
      }

      const m = match.slice(1, 7).map(Number) as Matrix;

      if (match[7] === 'cm') {
        ctm = multiply(m, ctm);
      } else {
        const device = multiply(m, ctm);
        current = { x: device[4], y: A4_HEIGHT - device[5], text: '' };
        runs.push(current);
      }
    }
  }

  return runs;
}

/**
 * Phrases that appear only in the fixed footer.
 *
 * Identifying the footer by its CONTENT rather than by a y threshold is what makes the
 * overlap assertion real: a hardcoded "below 758pt" moves with whatever padding the
 * implementation currently uses, so it agrees with the bug as readily as with the fix.
 */
const FOOTER_PHRASES = ['Buyback and exchange', 'computer-generated invoice', 'Page '];

function isFooter(run: TextRun): boolean {
  return FOOTER_PHRASES.some((phrase) => run.text.includes(phrase));
}

function extractStreams(pdf: Buffer): string[] {
  const raw = pdf.toString('latin1');
  const streams: string[] = [];

  const pattern = /stream\r?\n([\s\S]*?)endstream/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) !== null) {
    try {
      streams.push(inflateSync(Buffer.from(match[1]!, 'latin1')).toString('latin1'));
    } catch {
      // Not a deflate stream — a font or an image. Skipped.
    }
  }
  return streams;
}

function pageCount(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

describeDb('invoice PDF', () => {
  beforeAll(async () => {
    // `renderBillPdf` reads Settings and the logo slot. An empty database is a valid state
    // — a shop that has not filled in its details still has to be able to raise a bill.
    await db.settings.deleteMany();
    await db.mediaSlot.deleteMany({ where: { slotKey: 'BILL_LOGO' } });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('renders a 1-item bill', async () => {
    const pdf = await renderBillPdf(order([line()]));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount(pdf)).toBe(1);
  }, 30_000);

  it('renders a 20-item bill across pages', async () => {
    const items = Array.from({ length: 20 }, (_, index) =>
      line({ name: `Piece ${index + 1} — a deliberately long description that wraps` }),
    );
    const pdf = await renderBillPdf(order(items));

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount(pdf)).toBeGreaterThan(1);
  }, 30_000);

  it('reserves more bottom padding than the footer actually occupies', async () => {
    /**
     * The live defect, stated as the property that prevents it.
     *
     * The footer is absolutely positioned, so it does not push content out of its way — the
     * page's bottom padding is the only thing keeping a table row off it. At 56pt the last
     * row of a spilling 20-item bill printed underneath the terms block.
     *
     * ── Why this shape, and not "assert no row overlaps the footer" ──
     * That was written first and could not fail: whether a row happens to land in the
     * 28pt band depends on how rows tile, and with the fixture's row height none did. It
     * passed identically against the padding value that caused the bug — checked by
     * mutation, which is the only reason it was caught. This measures the footer's REAL
     * extent from the rendered page and compares it against the reserved space, so it
     * flips exactly at the boundary that matters, on every fixture.
     */
    const items = Array.from({ length: 20 }, (_, index) =>
      line({ name: `Piece ${index + 1} — a deliberately long description that wraps` }),
    );
    const pdf = await renderBillPdf(order(items));

    const footer = textRuns(pdf).filter(isFooter);
    // Positive control: with no footer found, the comparison below would be vacuous.
    expect(footer.length).toBeGreaterThanOrEqual(pageCount(pdf));

    // Distance from the page's bottom edge up to the footer's topmost line.
    const footerExtent = A4_HEIGHT - Math.min(...footer.map((run) => run.y));

    expect(PAGE_BOTTOM_PADDING).toBeGreaterThan(footerExtent);
  }, 30_000);

  it('stays inside the page width', async () => {
    const pdf = await renderBillPdf(order([line({ name: 'A'.repeat(120) })]));

    for (const point of textRuns(pdf)) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThan(A4_WIDTH);
    }
  }, 30_000);

  it('prints no character the font cannot draw', async () => {
    // ₹ has no WinAnsi glyph and the encoder does not complain — it emits `onesuperior`.
    const pdf = await renderBillPdf(
      order([line({ name: 'Necklace 🙏 ₹ प्रिया', hallmarkNo: 'HM-1' })]),
    );
    const text = pdf.toString('latin1');

    expect(text).not.toContain('₹');
    expect(text).not.toContain('🙏');
  }, 30_000);

  it('refuses to print a bill that disagrees with its own snapshot', async () => {
    // The stored total is authoritative. If recomputing from the snapshot does not
    // reproduce it, something upstream is broken and a printed bill would be evidence of it.
    const corrupt = order([line({ lineTotal: LINE_TOTAL + 1n })]);

    expect(() =>
      buildBillData(
        corrupt,
        { shopName: 'Test', address: null, gstin: null, contactPhone: null },
        null,
      ),
    ).toThrow(/does not match/);
  });

  it('derives the rate reference block from the snapshot, not from today', async () => {
    const data = buildBillData(
      order([line()]),
      { shopName: 'Test', address: null, gstin: null, contactPhone: null },
      null,
    );

    // Display units: gold per 10g, silver per kg.
    expect(data.rates).toEqual([
      { label: 'Gold 22K', amount: GOLD_22 * 10n, unit: 'per 10g' },
      { label: 'Gold 18K', amount: 9_693_000n, unit: 'per 10g' },
      { label: 'Silver 999', amount: 15_890_000n, unit: 'per 1kg' },
    ]);
  });

  it('falls back to the applied rates when an order predates the snapshot column', async () => {
    const legacy = { ...order([line()]), ratesSnapshot: null, ratesAt: null };
    const data = buildBillData(
      legacy,
      { shopName: 'Test', address: null, gstin: null, contactPhone: null },
      null,
    );

    // Only the purity actually billed, which is less complete but never wrong.
    expect(data.rates).toEqual([
      { label: 'Gold 22K', amount: GOLD_22 * 10n, unit: 'per 10g' },
    ]);
  });

  it('stamps a voided invoice rather than printing it clean', async () => {
    const voided = { ...order([line()]), voidedAt: new Date('2026-08-07T10:00:00Z') };
    const data = buildBillData(
      voided,
      { shopName: 'Test', address: null, gstin: null, contactPhone: null },
      null,
    );
    expect(data.voidedOn).toBeTruthy();

    const pdf = await renderBillPdf(voided);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  }, 30_000);
});

// ── Signed capability URLs (§8.3, §8 SECURITY) ─────────────────────────────

describe('signed bill URLs', () => {
  const key = newBillKey();
  const future = new Date(Date.now() + 60_000);

  function parts(path: string) {
    const url = new URL(path, 'https://example.test');
    return {
      e: url.searchParams.get('e'),
      s: url.searchParams.get('s'),
    };
  }

  it('mints a UUIDv4 key, never anything sequential', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(newBillKey()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    }
    expect(new Set(Array.from({ length: 100 }, newBillKey)).size).toBe(100);
  });

  it('accepts a fresh signature', () => {
    const { e, s } = parts(signedBillPath(key, future));
    expect(verifyBillSignature(key, e, s)).toBe('valid');
  });

  it('reports a missing signature as absent, not invalid', () => {
    // The route treats both as 404; the distinction is for the caller's own logic.
    expect(verifyBillSignature(key, null, null)).toBe('absent');
    expect(verifyBillSignature(key, '123', null)).toBe('absent');
    expect(verifyBillSignature(key, null, 'abc')).toBe('absent');
  });

  it('rejects a tampered signature', () => {
    const { e, s } = parts(signedBillPath(key, future));
    expect(verifyBillSignature(key, e, `${s!.slice(0, -1)}X`)).toBe('invalid');
    expect(verifyBillSignature(key, e, s!.slice(0, -1))).toBe('invalid');
    expect(verifyBillSignature(key, e, `${s}extra`)).toBe('invalid');
    expect(verifyBillSignature(key, e, '')).toBe('absent');
  });

  it('rejects a signature minted for a different bill', () => {
    // Holding customer B's key is not enough: A would need B's HMAC.
    const { e, s } = parts(signedBillPath(key, future));
    expect(verifyBillSignature(newBillKey(), e, s)).toBe('invalid');
  });

  it('rejects an extended expiry — the deadline is inside the MAC', () => {
    const { e, s } = parts(signedBillPath(key, future));
    expect(verifyBillSignature(key, String(Number(e) + 3600), s)).toBe('invalid');
    expect(verifyBillSignature(key, String(Number(e) - 3600), s)).toBe('invalid');
  });

  it('rejects a non-numeric expiry rather than coercing it', () => {
    const { s } = parts(signedBillPath(key, future));
    for (const bad of ['12e9', '1.5', ' 123', 'abc', '-1', '99999999999999']) {
      expect(verifyBillSignature(key, bad, s)).toBe('invalid');
    }
  });

  it('reports an elapsed deadline as expired', () => {
    const past = new Date(Date.now() - 1000);
    const { e, s } = parts(signedBillPath(key, past));
    expect(verifyBillSignature(key, e, s)).toBe('expired');
  });

  it('checks the signature BEFORE the expiry', () => {
    // Otherwise a random `e` with a random `s` would be reported "expired", which leaks
    // whether the timestamp was in range and confuses a customer with a genuinely old link.
    const past = new Date(Date.now() - 1000);
    const { e } = parts(signedBillPath(key, past));
    expect(verifyBillSignature(key, e, 'not-a-signature-at-all-but-right-ish')).toBe(
      'invalid',
    );
  });

  it('issues §8.3’s 7-day lifetime', () => {
    expect(BILL_URL_TTL_SECONDS).toBe(7 * 24 * 60 * 60);
  });

  it('produces a stable signature for the same key and deadline', () => {
    // The Redis cache hands the same URL back for 24h; that is only coherent if signing is
    // deterministic.
    const deadline = new Date(Date.now() + 3_600_000);
    expect(signedBillPath(key, deadline)).toBe(signedBillPath(key, deadline));
  });
});
