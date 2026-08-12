/**
 * Auth screen shell and shared pieces.
 * Created by Phase 3 (specs/03-auth.md §3.7), restyled by the UI redesign, Stage 3.
 *
 * §3.7's rule stands: no bottom nav here. A half-finished signup should not offer five ways
 * to wander off. What Stage 3 adds is one way BACK (brief §13) — focus is not the same thing
 * as a trap, and the only exit before this was the browser button.
 *
 * ── Why the card is gone ──
 *
 * Phase 3 put the form inside a `Card`: white, 24px radius, shadow, centred. That is the
 * shape of a dashboard login, and brief §5 names it — "do not put everything inside a huge
 * floating card". A card is a container for something that sits AMONG other things. An auth
 * screen has no other things, so the container is drawing a box around the only object on
 * the page.
 *
 * Hierarchy now comes from type and whitespace: wordmark, serif headline, one muted line,
 * then the form. The fields are white on cream, which is what gives them their edges — the
 * same relationship the storefront's cards have with the page.
 */
'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

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
    <main className="flex min-h-dvh flex-col bg-cream">
      {/*
        The way out (brief §13). Deliberately quiet and deliberately present: a visitor who
        opened /login by mistake, or who is not ready to create an account, had no route back
        to the shop that did not involve the browser's back button.
      */}
      <div className="px-[20px] pt-6 md:px-[40px]">
        <Link
          href="/"
          className="inline-flex h-tap items-center gap-2 text-small font-medium text-muted transition-colors duration-fast ease-standard hover:text-ink"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to the shop
        </Link>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-[20px] py-12 md:px-[40px]">
        {/* max-w-sm is 384px — a form column wider than this stops scanning as one object. */}
        <div className="flex w-full max-w-sm flex-col">
          <Link
            href="/"
            aria-label="Tirupati J. — home"
            className="mb-4 flex h-tap w-fit items-center font-display text-h3 font-medium tracking-[-0.01em] text-ink"
          >
            Tirupati J.
          </Link>

          <header className="mb-8 flex flex-col gap-2">
            {/* Serif, and the only serif on the page — brief §4. */}
            <h1 className="font-display text-h1 font-medium text-ink">{title}</h1>
            {subtitle && <p className="text-body text-muted">{subtitle}</p>}
          </header>

          {children}

          {footer && (
            <div className="mt-8 border-t border-line pt-6 text-body text-muted">
              {footer}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

/**
 * Inline form-level error.
 *
 * `role="alert"` so it is announced rather than merely shown — the reason it is a component
 * and not a styled paragraph. Stage 3 adds the icon and the border: §16 forbids communicating
 * a state by colour alone, and a red-tinted box is exactly that. The icon carries the meaning
 * for anyone who cannot separate the tint from the surface.
 */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="mb-6 flex items-start gap-2 rounded-field bg-down/10 px-4 py-2 text-small text-down ring-1 ring-down/20 ring-inset"
    >
      <span aria-hidden="true" className="mt-px shrink-0 font-semibold">
        !
      </span>
      {message}
    </p>
  );
}

/**
 * Resend countdown — disabled until it reaches zero (§3.7).
 *
 * Purely cosmetic pacing: the server enforces 3 sends per identifier per 15 minutes
 * regardless of what this button allows. The countdown exists so the user knows the wait is
 * deliberate rather than a broken button.
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
        'transition-colors duration-fast ease-standard',
        // roseDeep, not rose: 14px text needs the full 4.5:1 (D-057).
        ready ? 'text-rose-deep hover:underline' : 'text-muted',
      )}
    >
      {/* The countdown is a number that changes every second — tabular, or it jitters. */}
      {ready ? 'Resend code' : <>Resend in <span className="num">{remaining}</span>s</>}
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

/**
 * The step counter for a multi-step flow (brief §6).
 *
 * Signup is three screens that each look like a complete form, so without this a user has no
 * idea whether they are nearly done or nearly starting — and the OTP step in particular reads
 * as a dead end when you cannot see that a third step follows it.
 *
 * Dots rather than a progress bar: three states do not need a percentage, and a bar implies a
 * precision this flow does not have. The text is what carries the meaning; the dots are the
 * glanceable version of it, and are `aria-hidden` so it is not announced twice.
 */
export function StepIndicator({ step, total }: { step: number; total: number }) {
  return (
    <div className="mb-6 flex items-center gap-4">
      <p className="text-small font-medium text-muted">
        Step <span className="num">{step}</span> of <span className="num">{total}</span>
      </p>
      <div aria-hidden="true" className="flex flex-1 items-center gap-1">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cn(
              'h-1 flex-1 rounded-pill transition-colors duration-base ease-standard',
              i < step ? 'bg-rose-deep' : 'bg-line',
            )}
          />
        ))}
      </div>
    </div>
  );
}
