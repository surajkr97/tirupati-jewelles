/**
 * Date and time formatting, pinned to the shop's timezone.
 * Created by Phase 4 (specs/04-rates-ticker.md §4.4, §4.6).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  Every formatter here passes an explicit `timeZone`. That is not a nicety.
 *
 *  `toLocaleTimeString()` with no timeZone uses the RUNTIME's zone. The rate card is
 *  rendered twice — once on the server during SSR, once in the browser on hydration — and
 *  a server in UTC against a browser in IST produces two different strings for the same
 *  instant. React then reports a hydration mismatch and discards the server HTML.
 *
 *  Pinning it also happens to be the correct product behaviour: "Updated 11:42 AM" means
 *  the time the shop set the rate. A customer abroad should see the shop's clock, not
 *  their own, or the timestamp is meaningless to them.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** The shop is in India. Rates, bills and opening hours are all IST. */
export const SHOP_TIME_ZONE = 'Asia/Kolkata';
export const SHOP_LOCALE = 'en-IN';

/**
 * `11:42 AM` — the ticker and rate-card footers.
 *
 * The meridiem is upper-cased by hand. CLDR's `en-IN` data emits lowercase `am`/`pm`,
 * and §4.4 writes the line as `Updated 11:42 AM`. Uppercasing only the `dayPeriod` part
 * leaves the locale's digit and separator choices alone — `.toUpperCase()` on the whole
 * string would be a different, sloppier thing.
 */
export function formatShopTime(iso: string | Date): string {
  const parts = new Intl.DateTimeFormat(SHOP_LOCALE, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: SHOP_TIME_ZONE,
  }).formatToParts(new Date(iso));

  return (
    parts
      .map((part) => (part.type === 'dayPeriod' ? part.value.toUpperCase() : part.value))
      .join('')
      /**
       * ICU separates the time from the meridiem with U+202F, a narrow no-break space.
       * It renders indistinguishably from a normal space and compares unequal to one, so
       * `toBe('11:42 AM')` and Playwright's `toHaveText('11:42 AM')` both fail against a
       * string that looks identical in the terminal. Normalised here rather than in every
       * assertion. The line it sits in is short prose, so nothing depends on the
       * no-break behaviour.
       */
      .replace(/[\u202F\u00A0]/g, ' ')
  );
}

/** `5 Aug 2026` — history table rows. */
export function formatShopDate(iso: string | Date): string {
  return new Intl.DateTimeFormat(SHOP_LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: SHOP_TIME_ZONE,
  }).format(new Date(iso));
}

/** `5 Aug 2026, 11:42 AM` — the prominent "rates last updated" line (§4.6). */
export function formatShopDateTime(iso: string | Date): string {
  return `${formatShopDate(iso)}, ${formatShopTime(iso)}`;
}

/**
 * True for the sentinel `new Date(0)` that `loadRatesFromDb` returns when a purity has no
 * rate row at all. Rendering "Updated 1 Jan 1970" would look like a bug rather than an
 * empty database.
 */
export function hasRealTimestamp(iso: string): boolean {
  const time = new Date(iso).getTime();
  return Number.isFinite(time) && time > 0;
}
