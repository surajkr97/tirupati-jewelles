/**
 * RateDisclaimer — the line that has to be on every surface showing a rate.
 * Created by Phase 4 (specs/04-rates-ticker.md §4.4, §4.6).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  MASTER-SPEC §8: showing a price you will not transact at is exposure under Indian
 *  consumer-protection and legal-metrology rules. This disclaimer, plus the calculator
 *  using true rates, IS the mitigation. Do not remove it, do not shrink it, do not
 *  collapse it behind a tooltip.
 *
 *  §4.6 requires /rates to carry "the same disclaimer as the ticker card". One component
 *  is how "the same" stays true — two copies of a legal notice drift within a month.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * No hooks and no `'use client'`, so it renders unchanged in the client ticker and in the
 * server-rendered /rates cards.
 */
import { formatShopTime, hasRealTimestamp } from '@/lib/datetime';
import { cn } from '@/lib/utils/cn';

export function RateDisclaimer({
  effectiveAt,
  className,
}: {
  /** ISO timestamp of the rate being shown. */
  effectiveAt: string;
  className?: string;
}) {
  const known = hasRealTimestamp(effectiveAt);

  return (
    // 14px muted, not the 13px §4.4 sketched — D-008 sets 14px as the floor for microcopy,
    // and §4 DESIGN is explicit that this must be readable rather than "hidden in 10px grey".
    <p className={cn('text-small text-muted', className)}>
      Indicative rate
      {known && (
        <>
          {' · '}
          <span>
            Updated{' '}
            <time dateTime={effectiveAt} className="tabular">
              {formatShopTime(effectiveAt)}
            </time>
          </span>
        </>
      )}
      {' · '}
      Final price confirmed in store.
    </p>
  );
}
