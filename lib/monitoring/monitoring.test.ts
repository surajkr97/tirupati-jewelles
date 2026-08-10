/**
 * Phase 9 TEST — §9.4's PII scrubbing, asserted rather than configured and hoped for.
 *
 * §9.4: "Sentry for errors, with PII scrubbing configured **before** launch." The risk this
 * guards is specific and one-way: an error report that carries a customer's phone number has
 * already left the building by the time anyone notices, and it is retained by a third party.
 * There is no rollback.
 *
 * So the events below are built to look like the ones this application actually produces —
 * a Prisma error quoting a unique-constraint value, a breadcrumb from the OTP path, a
 * request body from `POST /api/auth/login` — and every one is checked to come out with the
 * identifiers gone. DEBT-036 measured the Prisma case as a real leak in logs; this is the
 * same leak through a different pipe.
 */
import type { ErrorEvent } from '@sentry/nextjs';
import { describe, expect, it } from 'vitest';

import { scrubEvent } from '@/lib/monitoring/sentry';

const PHONE = '+919876543210';
const EMAIL = 'customer@example.com';

/** Everything in the event, flattened, so a leak anywhere fails the assertion. */
function serialise(event: ErrorEvent): string {
  return JSON.stringify(event);
}

function eventWith(overrides: Partial<ErrorEvent>): ErrorEvent {
  return { event_id: 'x', timestamp: 0, ...overrides } as ErrorEvent;
}

describe('§9.4 — a Sentry event carries no customer identifier', () => {
  it('scrubs the message', () => {
    const event = scrubEvent(
      eventWith({ message: `No user found for phone ${PHONE} / ${EMAIL}` }),
    );

    expect(serialise(event)).not.toContain(PHONE);
    expect(serialise(event)).not.toContain(EMAIL);
  });

  it('scrubs the exception value — the Prisma case DEBT-036 measured', () => {
    const event = scrubEvent(
      eventWith({
        exception: {
          values: [
            {
              type: 'PrismaClientKnownRequestError',
              value: `Unique constraint failed on the fields: (email) with value ${EMAIL}`,
            },
          ],
        },
      }),
    );

    expect(serialise(event)).not.toContain(EMAIL);
    // Still says what broke. A redactor that removes the diagnosis with the identifier has
    // made the report useless, which is how scrubbing gets switched off.
    expect(event.exception?.values?.[0]?.value).toContain('Unique constraint failed');
  });

  it('scrubs breadcrumbs, which is where the OTP path leaves its trail', () => {
    const event = scrubEvent(
      eventWith({
        breadcrumbs: [
          { message: `otp requested for ${PHONE}`, data: { identifier: EMAIL } },
        ],
      }),
    );

    expect(serialise(event)).not.toContain(PHONE);
    expect(serialise(event)).not.toContain(EMAIL);
  });

  it('scrubs the request, and drops cookies and headers outright', () => {
    const event = scrubEvent(
      eventWith({
        request: {
          url: `https://example.com/account?email=${EMAIL}`,
          query_string: `email=${EMAIL}`,
          data: { identifier: PHONE, password: 'hunter2' },
          cookies: { session: 'a-real-session-id' },
          headers: { cookie: 'session=a-real-session-id' },
        },
      }),
    );

    const text = serialise(event);
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain(PHONE);
    // A session id IS a credential — §6 SECURITY's SEC-013 finding. Not scrubbed, removed.
    expect(text).not.toContain('a-real-session-id');
    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.headers).toBeUndefined();
  });

  it('keeps the opaque user id and discards every other user field', () => {
    const event = scrubEvent(
      eventWith({
        user: { id: 'usr_123', email: EMAIL, username: PHONE, ip_address: '203.0.113.9' },
      }),
    );

    // The id is ours and identifies a row, not a person, and it is what makes a report
    // actionable — "this happened to the same account four times".
    expect(event.user).toEqual({ id: 'usr_123' });
    expect(serialise(event)).not.toContain(EMAIL);
    expect(serialise(event)).not.toContain('203.0.113.9');
  });

  it('scrubs extra and tags, which is where ad-hoc context goes', () => {
    const event = scrubEvent(
      eventWith({
        extra: { customerPhone: PHONE, note: `sent to ${EMAIL}` },
        tags: { identifier: PHONE },
      }),
    );

    expect(serialise(event)).not.toContain(PHONE);
    expect(serialise(event)).not.toContain(EMAIL);
  });

  it('leaves an event with nothing sensitive alone', () => {
    // The negative control. A scrubber that empties every event would pass all of the above
    // and make the tracker worthless.
    const event = scrubEvent(
      eventWith({
        message: 'Failed to render bill PDF for order 3f2504e0',
        tags: { route: '/admin/bills' },
      }),
    );

    expect(event.message).toContain('Failed to render bill PDF');
    expect(event.tags?.route).toBe('/admin/bills');
  });
});
