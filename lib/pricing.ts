/**
 * Pricing engine — the ONLY place jewellery money is calculated.
 * Created by Phase 5 (specs/05-calculator.md §5.1). Formula from MASTER-SPEC §4.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  The calculator UI, the product page and the Phase 8 bill generator all call this.
 *
 *  §5: "Three implementations of GST rounding is three different totals on the same
 *  purchase, and the customer will find it."
 *
 *  Pure functions only — no I/O, no clock, no randomness, no `server-only`. It runs
 *  unchanged in a client component, in a route handler and in a PDF renderer, which is
 *  what makes "one implementation" achievable rather than aspirational.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Everything is integer paise as `bigint` (MASTER-SPEC §4). There is no `number` anywhere
 * in the arithmetic; `number` only appears on the way in, as user-typed percentages and
 * milligrams, and is converted to an exact integer before any money is touched.
 *
 * ── Why the arithmetic looks the way it does ──
 * Rounding once, at `lineTotal`, means every intermediate has to stay EXACT. A percentage
 * and a milligram-to-gram conversion both introduce denominators, so the calculation is
 * carried as a scaled integer numerator and divided exactly once, at the end. That is the
 * whole trick, and it is why there is no `/` in the middle of this file.
 */

// ── Domain literals ────────────────────────────────────────────────────────
//
// String literals rather than the Prisma enums, deliberately. This module is imported by
// a client component, and `@prisma/client` drags a database runtime into the browser
// bundle. The values are identical to the enum members, so a server caller can pass a
// Prisma value straight in.

export const METALS = ['GOLD', 'SILVER'] as const;
export type MetalKey = (typeof METALS)[number];

export const PURITIES = ['K22_916', 'K18_750', 'SILVER_999'] as const;
export type PurityKey = (typeof PURITIES)[number];

/** Paise per gram for each purity — the TRUE rate, never the ticker's jittered display. */
export type RatesByPurity = Record<PurityKey, bigint>;

/** MASTER-SPEC §4: "gstAmount = subtotal × (gstPct / 100) // default 3". */
export const DEFAULT_GST_PCT = 3;

/**
 * ⚠ GST TREATMENT — NOT TAX ADVICE (§5.2).
 *
 * Indian jewellery attracts 3% GST (1.5% CGST + 1.5% SGST intra-state, or 3% IGST
 * inter-state). This engine includes **making charges in the taxable value**, per
 * MASTER-SPEC §4's formula.
 *
 * That treatment has been contested. Whether making charges are part of the taxable value
 * of a composite supply, or a separately taxable service, changes the total. Getting it
 * wrong means reissuing invoices, not a code fix.
 *
 * The client must confirm with their CA before launch. Tracked as **DEBT-001**. Nothing in
 * this repository is tax advice, and the split shown on a Phase 8 bill must not be
 * presented as such.
 */
export const GST_INCLUDES_MAKING_CHARGES = true;

// ── Input and output shapes (§5.1) ─────────────────────────────────────────

export interface LineInput {
  metal: MetalKey;
  purity: PurityKey;
  /** Integer milligrams. MASTER-SPEC §4: "weightGrams is a decimal with 3 places". */
  weightMg: number;
  /** 0–100, at most 2 decimal places (Prisma `Decimal(5,2)`). */
  makingPct: number;
  /** Paise. Exact — a stone charge is typed in rupees and never derived. */
  stoneCharge: bigint;
  /** 0–100, at most 2 decimal places. Defaults to 3. */
  gstPct: number;
}

export interface LineResult {
  metalValue: bigint;
  makingCharge: bigint;
  stoneCharge: bigint;
  subtotal: bigint;
  gstAmount: bigint;
  lineTotal: bigint;
}

export interface TotalResult {
  lines: LineResult[];
  subtotal: bigint;
  totalGst: bigint;
  grandTotal: bigint;
}

// ── Guards — throw, never clamp (§5.1) ─────────────────────────────────────

export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PricingError';
  }
}

/**
 * §5.1: "Reject negative or non-finite inputs by throwing. Do not clamp silently."
 *
 * Clamping a negative weight to zero produces a plausible total from impossible input, and
 * the customer is quoted a price nobody can explain. A throw is caught at the Zod boundary
 * and shown as a field error.
 */
function requireFinite(value: number, field: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PricingError(
      `${field} must be a finite number (received ${String(value)}).`,
    );
  }
}

function requireNonNegative(value: number, field: string): void {
  requireFinite(value, field);
  if (value < 0)
    throw new PricingError(`${field} must not be negative (received ${value}).`);
}

/** Upper bounds. §5 TEST asks for 99999g to work; beyond that is a typo, not a bangle. */
export const MAX_WEIGHT_MG = 100_000_000; // 100 kg
export const MAX_PCT = 100;
export const MAX_STONE_CHARGE = 10_000_000_000n; // ₹1 crore

