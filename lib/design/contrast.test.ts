/**
 * The palette's contrast gate.
 *
 * Phase 2 created it ("automated contrast check on token pairs", specs/02-design-system.md).
 * Phase 9 §9.7 rewrote it after `axe` measured the palette AS RENDERED and found 97 failing
 * nodes across twelve pairs — every one a composition nobody had enumerated, not a token
 * that was wrong. The UI redesign (D-056/D-057) reset the palette to wine/rose and kept both
 * lessons:
 *
 *   1. Check tokens on the surfaces they are actually drawn on — tints, hairlines, and
 *      their own alpha badges — not just on the page background.
 *   2. Assert the NEGATIVE cases too. Half the rules in this palette are about where a
 *      colour may not go, and a gate that only checks the allowed pairs cannot enforce them.
 *
 * The brief handed over hex values; 10 of 26 pairs failed and four moved before adoption.
 * These assertions are what stop them moving back.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AA_BODY, AA_LARGE, COLORS, composite, contrastRatio } from '@/lib/design/tokens';

describe('token contrast on the cream page background', () => {
  it.each([
    ['ink (primary text)', COLORS.ink, AA_BODY],
    ['muted (secondary text)', COLORS.muted, AA_BODY],
    ['roseDeep (links, active nav)', COLORS.roseDeep, AA_BODY],
  ])('%s meets AA body text', (_name, fg, threshold) => {
    expect(contrastRatio(fg, COLORS.cream)).toBeGreaterThanOrEqual(threshold);
  });

  it.each([
    ['rose (accent, non-text)', COLORS.rose],
    ['up (price rising)', COLORS.up],
    ['down (price falling)', COLORS.down],
  ])('%s meets AA large/non-text', (_name, fg) => {
    expect(contrastRatio(fg, COLORS.cream)).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it('muted is the corrected value, not the one the brief supplied', () => {
    // #8B888F measures 3.27:1 — kept here so nobody reverts the token by copying the
    // redesign brief's palette block verbatim. D-057.
    expect(contrastRatio('#8B888F', COLORS.cream)).toBeLessThan(AA_BODY);
    expect(COLORS.muted).toBe('#6E6B72');
  });
});

/**
 * §9.7's lesson, carried forward: tokens as rendered, not as pairs.
 *
 * `line` is the surface that forced `muted`'s final value — 4.41 at the first candidate.
 * Text on a hairline looks like a pair nobody would compose, which is exactly why it was
 * the one that broke.
 */
describe('tokens on the surfaces they are actually drawn on', () => {
  it.each([
    ['muted on a card', COLORS.muted, COLORS.white],
    ['muted on the rose tint', COLORS.muted, COLORS.roseTint],
    ['muted on a hairline surface', COLORS.muted, COLORS.line],
    ['ink on the rose tint (badge)', COLORS.ink, COLORS.roseTint],
    ['roseDeep on a card', COLORS.roseDeep, COLORS.white],
    ['roseDeep on the rose tint (delta chip)', COLORS.roseDeep, COLORS.roseTint],
  ])('%s meets AA body', (_name, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_BODY);
  });

  /**
   * `up` and `down` are TEXT. Phase 2 checked them at `AA_LARGE`, reading them as price
   * indicators — but the rate history renders them at 14px and the bill list renders them
   * as a badge on `bg-up/10`, where the foreground sits on a tint of itself and the ratio
   * is at its worst. The rose tint is a third surface they land on, from the reference
   * image's delta chip.
   */
  it.each([
    ['up on cream', COLORS.up, COLORS.cream],
    ['up on a card', COLORS.up, COLORS.white],
    ['up on the rose tint', COLORS.up, COLORS.roseTint],
    ['up on its own 10% badge over white', COLORS.up, composite(COLORS.up, COLORS.white, 0.1)],
    ['up on its own 10% badge over cream', COLORS.up, composite(COLORS.up, COLORS.cream, 0.1)],
    ['down on cream', COLORS.down, COLORS.cream],
    ['down on a card', COLORS.down, COLORS.white],
    ['down on the rose tint', COLORS.down, COLORS.roseTint],
    [
      'down on its own 10% badge over white',
      COLORS.down,
      composite(COLORS.down, COLORS.white, 0.1),
    ],
  ])('%s meets AA body, because it is text', (_name, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_BODY);
  });
});

/**
 * The wine surfaces the redesign adds — hero, trust band, footer, admin rail.
 *
 * This half of the palette did not exist before D-056, and it is the half most likely to be
 * got wrong, because a dark surface makes almost anything look acceptable to the eye while
 * failing the measurement.
 */
describe('wine surfaces', () => {
  it.each([
    ['white on wine', COLORS.white, COLORS.wine],
    ['cream on wine', COLORS.cream, COLORS.wine],
    ['cream on wineDeep', COLORS.cream, COLORS.wineDeep],
    ['cream on wineSoft', COLORS.cream, COLORS.wineSoft],
    ['white on wineSoft', COLORS.white, COLORS.wineSoft],
    ['gold on wine', COLORS.gold, COLORS.wine],
    ['gold on wineDeep', COLORS.gold, COLORS.wineDeep],
    ['gold on wineSoft', COLORS.gold, COLORS.wineSoft],
  ])('%s meets AA body', (_name, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_BODY);
  });

  it('softened hero copy stays readable down to 60% cream', () => {
    // The hero's supporting line is not full-strength cream — the reference image sets it
    // back. This fixes how far back it may go before it stops being body text.
    expect(
      contrastRatio(composite(COLORS.cream, COLORS.wine, 0.6), COLORS.wine),
    ).toBeGreaterThanOrEqual(AA_BODY);
  });
});

