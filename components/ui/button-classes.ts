/**
 * The Button's class definition, split out from the component.
 * Created by the UI redesign, Stage 1 (UI_REDESIGN_DEBT-003).
 *
 * This file deliberately has NO `'use client'`.
 *
 * `button.tsx` is a client component because the button needs a ref and event handlers.
 * Exporting the `cva` function from there made it a client reference, and a server component
 * calling it failed the build with "attempted to call buttonClasses() from the server" — the
 * footer and the homepage are both server components and both style an anchor.
 *
 * A class string is data, not behaviour. Keeping it in a module with no client boundary lets
 * the server render an anchor that is byte-identical to the button, which is the whole point
 * of UI_REDESIGN_DEBT-003: one definition of what a button looks like, reachable from both
 * sides of the boundary.
 */
import { cva, type VariantProps } from 'class-variance-authority';

export const buttonClasses = cva(
  [
    'inline-flex items-center justify-center gap-2 rounded-pill',
    'font-semibold whitespace-nowrap select-none',
    'transition-[transform,background-color,opacity] duration-fast ease-standard',
    // Mobile has no hover, so press feedback is the only affordance (§2.4).
    'active:scale-[0.98]',
    // disabled must read as disabled, not merely faded (§2.2)
    'disabled:pointer-events-none disabled:opacity-40 disabled:saturate-50',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-ink text-white hover:bg-ink/90',
        // roseDeep, not rose: white on plain rose is 4.13:1 and fails AA. D-057.
        accent: 'bg-rose-deep text-white hover:bg-rose-deep/90',
        outline: 'bg-transparent text-ink ring-1 ring-inset ring-line hover:bg-rose-tint',
        ghost: 'bg-transparent text-ink hover:bg-rose-tint',
        /**
         * For wine surfaces — the hero CTA, the trust band, the footer.
         *
         * A white fill with wine text, which is what the reference image's "Explore
         * Collection" does, and it is the only high-contrast option available: `accent` on
         * wine puts a roseDeep FILL on a wine ground at 1.6:1, so the button dissolves into
         * the surface even though its white label passes. Measured at 16.54:1 (D-057).
         *
         * The container must also carry `.surface-wine` so the focus ring inverts — an ink
         * ring on wine is 1.05:1. `Card tone="wine"` does this for you; see globals.css.
         */
        onWine: 'bg-white text-wine hover:bg-cream',
        /** The quiet partner to `onWine`: a hairline outline for secondary actions. */
        onWineOutline:
          'bg-transparent text-cream ring-1 ring-inset ring-cream/30 hover:bg-cream/10',
      },
      /**
       * Heights come from the control tokens, which are themselves fluid — Stage 7.
       *
       * Stage 6 wrote this as `h-tap sm:h-control`: a hard 44px step up to 52px at the `sm`
       * breakpoint, which was the right instinct (the extra height is a desktop affordance,
       * not something a thumb pays for) implemented the only way it could be at the time,
       * because the tokens were fixed numbers.
       *
       * Now that `--spacing-control` interpolates 40 → 52px, the step is unnecessary and
       * actively worse: a breakpoint jump means a 639px window and a 641px window render
       * visibly different buttons. `h-control` alone gives the same 52px on a desktop, 40px
       * on a phone, and a continuous ramp between — and the `sm:` variants that survive now
       * only carry horizontal padding, which genuinely is a two-state decision.
       *
       * `sm` keeps `h-tap`. It is the smallest button in the system, it is the one most
       * likely to sit alone in a toolbar, and 44px is the floor precisely so that the
       * smallest control still cannot become unreliable. Same reason `--spacing-tap` did
       * not become fluid.
       *
       * Done here rather than per call site: one definition, and no page can drift.
       */
      size: {
        sm: 'h-tap px-4 text-small',
        md: 'h-control px-4 text-body sm:px-6',
        lg: 'h-control-lg px-6 text-body sm:px-8',
      },
      full: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md', full: false },
  },
);

export type ButtonVariants = VariantProps<typeof buttonClasses>;
