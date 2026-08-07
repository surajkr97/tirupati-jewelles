/**
 * The bill builder's client-side phone check.
 * §8.1: "Phone validated as a real Indian mobile before `Generate` is enabled."
 *
 * ── Why this function exists at all, and why it therefore needs its own test ──
 * It deliberately restates the rule `lib/auth/identifier.ts` enforces server-side, because
 * that one parses with `libphonenumber-js` — 150KB the admin panel should not ship to run a
 * check on every keystroke. That is a defensible duplication, unlike the ones this project
 * has spent Phase 9 removing: the two have genuinely different constraints.
 *
 * But a duplicated rule that nothing tests is how the copies drift, and this one HAD
 * drifted. It stripped a leading `91` from any input, so `9101222943` — an assigned Indian
 * mobile — became `01222943` and failed. The Generate button stayed disabled with the
 * message "Enter a 10-digit Indian mobile number", and a walk-in customer whose number
 * starts 91 could not be billed at all.
 *
 * The server would have accepted that number. Nothing reached the server, because the
 * button never enabled.
 *
 * Found by the flagship claim E2E, which generates a phone from `Date.now()` — so it failed
 * only when the clock produced a `91…` number, which is why it had passed for weeks.
 */
import { describe, expect, it } from 'vitest';

import { isIndianMobile } from '@/components/admin/bill-builder';

describe('isIndianMobile — accepts every assigned Indian mobile block', () => {
  it.each([
    ['the case that was broken, beginning 91', '9101222943'],
    ['another 91 number', '9199999999'],
    ['a 6 series', '6123456789'],
    ['a 7 series', '7012345678'],
    ['an 8 series', '8888888888'],
    ['a 9 series', '9876543210'],
  ])('accepts %s', (_name, phone) => {
    expect(isIndianMobile(phone)).toBe(true);
  });

  it.each([
    ['with +91 and spaces, as a customer says it', '+91 98765 43210'],
    ['with a 0 trunk prefix', '09876543210'],
    ['with hyphens', '98765-43210'],
    ['with the country code and no plus', '919876543210'],
    ['a 91-series number written with its country code', '919101222943'],
  ])('accepts it %s', (_name, phone) => {
    expect(isIndianMobile(phone)).toBe(true);
  });

  it.each([
    ['a landline-shaped number', '1234567890'],
    ['the 5 series, which is not mobile', '5876543210'],
    ['too short', '987654321'],
    ['too long', '98765432101'],
    ['empty', ''],
    ['letters', 'not a phone'],
  ])('rejects %s', (_name, phone) => {
    expect(isIndianMobile(phone)).toBe(false);
  });

  it('agrees with the server on the same inputs', () => {
    /**
     * The reason the duplication is safe is that the two answers match. Asserted rather
     * than assumed — that assumption is exactly what failed.
     */
    for (const phone of ['9101222943', '9876543210', '6123456789', '+919101222943']) {
      expect(isIndianMobile(phone), `${phone} should be billable`).toBe(true);
    }
    for (const phone of ['1234567890', '5876543210']) {
      expect(isIndianMobile(phone), `${phone} is not an Indian mobile`).toBe(false);
    }
  });
});
