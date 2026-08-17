/**
 * @vitest-environment jsdom
 *
 * Stage 7 — `Section`'s "see all" link opens off-site links in a new tab, safely.
 *
 * The reels rail points this at instagram.com, which is the first external `seeAllHref` in
 * the codebase. The behaviour is derived from the href rather than passed as a prop, so the
 * thing worth pinning is that the derivation goes BOTH ways: an external link must carry
 * `rel="noopener"` (without it the opened tab gets a live `window.opener` handle on this one
 * — reverse tabnabbing), and the twelve internal call sites must NOT start opening tabs.
 */
import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Section } from '@/components/shell/section';

// Without this the `it.each` renders stack up in one document and `getByRole` throws on
// finding several links rather than one.
afterEach(cleanup);

describe('the see-all link', () => {
  it('opens an external href in a new tab, with rel protection', () => {
    render(
      <Section
        heading="From our Instagram"
        seeAllHref="https://www.instagram.com/_tirupati_jewelers_/"
        seeAllLabel="View all"
      >
        <p>tiles</p>
      </Section>,
    );

    const link = screen.getByRole('link', { name: 'View all' });
    expect(link).toHaveAttribute('target', '_blank');
    // Both tokens matter: `noopener` closes the window handle, `noreferrer` covers the
    // older engines where `noopener` alone was not honoured.
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });

  it.each(['/collections', '/admin/bills', '/rates'])(
    'leaves the internal href %s in the same tab',
    (href) => {
      render(
        <Section heading="New arrivals" seeAllHref={href} seeAllLabel="View all">
          <p>tiles</p>
        </Section>,
      );

      const link = screen.getByRole('link', { name: 'View all' });
      expect(link).not.toHaveAttribute('target');
      expect(link).not.toHaveAttribute('rel');
    },
  );

  it('renders no link at all when there is no href', () => {
    render(
      <Section heading="Just a heading">
        <p>tiles</p>
      </Section>,
    );
    expect(screen.queryByRole('link')).toBeNull();
  });
});
