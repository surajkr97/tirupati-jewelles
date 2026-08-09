/**
 * Section — vertical rhythm 48px mobile / 80px desktop.
 * Created by Phase 2 (specs/02-design-system.md §2.3).
 *
 * The governing rule from §2 design intent: "when a screen feels cramped, add padding.
 * Never shrink text." This component is where that rhythm is enforced, so no later phase
 * has to decide it again.
 *
 * 80px is off the 4/8/16/24/32/48/64 scale but is named explicitly by MASTER-SPEC §3 as
 * the desktop section padding.
 */
import Link from 'next/link';

import { Container } from '@/components/shell/container';
import { cn } from '@/lib/utils/cn';

export interface SectionProps extends React.HTMLAttributes<HTMLElement> {
  eyebrow?: string;
  heading?: string;
  seeAllHref?: string;
  seeAllLabel?: string;
  /** Set false when the section manages its own horizontal padding (e.g. a bleed carousel). */
  contained?: boolean;
}

export function Section({
  className,
  eyebrow,
  heading,
  seeAllHref,
  seeAllLabel = 'See all',
  contained = true,
  children,
  ...props
}: SectionProps) {
  const header = (eyebrow ?? heading) && (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        {eyebrow && (
          // `taupe-deep`, not `taupe`: this is 14px text, so it needs 4.5:1 and `taupe`
          // gives 3.30 on cream. D-007 already says plain taupe cannot carry text; §9.7's
          // axe pass found this eyebrow doing it on every section heading in the site.
          <span className="text-small font-medium tracking-[0.08em] text-taupe-deep uppercase">
            {eyebrow}
          </span>
        )}
        {heading && <h2 className="text-h2 font-semibold text-ink">{heading}</h2>}
      </div>

      {seeAllHref && (
        <Link
          href={seeAllHref}
          className="flex h-tap shrink-0 items-center text-small font-semibold text-taupe-deep hover:underline"
        >
          {seeAllLabel}
        </Link>
      )}
    </div>
  );

  const body = (
    <>
      {header}
      {children}
    </>
  );

  return (
    <section className={cn('py-12 md:py-[80px]', className)} {...props}>
      {contained ? <Container>{body}</Container> : body}
    </section>
  );
}
