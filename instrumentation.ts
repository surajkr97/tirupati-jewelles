/**
 * Next's instrumentation hook — the one place that runs once per server runtime, before
 * anything serves a request.
 * Created by Phase 9 (§9.4).
 *
 * ── Why Sentry starts here and not in a layout ──
 * A layout runs per render, and an error thrown while the server is booting — a bad
 * migration, an unreachable database at start — happens before any layout has rendered.
 * That is exactly the error worth capturing, and it is the one an init in a component
 * misses.
 *
 * ── Why the runtime is checked, and why `lib/env.ts` is imported inside the branch ──
 * This file runs in BOTH the Node and Edge runtimes. `lib/monitoring/sentry.ts` imports
 * `lib/env.ts`, which reads `process.env` and is Node-only; importing it on the Edge would
 * fail at build. The dynamic import inside the guard is what keeps it out of the Edge
 * bundle — a top-level import is traced regardless of the branch it sits in.
 *
 * `proxy.ts` (§9.1's rate limiting) is the only Edge code in this application, and a proxy
 * fault surfaces as a request that never reaches a handler, so it is visible in the Node
 * runtime's reports. Edge-runtime capture would need a separately configured edge client;
 * it is not wired, and that is stated rather than left to be discovered.
 */

/**
 * `NEXT_RUNTIME` is the one `process.env` read in this repository outside `lib/env.ts`, and
 * the exception is argued rather than assumed.
 *
 * Phase 1 §1.5's rule exists so application config has one validated source. This is not
 * application config: it is Next's own discriminator for WHICH RUNTIME this module is
 * executing in, injected by the bundler, and it has to be answered *before* `lib/env.ts` can
 * be imported at all — reading it from there would mean importing a Node-only module on the
 * Edge, which is the precise failure the check prevents. There is no ordering in which the
 * rule can be honoured here.
 *
 * Scoped to this one expression rather than the file, so a genuine config read added below
 * still fails the lint.
 */
function isNodeRuntime(): boolean {
  // A two-line disable comment attaches to the wrong line — the reason lives above.
  // eslint-disable-next-line no-restricted-properties
  return process.env.NEXT_RUNTIME === 'nodejs';
}

export async function register(): Promise<void> {
  if (!isNodeRuntime()) return;

  /**
   * Console redaction FIRST, before anything can print.
   *
   * §9.1 item 9 promises logging with phone numbers and emails redacted, and DEBT-036
   * delivered that for the calls this codebase makes. An uncaught route error is printed by
   * Next itself, ahead of all of it — so the promise was only half kept, and the half that
   * was missing is the one carrying a Prisma error quoting the colliding email. This is the
   * earliest point in the process where it can be closed.
   */
  const { installConsoleRedaction } = await import('@/lib/log');
  installConsoleRedaction();

  const { initMonitoring } = await import('@/lib/monitoring/sentry');
  initMonitoring();
}

/**
 * Errors thrown in a nested React Server Component are reported here.
 *
 * Next swallows them into an error boundary otherwise, so without this hook the most common
 * server error in an App Router application — a failed data read inside a page — would never
 * reach the tracker at all.
 *
 * The DSN comes from `lib/env.ts`, imported inside the Node branch for the reason above.
 */
export async function onRequestError(
  ...args: Parameters<typeof import('@sentry/nextjs').captureRequestError>
): Promise<void> {
  if (!isNodeRuntime()) return;

  const { env } = await import('@/lib/env');
  if (!env.SENTRY_DSN) return;

  const Sentry = await import('@sentry/nextjs');
  Sentry.captureRequestError(...args);
}
