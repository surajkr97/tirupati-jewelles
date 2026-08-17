/**
 * GET /api/social/reel-cover?u=<encoded Instagram CDN url> — proxies a reel's cover frame.
 * Created by Stage 7 (D-124).
 *
 * ── Why this route exists at all ──
 *
 * Instagram serves thumbnails from per-request hostnames (`instagram.fdel93-3.fna.fbcdn.net`
 * one minute, another shard the next) on signed URLs that expire. `next.config.ts` builds
 * `images.remotePatterns` from `ALLOWED_IMAGE_HOSTS` and its comment bans wildcard hostnames,
 * so there is no honest allowlist entry to write — the host set is not knowable in advance.
 *
 * Fetching server-side and returning the bytes from this origin means the browser only ever
 * loads `/_next/image?url=/api/social/reel-cover…`, which `img-src 'self'` already permits.
 * The reels feature therefore opens NO CSP directive and adds NO image host.
 *
 * ── This is a URL-taking fetcher, which is an SSRF sink ──
 *
 * A route that fetches a caller-supplied URL is the textbook server-side request forgery
 * shape: left open it will happily fetch `http://169.254.169.254/…` (cloud metadata),
 * `http://localhost:6379` (this stack's own Redis) or any internal address, and hand the
 * response back to an anonymous caller.
 *
 * The defence here is an allowlist of hosts, not a denylist of addresses. A denylist of
 * private ranges loses to DNS rebinding and to the many spellings of localhost; an allowlist
 * cannot be talked around, because a host that is not Instagram's simply never matches. The
 * protocol is pinned to https and redirects are refused, so a permitted host cannot bounce
 * the request somewhere else after the check has passed.
 */
import { NextResponse } from 'next/server';

/**
 * Instagram's CDN hostnames, as suffixes.
 *
 * Suffix matching with a leading dot, plus the bare apex, so `evil-cdninstagram.com` and
 * `cdninstagram.com.attacker.test` both fail — the first has no dot boundary, the second
 * does not end here. This is the check the whole route rests on.
 */
const ALLOWED_HOST_SUFFIXES = ['.cdninstagram.com', '.fbcdn.net'];
const ALLOWED_HOSTS = ['cdninstagram.com', 'fbcdn.net'];

function isAllowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    ALLOWED_HOSTS.includes(host) ||
    ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
  );
}

/** Covers are immutable for as long as their signed URL lives; a day is well inside that. */
const CACHE_CONTROL = 'public, max-age=86400, stale-while-revalidate=604800';

export async function GET(request: Request) {
  // `new URL(request.url)` rather than `NextRequest.nextUrl`: identical here, and it keeps
  // the handler a plain `Request` consumer so the allowlist can be tested without
  // constructing framework objects. A security check nobody can unit-test easily is a
  // security check that stops being tested.
  const raw = new URL(request.url).searchParams.get('u');
  if (!raw) return new NextResponse('Missing u', { status: 400 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return new NextResponse('Bad url', { status: 400 });
  }

  // https only. Without this, `http://` to an allowed host is still a cleartext fetch, and
  // more importantly the parser accepts schemes like `file:` that have no host at all.
  if (target.protocol !== 'https:') {
    return new NextResponse('Forbidden scheme', { status: 400 });
  }

  if (!isAllowedHost(target.hostname)) {
    return new NextResponse('Forbidden host', { status: 400 });
  }

  try {
    const upstream = await fetch(target, {
      // `manual`: a 302 from an allowed host to an internal address would otherwise be
      // followed automatically, and the allowlist would have checked only the first hop.
      redirect: 'manual',
      headers: { Accept: 'image/avif,image/webp,image/jpeg,image/*' },
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 86400 },
    });

    if (!upstream.ok) return new NextResponse('Upstream error', { status: 502 });

    // Return an image or nothing. Without this the route would relay whatever the upstream
    // sent — HTML, JSON, anything — from our own origin.
    const contentType = upstream.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/')) {
      return new NextResponse('Not an image', { status: 502 });
    }

    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': CACHE_CONTROL,
        // The bytes are an image and must never be interpreted as anything else.
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new NextResponse('Fetch failed', { status: 502 });
  }
}
