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
  /**
   * The element the title renders as. Default `p`, which is right for an empty state INSIDE
   * a page that already has its own heading — an empty orders list under "Your orders".
   *
   * A route-level state is the opposite case: `not-found.tsx` and `error.tsx` replace the
   * whole page, so their title is the document's only heading and must be an `h1`. Rendering
   * it as a `p` leaves the page with no heading at all, which is exactly the defect §9.7
   * found on the homepage — "navigate by headings" lands on nothing.
   *
   * Added by Stage 2 rather than building a second route-state component: the layout,
   * spacing and slots are identical, and a copy would be a second thing to restyle.
   */
  titleAs?: 'p' | 'h1' | 'h2';
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  titleAs: Title = 'p',
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
        <Title className="text-h3 font-semibold text-ink">{title}</Title>
        {description && <p className="max-w-xs text-body text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
