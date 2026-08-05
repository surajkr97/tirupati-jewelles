/**
 * Skeleton primitive.
 * Created by Phase 2 (specs/02-design-system.md §2.2).
 *
 * Phase 4 §4.4 requires the ticker's skeleton to match its final dimensions exactly, so
 * this deliberately takes explicit sizing from the caller rather than guessing.
 */
import { cn } from '@/lib/utils/cn';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      // Decorative: a screen reader should hear the loaded content, not the placeholder.
      aria-hidden="true"
      className={cn('animate-pulse rounded-field bg-line', className)}
      {...props}
    />
  );
}
