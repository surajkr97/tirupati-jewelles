import type { NextConfig } from 'next';

/**
 * Next.js configuration.
 * Created by Phase 1 (specs/01-cleanup-scaffold.md §1.4).
 *
 * Security headers are Phase 9 §9.1 — CSP, HSTS, Permissions-Policy and the rest land
 * there, not here. The three below are the ones with no downside to setting on day one.
 */
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
    remotePatterns: (process.env.ALLOWED_IMAGE_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean)
      .map((hostname) => ({ protocol: 'https' as const, hostname })),
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
