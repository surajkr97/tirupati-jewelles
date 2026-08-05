/**
 * Design tokens, mirrored from app/globals.css for testing.
 * Created by Phase 2 (specs/02-design-system.md §2.1).
 *
 * CSS custom properties cannot be read from Node, so the contrast test needs the values
 * here. `tokens.test.ts` asserts these stay in step with globals.css by parsing the
 * stylesheet — so this file cannot silently drift from the thing it mirrors.
 */

export const COLORS = {
  cream: '#FAF7F4',
  ink: '#1A1613',
  taupe: '#B07D62',
  taupeDeep: '#9B694E',
  taupeLt: '#E8D5C9',
  line: '#EFE9E3',
  muted: '#756C66',
  up: '#0E9F6E',
  down: '#E02D3C',
  white: '#FFFFFF',
} as const;

export type ColorName = keyof typeof COLORS;

/** WCAG AA: 4.5:1 for body text, 3:1 for large text and non-text UI. */
export const AA_BODY = 4.5;
export const AA_LARGE = 3;

/** The only spacing values the design system permits (MASTER-SPEC §3). */
export const SPACING_SCALE = [0, 4, 8, 16, 24, 32, 48, 64] as const;

/** Minimum tap target, in px, for every interactive element. */
export const MIN_TAP_TARGET = 44;

/** Body copy never goes below this, in px. */
export const MIN_BODY_TEXT = 15;

function channelLuminance(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of a `#RRGGBB` colour. */
export function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = channelLuminance(parseInt(h.slice(0, 2), 16));
  const g = channelLuminance(parseInt(h.slice(2, 4), 16));
  const b = channelLuminance(parseInt(h.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `#RRGGBB` colours. Always >= 1. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
