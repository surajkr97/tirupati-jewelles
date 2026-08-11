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
  /**
   * `wine` is the dark editorial surface — the trust band, the hero panel (D-056).
   *
   * It carries `.surface-wine`, which inverts the focus ring: the default ink outline is
   * 1.05:1 on wine and a keyboard user would see nothing at all. Tying that to the tone
   * rather than leaving it to callers means a wine card cannot be built without it.
   *
   * It also drops the shadow. A shadow tinted with wine, cast by a wine surface, onto a
   * cream page is just a smudge; dark surfaces separate by their own contrast.
   */
  tone?: 'surface' | 'wine';
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, interactive = false, padded = true, tone = 'surface', ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-card',
        tone === 'wine' ? 'surface-wine bg-wine text-cream' : 'bg-white shadow-card',
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
