/**
 * One priced piece.
 * Created by Phase 5 (specs/05-calculator.md §5.4).
 *
 * Every numeric field carries `inputMode="decimal"`. Phase 2 called that prop
 * "load-bearing, not cosmetic" and this is the screen it was talking about: a grid of
 * numeric inputs used one-handed at 375px, where the wrong keyboard makes the feature
 * unusable rather than merely awkward.
 */
'use client';

import { ChevronDown, Copy, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';

import { Card, Input, SegmentedControl } from '@/components/ui';
import {
  MAKING_CHIPS,
  PURITY_OPTIONS,
  type CalculatorItem,
  type FieldErrors,
} from '@/lib/calculator/types';
import { formatINR } from '@/lib/money';
import type { LineResult, PurityKey } from '@/lib/pricing';
import { cn } from '@/lib/utils/cn';

export interface ItemCardProps {
  item: CalculatorItem;
  index: number;
  result: LineResult | null;
  errors: FieldErrors;
  canRemove: boolean;
  onChange: (patch: Partial<Omit<CalculatorItem, 'id'>>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}

export function ItemCard({
  item,
  index,
  result,
  errors,
  canRemove,
  onChange,
  onRemove,
  onDuplicate,
}: ItemCardProps) {
  const [showStones, setShowStones] = useState(item.stoneCharge.trim() !== '');
  const [showBreakdown, setShowBreakdown] = useState(false);
  const breakdownId = useId();

  const purityOption = PURITY_OPTIONS.find((o) => o.value === item.purity);
  const displayName = item.label.trim() || `Item ${index + 1}`;

  return (
    <Card className="flex flex-col gap-4" data-testid="item-card">
      <div className="flex items-center gap-2">
        <input
          value={item.label}
          onChange={(event) => onChange({ label: event.target.value })}
          placeholder={`Item ${index + 1}`}
          aria-label={`Name for item ${index + 1}`}
          maxLength={80}
          // Borderless until focused: a name is optional, and a full field border invites
          // the reader to think it must be filled in.
          className={cn(
            'h-tap min-w-0 flex-1 rounded-field bg-transparent px-2 text-h3 font-semibold text-ink',
            'placeholder:font-normal placeholder:text-muted',
            'focus:bg-white focus:ring-2 focus:ring-ink focus:outline-none',
          )}
        />

        <IconButton label={`Duplicate ${displayName}`} onClick={onDuplicate}>
          <Copy className="size-5" aria-hidden="true" />
        </IconButton>

        <IconButton
          label={canRemove ? `Remove ${displayName}` : `Clear ${displayName}`}
          onClick={onRemove}
          destructive
        >
          <Trash2 className="size-5" aria-hidden="true" />
        </IconButton>
      </div>

      <SegmentedControl<PurityKey>
        label={`Metal and purity for ${displayName}`}
        options={PURITY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        value={item.purity}
        onChange={(purity) => onChange({ purity })}
      />

      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Weight"
          // `decimal` rather than `numeric`: `numeric` gives a keypad with no decimal
          // point on iOS, and every weight here has three of them.
          inputMode="decimal"
          suffix="g"
          placeholder="0.000"
          value={item.weightGrams}
          error={errors.weightGrams}
          onChange={(event) => onChange({ weightGrams: event.target.value })}
        />

        <Input
          label="Making"
          inputMode="decimal"
          suffix="%"
          placeholder="0"
          value={item.makingPct}
          error={errors.makingPct}
          onChange={(event) => onChange({ makingPct: event.target.value })}
        />
      </div>

      {/* §5.4: "most shops use a small set of standard rates and chips beat typing on
          mobile." */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-small text-muted">Common:</span>
        {MAKING_CHIPS.map((pct) => (
          <button
            key={pct}
            type="button"
            onClick={() => onChange({ makingPct: pct })}
            aria-pressed={item.makingPct === pct}
            className={cn(
              'h-tap rounded-pill px-4 text-small font-semibold',
              'transition-colors duration-fast ease-standard',
              'focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none',
              item.makingPct === pct
                ? 'bg-ink text-white'
                : 'bg-taupe-lt/50 text-ink hover:bg-taupe-lt',
            )}
          >
            {pct}%
          </button>
        ))}
      </div>

      {/* §5.4: "Stone/other charges: optional ₹ field, collapsed by default." */}
      {showStones ? (
        <Input
          label="Stone / other charges"
          inputMode="decimal"
          suffix="₹"
          placeholder="0.00"
          value={item.stoneCharge}
          error={errors.stoneCharge}
          onChange={(event) => onChange({ stoneCharge: event.target.value })}
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowStones(true)}
          className="flex h-tap items-center self-start text-small font-semibold text-taupe-deep hover:underline"
        >
          + Add stone or other charges
        </button>
      )}

      {/* §5.4: "Per-item breakdown, collapsed by default." */}
      <div className="border-t border-line pt-4">
        <button
          type="button"
          onClick={() => setShowBreakdown((open) => !open)}
          aria-expanded={showBreakdown}
          aria-controls={breakdownId}
          className="flex h-tap w-full items-center justify-between gap-4 text-left"
        >
          <span className="text-small font-medium text-muted">
            {showBreakdown ? 'Hide breakdown' : 'Show breakdown'}
          </span>

          <span className="flex items-center gap-2">
            <span
              className="text-h3 font-semibold text-ink tabular"
              data-testid="item-total"
            >
              {result ? formatINR(result.lineTotal) : '—'}
            </span>
            <ChevronDown
              aria-hidden="true"
              className={cn(
                'size-5 text-muted transition-transform duration-base ease-standard',
                showBreakdown && 'rotate-180',
              )}
            />
          </span>
        </button>

        {showBreakdown && (
          <dl id={breakdownId} className="mt-4 flex flex-col gap-2 text-small">
            {result ? (
              <>
                <BreakdownRow
                  label={`Metal value${purityOption ? ` (${purityOption.unit})` : ''}`}
                  value={result.metalValue}
                />
                <BreakdownRow
                  label={`Making ${item.makingPct || 0}%`}
                  value={result.makingCharge}
                />
                {result.stoneCharge > 0n && (
                  <BreakdownRow label="Stones / other" value={result.stoneCharge} />
                )}
                <BreakdownRow label="Subtotal" value={result.subtotal} />
                <BreakdownRow
                  label={`GST ${item.gstPct || 0}%`}
                  value={result.gstAmount}
                />
                <BreakdownRow label="Item total" value={result.lineTotal} emphasis />
              </>
            ) : (
              <p className="text-muted">Fix the highlighted fields to see a total.</p>
            )}
          </dl>
        )}
      </div>
    </Card>
  );
}

function BreakdownRow({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: bigint;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-4',
        emphasis && 'border-t border-line pt-2 font-semibold text-ink',
      )}
    >
      <dt className={emphasis ? undefined : 'text-muted'}>{label}</dt>
      {/* Paise shown here and nowhere else. The breakdown is the one place a customer is
          checking the arithmetic, and ₹1,36,609 → ₹1,36,609.31 is the difference between
          "these numbers do not add up" and "they do". */}
      <dd className="tabular">{formatINR(value, true)}</dd>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  destructive = false,
  children,
}: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      // size-tap, not a smaller icon box: MASTER-SPEC §3 sets 44×44 as the floor and these
      // sit next to each other, where a miss deletes the wrong row.
      className={cn(
        'flex size-tap shrink-0 items-center justify-center rounded-pill',
        'transition-colors duration-fast ease-standard',
        'focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none',
        destructive
          ? 'text-muted hover:bg-down/10 hover:text-down'
          : 'text-muted hover:bg-taupe-lt/50 hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}
