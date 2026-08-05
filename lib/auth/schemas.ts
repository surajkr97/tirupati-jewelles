/**
 * Zod schemas for every auth route boundary.
 * Created by Phase 3 (specs/03-auth.md §3.4) — "all Zod-validated".
 *
 * SECURITY, every phase: "Reject, don't coerce." Nothing here uses `.coerce`, `.catch()`
 * or `.default()` on a security-relevant field — a malformed identifier must be a 400, not
 * a silently-substituted value.
 */
import { z } from 'zod';

import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/lib/auth/password-policy';
import { OTP_LENGTH } from '@/lib/auth/otp';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address.')
  .max(255);

/**
 * Raw phone input. Normalisation to E.164 happens in the handler via
 * `normalisePhone()` — Zod only bounds the shape so a 10MB string cannot reach the parser.
 */
export const phoneInputSchema = z
  .string()
  .trim()
  .min(6, 'Enter a valid mobile number.')
  .max(20, 'Enter a valid mobile number.');

export const otpCodeSchema = z
  .string()
  .trim()
  .regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), `Enter the ${OTP_LENGTH}-digit code.`);

/**
 * Password *length* only.
 *
 * Guessability is checked separately by `checkPassword`, because that check returns a
 * human-readable reason ("that password is too common") that a Zod message cannot express
 * as well — and because it must not run on the login path, only on set/reset.
 */
export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
  .max(MAX_PASSWORD_LENGTH, `Use at most ${MAX_PASSWORD_LENGTH} characters.`);

export const nameSchema = z.string().trim().min(1, 'Enter your name.').max(120);

/** One field, either shape — §3.7's single identifier input. */
export const identifierSchema = z.string().trim().min(3).max(255);

// ── Signup ─────────────────────────────────────────────────────────────────

export const signupStartSchema = z.object({ email: emailSchema });

export const signupVerifySchema = z.object({
  email: emailSchema,
  code: otpCodeSchema,
});

export const signupCompleteSchema = z.object({
  email: emailSchema,
  code: otpCodeSchema,
  password: passwordSchema,
  name: nameSchema,
});

// ── Login ──────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  identifier: identifierSchema,
  // Deliberately NOT `passwordSchema`: applying a minimum length here would reject a short
  // guess with a different error than a wrong one, which is an enumeration signal about
  // password policy. Login accepts any non-empty string and fails uniformly.
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

// ── Phone verification (authed) ────────────────────────────────────────────

export const phoneStartSchema = z.object({ phone: phoneInputSchema });

export const phoneVerifySchema = z.object({
  phone: phoneInputSchema,
  code: otpCodeSchema,
});

// ── Password reset ─────────────────────────────────────────────────────────

export const passwordForgotSchema = z.object({ identifier: identifierSchema });

export const passwordResetSchema = z.object({
  identifier: identifierSchema,
  code: otpCodeSchema,
  password: passwordSchema,
});
