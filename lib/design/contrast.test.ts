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

import { AA_BODY, AA_LARGE, COLORS, contrastRatio } from '@/lib/design/tokens';

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
    expect(COLORS.muted).toBe('#756C66');
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
});
