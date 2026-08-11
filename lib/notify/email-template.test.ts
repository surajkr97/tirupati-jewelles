/**
 * Stage 4E — the transactional email renders, substitutes and escapes.
 *
 * There is one transactional email in this application and three routes reach it, so a
 * template fault is a fault in signup, password reset and phone confirmation at once. These
 * assertions are about the things that break silently: a variable that never substituted, an
 * expiry that drifted from the constant it describes, and HTML that a mail client will not
 * render.
 */
import { describe, expect, it } from 'vitest';

import { OTP_TTL_SECONDS } from '@/lib/auth/otp';
import { COLORS } from '@/lib/design/tokens';
import { renderOtpEmail, type OtpPurpose } from '@/lib/notify/email-template';

const PURPOSES: OtpPurpose[] = ['signup', 'reset', 'phone'];

describe('the code reaches every part of the message', () => {
  it.each(PURPOSES)('%s carries the code in subject, html and text', (purpose) => {
    const { subject, html, text } = renderOtpEmail('483920', purpose);

    expect(subject).toContain('483920');
    expect(html).toContain('483920');
    expect(text).toContain('483920');
  });

  it('leaves no unsubstituted placeholders', () => {
    const { subject, html, text } = renderOtpEmail('112233', 'reset');
    for (const part of [subject, html, text]) {
      expect(part).not.toMatch(/\$\{/);
      expect(part).not.toMatch(/\bundefined\b/);
      expect(part).not.toMatch(/\[object Object\]/);
    }
  });
});

describe('each purpose says what it is for', () => {
  it('signup asks you to verify an account', () => {
    const { html, text } = renderOtpEmail('000000', 'signup');
    expect(html).toContain('Verify your account');
    expect(text).toContain('Verify your account');
  });

  it('reset says the password has not changed', () => {
    const { html, subject } = renderOtpEmail('000000', 'reset');
    expect(html).toContain('Reset your password');
    expect(subject).toContain('password reset code');
    // The line that matters to someone who did not ask for this.
    expect(html).toContain('Your password has not changed');
  });

  it('phone explains why the number is wanted', () => {
    const { html } = renderOtpEmail('000000', 'phone');
    expect(html).toContain('Confirm your mobile number');
  });

  it('defaults to signup rather than throwing on a missing purpose', () => {
    expect(renderOtpEmail('000000').html).toContain('Verify your account');
  });
});

describe('the expiry is read from the OTP constant, never typed', () => {
  it('states the real TTL in minutes', () => {
    const minutes = Math.round(OTP_TTL_SECONDS / 60);
    const { html, text } = renderOtpEmail('000000', 'signup');

    expect(html).toContain(`${minutes} minutes`);
    expect(text).toContain(`${minutes} minutes`);
  });
});

describe('the HTML is mail-safe', () => {
  const { html } = renderOtpEmail('654321', 'signup');

  it('is a complete document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('</html>');
  });

  it('lays out with tables, not flex or grid', () => {
    expect(html).toContain('<table');
    // Outlook's Word renderer ignores both; a layout that depends on them collapses.
    expect(html).not.toMatch(/display:\s*flex/);
    expect(html).not.toMatch(/display:\s*grid/);
  });

  it('carries no stylesheet, class or web font — Gmail strips them', () => {
    expect(html).not.toContain('<style');
    expect(html).not.toContain('class=');
    expect(html).not.toContain('fonts.googleapis');
    expect(html).not.toContain('Playfair');
  });

  it('uses no CSS custom properties, which do not exist in mail', () => {
    expect(html).not.toContain('var(--');
  });

  it('paints the brand colours from the design tokens', () => {
    // Imported, not retyped, so the mail cannot drift from the site.
    expect(html).toContain(COLORS.wine);
    expect(html).toContain(COLORS.cream);
    expect(html).toContain(COLORS.gold);
  });
});

describe('the plain-text alternative is real, not a stub', () => {
  it('stands on its own without the HTML', () => {
    const { text } = renderOtpEmail('998877', 'reset');

    expect(text).not.toContain('<');
    expect(text).toContain('998877');
    expect(text).toContain('Do not share it with anyone');
    expect(text.length).toBeGreaterThan(80);
  });
});

describe('interpolated values are escaped', () => {
  it('neutralises markup in the code rather than emitting it', () => {
    // Not reachable today — the code is six server-generated digits. Asserted so that a
    // later caller passing a name or an email is not the first time anyone checks.
    const { html } = renderOtpEmail('<img src=x onerror=alert(1)>', 'signup');

    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });
});
