/**
 * The SSRF-guarded image fetcher.
 * Created by Phase 7 (specs/07-admin-panel.md §7.7).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  §7.7: "SECURITY: this field is the highest-risk input in the application."
 *
 *  An admin pastes a URL and the server fetches it. Every control §7.7 lists is here —
 *  https only, host allowlist, private-range rejection, redirect re-validation, 5s
 *  timeout, 10MB cap, magic-byte sniffing — plus the one it does not list, which is the
 *  one that makes the rest work.
 *
 *  ── The DNS-rebinding gap ──
 *  The obvious implementation resolves the hostname, checks the address is public, then
 *  calls `fetch(url)`. That fetch does its OWN DNS lookup. An attacker controlling the
 *  record answers the check with a public address and the fetch with 169.254.169.254, and
 *  every control above ran on the wrong side of the gap.
 *
 *  So: resolve once, validate the address, then connect to THAT ADDRESS via a custom
 *  `lookup` on the agent — with the hostname preserved for TLS SNI and the Host header, so
 *  certificate validation and virtual hosting still work. Redirects are followed by hand,
 *  one hop at a time, re-running the whole check each time. Nothing here ever hands a
 *  hostname to a connect call.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import 'server-only';

import { lookup as dnsLookup } from 'node:dns/promises';
import type { IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';

import { env } from '@/lib/env';
import { isBlockedAddress } from '@/lib/media/ssrf';

/** §7.7: "Timeout 5s, max response 10MB." */
export const FETCH_TIMEOUT_MS = 5_000;
export const MAX_BYTES = 10 * 1024 * 1024;
/** A permitted host that redirects is legitimate; one that redirects five times is not. */
export const MAX_REDIRECTS = 3;

export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'gif';

export type UrlCheckFailure =
  | 'invalid_url'
  | 'scheme_not_https'
  | 'host_not_allowed'
  | 'private_address'
  | 'dns_failed'
  | 'too_many_redirects'
  | 'unreachable'
  | 'too_large'
  | 'not_an_image'
  | 'not_a_video';

export type UrlCheckResult =
  | {
      ok: true;
      url: string;
      format: ImageFormat;
      bytes: number;
      /**
       * The verified body.
       *
       * Added by Phase 8 (§8.3: "Logo from a MediaSlot") — the bill PDF has to embed the
       * logo's actual bytes, and those bytes were already downloaded here to be sniffed.
       * Handing back what was verified is the only way the embedded image is provably the
       * one that passed the check; re-fetching it would re-open the DNS-rebinding gap this
       * whole module exists to close.
       */
      data: Buffer;
    }
  | { ok: false; reason: UrlCheckFailure; detail: string };

/**
 * §7.8: "Accept JPEG, PNG, WebP, AVIF only — checked by magic bytes."
 *
 * §7.7: "Verify the response is actually an image by magic bytes, not by `Content-Type`
 * header — headers are attacker-controlled." A `.php` renamed `.jpg` and served as
 * `image/jpeg` passes every header check and fails here.
 */
function sniffFormat(bytes: Uint8Array): ImageFormat | null {
  const startsWith = (...signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);

  if (startsWith(0xff, 0xd8, 0xff)) return 'jpeg';
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return 'gif';

  // RIFF....WEBP — the format tag is at offset 8, after the container size.
  if (startsWith(0x52, 0x49, 0x46, 0x46)) {
    const tag = String.fromCharCode(...bytes.slice(8, 12));
    if (tag === 'WEBP') return 'webp';
  }

  // ISO-BMFF: `....ftyp<brand>`. AVIF brands are `avif` (still) and `avis` (sequence).
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp') {
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    if (brand === 'avif' || brand === 'avis') return 'avif';
  }

  return null;
}

/** §7.7: "Host must be in `ALLOWED_IMAGE_HOSTS`. Default-deny." */
function isAllowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return env.ALLOWED_IMAGE_HOSTS.some(
    // An exact match, or a subdomain of an allowed host. Never a suffix match on the raw
    // string — `evilres.cloudinary.com.attacker.test` would pass that.
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}

