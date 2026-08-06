/**
 * §9.1 items 8 and 9 —
 *   "Error responses leak no stack traces in production."
 *   "Structured logging with phone numbers and emails **redacted**."
 * Written by TEST for Phase 9 from `specs/09-hardening.md`.
 *
 * ── Why this exists next to `lib/security/security.test.ts` ──
 * That file tests `redact()` and `redactString()` as pure functions, and they are correct.
 * But §9.1 is not a requirement about a function — it is a requirement about what lands in
 * the log. A perfect redactor that nothing calls satisfies every assertion in that file and
 * none of this one, and SEC-031 was exactly that shape: the redaction was missing at the
 * call site, not in the algorithm.
 *
 * So everything here goes through the real emitter and captures the real `console` output,
 * which is what a production log aggregator receives.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

/** A customer, as they would appear in a Prisma error or a rate-limit key. */
const EMAIL = 'ravi.patel@example.com';
const PHONE = '+919812345678';

interface Captured {
  lines: string[];
  restore: () => void;
}

function captureConsole(): Captured {
  const lines: string[] = [];
  const record = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };

  const spies = [
    vi.spyOn(console, 'error').mockImplementation(record),
    vi.spyOn(console, 'warn').mockImplementation(record),
    vi.spyOn(console, 'log').mockImplementation(record),
  ];

  return { lines, restore: () => spies.forEach((s) => s.mockRestore()) };
}

/**
 * Import the logger bound to a chosen environment.
 *
 * `lib/env.ts` parses at import and `lib/log.ts` captures `env.NODE_ENV`, so production
 * behaviour cannot be reached without re-importing the graph — the technique
 * `lib/http.test.ts` established for the same reason.
 */
async function loadLog(nodeEnv: 'production' | 'development') {
  vi.stubEnv('NODE_ENV', nodeEnv);
  vi.resetModules();
  return import('@/lib/log');
}

async function loadHttp(nodeEnv: 'production' | 'development') {
  vi.stubEnv('NODE_ENV', nodeEnv);
  vi.resetModules();
  return import('@/lib/http');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('§9.1 — logging is structured', () => {
  it('emits one parseable JSON object per line in production', async () => {
    const { log } = await loadLog('production');
    const captured = captureConsole();

    log.error('bill render failed', { orderId: 'abc', attempt: 2 });

    captured.restore();
    expect(captured.lines).toHaveLength(1);

    // "Structured" means a machine can read it. A human-readable line is not this.
    const parsed = JSON.parse(captured.lines[0]!);
    expect(parsed.level).toBe('error');
    expect(parsed.message).toBe('bill render failed');
    expect(typeof parsed.time).toBe('string');
    expect(Number.isNaN(Date.parse(parsed.time))).toBe(false);
  });

  it('carries the context through rather than dropping it', async () => {
    // A structured line that discards its fields is a string with extra steps.
    const { log } = await loadLog('production');
    const captured = captureConsole();

    log.warn('rate limiter degraded', { tier: 'auth', count: 61 });

    captured.restore();
    const parsed = JSON.parse(captured.lines[0]!);
    expect(parsed.tier).toBe('auth');
    expect(parsed.count).toBe(61);
  });

  it('routes each level to the stream an aggregator expects', async () => {
    const { log } = await loadLog('production');

    const errors: string[] = [];
    const warns: string[] = [];
    const logs: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((l) => void errors.push(String(l)));
    vi.spyOn(console, 'warn').mockImplementation((l) => void warns.push(String(l)));
    vi.spyOn(console, 'log').mockImplementation((l) => void logs.push(String(l)));

    log.error('e');
    log.warn('w');
    log.info('i');

    expect(errors).toHaveLength(1);
    expect(warns).toHaveLength(1);
    expect(logs).toHaveLength(1);
  });
});

describe('§9.1 — phone numbers and emails never reach the log', () => {
  it.each([
    ['an email in the message', `login failed for ${EMAIL}`, EMAIL],
    ['a phone in the message', `otp sent to ${PHONE}`, '9812345678'],
  ])('redacts %s', async (_name, message, secret) => {
    const { log } = await loadLog('production');
    const captured = captureConsole();

    log.error(message);

    captured.restore();
    expect(captured.lines.join('\n')).not.toContain(secret);
  });

  it('redacts PII carried in the context object, at any depth', async () => {
    const { log } = await loadLog('production');
    const captured = captureConsole();

    log.error('order failed', {
      customer: { email: EMAIL, phone: PHONE },
      items: [{ note: `call ${PHONE}` }],
    });

    captured.restore();
    const line = captured.lines.join('\n');
    expect(line).not.toContain(EMAIL);
    expect(line).not.toContain('9812345678');
  });

  it('redacts in development too', async () => {
    /**
     * §9.1 does not scope the requirement to production, and a developer's machine holds
     * real customer data often enough. It also means the redactor is exercised on every
     * run, so a broken one is noticed rather than discovered after launch.
     */
    const { log } = await loadLog('development');
    const captured = captureConsole();

    log.error(`login failed for ${EMAIL}`);

    captured.restore();
    expect(captured.lines.join('\n')).not.toContain(EMAIL);
  });

  it('redacts the Prisma error shape that produced SEC-031', async () => {
    /**
     * The measured case, driven through `serverError()` rather than through `redact()`.
     * Prisma serialises the whole argument object into a validation error message, and the
     * defect was that this call site handed it straight to `console.error`.
     */
    const { serverError } = await loadHttp('production');
    const captured = captureConsole();

    serverError(
      new Error(
        'Invalid `prisma.user.findMany()` invocation:\n' +
          `  where: { email: "${EMAIL}", phone: "${PHONE}" }`,
      ),
      'GET /api/account',
    );

    captured.restore();
    const line = captured.lines.join('\n');

    expect(line).not.toContain(EMAIL);
    expect(line).not.toContain('9812345678');
    // Still diagnostic: a redactor that destroys the failing call has traded one problem
    // for another.
    expect(line).toContain('prisma.user.findMany');
  });

  it('never throws on the error path', async () => {
    // It runs while something is already failing. A logger that throws turns a logged
    // failure into an unlogged one plus a second failure.
    const { log } = await loadLog('production');
    const captured = captureConsole();

    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => log.error('cyclic', circular)).not.toThrow();
    expect(() => log.error('bigint', { paise: 74_725_200n })).not.toThrow();

    captured.restore();
  });
});

