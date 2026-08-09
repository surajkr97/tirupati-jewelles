/**
 * EmptyState primitive.
 * Created by Phase 2 (specs/02-design-system.md §2.2).
 */
import { cn } from '@/lib/utils/cn';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 px-6 py-12 text-center',
        className,
      )}
    >
      {icon && <div className="text-muted">{icon}</div>}
      <div className="flex flex-col gap-2">
        <p className="text-h3 font-semibold text-ink">{title}</p>
        {description && <p className="max-w-xs text-body text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
