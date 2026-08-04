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

  // Phase 6 §6.5 restricts these to ALLOWED_IMAGE_HOSTS. Empty until then: an admin
  // cannot supply an image URL until Phase 7, so nothing legitimate is being blocked.
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [],
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