/**
 * The negative half of the palette.
 *
 * Every assertion here is a rule about where a colour MAY NOT GO, and each one exists
 * because the value passes some other test and therefore looks safe. §9.7 found three
 * eyebrow labels using an accent verified only at 3:1; these are the guards that would have
 * caught them.
 */
describe('the rules that are prohibitions', () => {
  it('rose cannot be text on any light surface — that is what roseDeep is for', () => {
    // Not a regression guard on a value, a guard on a HABIT. Every time someone reaches for
    // `text-rose` on a card, this is the number they are reaching for.
    expect(contrastRatio(COLORS.rose, COLORS.cream)).toBeLessThan(AA_BODY);
    expect(contrastRatio(COLORS.rose, COLORS.white)).toBeLessThan(AA_BODY);
  });

  it('white on rose is not a button — 4.13:1, which is why roseDeep is the fill', () => {
    // Button labels are 16px semibold. WCAG "large text" starts at 18.66px bold, so this
    // needs the full 4.5:1 and cannot claim the 3:1 allowance.
    expect(contrastRatio(COLORS.white, COLORS.rose)).toBeLessThan(AA_BODY);
    expect(contrastRatio(COLORS.white, COLORS.roseDeep)).toBeGreaterThanOrEqual(AA_BODY);
  });

  it('gold cannot appear on a light surface at ANY size, text or not', () => {
    // 2.27:1 on cream. This fails the 3:1 non-text bar, so there is no size, weight or
    // "it is only decorative" argument that rescues it — not a hairline on a card, not an
    // icon on cream. Gold lives on wine. D-057.
    expect(contrastRatio(COLORS.gold, COLORS.cream)).toBeLessThan(AA_LARGE);
    expect(contrastRatio(COLORS.gold, COLORS.white)).toBeLessThan(AA_LARGE);
  });

  it('the hero accent word is display-size only', () => {
    // rose on wine is 4.01 — it clears large text and fails body text. Asserted BOTH ways
    // so that using it at body size fails the build rather than shipping. If it is ever
    // needed at body size, #DD5979 is the measured substitute.
    expect(contrastRatio(COLORS.rose, COLORS.wine)).toBeGreaterThanOrEqual(AA_LARGE);
    expect(contrastRatio(COLORS.rose, COLORS.wine)).toBeLessThan(AA_BODY);
    expect(contrastRatio('#DD5979', COLORS.wine)).toBeGreaterThanOrEqual(AA_BODY);
  });
});

/**
 * Focus must be visible on both halves of the palette.
 *
 * The default ink ring is 1.05:1 on wine — invisible. `.surface-wine` in globals.css swaps
 * it for cream; these are the two measurements that rule depends on.
 */
describe('focus ring visibility', () => {
  it('the default ink ring is visible on light surfaces', () => {
    expect(contrastRatio(COLORS.ink, COLORS.cream)).toBeGreaterThanOrEqual(AA_LARGE);
    expect(contrastRatio(COLORS.ink, COLORS.white)).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it('the ink ring would be invisible on wine, which is why .surface-wine exists', () => {
    expect(contrastRatio(COLORS.ink, COLORS.wine)).toBeLessThan(AA_LARGE);
  });

  it('the cream ring is visible on every wine surface', () => {
    expect(contrastRatio(COLORS.cream, COLORS.wine)).toBeGreaterThanOrEqual(AA_LARGE);
    expect(contrastRatio(COLORS.cream, COLORS.wineDeep)).toBeGreaterThanOrEqual(AA_LARGE);
    expect(contrastRatio(COLORS.cream, COLORS.wineSoft)).toBeGreaterThanOrEqual(AA_LARGE);
  });
});

describe('button label contrast', () => {
  it.each([
    ['white on ink (primary)', COLORS.white, COLORS.ink],
    ['white on roseDeep (accent)', COLORS.white, COLORS.roseDeep],
    ['white on wine (on-wine primary)', COLORS.white, COLORS.wine],
    ['ink on cream (outline/ghost label)', COLORS.ink, COLORS.cream],
    ['wine on white (button on a wine hero)', COLORS.wine, COLORS.white],
  ])('%s meets AA body', (_name, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_BODY);
  });
});

describe('tokens.ts mirrors app/globals.css', () => {
  // tokens.ts exists because Node cannot read CSS custom properties. That duplication is
  // only safe if something proves the two agree.
  const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');

  it.each([
    ['--color-cream', COLORS.cream],
    ['--color-ink', COLORS.ink],
    ['--color-muted', COLORS.muted],
    ['--color-line', COLORS.line],
    ['--color-wine', COLORS.wine],
    ['--color-wine-deep', COLORS.wineDeep],
    ['--color-wine-soft', COLORS.wineSoft],
    ['--color-rose', COLORS.rose],
    ['--color-rose-deep', COLORS.roseDeep],
    ['--color-rose-tint', COLORS.roseTint],
    ['--color-gold', COLORS.gold],
    ['--color-up', COLORS.up],
    ['--color-down', COLORS.down],
  ])('%s matches', (prop, expected) => {
    // `--color-wine` must not match `--color-wine-deep`; anchor on the colon.
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
