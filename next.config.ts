import bundleAnalyzer from '@next/bundle-analyzer';
import type { NextConfig } from 'next';

/**
 * Next.js configuration.
 * Created by Phase 1 (specs/01-cleanup-scaffold.md §1.4).
 * Security headers completed by Phase 9 (specs/09-hardening.md §9.1).
 * Bundle analysis added by Phase 9 (§9.2).
 */

/**
 * §9.2: "`@next/bundle-analyzer`; remove anything unjustified."
 *
 * Behind `ANALYZE=true` so it costs an ordinary build nothing — it only writes its report
 * when asked. `pnpm build:analyze` opens three treemaps (client, nodejs, edge).
 *
 * It exists because "the bundle is too big" is not an actionable statement. §9.2 sets a
 * 180 kB gzipped budget per route and the measured figure is 278.6 kB, so something has to
 * be named before it can be removed — and the first guess (that a server-only library such
 * as `@react-pdf/renderer` had leaked into a client chunk) was checked and found wrong.
 */
const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

/**
 * `next build` sets NODE_ENV=production, so this is the build-time environment rather than
 * the runtime one — which is what we want: these headers are baked into the build.
 */
const isProduction = process.env.NODE_ENV === 'production';

/** The image hosts, shared with `images.remotePatterns` below so the two cannot disagree. */
const imageHosts = (process.env.ALLOWED_IMAGE_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);

/**
 * Content Security Policy.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHY THERE IS NO NONCE, AND WHY `unsafe-inline` IS ON script-src
 *
 *  Recorded in full as D-033; the short version, because the nonce recipe is the first
 *  thing Next's own CSP guide shows and will otherwise be "fixed" back in:
 *
 *  A nonce forces EVERY page to render dynamically — Next's guide says so outright:
 *  "Static optimization and Incremental Static Regeneration (ISR) are disabled." This
 *  storefront is built on ISR (`/` and `/rates` at 300s, `/collections`,
 *  `/products/[slug]`, `/policies/[slug]` at 600s), and §9.2 sets LCP < 2.0s and
 *  TTFB < 400ms on throttled 4G. Adopting a nonce would satisfy §9.1 and quietly make
 *  §9.2 unreachable — nothing errors, the site just stops being cached.
 *
 *  Worse: a nonce written into a CACHED page is a fixed string while the header sent with
 *  each request is fresh, so every request after the first serves HTML whose nonce does not
 *  match and the browser blocks every script. The page renders and never hydrates.
 *
 *  A prerendered page here carries four inline <script> tags holding the RSC flight
 *  payload, with no nonce and no `integrity` — measured, not assumed. `script-src 'self'`
 *  alone blocks them. Next's experimental SRI does not help: it applies integrity to
 *  external scripts by `src`, and an inline script cannot carry one.
 *
 *  So `unsafe-inline` it is. §9.1 requires that choice be documented, and this is it.
 *  What it costs here is smaller than it looks: there is no `dangerouslySetInnerHTML`
 *  anywhere in the codebase, no `eval`, no user-supplied HTML, and no CDN-loaded scripts —
 *  so this is defence in depth against a future mistake, not a control holding a known
 *  gap shut.
 *
 *  `unsafe-eval` is absent in production, which §9.1 requires without exception. React
 *  needs it in development for error overlays only.
 * ═══════════════════════════════════════════════════════════════════════════
 */
