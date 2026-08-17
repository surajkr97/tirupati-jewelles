/**
 * Stage 7 — the reel-cover proxy is a URL-taking fetcher, so the allowlist is what gets
 * tested (D-124).
 *
 * This route exists to fetch a caller-supplied URL, which is the textbook server-side request
 * forgery shape. Left open it fetches cloud metadata at 169.254.169.254, or this stack's own
 * Redis on localhost:6379, and hands the response to an anonymous caller. The guard is one
 * host check, so the host check is what these assertions pin — including the two failures a
 * hand-rolled check usually has: a missing dot boundary (`evil-cdninstagram.com`) and a
 * suffix that only LOOKS terminal (`cdninstagram.com.attacker.test`).
 *
 * `fetch` is stubbed throughout. A test that reached the real network would be asserting
 * Instagram's uptime rather than our allowlist, and would pass for the wrong reason offline.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/social/reel-cover/route';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function get(u?: string) {
  const url = new URL('http://localhost:3000/api/social/reel-cover');
  if (u !== undefined) url.searchParams.set('u', u);
  return GET(new Request(url));
}

/** A believable upstream image response. */
function imageResponse(contentType = 'image/jpeg') {
  return {
    ok: true,
    body: null,
    headers: new Headers({ 'content-type': contentType }),
  };
}

describe('the host allowlist', () => {
  it.each([
    ['cloud metadata over http', 'http://169.254.169.254/latest/meta-data/'],
    ['cloud metadata over https', 'https://169.254.169.254/latest/meta-data/'],
    ["this stack's Redis", 'http://localhost:6379/'],
    ["this stack's Postgres", 'http://127.0.0.1:5432/'],
    ['an unrelated host', 'https://example.com/x.jpg'],
    // The two that a naive `includes()` or `endsWith()` check lets through.
    ['a host that merely contains the name', 'https://evil-cdninstagram.com/x.jpg'],
    [
      'a host that only looks like a suffix',
      'https://cdninstagram.com.attacker.test/x.jpg',
    ],
  ])('refuses %s', async (_label, u) => {
    const response = await get(u);
    expect(response.status).toBe(400);
    // The point is not only the status — nothing may leave the server at all.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a non-https scheme even on an allowed host', async () => {
    const response = await get('http://scontent.cdninstagram.com/x.jpg');
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a url it cannot parse, rather than passing it on', async () => {
    expect((await get('not a url')).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a missing parameter', async () => {
    expect((await get()).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      'the shard hosts Instagram actually serves from',
      'https://instagram.fdel93-3.fna.fbcdn.net/v/t51/x.jpg',
    ],
    ['the cdninstagram apex', 'https://scontent.cdninstagram.com/v/t51/x.jpg'],
  ])('allows %s', async (_label, u) => {
    fetchMock.mockResolvedValue(imageResponse());
    const response = await get(u);
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe('what it relays back', () => {
  it('does not follow a redirect, so the allowlist cannot be bypassed after the check', async () => {
    fetchMock.mockResolvedValue(imageResponse());
    await get('https://scontent.cdninstagram.com/v/t51/x.jpg');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
  });

  it('refuses to relay a non-image, whatever the upstream said it was sending', async () => {
    // An allowed host returning HTML or JSON must not become a same-origin response —
    // that is how a proxy turns into a content-injection primitive.
    fetchMock.mockResolvedValue(imageResponse('text/html'));
    const response = await get('https://scontent.cdninstagram.com/v/t51/x.jpg');
    expect(response.status).toBe(502);
  });

  it('marks the bytes nosniff so they cannot be re-interpreted', async () => {
    fetchMock.mockResolvedValue(imageResponse());
    const response = await get('https://scontent.cdninstagram.com/v/t51/x.jpg');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('reports an upstream failure as 502 rather than throwing', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const response = await get('https://scontent.cdninstagram.com/v/t51/x.jpg');
    expect(response.status).toBe(502);
  });
});
