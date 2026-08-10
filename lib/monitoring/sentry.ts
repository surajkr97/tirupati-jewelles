/**
 * Sentry, with the PII scrubbing §9.4 requires configured before it can send anything.
 * Created by Phase 9 (§9.4).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE SCRUBBER IS NOT OPTIONAL AND IS NOT SEPARATE FROM THE SETUP.
 *
 *  §9.4: "Sentry for errors, with PII scrubbing configured **before** launch." The word
 *  "before" is doing work: an error tracker wired up now and scrubbed later spends the
 *  intervening period shipping customer phone numbers and email addresses to a third
 *  party, and those events are retained. There is no window here — `beforeSend` is set in
 *  the same call that sets the DSN, and `lib/monitoring/monitoring.test.ts` asserts an
 *  event carrying a phone number and an email comes out with neither.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── It reuses `redact()` rather than defining a second rule ──
 * DEBT-036 built the log redactor and closed with: *"`redact()` is exported for §9.4's
 * Sentry `beforeSend` so the two cannot disagree."* This is that. A second scrubbing rule
 * would drift from the first, and the failure mode is silent — nobody notices the pattern
 * that stopped matching until a support ticket quotes a customer's number back from an
 * error report.
 *
 * ── Absent DSN is a supported state ──
 * No DSN, no init, no behaviour change. Development, CI and a not-yet-provisioned deploy
 * all run that way, so the code path that exists in production must not be one nobody has
 * executed — hence the tests drive `scrubEvent` directly rather than through the SDK.
 */
import 'server-only';

import * as Sentry from '@sentry/nextjs';

import { env } from '@/lib/env';
import { log, redact } from '@/lib/log';

/** Fields Sentry populates itself that are PII by definition. */
function stripUser(event: Sentry.ErrorEvent): void {
  if (!event.user) return;
  // `id` is our own opaque user id and is safe; everything else identifies a person.
  const { id } = event.user;
  event.user = id ? { id } : {};
}

/**
 * Everything a Sentry event can carry that might hold a phone number or an email.
 *
 * Deliberately broad. The alternative — listing the fields we believe carry PII — fails the
 * first time a new integration adds one, and this application puts customer identifiers in
 * exactly the places an error report likes to quote: the message, the breadcrumbs, the
 * request body, the exception value.
 */
export function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  stripUser(event);

  if (event.message) event.message = redact(event.message) as string;

  if (event.exception?.values) {
    for (const value of event.exception.values) {
      if (value.value) value.value = redact(value.value) as string;
    }
  }

  if (event.breadcrumbs) {
    for (const crumb of event.breadcrumbs) {
      if (crumb.message) crumb.message = redact(crumb.message) as string;
      if (crumb.data) crumb.data = redact(crumb.data) as Record<string, unknown>;
    }
  }

  if (event.extra) event.extra = redact(event.extra) as Record<string, unknown>;
  if (event.tags) event.tags = redact(event.tags) as typeof event.tags;

  if (event.request) {
    // A URL can carry an identifier in the query string, and a cookie header IS a session.
    if (event.request.url) event.request.url = redact(event.request.url) as string;
    if (event.request.query_string) {
      event.request.query_string = redact(event.request.query_string) as string;
    }
    if (event.request.data) event.request.data = redact(event.request.data);
    delete event.request.cookies;
    delete event.request.headers;
  }

  return event;
}

let started = false;

/**
 * Initialise Sentry, once, if there is a DSN.
 *
 * Idempotent because Next runs instrumentation per runtime (node, edge) and a double init
 * would attach two `beforeSend` chains.
 */
export function initMonitoring(): void {
  if (started) return;
  started = true;

  if (!env.SENTRY_DSN) {
    log.info('monitoring.disabled', { reason: 'no SENTRY_DSN' });
    return;
  }

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,

    /**
     * `sendDefaultPii: false` is the SDK's default and is stated anyway.
     *
     * A future contributor turning it on to "get more context" is exactly the change this
     * comment exists to argue with: the context it adds is IP addresses, cookies and
     * request bodies, on an application whose bodies carry phone numbers.
     */
    sendDefaultPii: false,

    beforeSend: (event) => scrubEvent(event),

    /**
     * Breadcrumbs are scrubbed above, but a navigation crumb to `/claim/{token}` would put
     * a single-use credential in the report before `beforeSend` ever sees the event as a
     * whole — so that one is dropped at source.
     */
    beforeBreadcrumb: (crumb) => {
      if (typeof crumb.data?.to === 'string' && crumb.data.to.startsWith('/claim/')) {
        return null;
      }
      return crumb;
    },
  });

  log.info('monitoring.enabled', {
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
  });
}
