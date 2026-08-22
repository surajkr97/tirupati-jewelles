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
import { Badge, Button, Card, Input, toast } from '@/components/ui';
import { goldRateFromPure, type GoldPurityKey } from '@/lib/gold-purity';
import { formatINR } from '@/lib/money';
import { cn } from '@/lib/utils/cn';

/** One editable FIELD — not one stored purity. See `app/admin/rates/actions.ts`. */
export type RateTarget = 'GOLD_24K' | 'SILVER_999';

/** A purity this field derives rather than asks for. */
export interface DerivedRate {
  purity: GoldPurityKey;
  label: string;
  /** The rate currently in force for that purity, display unit, in paise. */
  currentDisplay: string;
}

export interface RateEditorProps {
  target: RateTarget;
  label: string;
  unit: string;
  /** Current rate in the display unit, in paise. */
  currentDisplay: string;
  effectiveAt: string;
  /** Older than §7.2's 48-hour rule. Flagged here because this is where it gets fixed. */
  stale?: boolean;
  /**
   * Purities computed from this field instead of typed. Shown live, because a number the
   * admin does not type is still a number they are responsible for — and 916 and 750 are
   * what every product page and every bill will actually price from.
   */
  derived?: DerivedRate[];
}

export function RateEditor({
  target,
  label,
  unit,
  currentDisplay,
  effectiveAt,
  stale = false,
  derived,
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

  /**
   * What the typed 24K figure would make each hallmarked purity.
   *
   * Deliberately the SAME arithmetic, in the same order, as the server: rupees → paise per
   * 10g → truncate to per-gram → apply the fineness. A preview that rounds differently from
   * the write is a preview that lies, and it lies by a rupee, which is exactly the size of
   * discrepancy nobody investigates.
   */
  const derivedNext = (purity: GoldPurityKey): bigint =>
    goldRateFromPure(BigInt(Math.round(typed * 100)) / 10n, purity) * 10n;

  const save = (confirmed: boolean) => {
    setError(null);

    startTransition(async () => {
      const result = await updateRate({ target, displayRupees: typed, confirmed });

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
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-h3 font-semibold text-ink">{label}</h2>
        {/* §6: the unit is never out of sight of the value it belongs to. */}
        <p className="text-small text-muted">{unit}</p>
      </div>

      {/*
        ── Current, then new, then save (§5) ──

        The figure below is what the shop is quoting right now; the field under it is what it
        would become. They used to sit in one undifferentiated column, which is the ambiguity
        §5 names — at a glance the large number reads like the thing being edited. The rule
        and the "New rate" label are the whole separation.
      */}
      <div className="flex flex-col gap-1">
        <p className="text-small font-medium tracking-[0.08em] text-muted uppercase">
          Current
        </p>
        <p className="text-display font-semibold text-ink num">
          {formatINR(currentPaise)}
        </p>
        <p className="flex flex-wrap items-center gap-2 text-small text-muted">
          <span>
            Set{' '}
            <time dateTime={effectiveAt}>
              {new Intl.DateTimeFormat('en-IN', {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: 'Asia/Kolkata',
              }).format(new Date(effectiveAt))}
            </time>
          </span>
          {/*
            §4 — a badge for the exception only. A "fresh" tick on every card every ordinary
            day is chrome that trains the eye to skip the row that matters.
          */}
          {stale && <Badge tone="down">Needs update</Badge>}
        </p>
      </div>

      <div className="h-px bg-line" aria-hidden="true" />

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
            'text-body font-medium num',
            preview > 0 ? 'text-up' : preview < 0 ? 'text-down' : 'text-muted',
          )}
        >
          {preview > 0 ? '▲' : preview < 0 ? '▼' : '–'} {Math.abs(preview).toFixed(2)}%
          from {formatINR(currentPaise)}
        </p>
      )}

      {/*
        ── The rows this field writes ──

        The admin types 24K; the shop sells 916 and 750. Showing the derived pair, live, is
        what keeps the single field honest: it is a smaller thing to trust than two fields,
        not a more opaque one. `aria-live` because for a screen-reader user these numbers
        change with no focus event to announce them.

        The heading sits OUTSIDE the `<dl>`: a definition list may only directly contain
        `<dt>`/`<dd>` groups, `<div>`, `<script>` and `<template>`, and a stray `<p>` in
        there is a serious axe violation (§9.7 gates on it). Each pair keeps its wrapping
        `<div>`, which is what makes the two-column layout legal as well as legible.
      */}
      {derived && derived.length > 0 && (
        <div
          className="flex flex-col gap-2 rounded-field border border-line bg-sand p-4"
          aria-live="polite"
        >
          <p className="text-small font-medium tracking-[0.08em] text-muted uppercase">
            {dirty && valid ? 'Would be saved as' : 'Saved as'}
          </p>

          <dl className="flex flex-col gap-2">
            {derived.map(
              ({ purity, label: purityLabel, currentDisplay: currentDerived }) => (
                <div
                  key={purity}
                  className="flex flex-wrap items-baseline justify-between gap-x-4"
                >
                  <dt className="text-body text-muted">{purityLabel}</dt>
                  <dd className="text-body num text-ink">
                    {dirty && valid ? (
                      <>
                        <span className="text-muted line-through">
                          {formatINR(BigInt(currentDerived))}
                        </span>{' '}
                        <strong className="font-semibold">
                          {formatINR(derivedNext(purity))}
                        </strong>
                      </>
                    ) : (
                      <span className="font-semibold">
                        {formatINR(BigInt(currentDerived))}
                      </span>
                    )}
                  </dd>
                </div>
              ),
            )}
          </dl>
        </div>
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
              loadingLabel="Saving…"
              data-testid={`confirm-${target}`}
            >
              Yes, set it
            </Button>
          </div>
        </div>
      ) : (
        /**
         * The button gains weight only when it has something to do.
         *
         * A filled `primary` bar reading "No change" sat at full strength on all three cards
         * every time the page loaded — three of the heaviest elements on screen, all inert.
         * `outline` while there is nothing to save keeps the control present and legible
         * without competing with the figure it belongs to; it fills in the moment the field
         * differs from the current rate, which is also the moment it becomes pressable.
         */
        <Button
          variant={dirty ? 'primary' : 'outline'}
          size="md"
          full
          disabled={!valid || !dirty}
          loading={pending}
          loadingLabel="Saving…"
          onClick={() => save(false)}
          data-testid={`save-${target}`}
        >
          {dirty ? 'Save new rate' : 'No change'}
        </Button>
      )}
    </Card>
  );
}
