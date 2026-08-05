/**
 * Phase 6 TEST + SECURITY — filters and the WhatsApp deep link.
 * specs/06-catalog-enquiry.md:
 *
 *   TEST: "WhatsApp link decodes back to the intended message."
 *   TEST: "Filters produce correct sets; URL state survives reload."
 *   SECURITY: "Filter params validated against an allowlist; an unexpected sort value
 *              falls back to default rather than reaching the query builder."
 *   SECURITY: "WhatsApp message text URL-encoded; test with a product named
 *              `Ring & \"Special\" #1 <script>`."
 *
 * Both modules are pure, so this is a unit suite. The database-backed half is in
 * `products.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import {
  activeFilterCount,
  DEFAULT_SORT,
  EMPTY_FILTERS,
  filtersToQuery,
  hasActiveFilters,
  parseFilters,
  PRICE_BANDS,
  PURITY_FILTERS,
  SORT_OPTIONS,
  WEIGHT_BANDS,
} from '@/lib/catalog/filters';
import {
  buildEnquiryMessage,
  buildGeneralMessage,
  buildWhatsAppUrl,
  parseWhatsAppUrl,
} from '@/lib/catalog/whatsapp';

// ──────────────────────────────────────────────────── filters

describe('parseFilters — the allowlist', () => {
  it('reads a well-formed query', () => {
    const filters = parseFilters({
      purity: '22k',
      price: '25000-50000',
      weight: '5-15',
      sort: 'price_asc',
      page: '2',
    });

    expect(filters.purity).toBe('K22_916');
    expect(filters.price?.token).toBe('25000-50000');
    expect(filters.weight?.token).toBe('5-15');
    expect(filters.sort).toBe('price_asc');
    expect(filters.page).toBe(2);
  });

  it('returns the unfiltered view for an empty query', () => {
    expect(parseFilters({})).toEqual(EMPTY_FILTERS);
  });

  it.each([
    ['an unknown sort', { sort: 'price_asc; DROP TABLE "Product"' }],
    ['a SQL fragment as sort', { sort: "1' OR '1'='1" }],
    ['a Prisma field name as sort', { sort: 'createdAt' }],
    ['an empty sort', { sort: '' }],
  ])('falls back to the default sort for %s', (_name, params) => {
    // The §6 SECURITY case, spelled out. An unrecognised value must never reach an
    // `orderBy` — and because the parsed value is one of five literals, it cannot.
    expect(parseFilters(params).sort).toBe(DEFAULT_SORT);
  });

  it.each([
    ['an unknown purity', { purity: 'platinum' }, 'purity'],
    ['a SQL fragment as purity', { purity: "' OR 1=1 --" }, 'purity'],
    ['an unknown price band', { price: '0-999999999' }, 'price'],
    ['an unknown weight band', { weight: 'heavy' }, 'weight'],
  ])('drops %s entirely', (_name, params, field) => {
    expect(parseFilters(params)[field as 'purity']).toBeNull();
  });

  it.each([
    ['a non-numeric page', 'abc'],
    ['page zero', '0'],
    ['a negative page', '-3'],
    ['a fractional page', '1.5'],
    ['an absurd page', '99999'],
    ['a SQL fragment', '1; DELETE FROM "Product"'],
  ])('resets %s to page 1', (_name, page) => {
    // NaN would otherwise reach Prisma's `skip` and throw; a huge page is a free table
    // scan.
    expect(parseFilters({ page }).page).toBe(1);
  });

  it('ignores a repeated parameter rather than taking the first', () => {
    // `?purity=22k&purity=evil` arrives as an array. Taking the first would let a benign
    // value be prepended to smuggle something past a naive check.
    expect(parseFilters({ purity: ['22k', 'evil'] }).purity).toBeNull();
  });

  it('every purity token maps to a real purity', () => {
    for (const option of PURITY_FILTERS) {
      expect(parseFilters({ purity: option.token }).purity).toBe(option.purity);
    }
  });

  it('every band token round-trips', () => {
    for (const band of PRICE_BANDS) {
      expect(parseFilters({ price: band.token }).price?.token).toBe(band.token);
    }
    for (const band of WEIGHT_BANDS) {
      expect(parseFilters({ weight: band.token }).weight?.token).toBe(band.token);
    }
  });

  it('bands are half-open and contiguous, so nothing falls between two', () => {
    // A product on a boundary must belong to exactly one band, or the counts stop adding
    // up and the same piece shows in two filters.
    for (const bands of [PRICE_BANDS, WEIGHT_BANDS]) {
      for (let i = 0; i < bands.length - 1; i += 1) {
        expect(bands[i]!.max).toBe(bands[i + 1]!.min);
      }
      expect(bands[0]!.min).toBeNull();
      expect(bands.at(-1)!.max).toBeNull();
    }
  });
});

describe('filtersToQuery — URL state survives a reload', () => {
  it('round-trips every filter', () => {
    const original = parseFilters({
      purity: 'silver',
      price: 'over-250000',
      weight: 'under-5',
      sort: 'weight_desc',
      page: '3',
    });

    // §6 TEST: "URL state survives reload." Serialise, re-parse, and the filters must be
    // identical — that is what a reload does.
    expect(
      parseFilters(Object.fromEntries(new URLSearchParams(filtersToQuery(original)))),
    ).toEqual(original);
  });

  it('omits defaults so an unfiltered URL stays clean', () => {
    expect(filtersToQuery(EMPTY_FILTERS)).toBe('');
    expect(filtersToQuery({ ...EMPTY_FILTERS, page: 1, sort: DEFAULT_SORT })).toBe('');
  });

  it('counts only the filters, not the sort', () => {
    const filters = parseFilters({
      purity: '22k',
      price: 'under-25000',
      sort: 'price_asc',
    });

    // The badge counts what narrows the results. A sort changes the order, not the set.
    expect(activeFilterCount(filters)).toBe(2);
    expect(hasActiveFilters(filters)).toBe(true);
    expect(hasActiveFilters(parseFilters({ sort: 'price_asc' }))).toBe(true);
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
  });

  it('every sort option is a valid token', () => {
    for (const option of SORT_OPTIONS) {
      expect(parseFilters({ sort: option.token }).sort).toBe(option.token);
    }
  });
});

// ──────────────────────────────────────────────────── the WhatsApp deep link

describe('the WhatsApp deep link', () => {
  const product = {
    name: 'Temple Necklace Set',
    slug: 'temple-necklace-set',
    purity: 'K22_916' as const,
    weightMg: 48_500,
    lineTotal: 74_725_218n,
  };

  const SITE = 'https://tirupatijewelles.com';
  const PHONE = '919876543210';

  it('decodes back to exactly the intended message', () => {
    const message = buildEnquiryMessage(product, SITE);
    const url = buildWhatsAppUrl(PHONE, message);

    // §6 TEST: "WhatsApp link decodes back to the intended message." A round trip, not a
    // hand-written expected string — the latter just re-encodes the same mistake.
    const parsed = parseWhatsAppUrl(url);

    expect(parsed?.phone).toBe(PHONE);
    expect(parsed?.message).toBe(message);
  });

  it('contains everything §6.3 lays out', () => {
    const message = buildEnquiryMessage(product, SITE);

    expect(message).toContain('Temple Necklace Set');
    expect(message).toContain('22K (916)');
    expect(message).toContain('48.5g');
    expect(message).toContain('Ref: temple-necklace-set');
    expect(message).toContain('₹7,47,252');
    expect(message).toContain(`${SITE}/products/temple-necklace-set`);
  });

  describe('SECURITY — a hostile product name', () => {
    // The exact name §6 SECURITY names.
    const hostile = {
      ...product,
      name: 'Ring & "Special" #1 <script>alert(1)</script>',
      slug: 'ring-special-1',
    };

    it('survives the round trip intact', () => {
      const message = buildEnquiryMessage(hostile, SITE);
      const url = buildWhatsAppUrl(PHONE, message);

      expect(parseWhatsAppUrl(url)?.message).toBe(message);
      expect(parseWhatsAppUrl(url)?.message).toContain(
        'Ring & "Special" #1 <script>alert(1)</script>',
      );
    });

    it('does not let & or # truncate the message', () => {
      const url = buildWhatsAppUrl(PHONE, buildEnquiryMessage(hostile, SITE));

      // An unencoded `&` would start a new query parameter and an unencoded `#` would
      // start the fragment — either one silently cuts the message short. §6.3: "unencoded
      // they truncate the message or break the link."
      const query = url.slice(url.indexOf('?') + 1);
      expect(query.startsWith('text=')).toBe(true);
      expect(query.slice(5)).not.toContain('&');
      expect(url).not.toContain('#');
    });

    it('emits %20 for spaces, never +', () => {
      const url = buildWhatsAppUrl(PHONE, 'hello world');

      // `URLSearchParams` would produce `hello+world`. Whether wa.me decodes `+` back to a
      // space is WhatsApp's business, and the failure mode is `Hi!+I'm+interested` in the
      // shop's primary CTA. §6.3 names `encodeURIComponent` for this reason.
      expect(url).toContain('hello%20world');
      expect(url).not.toContain('hello+world');
    });

    it('encodes newlines rather than emitting a raw line break in a URL', () => {
      expect(buildWhatsAppUrl(PHONE, 'a\nb')).toContain('a%0Ab');
    });

    it.each([
      ['a quote', 'He said "hi"'],
      ['an ampersand', 'Gold & Silver'],
      ['a hash', 'Ring #1'],
      ['an equals', 'a=b'],
      ['a plus', 'a+b'],
      ['a percent', '100% gold'],
      ['a question mark', 'really?'],
      ['unicode', '₹ · 22K'],
      ['a URL', 'https://evil.example/?x=1&y=2'],
    ])('round-trips %s', (_name, text) => {
      expect(parseWhatsAppUrl(buildWhatsAppUrl(PHONE, text))?.message).toBe(text);
    });
  });

  it('strips non-digits from the phone number', () => {
    // Phase 8 calls this with customer numbers in E.164, and a `+` in the path segment
    // breaks the link silently.
    expect(buildWhatsAppUrl('+91 98765-43210', 'hi')).toContain('wa.me/919876543210?');
  });

  it('the general message carries the site link', () => {
    expect(buildGeneralMessage(SITE)).toContain(SITE);
  });

  it.each([
    ['a non-wa.me host', 'https://evil.example/?text=hi'],
    ['not a URL at all', 'nonsense'],
    ['no text parameter', 'https://wa.me/919876543210'],
  ])('parseWhatsAppUrl rejects %s', (_name, url) => {
    expect(parseWhatsAppUrl(url)).toBeNull();
  });
});