interface Resolved {
  url: URL;
  address: string;
  family: 4 | 6;
}

/**
 * Validate one URL and resolve it to a single verified IP.
 *
 * Everything a caller needs to connect safely comes out of here; nothing downstream is
 * allowed to look the hostname up again.
 */
async function validateAndResolve(
  raw: string,
): Promise<
  | { ok: true; resolved: Resolved }
  | { ok: false; reason: UrlCheckFailure; detail: string }
> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid_url', detail: 'Not a valid URL.' };
  }

  // §7.7: "Scheme must be `https`. Reject `http`, `file`, `data`, `gopher`, `ftp`."
  // An allowlist of one, so a scheme nobody thought of is rejected by default.
  if (url.protocol !== 'https:') {
    return {
      ok: false,
      reason: 'scheme_not_https',
      detail: `Only https is allowed (got ${url.protocol.replace(':', '') || 'none'}).`,
    };
  }

  if (!isAllowedHost(url.hostname)) {
    return {
      ok: false,
      reason: 'host_not_allowed',
      detail: `${url.hostname} is not an allowed image host.`,
    };
  }

  /**
   * A literal IP in the URL never reaches DNS, so it is checked directly. `[::1]` arrives
   * from `URL` with the brackets still on.
   */
  const literal = url.hostname.replace(/^\[|\]$/g, '');

  let address: string;
  let family: 4 | 6;

  if (isBlockedAddress(literal) && /^[\d.]+$|:/.test(literal)) {
    return {
      ok: false,
      reason: 'private_address',
      detail: `${literal} is not routable.`,
    };
  }

  try {
    const record = await dnsLookup(literal, { verbatim: true });
    address = record.address;
    family = record.family === 6 ? 6 : 4;
  } catch {
    return {
      ok: false,
      reason: 'dns_failed',
      detail: `Could not resolve ${url.hostname}.`,
    };
  }

  // §7.7's whole point. A DNS name resolving to 127.0.0.1 dies here.
  if (isBlockedAddress(address)) {
    return {
      ok: false,
      reason: 'private_address',
      detail: `${url.hostname} resolves to a non-routable address.`,
    };
  }

  return { ok: true, resolved: { url, address, family } };
}

/**
 * One request, pinned to an already-verified address.
 *
 * The `lookup` override is the entire mechanism: Node asks for the hostname's address and
 * is handed the one we just checked, so the socket cannot go anywhere else no matter what
 * DNS says a millisecond later. TLS still validates against the hostname — `servername` and
 * the `Host` header both come from the URL — so certificate checking and virtual hosting
 * are unaffected.
 *
 * `node:https` rather than a new dependency: it takes exactly the hook this needs, and
 * AGENTS.md asks that dependencies be justified in the phase file rather than assumed.
 */
/**
 * The pinning hook, extracted so its contract can be tested without a socket.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  IT MUST ANSWER IN WHICHEVER SHAPE THE CALLER ASKED FOR.
 *
 *  `net.connect` invokes a custom `lookup` with `{ all: true }` and then reads
 *  `addresses[0].address`. Handing it the three-argument `(err, address, family)` form —
 *  which is what this did — makes that read `undefined`, and the connection dies with
 *  **"Invalid IP address: undefined"**.
 *
 *  The consequence was not subtle: `checkImageUrl` failed on EVERY url, so every way of
 *  getting an image into this application was broken — pasting one into a media slot,
 *  pasting one onto a product, `confirmUpload` after a successful Cloudinary upload, and
 *  the invoice logo (which fails soft, so bills quietly printed without it).
 *
 *  It survived Phase 7's 47-assertion SSRF suite because every one of those assertions is a
 *  REJECTION: the test server speaks http, and the scheme check returns long before
 *  anything connects. Nothing ever exercised a successful fetch, so the one line that
 *  performs it was never run. The pinning test that exists calls the hook with `{}` — the
 *  one options shape `net.connect` never uses.
 *
 *  The pinning property is unchanged: both shapes return only the single address that has
 *  already been validated, so the socket still cannot follow a rebound DNS answer.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function pinnedLookup(address: string, family: 4 | 6) {
  return (
    _hostname: string,
    options: unknown,
    callback: (...args: unknown[]) => void,
  ): void => {
    if (options && typeof options === 'object' && (options as { all?: boolean }).all) {
      callback(null, [{ address, family }]);
      return;
    }

    callback(null, address, family);
  };
}

function requestPinned(
  url: URL,
  address: string,
  family: 4 | 6,
  /** `video/*` for `checkVideoUrl`; the header is a hint, and the answer is verified anyway. */
  accept = 'image/*',
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: 'GET',
        headers: { accept },
        // Node passes this straight to `net.connect`. It is never asked to resolve again.
        lookup: pinnedLookup(address, family) as never,
        timeout: FETCH_TIMEOUT_MS,
      },
      resolve,
    );

    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy(new Error(`Timed out after ${FETCH_TIMEOUT_MS}ms.`));
    });
    request.end();
  });
}

