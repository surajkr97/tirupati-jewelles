/**
 * Input primitive.
 * Created by Phase 2 (specs/02-design-system.md §2.2).
 *
 * The `inputMode` prop is load-bearing, not cosmetic: Phase 5's calculator is a grid of
 * numeric fields used one-handed on a phone, and the wrong keyboard makes it unusable.
 */
'use client';

import { forwardRef, useId } from 'react';

import { cn } from '@/lib/utils/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  /** Rendered inside the field, e.g. `g` for grams or `%` for making charge. */
  suffix?: string;
  /**
   * Rendered inside the field at the leading edge, e.g. `+91` on a phone number.
   *
   * Added by Phase 8 (§8.1: "customer phone … with a `+91` prefix affordance"). The mirror
   * of `suffix`, and here for the same reason: an adornment the user cannot select, delete
   * or type over. On the bill form the number becomes the order's claim key, so a country
   * code that can be accidentally erased is how a purchase becomes unclaimable.
   */
  prefix?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, label, error, hint, suffix, prefix, id, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;

  return (
    <div className="flex w-full flex-col gap-2">
      {label && (
        <label htmlFor={inputId} className="text-small font-medium text-ink">
          {label}
        </label>
      )}

      <div className="relative flex items-center">
        {prefix && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-4 text-body text-muted"
          >
            {prefix}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          // Point at whichever description exists so the message is announced, not just seen.
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          className={cn(
            'h-control w-full rounded-field bg-white px-4 text-body text-ink',
            'ring-1 ring-inset ring-line placeholder:text-muted',
            'transition-[box-shadow] duration-fast ease-standard',
            'focus:ring-2 focus:ring-ink focus:outline-none',
            'disabled:opacity-40',
            suffix && 'pr-12',
            /**
             * `pl-16`, not `pl-14`.
             *
             * Phase 2 §2.1 sets `--spacing: initial` and defines only the design scale, so
             * `pl-14` does not exist — and Tailwind emits nothing rather than complaining.
             * The class sat in the list looking correct while `padding-left` computed to the
             * 16px from `px-4`, and `+91` overlapped the typed number by 27px. Measured, not
             * spotted: it is legible enough in a screenshot to survive a glance.
             *
             * 64px clears the widest prefix this field takes with room to read.
             */
            prefix && 'pl-16',
            error && 'ring-down focus:ring-down',
            className,
          )}
          {...props}
        />
        {suffix && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-4 text-body text-muted"
          >
            {suffix}
          </span>
        )}
      </div>

      {error ? (
        <p id={errorId} role="alert" className="text-small text-down">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-small text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