function contentSecurityPolicy(): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],

    // See the block above. 'unsafe-eval' is DEVELOPMENT ONLY.
    'script-src': [
      "'self'",
      "'unsafe-inline'",
      ...(isProduction ? [] : ["'unsafe-eval'"]),
    ],

    // Tailwind v4 injects styles inline, and `next/font` emits an inline @font-face block.
    'style-src': ["'self'", "'unsafe-inline'"],

    /**
     * `data:` for the branded empty-frame placeholders, `blob:` for the local preview an
     * admin sees before an upload finishes. The remote hosts are the same list the image
     * optimiser trusts — most images are served same-origin through `/_next/image`, but a
     * direct URL in a MediaSlot is loaded from the host itself.
     */
    'img-src': ["'self'", 'data:', 'blob:', ...imageHosts.map((h) => `https://${h}`)],

    'font-src': ["'self'", 'data:'],

    /**
     * `connect-src` is the one that breaks a feature if it is wrong.
     *
     * Phase 7 §7.8's signed upload POSTs image bytes from the BROWSER straight to
     * Cloudinary (`components/admin/product-images.tsx` → `grant.url`), which is the whole
     * point of a direct-to-provider upload — the bytes never touch the app server. Omitting
     * this host would block every upload with a CSP violation and no server-side error.
     * Only added when Cloudinary is actually configured.
     *
     * `ws:` in development is the dev server's hot-reload socket.
     */
    'connect-src': [
      "'self'",
      ...(process.env.CLOUDINARY_CLOUD_NAME ? ['https://api.cloudinary.com'] : []),
      ...(isProduction ? [] : ['ws:', 'wss:']),
    ],

    // No plugins, no <base> rewriting, forms can only post to us.
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],

    /**
     * The modern form of `X-Frame-Options: DENY`, which is also still sent below. Browsers
     * that understand CSP enforce this one; the header covers the rest.
     */
    'frame-ancestors': ["'none'"],
  };

  const rendered = Object.entries(directives)
    .map(([directive, values]) => `${directive} ${values.join(' ')}`)
    .join('; ');

  // Would break `http://localhost` in development.
  return isProduction ? `${rendered}; upgrade-insecure-requests` : rendered;
}
const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * Build output directory. `.next` everywhere except when the harness overrides it.
   *
   * `NEXT_PUBLIC_*` values are inlined into the client bundle at compile time, so the only
   * way to test `NEXT_PUBLIC_TICKER_JITTER=false` in a real browser is a second server
   * built with that value. Two `next dev` processes sharing one `.next` corrupt each
   * other, so the Playwright jitter-off server gets its own directory
   * (`playwright.config.ts`). MASTER-SPEC §8 calls the off-switch "your insurance. Keep it
   * working." — that is only true if something checks it.
   *
   * `process.env` is read here rather than through lib/env.ts because this file is
   * evaluated before the app boots and must not pull the server config into the build.
   * ESLint exempts `*.config.ts` for exactly this.
   */
  distDir: process.env.NEXT_DIST_DIR || '.next',

  /**
   * §6.5: "AVIF then WebP; `remotePatterns` restricted to `ALLOWED_IMAGE_HOSTS`."
   *
   * Built from the same environment variable `lib/env.ts` parses, so the optimiser's
   * allowlist and the Phase 7 SSRF check on the admin's URL field cannot drift apart —
   * one of them permitting a host the other rejects is exactly how an image proxy becomes
   * an open redirect.
   *
   * `https` only, and no wildcard hostnames: `remotePatterns` with a permissive host is
   * how a Next image optimiser gets used to fetch arbitrary internal URLs.
   *
   * `process.env` rather than `lib/env.ts` because this file is evaluated before the app
   * boots; ESLint exempts `*.config.ts` for that reason. The value is re-validated by the
   * Zod schema at boot, so a malformed list still fails loudly.
   */
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: imageHosts.map((hostname) => ({
      protocol: 'https' as const,
      hostname,
    })),
  },

  /**
   * §9.1's required header set.
   *
   * Applied to `/:path*` — every response, including static assets. A CSP on a JavaScript
   * file does nothing, but a `nosniff` on one does, and a single rule that cannot miss a
   * route is worth more than a narrower one that can.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy() },

          /**
           * §9.1: `max-age=63072000; includeSubDomains; preload`.
           *
           * Production only. A browser ignores HSTS over plain http, but sending it in
           * development is still the wrong habit — `includeSubDomains` on a machine that
           * also serves other things on localhost would pin them all to https.
           *
           * `preload` is a commitment: once the domain is on the browsers' preload list,
           * removal takes months. That is the point — it closes the very first request,
           * before any header has been seen.
           */
          ...(isProduction
            ? [
                {
                  key: 'Strict-Transport-Security',
                  value: 'max-age=63072000; includeSubDomains; preload',
                },
              ]
            : []),

          // Phase 1's three. Kept as they were.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },

          /**
           * §9.1: deny camera, microphone and geolocation.
           *
           * This shop asks for none of the three, so the honest policy is to refuse them
           * outright — an empty allowlist `()` denies the feature to this document and to
           * everything it embeds. `interest-cohort` is added because a jeweller's customer
           * list is not something to volunteer to an ad-targeting API.
           */
          {
            key: 'Permissions-Policy',
            value:
              'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
          },
        ],
      },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);
