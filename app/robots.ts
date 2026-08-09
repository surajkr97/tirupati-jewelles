/**
 * robots.txt — Phase 9 §9.6.
 *
 * §9.6: "`sitemap.xml`, `robots.txt` — `/admin` and `/bills` disallowed."
 *
 * ── `Disallow` is not a security control, and nothing here is relied on as one ──
 * Every path below is already protected by something that refuses the request. `/admin/*`
 * answers 404 without an admin session, in the proxy AND re-checked in each handler (§3.6,
 * §7.1). `/bills/{key}` needs a valid HMAC signature or an owning session (DEBT-021). The
 * `noindex` headers those routes already send are what actually keeps them out of an index,
 * because a crawler that ignores robots.txt still sees the header.
 *
 * What this file adds is that a well-behaved crawler does not SPEND requests on them, and
 * does not put a bill URL in a referrer log on its way to being refused. Listing a secret
 * path in robots.txt is a classic way to advertise it — none of these is a secret: `/admin`
 * is guessable and `/bills` is a prefix, not a key.
 */
import type { MetadataRoute } from 'next';

import { absoluteUrl } from '@/lib/seo';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/admin',
          '/bills',
          // Not named by §9.6, and they belong for the same reason. `/account/*` is one
          // customer's order history, `/claim/*` carries a single-use token that a crawler
          // fetching it would BURN (DEBT-011), and a calculator share is a private link
          // someone sent to one person — `noindex` already, SEC-012.
          '/account',
          '/claim',
          '/calculator/s',
          '/api',
        ],
      },
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
    host: absoluteUrl('/'),
  };
}
