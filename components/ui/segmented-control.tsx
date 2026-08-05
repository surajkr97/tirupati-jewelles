/**
 * SegmentedControl — the pill switcher for 22K / 18K / Silver.
 * Created by Phase 2 (specs/02-design-system.md §2.2).
 *
 * Used by the Phase 4 rate ticker and the Phase 5 calculator item card, so it has to be
 * comfortable one-handed at 375px and animate without shifting layout.
 *
 * Built on the WAI-ARIA radiogroup pattern rather than tablist: this selects a value, it
 * does not switch panels. Arrow keys move and select, which is what a radiogroup does.
 */
'use client';

import { useCallback, useId, useRef } from 'react';

import { cn } from '@/lib/utils/cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: SegmentedControlProps<T>) {
  const groupId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = options.findIndex((o) => o.value === value);

  const focusAt = useCallback(
    (index: number) => {
      const wrapped = (index + options.length) % options.length;
      const option = options[wrapped];
      if (!option) return;
      onChange(option.value);
      refs.current[wrapped]?.focus();
    },
    [onChange, options],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          event.preventDefault();
          focusAt(activeIndex + 1);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          event.preventDefault();
          focusAt(activeIndex - 1);
          break;
        case 'Home':
          event.preventDefault();
          focusAt(0);
          break;
        case 'End':
          event.preventDefault();
          focusAt(options.length - 1);
          break;
      }
    },
    [activeIndex, focusAt, options.length],
  );

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn('relative flex rounded-pill bg-taupe-lt/50 p-1', className)}
    >
      {/* One absolutely positioned thumb slid with translate — animating `transform` never
          triggers layout, so switching metals cannot cause a shift (Phase 4 asserts CLS≈0). */}
      <span
        aria-hidden="true"
        className="absolute inset-y-1 left-1 rounded-pill bg-white shadow-card transition-transform duration-base ease-standard"
        style={{
          width: `calc((100% - 8px) / ${options.length})`,
          transform: `translateX(${activeIndex * 100}%)`,
        }}
      />

      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            id={`${groupId}-${option.value}`}
            // Roving tabindex: the group is one tab stop, arrows move within it.
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative z-10 flex h-tap flex-1 items-center justify-center rounded-pill px-4',
              'text-small font-semibold transition-colors duration-base ease-standard',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink',
              selected ? 'text-ink' : 'text-muted hover:text-ink',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
