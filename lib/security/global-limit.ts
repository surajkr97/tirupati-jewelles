/**
 * The outer wall — a global per-IP rate limit applied in `proxy.ts`.
 * Created by Phase 9 (specs/09-hardening.md §9.1: "Global rate limiting in proxy, per-IP,
 * Redis-backed. Tighter limits on auth and bill routes."). Closes DEBT-012.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THIS LIMITER FAILS **OPEN**. THE ONE IN lib/auth/rate-limit.ts FAILS **CLOSED**.
 *  THAT DIFFERENCE IS DELIBERATE. DO NOT "FIX" THE INCONSISTENCY.
 *
 *  They are different kinds of control:
 *
 *    lib/auth/rate-limit.ts  protects against CREDENTIAL GUESSING.
 *                            Losing it is a VULNERABILITY — an attacker who can pressure
 *                            Redis would get unlimited OTP attempts. So it denies.
 *
 *    this module              protects against FLOODING.
 *                            Losing it is a lost MITIGATION. If it denied on a Redis
 *                            fault it would turn "Redis is down" into "the site is down",
 *                            for every visitor on every page — contradicting
 *                            MASTER-SPEC §7, §9.5's "Redis down → slower, functional",
 *                            and Phase 1 TEST's verified degradation.
 *
 *  The per-route limiters still run inside the handlers, so auth stays protected on this
 *  path regardless of what happens here.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { ensureReady, redis } from '@/lib/redis';

export interface GlobalLimitTier {
  /** Short name, used in the Redis key and in the log line. */
  name: string;
  limit: number;
  windowSeconds: number;
}

/**
 * The tiers, widest last. The first match wins, so order matters.
 *
 * ── On the sizing, which is not arbitrary ──
 * These sit OUTSIDE the per-route limiters, which are much tighter and semantic (login is
 * 30 per IP per 15 min, OTP sends 3 per identifier per 15 min). This wall exists to stop a
 * flood before it reaches a handler, not to be the primary control — so it is deliberately
 * loose enough that no real person can reach it.
 *
 * That looseness matters more here than in most applications. A large share of this shop's
 * customers arrive over carrier-grade NAT, where one public address is thousands of people
 * on the same mobile network. A per-IP limit tuned for a single browser blocks a
 * neighbourhood and reports as "the site is broken", not as "an attack was stopped".
 */
export const GLOBAL_TIERS: readonly GlobalLimitTier[] = [
  /**
   * Auth. §9.1: "Tighter limits on auth and bill routes."
   * Still well above human use — a signup involves perhaps a dozen requests.
   */
  { name: 'auth', limit: 60, windowSeconds: 60 },

  /**
   * Bills and invoices. `/bills/{key}` is a capability URL handed to customers over
   * WhatsApp, so it is public by design and worth a ceiling of its own.
   */
  { name: 'bill', limit: 60, windowSeconds: 60 },

  /**
   * `/api/health`. §9.4 puts uptime monitoring on it.
   *
   * A tier rather than an exemption (Phase 9 TEST, finding 2). The endpoint runs a Postgres
   * query and a Redis ping on every hit, so an uncounted one is a connection-pool
   * exhaustion primitive aimed at exactly the two dependencies §9.5 is about — measured at
   * 700 requests from one address, all served.
   *
   * It gets its OWN bucket, which is the part that matters: sharing `default` would let
   * unrelated traffic from the monitor's address starve it, and a monitor that receives a
   * 429 reports a false outage. 600/min is roughly 300× what any monitor does.
   */
  { name: 'health', limit: 600, windowSeconds: 60 },

  /**
   * Everything else. 10 requests a second, sustained, from one address.
   *
   * A single page view can be a dozen proxy-visible requests once RSC payloads are counted,
   * so this is roughly a very fast human browsing hard, and nowhere near a flood.
   */
  { name: 'default', limit: 600, windowSeconds: 60 },
] as const;

const AUTH_PREFIXES = [
  '/api/auth/',
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/claim/',
];

const BILL_PREFIXES = ['/bills/', '/api/admin/bills', '/admin/bills'];

/** Looked up by name so adding a tier cannot silently reshuffle a positional destructure. */
function tier(name: string): GlobalLimitTier {
  const found = GLOBAL_TIERS.find((t) => t.name === name);
  if (!found) throw new Error(`Unknown rate-limit tier: ${name}`);
  return found;
}

