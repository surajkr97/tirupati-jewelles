/**
 * Phase 9 TEST — the half of §9.1 item 9 that DEBT-036 did not close.
 *
 * §9.1 marks "Structured logging with phone numbers and emails redacted" as done, and it was
 * true of `log.*` — the calls this codebase makes. It was not true of the process's output as
 * a whole: an uncaught route error is printed by **Next**, to stdout, before any of our code
 * sees it.
 *
 * Measured rather than reasoned about. `pnpm verify:sentry` throws a Prisma-shaped error, and
 * before this the terminal printed
 *
 *   ⨯ Error: … with value verify-scrubbing@example.com for +919999900001
 *
 * in full — while the Sentry event for the SAME error arrived correctly redacted. Two pipes,
 * one redacted, one not, and the unredacted one is the platform's log viewer in production.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installConsoleRedaction } from '@/lib/log';

const PHONE = '+919876543210';
const EMAIL = 'customer@example.com';

describe('installConsoleRedaction', () => {
  let written: unknown[][];

  beforeEach(() => {
    written = [];
    // Replaced before installing, so the patch wraps this spy and we see what it received.
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      written.push(args);
    });
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      written.push(args);
    });

    delete (console as Console & { __redacted?: boolean }).__redacted;
    installConsoleRedaction();
  });

  afterEach(() => {
    delete (console as Console & { __redacted?: boolean }).__redacted;
    vi.restoreAllMocks();
  });

  it('redacts a string argument', () => {
    console.error(`No user for ${PHONE} / ${EMAIL}`);

    const line = String(written[0]?.[0]);
    expect(line).not.toContain(PHONE);
    expect(line).not.toContain(EMAIL);
  });

  /**
   * The case that started this: Next hands `console.error` an Error object, not a string.
   * A patch that only handled strings would have looked correct and changed nothing.
   */
  it('redacts an Error’s message and stack', () => {
    const error = new Error(
      `Unique constraint failed on the fields: (email) with value ${EMAIL} for ${PHONE}`,
    );
    console.error(error);

    const received = written[0]?.[0] as Error;
    expect(received).toBeInstanceOf(Error);
    expect(received.message).not.toContain(EMAIL);
    expect(received.message).not.toContain(PHONE);
    expect(received.stack ?? '').not.toContain(EMAIL);
    // Still diagnosable — a redactor that removes the diagnosis with the identifier makes
    // the log useless, which is how redaction gets switched off.
    expect(received.message).toContain('Unique constraint failed');
  });

  /**
   * An **Error**, not a string. Passing the redacted stack as a string was the first attempt
   * and it cost the code frame: Next source-maps an Error it is handed, so a string was
   * printed verbatim and the terminal showed a compiled chunk path instead of `route.ts:52`.
   */
  it('hands back an Error so Next can still source-map it', () => {
    console.error(new Error(`boom ${EMAIL}`));
    expect(written[0]?.[0]).toBeInstanceOf(Error);
  });

  it('does not mutate the original — Sentry reads that object', () => {
    // `beforeSend` runs on the original error. If this patch reached across and changed it,
    // the two pipes would stop being independent and a bug in one would hide in the other.
    const error = new Error(`leak ${EMAIL}`);
    console.error(error);

    expect(error.message).toContain(EMAIL);
  });

  it('redacts inside objects', () => {
    console.log({ identifier: PHONE, nested: { email: EMAIL } });

    const dump = JSON.stringify(written[0]?.[0]);
    expect(dump).not.toContain(PHONE);
    expect(dump).not.toContain(EMAIL);
  });

  it('leaves ordinary output alone', () => {
    // The negative control. A patch that mangled every line would pass everything above.
    console.log('GET /api/rates 200 in 12ms');
    expect(written[0]?.[0]).toBe('GET /api/rates 200 in 12ms');
  });

  it('is idempotent — installing twice does not double-wrap', () => {
    installConsoleRedaction();
    installConsoleRedaction();

    console.log('plain');
    expect(written).toHaveLength(1);
    expect(written[0]?.[0]).toBe('plain');
  });
});
