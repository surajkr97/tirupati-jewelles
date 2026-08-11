/**
 * The last-resort error boundary — catches a throw in the ROOT layout itself.
 * Created by the UI redesign, Stage 2 (audit C-2).
 *
 * `app/error.tsx` sits inside the root layout, so it cannot catch an error that happened
 * while that layout was rendering. This one replaces the entire document, which is why it
 * must supply its own `<html>` and `<body>` — the ones it is replacing never rendered.
 *
 * ── Why the styling is inline, and why that is not a token violation ──
 *
 * `globals.css` is imported by the root layout. When the root layout is the thing that
 * failed, there is no guarantee the stylesheet was linked, so every Tailwind class here
 * could resolve to nothing and the page would render as unstyled black-on-white — the exact
 * default this file exists to replace.
 *
 * So the colours come from `lib/design/tokens.ts` — the same mirror `contrast.test.ts`
 * already pins to `globals.css` — rather than from hex literals. Inline styles are the
 * delivery mechanism; the palette is still the single source of truth, and this page cannot
 * drift from it without failing the contrast suite first.
 *
 * The type scale is written out because it has no JS mirror, and adding one for a page that
 * renders when the stylesheet is missing would be a mirror to keep correct for no gain.
 */
'use client';

import { COLORS } from '@/lib/design/tokens';

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en-IN">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          padding: '20px',
          backgroundColor: COLORS.cream,
          color: COLORS.ink,
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
          textAlign: 'center',
        }}
      >
        <main style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '420px' }}>
          <h1 style={{ margin: 0, fontSize: '24px', lineHeight: '32px', fontWeight: 600 }}>
            Something went wrong
          </h1>
          <p style={{ margin: 0, fontSize: '16px', lineHeight: '26px', color: COLORS.muted }}>
            The site failed to load. Please try again in a moment.
          </p>

          {/*
            A plain anchor, not `reset()` and not `<Link>`.

            The router is part of what may have failed here, so a full document load is the
            only recovery that is certainly available. `<Link>` would need a working router
            to do anything at all.
          */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- deliberate: see
              the comment above. `<Link>` needs a working router, and the router is part of
              what may have failed to render this boundary at all. */}
          <a
            href="/"
            style={{
              display: 'inline-flex',
              minHeight: '52px',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 24px',
              borderRadius: '999px',
              backgroundColor: COLORS.ink,
              color: COLORS.white,
              fontSize: '16px',
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            Reload the site
          </a>

          {error.digest && (
            <p
              style={{
                margin: 0,
                fontSize: '14px',
                lineHeight: '20px',
                color: COLORS.muted,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              Reference {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
