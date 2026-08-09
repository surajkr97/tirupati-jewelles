/**
 * Phase 2 TEST: "Automated contrast check on token pairs."
 * specs/02-design-system.md — DESIGN audit + acceptance criterion 4.
 *
 * §2.1 flagged muted-on-cream as borderline and told us to measure it. It measured 3.57:1
 * and failed, so the token was darkened to #756C66 exactly as instructed. Measuring also
 * turned up a second failure the spec did not anticipate — white on taupe at 3.53:1, which
 * is the accent button in MASTER-SPEC §3. See DECISIONS.md D-007.
 *
 * These assertions exist so neither can regress by someone "tidying" a hex value.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AA_BODY, AA_LARGE, COLORS, composite, contrastRatio } from '@/lib/design/tokens';

describe('token contrast on the cream page background', () => {
  it.each([
    ['ink (primary text)', COLORS.ink, AA_BODY],
    ['muted (secondary text)', COLORS.muted, AA_BODY],
  ])('%s meets AA body text', (_name, fg, threshold) => {
    expect(contrastRatio(fg, COLORS.cream)).toBeGreaterThanOrEqual(threshold);
  });

  it.each([
    ['taupe (accent, non-text)', COLORS.taupe],
    ['up (price rising)', COLORS.up],
    ['down (price falling)', COLORS.down],
  ])('%s meets AA large/non-text', (_name, fg) => {
    expect(contrastRatio(fg, COLORS.cream)).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it('muted is the darkened value, not the original that failed', () => {
    // The spec's first-draft #8A817C measures 3.57:1 — kept here as a guard so nobody
    // reverts the token by copying MASTER-SPEC §3 verbatim.
    expect(contrastRatio('#8A817C', COLORS.cream)).toBeLessThan(AA_BODY);
    // Darkened once more in §9.7, for the segmented control's tint. See D-038.
    expect(COLORS.muted).toBe('#6E6560');
  });
});

/**
 * Phase 9 §9.7 — the pairs Phase 2 did not enumerate.
 *
 * Phase 2 checked nine pairings and they all passed, which is why this went unnoticed for
 * seven phases: the palette was never wrong, the COMPOSITIONS were. `axe` measured the
 * rendered pages and found 97 failing nodes across twelve distinct pairs, and every one was
 * a shape nobody had listed — a token on a tinted surface, a token at reduced alpha, or an
 * accent verified at 3:1 as "non-text" and then used as 14px text.
 *
 * These are the same checks in Node, so a regression fails in 200ms rather than needing a
 * browser. The axe suite (`e2e/a11y.spec.ts`) is what proves the list is complete; this is
 * what makes it cheap to keep true.
 */
describe('§9.7 — tokens as rendered, not as pairs', () => {
  /** The segmented control's track: `bg-taupe-lt/50` over each page background. */
  const TRACK_ON_CREAM = composite(COLORS.taupeLt, COLORS.cream, 0.5);
  const TRACK_ON_WHITE = composite(COLORS.taupeLt, COLORS.white, 0.5);
  /** The empty ImageFrame: `bg-taupe-lt/40`. */
  const FRAME_ON_CREAM = composite(COLORS.taupeLt, COLORS.cream, 0.4);

  it.each([
    ['muted on the segmented track over cream', COLORS.muted, TRACK_ON_CREAM],
    ['muted on the segmented track over white', COLORS.muted, TRACK_ON_WHITE],
    ['muted as the empty-frame monogram', COLORS.muted, FRAME_ON_CREAM],
    ['muted on a card', COLORS.muted, COLORS.white],
    ['muted on a hairline surface', COLORS.muted, COLORS.line],
  ])('%s meets AA body', (_name, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_BODY);
  });

  /**
   * `up` and `down` are TEXT. Phase 2 checked them at `AA_LARGE`, reading them as price
   * indicators — but the rate history renders them at 14px and the bill list renders them
   * as a badge on `bg-up/10`, where the foreground sits on a tint of itself and the ratio
   * is at its worst. 3.01:1 before §9.7.
   */
  it.each([
    ['up on cream', COLORS.up, COLORS.cream],
    ['up on a card', COLORS.up, COLORS.white],
    [
      'up on its own 10% badge over white',
      COLORS.up,
      composite(COLORS.up, COLORS.white, 0.1),
    ],
    [
      'up on its own 10% badge over cream',
      COLORS.up,
      composite(COLORS.up, COLORS.cream, 0.1),
    ],
    ['down on cream', COLORS.down, COLORS.cream],
    ['down on a card', COLORS.down, COLORS.white],
    [
      'down on its own 10% badge over white',
      COLORS.down,
      composite(COLORS.down, COLORS.white, 0.1),
    ],
  ])('%s meets AA body, because it is text', (_name, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_BODY);
  });

  /**
   * `taupeDeep` in its second job. D-007 created it as a BACKGROUND for white text and
   * checked only that direction; the application also uses it as the link and eyebrow
   * colour, where it measured 4.35 and failed.
   */
  it.each([
    ['taupeDeep as text on cream', COLORS.taupeDeep, COLORS.cream],
    ['taupeDeep as text on a card', COLORS.taupeDeep, COLORS.white],
  ])('%s meets AA body', (_name, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_BODY);
  });

  it('plain taupe still cannot be text anywhere, which is why §9.7 moved three labels', () => {
    // Not a regression guard on a value — a guard on a HABIT. Every time someone reaches
    // for `text-taupe` this is the number they are reaching for.
    expect(contrastRatio(COLORS.taupe, COLORS.cream)).toBeLessThan(AA_BODY);
    expect(contrastRatio(COLORS.taupe, COLORS.white)).toBeLessThan(AA_BODY);
  });

  it('the monogram at 60% alpha — the worst pair in the application — is gone', () => {
    // 1.83:1. Kept as a measurement so the old treatment cannot come back as a "subtle"
    // tweak without failing here first.
    const old = composite(COLORS.taupe, COLORS.cream, 0.6);
    expect(contrastRatio(old, FRAME_ON_CREAM)).toBeLessThan(3);
  });
});

