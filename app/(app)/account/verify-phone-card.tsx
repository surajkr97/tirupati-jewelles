/**
 * Add a mobile number as a second login identifier.
 * Created by Phase 3 (specs/03-auth.md §3.7), revised for email-only OTP (D-011).
 *
 * Authorised by a code sent to the account's verified EMAIL. That is enough to attach a
 * number the customer will sign in with, and deliberately not enough to attach past
 * purchases — see the header of app/api/auth/phone/verify/route.ts.
 */
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { FormError, ResendTimer } from '@/components/auth/auth-shell';
import { OtpInput } from '@/components/auth/otp-input';
import { Button, Card, Input } from '@/components/ui';

export function VerifyPhoneCard({ claimableHint }: { claimableHint: number }) {
  void claimableHint; // no longer surfaced — see the copy note below
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestCode() {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch('/api/auth/phone/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const body: { error?: string; message?: string } = await response.json();

      if (!response.ok) {
        setError(body.error ?? 'Could not send the code.');
        return;
      }
      // The code goes to email, not SMS. Saying so avoids the customer sitting there
      // watching their phone for a message that is never coming.
      setSentTo(body.message ?? 'We sent you a code.');
      setSent(true);
    } catch {
      setError('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function verify(submitted: string) {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch('/api/auth/phone/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code: submitted }),
      });
      const body: { error?: string; message?: string } = await response.json();

      if (!response.ok) {
        setError(body.error ?? 'That code is not correct.');
        return;
      }

      setSuccess(body.message ?? 'Your number has been saved.');
      router.refresh();
    } catch {
      setError('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (success) {
    return (
      <Card className="flex flex-col gap-2 border-0">
        <p className="text-h3 font-semibold text-up">Number saved</p>
        <p className="text-body text-muted">{success}</p>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-4">
      {/* Copy deliberately promises only what this flow delivers: a second way to sign
          in. It does NOT promise that past purchases will appear — that needs proof the
          customer holds the number, which email OTP does not provide (D-011). Claiming a
          benefit we cannot deliver is worse than not mentioning it. */}
      <div className="flex flex-col gap-1">
        <h2 className="text-h3 font-semibold text-ink">Add your mobile number</h2>
        <p className="text-body text-muted">
          Sign in with your number instead of your email. We&rsquo;ll send a code to your
          email address to confirm it&rsquo;s you.
        </p>
      </div>

      <FormError message={error} />

      {!sent ? (
        <>
          <Input
            label="Mobile number"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            autoComplete="tel"
            placeholder="98765 43210"
            hint="Indian mobile numbers only."
          />
          <Button
            type="button"
            variant="accent"
            full
            loading={busy}
            onClick={() => void requestCode()}
          >
            Send code
          </Button>
        </>
      ) : (
        <>
          <p className="text-body text-muted">
            {sentTo ?? 'Enter the code we sent you.'}
          </p>
          <OtpInput
            value={code}
            onChange={setCode}
            onComplete={(full) => void verify(full)}
            disabled={busy}
            error={Boolean(error)}
          />
          <Button
            type="button"
            variant="accent"
            full
            loading={busy}
            disabled={code.length < 6}
            onClick={() => void verify(code)}
          >
            Save number
          </Button>
          <ResendTimer onResend={requestCode} disabled={busy} />
        </>
      )}
    </Card>
  );
}
