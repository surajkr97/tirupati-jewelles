/**
 * Stage 2 — the post-authentication destination, and the open-redirect guard.
 *
 * Two defects are fenced here. C-3: an admin signing in landed on `/account` with no route
 * onward. UI_REDESIGN_DEBT-002: the old inline check accepted `/\evil.example`, which some
 * browsers normalise into a protocol-relative URL.
 */
import { describe, expect, it } from 'vitest';

import {
  ADMIN_HOME,
  CUSTOMER_HOME,
  destinationAfterAuth,
  homeForRole,
  isSafeNext,
} from '@/lib/auth/safe-next';

describe('isSafeNext accepts only internal paths', () => {
  it.each([
    ['/account'],
    ['/admin'],
    ['/account/orders'],
    ['/products/gold-band'],
    ['/rates?range=1M'],
    ['/collections/rings#top'],
  ])('accepts %s', (next) => {
    expect(isSafeNext(next)).toBe(true);
  });

  it.each([
    ['//evil.example', 'protocol-relative'],
    ['/\\evil.example', 'backslash — UI_REDESIGN_DEBT-002, the one the old check missed'],
    ['\\\\evil.example', 'UNC-style'],
    ['https://evil.example', 'absolute https'],
    ['http://evil.example', 'absolute http'],
    ['javascript:alert(1)', 'scheme'],
    ['//evil.example/path', 'protocol-relative with a path'],
    ['/%2F%2Fevil.example', 'encoded double slash'],
    ['/%5Cevil.example', 'encoded backslash'],
    ['account', 'relative, no leading slash'],
    ['', 'empty'],
    [' /account', 'leading space'],
    ['/account\nSet-Cookie: x', 'embedded newline'],
  ])('rejects %s (%s)', (next) => {
    expect(isSafeNext(next)).toBe(false);
  });

  it('rejects null and undefined', () => {
    expect(isSafeNext(null)).toBe(false);
    expect(isSafeNext(undefined)).toBe(false);
  });
});

describe('C-3: the role decides where there is no next', () => {
  it('an admin lands on the dashboard, not the account page', () => {
    expect(homeForRole('ADMIN')).toBe(ADMIN_HOME);
    expect(destinationAfterAuth(null, 'ADMIN')).toBe('/admin');
  });

  it('a customer lands on the account page', () => {
    expect(homeForRole('CUSTOMER')).toBe(CUSTOMER_HOME);
    expect(destinationAfterAuth(null, 'CUSTOMER')).toBe('/account');
  });

  it('an unknown or missing role is treated as a customer, never as an admin', () => {
    // Failing closed: a bad role must not hand someone the admin route. The route would
    // 404 them anyway via requireAdminPage(), but the destination should not imply access.
    expect(homeForRole(undefined)).toBe(CUSTOMER_HOME);
    expect(homeForRole('SOMETHING_ELSE')).toBe(CUSTOMER_HOME);
  });
});

describe('destinationAfterAuth', () => {
  it('a valid next wins over the role default — it is where they were going', () => {
    expect(destinationAfterAuth('/account/orders', 'ADMIN')).toBe('/account/orders');
    expect(destinationAfterAuth('/admin/rates', 'ADMIN')).toBe('/admin/rates');
  });

  it('an unsafe next falls back to the role home, never to the unsafe value', () => {
    expect(destinationAfterAuth('//evil.example', 'ADMIN')).toBe('/admin');
    expect(destinationAfterAuth('/\\evil.example', 'CUSTOMER')).toBe('/account');
    expect(destinationAfterAuth('https://evil.example', 'CUSTOMER')).toBe('/account');
  });

  it('never returns an external destination for any input', () => {
    const hostile = [
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      'javascript:alert(1)',
      '/%2F%2Fevil.example',
    ];
    for (const next of hostile) {
      const out = destinationAfterAuth(next, 'CUSTOMER');
      expect(out.startsWith('/')).toBe(true);
      expect(out.startsWith('//')).toBe(false);
      expect(out).not.toContain('evil.example');
    }
  });
});
