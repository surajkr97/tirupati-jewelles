/**
 * Phase 9 — the Vercel Cron sweep refuses anyone without the secret (D-055).
 *
 * This endpoint DELETES rows on a GET, which is the shape that gets abused: no body to
 * validate, no session to check, reachable by anyone who guesses the path. Its whole guard is
 * one header, so the guard is what gets tested — including the case that matters most, which
 * is the one nobody sets up on purpose: `CRON_SECRET` never configured. It must refuse then
 * too, rather than treating "no secret" as "no check".
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ secret: undefined as string | undefined }));

vi.mock('@/lib/env', () => ({
  get env() {
    return { CRON_SECRET: state.secret };
  },
}));

const swept = vi.hoisted(() => ({ calls: 0 }));
vi.mock('@/lib/queue/jobs', () => ({
  runExpireShares: async () => {
    swept.calls += 1;
    return { deleted: 7 };
  },
}));

import { GET } from '@/app/api/cron/cleanup/route';

function request(auth?: string) {
  return new Request('http://localhost:3000/api/cron/cleanup', {
    headers: auth ? { authorization: auth } : {},
  });
}

afterEach(() => {
  swept.calls = 0;
});

describe('the cron sweep', () => {
  it('refuses when no secret is configured — "unset" is not "open"', async () => {
    state.secret = undefined;

    const response = await GET(request('Bearer anything'));

    expect(response.status).toBe(404);
    expect(swept.calls, 'nothing may be deleted on an unguarded call').toBe(0);
  });

  it('refuses a caller with no header at all', async () => {
    state.secret = 'a-secret-long-enough-to-pass';

    expect((await GET(request())).status).toBe(404);
    expect(swept.calls).toBe(0);
  });

  it('refuses the wrong secret', async () => {
    state.secret = 'a-secret-long-enough-to-pass';

    expect((await GET(request('Bearer wrong'))).status).toBe(404);
    expect(swept.calls).toBe(0);
  });

  it('404, not 401 — the endpoint does not announce itself', async () => {
    state.secret = 'a-secret-long-enough-to-pass';

    const response = await GET(request('Bearer wrong'));

    // A 401 confirms the path exists and is worth attacking. Same reasoning as SEC-016.
    expect(response.status).not.toBe(401);
    expect(response.status).toBe(404);
  });

  it('sweeps for the scheduler, and reports what it deleted', async () => {
    state.secret = 'a-secret-long-enough-to-pass';

    const response = await GET(request('Bearer a-secret-long-enough-to-pass'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: 7 });
    expect(swept.calls).toBe(1);
  });
});
