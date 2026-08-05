/**
 * Zod schemas for calculator input.
 * Created by Phase 5 (specs/05-calculator.md §5.3, §5.5).
 *
 * Two boundaries use these, and both are untrusted:
 *
 *   sessionStorage — the user can edit it in devtools, and a stale shape survives a deploy
 *   POST /api/calculator/share — plain public input
 *
 * §5 TEST: "'abc' in a numeric field → rejected at the Zod boundary." SECURITY, every
 * phase: "Reject, don't coerce."
 *
 * Note what is NOT here: no total, no subtotal, no grand total. §5 is explicit that "a
 * client-submitted total is display-only and is discarded on arrival", and the surest way
 * to discard something is to have no field for it. `.strict()` makes an attempt to send
 * one a 400 rather than a silently ignored key.
 */
import { z } from 'zod';

import { MAX_ITEMS } from '@/lib/calculator/reducer';
import { gramsToMilligrams, PURITIES, rupeesToPaise } from '@/lib/pricing';

/** Text that parses as grams with at most 3 decimals, or is empty. */
const weightField = z
  .string()
  .max(20)
  .refine((v) => v.trim() === '' || safely(() => gramsToMilligrams(v)), {
    message: 'Weight must be a number of grams with up to 3 decimal places.',
  });

/** Text that parses as rupees with at most 2 decimals, or is empty. */
const rupeesField = z
  .string()
  .max(20)
  .refine((v) => v.trim() === '' || safely(() => rupeesToPaise(v)), {
    message: 'Amount must be a number of rupees with up to 2 decimal places.',
  });

/** Text that parses as a 0–100 percentage with at most 2 decimals, or is empty. */
const percentField = z
  .string()
  .max(10)
  .refine(
    (v) => {
      const trimmed = v.trim();
      if (trimmed === '') return true;
      if (!/^\d*\.?\d{0,2}$/.test(trimmed) || trimmed === '.') return false;
      const value = Number(trimmed);
      return Number.isFinite(value) && value >= 0 && value <= 100;
    },
    { message: 'Must be a percentage between 0 and 100.' },
  );

export const calculatorItemSchema = z
  .object({
    id: z.string().min(1).max(64),
    label: z.string().max(80),
    metal: z.enum(['GOLD', 'SILVER']),
    purity: z.enum(PURITIES),
    weightGrams: weightField,
    makingPct: percentField,
    stoneCharge: rupeesField,
    gstPct: percentField,
  })
  // Unknown keys are an error, not something to quietly drop — a `grandTotal` arriving
  // from a client is a tampering attempt worth a 400, not a shrug.
  .strict();

export const calculatorItemsSchema = z
  .array(calculatorItemSchema)
  .min(1, 'Add at least one item.')
  .max(MAX_ITEMS, `You can price ${MAX_ITEMS} items at once.`);

/** `POST /api/calculator/share` (§5.5). Items only — no totals, by construction. */
export const shareRequestSchema = z.object({ items: calculatorItemsSchema }).strict();

export type ShareRequest = z.infer<typeof shareRequestSchema>;

function safely(run: () => unknown): boolean {
  try {
    run();
    return true;
  } catch {
    return false;
  }
}
