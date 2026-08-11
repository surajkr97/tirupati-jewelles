/**
 * Hallmark and certification block.
 * Created by Phase 6 (specs/06-catalog-enquiry.md §6.2).
 *
 * §6.2 calls this "**required, not optional**" and explains why: "Indian buyers actively
 * check hallmarking. Missing it costs conversions."
 *
 * The instruction that shapes the whole component: "Render 'Hallmark details available in
 * store' rather than an empty block when the admin has not entered a number." So the block
 * always renders. A missing hallmark number changes the copy; it never removes the
 * section, because a page that silently drops its certification section reads as a page
 * with something to hide.
 *
 * §6 DESIGN: "Trust block reads as reassurance, not legal boilerplate." Hence prose over a
 * table, and the HUID explained rather than merely printed.
 */
import { BadgeCheck, RefreshCw, ShieldCheck } from 'lucide-react';
import Link from 'next/link';

import { Card } from '@/components/ui';

export interface TrustBlockProps {
  hasHallmark: boolean;
  hallmarkNo: string | null;
  bisCertNo: string | null;
}

export function TrustBlock({ hasHallmark, hallmarkNo, bisCertNo }: TrustBlockProps) {
  const hallmarked = hasHallmark && Boolean(hallmarkNo);

  return (
    <Card className="flex flex-col gap-6" data-testid="trust-block">
      <h2 className="text-h3 font-semibold text-ink">Hallmarking &amp; certification</h2>

      <div className="flex flex-col gap-4">
        <Item
          icon={<BadgeCheck className="size-icon" aria-hidden="true" />}
          title="BIS Hallmark"
        >
          {hallmarked ? (
            <>
              <p className="text-body text-ink">
                HUID{' '}
                <span className="font-semibold tabular" data-testid="huid">
                  {hallmarkNo}
                </span>
              </p>
              {/* §6.2 asks for the HUID to be *explained*, not just shown. Most buyers know
                  to look for it and fewer know they can verify it themselves. */}
              <p className="text-small text-muted">
                A 6-digit Hallmark Unique ID, stamped on the piece and verifiable in the
                BIS Care app.
              </p>
            </>
          ) : (
            // The §6.2 fallback, verbatim in spirit: never an empty block.
            <p className="text-body text-muted" data-testid="hallmark-fallback">
              Hallmark details available in store.
            </p>
          )}
        </Item>

        <Item
          icon={<ShieldCheck className="size-icon" aria-hidden="true" />}
          title="Certified by"
        >
          {bisCertNo ? (
            <p className="text-body text-ink">
              BIS-registered jeweller, licence{' '}
              <span className="font-semibold tabular">{bisCertNo}</span>
            </p>
          ) : (
            <p className="text-body text-muted">
              Certification details available in store.
            </p>
          )}
          <p className="text-small text-muted">
            Purity is guaranteed as marked. Every piece is assayed before it is sold.
          </p>
        </Item>

        <Item
          icon={<RefreshCw className="size-icon" aria-hidden="true" />}
          title="Buyback &amp; exchange"
        >
          <p className="text-small text-muted">
            We buy back and exchange our own pieces at the prevailing rate.{' '}
            <Link
              href="/policies/buyback"
              className="font-medium text-rose-deep underline"
            >
              Buyback policy
            </Link>{' '}
            ·{' '}
            <Link
              href="/policies/exchange"
              className="font-medium text-rose-deep underline"
            >
              Exchange policy
            </Link>
          </p>
        </Item>
      </div>
    </Card>
  );
}

function Item({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4">
      <span className="mt-1 shrink-0 text-rose-deep">{icon}</span>
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="text-small font-semibold text-ink">{title}</h3>
        {children}
      </div>
    </div>
  );
}
