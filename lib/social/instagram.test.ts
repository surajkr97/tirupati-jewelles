/**
 * Stage 7 — the reels rail degrades instead of breaking, and never invents a number (D-124).
 *
 * The realistic production failure for this feature is not an outage, it is a token that
 * quietly expires 60 days after launch. So the assertions are mostly about the sad paths: no
 * token, a 401, a network error, a response with nothing usable in it. Every one of them has
 * to end with a rendered rail, because `app/(app)/page.tsx` awaits this inside a
 * `Promise.all` with no `.catch()` — a rejection there takes the whole homepage down.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  token: undefined as string | undefined,
  userId: undefined as string | undefined,
}));

vi.mock('@/lib/env', () => ({
  get env() {
    return {
      INSTAGRAM_ACCESS_TOKEN: state.token,
      INSTAGRAM_USER_ID: state.userId,
    };
  },
}));

import { formatCount, getRecentReels, REEL_COUNT } from '@/lib/social/instagram';

const fetchMock = vi.fn();

beforeEach(() => {
  state.token = 'test-token';
  state.userId = '17841400000000000';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function media(overrides: Record<string, unknown> = {}) {
  return {
    id: '1',
    media_type: 'VIDEO',
    permalink: 'https://www.instagram.com/reel/ABC/',
    thumbnail_url: 'https://scontent.cdninstagram.com/v/t51/cover.jpg',
    like_count: 72,
    comments_count: 3,
    ...overrides,
  };
}

function ok(data: unknown[]) {
  return { ok: true, json: async () => ({ data }) };
}

describe('it always returns something to render', () => {
  it('falls back when no token is configured', async () => {
    state.token = undefined;
    const reels = await getRecentReels();
    expect(reels).toHaveLength(REEL_COUNT);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back when the user id is missing', async () => {
    state.userId = undefined;
    expect(await getRecentReels()).toHaveLength(REEL_COUNT);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back on an expired token, which is the 60-day failure', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    expect(await getRecentReels()).toHaveLength(REEL_COUNT);
  });

  it('falls back on a network error rather than rejecting', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    await expect(getRecentReels()).resolves.toHaveLength(REEL_COUNT);
  });

  it('falls back on a malformed body', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ nope: true }) });
    expect(await getRecentReels()).toHaveLength(REEL_COUNT);
  });

  it('falls back when the account has media but no videos', async () => {
    // A successful call that yields nothing usable is still a failure for the reader.
    fetchMock.mockResolvedValue(ok([media({ media_type: 'IMAGE' })]));
    expect(await getRecentReels()).toHaveLength(REEL_COUNT);
  });
});

describe('the fallback set never invents engagement', () => {
  it('reports unknown counts as null, not zero', async () => {
    state.token = undefined;
    for (const reel of await getRecentReels()) {
      expect(reel.likes).toBeNull();
      expect(reel.comments).toBeNull();
    }
  });
});

describe('the live path', () => {
  it('keeps videos and drops everything else', async () => {
    fetchMock.mockResolvedValue(
      ok([
        media({ id: 'a' }),
        media({ id: 'b', media_type: 'IMAGE' }),
        media({ id: 'c', media_type: 'CAROUSEL_ALBUM' }),
      ]),
    );
    const reels = await getRecentReels();
    expect(reels.map((r) => r.id)).toEqual(['a']);
  });

  it('never returns more tiles than the rail shows', async () => {
    fetchMock.mockResolvedValue(
      ok(Array.from({ length: 20 }, (_, i) => media({ id: `${i}` }))),
    );
    expect(await getRecentReels()).toHaveLength(REEL_COUNT);
  });

  it('routes every cover through our own origin, never Instagram’s CDN', async () => {
    // This is what keeps `img-src` untouched — see the note in instagram.ts.
    fetchMock.mockResolvedValue(ok([media()]));
    const [reel] = await getRecentReels();
    expect(reel?.cover.startsWith('/api/social/reel-cover?u=')).toBe(true);
    expect(reel?.cover).not.toContain('cdninstagram.com/v/');
  });

  it('drops an item with no permalink rather than linking nowhere', async () => {
    fetchMock.mockResolvedValue(ok([media({ permalink: undefined })]));
    expect(await getRecentReels()).toHaveLength(REEL_COUNT);
  });

  it('keeps a real zero, but reports a missing count as unknown', async () => {
    fetchMock.mockResolvedValue(
      ok([media({ id: 'a', like_count: 0, comments_count: undefined })]),
    );
    const [reel] = await getRecentReels();
    expect(reel?.likes).toBe(0);
    expect(reel?.comments).toBeNull();
  });

  it('sends the token and asks for the engagement fields', async () => {
    fetchMock.mockResolvedValue(ok([media()]));
    await getRecentReels();
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('access_token=test-token');
    expect(url).toContain('like_count');
    expect(url).toContain('comments_count');
  });
});

describe('formatCount', () => {
  it.each([
    [0, '0'],
    [7, '7'],
    [999, '999'],
    [1000, '1k'],
    [1200, '1.2k'],
    [15_400, '15.4k'],
    [99_900, '99.9k'],
    [100_000, '100k'],
    [1_250_000, '1250k'],
  ])('%i renders as %s', (input, expected) => {
    expect(formatCount(input)).toBe(expected);
  });

  it('never renders NaN or a negative', () => {
    expect(formatCount(Number.NaN)).toBe('0');
    expect(formatCount(-5)).toBe('0');
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe('0');
  });
});
