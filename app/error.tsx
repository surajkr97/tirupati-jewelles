/**
 * Route-level error boundary.
 * Created by the UI redesign, Stage 2 (audit C-2).
 *
 * Before this, any error thrown while rendering a page produced Next's default error screen —
 * in production a bare "Application error: a client-side exception has occurred", with no
 * navigation and nothing to do next.
 *
 * ── What is deliberately not shown ──
 *
 * `error.message` is never rendered. In a production build Next already replaces server error
 * messages with a generic string plus a digest, but a CLIENT-side throw keeps its real
 * message, and those routinely carry query fragments, ids or library internals. Brief §10: no
 * stack traces to users. The `digest` IS shown, quietly — it is the only thing that lets
 * someone reporting a fault be matched to a server-side event, and it is opaque by
 * construction.
 *
 * ── Reporting ──
 *
 * There is no `captureException` call here, and that is deliberate rather than an omission.
 * A SERVER render error is already reported by `onRequestError` in `instrumentation.ts`
 * before this boundary ever renders, so capturing here would double-report it. A purely
 * CLIENT-side throw is not reported — this project has no browser Sentry init
 * (no `instrumentation-client.ts`), so a `captureException` call would compile, type-check
 * and silently do nothing, which is worse than not calling it. Recorded as
 * UI_REDESIGN_DEBT-005 rather than papered over.
 */
'use client';

import Link from 'next/link';
import { TriangleAlert } from 'lucide-react';

import { Container } from '@/components/shell';
import { Button, buttonClasses, EmptyState } from '@/components/ui';

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="grid min-h-dvh place-items-center bg-cream">
      <Container className="grid place-items-center">
        <EmptyState
          // The document's only heading — see EmptyStateProps.titleAs.
          titleAs="h1"
          icon={<TriangleAlert className="size-8" aria-hidden="true" />}
          title="Something went wrong"
          description="That page didn't load. It is usually temporary — trying again often works."
          action={
            <div className="flex flex-col items-center gap-4">
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                {/* `reset()` re-renders the segment without a full page load — the cheapest
                  recovery, and the one that keeps the user where they were. */}
                <Button onClick={reset}>Try again</Button>
                <Link href="/" className={buttonClasses({ variant: 'outline' })}>
                  Back to home
                </Link>
              </div>
              {error.digest && (
                <p className="text-small text-muted">
                  Reference <span className="num">{error.digest}</span>
                </p>
              )}
            </div>
          }
        />
      </Container>
    </main>
  );
}
