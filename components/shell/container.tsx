/**
 * Container — max 1200px, gutters 16px mobile / 40px desktop.
 * Created by Phase 2 (specs/02-design-system.md §2.3), layout from MASTER-SPEC §3.
 *
 * The gutter is the one place an off-scale value is correct: MASTER-SPEC §3 fixes the
 * spacing scale at 4/8/16/24/32/48/64 but separately specifies a horizontal gutter.
 * It is stated, not arbitrary, so it lives here once rather than being reached for ad hoc.
 *
 * ── Stage 7: the two fixed steps became one ramp ──
 *
 * `px-[20px] md:px-[40px]` was a 20px jump at a breakpoint, and on a phone it spent 40px of
 * a 390px screen — over 10% of the viewport — on empty margin before any content began.
 * Every card on the page then paid its own padding on top of that. The gutter is now
 * continuous on the same 390 → 768 ramp the tokens use: 16px on a phone, 40px from `md`,
 * so desktop is unchanged and there is no width at which the layout visibly snaps.
 *
 * Still an arbitrary value rather than a scale step, deliberately, and
 * `eslint-rules/no-off-scale-spacing.mjs` permits it for that reason — the gutter is a
 * stated layout figure, not spacing between components, and D-006 confines it to this file
 * and to `Section`.
 */
import { cn } from '@/lib/utils/cn';

/**
 * The gutter itself, exported because five other components need to line up with it and
 * were each carrying their own hand-written copy of `px-[20px] md:px-[40px]`.
 *
 * That duplication is the drift this component exists to prevent, and it had already
 * happened: the admin layout, the trust band, the sticky bar, the auth shell and the route
 * skeletons all restate the gutter because they are full-bleed surfaces that cannot nest
 * inside a `Container` but must align to one. Five copies of a number is five chances to
 * update four of them.
 *
 * A plain string rather than a component for the same reason `buttonClasses` lives in a file
 * with no `'use client'`: it is data, and both server and client components consume it.
 */
export const CONTAINER_GUTTER = 'px-[clamp(16px,-8.7623px+6.3493vw,40px)]';

export function Container({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('mx-auto w-full max-w-[1200px]', CONTAINER_GUTTER, className)}
      {...props}
    />
  );
}
