/**
 * Button primitive.
 * Created by Phase 2 (specs/02-design-system.md §2.2).
 */
'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef } from 'react';

import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils/cn';

const button = cva(
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
        // taupeDeep, not taupe: white on plain taupe is 3.53:1 and fails AA. D-007.
        accent: 'bg-taupe-deep text-white hover:bg-taupe-deep/90',
        outline:
          'bg-transparent text-ink ring-1 ring-inset ring-line hover:bg-taupe-lt/40',
        ghost: 'bg-transparent text-ink hover:bg-taupe-lt/40',
      },
      size: {
        // Never below 44px — the minimum tap target (MASTER-SPEC §3).
        sm: 'h-tap px-4 text-small',
        md: 'h-control px-6 text-body',
        lg: 'h-control-lg px-8 text-body',
      },
      full: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md', full: false },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, full, loading = false, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(button({ variant, size, full }), className)}
      disabled={disabled ?? loading}
      // Screen readers need to know the control is working; a spinner is invisible to them.
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
});