/**
 * Fetch and validate an image URL.
 *
 * Returns the final URL after redirects — the caller stores that, so the stored value is
 * the one that was actually verified rather than one that merely pointed at it.
 */
export async function checkImageUrl(raw: string): Promise<UrlCheckResult> {
  let current = raw;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const validated = await validateAndResolve(current);
    if (!validated.ok) return validated;

    const { url, address, family } = validated.resolved;

    let response: IncomingMessage;
    try {
      response = await requestPinned(url, address, family);
    } catch (err) {
      return {
        ok: false,
        reason: 'unreachable',
        detail: err instanceof Error ? err.message : 'Could not reach that URL.',
      };
    }

    const status = response.statusCode ?? 0;

    if (status >= 300 && status < 400) {
      const location = response.headers.location;
      response.destroy();

      if (!location) {
        return { ok: false, reason: 'unreachable', detail: 'Redirect without a target.' };
      }
      // Resolved against the current URL so a relative redirect works, then re-checked
      // from scratch on the next pass — §7.7's "re-validate after redirects".
      current = new URL(location, url).toString();
      continue;
    }

    if (status !== 200) {
      response.destroy();
      return { ok: false, reason: 'unreachable', detail: `The host answered ${status}.` };
    }

    /**
     * Read with a hard cap, in chunks.
     *
     * §7.7 caps the response at 10MB. Enforced while streaming rather than by trusting
     * `content-length`, which is a header and therefore attacker-controlled — a lying
     * header plus a buffer-the-whole-body read is how a 100MB response ends up in memory.
     * The socket is destroyed the moment the cap is passed, so the rest is never received.
     */
    const chunks: Buffer[] = [];
    let total = 0;
    let tooLarge = false;

    try {
      for await (const chunk of response) {
        const bytes = chunk as Buffer;
        total += bytes.length;
        if (total > MAX_BYTES) {
          tooLarge = true;
          response.destroy();
          break;
        }
        chunks.push(bytes);
      }
    } catch (err) {
      if (!tooLarge) {
        return {
          ok: false,
          reason: 'unreachable',
          detail: err instanceof Error ? err.message : 'The download failed.',
        };
      }
    }

    if (tooLarge) {
      return {
        ok: false,
        reason: 'too_large',
        detail: `Images must be under ${MAX_BYTES / 1024 / 1024} MB.`,
      };
    }

    const data = Buffer.concat(chunks);
    const format = sniffFormat(new Uint8Array(data.subarray(0, 32)));

    if (!format) {
      return {
        ok: false,
        reason: 'not_an_image',
        detail: 'That URL does not point at a JPEG, PNG, WebP or AVIF image.',
      };
    }

    return { ok: true, url: url.toString(), format, bytes: total, data };
  }

  return {
    ok: false,
    reason: 'too_many_redirects',
    detail: `That URL redirected more than ${MAX_REDIRECTS} times.`,
  };
}

