/**
 * Inline rate editor.
 * Created by Phase 7 (specs/07-admin-panel.md §7.3).
 *
 * §7.3: "Inline edit in the display unit (₹/10g, ₹/kg) with a big numeric keypad-friendly
 * field. Shows previous value and % change before saving. >20% change requires a
 * confirmation step naming the old and new values."
 *
 * The confirmation names both figures because §7.3 says why: this is "the single most
 * damaging typo available". A dialog that only asks "are you sure?" is one people learn to
 * dismiss; one that says "₹1,18,420 → ₹11,84,200, up 900%" is one they read.
 */
'use client';

import { useState, useTransition } from 'react';

import { updateRate } from '@/app/admin/rates/actions';
import { Button, Card, Input, toast } from '@/components/ui';
import { formatINR } from '@/lib/money';
import { cn } from '@/lib/utils/cn';

export interface RateEditorProps {
  metal: 'GOLD' | 'SILVER';
  purity: 'K22_916' | 'K18_750' | 'SILVER_999';
  label: string;
  unit: string;
  /** Current rate in the display unit, in paise. */
  currentDisplay: string;
  effectiveAt: string;
}

export function RateEditor({
  metal,
  purity,
  label,
  unit,
  currentDisplay,
  effectiveAt,
}: RateEditorProps) {
  const currentPaise = BigInt(currentDisplay);
  const currentRupees = (Number(currentPaise) / 100).toFixed(2).replace(/\.00$/, '');

  const [value, setValue] = useState(currentRupees);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<{ changePct: number } | null>(null);

  const typed = Number(value);
  const valid = Number.isFinite(typed) && typed > 0;

  /**
   * §7.3: "Shows previous value and % change before saving."
   *
   * Computed as the admin types, so the number that would alarm them appears while they can
   * still see the typo that caused it — not after they have committed to it.
   */
  const preview =
    valid && currentPaise > 0n
      ? ((typed * 100 - Number(currentPaise)) / Number(currentPaise)) * 100
      : null;

  const save = (confirmed: boolean) => {
    setError(null);

    startTransition(async () => {
      const result = await updateRate({
        metal,
        purity,
        displayRupees: typed,
        confirmed,
      });

      if (result.ok) {
        setConfirming(null);
        // §7 DESIGN: "Save state always clear — never ambiguous whether a change persisted."
        toast(`${label} updated to ₹${value}`);
        return;
      }

      if (result.needsConfirmation) {
        setConfirming({ changePct: result.needsConfirmation.changePct });
        return;
      }

      setConfirming(null);
      setError(result.error);
    });
  };

  const dirty = value !== currentRupees;

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-h3 font-semibold text-ink">{label}</h2>
        <p className="text-small text-muted">{unit}</p>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-small text-muted">Current</p>
        <p className="text-display font-semibold text-ink tabular">
          {formatINR(currentPaise)}
        </p>
        <p className="text-small text-muted">
          Set{' '}
          <time dateTime={effectiveAt}>
            {new Intl.DateTimeFormat('en-IN', {
              dateStyle: 'medium',
              timeStyle: 'short',
              timeZone: 'Asia/Kolkata',
            }).format(new Date(effectiveAt))}
          </time>
        </p>
      </div>

      <Input
        label={`New rate (${unit})`}
        // §7 DESIGN: "Forms use appropriate mobile keyboards throughout." `decimal`, not
        // `numeric` — iOS's numeric pad has no decimal point.
        inputMode="decimal"
        suffix="₹"
        value={value}
        error={error ?? undefined}
        onChange={(event) => {
          setValue(event.target.value);
          setConfirming(null);
          setError(null);
        }}
      />

      {preview !== null && dirty && (
        <p
          className={cn(
            'text-body font-medium tabular',
            preview > 0 ? 'text-up' : preview < 0 ? 'text-down' : 'text-muted',
          )}
        >
          {preview > 0 ? '▲' : preview < 0 ? '▼' : '–'} {Math.abs(preview).toFixed(2)}%
          from {formatINR(currentPaise)}
        </p>
      )}

      {confirming ? (
        // The §7.3 confirmation step. Deliberately loud, and it names both figures.
        <div className="flex flex-col gap-4 rounded-field bg-down/10 p-4">
          <p className="text-body font-semibold text-down">
            That is a {confirming.changePct}% change.
          </p>
          <p className="text-small text-ink">
            {label} would go from <strong>{formatINR(currentPaise)}</strong> to{' '}
            <strong>₹{value}</strong> {unit}. Check for a missing or extra digit before
            confirming — this price flows straight into every product page and every bill.
          </p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirming(null)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              variant="accent"
              size="sm"
              onClick={() => save(true)}
              loading={pending}
              data-testid={`confirm-${purity}`}
            >
              Yes, set it
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="primary"
          size="md"
          full
          disabled={!valid || !dirty}
          loading={pending}
          onClick={() => save(false)}
          data-testid={`save-${purity}`}
        >
          {dirty ? 'Save new rate' : 'No change'}
        </Button>
      )}
    </Card>
  );
}