describe('§9.1 — a redacted log is still a usable log', () => {
  /**
   * ═══════════════════════════════════════════════════════════════════════════
   *  THESE TWO ARE EXPECTED TO FAIL. Written from §9.1's requirement — "STRUCTURED
   *  LOGGING with phone numbers and emails redacted" — and reported as TEST finding 3.
   *
   *  The phone pattern is unanchored, so it matches a digit run that begins in the middle
   *  of another token. Measured:
   *
   *      "order JW-2026-00042 failed"  ->  "order JW-[phone:…042] failed"
   *      "at 2026-08-07T01:36:27Z ..." ->  "at [phone:…807]T01:36:27Z ..."
   *
   *  The invoice number is the primary key of a support conversation in this application —
   *  a legally numbered, six-year-retained series (DEBT-026) — and it is destroyed in every
   *  log line that mentions one. `lib/security/security.test.ts` asserts the same principle
   *  from the other side ("leaves short digit runs alone… over-redacting makes logs
   *  useless, which is its own way of failing the requirement"); these are the cases that
   *  principle misses.
   *
   *  Not a security defect — the failure is toward safety. It is a §9.1 defect because
   *  half of item 9 is the word "logging".
   * ═══════════════════════════════════════════════════════════════════════════
   */
  it('keeps an invoice number intact', async () => {
    const { redactString } = await loadLog('production');

    expect(redactString('bill JW-2026-00042 failed to render')).toContain(
      'JW-2026-00042',
    );
  });

  it('keeps an ISO timestamp intact', async () => {
    const { redactString } = await loadLog('production');

    expect(redactString('stale since 2026-08-07T01:36:27.000Z')).toContain(
      '2026-08-07T01:36:27.000Z',
    );
  });
});

describe('§9.1 — error responses leak no stack traces in production', () => {
  const thrower = () => {
    // A real stack, from a real throw — a hand-built Error has no frames worth leaking.
    try {
      JSON.parse('{ not json');
    } catch (err) {
      return err;
    }
  };

  it('returns a generic message with no frames, paths or internals', async () => {
    const { serverError } = await loadHttp('production');
    const captured = captureConsole();

    const response = serverError(thrower(), 'POST /api/admin/bills');
    const body = await response.json();

    captured.restore();

    expect(response.status).toBe(500);

    const serialised = JSON.stringify(body);
    for (const marker of [
      'at ', // a stack frame
      'node_modules',
      '/Users/',
      '.ts:',
      'JSON.parse',
      'Unexpected token',
    ]) {
      expect(serialised, `the 500 body leaks ${marker}`).not.toContain(marker);
    }
  });

  it('does not name the route that failed', async () => {
    // The context string is a route map. Useful in the log, not in a stranger's response.
    const { serverError } = await loadHttp('production');
    const captured = captureConsole();

    const body = await serverError(thrower(), 'POST /api/admin/bills').json();

    captured.restore();
    expect(JSON.stringify(body)).not.toContain('/api/admin/bills');
  });

  it('still says what happened in development', async () => {
    /**
     * The positive control. Without it, a `serverError` that returned an empty body in
     * every environment would pass everything above while making local debugging
     * impossible — and nothing would ever tell us the production branch was the one doing
     * the work.
     */
    const { serverError } = await loadHttp('development');
    const captured = captureConsole();

    const body = await serverError(thrower(), 'POST /api/admin/bills').json();

    captured.restore();
    expect(JSON.stringify(body)).toContain('/api/admin/bills');
  });

  it('logs the detail it withholds from the response', async () => {
    // The information has to go somewhere, or a production incident is undebuggable.
    const { serverError } = await loadHttp('production');
    const captured = captureConsole();

    serverError(thrower(), 'POST /api/admin/bills');

    captured.restore();
    expect(captured.lines.join('\n')).toContain('/api/admin/bills');
  });
});
