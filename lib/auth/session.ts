/**
 * Sessions — opaque IDs in Redis.
 * Created by Phase 3 (specs/03-auth.md §3.3). Key shape from MASTER-SPEC §7.
 *
 * §3.3 chooses this over a self-contained JWT deliberately: "it gives you real server-side
 * revocation." A signed JWT cannot be withdrawn before it expires, so "log out of all
 * devices" and an admin demotion would both be advisory. Here, deleting the key ends the
 * session on the next request.
 *
 * The trade is that auth now depends on Redis. That is a considered exception to
 * MASTER-SPEC §7's degrade-gracefully rule: a session store that "fails open" would treat
 * an unreachable Redis as a valid session. Browsing, rates and the calculator remain up —
 * only authenticated surfaces fail, which is the correct direction to fail in.
 */
import { randomBytes } from 'node:crypto';

import type { Role } from '@prisma/client';
import { cookies } from 'next/headers';

import { env } from '@/lib/env';
import { redis } from '@/lib/redis';

export const SESSION_COOKIE = 'tj_session';

/** §3.3 — 30-day expiry with sliding renewal. */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Admin sessions expire far sooner (Phase 7 SECURITY: "Admin session shorter than customer
 * (8h)"). Set here so the rule lives with the session code rather than in the admin panel.
 */
export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;

/** Renew at most once an hour — every request rewriting the TTL is needless Redis traffic. */
const SLIDING_RENEWAL_THRESHOLD_SECONDS = 60 * 60;

export interface SessionData {
  userId: string;
  role: Role;
  /** Epoch ms. Used to decide whether the sliding window needs extending. */
  createdAt: number;
}

const sessionKey = (sid: string) => `session:${sid}`;
/** Index of a user's live sessions, so "log out everywhere" can find them all. */
const userSessionsKey = (userId: string) => `user-sessions:${userId}`;

function ttlFor(role: Role): number {
  return role === 'ADMIN' ? ADMIN_SESSION_TTL_SECONDS : SESSION_TTL_SECONDS;
}

/**
 * 32 random bytes, base64url.
 *
 * Not a UUID: v4 carries only 122 bits and a recognisable shape. This is 256 bits of
 * unpredictable material, which is what a bearer token needs.
 */
function generateSessionId(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Create a session and set the cookie.
 *
 * §3.3 requires rotation on login and on any privilege change, which is what calling this
 * (rather than mutating an existing session) achieves: a fresh ID means a session fixated
 * before login is worthless.
 */
export async function createSession(
  data: Omit<SessionData, 'createdAt'>,
): Promise<string> {
  const sid = generateSessionId();
  const payload: SessionData = { ...data, createdAt: Date.now() };
  const ttl = ttlFor(data.role);

  await redis
    .multi()
    .set(sessionKey(sid), JSON.stringify(payload), 'EX', ttl)
    .sadd(userSessionsKey(data.userId), sid)
    .expire(userSessionsKey(data.userId), ttl)
    .exec();

  // Next.js 16: cookies() is async (D-002).
  const store = await cookies();
  store.set(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ttl,
  });

  return sid;
}

/** Read the session id from the request cookie. */
export async function getSessionId(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

/**
 * Load the current session, extending it if it is more than an hour old.
 *
 * Returns null for an absent, unknown or expired session — and for an unreachable Redis,
 * which fails closed by design.
 */
export async function getSession(): Promise<SessionData | null> {
  const sid = await getSessionId();
  if (!sid) return null;

  try {
    const raw = await redis.get(sessionKey(sid));
    if (!raw) return null;

    const data = JSON.parse(raw) as SessionData;

    if (Date.now() - data.createdAt > SLIDING_RENEWAL_THRESHOLD_SECONDS * 1000) {
      await touchSession(sid, data);
    }

    return data;
  } catch (err) {
    console.error(
      `[session] lookup failed, treating as signed out: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/** Sliding renewal — extend the Redis TTL and the cookie together. */
async function touchSession(sid: string, data: SessionData): Promise<void> {
  const ttl = ttlFor(data.role);
  const refreshed: SessionData = { ...data, createdAt: Date.now() };

  await redis
    .multi()
    .set(sessionKey(sid), JSON.stringify(refreshed), 'EX', ttl)
    .expire(userSessionsKey(data.userId), ttl)
    .exec();

  const store = await cookies();
  store.set(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ttl,
  });
}

/**
 * End the current session.
 *
 * §3.3: "/api/auth/logout deletes the Redis key — not just the cookie." Clearing only the
 * cookie leaves a valid session id that anyone who captured it can keep using.
 */
export async function destroySession(): Promise<void> {
  const sid = await getSessionId();

  if (sid) {
    try {
      const raw = await redis.get(sessionKey(sid));
      if (raw) {
        const { userId } = JSON.parse(raw) as SessionData;
        await redis
          .multi()
          .del(sessionKey(sid))
          .srem(userSessionsKey(userId), sid)
          .exec();
      } else {
        await redis.del(sessionKey(sid));
      }
    } catch (err) {
      console.error(
        `[session] destroy failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/**
 * Revoke every session for a user — "log out of all devices" (§3.3).
 *
 * Also the correct response to a password change or a role change.
 */
export async function destroyAllSessions(userId: string): Promise<number> {
  try {
    const sids = await redis.smembers(userSessionsKey(userId));
    if (sids.length === 0) return 0;

    await redis
      .multi()
      .del(...sids.map(sessionKey))
      .del(userSessionsKey(userId))
      .exec();

    return sids.length;
  } catch (err) {
    console.error(
      `[session] bulk destroy failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 0;
  }
}

/**
 * Rotate on privilege change: drop every existing session, then issue a fresh one.
 * §3.3 requires this so a token issued as CUSTOMER cannot survive a promotion to ADMIN.
 */
export async function rotateSession(
  data: Omit<SessionData, 'createdAt'>,
): Promise<string> {
  await destroyAllSessions(data.userId);
  return createSession(data);
}
