/**
 * IP address classification for the SSRF guard.
 * Created by Phase 7 (specs/07-admin-panel.md §7.7).
 *
 * Split from `fetch-image.ts` so the range logic is a pure function with no network in it:
 * the interesting failure mode here is an address family nobody thought about, and that is
 * far easier to test exhaustively than to review by eye.
 *
 * §7.7 names the ranges. The list below is longer, because the named ones are the famous
 * examples rather than the complete set — `0.0.0.0/8` and IPv4-mapped IPv6 are not in the
 * spec and are both reachable ways to say "localhost".
 */
import { isIP } from 'node:net';

/**
 * Blocked IPv4 ranges, as [network, prefix length].
 *
 * Everything that is not globally routable. A permitted destination must be a public
 * address on the internet; there is no legitimate reason for an image CDN to live on a
 * private network, and every reason an attacker would want us to fetch from one.
 */
const BLOCKED_V4: [string, number][] = [
  ['0.0.0.0', 8], // "this network" — 0.0.0.0 itself resolves to localhost on Linux
  ['10.0.0.0', 8], // §7.7 — private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // §7.7 — loopback
  ['169.254.0.0', 16], // §7.7 — link-local, and the cloud metadata endpoint
  ['172.16.0.0', 12], // §7.7 — private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.168.0.0', 16], // §7.7 — private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, includes 255.255.255.255
];

function ipv4ToInt(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;

  let value = 0;
  for (const part of parts) {
    // Reject `010` and `0x7f` style octets: some parsers read them as octal/hex, and a
    // mismatch between our parser and the connect layer's is an outright bypass.
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

function inV4Range(address: string, network: string, prefix: number): boolean {
  const addressInt = ipv4ToInt(address);
  const networkInt = ipv4ToInt(network);
  if (addressInt === null || networkInt === null) return false;

  // A /0 mask would shift by 32, which is a no-op in JS — guard it explicitly.
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (addressInt & mask) === (networkInt & mask);
}

/** Expand an IPv6 address to its 8 full hextets so prefixes can be compared. */
function expandV6(address: string): number[] | null {
  const zone = address.indexOf('%');
  const bare = zone === -1 ? address : address.slice(0, zone);

  const [head = '', tail = ''] = bare.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];

  // A trailing IPv4 form — `::ffff:127.0.0.1` — is handled by the caller before this.
  if (bare.includes('.')) return null;

  const missing = 8 - headParts.length - tailParts.length;
  if (!bare.includes('::') && missing !== 0) return null;
  if (missing < 0) return null;

  const parts = [
    ...headParts,
    ...Array<string>(bare.includes('::') ? missing : 0).fill('0'),
    ...tailParts,
  ];
  if (parts.length !== 8) return null;

  const hextets: number[] = [];
  for (const part of parts) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
    hextets.push(parseInt(part, 16));
  }
  return hextets;
}

/**
 * An IPv4 address embedded in IPv6 — `::ffff:169.254.169.254`.
 *
 * Not in §7.7's list, and exactly the shape that slips past a guard written from that list:
 * it is a valid IPv6 literal that a socket connects to as IPv4. Extracted so the v4 rules
 * apply to it.
 */
function extractMappedV4(address: string): string | null {
  const match = /^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  return match?.[1] ?? null;
}

/**
 * True when an address must not be connected to.
 *
 * Default-deny in spirit: anything unparseable is blocked, because an address we cannot
 * classify is one we cannot vouch for.
 */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;

  if (family === 4) {
    return BLOCKED_V4.some(([network, prefix]) => inV4Range(address, network, prefix));
  }

  const mapped = extractMappedV4(address);
  if (mapped) return isBlockedAddress(mapped);

  const hextets = expandV6(address);
  if (!hextets) return true;

  const [first = 0, second = 0] = hextets;

  // ::  (unspecified) and ::1 (loopback) — §7.7 names ::1.
  if (hextets.every((h) => h === 0)) return true;
  if (hextets.slice(0, 7).every((h) => h === 0) && hextets[7] === 1) return true;

  // fc00::/7 — unique local (§7.7).
  if ((first & 0xfe00) === 0xfc00) return true;
  // fe80::/10 — link-local.
  if ((first & 0xffc0) === 0xfe80) return true;
  // 2001:db8::/32 — documentation.
  if (first === 0x2001 && second === 0x0db8) return true;
  // ff00::/8 — multicast.
  if ((first & 0xff00) === 0xff00) return true;
  // 64:ff9b::/96 — NAT64, which maps straight onto IPv4 including private space.
  if (first === 0x0064 && second === 0xff9b) return true;

  return false;
}