function assertValidLine(input: LineInput): void {
  if (!METALS.includes(input.metal)) {
    throw new PricingError(`Unknown metal "${String(input.metal)}".`);
  }
  if (!PURITIES.includes(input.purity)) {
    throw new PricingError(`Unknown purity "${String(input.purity)}".`);
  }

  requireNonNegative(input.weightMg, 'weightMg');
  if (!Number.isInteger(input.weightMg)) {
    // Milligrams are the integer unit. A fractional milligram means the caller converted
    // from grams with floating point and has already lost precision.
    throw new PricingError(
      `weightMg must be a whole number of milligrams (received ${input.weightMg}).`,
    );
  }
  if (input.weightMg > MAX_WEIGHT_MG) {
    throw new PricingError(`weightMg exceeds the ${MAX_WEIGHT_MG} mg ceiling.`);
  }

  requireNonNegative(input.makingPct, 'makingPct');
  if (input.makingPct > MAX_PCT) {
    throw new PricingError(
      `makingPct must be 0–${MAX_PCT} (received ${input.makingPct}).`,
    );
  }

  requireNonNegative(input.gstPct, 'gstPct');
  if (input.gstPct > MAX_PCT) {
    throw new PricingError(`gstPct must be 0–${MAX_PCT} (received ${input.gstPct}).`);
  }

  if (typeof input.stoneCharge !== 'bigint') {
    throw new PricingError('stoneCharge must be a bigint of paise — never a float.');
  }
  if (input.stoneCharge < 0n) {
    throw new PricingError(
      `stoneCharge must not be negative (received ${input.stoneCharge}).`,
    );
  }
  if (input.stoneCharge > MAX_STONE_CHARGE) {
    throw new PricingError('stoneCharge exceeds the ₹1 crore ceiling.');
  }
}

// ── Exact arithmetic ───────────────────────────────────────────────────────

/** Milligrams per gram. */
const MG_PER_G = 1_000n;

/**
 * Percentages are carried as integer basis points — hundredths of a percent — because
 * Prisma stores `makingPct` as `Decimal(5,2)`. 12.5% becomes 1250bp, exactly.
 */
const BP_PER_UNIT = 10_000n;

function toBasisPoints(pct: number, field: string): bigint {
  // `Math.round` on the way in is the ONE place a percentage is snapped, and it snaps to
  // the two decimals the schema stores. A float like 12.499999999 typed as 12.5 becomes
  // 1250bp here and is exact from then on.
  const scaled = Math.round(pct * 100);
  if (!Number.isSafeInteger(scaled)) {
    throw new PricingError(`${field} is out of range (received ${pct}).`);
  }
  return BigInt(scaled);
}

/**
 * Divide with banker's rounding (round-half-to-even), on exact integers.
 *
 * MASTER-SPEC §4 names it specifically. Half-up is biased: over a long bill it drifts
 * upward by half a paise per rounded line, always in the shop's favour, which is exactly
 * the pattern an auditor looks for. Half-to-even has no such bias.
 *
 * Handles negatives correctly even though the guards above make them unreachable today —
 * Phase 8 credit notes will not be, and a rounding helper that is only correct for
 * positives is a trap waiting for them.
 */
export function divideRoundHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new PricingError('Division by zero in pricing.');

  const negative = numerator < 0n !== denominator < 0n;
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDenominator = denominator < 0n ? -denominator : denominator;

  const quotient = absNumerator / absDenominator;
  const remainder = absNumerator % absDenominator;

  const twiceRemainder = remainder * 2n;

  let rounded = quotient;
  if (twiceRemainder > absDenominator) {
    rounded = quotient + 1n;
  } else if (twiceRemainder === absDenominator) {
    // Exactly half — go to the even neighbour.
    rounded = quotient % 2n === 0n ? quotient : quotient + 1n;
  }

  return negative ? -rounded : rounded;
}

// ── The formula (MASTER-SPEC §4) ───────────────────────────────────────────
//
//   metalValue   = ratePerGram × weightGrams
//   makingCharge = metalValue × (makingPct / 100)
//   subtotal     = metalValue + makingCharge + stoneCharge
//   gstAmount    = subtotal × (gstPct / 100)
//   lineTotal    = subtotal + gstAmount
//
// Carried at a scale of MG_PER_G × BP_PER_UNIT so nothing is rounded until the last step.

/** Scale at which the subtotal is exact: milligrams (10^3) × basis points (10^4). */
const SUBTOTAL_SCALE = MG_PER_G * BP_PER_UNIT;

