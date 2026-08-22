/**
 * Rate mutations.
 * Created by Phase 7 (specs/07-admin-panel.md §7.3).
 *
 * The engine is Phase 4's `setRate` / `setGoldRates` — the fat-finger guard, the
 * append-only history and the AuditLog entries all live there and are reused unchanged.
 * This adds only the admin-facing shape: input in the display unit, and a result the form
 * can turn into a confirmation step.
 */
'use server';

import { Metal, Purity } from '@prisma/client';
import { z } from 'zod';

import { adminAction, type ActionResult } from '@/lib/admin/actions';
import { per10gToPerGram, perKgToPerGram, setGoldRates, setRate } from '@/lib/rates';

/**
 * §7.3: "Inline edit in the **display unit** (₹/10g, ₹/kg)."
 *
 * ── One target per FIELD, not per stored purity ──
 * The screen has two inputs and the table has three rows, and that is deliberate: 916 and
 * 750 are the same market number times a fineness, so asking for both invites a pair that
 * do not describe the same metal. `GOLD_24K` is the number the shop actually reads off the
 * board every morning; `lib/gold-purity.ts` turns it into the two rows that get stored.
 *
 * `POST /api/admin/rates` keeps the per-purity shape. It is the machine-facing route — a
 * feed that already knows a 916 rate should not have to invent a 24K one to set it.
 */
const schema = z.object({
  target: z.enum(['GOLD_24K', 'SILVER_999']),
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

    const { target, displayRupees, confirmed } = parsed.data;

    // Rupees → paise → per-gram. Rounded once, here, before it becomes an integer.
    const displayPaise = BigInt(Math.round(displayRupees * 100));
    const perGram =
      target === 'GOLD_24K'
        ? per10gToPerGram(displayPaise)
        : perKgToPerGram(displayPaise);

    if (perGram <= 0n) {
      return {
        ok: false,
        error: 'That rate is too small to store.',
        field: 'displayRupees',
      };
    }

    const result =
      target === 'GOLD_24K'
        ? await setGoldRates({ purePerGram: perGram, userId: admin.id, ip, confirmed })
        : await setRate({
            metal: Metal.SILVER,
            purity: Purity.SILVER_999,
            ratePerGram: perGram,
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
       * "are you sure?" is a button people learn to click. The previous value is returned in
       * the unit the admin typed in — a 24K figure for gold, per kg for silver — because a
       * dialog naming a per-gram number they never see is a dialog they cannot check.
       */
      const previousPerGram =
        'previousPure' in result ? result.previousPure : result.previous;

      return {
        ok: false,
        error: 'That is a large change.',
        needsConfirmation: {
          previousDisplay: (
            previousPerGram * (target === 'GOLD_24K' ? 10n : 1000n)
          ).toString(),
          changePct: Number((result.changePct * 100).toFixed(2)),
        },
      } as SetRateActionResult;
    }

    // `setRate`/`setGoldRates` already wrote the AuditLog, busted the Redis key and
    // revalidated every rate surface. Nothing to add here — duplicating the audit entry
    // would double-count it.
    const ratePerGram = 'purePerGram' in result ? result.purePerGram : result.ratePerGram;
    return { ok: true, data: { ratePerGram: ratePerGram.toString() } };
  });
}
