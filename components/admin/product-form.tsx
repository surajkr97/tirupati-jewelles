/**
 * Product create/edit form.
 * Created by Phase 7 (specs/07-admin-panel.md §7.4), regrouped by Stage 5D (§8).
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
 *
 * ── Stage 5D: one long card became four short ones ──
 *
 * Every field lived in a single stack, so the name sat directly above the making charge and
 * the hallmark number below the price. §8 asks for identity → details → pricing → media →
 * availability → save, and the grouping is the redesign: the fields, their names, their
 * validation and the action behind them are untouched.
 *
 * The pricing card is the one that earns its heading. Weight and purity are DETAILS that
 * happen to feed the price; making charge and stone charge are the price itself, and putting
 * them beside the live preview is what lets an admin see a 12% typo become ₹9,000.
 */
'use client';

import { Camera, Check, Plus } from 'lucide-react';
import Link from 'next/link';
import { useId, useMemo, useState, useTransition } from 'react';

import { saveProduct } from '@/app/admin/products/actions';
import { Button, buttonClasses, Card, Input, Select, toast } from '@/components/ui';
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
  const blank = {
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
  };

  /**
   * What was on screen at the last successful save, so the save button can tell whether
   * there is anything to save. Seeded from the server's values and re-seeded on save, which
   * is what stops a saved form from still claiming unsaved work.
   */
  const [saved, setSaved] = useState(blank);
  const [form, setForm] = useState(blank);

  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const descriptionId = useId();

  /**
   * The piece this form just created, if it did.
   *
   * A create used to end in a toast and nothing else: the form still read "Add this piece"
   * with the same values in it, so a second tap produced "“X” already uses the web address
   * /x" — and the owner had no route to the one thing they now needed, which is the photo
   * upload that only exists once a product has an id (§19).
   */
  const [created, setCreated] = useState<{ id: string } | null>(null);

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
      // The form is now what the database holds, so the save button goes quiet again.
      setSaved(form);
      if (!initial) setCreated({ id: result.data.id });
      // §7 DESIGN: "Save state always clear."
      toast(initial ? 'Piece updated' : 'Piece added');
    });
  };

  const fieldError = (field: string) =>
    error?.field === field ? error.message : undefined;

  const dirty = (Object.keys(form) as (keyof typeof form)[]).some(
    (key) => form[key] !== saved[key],
  );

  return (
    <div className="flex flex-col gap-6">
      {/* ── 1. Identity: what the piece is called and where it lives ───────── */}
      <FormSection title="Identity">
        <Input
          label="Name"
          hint="What a customer sees. This is also the heading on the product page."
          value={form.name}
          error={fieldError('name')}
          onChange={(event) => set('name', event.target.value)}
        />

        <Input
          label="Web address"
          hint="Optional. Left blank, this is made from the name."
          value={form.slug}
          error={fieldError('slug')}
          onChange={(event) => set('slug', event.target.value)}
        />

        <div className="flex w-full flex-col gap-2">
          <label htmlFor={descriptionId} className="text-small font-medium text-ink">
            Description
          </label>
          {/*
            A plain textarea, per §7.4. Rendered as text everywhere it appears — React
            escapes it — so there is no markup path and nothing to sanitise.

            Hand-rolled rather than an `<Input>`: this is the only multiline field in the
            application, and §26 is explicit that a primitive with one consumer is an
            abstraction the design system does not need. The label, hint and
            `aria-describedby` wiring below match `Input`'s so it behaves identically to a
            screen reader.
          */}
          <textarea
            id={descriptionId}
            aria-describedby={`${descriptionId}-hint`}
            rows={4}
            maxLength={2000}
            value={form.description}
            onChange={(event) => set('description', event.target.value)}
            className="w-full rounded-field bg-white p-4 text-body text-ink ring-1 ring-line ring-inset focus:ring-2 focus:ring-ink focus:outline-none"
          />
          <p id={`${descriptionId}-hint`} className="text-small text-muted">
            Optional, up to <span className="num">2,000</span> characters.
          </p>
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
      </FormSection>

      {/* ── 2. Details: the metal itself ───────────────────────────────────── */}
      <FormSection
        title="The piece"
        description="Purity and weight decide the price, so these are the two figures worth checking twice."
      >
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

        <Input
          label="Weight"
          // §9 — the unit and the accepted range, in the description rather than only in
          // the `suffix`, which is `aria-hidden` and so reaches nobody using a screen reader.
          hint="In grams, up to 3 decimal places."
          // §7 DESIGN: "Forms use appropriate mobile keyboards throughout."
          inputMode="decimal"
          suffix="g"
          placeholder="0.000"
          value={form.weightGrams}
          error={fieldError('weightGrams')}
          onChange={(event) => set('weightGrams', event.target.value)}
        />

        <Input
          label="HUID / hallmark number"
          hint="Optional. Left blank, the page says “Hallmark details available in store”."
          value={form.hallmarkNo}
          onChange={(event) => set('hallmarkNo', event.target.value)}
        />
        <Input
          label="BIS certificate number"
          hint="Optional."
          value={form.bisCertNo}
          onChange={(event) => set('bisCertNo', event.target.value)}
        />
      </FormSection>

      {/* ── 3. Pricing: the two figures the shop sets, beside their result ─── */}
      <FormSection
        title="Pricing"
        description="Metal value comes from today's rate. These are what the shop adds on top."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Making"
            hint="0–100% of the metal value."
            inputMode="decimal"
            suffix="%"
            value={form.makingPct}
            error={fieldError('makingPct')}
            onChange={(event) => set('makingPct', event.target.value)}
          />
          <Input
            label="Stone / other charges"
            hint="A flat amount in rupees."
            inputMode="decimal"
            suffix="₹"
            placeholder="0.00"
            value={form.stoneChargeRupees}
            error={fieldError('stoneChargeRupees')}
            onChange={(event) => set('stoneChargeRupees', event.target.value)}
          />
        </div>

        {/* §7.4's live preview. Same engine as the storefront, so what the admin sees here
            is what a customer will see on the product page. */}
        <div
          className="flex flex-col gap-4 rounded-field bg-rose-tint p-4"
          data-testid="price-preview"
        >
          <p className="text-small font-medium tracking-[0.08em] text-muted uppercase">
            Price at today&rsquo;s rate
          </p>

          {preview ? (
            <dl className="flex flex-col gap-2 text-body">
              <Row label="Metal value" value={preview.metalValue} />
              <Row
                label={`Making ${form.makingPct || 0}%`}
                value={preview.makingCharge}
              />
              {preview.stoneCharge > 0n && (
                <Row label="Stones" value={preview.stoneCharge} />
              )}
              <Row label={`GST ${gstPct}%`} value={preview.gstAmount} />
              <div className="flex items-baseline justify-between gap-4 border-t border-line pt-2">
                <dt className="font-semibold text-ink">Total</dt>
                <dd
                  className="text-h2 font-semibold text-ink num"
                  data-testid="preview-total"
                >
                  {formatINR(preview.lineTotal, true)}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-body text-muted">Enter a weight to see the price.</p>
          )}
        </div>
      </FormSection>

      {/* ── 4. Availability ────────────────────────────────────────────────── */}
      <FormSection title="Availability">
        <Toggle
          label="Visible on the site"
          description="Off takes it off the shop. Nothing is deleted and past bills keep working."
          checked={form.isActive}
          onChange={(value) => set('isActive', value)}
        />
        <Toggle
          label="Featured"
          description="Featured pieces can be picked out on the homepage."
          checked={form.isFeatured}
          onChange={(value) => set('isFeatured', value)}
        />
      </FormSection>

      {/*
        §11 — a failure that belongs to no single field still has to be seen. `role="alert"`
        so it is announced when it appears, not only when somebody scrolls back to it.
      */}
      {error && !error.field && (
        <p
          role="alert"
          className="rounded-field bg-down/10 px-4 py-4 text-small text-down"
        >
          {error.message}
        </p>
      )}

      {/**
       * ── 5. Save ──
       *
       * §12, the same rule the rate form follows: the button gains weight only when it has
       * something to do. On an EXISTING piece "no changes" is a real state and the control
       * says so; on a NEW piece it never is — an empty form is the start of the task, not a
       * saved one — so creation stays pressable and the server's validation is what refuses
       * an empty name.
       *
       * `Button` sets `disabled={disabled || loading}` itself, which is what makes a second
       * tap during a save impossible rather than merely unlikely.
       */}
      {initial ? (
        <Button
          variant={dirty ? 'primary' : 'outline'}
          size="lg"
          full
          disabled={!dirty}
          loading={pending}
          loadingLabel="Saving…"
          onClick={submit}
          data-testid="save-product"
        >
          {dirty ? 'Save changes' : 'No changes'}
        </Button>
      ) : created ? (
        /**
         * §12's "clear success state", and the way on.
         *
         * The Add button is gone rather than disabled: it has already done its job, and a
         * greyed-out "Add this piece" under a piece that exists reads like a failure.
         */
        <Card className="flex flex-col gap-4" data-testid="product-created">
          <p className="flex items-center gap-2 text-body font-semibold text-ink">
            <Check className="size-4 text-up" aria-hidden="true" />
            Piece added
          </p>
          <p className="text-small text-muted">
            It is on the shop now. Photographs attach to a piece once it exists, so this is
            the moment to add them.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link
              href={`/admin/products/${created.id}`}
              className={buttonClasses({ variant: 'accent', size: 'md' })}
            >
              <Camera className="size-4" aria-hidden="true" />
              Add photos
            </Link>
            {/*
              A button, not a link to this same URL: navigating to the route you are
              already on does not unmount the form, so the previous piece's values would
              still be sitting in it.
            */}
            <Button
              variant="outline"
              size="md"
              onClick={() => {
                setForm(blank);
                setSaved(blank);
                setCreated(null);
                setError(null);
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              Add another piece
            </Button>
          </div>
        </Card>
      ) : (
        <Button
          variant="accent"
          size="lg"
          full
          loading={pending}
          loadingLabel="Adding…"
          onClick={submit}
          data-testid="save-product"
        >
          Add this piece
        </Button>
      )}
    </div>
  );
}

/** One titled group of fields. §8's structure, made visible. */
function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-h3 font-semibold text-ink">{title}</h2>
        {description && <p className="text-small text-muted">{description}</p>}
      </div>
      {children}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: bigint }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="num">{formatINR(value, true)}</dd>
    </div>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-body text-ink">{label}</span>
        {description && <span className="text-small text-muted">{description}</span>}
      </div>
      {/*
        The TRACK is 32px tall; the TARGET is 44px.

        Phase 7 got the second one from a `<label>` wrapped around the whole row carrying
        `min-h-tap`, so the switch itself was a 32px-high button and Stage 5D's §23 floor
        depended on a parent that also held the caption. The button now owns its own 44px
        box and centres the track inside it — the control is the target, whatever is
        rendered beside it.
      */}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          'flex h-tap w-16 shrink-0 items-center rounded-pill',
          'focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none',
        )}
      >
        <span
          className={cn(
            'relative h-8 w-full rounded-pill transition-colors duration-fast ease-standard',
            checked ? 'bg-rose-deep' : 'bg-line',
          )}
        >
          {/*
            `left-1` is load-bearing, and its absence was hidden by a second bug.

            With no left anchor the knob falls at its STATIC position, which a `<button>`
            centres (`text-align: center`) — so it started 32px in and `translate-x-*` moved
            it from the middle of the track rather than from the edge. That was invisible
            while `translate-x-7` was itself off-scale and emitting nothing. Measured, not
            read: the knob sat at offset 36 when off and 64 when on, the second putting it
            entirely outside a 64px track.

            Anchored at 4px with 32px of travel, the 24px knob sits inset 4px at both ends.
          */}
          <span
            className={cn(
              'absolute top-1 left-1 size-6 rounded-pill bg-white shadow-card',
              'transition-transform duration-base ease-standard',
              checked ? 'translate-x-8' : 'translate-x-0',
            )}
          />
        </span>
      </button>
    </div>
  );
}
