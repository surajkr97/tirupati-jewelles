/**
 * Calculator item shape and its conversion to the pricing engine's input.
 * Created by Phase 5 (specs/05-calculator.md §5.3).
 *
 * ── Why every numeric field is a string ──
 * These are form fields. While someone is typing "1.2" they pass through "1" and "1.",
 * neither of which is a number, and a state shape of `number` forces the component to
 * either reject those keystrokes or round-trip through NaN. Keeping the typed text and
 * converting at the boundary means the input never fights the user, and the conversion is
 * a single well-tested function (`toLineInput`) rather than scattered `parseFloat` calls.
 *
 * Nothing here touches money. Conversion to integer paise happens in `lib/pricing.ts`.
 */
import {
  DEFAULT_GST_PCT,
  gramsToMilligrams,
  PricingError,
  rupeesToPaise,
  type LineInput,
  type MetalKey,
  type PurityKey,
} from '@/lib/pricing';

export interface CalculatorItem {
  id: string;
  /** Optional; the UI shows `Item 1` as a placeholder when empty (§5.4). */
  label: string;
  metal: MetalKey;
  purity: PurityKey;
  /** Grams, as typed. Up to 3 decimals. */
  weightGrams: string;
  /** Per cent, as typed. */
  makingPct: string;
  /** Rupees, as typed. Optional in the UI, collapsed by default. */
  stoneCharge: string;
  /** Per cent, as typed. */
  gstPct: string;
}

/** The three choices the segmented control offers (§5.4). */
export const PURITY_OPTIONS = [
  { value: 'K22_916', label: '22K', metal: 'GOLD', unit: 'gold 916' },
  { value: 'K18_750', label: '18K', metal: 'GOLD', unit: 'gold 750' },
  { value: 'SILVER_999', label: 'Silver', metal: 'SILVER', unit: 'silver 999' },
] as const satisfies readonly {
  value: PurityKey;
  label: string;
  metal: MetalKey;
  unit: string;
}[];

/** §5.4: "quick-pick chips (8% · 10% · 12% · 15%)". */
export const MAKING_CHIPS = ['8', '10', '12', '15'] as const;

export function metalForPurity(purity: PurityKey): MetalKey {
  return purity === 'SILVER_999' ? 'SILVER' : 'GOLD';
}

export function emptyItem(id: string): CalculatorItem {
  return {
    id,
    label: '',
    metal: 'GOLD',
    purity: 'K22_916',
    weightGrams: '',
    // Pre-filled with the commonest of the §5.4 chips. An empty making field reads as
    // "free labour" and every shop charges something.
    makingPct: '12',
    stoneCharge: '',
    gstPct: String(DEFAULT_GST_PCT),
  };
}

export interface FieldErrors {
  weightGrams?: string;
  makingPct?: string;
  stoneCharge?: string;
  gstPct?: string;
}

export type ItemConversion =
  { ok: true; input: LineInput } | { ok: false; errors: FieldErrors };

/**
 * Convert one form item into engine input.
 *
 * An empty field is treated as zero rather than an error — a half-filled row is a row
 * someone is still working on, not a mistake, and the running total should simply not
 * count it yet. Text that is *present but not a number* is an error, because that is a
 * mistake.
 */
export function toLineInput(item: CalculatorItem): ItemConversion {
  const errors: FieldErrors = {};

  let weightMg = 0;
  let makingPct = 0;
  let stoneCharge = 0n;
  let gstPct = DEFAULT_GST_PCT;

  try {
    weightMg = item.weightGrams.trim() === '' ? 0 : gramsToMilligrams(item.weightGrams);
  } catch (err) {
    errors.weightGrams = messageFor(err, 'Enter a weight in grams.');
  }

  try {
    makingPct = item.makingPct.trim() === '' ? 0 : parsePercent(item.makingPct);
  } catch (err) {
    errors.makingPct = messageFor(err, 'Enter a making charge between 0 and 100.');
  }

  try {
    stoneCharge = item.stoneCharge.trim() === '' ? 0n : rupeesToPaise(item.stoneCharge);
  } catch (err) {
    errors.stoneCharge = messageFor(err, 'Enter an amount in rupees.');
  }

  try {
    gstPct = item.gstPct.trim() === '' ? DEFAULT_GST_PCT : parsePercent(item.gstPct);
  } catch (err) {
    errors.gstPct = messageFor(err, 'Enter a GST rate between 0 and 100.');
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    input: {
      // Derived from purity, never trusted from the item — the two cannot disagree.
      metal: metalForPurity(item.purity),
      purity: item.purity,
      weightMg,
      makingPct,
      stoneCharge,
      gstPct,
    },
  };
}

/** Percentages accept at most 2 decimals — the precision Prisma's `Decimal(5,2)` stores. */
function parsePercent(text: string): number {
  const trimmed = text.trim();

  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === '' || trimmed === '.') {
    throw new PricingError(`"${text}" is not a valid percentage.`);
  }

  const [, fraction = ''] = trimmed.split('.');
  if (fraction.length > 2) {
    throw new PricingError('Percentages are precise to 2 decimal places.');
  }

  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new PricingError('Percentages must be between 0 and 100.');
  }
  return value;
}

function messageFor(err: unknown, fallback: string): string {
  return err instanceof PricingError ? err.message : fallback;
}
