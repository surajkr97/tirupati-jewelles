/**
 * Phase 7 SECURITY — the CSRF origin check.
 * specs/07-admin-panel.md §7 SECURITY: "CSRF: state-changing routes require `SameSite=Lax`
 * plus an origin check."
 *
 * Added in Phase 7 but retrofitted to every mutating route written since Phase 3 — a
 * control applied only to code written after it was invented has a hole in the shape of the
 * older code.
 */
import { describe, expect, it, vi } from 'vitest';

const { headerStore } = vi.hoisted(() => ({
  headerStore: { current: new Headers() },
}));

vi.mock('next/headers', () => ({
  headers: async () => headerStore.current,
}));

import { requireSameOrigin } from '@/lib/http';

function withHeaders(entries: Record<string, string>) {
  headerStore.current = new Headers(entries);
}

describe('requireSameOrigin', () => {
  it('allows a same-origin request', async () => {
    withHeaders({ origin: 'https://shop.example', host: 'shop.example' });

    expect(await requireSameOrigin()).toBeNull();
  });

  it('allows a request with no Origin header', async () => {
    /**
     * A server-to-server caller — curl, a health check, the Playwright request fixture.
     * Not a CSRF scenario: CSRF needs a browser with an ambient cookie, and a browser
     * always sends the header on a state-changing request.
     */
    withHeaders({ host: 'shop.example' });

    expect(await requireSameOrigin()).toBeNull();
  });

  it.each([
    ['a different host', 'https://evil.example'],
    ['a subdomain of the attacker', 'https://shop.example.evil.example'],
    ['a lookalike with a suffix', 'https://notshop.example'],
    ['a different port', 'https://shop.example:8443'],
  ])('rejects %s', async (_name, origin) => {
    withHeaders({ origin, host: 'shop.example' });

    const response = await requireSameOrigin();
    expect(response?.status).toBe(403);
  });

  it('rejects a downgraded http origin in production', async () => {
    /**
     * `Host` carries no scheme, so `http://shop.example` and a host of `shop.example`
     * compare equal once the default port normalises away — which would admit a
     * downgraded origin. Caught by a test whose expectation was stricter than the first
     * implementation.
     */
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();

    try {
      const { requireSameOrigin: strict } = await import('@/lib/http');
      withHeaders({ origin: 'http://shop.example:80', host: 'shop.example' });

      expect((await strict())?.status).toBe(403);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('allows http on localhost in development', async () => {
    // The dev server runs on http://localhost:3000; rejecting it would break every form.
    withHeaders({ origin: 'http://localhost:3000', host: 'localhost:3000' });

    expect(await requireSameOrigin()).toBeNull();
  });

  it('rejects a malformed Origin rather than trusting it', async () => {
    withHeaders({ origin: 'not a url', host: 'shop.example' });

    expect((await requireSameOrigin())?.status).toBe(400);
  });

  it('rejects when there is no Host to compare against', async () => {
    withHeaders({ origin: 'https://shop.example' });

    expect((await requireSameOrigin())?.status).toBe(400);
  });

  it('says nothing useful in the failure body', async () => {
    withHeaders({ origin: 'https://evil.example', host: 'shop.example' });

    const response = await requireSameOrigin();
    const body = await response!.json();

    // Naming the expected origin would help an attacker tune, and no legitimate caller
    // ever reads this.
    expect(body.error).toBe('Bad request.');
    expect(JSON.stringify(body)).not.toContain('shop.example');
  });
});
