/**
 * Phase 3 TEST: "Unit: phone normalisation — 9876543210, +919876543210, +91 98765 43210,
 * 09876543210 all → +919876543210."
 *
 * Why this matters more than it looks: the Phase 8 order claim matches on an exact
 * `customerPhone` string. If an admin bills one format and the customer verifies another,
 * the claim finds nothing and the customer never sees their purchase — silently.
 */
import { describe, expect, it } from 'vitest';

import {
  detectIdentifierKind,
  normaliseEmail,
  normaliseIdentifier,
  normalisePhone,
} from '@/lib/auth/identifier';

describe('normalisePhone — the four shapes from the spec', () => {
  it.each([
    ['9876543210', 'bare 10 digits'],
    ['+919876543210', 'already E.164'],
    ['+91 98765 43210', 'spaced E.164'],
    ['09876543210', 'domestic trunk prefix'],
  ])('%s (%s) → +919876543210', (input) => {
    expect(normalisePhone(input)).toBe('+919876543210');
  });

  it.each([
    ['+91-98765-43210', 'hyphenated'],
    ['(+91) 98765 43210', 'parenthesised country code'],
    ['  9876543210  ', 'surrounding whitespace'],
    ['919876543210', 'country code, no plus'],
  ])('also handles %s (%s)', (input) => {
    expect(normalisePhone(input)).toBe('+919876543210');
  });

  it.each([
    ['', 'empty'],
    ['   ', 'whitespace only'],
    ['12345', 'too short'],
    ['abcdefghij', 'letters'],
    // Both of these pass libphonenumber's own isValid(), which is why the explicit
    // 6-9 prefix rule exists in normalisePhone rather than trusting the library alone.
    ['1234567890', 'starts with 1 — not an assigned Indian mobile range'],
    ['5876543210', 'starts with 5 — not an assigned Indian mobile range'],
    ['+1234', 'malformed'],
  ])('rejects %s (%s)', (input) => {
    expect(normalisePhone(input)).toBeNull();
  });

  it('is idempotent — normalising twice changes nothing', () => {
    const once = normalisePhone('9876543210');
    expect(once).not.toBeNull();
    expect(normalisePhone(once as string)).toBe(once);
  });

  it('maps every accepted spelling of one number onto a single string', () => {
    const spellings = [
      '9876543210',
      '+919876543210',
      '+91 98765 43210',
      '09876543210',
      '+91-98765-43210',
      '919876543210',
    ];
    const results = new Set(spellings.map(normalisePhone));

    // One entry means one stored value — which is what stops duplicate accounts and a
    // broken order claim.
    expect(results.size).toBe(1);
  });
});

describe('normaliseEmail', () => {
  it.each([
    ['  Customer@Example.COM  ', 'customer@example.com'],
    ['UPPER@EXAMPLE.COM', 'upper@example.com'],
  ])('%s → %s', (input, expected) => {
    expect(normaliseEmail(input)).toBe(expected);
  });
});

describe('detectIdentifierKind — one field, detected by shape', () => {
  it.each([
    ['customer@example.com', 'email'],
    ['9876543210', 'phone'],
    ['+919876543210', 'phone'],
  ])('%s is %s', (input, expected) => {
    expect(detectIdentifierKind(input)).toBe(expected);
  });
});

describe('normaliseIdentifier', () => {
  it('normalises an email branch', () => {
    expect(normaliseIdentifier(' Person@Example.com ')).toEqual({
      kind: 'email',
      value: 'person@example.com',
    });
  });

  it('normalises a phone branch to E.164', () => {
    expect(normaliseIdentifier('09876543210')).toEqual({
      kind: 'phone',
      value: '+919876543210',
    });
  });

  it.each(['not-an-email@', '12345', 'nonsense'])('marks %s invalid', (input) => {
    expect(normaliseIdentifier(input).kind).toBe('invalid');
  });
});
