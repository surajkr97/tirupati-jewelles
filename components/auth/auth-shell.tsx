/**
 * Auth screen shell and shared pieces.
 * Created by Phase 3 (specs/03-auth.md §3.7).
 *
 * "Full-screen mobile, centred card on desktop." No bottom nav here — a half-finished
 * signup should not offer five ways to wander off.
 */
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Card } from '@/components/ui';
import { cn } from '@/lib/utils/cn';

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-[20px] py-12">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-8 flex justify-center font-semibold tracking-[0.12em] text-ink"
        >
          TIRUPATI
        </Link>

        <Card className="flex flex-col gap-6">
          <header className="flex flex-col gap-2">
            <h1 className="text-h2 font-semibold text-ink">{title}</h1>
            {subtitle && <p className="text-body text-muted">{subtitle}</p>}
          </header>
          {children}
        </Card>

        {footer && <div className="mt-6 text-center text-body text-muted">{footer}</div>}
      </div>
    </main>
  );
}

/** Inline form-level error. `role="alert"` so it is announced, not just shown. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-field bg-down/10 px-4 py-2 text-small text-down">
      {message}
    </p>
  );
}

/**
 * Resend countdown — disabled until it reaches zero (§3.7).
 *
 * Purely cosmetic pacing: the server enforces 3 sends per identifier per 15 minutes
 * regardless of what this button allows.
 */
export function ResendTimer({
  seconds = 30,
  onResend,
  disabled = false,
}: {
  seconds?: number;
  onResend: () => void | Promise<void>;
  disabled?: boolean;
}) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);

  const ready = remaining <= 0;

  return (
    <button
      type="button"
      disabled={!ready || disabled}
      onClick={async () => {
        await onResend();
        setRemaining(seconds);
      }}
      className={cn(
        'flex h-tap w-full items-center justify-center text-small font-semibold',
        ready ? 'text-rose-deep hover:underline' : 'text-muted',
      )}
    >
      {ready ? 'Resend code' : `Resend in ${remaining}s`}
    </button>
  );
}

/** Shape hint under the single login field — "phone or email, detected by shape" (§3.7). */
export function IdentifierHint({ value }: { value: string }) {
  const trimmed = value.trim();
  if (trimmed.length < 3) return null;

  const looksLikeEmail = trimmed.includes('@');
  return (
    <p className="text-small text-muted">
      Reading this as {looksLikeEmail ? 'an email address' : 'a mobile number'}.
    </p>
  );
}
