/**
 * §9.1 item 1 — the required response headers.
 * Written by TEST for Phase 9 from `specs/09-hardening.md`, not from `next.config.ts`.
 *
 * The checklist names six headers and one prohibition:
 *
 *   - CSP with **no `unsafe-eval`**. `unsafe-inline` for styles only if Tailwind forces
 *     it, "and document why".
 *   - HSTS `max-age=63072000; includeSubDomains; preload`
 *   - `X-Content-Type-Options: nosniff`
 *   - `Referrer-Policy: strict-origin-when-cross-origin`
 *   - `X-Frame-Options: DENY`
 *   - `Permissions-Policy` denying camera, mic, geolocation
 *
 * Every value below is quoted from that list. Where the spec gives an exact string it is
 * asserted exactly; where it gives a property ("no unsafe-eval") the property is asserted,
 * so a reworded policy that still satisfies §9.1 keeps passing.
 *
 * ── Two layers, because a config is not a response ──
 *
 *   1. CONFIG — `next.config.ts`'s `headers()` is what Next bakes into the build. Asserted
 *      under a production environment, since three of the six are production-only.
 *   2. LIVE — the same headers read off a real `next start`, gated on `PROD_BASE_URL`.
 *      A config that declares a header and a server that sends one are different claims,
 *      and §9.1 is a claim about responses. Run it with:
 *
 *        pnpm build && pnpm start &
 *        PROD_BASE_URL=http://localhost:3000 pnpm test test/security-headers.test.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}

/**
 * Load the config under a chosen environment.
 *
 * `next.config.ts` computes `isProduction` at module scope, so the environment has to be
 * in place before the import — the same reason `lib/http.test.ts` re-imports for its
 * production case.
 */
async function headerRules(nodeEnv: 'production' | 'development'): Promise<HeaderRule[]> {
  vi.stubEnv('NODE_ENV', nodeEnv);
  vi.resetModules();

  const config = (await import('@/next.config')).default;
  expect(config.headers, 'next.config.ts defines no headers() at all').toBeTypeOf(
    'function',
  );

  return (await config.headers!()) as unknown as HeaderRule[];
}

/** The header set that applies to an ordinary page path. */
async function headersFor(
  nodeEnv: 'production' | 'development',
  pathname = '/rates',
): Promise<Map<string, string>> {
  const rules = await headerRules(nodeEnv);
  const out = new Map<string, string>();

  for (const rule of rules) {
    if (!matchesEveryPath(rule.source) && !rule.source.startsWith(pathname)) continue;
    for (const { key, value } of rule.headers) out.set(key.toLowerCase(), value);
  }

  return out;
}

/**
 * Does this `source` cover every route?
 *
 * §9.1 does not say "on the home page" — a header that guards one path and not the next is
 * not the control being asked for. Accepts the two spellings Next uses for "everything".
 */
function matchesEveryPath(source: string): boolean {
  return source === '/:path*' || source === '/(.*)';
}

