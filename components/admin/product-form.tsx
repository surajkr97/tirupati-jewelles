/**
 * Product create/edit form.
 * Created by Phase 7 (specs/07-admin-panel.md §7.4).
 *
 * §7.4: "Live price preview using `calculateLine` as the admin types."
 *
 * Literally `calculateLine` — the same function the storefront, the calculator and Phase 8's
 * bill will call. §5's rule holds here too: "Three implementations of GST rounding is three
 * different totals on the same purchase." The preview is not an approximation of the price,
 * it *is* the price.
 *
 * The description is a plain textarea. §7.4 forbids a rich-text editor and gives the reason:
 * "it is an XSS surface for no benefit here."
 */
'use client';

import { useMemo, useState, useTransition } from 'react';

import { saveProduct } from '@/app/admin/products/actions';
import { Button, Card, Input, Select, toast } from '@/components/ui';
import { formatINR } from '@/lib/money';
import {
  calculateLine,
  PricingError,
  type PurityKey,
  type RatesByPurity,
} from '@/lib/pricing';
import { cn } from '@/lib/utils/cn';

export interface ProductFormProps {
  categories: { id: string; name: string }[];
  /** Paise per gram, for the live preview. */
  rates: Record<PurityKey, string>;
  /** The shop's §7.9 GST rate, for the live preview. */
  gstPct: number;
  /** The shop's §7.9 making default, prefilled on a NEW piece only. DEBT-024. */
  defaultMakingPct: number;
  initial?: {
    id: string;
    name: string;
    slug: string;
    description: string;
    categoryId: string;
    purity: PurityKey;
    weightGrams: string;
    makingPct: string;
    stoneChargeRupees: string;
    hallmarkNo: string;
    bisCertNo: string;
    isActive: boolean;
    isFeatured: boolean;
  };
}

const PURITIES: { value: PurityKey; label: string }[] = [
  { value: 'K22_916', label: 'Gold 22K (916)' },
  { value: 'K18_750', label: 'Gold 18K (750)' },
  { value: 'SILVER_999', label: 'Silver 999' },
];

