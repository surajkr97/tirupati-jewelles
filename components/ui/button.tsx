/**
 * Button primitive.
 * Created by Phase 2 (specs/02-design-system.md §2.2).
 * Repalletted and given its on-wine variants by the UI redesign, Stage 1 (D-056).
 *
 * The class definition lives in `button-classes.ts`, which has no client boundary, so a
 * server-rendered anchor can wear exactly these styles. See that file for why.
 */
'use client';

import { forwardRef } from 'react';

import { buttonClasses, type ButtonVariants } from '@/components/ui/button-classes';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils/cn';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, ButtonVariants {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, full, loading = false, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(buttonClasses({ variant, size, full }), className)}
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
