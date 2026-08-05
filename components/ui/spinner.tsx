/**
 * Spinner primitive.
 * Created by Phase 2 (specs/02-design-system.md §2.2).
 */
import { cn } from '@/lib/utils/cn';

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span
      role="status"
      aria-label={label ?? 'Loading'}
      className={cn(
        'inline-block size-4 shrink-0 animate-spin rounded-pill',
        'border-2 border-current border-t-transparent',
        className,
      )}
    />
  );
}
