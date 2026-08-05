/**
 * Container — max 1200px, gutters 20px mobile / 40px desktop.
 * Created by Phase 2 (specs/02-design-system.md §2.3), layout from MASTER-SPEC §3.
 *
 * The 20px gutter is the one place an off-scale value is correct: MASTER-SPEC §3 fixes the
 * spacing scale at 4/8/16/24/32/48/64 but separately specifies a 20px horizontal gutter.
 * It is stated, not arbitrary, so it lives here once rather than being reached for ad hoc.
 */
import { cn } from '@/lib/utils/cn';

export function Container({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('mx-auto w-full max-w-[1200px] px-[20px] md:px-[40px]', className)}
      {...props}
    />
  );
}
