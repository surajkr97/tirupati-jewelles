/**
 * Phase 9 §9.7 — `cn()` must not delete a colour or a size it was asked to keep.
 *
 * Found by the axe pass, not by review: the accent button rendered `ink` on `taupe-deep` at
 * 3.87:1 because `tailwind-merge` treated `text-body` as a colour — Phase 2 §2.1 replaced
 * Tailwind's font-size scale and never told it. Every assertion below fails against the
 * plain `twMerge` this module used before.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { cn, TEXT_SIZES } from '@/lib/utils/cn';

describe('cn keeps a colour and a size together', () => {
  /**
   * The exact composition the Button produces. `variant="accent"` contributes the colour,
   * `size="md"` contributes `text-body`, and D-007 exists precisely so that white sits on
   * taupeDeep — white on plain taupe is 3.53:1 and fails AA.
   */
  it('the accent button keeps its white label — D-007, measured at 3.87:1 without this', () => {
    const merged = cn(
      'bg-taupe-deep text-white hover:bg-taupe-deep/90',
      'h-control px-6 text-body',
    );

    expect(merged).toContain('text-white');
    expect(merged).toContain('text-body');
  });

  it.each(TEXT_SIZES)('text-white survives text-%s', (size) => {
    expect(cn('text-white', `text-${size}`)).toContain('text-white');
  });

  it.each(TEXT_SIZES)('the size survives a colour written after it — text-%s', (size) => {
    // The other direction, which loses the SIZE rather than the colour and is the quieter
    // of the two failures: the element keeps its colour and silently takes the inherited
    // font size.
    expect(cn(`text-${size}`, 'text-muted')).toContain(`text-${size}`);
  });
});

describe('cn still resolves genuine conflicts', () => {
  it('the last colour wins', () => {
    expect(cn('text-ink', 'text-muted')).toBe('text-muted');
  });

  it('the last size wins', () => {
    expect(cn('text-body', 'text-lead')).toBe('text-lead');
  });

  it("a caller's background overrides the component's", () => {
    // Phase 2's original reason for using tailwind-merge at all.
    expect(cn('bg-taupe', 'bg-ink')).toBe('bg-ink');
  });

  it('leaves Tailwind’s own scales alone', () => {
    expect(cn('text-white', 'text-lg')).toContain('text-white');
    expect(cn('px-4', 'px-6')).toBe('px-6');
  });
});

describe('TEXT_SIZES mirrors app/globals.css', () => {
  /**
   * `cn.ts` runs in the browser bundle and cannot read the stylesheet, so the scale is
   * declared there and checked here — the same arrangement `lib/design/tokens.ts` has for
   * the colours, and for the same reason: a mirror nothing checks is a mirror that drifts.
   * A size added to the stylesheet and not here silently loses its colour again.
   */
  const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');

  const inCss = [...css.matchAll(/--text-([\w-]+)\s*:/g)]
    .map((match) => match[1] as string)
    // `--text-small--line-height` is a modifier on `small`, not a scale step of its own.
    .filter((key) => !key.endsWith('--line-height'))
    .filter((key, index, all) => all.indexOf(key) === index)
    .sort();

  it('declares exactly the scale the stylesheet defines', () => {
    expect([...TEXT_SIZES].sort()).toEqual(inCss);
  });
});
