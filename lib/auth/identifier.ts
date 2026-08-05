/**
 * Identifier normalisation — phone and email.
 * Created by Phase 3 (specs/03-auth.md §3.4).
 *
 * §3.4: "Normalise phone to E.164 (+91XXXXXXXXXX) BEFORE any lookup or write. A number
 * stored two ways is a duplicate account and a broken order claim."
 *
 * That warning is the whole reason this module exists. The Phase 8 order claim matches on
 * `customerPhone`, so if an admin bills `9876543210` and the customer verifies
 * `+91 98765 43210`, the claim silently finds nothing and the customer never sees their
 * purchase. Every read and every write goes through here.
 */
import { parsePhoneNumberWithError, type CountryCode } from 'libphonenumber-js';

/** The shop is in India; bare 10-digit numbers are assumed Indian. */
const DEFAULT_COUNTRY: CountryCode = 'IN';

export type IdentifierKind = 'phone' | 'email';

/**
 * Normalise a phone number to E.164, or return null if it is not a valid mobile number.
 *
 * Handles the shapes Indian customers actually type:
 *   9876543210 · +919876543210 · +91 98765 43210 · 09876543210 · 91 98765 43210
 */
export function normalisePhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // A bare "0" trunk prefix is how Indian numbers are written domestically, but E.164 has
  // no notion of it and libphonenumber only strips it when a country is supplied.
  const candidate = trimmed.replace(/[\s()-]/g, '');

  try {
    const parsed = parsePhoneNumberWithError(candidate, DEFAULT_COUNTRY);
    if (!parsed.isValid()) return null;

    /**
     * Must be a mobile. OTP delivery and the Phase 8 WhatsApp handoff both need one.
     *
     * `getType()` cannot be used: libphonenumber's compact metadata bundle carries no
     * number-type data, so it returns `undefined` for every Indian number — verified, not
     * assumed. And `isValid()` alone is too permissive here: it accepts `1234567890` and
     * `5876543210`, neither of which is an assigned Indian mobile range.
     *
     * So the rule is applied explicitly. Indian mobile numbers are exactly 10 digits
     * beginning 6, 7, 8 or 9. A number that fails this could never receive an OTP, and
     * an account created against one is permanently unverifiable.
     */
    if (parsed.country === 'IN' && !/^[6-9]\d{9}$/.test(parsed.nationalNumber)) {
      return null;
    }

    return parsed.number; // E.164, e.g. +919876543210
  } catch {
    return null;
  }
}

/** Lowercase and trim. §3.4 — applied before every lookup and every write. */
export function normaliseEmail(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * Decide whether a single login field holds a phone or an email.
 *
 * §3.7 asks for "one form, one field, detected by shape". An `@` is unambiguous — no valid
 * phone number contains one, and every email must.
 */
export function detectIdentifierKind(input: string): IdentifierKind {
  return input.includes('@') ? 'email' : 'phone';
}

export type NormalisedIdentifier =
  | { kind: 'email'; value: string }
  | { kind: 'phone'; value: string }
  | { kind: 'invalid'; value: null };

/** Normalise a login identifier of either shape. */
export function normaliseIdentifier(input: string): NormalisedIdentifier {
  if (detectIdentifierKind(input) === 'email') {
    const email = normaliseEmail(input);
    // Deliberately permissive: Zod validates the format at the route boundary. This only
    // decides which column to look in.
    return email.includes('@') && email.includes('.')
      ? { kind: 'email', value: email }
      : { kind: 'invalid', value: null };
  }

  const phone = normalisePhone(input);
  return phone ? { kind: 'phone', value: phone } : { kind: 'invalid', value: null };
}
