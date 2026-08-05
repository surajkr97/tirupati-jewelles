/**
 * Phase 4 TEST — timestamp formatting.
 * AGENTS.md requires a unit test for every pure function in lib/.
 *
 * The property that matters is not "does it print a time" but "does it print the SAME
 * time regardless of where it runs". The rate card is rendered once on the server and
 * again in the browser on hydration; if those two disagree, React throws away the server
 * HTML and the page flashes.
 *
 * `process.env.TZ` is set per test to prove that independence rather than assert it.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  formatShopDate,
  formatShopDateTime,
  formatShopTime,
  hasRealTimestamp,
  SHOP_TIME_ZONE,
} from '@/lib/datetime';

/** 11:42 AM IST — the exact example specs/04-rates-ticker.md §4.4 gives. */
const ELEVEN_FORTY_TWO_IST = '2026-08-05T06:12:00.000Z';

const originalTz = process.env.TZ;

function withTimeZone(tz: string, run: () => void) {
  process.env.TZ = tz;
  try {
    run();
  } finally {
    process.env.TZ = originalTz;
  }
}

afterEach(() => {
  process.env.TZ = originalTz;
});

describe('formatShopTime', () => {
  it('renders the §4.4 example exactly', () => {
    expect(formatShopTime(ELEVEN_FORTY_TWO_IST)).toBe('11:42 AM');
  });

  it.each(['UTC', 'America/New_York', 'Asia/Kolkata', 'Pacific/Auckland'])(
    'is identical when the runtime is in %s',
    (tz) => {
      // A UTC server against an IST browser is the production shape — Render runs UTC.
      // Without an explicit timeZone this returned "6:12 am" on one side and "11:42 am"
      // on the other, which is a hydration mismatch, not a cosmetic difference.
      withTimeZone(tz, () => {
        expect(formatShopTime(ELEVEN_FORTY_TWO_IST)).toBe('11:42 AM');
      });
    },
  );

  it('upper-cases the meridiem — CLDR en-IN emits lowercase', () => {
    expect(formatShopTime(ELEVEN_FORTY_TWO_IST)).toMatch(/\b(AM|PM)$/);
  });

  it('handles midnight and noon without collapsing them', () => {
    // 18:30 UTC = 00:00 IST the next day; 06:30 UTC = 12:00 IST.
    expect(formatShopTime('2026-08-04T18:30:00.000Z')).toBe('12:00 AM');
    expect(formatShopTime('2026-08-05T06:30:00.000Z')).toBe('12:00 PM');
  });
});

describe('formatShopDate', () => {
  it('uses the shop day, not the runtime day', () => {
    // 22:08 UTC on 4 Aug is already 03:38 on 5 Aug in IST. A UTC server would date this
    // rate a day early on the /rates history table.
    withTimeZone('UTC', () => {
      expect(formatShopDate('2026-08-04T22:08:28.602Z')).toBe('5 Aug 2026');
    });
  });

  it('is stable across runtime timezones', () => {
    for (const tz of ['UTC', 'America/New_York', 'Pacific/Auckland']) {
      withTimeZone(tz, () => {
        expect(formatShopDate(ELEVEN_FORTY_TWO_IST)).toBe('5 Aug 2026');
      });
    }
  });
});

describe('formatShopDateTime', () => {
  it('joins the date and the time', () => {
    expect(formatShopDateTime(ELEVEN_FORTY_TWO_IST)).toBe('5 Aug 2026, 11:42 AM');
  });
});

describe('hasRealTimestamp', () => {
  it('rejects the epoch sentinel a purity with no rate row produces', () => {
    // loadRatesFromDb falls back to `new Date(0)`. Rendering "Updated 1 Jan 1970" would
    // look like a bug rather than an empty database.
    expect(hasRealTimestamp(new Date(0).toISOString())).toBe(false);
  });

  it('rejects an unparseable value rather than rendering "Invalid Date"', () => {
    expect(hasRealTimestamp('not-a-date')).toBe(false);
    expect(hasRealTimestamp('')).toBe(false);
  });

  it('accepts a real timestamp', () => {
    expect(hasRealTimestamp(ELEVEN_FORTY_TWO_IST)).toBe(true);
  });
});

describe('the timezone is pinned to the shop', () => {
  it('is Asia/Kolkata — bills, rates and opening hours are all IST', () => {
    expect(SHOP_TIME_ZONE).toBe('Asia/Kolkata');
  });
});
