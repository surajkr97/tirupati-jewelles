/**
 * Notification delivery.
 * Created by Phase 3 (specs/03-auth.md §3.2), revised for email-only delivery (D-011).
 *
 * ── Why Resend and not SMTP ──
 * §3.2 says "Email via SMTP". Render — the deployment target — blocks outbound SMTP ports
 * (25/465/587) on most plans, so a nodemailer transport works locally and then times out
 * in production. Resend is an HTTPS API, so it is unaffected by that block.
 *
 * ── Why there is no SMS ──
 * Email is the only channel in use. `SmsNotifier` is kept as a throwing stub rather than
 * deleted so the interface, the `Channel` enum and the call sites stay in place for when
 * SMS is added — and so nothing silently "succeeds" at sending an SMS that never arrives.
 */
import { Channel } from '@prisma/client';

import { env } from '@/lib/env';
import { renderOtpEmail, type OtpPurpose } from '@/lib/notify/email-template';

export interface SendResult {
  delivered: boolean;
  reference?: string;
}

export interface Notifier {
  send(to: string, message: string, subject?: string, html?: string): Promise<SendResult>;
}

const isProduction = env.NODE_ENV === 'production';

/**
 * Development transport — prints the code instead of sending it.
 * §3.2 requires this to be gated on `NODE_ENV !== 'production'` explicitly, because
 * shipping the console logger would be a total OTP bypass.
 */
class ConsoleNotifier implements Notifier {
  constructor(private readonly channel: string) {}

  // `html` is accepted and ignored: the dev console prints the code, and printing a
  // hundred lines of table markup around it would bury the thing you are here to read.
  async send(to: string, message: string, subject?: string): Promise<SendResult> {
    console.info(
      [
        '',
        '┌───────────────────────────────────────────────────────────',
        `│ DEV ${this.channel.toUpperCase()} — not actually sent`,
        `│ to:      ${to}`,
        subject ? `│ subject: ${subject}` : null,
        `│ message: ${message}`,
        '└───────────────────────────────────────────────────────────',
        '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
    return { delivered: true, reference: 'dev-console' };
  }
}

class ResendNotifier implements Notifier {
  async send(
    to: string,
    message: string,
    subject?: string,
    html?: string,
  ): Promise<SendResult> {
    if (!env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is not set — cannot send email.');
    }

    // Imported lazily so the SDK stays out of bundles that never send anything.
    const { Resend } = await import('resend');
    const resend = new Resend(env.RESEND_API_KEY);

    const { data, error } = await resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: subject ?? 'Tirupati Jewelles',
      // Both parts, always. `text` is not a fallback nicety: it is what plain-text clients
      // render and what spam filters score, and an HTML-only transactional mail is a
      // deliverability problem before it is an accessibility one.
      text: message,
      ...(html ? { html } : {}),
    });

    // The SDK reports failures in the response rather than throwing, so an unchecked
    // call looks successful while delivering nothing.
    if (error) throw new Error(`Resend refused the message: ${error.message}`);

    return { delivered: true, reference: data?.id };
  }
}

/** Not in use. Throws rather than pretending to send. */
class SmsNotifier implements Notifier {
  async send(): Promise<SendResult> {
    throw new Error(
      'SMS delivery is not enabled — every OTP goes to email (specs/DECISIONS.md D-011). ' +
        'If you are seeing this, something requested an SMS channel that should not exist.',
    );
  }
}

/**
 * Email transport selection.
 *
 * In production a missing key is a hard failure at first use, not a silent downgrade to
 * the console — logging OTPs to production stdout would hand every code to anyone with
 * log access.
 */
export const emailNotifier: Notifier =
  isProduction || env.RESEND_API_KEY
    ? new ResendNotifier()
    : new ConsoleNotifier('email');

export const smsNotifier: Notifier = new SmsNotifier();

export function notifierFor(channel: Channel): Notifier {
  return channel === Channel.SMS ? smsNotifier : emailNotifier;
}

/**
 * Delivery copy for a one-time passcode.
 *
 * `purpose` is optional and defaults to `signup`, so the three existing call sites keep
 * working unchanged; each now passes its own so the mail says what it is for. Nothing about
 * the OTP itself moved — generation, hashing, TTL, attempt limits and rate limiting all
 * live in `lib/auth/otp.ts` and are untouched.
 *
 * The expiry sentence is built from `OTP_TTL_SECONDS` rather than typed, so the copy cannot
 * claim five minutes after someone changes the constant to ten.
 */
export async function sendOtp(
  channel: Channel,
  to: string,
  code: string,
  purpose: OtpPurpose = 'signup',
): Promise<SendResult> {
  const { subject, html, text } = renderOtpEmail(code, purpose);
  return notifierFor(channel).send(to, text, subject, html);
}
