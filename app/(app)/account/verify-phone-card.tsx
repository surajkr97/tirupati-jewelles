/**
 * Phone verification — the entry point to the Phase 8 order claim.
 * Created by Phase 3 (specs/03-auth.md §3.5, §3.7).
 *
 * Verifying a number is what attaches previously-billed orders to this account. That is
 * worth saying out loud, because "verify your phone" on its own reads like a chore.
 */
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { FormError, ResendTimer } from '@/components/auth/auth-shell';
import { OtpInput } from '@/components/auth/otp-input';
import { Button, Card, Input } from '@/components/ui';

export function VerifyPhoneCard({ claimableHint }: { claimableHint: number }) {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
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
      const body: { error?: string } = await response.json();

      if (!response.ok) {
        setError(body.error ?? 'Could not send the code.');
        return;
      }
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

      // The server counts what actually attached — "We found 3 past purchases linked to
      // this number." (§3.5)
      setSuccess(body.message ?? 'Your number is verified.');
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
        <p className="text-h3 font-semibold text-up">Verified</p>
        <p className="text-body text-muted">{success}</p>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-h3 font-semibold text-ink">Verify your mobile number</h2>
        <p className="text-body text-muted">
          {claimableHint > 0
            ? `Bought from us before? We have ${claimableHint} purchase${claimableHint === 1 ? '' : 's'} waiting to be linked to this number.`
            : 'Bought from us before? Verify your number to see those purchases in your order history.'}
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
            Enter the code sent to <span className="font-semibold text-ink">{phone}</span>
            .
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
            Verify number
          </Button>
          <ResendTimer onResend={requestCode} disabled={busy} />
        </>
      )}
    </Card>
  );
}
