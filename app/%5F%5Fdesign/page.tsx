/**
 * Component gallery — DEV ONLY.
 * Created by Phase 2 (specs/02-design-system.md §2.5).
 *
 * "This is how DESIGN audits without clicking through the whole app." Every primitive in
 * every state, on one page, at 375px first.
 *
 * Blocked in production twice over: `proxy.ts` rewrites the path away, and `notFound()`
 * below fires even if the route were somehow reached. Acceptance criterion 1 requires a
 * 404 under NODE_ENV=production.
 */
import { notFound } from 'next/navigation';

import { GalleryClient } from '@/app/%5F%5Fdesign/gallery-client';
import { Container } from '@/components/shell';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Design system — Tirupati Jewelles',
  robots: { index: false, follow: false },
};

export default function DesignPage() {
  if (env.NODE_ENV === 'production') notFound();

  return (
    <div className="min-h-dvh bg-cream py-12">
      <Container>
        <header className="mb-12 flex flex-col gap-2">
          <span className="text-small font-medium tracking-[0.08em] text-taupe uppercase">
            Phase 2
          </span>
          <h1 className="text-h1 font-semibold text-ink">Design system</h1>
          <p className="max-w-160 text-body text-muted">
            Every primitive in every state. Audit at 375px first, then 768, then 1280. No
            hardcoded hex, no arbitrary radius, no off-scale spacing.
          </p>
        </header>

        <GalleryClient />
      </Container>
    </div>
  );
}
