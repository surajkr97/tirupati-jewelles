/**
 * Phase 9 §9.1 — the redactor, the client IP, and the global limiter's tiers.
 * specs/09-hardening.md. Regressions for SEC-031, SEC-032 and SEC-034.
 *
 * These three are load-bearing in a way that is easy to lose: each is a control whose
 * failure is SILENT. A redactor that stops matching still logs. A client IP that reverts to
 * the leftmost header entry still rate-limits — against an identity the caller chose. So
 * each is asserted on the property, not on the implementation.
 */
import { describe, expect, it } from 'vitest';

import { clientIpFromHeaders } from '@/lib/http';
import { redact, redactString } from '@/lib/log';
import { isPrefetch, tierFor } from '@/lib/security/global-limit';

// ─────────────────────────────────────────── SEC-031, the redactor

describe('SEC-031 — logs must not carry emails or phone numbers', () => {
  it('redacts an email but leaves it recognisable', () => {
    // Enough for a support engineer to match against an address they already have, useless
    // to someone who does not.
    expect(redactString('login failed for ravi.patel@gmail.com')).toBe(
      'login failed for r***@gmail.com',
    );
  });

  it.each([
    ['E.164', '+919876543210'],
    ['spaced', '+91 98765 43210'],
    ['hyphenated', '98765-43210'],
    ['parenthesised', '(+91) 98765 43210'],
  ])('redacts a phone number written as %s', (_name, phone) => {
    const out = redactString(`otp sent to ${phone}`);
    expect(out).not.toContain('9876543210');
    expect(out).toContain('[phone:');
  });

  it('keeps the last three digits, so two customers can be told apart', () => {
    expect(redactString('+919876543210')).toContain('210');
  });

  it('leaves short digit runs alone', () => {
    // A port, a status code, a count. Over-redacting makes logs useless, which is its own
    // way of failing the requirement.
    expect(redactString('listening on 3000, returned 404 in 250ms')).toBe(
      'listening on 3000, returned 404 in 250ms',
    );
  });

  it('redacts the Prisma error that caused this finding', () => {
    /**
     * The measured case. Prisma serialises the whole argument object into a validation
     * error, and `serverError()` passed that straight to `console.error` — so a malformed
     * request printed a customer's email and phone into production stdout verbatim.
     */
    const prismaish = new Error(
      'Invalid `prisma.user.findMany()` invocation:\n' +
        '  where: {\n' +
        '    email: "victim.person@example.com",\n' +
        '    phone: "+919812345678"\n' +
        '  }',
    );

    const out = JSON.stringify(redact({ err: prismaish }));

    expect(out).not.toContain('victim.person@example.com');
    expect(out).not.toContain('9812345678');
    // Still says what failed — a redactor that destroys the diagnostic has traded one
    // problem for another.
    expect(out).toContain('prisma.user.findMany');
  });

  it('drops secret-named keys whole, whatever their value looks like', () => {
    // A password does not have to look like anything, so its NAME is the only safe rule.
    const out = redact({
      password: 'hunter2',
      passwordHash: '$argon2id$v=19$m=19456',
      token: 'abc',
      cookie: 'tj_session=xyz',
      name: 'Ravi',
    }) as Record<string, unknown>;

    expect(out.password).toBe('[redacted]');
    expect(out.passwordHash).toBe('[redacted]');
    expect(out.token).toBe('[redacted]');
    expect(out.cookie).toBe('[redacted]');
    expect(out.name).toBe('Ravi');
  });

  it('redacts inside nested structures', () => {
    const out = JSON.stringify(
      redact({
        order: {
          customer: { email: 'a.b@example.com' },
          items: [{ note: '+919812345678' }],
        },
      }),
    );

    expect(out).not.toContain('a.b@example.com');
    expect(out).not.toContain('9812345678');
  });

  it('never throws, whatever it is handed', () => {
    // It runs on the error path. A redactor that throws turns a logged failure into an
    // unlogged one.
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => redact(circular)).not.toThrow();
    expect(() => redact(undefined)).not.toThrow();
    expect(() => redact(123n)).not.toThrow();
    expect(() => redact(Symbol('x'))).not.toThrow();
  });
});

// ─────────────────────────────────────────── SEC-032, the client IP

