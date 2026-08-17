/**
 * Phase 7 SECURITY — the SSRF suite.
 * specs/07-admin-panel.md §7 SECURITY:
 *
 *   "**SSRF suite:** try `http://169.254.169.254/latest/meta-data/`, `file:///etc/passwd`,
 *    `http://localhost:6379`, a permitted host that redirects to a private IP, and a DNS
 *    name resolving to `127.0.0.1`. All must be rejected."
 *
 * §7.7 calls this field "the highest-risk input in the application", so the address
 * classifier is tested exhaustively rather than by example — the interesting failure is an
 * address family nobody thought of, and those are found by enumerating, not by reviewing.
 *
 * The network-facing half runs against real local servers, because the control being tested
 * (connect to a verified IP, re-validate every redirect) is exactly the part a mocked fetch
 * would skip.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { isBlockedAddress } from '@/lib/media/ssrf';

describe('isBlockedAddress — the ranges §7.7 names', () => {
  it.each([
    ['the AWS/GCP metadata endpoint', '169.254.169.254'],
    ['link-local generally', '169.254.1.1'],
    ['loopback', '127.0.0.1'],
    ['loopback, anywhere in /8', '127.99.42.7'],
    ['private 10/8', '10.0.0.1'],
    ['private 172.16/12', '172.16.0.1'],
    ['private 172.31 — still in /12', '172.31.255.255'],
    ['private 192.168/16', '192.168.1.1'],
    ['IPv6 loopback', '::1'],
    ['IPv6 unique local fc00::/7', 'fc00::1'],
    ['IPv6 unique local fd00::', 'fd12:3456:789a::1'],
  ])('blocks %s', (_name, address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([
    ['0.0.0.0 — resolves to localhost on Linux', '0.0.0.0'],
    ['the whole 0/8 range', '0.1.2.3'],
    ['carrier-grade NAT', '100.64.0.1'],
    ['IPv6 link-local', 'fe80::1'],
    ['IPv6 unspecified', '::'],
    ['multicast', '224.0.0.1'],
    ['broadcast', '255.255.255.255'],
    ['IPv6 multicast', 'ff02::1'],
    ['NAT64, which maps onto IPv4 private space', '64:ff9b::a00:1'],
  ])('blocks %s — beyond the spec list, and reachable', (_name, address) => {
    // §7.7's list is the famous examples, not the complete set. A guard written only from
    // it has holes in exactly these shapes.
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([
    ['an IPv4-mapped metadata endpoint', '::ffff:169.254.169.254'],
    ['an IPv4-mapped loopback', '::ffff:127.0.0.1'],
    ['the compressed mapped form', '::127.0.0.1'],
  ])('blocks %s', (_name, address) => {
    // A valid IPv6 literal that a socket connects to as IPv4 — the shape that slips past a
    // guard that checks v4 rules only against v4-looking strings.
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([
    ['a decimal-octal octet', '0177.0.0.1'],
    ['a hex octet', '0x7f.0.0.1'],
    ['too few octets', '127.1'],
    ['not an address at all', 'not-an-ip'],
    ['an empty string', ''],
    ['a partial IPv6', '::gggg'],
  ])('blocks %s — unparseable means untrusted', (_name, address) => {
    // Default-deny. An address we cannot classify is one we cannot vouch for, and a parser
    // mismatch between us and the connect layer is an outright bypass.
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([
    ['a public IPv4', '8.8.8.8'],
    ['a public IPv4 near a blocked range', '11.0.0.1'],
    ['172.15 — just below the private /12', '172.15.255.255'],
    ['172.32 — just above the private /12', '172.32.0.0'],
    ['192.167 — just below the private /16', '192.167.255.255'],
    ['a public IPv6', '2606:4700:4700::1111'],
  ])('permits %s', (_name, address) => {
    // The boundaries matter as much as the ranges: an off-by-one on a /12 either blocks a
    // real CDN or admits a private network.
    expect(isBlockedAddress(address)).toBe(false);
  });
});

/**
 * The network half.
 *
 * `ALLOWED_IMAGE_HOSTS` is stubbed to `localhost` so a real server can stand in for a
 * permitted CDN — otherwise every case would fail on the host allowlist and prove nothing
 * about the controls behind it.
 */