export function tierFor(pathname: string): GlobalLimitTier {
  if (pathname === '/api/health') return tier('health');
  if (AUTH_PREFIXES.some((p) => pathname.startsWith(p))) return tier('auth');
  if (BILL_PREFIXES.some((p) => pathname.startsWith(p))) return tier('bill');
  return tier('default');
}

/**
 * Is this a speculative navigation rather than a person asking for something?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THIS NO LONGER EXEMPTS ANYTHING FROM THE LIMIT. IT SELECTS A SEPARATE BUCKET.
 *
 *  ── The defect this replaces (Phase 9 TEST, findings 1 and 2) ──
 *  These three headers used to make `shouldSkip()` return true, which removed the request
 *  from the limiter entirely. None of them is a capability — any client can set one — so
 *  the "global" limit §9.1 requires was opt-out for anyone who read this file. Measured
 *  over real HTTP against a production build:
 *
 *      150 requests to /login carrying `purpose: prefetch`  ->  150 x 200   (tier is 60)
 *       5 from the same address WITHOUT the header          ->    5 x 200
 *
 *  The second line is the proof: the budget was untouched, so those 150 were never counted.
 *
 *  ── Why the exclusion was still RIGHT, and what changed ──
 *  The reasoning was sound and is preserved. `next/link` really does fire one prefetch per
 *  link in the viewport, so a catalogue page really can produce dozens of proxy-visible
 *  requests per navigation, and charging them to the human's budget would break the site
 *  while somebody scrolls. What was wrong was the conclusion: "must not consume a human's
 *  budget" is not "must not be counted".
 *
 *  So prefetches get their own counter at the same tier limits. A person browsing hard is
 *  unaffected — their prefetches no longer touch the budget their clicks spend — and a
 *  flood wearing the header is refused exactly as fast as one that is not.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function isPrefetch(request: Request): boolean {
  const headers = request.headers;

  return (
    Boolean(headers.get('next-router-prefetch')) ||
    headers.get('purpose') === 'prefetch' ||
    headers.get('x-purpose') === 'prefetch'
  );
}

export interface GlobalLimitResult {
  allowed: boolean;
  tier: GlobalLimitTier;
  retryAfter: number;
}

/**
 * Count one request against the tier for this path.
 *
 * Fixed window via INCR + EXPIRE, the same shape as the auth limiter: it permits a burst
 * across a window boundary, which is an accepted trade at this scale.
 */
export async function consumeGlobalLimit(
  ip: string,
  pathname: string,
  options: { prefetch?: boolean } = {},
): Promise<GlobalLimitResult> {
  const tier = tierFor(pathname);

  /**
   * Prefetches count against their own bucket at the same limit — see `isPrefetch`. This
   * is what lets the exclusion keep its benefit (a scrolling customer's speculative
   * requests never spend the budget their clicks need) without keeping its hole (a flood
   * that sets the header is still refused at the tier limit).
   */
  const key = `rl:global:${tier.name}:${options.prefetch ? 'prefetch:' : ''}${ip}`;

  try {
    /**
     * Bounded wait for the first connection (SEC-008). Without it the first request after
     * every deploy is counted against a socket that is still opening.
     */
    await ensureReady();

    const results = await redis.multi().incr(key).ttl(key).exec();
    if (!results) throw new Error('Redis pipeline returned no result');

    const count = Number(results[0]?.[1]);
    let ttl = Number(results[1]?.[1]);

    // A fresh counter has no TTL. Without this the key is immortal and the address is
    // locked out permanently after one burst.
    if (!Number.isFinite(ttl) || ttl < 0) {
      await redis.expire(key, tier.windowSeconds);
      ttl = tier.windowSeconds;
    }

    return { allowed: count <= tier.limit, tier, retryAfter: ttl };
  } catch {
    /**
     * FAIL OPEN. See the block at the top of this file — this is the whole point, and it
     * is the opposite of what `lib/auth/rate-limit.ts` does.
     *
     * Deliberately not logged: a Redis outage would emit one line per request, which buries
     * the failure that matters. `/api/health` already reports Redis as down, and §9.4 alerts
     * on it.
     */
    return { allowed: true, tier, retryAfter: 0 };
  }
}
