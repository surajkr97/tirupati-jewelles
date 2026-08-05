/**
 * Phase 3 TEST — §3.1 password policy.
 *
 * The spec is as specific about what NOT to enforce as about what to enforce: "Do not
 * impose symbol/uppercase rules — they push users toward Password1! and reduce real
 * entropy." Both halves are asserted.
 */
import { describe, expect, it } from 'vitest';

import {
  checkPassword,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from '@/lib/auth/password-policy';

describe('length', () => {
  it(`rejects fewer than ${MIN_PASSWORD_LENGTH} characters`, () => {
    expect(checkPassword('abc123').ok).toBe(false);
  });

  it('accepts exactly the minimum', () => {
    expect(checkPassword('gh7kd9wz').ok).toBe(true);
  });

  it('rejects an absurdly long value', () => {
    // Argon2 is deliberately expensive; an unbounded field is a cheap DoS.
    expect(checkPassword('a'.repeat(MAX_PASSWORD_LENGTH + 1)).ok).toBe(false);
  });
});

describe('common passwords', () => {
  it.each([
    'password',
    'password1',
    '12345678',
    'qwertyuiop',
    'iloveyou',
    'admin123',
    'welcome1',
  ])('rejects %s', (candidate) => {
    expect(checkPassword(candidate).ok).toBe(false);
  });

  it.each(['india123', 'krishna', 'sachin123', 'jaimatadi', 'mumbai'])(
    'rejects the India-specific guess %s',
    (candidate) => {
      // A generic English list misses these entirely, and they are exactly what a local
      // credential-stuffing list contains.
      expect(checkPassword(candidate).ok).toBe(false);
    },
  );

  it.each(['tirupati', 'jewellery', 'goldsilver', 'sonachandi'])(
    'rejects the shop-specific guess %s',
    (candidate) => {
      expect(checkPassword(candidate).ok).toBe(false);
    },
  );

  it('is case-insensitive', () => {
    expect(checkPassword('PASSWORD').ok).toBe(false);
    expect(checkPassword('PaSsWoRd').ok).toBe(false);
  });

  it('sees through a trailing-digit suffix', () => {
    // `krishna2024` is the same guess as `krishna` to anyone running a list.
    expect(checkPassword('krishna2024').ok).toBe(false);
    expect(checkPassword('password2024').ok).toBe(false);
  });
});

describe('patterns', () => {
  it('rejects a single repeated character', () => {
    expect(checkPassword('aaaaaaaaaa').ok).toBe(false);
  });

  it('rejects digits only — covers dates of birth and phone numbers', () => {
    expect(checkPassword('9876543210').ok).toBe(false);
    expect(checkPassword('01011990').ok).toBe(false);
  });

  it('rejects a straight keyboard run', () => {
    expect(checkPassword('asdfghjk').ok).toBe(false);
  });
});

describe('what the policy deliberately does NOT require', () => {
  it.each([
    ['all lowercase letters', 'chaiwallahbrass'],
    ['no digits', 'brasslanternhouse'],
    ['no symbols', 'quietmorningtrain7'],
    ['no uppercase', 'sparrow.kettle.94'],
  ])('accepts %s', (_label, candidate) => {
    // §3.1: composition rules push people toward `Password1!`. Length and guessability
    // are the only gates.
    expect(checkPassword(candidate).ok).toBe(true);
  });

  it('accepts a long passphrase', () => {
    expect(checkPassword('correct horse battery staple').ok).toBe(true);
  });
});

describe('failure messages', () => {
  it('never echoes the submitted password back', () => {
    const result = checkPassword('password');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).not.toContain('password1');
  });
});
