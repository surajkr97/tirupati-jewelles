/**
 * Structured logging with PII redaction.
 * Created by Phase 9 (specs/09-hardening.md §9.1: "Structured logging with phone numbers
 * and emails **redacted**"). Closes SEC-031 / DEBT-036.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THIS IS NOT A THEORETICAL CONTROL. PII WAS REACHING LOG LINES.
 *
 *  Prisma serialises the WHOLE argument object into a validation error's message. Probed
 *  during the §9.1 pass:
 *
 *      --- error echoes email: true
 *      --- error echoes phone: true
 *                email: "victim.person@example.com",
 *                phone: "+919812345678",
 *
 *  `serverError()` passed that straight to `console.error`, so any route whose input
 *  reached Prisma in a shape Prisma rejected printed a customer's email and phone into
 *  production stdout — which on the deployment target is a retained dashboard, frequently
 *  shipped onward to a log aggregator. `lib/auth/rate-limit.ts` had a narrower version of
 *  the same problem: its keys embed the identifier by construction
 *  (`otp:send:id:user@example.com`).
 *
 *  Same class as DEBT-031 (backups now hold invoices): the data did not change, the set of
 *  places it lands did.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * §9.4 requires Sentry with "PII scrubbing configured **before** launch". That is the same
 * control as this one — `redact()` is exported so Sentry's `beforeSend` can use it rather
 * than growing a second, differently-wrong idea of what a phone number looks like.
 */
import { env } from '@/lib/env';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Email addresses.
 *
 * The local part is kept to one leading character. `r***@gmail.com` is enough to recognise
 * an address you already know while being useless to someone who does not — which is the
 * balance a support engineer reading logs actually needs.
 */
const EMAIL = /\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;

/**
 * Phone numbers, E.164 and the loose shapes that reach us before normalisation.
 *
 * Deliberately greedy about what counts as a phone number. A false positive costs a
 * slightly less readable log line; a false negative puts a customer's number in a file
 * somebody else can read. `libphonenumber-js` is not used here on purpose — this must never
 * throw, and it must catch the malformed inputs that normalisation would reject.
 *
 * ── The boundary assertions are load-bearing (Phase 9 TEST, finding 3) ──
 * Without them the pattern matched a digit run that BEGINS INSIDE another token, because
 * nothing said a match had to start at one. Measured:
 *
 *     "order JW-2026-00042 failed"    ->  "order JW-[phone:…042] failed"
 *     "at 2026-08-07T01:36:27.000Z"   ->  "at [phone:…807]T01:36:27.000Z"
 *     "HUID 123456 / BIS 987654321"   ->  "HUID 123456 / BIS [phone:…321]"
 *
 * The invoice number is the primary key of every support conversation this shop will have —
 * a legally numbered, six-year-retained series (DEBT-026) — so a log line mentioning one was
 * unreadable in the one field that identifies it. Over-redaction is not the safe direction it
 * looks like: item 9 asks for STRUCTURED LOGGING with PII redacted, and a log nobody can
 * correlate fails the first half of that.
 *
 * `-` is in both lookarounds because a hyphen joins the token in `JW-2026-00042` and in an
 * ISO date, while a hyphenated phone number (`98765-43210`) is still matched as a whole.
 */
const PHONE = /(?<![\w-])(?:\+?\d[\d\s().-]{7,}\d)(?![\w-])/g;

/** Anything that looks like a bearer credential this codebase mints. */
const LONG_TOKEN = /\b[A-Za-z0-9_-]{32,}\b/g;

/**
 * Remove personal data from a string.
 *
 * Order matters: emails first, because an email's local part can contain digit runs that
 * the phone pattern would otherwise mangle into an unreadable middle state.
 */
export function redactString(value: string): string {
  return value
    .replace(EMAIL, (_m, first: string, domain: string) => `${first}***@${domain}`)
    .replace(PHONE, (match) => {
      const digits = match.replace(/\D/g, '');
      // Too short to be a phone number — a quantity, a port, an id. Leave it alone.
      if (digits.length < 8) return match;
      return `[phone:…${digits.slice(-3)}]`;
    })
    .replace(LONG_TOKEN, (match) =>
      // Base64url-ish and long: a session id, an OTP hash, a claim token.
      /[A-Za-z]/.test(match) && /\d/.test(match) ? '[redacted]' : match,
    );
}

/**
 * Redact recursively, structure preserved.
 *
 * Keys named like secrets are dropped whole rather than pattern-matched — a password does
 * not have to look like anything, so the only safe rule for one is its name.
 */
const SECRET_KEY =
  /^(password|passwordhash|token|secret|authorization|cookie|pepper|otp|code)$/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return `${value}n`;

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      // Frames are paths and function names, not user data — and they are the reason to
      // keep a log at all. Redacted anyway: a Prisma frame can quote the failing argument.
      stack: value.stack ? redactString(value.stack) : undefined,
    };
  }

  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY.test(key) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }

  return '[unserialisable]';
}

/**
 * Emit one line.
 *
 * JSON in production so a log aggregator can parse it; human-readable in development,
 * because a developer reading a terminal is the actual consumer there.
 *
 * Note that redaction runs in BOTH — a development machine holds real customer data often
 * enough, and a redactor that is only exercised in production is one nobody notices is
 * broken.
 */
function emit(level: LogLevel, message: string, context?: Record<string, unknown>) {
  const safeMessage = redactString(message);
  const safeContext = context ? (redact(context) as Record<string, unknown>) : undefined;

  if (env.NODE_ENV === 'production') {
    const line = JSON.stringify({
      level,
      time: new Date().toISOString(),
      message: safeMessage,
      ...(safeContext ?? {}),
    });
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
    return;
  }

  const suffix = safeContext ? ` ${JSON.stringify(safeContext)}` : '';
  const line = `[${level}] ${safeMessage}${suffix}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (message: string, context?: Record<string, unknown>) =>
    emit('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) =>
    emit('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) =>
    emit('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) =>
    emit('error', message, context),
};
