/**
 * Login form.
 * Created by Phase 3 (specs/03-auth.md §3.7).
 */
'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { FormError, IdentifierHint } from '@/components/auth/auth-shell';
import { Button, Input } from '@/components/ui';

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });

      const body: { error?: string } = await response.json();

      if (!response.ok) {
        // The server returns one generic message for every failure mode; showing it
        // verbatim is what keeps the UI from leaking which accounts exist.
        setError(body.error ?? 'Could not sign you in.');
        return;
      }

      // `next` comes from the proxy redirect. Only ever a same-site path — reject an
      // absolute URL so a crafted ?next=https://evil.example cannot bounce the user off.
      const next = params.get('next');
      const destination =
        next?.startsWith('/') && !next.startsWith('//') ? next : '/account';

      router.replace(destination);
      router.refresh();
    } catch {
      setError('Network problem. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <FormError message={error} />

      <div className="flex flex-col gap-2">
        <Input
          label="Mobile number or email"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          autoComplete="username"
          inputMode="text"
          required
          autoFocus
        />
        <IdentifierHint value={identifier} />
      </div>

      <Input
        label="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        required
      />

      <Button type="submit" full loading={busy}>
        Sign in
      </Button>

      <Link
        href="/forgot-password"
        className="flex h-tap items-center justify-center text-small font-semibold text-taupe-deep hover:underline"
      >
        Forgot your password?
      </Link>
    </form>
  );
}
