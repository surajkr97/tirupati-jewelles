/**
 * Order claim on verified phone ownership.
 * Created by Phase 3 (specs/03-auth.md §3.5).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THIS IS THE ONLY CODE PATH PERMITTED TO SET `userId` ON AN ORDER.
 *
 *  §3.5: "This is the only code path that may set userId on an order."
 *  MASTER-SPEC §5: "The claim runs only after successful OTP verification of that exact
 *  number. Never on an unverified phone field. This is the difference between a feature
 *  and an account-takeover vector."
 *
 *  If you are adding a profile-update endpoint, an admin "assign order" action, or any
 *  other way to write Order.userId — don't. Route it through here, behind a verified OTP,
 *  or you have built a way to read other people's purchase history.
 *
 *  ── IT HAS EXACTLY ONE CALLER, AND THAT IS THE POINT ──
 *  `POST /api/auth/claim`, behind a claim token delivered TO the number inside the §8.4
 *  WhatsApp bill message (Phase 9, DEBT-011 closed). That token is the possession proof
 *  this function spent three phases waiting for.
 *
 *  `/api/auth/phone/verify` still does NOT call it and still leaves `phoneVerified` false:
 *  the code it checks goes to the account's EMAIL, which proves account ownership, not
 *  phone ownership. That distinction is the whole security model here — see D-011.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import type { Prisma } from '@prisma/client';

import { db } from '@/lib/db';

export interface ClaimResult {
  /** How many previously unclaimed orders attached to this account. */
  claimed: number;
}

/**
 * Thrown when a DIFFERENT account has already proven this number.
 * Added by Phase 9 (DEBT-011), when the claim finally got a caller.
 *
 * `User.phone` is unique, so two accounts cannot both hold one number. An unverified holder
 * is detached — possession beats an assertion nobody checked. A VERIFIED holder is not: two
 * people cannot both have proven the same number, so the first proof stands and this needs a
 * human. The realistic cause is a recycled SIM, and silently moving a stranger's purchase
 * history to whoever holds the number today is exactly the account-takeover MASTER-SPEC §5
 * warns about.
 */
export class PhoneAlreadyVerifiedError extends Error {
  constructor() {
    super('That number is already verified on another account.');
    this.name = 'PhoneAlreadyVerifiedError';
  }
}

/**
 * Attach the caller's account to every unclaimed order billed to `phone`.
 *
 * Must only be invoked immediately after possession of the number has been proven — a
 * `verifyOtp` for purpose CLAIM_ORDER, or the Phase 9 claim token, which is delivered to the
 * number inside the §8.4 WhatsApp message.
 *
 * @param userId  the account proven to control the number
 * @param phone   E.164, already normalised by lib/auth/identifier.ts
 * @param client  a transaction client, when the caller needs the proof and the claim to
 *                commit together. `POST /api/auth/claim` does: a token consumed by a claim
 *                that then failed would be spent for nothing, and the customer's only copy
 *                of it is a WhatsApp message they cannot re-trigger.
 */
export async function claimOrdersForVerifiedPhone(
  userId: string,
  phone: string,
  client?: Prisma.TransactionClient,
): Promise<ClaimResult> {
  // Already inside a transaction: run on it. Otherwise open one — the steps below are a
  // single unit either way.
  return client ? run(client) : db.$transaction(run);

  async function run(tx: Prisma.TransactionClient): Promise<ClaimResult> {
    /**
     * Resolve the unique constraint on `User.phone` before writing it.
     *
     * Added by Phase 9 with the first real caller. Until then nothing set `phoneVerified`,
     * so the collision could not arise; now a customer whose number is sitting unverified on
     * an abandoned signup would have hit a raw Prisma P2002 and seen "something went wrong"
     * at the last step of the flagship flow.
     */
    const incumbent = await tx.user.findUnique({
      where: { phone },
      select: { id: true, phoneVerified: true },
    });

    if (incumbent && incumbent.id !== userId) {
      if (incumbent.phoneVerified) throw new PhoneAlreadyVerifiedError();

      // Unverified: nobody ever proved it. Detach, so the proven holder can take it.
      await tx.user.update({
        where: { id: incumbent.id },
        data: { phone: null },
      });
    }

    // Marking the phone verified and claiming the orders must be one unit: a crash between
    // them would leave a verified number whose orders never attached.
    await tx.user.update({
      where: { id: userId },
      data: { phone, phoneVerified: true },
    });

    const claimed = await tx.order.updateMany({
      // `userId: null` is what makes this safe to re-run and what stops it stealing an
      // order already claimed by someone else who verified the same number earlier.
      where: { customerPhone: phone, userId: null },
      data: { userId },
    });

    await tx.auditLog.create({
      data: {
        actorId: userId,
        action: 'ORDER_CLAIM',
        entity: 'Order',
        entityId: phone,
        after: { count: claimed.count },
      },
    });

    return { claimed: claimed.count };
  }
}

/**
 * How many orders *would* be claimed. Read-only.
 *
 * Used after verification to phrase the confirmation — §3.5 wants the UI to be able to say
 * "We found 3 past purchases linked to this number."
 */
export async function countClaimableOrders(phone: string): Promise<number> {
  return db.order.count({ where: { customerPhone: phone, userId: null } });
}
