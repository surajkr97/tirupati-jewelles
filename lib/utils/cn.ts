/**
 * Class name merge helper.
 * Created by Phase 2 (specs/02-design-system.md §2.2).
 *
 * `clsx` handles conditionals; `tailwind-merge` resolves conflicts so a caller's prop can
 * override a component's default. Without it, `<Button className="bg-ink">` on a component
 * that already sets `bg-taupe` produces both classes and the winner depends on stylesheet
 * order rather than intent.
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
