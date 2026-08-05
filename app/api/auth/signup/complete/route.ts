/**
 * POST /api/auth/signup/complete — burn the code, create the account, sign in.
 * Created by Phase 3 (specs/03-auth.md §3.4).
 */
import { Role } from '@prisma/client';

import { hashPassword } from '@/lib/auth/argon2';
import { PUBLIC_USER_SELECT } from '@/lib/auth/guard';
import { OtpPurpose, verifyOtp } from '@/lib/auth/otp';
import { checkPassword } from '@/lib/auth/password-policy';
import { signupCompleteSchema } from '@/lib/auth/schemas';
import { createSession } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { errorJson, json, parseBody, requireSameOrigin, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  // CSRF: reject a cross-origin state change (Phase 7 §7 SECURITY).
  const crossOrigin = await requireSameOrigin();
  if (crossOrigin) return crossOrigin;

  const parsed = await parseBody(request, signupCompleteSchema);
  if (!parsed.ok) return parsed.response;

  const { email, code, password, name } = parsed.data;

  // Guessability is checked here, not in Zod — the reason is user-facing prose.
  const policy = checkPassword(password);
  if (!policy.ok) {
    return errorJson('Check the highlighted fields.', 400, {
      fields: { password: policy.reason },
    });
  }

  try {
    // Consumed for real this time. Everything after this point runs at most once per code.
    const verified = await verifyOtp(email, OtpPurpose.SIGNUP, code);
    if (!verified.ok) {
      return errorJson('That code is not valid. Request a new one.', 400, {
        expired: true,
      });
    }

    const passwordHash = await hashPassword(password);

    /**
     * Upsert, not create.
     *
     * §3.4's flagship requirement is "signup by email, later add phone → ONE user record".
     * An abandoned signup can leave a row with no passwordHash; a plain `create` would
     * then throw a unique-constraint error on the second attempt and strand the customer.
     */
    const user = await db.user.upsert({
      where: { email },
      update: { passwordHash, name, emailVerified: true },
      create: {
        email,
        passwordHash,
        name,
        emailVerified: true,
        role: Role.CUSTOMER,
      },
      select: PUBLIC_USER_SELECT,
    });

    await createSession({ userId: user.id, role: user.role });

    return json({ user }, 201);
  } catch (err) {
    return serverError(err, 'signup/complete');
  }
}
