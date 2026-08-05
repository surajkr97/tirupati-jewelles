/**
 * Select primitive — a styled native <select>.
 * Created by Phase 2 (specs/02-design-system.md §2.2).
 *
 * §2.2 is explicit: "Do not build a custom listbox; native is better on mobile and free
 * a11y." A native select gets the OS picker wheel on iOS and Android, keyboard support,
 * and screen-reader semantics for nothing.
 */
'use client';

import { ChevronDown } from 'lucide-react';
import { forwardRef, useId } from 'react';

import { cn } from '@/lib/utils/cn';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, label, error, id, children, ...props },
  ref,
) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const errorId = `${selectId}-error`;

  return (
    <div className="flex w-full flex-col gap-2">
      {label && (
        <label htmlFor={selectId} className="text-small font-medium text-ink">
          {label}
        </label>
      )}

      <div className="relative flex items-center">
        <select
          ref={ref}
          id={selectId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={cn(
            'h-control w-full appearance-none rounded-field bg-white px-4 pr-12',
            'text-body text-ink ring-1 ring-inset ring-line',
            'transition-[box-shadow] duration-fast ease-standard',
            'focus:ring-2 focus:ring-ink focus:outline-none',
            'disabled:opacity-40',
            error && 'ring-down focus:ring-down',
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-4 size-4 text-muted"
        />
      </div>

      {error && (
        <p id={errorId} role="alert" className="text-small text-down">
          {error}
        </p>
      )}
    </div>
  );
});
