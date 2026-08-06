/**
 * SEC-028 — the Server Action CSRF check must be the same check the route handlers use.
 * Phase 9 §9.1 (specs/09-hardening.md), regression for a control introduced in Phase 7.
 *
 * ── What went wrong, and why this file is separate ──
 * Phase 7 wrote the origin check twice: once in `lib/http.ts` returning a `NextResponse`,
 * once in `lib/admin/actions.ts` returning a boolean, because a Server Action cannot return
 * a response. SEC-017 then tightened the first copy to reject a downgraded `http://` origin
 * in production and left the second alone. Every admin mutation in this application is a
 * Server Action (D-024), so the copy that kept the bug was the one guarding the rate editor,
 * the product editor, settings and the bill actions.
 *
 * `lib/admin/admin.test.ts` covers the cross-origin case but is gated on a real Postgres and
 * imports the actions statically, so it cannot re-import the graph under a different
 * `NODE_ENV`. This file needs no database: `adminAction` refuses before it runs the body, so
 * nothing is written and nothing is read.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const { headerStore } = vi.hoisted(() => ({
  headerStore: { current: new Headers() },
}));

vi.mock('next/headers', () => ({
  headers: async () => headerStore.current,
}));

vi.mock('@/lib/auth/guard', () => ({
  UnauthorisedError: class extends Error {},
  // Always an admin. The point of this file is what happens AFTER authorisation passes.
  requireAdmin: async () => ({ id: 'admin-1', email: 'a@example.com', role: 'ADMIN' }),
}));

function withHeaders(entries: Record<string, string>) {
  headerStore.current = new Headers(entries);
}

/** Import `adminAction` fresh, under a chosen NODE_ENV, since `lib/env.ts` parses at import. */
async function loadAdminAction(nodeEnv: 'production' | 'development') {
  vi.stubEnv('NODE_ENV', nodeEnv);
  vi.resetModules();
  const { adminAction } = await import('@/lib/admin/actions');
  return adminAction;
}

/** Runs only if the origin check lets it through, so `ran` IS the verdict. */
async function attemptMutation(
  adminAction: Awaited<ReturnType<typeof loadAdminAction>>,
): Promise<{ ran: boolean; result: { ok: boolean } }> {
  let ran = false;
  const result = await adminAction(async () => {
    ran = true;
    return { ok: true as const, data: undefined };
  });
  return { ran, result };
}

describe('SEC-028 — adminAction rejects a downgraded origin in production', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('refuses http:// when the host matches, in production', async () => {
    /**
     * The exact case SEC-017 fixed in `lib/http.ts` and missed here. `Host` carries no
     * scheme, so `http://shop.example` and a host of `shop.example` compare equal once the
     * default port normalises away — which is precisely the position a network attacker
     * wants to be in.
     *
     * Confirmed to FAIL against the pre-fix implementation: it compared hosts only, so the
     * mutation ran.
     */
    const adminAction = await loadAdminAction('production');
    withHeaders({ origin: 'http://shop.example:80', host: 'shop.example' });

    const { ran, result } = await attemptMutation(adminAction);

    expect(result.ok).toBe(false);
    expect(ran).toBe(false);
  });

  it('allows https:// from the same host in production', async () => {
    // The positive control. Without it, a check that refused everything would look identical.
    const adminAction = await loadAdminAction('production');
    withHeaders({ origin: 'https://shop.example', host: 'shop.example' });

    const { ran, result } = await attemptMutation(adminAction);

    expect(result.ok).toBe(true);
    expect(ran).toBe(true);
  });

  it('still allows http on localhost in development', async () => {
    // Rejecting this would break every admin form on the dev server.
    const adminAction = await loadAdminAction('development');
    withHeaders({ origin: 'http://localhost:3000', host: 'localhost:3000' });

    const { ran } = await attemptMutation(adminAction);

    expect(ran).toBe(true);
  });

  it('still refuses a different host', async () => {
    // The case Phase 7 did cover. Asserted here too, so the shared refactor cannot lose it.
    const adminAction = await loadAdminAction('production');
    withHeaders({ origin: 'https://evil.example', host: 'shop.example' });

    const { ran } = await attemptMutation(adminAction);

    expect(ran).toBe(false);
  });
});
