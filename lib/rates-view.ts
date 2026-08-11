/**
 * Serialise the current rates for the client rate card.
 * Created by the UI redesign, Stage 4B.
 *
 * `getCurrentRates()` returns `bigint` paise, which does not survive the server→client
 * boundary — React cannot serialise it into the RSC payload. Every page that renders
 * `LiveRateCard` therefore has to turn the same shape into the same strings.
 *
 * The homepage and `/rates` both do, so this exists to stop the mapping being written twice.
 * It is presentation only: no arithmetic, no rounding, no unit conversion. Every value is
 * `.toString()` on a figure `lib/rates.ts` already computed, so there is no second place
 * where a rate could be got wrong.
 */
import { RATE_FACES, type Rates } from '@/lib/rates';

import type { SerialisedRates } from '@/components/rates/live-rate-card';

export function serialiseRates(rates: Rates): SerialisedRates {
  return Object.fromEntries(
    RATE_FACES.map(({ key, unit }) => {
      const face = rates[key];
      return [
        key,
        {
          perGram: face.perGram.toString(),
          display: face.display.toString(),
          change: face.change.toString(),
          effectiveAt: face.effectiveAt,
          unit,
        },
      ];
    }),
  ) as SerialisedRates;
}