describe('button label contrast', () => {
  it('white on ink (primary button) meets AA body', () => {
    expect(contrastRatio(COLORS.white, COLORS.ink)).toBeGreaterThanOrEqual(AA_BODY);
  });

  it('white on taupeDeep (accent button) meets AA body', () => {
    expect(contrastRatio(COLORS.white, COLORS.taupeDeep)).toBeGreaterThanOrEqual(AA_BODY);
  });

  it('white on plain taupe does NOT — which is why taupeDeep exists', () => {
    // Button labels are 16px semibold. WCAG "large text" starts at 18.66px bold, so this
    // needs the full 4.5:1 and cannot claim the 3:1 allowance.
    expect(contrastRatio(COLORS.white, COLORS.taupe)).toBeLessThan(AA_BODY);
  });

  it('ink on taupeLt (badge) meets AA body', () => {
    expect(contrastRatio(COLORS.ink, COLORS.taupeLt)).toBeGreaterThanOrEqual(AA_BODY);
  });
});

describe('tokens.ts mirrors app/globals.css', () => {
  // tokens.ts exists because Node cannot read CSS custom properties. That duplication is
  // only safe if something proves the two agree.
  const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');

  it.each([
    ['--color-cream', COLORS.cream],
    ['--color-ink', COLORS.ink],
    ['--color-taupe', COLORS.taupe],
    ['--color-taupe-deep', COLORS.taupeDeep],
    ['--color-taupe-lt', COLORS.taupeLt],
    ['--color-line', COLORS.line],
    ['--color-muted', COLORS.muted],
    ['--color-up', COLORS.up],
    ['--color-down', COLORS.down],
  ])('%s matches', (prop, expected) => {
    const match = new RegExp(`${prop}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
    expect(match?.[1]?.toUpperCase()).toBe(expected.toUpperCase());
  });

  /**
   * The other direction, added by §9.7.
   *
   * The list above checks that each token this file knows about matches the stylesheet — so
   * a colour ADDED to `globals.css` and never mirrored here would be invisible to every
   * contrast assertion in this suite, silently. "Contrast verified on the final palette"
   * has to mean the whole palette, and a list that only checks itself cannot promise that.
   */
  it('has a mirror for every --color-* the stylesheet defines', () => {
    const inCss = [...css.matchAll(/--color-([\w-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)]
      .map((match) => (match[2] as string).toUpperCase())
      .sort();

    const mirrored = Object.values(COLORS)
      .map((hex) => hex.toUpperCase())
      // `white` is not a design token; it is the card surface Tailwind already provides.
      .filter((hex) => hex !== '#FFFFFF')
      .sort();

    expect(mirrored).toEqual(inCss);
  });
});
