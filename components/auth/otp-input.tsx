/**
 * Six-box OTP input.
 * Created by Phase 3 (specs/03-auth.md §3.7).
 *
 * The small details here are the whole point of the component:
 *
 *  - `autoComplete="one-time-code"` lets iOS offer the code straight from the SMS banner.
 *    §3.7 calls it "small detail, large UX difference", and it is the difference between
 *    tapping once and switching apps to memorise six digits.
 *  - `inputMode="numeric"` gets the numeric keypad rather than the full keyboard.
 *  - Paste fills every box, because people paste the whole code, not one digit at a time.
 *  - Backspace on an empty box steps back, which is what everyone expects and almost no
 *    hand-rolled implementation does.
 */
'use client';

import { useCallback, useEffect, useRef } from 'react';

import { cn } from '@/lib/utils/cn';

export interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Fired when all boxes are filled — lets the form submit without a button press. */
  onComplete?: (value: string) => void;
  length?: number;
  disabled?: boolean;
  error?: boolean;
  autoFocus?: boolean;
}

export function OtpInput({
  value,
  onChange,
  onComplete,
  length = 6,
  disabled = false,
  error = false,
  autoFocus = true,
}: OtpInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const completedFor = useRef<string | null>(null);

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (value.length === length && completedFor.current !== value) {
      completedFor.current = value;
      onComplete?.(value);
    }
    if (value.length < length) completedFor.current = null;
  }, [value, length, onComplete]);

  const setDigit = useCallback(
    (index: number, digit: string) => {
      const next = value.split('');
      next[index] = digit;
      onChange(next.join('').slice(0, length));
    },
    [value, onChange, length],
  );

  const handleChange = (index: number, raw: string) => {
    const digits = raw.replace(/\D/g, '');
    if (!digits) return;

    // A paste (or an iOS autofill) arrives as one long string in a single box; spread it
    // across the remaining boxes instead of dropping all but the first character.
    if (digits.length > 1) {
      const merged = (value.slice(0, index) + digits).slice(0, length);
      onChange(merged);
      refs.current[Math.min(merged.length, length - 1)]?.focus();
      return;
    }

    setDigit(index, digits);
    if (index < length - 1) refs.current[index + 1]?.focus();
  };

  const handleKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (value[index]) {
        setDigit(index, '');
      } else if (index > 0) {
        // Empty box: step back and clear the previous one, which is what users expect.
        const next = value.split('');
        next[index - 1] = '';
        onChange(next.join(''));
        refs.current[index - 1]?.focus();
      }
    } else if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      refs.current[index - 1]?.focus();
    } else if (event.key === 'ArrowRight' && index < length - 1) {
      event.preventDefault();
      refs.current[index + 1]?.focus();
    }
  };

  return (
    <div
      className="flex justify-between gap-2"
      role="group"
      aria-label={`${length}-digit verification code`}
    >
      {Array.from({ length }, (_, index) => (
        <input
          key={index}
          ref={(el) => {
            refs.current[index] = el;
          }}
          type="text"
          inputMode="numeric"
          // Only the first box carries it — Safari fills the rest from the paste handler.
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={length}
          value={value[index] ?? ''}
          disabled={disabled}
          aria-label={`Digit ${index + 1}`}
          aria-invalid={error || undefined}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onFocus={(e) => e.target.select()}
          className={cn(
            'h-control w-full min-w-0 rounded-field bg-white text-center',
            'text-h3 font-semibold text-ink tabular',
            'ring-1 ring-inset ring-line',
            'transition-[box-shadow] duration-fast ease-standard',
            'focus:ring-2 focus:ring-ink focus:outline-none',
            'disabled:opacity-40',
            error && 'ring-down focus:ring-down',
          )}
        />
      ))}
    </div>
  );
}
