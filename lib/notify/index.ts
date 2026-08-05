/**
 * Notification delivery — SMS and email behind one interface.
 * Created by Phase 3 (specs/03-auth.md §3.2).
 *
 * §3.2: "SMS via MSG91/Twilio behind an interface — lib/notify/sms.ts — so the provider can
 * be swapped", and "In development, log the OTP to console instead of sending. Gate on
 * NODE_ENV !== 'production' explicitly."
 *
 * The dev gate is written as an explicit equality check rather than a truthy flag, because
 * "we accidentally shipped the console logger" is a total OTP bypass.
 */
import { Channel } from '@prisma/client';

import { env } from '@/lib/env';

export interface SendResult {
  delivered: boolean;
  /** Provider-side id, when the provider returns one. */
  reference?: string;
}

export interface Notifier {
  send(to: string, message: string, subject?: string): Promise<SendResult>;
}

/**
 * Development transport — prints the code instead of sending it.
 *
 * Loud on purpose: an OTP appearing in production logs must be impossible to miss during
 * review, and this banner is what a reviewer greps for.
 */
class ConsoleNotifier implements Notifier {
  constructor(private readonly channel: string) {}

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

/**
 * SMS via an HTTP provider (MSG91 / Twilio).
 *
 * Phase 3 ships the interface and the dev transport; the production request body is
 * provider-specific and is wired up when the client supplies real credentials.
 * Tracked in DEBT.md as DEBT-007.
 */
class SmsNotifier implements Notifier {
  async send(to: string, message: string): Promise<SendResult> {
    void to;
    void message;
    throw new Error(
      'SMS provider not configured. Set SMS_PROVIDER_KEY and implement SmsNotifier.send ' +
        '(specs/03-auth.md §3.2, DEBT-007).',
    );
  }
}

/** Email over SMTP. `nodemailer` is imported lazily so it stays out of the edge bundle. */
class EmailNotifier implements Notifier {
  async send(to: string, message: string, subject?: string): Promise<SendResult> {
    const { createTransport } = await import('nodemailer');
    const transport = createTransport(env.SMTP_URL);

    const info = await transport.sendMail({
      to,
      from: 'Tirupati Jewelles <no-reply@tirupatijewelles.com>',
      subject: subject ?? 'Tirupati Jewelles',
      text: message,
    });

    return { delivered: true, reference: info.messageId };
  }
}

const isProduction = env.NODE_ENV === 'production';

export const smsNotifier: Notifier = isProduction
  ? new SmsNotifier()
  : new ConsoleNotifier('sms');

export const emailNotifier: Notifier = isProduction
  ? new EmailNotifier()
  : new ConsoleNotifier('email');

export function notifierFor(channel: Channel): Notifier {
  return channel === Channel.SMS ? smsNotifier : emailNotifier;
}

/** Delivery copy for a one-time passcode. */
export async function sendOtp(
  channel: Channel,
  to: string,
  code: string,
): Promise<SendResult> {
  const message =
    `${code} is your Tirupati Jewelles verification code. ` +
    `It expires in 5 minutes. Do not share it with anyone.`;

  return notifierFor(channel).send(to, message, 'Your verification code');
}