describe('SEC-032 — the client IP must not be the caller’s to choose', () => {
  const ipFrom = (xff: string, extra: Record<string, string> = {}) =>
    clientIpFromHeaders(new Headers({ 'x-forwarded-for': xff, ...extra }));

  it('ignores a spoofed leading entry', () => {
    /**
     * The finding, stated as a test. The leftmost entry is whatever the caller sent; taking
     * it — which this function used to do — lets anyone present a fresh identity per request
     * and makes every per-IP limit in the application decorative.
     *
     * Confirmed to FAIL against the pre-fix implementation, which returned 1.2.3.4.
     */
    expect(ipFrom('1.2.3.4, 203.0.113.9')).toBe('203.0.113.9');
  });

  it('handles a platform that sends only the client', () => {
    expect(ipFrom('203.0.113.9')).toBe('203.0.113.9');
  });

  it('skips an infrastructure address when the hop count is wrong', () => {
    /**
     * The failure mode this must not have. If the trusted-hop count does not match the real
     * topology, the selected entry is a load balancer's own address — and then EVERY visitor
     * shares one bucket and the global limiter locks out the whole site. Worse than the
     * problem being fixed, so it is designed out: a private address is never an identity.
     */
    expect(ipFrom('1.2.3.4, 203.0.113.9, 10.0.0.7')).toBe('203.0.113.9');
    expect(ipFrom('203.0.113.9, 172.16.4.2')).toBe('203.0.113.9');
    expect(ipFrom('203.0.113.9, 100.64.0.1')).toBe('203.0.113.9');
    expect(ipFrom('203.0.113.9, 169.254.169.254')).toBe('203.0.113.9');
  });

  it('falls back to x-real-ip, then to a shared bucket', () => {
    expect(clientIpFromHeaders(new Headers({ 'x-real-ip': '203.0.113.5' }))).toBe(
      '203.0.113.5',
    );
    // No forwarding headers at all: over-limit rather than under-limit.
    expect(clientIpFromHeaders(new Headers())).toBe('0.0.0.0');
  });

  it('copes with local development, where every address is private', () => {
    expect(ipFrom('::1')).toBe('::1');
    expect(ipFrom('127.0.0.1')).toBe('127.0.0.1');
  });

  it('is not confused by whitespace or empty entries', () => {
    expect(ipFrom('  1.2.3.4 ,  , 203.0.113.9  ')).toBe('203.0.113.9');
  });
});

// ─────────────────────────────────────────── SEC-034, the global limiter

describe('SEC-034 — the global limiter’s tiers', () => {
  it('puts auth and bill paths on the tighter tiers', () => {
    expect(tierFor('/api/auth/login').name).toBe('auth');
    expect(tierFor('/login').name).toBe('auth');
    expect(tierFor('/claim/abc').name).toBe('auth');
    expect(tierFor('/bills/some-uuid').name).toBe('bill');
    expect(tierFor('/api/admin/bills').name).toBe('bill');
  });

  it('leaves ordinary browsing on the generous tier', () => {
    expect(tierFor('/').name).toBe('default');
    expect(tierFor('/products/gold-ring').name).toBe('default');
    expect(tierFor('/api/rates').name).toBe('default');
  });

  it('the auth tier is tighter than the default one', () => {
    // The relationship is the requirement (§9.1: "Tighter limits on auth and bill routes"),
    // not the specific numbers, which are expected to be tuned.
    expect(tierFor('/api/auth/login').limit).toBeLessThan(tierFor('/').limit);
    expect(tierFor('/bills/x').limit).toBeLessThan(tierFor('/').limit);
  });

  /**
   * ── These two tests were REWRITTEN, and the reason is on the record ──
   *
   * They previously asserted `shouldSkip(...) === true` for a prefetch header and for
   * `/api/health` — that is, they asserted the request was removed from the limiter
   * entirely. That was a faithful description of the implementation and a defect against
   * §9.1 (Phase 9 TEST, findings 1 and 2): a client can set those headers, so the "global"
   * limit was opt-out.
   *
   * Changing a test to make a failure disappear is the anti-pattern AGENTS.md names. This
   * is the other case — the assertion itself encoded the bug — so the property is replaced
   * rather than relaxed, and both replacements fail against the old `shouldSkip`.
   */
  it('recognises a prefetch, so it can be counted separately rather than skipped', () => {
    /**
     * `next/link` fires one prefetch per link in the viewport, so a catalogue page produces
     * dozens of proxy-visible requests per navigation. Charging them to the human's budget
     * would break the site while somebody scrolls — which is why they get their own bucket.
     * Not counting them at all is what made the limit optional.
     */
    const req = (headers: Record<string, string>) =>
      new Request('https://shop.example/collections', { headers });

    expect(isPrefetch(req({ 'next-router-prefetch': '1' }))).toBe(true);
    expect(isPrefetch(req({ purpose: 'prefetch' }))).toBe(true);
    expect(isPrefetch(req({ 'x-purpose': 'prefetch' }))).toBe(true);
    expect(isPrefetch(req({}))).toBe(false);
  });

  it('gives the health check its own budget rather than an exemption', () => {
    /**
     * §9.4 puts uptime monitoring on `/api/health`, and a monitor that gets a 429 reports a
     * false outage — so it needs headroom, and its OWN bucket so unrelated traffic from the
     * same address cannot starve it. It does not need to be uncounted: the endpoint runs a
     * Postgres query and a Redis ping on every hit, so an unbounded one is a
     * connection-pool exhaustion primitive.
     */
    const health = tierFor('/api/health');

    expect(health.name).not.toBe(tierFor('/collections').name);
    // Generous enough that no monitor can reach it, finite enough to bound a flood.
    expect(health.limit).toBeGreaterThan(100);
    expect(Number.isFinite(health.limit)).toBe(true);
  });
});
