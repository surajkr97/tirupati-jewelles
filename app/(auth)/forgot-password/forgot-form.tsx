/**
 * Password reset form.
 * Created by Phase 3 (specs/03-auth.md §3.7).
 */
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { FormError, IdentifierHint, ResendTimer } from '@/components/auth/auth-shell';
import { OtpInput } from '@/components/auth/otp-input';
import { Button, Input } from '@/components/ui';
import { destinationAfterAuth } from '@/lib/auth/safe-next';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/password-policy';

export function ForgotPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [sent, setSent] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function requestCode() {
    setError(null);
    setBusy(true);
    try {
      await fetch('/api/auth/password/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier }),
      });
      // Always advance. The endpoint deliberately answers identically whether or not the
      // account exists, so branching on the response here would undo that.
      setSent(true);
    } catch {
      setError('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function submitReset(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setBusy(true);
    try {
      const response = await fetch('/api/auth/password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, code, password }),
      });
      const body: { error?: string; fields?: Record<string, string> } =
        await response.json();

      if (!response.ok) {
        setError(body.error ?? 'Could not reset your password.');
        setFieldErrors(body.fields ?? {});
        return;
      }

      /**
       * `/api/auth/password/reset` returns `{ reset: true }` and not the user, so there is no
       * role to branch on here. Deliberately NOT changed: adding a field to an auth route's
       * response is outside Stage 2's remit. An admin who resets their password lands on
       * `/account` and reaches the dashboard in one click via the shortcut there.
       */
      router.replace(destinationAfterAuth(params.get('next'), 'CUSTOMER'));
      router.refresh();
    } catch {
      setError('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!sent) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void requestCode();
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        <FormError message={error} />
        <div className="flex flex-col gap-2">
          <Input
            label="Mobile number or email"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            autoComplete="username"
            required
            autoFocus
          />
          <IdentifierHint value={identifier} />
        </div>
        <Button type="submit" full loading={busy} loadingLabel="Sending code…">
          Send code
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={submitReset} className="flex flex-col gap-4" noValidate>
      <FormError message={error} />
      <p className="text-body text-muted">
        If that account exists, we&rsquo;ve sent a 6-digit code. Enter it below with your
        new password.
      </p>

      <OtpInput value={code} onChange={setCode} disabled={busy} error={Boolean(error)} />

      <Input
        label="New password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
        hint={`At least ${MIN_PASSWORD_LENGTH} characters. Common passwords are rejected.`}
        error={fieldErrors.password}
        required
      />

      <Button
        type="submit"
        full
        loading={busy}
        loadingLabel="Updating password…"
        disabled={code.length < 6}
      >
        Reset password
      </Button>

      <ResendTimer onResend={requestCode} disabled={busy} />
    </form>
  );
}
