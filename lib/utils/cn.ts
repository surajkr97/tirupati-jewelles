/**
 * Class name merge helper.
 * Created by Phase 2 (specs/02-design-system.md §2.2).
 * Taught the §3 type scale by Phase 9 §9.7 — see below.
 *
 * `clsx` handles conditionals; `tailwind-merge` resolves conflicts so a caller's prop can
 * override a component's default. Without it, `<Button className="bg-ink">` on a component
 * that already sets `bg-rose` produces both classes and the winner depends on stylesheet
 * order rather than intent.
 *
 * ── Why the type scale has to be declared here (Phase 9 §9.7) ──
 * `text-*` is ambiguous in Tailwind: it sets either a COLOUR or a FONT SIZE, and
 * tailwind-merge tells them apart from a built-in list of the default font sizes. Phase 2
 * §2.1 replaced that scale with `--text-small … --text-h1-lg`, and nothing told
 * tailwind-merge. So it classified every one of them as a colour and dropped whichever
 * `text-*` came first — SILENTLY, and in whichever direction the classes happened to be
 * written:
 *
 *   cn('text-white', 'text-body')   → 'text-body'    the COLOUR is lost
 *   cn('text-small', 'text-muted')  → 'text-muted'   the SIZE is lost
 *
 * That is the same shape as DEBT-032 — a class that reads as applied and is not — except
 * the class is removed after the fact rather than emitting nothing, so it survives a search
 * of the source. It was found by §9.7's axe pass, which measured the **accent button**
 * rendering `ink` on the accent fill at 3.87:1: `variant="accent"` sets `text-white`, `size`
 * sets `text-body`, and the colour the deepened accent exists to guarantee was being deleted
 * between them. (That measurement was taken on the taupe palette; the same deletion on
 * today's `rose-deep` measures 2.89:1, so the redesign made the bug worse, not better.
 * D-057.)
 *
 * `TEXT_SIZES` is a mirror of `app/globals.css` and mirrors drift, so
 * `lib/utils/cn.test.ts` parses the stylesheet and fails if the two disagree — the same
 * guarantee `lib/design/tokens.ts` and `eslint-rules/no-off-scale-spacing.mjs` are held to.
 */
import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Every `--text-*` key in `app/globals.css`, in scale order.
 *
 * Declared rather than parsed because this module runs in the browser bundle and cannot
 * read a stylesheet off disk. The test is what keeps it honest.
 */
export const TEXT_SIZES = [
  'small',
  'body',
  'lead',
  'h3',
  'h2',
  'h1',
  'display',
  'h1-lg',
] as const;

const twMerge = extendTailwindMerge({
  extend: { classGroups: { 'font-size': [{ text: [...TEXT_SIZES] }] } },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