/** A human-readable reason, for the admin form. */
export const FAILURE_MESSAGE: Record<UrlCheckFailure, string> = {
  invalid_url: 'That is not a valid URL.',
  scheme_not_https: 'The URL must start with https://',
  host_not_allowed: 'That image host is not on the allowed list.',
  private_address: 'That URL points somewhere it should not.',
  dns_failed: 'That hostname could not be resolved.',
  too_many_redirects: 'That URL redirects too many times.',
  unreachable: 'That URL could not be reached.',
  too_large: 'That image is too large.',
  not_an_image: 'That URL does not point at an image.',
  not_a_video: 'That URL does not point at a video.',
};

/** What `checkVideoUrl` returns. No bytes: the body is never read. See below. */
export type VideoCheckResult =
  | { ok: true; url: string; contentType: string }
  | { ok: false; reason: UrlCheckFailure; detail: string };

/**
 * Validate a background-video URL.
 *
 * Everything `checkImageUrl` does about SSRF applies unchanged and for the same reasons —
 * §7.7's https-only rule, the default-deny host allowlist, DNS resolution pinned to the
 * address that was actually checked, and re-validation from scratch after every redirect.
 * That machinery is the reason this function lives in this file rather than beside the admin
 * action: a second implementation of it is a second thing to get wrong.
 *
 * ── Where it deliberately differs ──
 *
 * `checkImageUrl` downloads up to 10MB and sniffs the magic bytes, because a `content-type`
 * header is attacker-controlled and a 10MB ceiling is a reasonable thing to spend on
 * certainty about an image.
 *
 * Neither half of that transfers. A hero video is tens of megabytes, so the download would
 * either blow the cap on every legitimate file or have to be raised to a number that makes
 * the endpoint a memory-exhaustion lever. And there is no short magic-number check that
 * spans MP4, WebM and the fragmented-MP4 variants a CDN returns.
 *
 * So this verifies the response is reachable, final and declares itself a video, then
 * DESTROYS the socket without reading a byte. The header is trusted for the type — which is
 * a real weakening, and it is bounded by the thing that was already doing the heavy lifting:
 * the host must be on `ALLOWED_IMAGE_HOSTS` in the first place. A hostile answer here
 * requires the shop's own CDN to be serving hostile content, at which point the video URL is
 * not the exposure. The browser is also not trusting us: `<video>` plays what it can decode
 * and ignores anything else, so a mislabelled file fails to play rather than doing something.
 */
export async function checkVideoUrl(raw: string): Promise<VideoCheckResult> {
  let current = raw;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const validated = await validateAndResolve(current);
    if (!validated.ok) return validated;

    const { url, address, family } = validated.resolved;

    let response: IncomingMessage;
    try {
      response = await requestPinned(url, address, family, 'video/*');
    } catch (err) {
      return {
        ok: false,
        reason: 'unreachable',
        detail: err instanceof Error ? err.message : 'Could not reach that URL.',
      };
    }

    const status = response.statusCode ?? 0;

    if (status >= 300 && status < 400) {
      const location = response.headers.location;
      response.destroy();
      if (!location) {
        return { ok: false, reason: 'unreachable', detail: 'Redirect without a target.' };
      }
      current = new URL(location, url).toString();
      continue;
    }

    // A CDN answering a ranged `accept` with 206 is serving the file, not refusing it.
    if (status !== 200 && status !== 206) {
      response.destroy();
      return { ok: false, reason: 'unreachable', detail: `The host answered ${status}.` };
    }

    const contentType = (response.headers['content-type'] ?? '').split(';')[0]!.trim();

    // Nothing is read from the body — the socket goes down here, before any of the file
    // transfers. This is the difference that makes checking a 40MB video affordable.
    response.destroy();

    if (!contentType.toLowerCase().startsWith('video/')) {
      return {
        ok: false,
        reason: 'not_a_video',
        detail: contentType
          ? `That URL returned ${contentType}.`
          : 'That URL did not say what it was returning.',
      };
    }

    return { ok: true, url: url.toString(), contentType };
  }

  return {
    ok: false,
    reason: 'too_many_redirects',
    detail: `More than ${MAX_REDIRECTS} redirects.`,
  };
}
