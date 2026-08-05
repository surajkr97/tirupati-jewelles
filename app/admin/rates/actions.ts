/**
 * Rate mutations.
 * Created by Phase 7 (specs/07-admin-panel.md §7.3).
 *
 * The engine is Phase 4's `setRate` — the fat-finger guard, the append-only history and the
 * AuditLog entry all live there and are reused unchanged. This adds only the admin-facing
 * shape: input in the display unit, and a result the form can turn into a confirmation
 * step.
 */
'use server';

import { Metal, Purity } from '@prisma/client';
import { z } from 'zod';

import { adminAction, type ActionResult } from '@/lib/admin/actions';
import { fromDisplayUnit, isValidCombination, setRate } from '@/lib/rates';

/**
 * §7.3: "Inline edit in the **display unit** (₹/10g, ₹/kg)."
 *
 * The same schema shape as `POST /api/admin/rates`, deliberately — one conversion rule, in
 * `fromDisplayUnit`, and MASTER-SPEC §4 is explicit that admin input is the only place a
 * unit conversion happens.
 */
const schema = z.object({
  metal: z.enum(['GOLD', 'SILVER']),
  purity: z.enum(['K22_916', 'K18_750', 'SILVER_999']),
  displayRupees: z.number().positive().max(100_000_000),
  confirmed: z.boolean().optional(),
});

export type SetRateActionResult = ActionResult<{ ratePerGram: string }> & {
  /** Set when the change tripped the >20% guard and needs a second confirmation (§7.3). */
  needsConfirmation?: { previousDisplay: string; changePct: number };
};

export async function updateRate(input: unknown): Promise<SetRateActionResult> {
  return adminAction(async ({ admin, ip }) => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: 'Enter a rate in rupees.', field: 'displayRupees' };
    }

    const { metal, purity, displayRupees, confirmed } = parsed.data;

    if (!isValidCombination(metal as Metal, purity as Purity)) {
      return { ok: false, error: `${purity} is not a valid purity for ${metal}.` };
    }

    // Rupees → paise → per-gram. Rounded once, here, before it becomes an integer.
    const ratePerGram = fromDisplayUnit(
      metal as Metal,
      BigInt(Math.round(displayRupees * 100)),
    );

    if (ratePerGram <= 0n) {
      return {
        ok: false,
        error: 'That rate is too small to store.',
        field: 'displayRupees',
      };
    }

    const result = await setRate({
      metal: metal as Metal,
      purity: purity as Purity,
      ratePerGram,
      userId: admin.id,
      ip,
      confirmed,
    });

    if (!result.ok) {
      /**
       * §7.3: ">20% change requires a confirmation step naming the old and new values.
       * This is the single most damaging typo available; make it hard to make."
       *
       * Both figures come back so the dialog can name them. A confirmation that just says
       * "are you sure?" is a button people learn to click.
       */
      return {
        ok: false,
        error: 'That is a large change.',
        needsConfirmation: {
          previousDisplay: ((metal as Metal) === Metal.GOLD
            ? result.previous * 10n
            : result.previous * 1000n
          ).toString(),
          changePct: Number((result.changePct * 100).toFixed(2)),
        },
      } as SetRateActionResult;
    }

    // `setRate` already wrote the AuditLog, busted the Redis key and revalidated every rate
    // surface. Nothing to add here — duplicating the audit entry would double-count it.
    return { ok: true, data: { ratePerGram: result.ratePerGram.toString() } };
  });
}
