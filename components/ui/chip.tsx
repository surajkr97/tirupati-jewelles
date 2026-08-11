/**
 * Chip primitive — a selectable pill.
 * Created by the UI redesign, Stage 1 (brief §26).
 *
 * `Badge` is the read-only sibling: it labels something. A Chip is a CONTROL — a filter
 * value, a search suggestion, a purity toggle — so it is a `<button>`, carries
 * `aria-pressed` when it is selectable, and is held to the 44px tap target that a Badge is
 * not.
 *
 * It exists because three surfaces had each hand-rolled the same pill (the filter sheet, the
 * search suggestions, the calculator's metal switch), which is exactly the duplication the
 * design system is supposed to prevent — and it meant a repalette had to find all three.
 */
'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef } from 'react';

import { cn } from '@/lib/utils/cn';

const chip = cva(
  [
    'inline-flex shrink-0 items-center gap-2 rounded-pill px-4',
    // h-tap, not py-*: a filter chip is a primary phone target and 44px is the floor.
    'h-tap text-small font-medium whitespace-nowrap',
    'transition-colors duration-fast ease-standard',
    'disabled:pointer-events-none disabled:opacity-40',
  ],
  {
    variants: {
      /**
       * Selection is a TONE change, never a colour-only signal — WCAG 1.4.1 and the brief's
       * §23. Selected inverts to a filled dark pill, so it differs in luminance and not only
       * in hue; callers that need more still pass a check icon as a child.
       */
      selected: {
        true: 'bg-ink text-white hover:bg-ink/90',
        false: 'bg-rose-tint text-ink hover:bg-rose/15',
      },
    },
    defaultVariants: { selected: false },
  },
);

export interface ChipProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'>,
    VariantProps<typeof chip> {}

export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { className, selected, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      // Only a chip that HAS a selected state claims one. A chip used as a plain suggestion
      // link would otherwise announce itself as an unpressed toggle, which is a lie.
      aria-pressed={selected === undefined ? undefined : Boolean(selected)}
      className={cn(chip({ selected }), className)}
      {...props}
    />
  );
});
