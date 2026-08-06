/**
 * The one button that redeems a claim token.
 * Created by Phase 9 (DEBT-011).
 *
 * A deliberate act by the customer, not a side effect of opening a link. §8.4 made the same
 * call about "Mark as sent": the system should record what actually happened, and the only
 * way to know a person meant this is to have them say so.
 */
'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Button, Card } from '@/components/ui';

export interface ClaimCardProps {
  token: string;
  /** `••••• 43210` — enough to recognise, not enough to disclose. */
  maskedPhone: string;
  /** How many unclaimed purchases are waiting on that number. */
  waiting: number;
  /** This account has already proven this number; the link has nothing left to do. */
  alreadyVerified: boolean;
}

export function ClaimCard({
  token,
  maskedPhone,
  waiting,
  alreadyVerified,
}: ClaimCardProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<number | null>(null);

  async function claim() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const body: { error?: string; claimed?: number } = await response.json();

      if (!response.ok) {
        setError(body.error ?? 'That did not work. Please try again.');
        return;
      }

      setClaimed(body.claimed ?? 0);

      /**
       * Deliberately NOT `router.refresh()`.
       *
       * The first version refreshed so the nav would reflect the rotated session — and the
       * refresh re-ran this page's server component, which re-reads the token that the claim
       * had just consumed. The customer saw "This link is no longer valid" appear one second
       * after a claim that had in fact succeeded: the worst possible message at the moment it
       * worked. Caught by the E2E, which asserted the success copy and found the failure copy.
       *
       * Nothing needs refreshing here. The rotated session cookie is already set, and the
       * next navigation — the button below — renders against it.
       */
    } catch {
      setError('Network problem. Nothing was changed — try again.');
    } finally {
      setBusy(false);
    }
  }

  if (claimed !== null) {
    return (
      <Card className="flex flex-col gap-4">
        <p className="text-h2 font-semibold text-up">
          {claimed === 0
            ? 'Your number is confirmed'
            : `${claimed} ${claimed === 1 ? 'purchase' : 'purchases'} added`}
        </p>
        <p className="text-body text-muted">
          {claimed === 0
            ? 'We didn’t find any past purchases on this number, but anything you buy from now on will appear here automatically.'
            : 'They’re in your account now, with the invoices. Anything you buy from now on appears here automatically.'}
        </p>
        <div>
          <Link href="/account/orders">
            <Button variant="accent" size="lg">
              See your orders
            </Button>
          </Link>
        </div>
      </Card>
    );
  }

  if (alreadyVerified) {
    return (
      <Card className="flex flex-col gap-4">
        <p className="text-h3 font-semibold text-ink">You&rsquo;re all set</p>
        <p className="text-body text-muted">
          This number is already confirmed on your account, so your purchases are already
          here.
        </p>
        <div>
          <Link href="/account/orders">
            <Button variant="accent" size="md">
              See your orders
            </Button>
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-4">
      <p className="text-h3 font-semibold text-ink">
        Add the purchases made on {maskedPhone} to this account?
      </p>

      {/*
        Say what will happen before it happens. `waiting` is the count of orders billed to
        this number that nobody has claimed — zero is a perfectly normal answer for a
        customer whose first bill is the one that carried this link.
      */}
      <p className="text-body text-muted">
        {waiting === 0
          ? 'We’ll confirm this number on your account, so every purchase you make from now on shows up here with its invoice.'
          : `We found ${waiting} ${waiting === 1 ? 'purchase' : 'purchases'} billed to this number. Linking them puts ${waiting === 1 ? 'it' : 'them'} in your order history, with the invoices.`}
      </p>

      {error && (
        <p
          role="alert"
          className="rounded-field bg-down/10 px-4 py-2 text-small text-down"
        >
          {error}
        </p>
      )}

      <div>
        <Button variant="accent" size="lg" loading={busy} onClick={() => void claim()}>
          Yes, these are mine
        </Button>
      </div>

      <p className="text-small text-muted">
        This link only works once, and only for the number the bill was sent to.
      </p>
    </Card>
  );
}
