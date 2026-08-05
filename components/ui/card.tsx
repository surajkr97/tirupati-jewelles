/**
 * Card primitive.
 * Created by Phase 2 (specs/02-design-system.md §2.2).
 *
 * Radius 24px, white, soft shadow, NO border. MASTER-SPEC §3: "No borders on cards.
 * Shadow or nothing."
 */
'use client';

import { forwardRef } from 'react';

import { cn } from '@/lib/utils/cn';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Adds a lift on hover and a press response. Use only when the whole card is a target. */
  interactive?: boolean;
  /** 24px mobile / 32px desktop, per the ticker card in Phase 4 §4.4. */
  padded?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, interactive = false, padded = true, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-card bg-white shadow-card',
        padded && 'p-6 md:p-8',
        interactive && [
          'cursor-pointer transition-[transform,box-shadow] duration-base ease-standard',
          'hover:shadow-lift active:scale-[0.98]',
        ],
        className,
      )}
      {...props}
    />
  );
});
