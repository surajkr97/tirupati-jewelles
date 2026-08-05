/**
 * Redis-backed fixed-window rate limiting.
 * Created by Phase 3 (specs/03-auth.md §3.2). Key shape from MASTER-SPEC §7 (`rl:{...}`).
 *
 * Phase 9 §9.1 extends this to a global per-IP limit in the proxy.
 *
 * ── A deliberate departure from the usual cache-aside rule ──
 * Everywhere else in this codebase, Redis being unavailable must degrade gracefully
 * (`cached()` never throws). Rate limiting is the exception: if the limiter cannot count,
 * "fail open" means an attacker who can pressure Redis gets unlimited OTP attempts.
 *
 * So this **fails closed** — a Redis fault denies the request. The blast radius is bounded
 * because only auth and billing routes use it; browsing, rates and the calculator stay up.
 */
import { redis } from '@/lib/redis';

export interface RateLimitRule {
  /** Identifier for the counter, e.g. `otp:send:+919876543210`. */
  key: string;
  /** Maximum permitted events in the window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets. */
  retryAfter: number;
}

/**
 * Consume one unit against a rule.
 *
 * INCR followed by EXPIRE on first write is a fixed window. It permits a burst at a window
 * boundary (up to 2× the limit across two adjacent windows), which is an accepted trade
 * for the simplicity — a sliding-window log costs a sorted set per identifier.
 */
export async function consume(rule: RateLimitRule): Promise<RateLimitResult> {
  const key = `rl:${rule.key}`;

  try {
    const pipeline = redis.multi();
    pipeline.incr(key);
    pipeline.ttl(key);
    const results = await pipeline.exec();

    if (!results) throw new Error('Redis pipeline returned no result');

    const countRaw = results[0]?.[1];
    const ttlRaw = results[1]?.[1];
    const count = typeof countRaw === 'number' ? countRaw : Number(countRaw);
    let ttl = typeof ttlRaw === 'number' ? ttlRaw : Number(ttlRaw);

    // A fresh counter has no TTL yet (-1), so give it one. Without this the key is
    // immortal and the identifier is locked out forever after one burst.
    if (ttl < 0) {
      await redis.expire(key, rule.windowSeconds);
      ttl = rule.windowSeconds;
    }

    return {
      allowed: count <= rule.limit,
      remaining: Math.max(0, rule.limit - count),
      retryAfter: ttl,
    };
  } catch (err) {
    console.error(
      `[rate-limit] FAILING CLOSED for "${rule.key}": ${err instanceof Error ? err.message : String(err)}`,
    );
    return { allowed: false, remaining: 0, retryAfter: rule.windowSeconds };
  }
}

/**
 * Check every rule, consuming all of them.
 *
 * All counters are consumed even when an earlier one already denied, so a caller cannot
 * discover which specific limit they tripped by watching for a change in behaviour.
 */
export async function consumeAll(rules: RateLimitRule[]): Promise<RateLimitResult> {
  const results = await Promise.all(rules.map(consume));

  const denied = results.filter((r) => !r.allowed);
  if (denied.length > 0) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.max(...denied.map((r) => r.retryAfter)),
    };
  }

  return {
    allowed: true,
    remaining: Math.min(...results.map((r) => r.remaining)),
    retryAfter: 0,
  };
}

/** Clear a counter. Used after a successful login so one good password resets the window. */
export async function reset(key: string): Promise<void> {
  try {
    await redis.del(`rl:${key}`);
  } catch {
    // A failed reset only means the user waits out the window. Never fatal.
  }
}

/** The limits §3.2 specifies, in one place so SECURITY can audit them at a glance. */
export const OTP_LIMITS = {
  /** 3 sends per identifier per 15 min. */
  sendPerIdentifier: (identifier: string): RateLimitRule => ({
    key: `otp:send:id:${identifier}`,
    limit: 3,
    windowSeconds: 15 * 60,
  }),
  /** 10 sends per IP per hour. */
  sendPerIp: (ip: string): RateLimitRule => ({
    key: `otp:send:ip:${ip}`,
    limit: 10,
    windowSeconds: 60 * 60,
  }),
  /** 20 verify attempts per IP per hour. */
  verifyPerIp: (ip: string): RateLimitRule => ({
    key: `otp:verify:ip:${ip}`,
    limit: 20,
    windowSeconds: 60 * 60,
  }),
} as const;

/** Login attempts. Not named in §3.2, but an unlimited password oracle is worse than none. */
export const LOGIN_LIMITS = {
  perIdentifier: (identifier: string): RateLimitRule => ({
    key: `login:id:${identifier}`,
    limit: 10,
    windowSeconds: 15 * 60,
  }),
  perIp: (ip: string): RateLimitRule => ({
    key: `login:ip:${ip}`,
    limit: 30,
    windowSeconds: 15 * 60,
  }),
} as const;
