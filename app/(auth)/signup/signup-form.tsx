/**
 * Signup — three steps in one component.
 * Created by Phase 3 (specs/03-auth.md §3.7).
 *
 * email → OTP to email → verify → set password + name.
 * The optional phone step lives on /account, because that is where the reward for adding
 * it (seeing past purchases) is visible.
 */
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { FormError, ResendTimer } from '@/components/auth/auth-shell';
import { OtpInput } from '@/components/auth/otp-input';
import { Button, Input } from '@/components/ui';
import { destinationAfterAuth } from '@/lib/auth/safe-next';

type Step = 'email' | 'code' | 'password';

interface ApiError {
  error?: string;
  fields?: Record<string, string>;
  expired?: boolean;
}

export function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function post(path: string, body: unknown): Promise<ApiError | null> {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const parsed: ApiError = await response.json();
    return response.ok ? null : parsed;
  }

  async function requestCode() {
    setError(null);
    setBusy(true);
    try {
      const failure = await post('/api/auth/signup/start', { email });
      if (failure) {
        setError(failure.error ?? 'Could not send the code.');
        return;
      }
      setStep('code');
    } catch {
      setError('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function checkCode(submitted: string) {
    setError(null);
    setBusy(true);
    try {
      const failure = await post('/api/auth/signup/verify', { email, code: submitted });
      if (failure) {
        setError(failure.error ?? 'That code is not correct.');
        // An expired or locked code is a dead end — send them back to request a new one.
        if (failure.expired) {
          setCode('');
          setStep('email');
        }
        return;
      }
      setStep('password');
    } catch {
      setError('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function completeSignup(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setBusy(true);
    try {
      const failure = await post('/api/auth/signup/complete', {
        email,
        code,
        password,
        name,
      });
      if (failure) {
        setError(failure.error ?? 'Could not create your account.');
        setFieldErrors(failure.fields ?? {});
        return;
      }
      /**
       * Honour `?next=` after verification (brief §11). A signup always creates a CUSTOMER
       * (`signup/complete` sets `Role.CUSTOMER`), so the role default is `/account` — but a
       * visitor bounced here from a protected page should land back on it.
       */
      router.replace(destinationAfterAuth(params.get('next'), 'CUSTOMER'));
      router.refresh();
    } catch {
      setError('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (step === 'email') {
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
        <Input
          label="Email address"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          inputMode="email"
          hint="We'll send a 6-digit code to confirm it's you."
          required
          autoFocus
        />
        <Button type="submit" full loading={busy}>
          Send code
        </Button>
      </form>
    );
  }

  if (step === 'code') {
    return (
      <div className="flex flex-col gap-4">
        <FormError message={error} />
        <p className="text-body text-muted">
          Enter the code we sent to{' '}
          <span className="font-semibold text-ink">{email}</span>.
        </p>

        <OtpInput
          value={code}
          onChange={setCode}
          onComplete={(full) => void checkCode(full)}
          disabled={busy}
          error={Boolean(error)}
        />

        <Button
          type="button"
          full
          loading={busy}
          disabled={code.length < 6}
          onClick={() => void checkCode(code)}
        >
          Verify
        </Button>

        <ResendTimer onResend={requestCode} disabled={busy} />
      </div>
    );
  }

  return (
    <form onSubmit={completeSignup} className="flex flex-col gap-4" noValidate>
      <FormError message={error} />

      <Input
        label="Your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoComplete="name"
        error={fieldErrors.name}
        required
        autoFocus
      />

      <Input
        label="Choose a password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
        hint="At least 8 characters. Avoid anything you use elsewhere."
        error={fieldErrors.password}
        required
      />

      <Button type="submit" full loading={busy}>
        Create account
      </Button>
    </form>
  );
}
