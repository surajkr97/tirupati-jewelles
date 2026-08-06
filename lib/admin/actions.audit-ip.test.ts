/**
 * SEC-032, the copy that was missed — the IP written to the audit log.
 * Written by TEST for Phase 9 from `specs/09-hardening.md` §9.1 and the SECURITY pass's
 * constraint 3: "Fix the client IP or stop depending on it — rightmost entry with an
 * explicit trusted-hop count."
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THESE ARE EXPECTED TO FAIL. Reported as TEST finding 4.
 *
 *  `lib/http.ts` was fixed to read `x-forwarded-for` from the RIGHT. `lib/admin/actions.ts`
 *  has a second, private `clientIp()` at line 54 that still takes `split(',')[0]` — the
 *  leftmost entry, which is whatever the caller sent.
 *
 *  That value is not used for rate limiting, so this is not a limiter bypass. It is the IP
 *  stamped on every `AuditLog` row: §7 SECURITY requires "all admin mutations write an
 *  AuditLog with actor and IP", §7.3 shows it to the admin as rate-change history, and
 *  §7.10 makes the log read-only precisely so it can be relied on afterwards. An audit
 *  trail whose IP column is set by the caller records a fact about the request headers, not
 *  about who acted.
 *
 *  ── Why this is the same finding twice in the same file ──
 *  SEC-028, found in this phase, was `lib/admin/actions.ts` holding a second copy of the
 *  CSRF origin check that had drifted from `lib/http.ts`'s. The fix made the decision exist
 *  once. Nine lines above that check sits a second copy of the client-IP decision, and
 *  SEC-032's fix reached `lib/http.ts` only — the identical shape, in the identical file,
 *  in the same pass. `lib/http.ts` already exports `clientIp()` for exactly this.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { clientIpFromHeaders } from '@/lib/http';

const { headerStore, auditWrites } = vi.hoisted(() => ({
  headerStore: { current: new Headers() },
  auditWrites: [] as { ip: string }[],
}));

vi.mock('next/headers', () => ({
  headers: async () => headerStore.current,
}));

vi.mock('@/lib/auth/guard', () => ({
  UnauthorisedError: class extends Error {},
  requireAdmin: async () => ({ id: 'admin-1', email: 'a@example.com', role: 'ADMIN' }),
}));

/** No database: the audit row is captured on its way out, which is what is under test. */
vi.mock('@/lib/db', () => ({
  db: {
    auditLog: {
      create: async ({ data }: { data: { ip: string } }) => {
        auditWrites.push(data);
        return data;
      },
    },
  },
}));

import { adminAction } from '@/lib/admin/actions';

/** Run a mutation that audits itself, and return the IP that was recorded. */
async function recordedIp(forwardedFor: string): Promise<string | undefined> {
  auditWrites.length = 0;
  headerStore.current = new Headers({
    host: 'shop.example',
    origin: 'https://shop.example',
    'x-forwarded-for': forwardedFor,
  });

  const result = await adminAction(async ({ audit }) => {
    await audit({ action: 'rate.update', entity: 'MetalRate', entityId: 'r1' });
    return { ok: true as const, data: undefined };
  });

  // If this is false the mutation never ran and the assertion below would be vacuous.
  expect(result.ok, 'the mutation did not run — this test proves nothing').toBe(true);

  return auditWrites[0]?.ip;
}

afterEach(() => {
  auditWrites.length = 0;
});

describe('SEC-032 — the audited IP must not be the caller’s to choose', () => {
  it('records the trusted hop, not the entry the caller put in front of it', async () => {
    /**
     * The forged prefix is the shape SEC-032 describes: a client sets `x-forwarded-for`,
     * the proxy appends the address it actually saw. Reading position 0 hands the attacker
     * the pen the audit log writes with.
     */
    expect(await recordedIp('1.2.3.4, 203.0.113.9')).toBe('203.0.113.9');
  });

  it('cannot be made to record an arbitrary string', async () => {
    // The value is stored and displayed. It does not have to be an address at all.
    expect(await recordedIp('not-an-ip-at-all, 203.0.113.9')).toBe('203.0.113.9');
  });

  it('agrees with the one derivation the application already has', async () => {
    /**
     * The structural assertion, and the one that survives future tuning: there must be a
     * single answer to "who is calling". `TRUSTED_PROXY_HOPS` exists so the answer can be
     * configured; a second implementation means configuring it fixes half the application.
     */
    for (const forwarded of [
      '1.2.3.4, 203.0.113.9',
      '203.0.113.9',
      '1.2.3.4, 203.0.113.9, 10.0.0.7',
    ]) {
      expect(
        await recordedIp(forwarded),
        `the audit log and lib/http.ts disagree about "${forwarded}"`,
      ).toBe(clientIpFromHeaders(new Headers({ 'x-forwarded-for': forwarded })));
    }
  });

  it('still records something when there are no forwarding headers', async () => {
    // The positive control: this must not be fixed by recording nothing at all.
    auditWrites.length = 0;
    headerStore.current = new Headers({
      host: 'shop.example',
      origin: 'https://shop.example',
    });

    await adminAction(async ({ audit }) => {
      await audit({ action: 'rate.update', entity: 'MetalRate', entityId: 'r1' });
      return { ok: true as const, data: undefined };
    });

    expect(auditWrites[0]?.ip).toBeTruthy();
  });
});
