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
  /**
   * Label to show while `loading` — "Signing in…" in place of "Sign in".
   *
   * Added by Stage 3 (brief §9). A spinner beside an unchanged label says *something* is
   * happening; it does not say what, and it says nothing at all to a screen reader, which
   * announces only the label. `aria-busy` marks the control as pending, but a busy control
   * still reading "Sign in" is the least useful moment in the flow to be vague.
   *
   * On the shared primitive rather than per form, so every submit in the application gets
   * the same treatment instead of four call sites each solving it differently (brief §19).
   */
  loadingLabel?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant,
    size,
    full,
    loading = false,
    loadingLabel,
    disabled,
    children,
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(buttonClasses({ variant, size, full }), className)}
      // `disabled ?? loading` would let `disabled={false}` re-enable a loading button and
      // allow a double submit; a button that is either is not pressable.
      disabled={disabled || loading}
      // Screen readers need to know the control is working; a spinner is invisible to them.
      aria-busy={loading || undefined}
      {...props}
    >
      {/* Decorative: the button already announces itself via aria-busy and its label. */}
      {loading && <Spinner className="size-4" decorative />}
      {loading && loadingLabel ? loadingLabel : children}
    </button>
  );
});
