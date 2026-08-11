/**
 * Branded transactional email.
 * Created by the UI redesign, Stage 4E.
 *
 * ── There is exactly one transactional email, and this is it ──
 *
 * An audit of every outbound path found a single template: `sendOtp`, reached from three
 * routes — signup, password reset, and phone confirmation. There is no order email and no
 * bill email, because MASTER-SPEC §1 sends the bill PDF over **WhatsApp**, not by mail. The
 * redesign brief describes order/bill emails; they are not built here, because inventing an
 * email type nobody triggers would be inventing a feature, not restyling one.
 *
 * Password reset is likewise not a link-based flow in this application — it is the same
 * six-digit code as everything else (`/api/auth/password/forgot`). So it gets its own
 * heading and its own security line, not a "Reset password" button pointing at a token URL
 * that does not exist.
 *
 * ── Email HTML is not web HTML ──
 *
 * Every rule the site uses is unavailable here. Gmail strips `<style>` blocks in some
 * clients; Outlook's Word renderer ignores `flex`, `grid`, `border-radius` on most
 * elements, and background images. So this is:
 *
 *   - tables for layout, not divs
 *   - inline styles only, no classes, no stylesheet
 *   - web-safe font stack — Playfair is a webfont and would silently fall back anyway,
 *     so Georgia is named FIRST rather than pretended around
 *   - hex colours written out, since CSS custom properties do not exist in mail
 *   - a real `text` alternative, which is what plain-text clients and every spam filter read
 *
 * The palette is the Stage 1 one, imported from `lib/design/tokens.ts` rather than retyped,
 * so the mail cannot drift from the site's colours.
 */
import { COLORS } from '@/lib/design/tokens';
import { OTP_TTL_SECONDS } from '@/lib/auth/otp';

export type OtpPurpose = 'signup' | 'reset' | 'phone';

interface Copy {
  subjectSuffix: string;
  heading: string;
  intro: string;
  security: string;
}

/**
 * Per-purpose copy.
 *
 * The three routes that send a code are asking for three different things, and a single
 * "verification code" heading made the reset mail — the one a worried customer reads most
 * carefully — the vaguest of the three.
 */
const COPY: Record<OtpPurpose, Copy> = {
  signup: {
    subjectSuffix: 'is your verification code',
    heading: 'Verify your account',
    intro: 'Enter this code to finish creating your Tirupati Jewelles account.',
    security:
      'If you did not try to create an account, you can ignore this email — nothing has been created.',
  },
  reset: {
    subjectSuffix: 'is your password reset code',
    heading: 'Reset your password',
    intro: 'Enter this code to set a new password for your Tirupati Jewelles account.',
    security:
      'If you did not ask to reset your password, ignore this email. Your password has not changed.',
  },
  phone: {
    subjectSuffix: 'is your confirmation code',
    heading: 'Confirm your mobile number',
    intro:
      'Enter this code to confirm your mobile number, so past purchases can be linked to your account.',
    security: 'If you did not ask for this, you can ignore this email.',
  },
};

/**
 * Escape a value before it reaches the HTML.
 *
 * The code is generated server-side and is six digits, so it is not attacker-controlled
 * today. This is here because that is a fact about the current call sites rather than about
 * this function — a later caller passing a name or an email address into the template must
 * not be the moment anyone first thinks about it.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderOtpEmail(code: string, purpose: OtpPurpose = 'signup'): RenderedEmail {
  const copy = COPY[purpose];
  const minutes = Math.round(OTP_TTL_SECONDS / 60);
  const safeCode = escapeHtml(code);

  const subject = `${code} ${copy.subjectSuffix}`;

  /**
   * The plain-text alternative, and not an afterthought.
   *
   * It is what a text-only client renders, what a screen reader in a stripped-down client
   * reads, and what spam filters score. An HTML-only transactional mail is a deliverability
   * problem before it is an accessibility one.
   */
  const text = [
    `${copy.heading} — Tirupati Jewelles`,
    '',
    copy.intro,
    '',
    `Your code: ${code}`,
    '',
    `It expires in ${minutes} minutes. Do not share it with anyone.`,
    '',
    copy.security,
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(copy.heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:${COLORS.cream};">
<!-- Preheader: the grey line a client shows beside the subject. Hidden in the body. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">
${escapeHtml(copy.intro)}
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLORS.cream};">
<tr>
<td align="center" style="padding:32px 16px;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background-color:${COLORS.white};border-radius:16px;overflow:hidden;">

  <!-- Wine masthead. The brand, and the one place gold is legible (6.84:1). -->
  <tr>
    <td style="background-color:${COLORS.wine};padding:32px;">
      <div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:32px;color:${COLORS.cream};letter-spacing:0.01em;">
        Tirupati
      </div>
      <div style="height:1px;width:48px;background-color:${COLORS.gold};margin-top:16px;font-size:0;line-height:0;">&nbsp;</div>
    </td>
  </tr>

  <tr>
    <td style="padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">

      <h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:32px;font-weight:normal;color:${COLORS.ink};">
        ${escapeHtml(copy.heading)}
      </h1>

      <p style="margin:0 0 24px;font-size:16px;line-height:26px;color:${COLORS.muted};">
        ${escapeHtml(copy.intro)}
      </p>

      <!-- The code. Letter-spaced and tabular so the digits are unmistakable. -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td align="center" style="background-color:${COLORS.roseTint};border-radius:12px;padding:24px;">
            <div style="font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:32px;line-height:40px;font-weight:bold;letter-spacing:0.2em;color:${COLORS.ink};">
              ${safeCode}
            </div>
          </td>
        </tr>
      </table>

      <p style="margin:24px 0 0;font-size:14px;line-height:20px;color:${COLORS.muted};">
        It expires in <strong style="color:${COLORS.ink};">${minutes} minutes</strong>.
        Do not share it with anyone.
      </p>

      <div style="height:1px;background-color:${COLORS.line};margin:24px 0;font-size:0;line-height:0;">&nbsp;</div>

      <p style="margin:0;font-size:14px;line-height:20px;color:${COLORS.muted};">
        ${escapeHtml(copy.security)}
      </p>
    </td>
  </tr>
</table>

<p style="max-width:480px;margin:24px auto 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:12px;line-height:18px;color:${COLORS.muted};text-align:center;">
  Tirupati Jewelles · Hallmark-certified gold and silver jewellery
</p>

</td>
</tr>
</table>
</body>
</html>`;

  return { subject, html, text };
}