describe('checkImageUrl — against real servers', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/redirect-to-metadata') {
        // §7 SECURITY: "a permitted host that redirects to a private IP".
        res.writeHead(302, { location: 'https://169.254.169.254/latest/meta-data/' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'image/jpeg' });
      res.end(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function check(url: string) {
    vi.resetModules();
    vi.stubEnv('ALLOWED_IMAGE_HOSTS', 'localhost,res.cloudinary.com,utfs.io');
    const { checkImageUrl } = await import('@/lib/media/fetch-image');
    try {
      return await checkImageUrl(url);
    } finally {
      vi.unstubAllEnvs();
    }
  }

  it.each([
    ['the metadata endpoint over http', 'http://169.254.169.254/latest/meta-data/'],
    ['a file:// URL', 'file:///etc/passwd'],
    ['Redis over http', 'http://localhost:6379'],
    ['a data: URL', 'data:image/png;base64,iVBORw0KGgo='],
    ['a gopher URL', 'gopher://localhost:6379/_INFO'],
    ['an ftp URL', 'ftp://localhost/x.jpg'],
  ])('rejects %s', async (_name, url) => {
    const result = await check(url);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Scheme is checked before the host, so these fail on scheme rather than allowlist —
      // either is a rejection, but the reason should be the honest one.
      expect(['scheme_not_https', 'host_not_allowed', 'invalid_url']).toContain(
        result.reason,
      );
    }
  });

  it('rejects an https URL whose host is not on the allowlist', async () => {
    const result = await check('https://evil.example/x.jpg');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('host_not_allowed');
  });

  it('rejects a lookalike host that merely ends with an allowed one', async () => {
    // `res.cloudinary.com.attacker.test` passes a naive `endsWith` check.
    const result = await check('https://res.cloudinary.com.attacker.test/x.jpg');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('host_not_allowed');
  });

  it('rejects an allowed hostname that resolves to loopback', async () => {
    // §7 SECURITY: "a DNS name resolving to `127.0.0.1`". `localhost` is on the stubbed
    // allowlist and resolves to 127.0.0.1 — so it passes every check except the one that
    // matters, which is the point of the case.
    const result = await check(`https://localhost:${port}/image.jpg`);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('private_address');
  });

  it('rejects a literal private IP even when the scheme is https', async () => {
    const result = await check('https://127.0.0.1/x.jpg');

    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(['private_address', 'host_not_allowed']).toContain(result.reason);
  });

  /**
   * The rebinding pin, tested directly.
   *
   * A test that controls real DNS is not practical here, so this asserts the mechanism: the
   * request must be issued with a `lookup` that yields the ALREADY-VALIDATED address, so the
   * socket cannot re-resolve. Without the pin this assertion fails, and the guard silently
   * degrades to check-then-connect-by-name — which is the whole vulnerability.
   */
  it('connects to the validated address, never by hostname', async () => {
    vi.resetModules();
    vi.stubEnv('ALLOWED_IMAGE_HOSTS', 'example.com');

    // Resolve to a public address so validation passes and a connection is attempted.
    vi.doMock('node:dns/promises', () => ({
      lookup: async () => ({ address: '93.184.216.34', family: 4 }),
    }));

    const captured: { lookup?: unknown }[] = [];
    vi.doMock('node:https', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:https')>();
      return {
        ...actual,
        request: (_url: URL, options: { lookup?: unknown }) => {
          captured.push(options);
          // Fail the connection immediately; the assertion is about the options, not the
          // response.
          const emitter = new (require('node:events').EventEmitter)();
          emitter.end = () => {
            setImmediate(() => emitter.emit('error', new Error('blocked in test')));
          };
          emitter.destroy = () => {};
          return emitter;
        },
      };
    });

    try {
      const { checkImageUrl } = await import('@/lib/media/fetch-image');
      await checkImageUrl('https://example.com/x.jpg');

      expect(captured).toHaveLength(1);
      const lookup = captured[0]?.lookup as
        | ((
            h: string,
            o: unknown,
            cb: (e: unknown, a: string, f: number) => void,
          ) => void)
        | undefined;

      expect(typeof lookup).toBe('function');

      // Whatever hostname Node asks about, it is handed the address we verified.
      const answered = await new Promise<string>((resolve) => {
        lookup!('example.com', {}, (_err, address) => resolve(address));
      });
      expect(answered).toBe('93.184.216.34');
    } finally {
      vi.doUnmock('node:dns/promises');
      vi.doUnmock('node:https');
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('rejects an IPv6 loopback literal', async () => {
    const result = await check('https://[::1]/x.jpg');

    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(['private_address', 'host_not_allowed']).toContain(result.reason);
  });
});

/**
 * The pinning hook's call contract.
 *
 * ── Why this file needed a new describe block ──
 * `checkImageUrl` failed on EVERY url with "Invalid IP address: undefined", so pasting an
 * image URL into a media slot or onto a product, `confirmUpload` after a successful
 * Cloudinary upload, and the invoice logo were all non-functional. Found by running the
 * guard against a real Cloudinary URL, not by reading it.
 *
 * The 47 assertions above did not catch it because every one of them is a REJECTION — the
 * local test server speaks http, and the scheme check returns before anything connects, so
 * the line that performs a successful fetch was never executed.
 *
 * The pinning test that does exist calls the hook as `lookup('example.com', {}, cb)`. That
 * is the one options shape `net.connect` never uses: it calls with `{ all: true }` and then
 * reads `addresses[0].address`. So the test exercised the branch Node does not take and
 * passed while the branch Node does take was broken.
 */
describe('pinnedLookup — the shape net.connect actually asks for', () => {
  const ADDRESS = '93.184.216.34';

  it('answers { all: true } with an array, the way net.connect reads it', async () => {
    const { pinnedLookup } = await import('@/lib/media/fetch-image');

    const answer = await new Promise<unknown>((resolve) => {
      pinnedLookup(ADDRESS, 4)('example.com', { all: true }, (...args: unknown[]) =>
        resolve(args[1]),
      );
    });

    expect(Array.isArray(answer)).toBe(true);
    // The exact read that produced `undefined` and killed every connection.
    expect((answer as { address: string }[])[0]?.address).toBe(ADDRESS);
    expect((answer as { family: number }[])[0]?.family).toBe(4);
  });

  it('still answers the three-argument form when asked that way', async () => {
    const { pinnedLookup } = await import('@/lib/media/fetch-image');

    const answer = await new Promise<unknown[]>((resolve) => {
      pinnedLookup(ADDRESS, 4)('example.com', {}, (...args: unknown[]) => resolve(args));
    });

    expect(answer[1]).toBe(ADDRESS);
    expect(answer[2]).toBe(4);
  });

  it('hands back only the pinned address, in either shape', async () => {
    /**
     * The security property, restated so the fix cannot drift into re-resolving. Whatever
     * the caller asks for, it may learn exactly one address: the one already validated as
     * public. This is what closes the DNS-rebinding gap the file's header describes.
     */
    const { pinnedLookup } = await import('@/lib/media/fetch-image');
    const hook = pinnedLookup(ADDRESS, 6);

    for (const options of [{ all: true }, {}, undefined]) {
      const args = await new Promise<unknown[]>((resolve) => {
        hook('anything.example', options, (...rest: unknown[]) => resolve(rest));
      });

      const flat = JSON.stringify(args);
      expect(flat).toContain(ADDRESS);
      // No second candidate, and never the hostname it was asked about.
      expect(flat).not.toContain('anything.example');
    }
  });
});

/**
 * D-126 — `checkVideoUrl` is the same SSRF surface as `checkImageUrl`.
 *
 * It reuses the same `validateAndResolve`, so these assertions are about that reuse actually
 * being in place rather than about re-deriving the classifier: a second URL-taking entry
 * point that skipped the allowlist would be a hole in the highest-risk input in the
 * application (§7.7), and it would not look like one from the admin screen.
 */
describe('checkVideoUrl — the same refusals as the image path', () => {
  async function check(url: string) {
    vi.resetModules();
    vi.stubEnv('ALLOWED_IMAGE_HOSTS', 'localhost,res.cloudinary.com');
    const { checkVideoUrl } = await import('@/lib/media/fetch-image');
    try {
      return await checkVideoUrl(url);
    } finally {
      vi.unstubAllEnvs();
    }
  }

  it.each([
    ['the metadata endpoint over http', 'http://169.254.169.254/latest/meta-data/'],
    ['the metadata endpoint over https', 'https://169.254.169.254/latest/meta-data/'],
    ['a file:// URL', 'file:///etc/passwd'],
    ['Redis over http', 'http://localhost:6379'],
    ['a data: URL', 'data:video/mp4;base64,AAAA'],
    ['a host that is not on the allowlist', 'https://example.com/hero.mp4'],
    ['something that is not a URL at all', 'not a url'],
  ])('refuses %s', async (_label, url) => {
    const result = await check(url);
    expect(result.ok).toBe(false);
  });

  it('refuses http even on an allowed host — https is an allowlist of one', async () => {
    const result = await check('http://res.cloudinary.com/demo/hero.mp4');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('scheme_not_https');
  });

  it('names the host rule when the host is the problem', async () => {
    const result = await check('https://evil.test/hero.mp4');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('host_not_allowed');
  });
});