export function calculateLine(input: LineInput, ratePerGram: bigint): LineResult {
  assertValidLine(input);

  if (typeof ratePerGram !== 'bigint') {
    throw new PricingError('ratePerGram must be a bigint of paise per gram.');
  }
  if (ratePerGram < 0n) {
    throw new PricingError(`ratePerGram must not be negative (received ${ratePerGram}).`);
  }

  const weightMg = BigInt(input.weightMg);
  const makingBp = toBasisPoints(input.makingPct, 'makingPct');
  const gstBp = toBasisPoints(input.gstPct, 'gstPct');

  // metalValue × 10^3 — exact.
  const metalValueScaledByMg = ratePerGram * weightMg;

  // Everything below is × SUBTOTAL_SCALE (10^7) and still exact.
  const metalValueScaled = metalValueScaledByMg * BP_PER_UNIT;
  const makingChargeScaled = metalValueScaledByMg * makingBp;
  const stoneChargeScaled = input.stoneCharge * SUBTOTAL_SCALE;

  const subtotalScaled = metalValueScaled + makingChargeScaled + stoneChargeScaled;

  // gstAmount × 10^11, and therefore lineTotal × 10^11. Still exact.
  const gstScaled = subtotalScaled * gstBp;
  const lineTotalScaled = subtotalScaled * BP_PER_UNIT + gstScaled;

  /**
   * THE one rounding. §5.1: "Round once, at lineTotal ... Never round intermediates —
   * that is the source of ₹1 mismatches between the on-screen total and the printed bill."
   */
  const lineTotal = divideRoundHalfEven(lineTotalScaled, SUBTOTAL_SCALE * BP_PER_UNIT);

  /**
   * The breakdown §5.4 puts on screen is `metal → making → stones → GST → total`, so those
   * five numbers must visibly add up. They are derived rather than independently rounded:
   *
   *   metalValue, makingCharge — rounded for display
   *   subtotal                 — their sum plus the exact stone charge, so the first three
   *                              lines always reconcile
   *   gstAmount                — lineTotal − subtotal, so the last two always reconcile
   *
   * `gstAmount` therefore absorbs at most a paise of display rounding. A test asserts it
   * never drifts further than that from the exact GST, so the plug cannot grow unnoticed.
   * The number the customer pays, `lineTotal`, is rounded from exact arithmetic and is
   * unaffected by any of this.
   */
  const metalValue = divideRoundHalfEven(metalValueScaledByMg, MG_PER_G);
  const makingCharge = divideRoundHalfEven(
    metalValueScaledByMg * makingBp,
    SUBTOTAL_SCALE,
  );
  const subtotal = metalValue + makingCharge + input.stoneCharge;
  const gstAmount = lineTotal - subtotal;

  return {
    metalValue,
    makingCharge,
    stoneCharge: input.stoneCharge,
    subtotal,
    gstAmount,
    lineTotal,
  };
}

export function calculateTotal(lines: LineInput[], rates: RatesByPurity): TotalResult {
  const results = lines.map((line) => {
    const ratePerGram = rates[line.purity];
    if (ratePerGram === undefined) {
      throw new PricingError(`No rate available for ${line.purity}.`);
    }
    return calculateLine(line, ratePerGram);
  });

  /**
   * §5.1: "grandTotal = sum of rounded lineTotals, so the bill's line items visibly add up
   * to its total. A total that doesn't equal the sum of its lines destroys trust
   * instantly."
   *
   * So this sums the ROUNDED line totals rather than re-rounding an exact grand total.
   * The two differ by a paise or two on a long bill, and the version a customer can check
   * with a calculator wins.
   */
  return {
    lines: results,
    subtotal: results.reduce((sum, line) => sum + line.subtotal, 0n),
    totalGst: results.reduce((sum, line) => sum + line.gstAmount, 0n),
    grandTotal: results.reduce((sum, line) => sum + line.lineTotal, 0n),
  };
}

// ── Conversions used by the UI ─────────────────────────────────────────────

/**
 * Grams as typed by a human → integer milligrams.
 *
 * Parsed from the string rather than multiplied as a float: `2.345 * 1000` is
 * 2344.9999999999995 in IEEE-754, and `Math.round` hides that today but not for every
 * value. Working on the decimal text keeps three places exact by construction.
 */
export function gramsToMilligrams(grams: string | number): number {
  const text = typeof grams === 'number' ? String(grams) : grams.trim();

  if (!/^\d*\.?\d*$/.test(text) || text === '' || text === '.') {
    throw new PricingError(`"${grams}" is not a valid weight in grams.`);
  }

  const [whole = '0', fraction = ''] = text.split('.');
  if (fraction.length > 3) {
    throw new PricingError('Weight is precise to 3 decimal places (1 milligram).');
  }

  const milligrams = Number(whole) * 1000 + Number(fraction.padEnd(3, '0') || '0');
  if (!Number.isSafeInteger(milligrams)) {
    throw new PricingError(`"${grams}" is out of range.`);
  }
  return milligrams;
}

/** Rupees as typed by a human → integer paise. Same reasoning as above. */
export function rupeesToPaise(rupees: string | number): bigint {
  const text = typeof rupees === 'number' ? String(rupees) : rupees.trim();

  if (!/^\d*\.?\d*$/.test(text) || text === '' || text === '.') {
    throw new PricingError(`"${rupees}" is not a valid amount in rupees.`);
  }

  const [whole = '0', fraction = ''] = text.split('.');
  if (fraction.length > 2) {
    throw new PricingError('Amounts are precise to 2 decimal places (1 paise).');
  }

  return BigInt(whole || '0') * 100n + BigInt(fraction.padEnd(2, '0') || '0');
}
