/**
 * Spinner primitive.
 * Created by Phase 2 (specs/02-design-system.md §2.2).
 */
import { cn } from '@/lib/utils/cn';

export function Spinner({
  className,
  label,
  decorative = false,
}: {
  className?: string;
  label?: string;
  /**
   * Render as presentation only — no role, no label.
   *
   * A standalone spinner is a `status` region announcing "Loading", which is right when it
   * is the only thing on screen saying so. Inside a control that already carries `aria-busy`
   * and a label, it is neither: it nests a live region inside a button and prepends
   * "Loading" to that button's accessible name, so `<Button loading>Saving</Button>`
   * announced itself as **"Loading Saving"**. Every loading button in the application read
   * that way until Stage 3.
   *
   * `Button` passes this. Callers rendering a bare spinner should not.
   */
  decorative?: boolean;
}) {
  return (
    <span
      {...(decorative
        ? { 'aria-hidden': true }
        : { role: 'status', 'aria-label': label ?? 'Loading' })}
      className={cn(
        'inline-block size-4 shrink-0 animate-spin rounded-pill',
        'border-2 border-current border-t-transparent',
        className,
      )}
    />
  );
}
