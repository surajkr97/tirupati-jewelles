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
 *  ── CURRENTLY UNREACHABLE, ON PURPOSE ──
 *  SMS is not enabled (D-011), so nothing can presently prove possession of a phone
 *  number, and no caller invokes this. /api/auth/phone/verify authorises adding a number
 *  via an EMAIL code — which proves account ownership, not phone ownership — and so
 *  deliberately does NOT call this and leaves `phoneVerified` false.
 *
 *  The function is kept complete and tested so that whichever possession proof arrives
 *  first (SMS OTP, or the Phase 8 WhatsApp bill link, which is delivered TO the number)
 *  simply calls it. DEBT-011.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { db } from '@/lib/db';

export interface ClaimResult {
  /** How many previously unclaimed orders attached to this account. */
  claimed: number;
}

/**
 * Attach the caller's account to every unclaimed order billed to `phone`.
 *
 * Must only be invoked immediately after `verifyOtp` returned ok for this exact number
 * with purpose CLAIM_ORDER, SIGNUP or LOGIN.
 *
 * @param userId  the account proven to control the number
 * @param phone   E.164, already normalised by lib/auth/identifier.ts
 */
export async function claimOrdersForVerifiedPhone(
  userId: string,
  phone: string,
): Promise<ClaimResult> {
  return db.$transaction(async (tx) => {
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
  });
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
