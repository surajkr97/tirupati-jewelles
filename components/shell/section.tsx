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
  /**
   * Render the heading in the display serif.
   *
   * Opt-in rather than the default, and it stays that way permanently. `Section` is shared
   * with twelve admin pages, and the distinction is real rather than a migration shim: the
   * storefront is editorial and reads in Playfair, the admin is a tool the owner uses
   * between customers and reads in the UI sans. A serif heading over a bills table would be
   * costume.
   */
  display?: boolean;
}

export function Section({
  className,
  eyebrow,
  heading,
  seeAllHref,
  seeAllLabel = 'See all',
  contained = true,
  display = false,
  children,
  ...props
}: SectionProps) {
  const header = (eyebrow ?? heading) && (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        {eyebrow && (
          // `rose-deep`, not `rose`: this is 14px text, so it needs 4.5:1 and `rose`
          // gives 3.87 on cream. D-057 already says plain rose cannot carry text; §9.7’s
          // axe pass found this eyebrow doing it on every section heading in the site.
          <span className="text-small font-medium tracking-[0.08em] text-rose-deep uppercase">
            {eyebrow}
          </span>
        )}
        {heading && (
          <h2
            className={cn(
              'text-ink',
              /**
               * §14 — a section heading is not a hero.
               *
               * Both branches were fixed sizes, so a display heading rendered at 32px on a
               * 390px screen: the same size as the page's own h1 on that device, four words
               * to a line, and no hierarchy left between "the page" and "a part of it". They
               * now start a step down and grow from `md`, where there is room for the
               * editorial size the serif was chosen for.
               */
              display
                ? 'font-display text-h2 font-medium md:text-h1'
                : 'text-lead font-semibold md:text-h2',
            )}
          >
            {heading}
          </h2>
        )}
      </div>

      {seeAllHref && (
        <Link
          href={seeAllHref}
          /**
           * An absolute URL leaves the site, so it opens in a new tab and carries `rel`.
           *
           * Derived from the href rather than given as a prop, deliberately. The `rel` is
           * not decoration: without `noopener` the opened tab receives a live
           * `window.opener` handle and can navigate this one somewhere else, which is the
           * classic reverse-tabnabbing setup. A `seeAllExternal` prop would make that
           * protection something a future caller has to remember, and the one who forgets
           * is the one shipping an external link.
           *
           * `startsWith('http')` and not a `URL` parse: every internal href in this codebase
           * is root-relative (`/collections`, `/admin/bills`), so the two cases are already
           * unambiguous, and a parse would need a base URL to not throw on them.
           */
          {...(seeAllHref.startsWith('http')
            ? { target: '_blank', rel: 'noopener noreferrer' }
            : {})}
          className="flex h-tap shrink-0 items-center text-small font-semibold text-rose-deep hover:underline"
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
    /**
     * Stage 7: one ramp instead of a 48 → 80px breakpoint jump.
     *
     * `py-12` is now fluid (28px on a phone, 48px from `md`), which fixes the rhythm at the
     * token level, but the desktop half of this was a separate arbitrary 80px switched on at
     * `md` — so a phone got 48px of padding top AND bottom between every pair of sections,
     * ~96px of empty cream between one heading and the next on a 390px screen. Continuous
     * now, and 80px on a desktop exactly as before.
     */
    <section
      className={cn('py-[clamp(28px,-25.6511px+13.7567vw,80px)]', className)}
      {...props}
    >
      {contained ? <Container>{body}</Container> : body}
    </section>
  );
}
