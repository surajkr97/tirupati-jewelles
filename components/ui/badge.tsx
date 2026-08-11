/**
 * Badge primitive.
 * Created by Phase 2 (specs/02-design-system.md §2.2).
 */
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils/cn';

const badge = cva(
  'inline-flex items-center gap-1 rounded-pill px-4 py-1 text-small font-medium',
  {
    variants: {
      tone: {
        neutral: 'bg-rose-tint text-ink',
        accent: 'bg-rose-deep text-white',
        up: 'bg-up/10 text-up',
        down: 'bg-down/10 text-down',
        outline: 'text-ink ring-1 ring-inset ring-line',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badge> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badge({ tone }), className)} {...props} />;
}
