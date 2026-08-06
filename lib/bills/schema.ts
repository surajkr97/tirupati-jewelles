/**
 * Zod schemas for bill creation.
 * Created by Phase 8 (specs/08-billing-whatsapp.md §8.2).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THERE IS NO TOTAL FIELD, AND THAT IS THE POINT.
 *
 *  §8.2: "**Recompute every line server-side.** The client's totals arrive but are
 *  discarded. This is not optional — it is the difference between a bill and a suggestion."
 *
 *  The surest way to discard a client total is to have nowhere to put one. `.strict()`
 *  turns an attempt to send `grandTotal`, `ratePerGram` or `orderNo` into a 400 rather than
 *  a silently ignored key — the same shape Phase 5 used for the share endpoint, for the
 *  same reason.
 *
 *  Rates are likewise absent. MASTER-SPEC's price-tampering control is "Client never sends
 *  a rate. Server reads rate from DB at request time and recomputes every total."
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { z } from 'zod';

import { MAX_ITEMS } from '@/lib/calculator/reducer';
import { gramsToMilligrams, PURITIES, rupeesToPaise } from '@/lib/pricing';

function safely(run: () => unknown): boolean {
  try {
    run();
    return true;
  } catch {
    return false;
  }
}

/**
 * Grams with at most 3 decimals. Unlike the calculator's, a bill line must have a weight.
 *
 * ── Both refinements have to tolerate unparseable input ──
 * Zod runs EVERY refinement on a value, including the ones after a failure. So a second
 * check that assumes the first one passed will be handed `"abc"` anyway — and
 * `gramsToMilligrams` throws on it, which escapes `safeParse` entirely and turns a 400 into
 * a 500. Found by the route test for malformed input, which is what that case is for.
 *
 * The second refinement therefore defers rather than asserting: if the value does not
 * parse, it is not this rule's business, and the first message is the one the admin sees.
 */
const weightField = z
  .string()
  .min(1, 'Enter a weight in grams.')
  .max(20)
  .refine((v) => safely(() => gramsToMilligrams(v)), {
    message: 'Weight must be a number of grams with up to 3 decimal places.',
  })
  .refine((v) => !safely(() => gramsToMilligrams(v)) || gramsToMilligrams(v) > 0, {
    message: 'A billed item must weigh something.',
  });

const rupeesField = z
  .string()
  .max(20)
  .refine((v) => v.trim() === '' || safely(() => rupeesToPaise(v)), {
    message: 'Amount must be a number of rupees with up to 2 decimal places.',
  });

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

/**
 * One billed piece.
 *
 * `productId` is optional because most in-shop sales are not catalogue items — §8.1's "Load
 * from product" is a shortcut, not a requirement. When present it is recorded so the admin
 * views can join back (Phase 7 TEST established that this link, not the snapshot, is what a
 * hard delete would destroy).
 */
export const billItemSchema = z
  .object({
    id: z.string().min(1).max(64),
    productId: z.string().uuid().nullish(),
    label: z.string().max(80),
    metal: z.enum(['GOLD', 'SILVER']),
    purity: z.enum(PURITIES),
    weightGrams: weightField,
    makingPct: percentField,
    stoneCharge: rupeesField,
    gstPct: percentField,
    /** §8.3: "Hallmark / HUID / BIS numbers per item where present." */
    hallmarkNo: z.string().max(40).default(''),
    bisCertNo: z.string().max(40).default(''),
  })
  .strict();

export type BillItemInput = z.infer<typeof billItemSchema>;

export const createBillSchema = z
  .object({
    customerName: z.string().max(120).default(''),
    /**
     * Validated for shape here and normalised to E.164 in the handler.
     *
     * Phase 3 left this exact instruction: "Phase 8 must call `normalisePhone()` on
     * `customerPhone` before writing a bill. A bill stored as `9876543210` will never be
     * claimed by a customer who verifies `+919876543210`."
     */
    customerPhone: z.string().min(1, 'Enter the customer’s mobile number.').max(24),
    note: z.string().max(500).default(''),
    items: z
      .array(billItemSchema)
      .min(1, 'Add at least one item.')
      .max(MAX_ITEMS, `A bill can carry ${MAX_ITEMS} items.`),
  })
  .strict();

export type CreateBillRequest = z.infer<typeof createBillSchema>;

/**
 * §8.2: "accept an `Idempotency-Key` header".
 *
 * Bounded and character-restricted because it becomes a unique index value. A client that
 * omits it gets no protection, which is the honest behaviour — inventing a key from the
 * body would make two genuinely identical bills (the same ring, sold twice) impossible.
 */
export const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/, 'Idempotency-Key must be url-safe.');