/** Split a policy into `{ directive: [values] }`. */
function directives(policy: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};

  for (const part of policy.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) out[name.toLowerCase()] = values;
  }

  return out;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('§9.1 — the six headers are declared for every route', () => {
  it('applies its header rule to every path, not to a subset', async () => {
    const rules = await headerRules('production');

    expect(
      rules.some((rule) => matchesEveryPath(rule.source)),
      `no rule covers every path; sources were ${rules.map((r) => r.source).join(', ')}`,
    ).toBe(true);
  });

  it.each([
    ['X-Content-Type-Options', 'nosniff'],
    ['X-Frame-Options', 'DENY'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ])('sends %s: %s', async (key, value) => {
    // Quoted verbatim from the §9.1 checklist. These three have no acceptable variant.
    expect((await headersFor('production')).get(key.toLowerCase())).toBe(value);
  });

  it('sends HSTS with the exact max-age, subdomains and preload §9.1 specifies', async () => {
    const value = (await headersFor('production')).get('strict-transport-security');

    expect(value).toBeDefined();

    // Asserted by parts rather than as one string: the order of the attributes is not
    // meaningful to a browser, but every one of the three is required.
    expect(value).toContain('max-age=63072000');
    expect(value).toContain('includeSubDomains');
    expect(value).toContain('preload');
  });

  it('does not send HSTS in development', async () => {
    /**
     * Not a §9.1 requirement — a correctness one that protects the developer. `preload`
     * plus `includeSubDomains` from `localhost` pins every other service on that machine
     * to https, and the pin outlives the experiment that set it.
     */
    expect((await headersFor('development')).has('strict-transport-security')).toBe(
      false,
    );
  });

  it('denies camera, microphone and geolocation', async () => {
    const policy = (await headersFor('production')).get('permissions-policy');

    expect(policy).toBeDefined();

    // `()` is an empty allowlist — the feature is denied to this document and to anything
    // it embeds. `self` would NOT satisfy "denying".
    for (const feature of ['camera', 'microphone', 'geolocation']) {
      expect(policy, `${feature} is not denied`).toMatch(
        new RegExp(`\\b${feature}=\\(\\s*\\)`),
      );
    }
  });
});

describe('§9.1 — the Content Security Policy', () => {
  it('is sent at all', async () => {
    expect((await headersFor('production')).get('content-security-policy')).toBeDefined();
  });

  it('contains no unsafe-eval anywhere in production', async () => {
    /**
     * The one absolute in §9.1's CSP line. Asserted across the WHOLE policy rather than on
     * `script-src` alone, because `default-src` and `worker-src` grant it just as
     * effectively and a policy can move it without anyone noticing.
     */
    const policy = (await headersFor('production')).get('content-security-policy') ?? '';

    expect(policy).not.toContain('unsafe-eval');
  });

  it('confines its dangerous fallbacks — no wildcard default-src, no object-src', async () => {
    // Not spelled out in §9.1, but a CSP with `default-src *` satisfies every assertion
    // above while controlling nothing. This is the positive control for the policy itself.
    const parsed = directives(
      (await headersFor('production')).get('content-security-policy') ?? '',
    );

    expect(parsed['default-src'], 'no default-src').toBeDefined();
    expect(parsed['default-src']).not.toContain('*');
    expect(parsed['object-src'] ?? []).toContain("'none'");
    expect(parsed['frame-ancestors'] ?? []).toContain("'none'");
  });

  it('allows inline styles, which is the one relaxation §9.1 permits', async () => {
    const parsed = directives(
      (await headersFor('production')).get('content-security-policy') ?? '',
    );

    // "unsafe-inline for styles only if Tailwind forces it" — Tailwind v4 injects styles
    // inline and `next/font` emits an inline @font-face block, so this is expected.
    expect(parsed['style-src'] ?? []).toContain("'unsafe-inline'");
  });

  it('documents any inline-script relaxation, which §9.1 requires and does not forbid', async () => {
    /**
     * ── Reading §9.1 honestly ──
     *
     * The checklist says `unsafe-inline` "for styles only", and this policy also carries it
     * on `script-src`. That is a DEVIATION from the literal wording, made deliberately: the
     * nonce alternative disables ISR (Next's own CSP guide says so), which would put §9.2's
     * TTFB budget out of reach. The Phase 9 SECURITY pass required this choice and D-033
     * records it.
     *
     * So the assertion is the one §9.1 actually enforces — "and document why". If the
     * relaxation is present, the written reason must be present too. Delete D-033 and this
     * fails, which is the only way a documentation requirement can be made to hold.
     */
    const parsed = directives(
      (await headersFor('production')).get('content-security-policy') ?? '',
    );

    if (!(parsed['script-src'] ?? []).includes("'unsafe-inline'")) return;

    const { readFileSync } = await import('node:fs');
    const decisions = readFileSync('specs/DECISIONS.md', 'utf8');

    expect(
      /D-033/.test(decisions),
      "script-src carries 'unsafe-inline' but DECISIONS.md no longer explains why",
    ).toBe(true);
    expect(decisions).toMatch(/unsafe-inline/);
  });
});

/**
 * ── Layer 2: a real production server ──
 *
 * Skipped unless `PROD_BASE_URL` points at one. A declared header and a sent header are
 * different facts, and §9.1 is about what a browser receives.
 */
const live = process.env.PROD_BASE_URL ? describe : describe.skip;

live('§9.1 — the headers a real production server actually sends', () => {
  const base = process.env.PROD_BASE_URL ?? '';

  const REQUIRED = [
    'content-security-policy',
    'strict-transport-security',
    'x-content-type-options',
    'x-frame-options',
    'referrer-policy',
    'permissions-policy',
  ];

  /**
   * A page, an API route, a capability URL, and a path that does not exist.
   *
   * The 404 is deliberate. Next renders it through a different path from a matched route,
   * and an error page is exactly where a missing `X-Frame-Options` would go unnoticed.
   */
  it.each(['/', '/rates', '/collections', '/api/rates', '/bills/not-a-key', '/nope'])(
    'sends all six on %s',
    async (path) => {
      const response = await fetch(`${base}${path}`, { redirect: 'manual' });

      for (const header of REQUIRED) {
        expect(response.headers.get(header), `${path} is missing ${header}`).toBeTruthy();
      }

      expect(response.headers.get('content-security-policy')).not.toContain(
        'unsafe-eval',
      );
    },
  );

  it('still sends them on a response the proxy generates itself', async () => {
    /**
     * `/admin` with no session is rewritten by `proxy.ts` before any route renders, and the
     * 429 from the global limiter is manufactured there outright. A short-circuited
     * response is the one most likely to escape a header rule declared in `next.config.ts`,
     * so it is the one worth checking.
     */
    const response = await fetch(`${base}/admin`, { redirect: 'manual' });

    for (const header of REQUIRED) {
      expect(response.headers.get(header), `/admin is missing ${header}`).toBeTruthy();
    }
  });
});
