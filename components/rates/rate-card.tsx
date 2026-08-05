/**
 * RateCard — one metal, one purity, the true rate.
 * Created by Phase 4 (specs/04-rates-ticker.md §4.6).
 *
 * The /rates page's card. Deliberately NOT a ticker: no jitter, no timer, no client
 * component. MASTER-SPEC §8 puts the fluctuation on "the homepage widget" and nowhere
 * else, and /rates is the page a customer opens to check a number before walking into the
 * shop — the one place the figure should sit still.
 *
 * Same card chrome, same delta line and the same disclaimer as the ticker, all three from
 * the shared components rather than re-typed here.
 */
import { RateDelta } from '@/components/rates/rate-delta';
import { RateDisclaimer } from '@/components/rates/rate-disclaimer';
import { Sparkline } from '@/components/rates/sparkline';
import { Card } from '@/components/ui';
import { formatINR } from '@/lib/money';

export interface RateCardProps {
  label: string;
  /** Display-unit paise: per 10 g for gold, per kg for silver. */
  display: bigint;
  /** `per 10 grams` / `per 1 kilogram`. */
  unit: string;
  /** Signed change against the previous recorded rate, same unit. */
  change: bigint;
  effectiveAt: string;
  /** Display-unit history for the decorative sparkline. */
  points?: bigint[];
}

export function RateCard({
  label,
  display,
  unit,
  change,
  effectiveAt,
  points = [],
}: RateCardProps) {
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-h3 font-semibold text-ink">{label}</h2>

      <div className="flex flex-col gap-1">
        {/* 40px semibold tabular, as §4.4 sets for the ticker. The reference page should
            not quote the headline number smaller than the homepage does. */}
        <p className="text-display font-semibold tracking-tight text-ink tabular">
          {formatINR(display)}
        </p>
        <p className="text-small text-muted">{unit}</p>
      </div>

      <RateDelta change={change} base={display} />

      {points.length >= 2 && <Sparkline points={points} rising={change >= 0n} />}

      <RateDisclaimer effectiveAt={effectiveAt} />
    </Card>
  );
}