export function ProductForm({
  categories,
  rates,
  gstPct,
  defaultMakingPct,
  initial,
}: ProductFormProps) {
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    slug: initial?.slug ?? '',
    description: initial?.description ?? '',
    categoryId: initial?.categoryId ?? categories[0]?.id ?? '',
    purity: initial?.purity ?? ('K22_916' as PurityKey),
    weightGrams: initial?.weightGrams ?? '',
    // An existing piece keeps its own figure; only a new one takes the shop's default.
    makingPct: initial?.makingPct ?? String(defaultMakingPct),
    stoneChargeRupees: initial?.stoneChargeRupees ?? '',
    hallmarkNo: initial?.hallmarkNo ?? '',
    bisCertNo: initial?.bisCertNo ?? '',
    isActive: initial?.isActive ?? true,
    isFeatured: initial?.isFeatured ?? false,
  });

  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError(null);
  };

  /**
   * §7.4's live preview.
   *
   * `calculateLine` throws on invalid input by design (§5.1 forbids silent clamping), so a
   * half-typed weight is caught and shown as "—" rather than crashing the form. The admin
   * is mid-keystroke; that is not an error state.
   */
  const preview = useMemo(() => {
    try {
      const [whole = '0', fraction = ''] = form.weightGrams.split('.');
      if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction)) return null;

      const weightMg = Number(whole || 0) * 1000 + Number(fraction.padEnd(3, '0') || 0);
      const [rWhole = '0', rFraction = ''] = form.stoneChargeRupees.split('.');
      const stoneCharge =
        BigInt(rWhole || '0') * 100n + BigInt(rFraction.padEnd(2, '0') || '0');

      const ratesByPurity = Object.fromEntries(
        Object.entries(rates).map(([purity, paise]) => [purity, BigInt(paise)]),
      ) as RatesByPurity;

      return calculateLine(
        {
          metal: form.purity === 'SILVER_999' ? 'SILVER' : 'GOLD',
          purity: form.purity,
          weightMg,
          makingPct: Number(form.makingPct || 0),
          stoneCharge,
          gstPct,
        },
        ratesByPurity[form.purity],
      );
    } catch (err) {
      // A PricingError here is the admin typing, not a bug.
      if (err instanceof PricingError) return null;
      return null;
    }
  }, [
    form.weightGrams,
    form.makingPct,
    form.stoneChargeRupees,
    form.purity,
    rates,
    gstPct,
  ]);

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await saveProduct({ ...form, id: initial?.id });

      if (!result.ok) {
        setError({ message: result.error, field: result.field });
        return;
      }
      // §7 DESIGN: "Save state always clear."
      toast(initial ? 'Piece updated' : 'Piece added');
    });
  };

  const fieldError = (field: string) =>
    error?.field === field ? error.message : undefined;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4">
        <Input
          label="Name"
          value={form.name}
          error={fieldError('name')}
          onChange={(event) => set('name', event.target.value)}
        />

        <Input
          label="Web address"
          hint="Left blank, this is made from the name."
          value={form.slug}
          error={fieldError('slug')}
          onChange={(event) => set('slug', event.target.value)}
        />

        <div className="flex w-full flex-col gap-2">
          <label htmlFor="description" className="text-small font-medium text-ink">
            Description
          </label>
          {/*
            A plain textarea, per §7.4. Rendered as text everywhere it appears — React
            escapes it — so there is no markup path and nothing to sanitise.
          */}
          <textarea
            id="description"
            rows={4}
            maxLength={2000}
            value={form.description}
            onChange={(event) => set('description', event.target.value)}
            className="w-full rounded-field bg-white p-4 text-body text-ink ring-1 ring-line ring-inset focus:ring-2 focus:ring-ink focus:outline-none"
          />
        </div>

        <Select
          label="Collection"
          value={form.categoryId}
          error={fieldError('categoryId')}
          onChange={(event) => set('categoryId', event.target.value)}
        >
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>

        <Select
          label="Metal & purity"
          value={form.purity}
          onChange={(event) => set('purity', event.target.value as PurityKey)}
        >
          {PURITIES.map((purity) => (
            <option key={purity.value} value={purity.value}>
              {purity.label}
            </option>
          ))}
        </Select>

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Weight"
            // §7 DESIGN: "Forms use appropriate mobile keyboards throughout."
            inputMode="decimal"
            suffix="g"
            placeholder="0.000"
            value={form.weightGrams}
            error={fieldError('weightGrams')}
            onChange={(event) => set('weightGrams', event.target.value)}
          />
          <Input
            label="Making"
            inputMode="decimal"
            suffix="%"
            value={form.makingPct}
            error={fieldError('makingPct')}
            onChange={(event) => set('makingPct', event.target.value)}
          />
        </div>

        <Input
          label="Stone / other charges"
          inputMode="decimal"
          suffix="₹"
          placeholder="0.00"
          value={form.stoneChargeRupees}
          error={fieldError('stoneChargeRupees')}
          onChange={(event) => set('stoneChargeRupees', event.target.value)}
        />
      </Card>

      {/* §7.4's live preview. Same engine as the storefront, so what the admin sees here is
          what a customer will see on the product page. */}
      <Card className="flex flex-col gap-4" data-testid="price-preview">
        <h2 className="text-h3 font-semibold text-ink">Price at today&rsquo;s rate</h2>

        {preview ? (
          <dl className="flex flex-col gap-2 text-body">
            <Row label="Metal value" value={preview.metalValue} />
            <Row label={`Making ${form.makingPct || 0}%`} value={preview.makingCharge} />
            {preview.stoneCharge > 0n && (
              <Row label="Stones" value={preview.stoneCharge} />
            )}
            <Row label={`GST ${gstPct}%`} value={preview.gstAmount} />
            <div className="flex items-baseline justify-between gap-4 border-t border-line pt-2">
              <dt className="font-semibold text-ink">Total</dt>
              <dd
                className="text-h3 font-semibold text-ink tabular"
                data-testid="preview-total"
              >
                {formatINR(preview.lineTotal, true)}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-body text-muted">Enter a weight to see the price.</p>
        )}
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-h3 font-semibold text-ink">Hallmarking</h2>
        <Input
          label="HUID / hallmark number"
          hint="Leave blank and the page says “Hallmark details available in store”."
          value={form.hallmarkNo}
          onChange={(event) => set('hallmarkNo', event.target.value)}
        />
        <Input
          label="BIS certificate number"
          value={form.bisCertNo}
          onChange={(event) => set('bisCertNo', event.target.value)}
        />
      </Card>

      <Card className="flex flex-col gap-4">
        <Toggle
          label="Visible on the site"
          checked={form.isActive}
          onChange={(value) => set('isActive', value)}
        />
        <Toggle
          label="Featured"
          checked={form.isFeatured}
          onChange={(value) => set('isFeatured', value)}
        />
      </Card>

      {error && !error.field && (
        <p
          role="alert"
          className="rounded-field bg-down/10 px-4 py-4 text-small text-down"
        >
          {error.message}
        </p>
      )}

      <Button
        variant="primary"
        size="lg"
        full
        loading={pending}
        onClick={submit}
        data-testid="save-product"
      >
        {initial ? 'Save changes' : 'Add this piece'}
      </Button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: bigint }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular">{formatINR(value, true)}</dd>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex min-h-tap cursor-pointer items-center justify-between gap-4">
      <span className="text-body text-ink">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-8 w-16 shrink-0 rounded-pill transition-colors duration-fast ease-standard',
          'focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none',
          checked ? 'bg-rose-deep' : 'bg-line',
        )}
      >
        {/*
          `left-1` is load-bearing, and its absence was hidden by a second bug.

          With no left anchor the knob falls at its STATIC position, which a `<button>`
          centres (`text-align: center`) — so it started 32px in and `translate-x-*` moved it
          from the middle of the track rather than from the edge. That was invisible while
          `translate-x-7` was itself off-scale and emitting nothing. Measured, not read:
          the knob sat at offset 36 when off and 64 when on, the second putting it entirely
          outside a 64px track.

          Anchored at 4px with 32px of travel, the 24px knob sits inset 4px at both ends.
        */}
        <span
          className={cn(
            'absolute top-1 left-1 size-6 rounded-pill bg-white shadow-card',
            'transition-transform duration-base ease-standard',
            checked ? 'translate-x-8' : 'translate-x-0',
          )}
        />
      </button>
    </label>
  );
}
