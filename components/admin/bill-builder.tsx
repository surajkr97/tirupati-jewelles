/**
 * The bill builder — flagship feature #3.
 * Created by Phase 8 (specs/08-billing-whatsapp.md §8.1).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE TOTAL ON THIS SCREEN IS A PREVIEW. THE SERVER'S IS THE BILL.
 *
 *  §8.2: "Recompute every line server-side. The client's totals arrive but are discarded."
 *  So this component sends ITEMS, never figures — `lib/bills/schema.ts` is `.strict()` and
 *  has no field for a total, which makes an accidental regression here a 400 rather than a
 *  wrong invoice.
 *
 *  The rate it displays comes from `/api/rates` — the true rate, never the ticker's
 *  jittered value, which lives in one component's React state and has no path here.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Built on Phase 5's components rather than beside them (§8.1: "Do not fork them"): the
 * reducer, the item card, the item list, the debounce and the pricing helper are all the
 * calculator's. What is new is the customer panel, "Load from product", and Generate.
 */
'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';

import { ItemList } from '@/components/calculator/item-list';
import { useDebounced } from '@/components/calculator/use-debounced';
import { StickyBar } from '@/components/shell/sticky-bar';
import { Button, Card, Input, Select, toast } from '@/components/ui';
import { priceItems } from '@/lib/calculator/price-items';
import { calculatorReducer, initialState } from '@/lib/calculator/reducer';
import type { ItemDefaults } from '@/lib/calculator/types';
import { formatINR } from '@/lib/money';
import type { PurityKey, RatesByPurity } from '@/lib/pricing';
import { ratesByPurityFromApi } from '@/lib/rates.keys';

/** One catalogue piece, for §8.1's "Load from product". */
export interface ProductOption {
  id: string;
  name: string;
  purity: PurityKey;
  weightGrams: string;
  makingPct: string;
  stoneChargeRupees: string;
  hallmarkNo: string;
  bisCertNo: string;
}

/** Per-item fields that only a bill has (§8.3), kept beside the shared item state. */
interface ItemExtras {
  productId?: string;
  hallmarkNo: string;
  bisCertNo: string;
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * §8.1: "Phone validated as a real Indian mobile before `Generate` is enabled."
 *
 * The same rule `lib/auth/identifier.ts` applies server-side — ten digits beginning 6-9 —
 * restated here because the check must run on every keystroke and `libphonenumber-js` is
 * 150KB the admin panel does not need. The server normalises and re-validates regardless;
 * this only decides whether the button is enabled.
 */
export function isIndianMobile(input: string): boolean {
  const digits = input.replace(/\D/g, '');

  /**
   * ── A prefix is only a prefix if something is left after it ──
   *
   * This used to be `.replace(/^(91|0)/, '')`, which strips those characters from ANY
   * input — including a plain ten-digit number that happens to begin `91`. `9101222943`
   * became `01222943`, failed the test below, and the Generate button stayed disabled
   * forever under the message "Enter a 10-digit Indian mobile number".
   *
   * `91xxxxxxxx` is an assigned Indian mobile block, so this was not hypothetical: a
   * walk-in customer whose number starts 91 could not be billed at all. The server would
   * have accepted the number — `lib/auth/identifier.ts` parses it properly — but the button
   * never enabled, so nothing was ever sent.
   *
   * Length is what distinguishes a country code from the number itself: `+91` plus ten
   * digits is twelve, a `0` trunk prefix plus ten is eleven, and a bare mobile is ten.
   */
  const national =
    digits.length === 12 && digits.startsWith('91')
      ? digits.slice(2)
      : digits.length === 11 && digits.startsWith('0')
        ? digits.slice(1)
        : digits;

  return /^[6-9]\d{9}$/.test(national);
}

export function BillBuilder({
  products,
  defaults,
}: {
  products: ProductOption[];
  /** The shop's §7.9 prefills for a new line, read server-side. DEBT-024. */
  defaults: ItemDefaults;
}) {
  const router = useRouter();

  const [state, dispatch] = useReducer(
    calculatorReducer,
    initialState(newId(), defaults),
  );
  const [extras, setExtras] = useState<Record<string, ItemExtras>>({});

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [note, setNote] = useState('');

  const [rates, setRates] = useState<RatesByPurity | null>(null);
  const [ratesError, setRatesError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * §8.2's idempotency key, minted once per builder session.
   *
   * §8.2: "Admins on flaky shop wifi will double-tap Generate." A key generated inside the
   * submit handler would be different on the second tap and defeat the whole mechanism, so
   * it is created with the form and only replaced after a bill is successfully raised.
   */
  const [idempotencyKey, setIdempotencyKey] = useState(newId);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/rates')
      .then((response) => {
        if (!response.ok) throw new Error(`/api/rates responded ${response.status}`);
        return response.json();
      })
      .then((payload: unknown) => {
        if (cancelled) return;
        const parsed = ratesByPurityFromApi(payload);
        if (!parsed) throw new Error('Unexpected /api/rates payload');
        setRates(parsed);
      })
      .catch(() => {
        if (!cancelled) setRatesError(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state.notice) toast(state.notice);
  }, [state.notice]);

  const debouncedItems = useDebounced(state.items);
  const { total, results, errors } = useMemo(
    () => priceItems(debouncedItems, rates),
    [debouncedItems, rates],
  );

  const setExtra = useCallback((id: string, patch: Partial<ItemExtras>) => {
    setExtras((current) => ({
      ...current,
      [id]: { hallmarkNo: '', bisCertNo: '', ...current[id], ...patch },
    }));
  }, []);

  /** §8.1: "'Load from product' — pick a catalog product to prefill an item." */
  const loadProduct = useCallback(
    (itemId: string, productId: string) => {
      const product = products.find((candidate) => candidate.id === productId);
      if (!product) return;

      dispatch({
        type: 'UPDATE_ITEM',
        id: itemId,
        patch: {
          label: product.name,
          purity: product.purity,
          weightGrams: product.weightGrams,
          makingPct: product.makingPct,
          stoneCharge: product.stoneChargeRupees,
        },
      });

      setExtra(itemId, {
        productId: product.id,
        hallmarkNo: product.hallmarkNo,
        bisCertNo: product.bisCertNo,
      });
    },
    [products, setExtra],
  );

  const phoneValid = isIndianMobile(customerPhone);
  const priced = total !== null && errors.size === 0;
  const hasWeight = state.items.every((item) => item.weightGrams.trim() !== '');
  const canGenerate = phoneValid && priced && hasWeight && !busy && rates !== null;

  async function generate() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/bills', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          customerName,
          customerPhone,
          note,
          // Items only. There is no total in this payload and the server would reject one.
          items: state.items.map((item) => ({
            id: item.id,
            productId: extras[item.id]?.productId ?? null,
            label: item.label,
            metal: item.metal,
            purity: item.purity,
            weightGrams: item.weightGrams,
            makingPct: item.makingPct,
            stoneCharge: item.stoneCharge,
            gstPct: item.gstPct,
            hallmarkNo: extras[item.id]?.hallmarkNo ?? '',
            bisCertNo: extras[item.id]?.bisCertNo ?? '',
          })),
        }),
      });

      const body: {
        error?: string;
        path?: string;
        orderNo?: string;
        replayed?: boolean;
        fields?: Record<string, string>;
      } = await response.json();

      if (!response.ok) {
        setError(
          body.error ??
            (response.status === 429
              ? 'Too many bills just now. Try again in a moment.'
              : 'Could not create the bill.'),
        );
        return;
      }

      // A fresh key for the next bill, so the admin can raise a genuinely identical second
      // invoice without it being swallowed as a replay.
      setIdempotencyKey(newId());

      toast(
        body.replayed
          ? `${body.orderNo} was already created.`
          : `${body.orderNo} created.`,
      );
      if (body.path) router.push(body.path);
    } catch {
      setError('Network problem. The bill was not created.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {ratesError && (
        <p
          role="alert"
          className="rounded-field bg-down/10 px-4 py-2 text-small text-down"
        >
          Could not load today&rsquo;s rates. A bill cannot be raised until they load.
        </p>
      )}

      {/* Customer first: it is what the admin asks for while the customer is still at the
          counter, and a phone typed at the end is a phone typed in a hurry. */}
      <Card className="flex flex-col gap-4">
        <h2 className="text-h3 font-semibold text-ink">Customer</h2>

        <Input
          label="Name"
          value={customerName}
          onChange={(event) => setCustomerName(event.target.value)}
          placeholder="Optional"
          maxLength={120}
          autoComplete="off"
        />

        {/*
          §8.1: "customer phone (E.164 normalised, with a `+91` prefix affordance)".

          `+91` typed by hand is still accepted — `normalisePhone` collapses all six
          spellings server-side — but the adornment means it does not have to be.
        */}
        <Input
          label="Mobile number"
          prefix="+91"
          inputMode="tel"
          autoComplete="off"
          placeholder="98765 43210"
          value={customerPhone}
          onChange={(event) => setCustomerPhone(event.target.value)}
          error={
            customerPhone.trim() !== '' && !phoneValid
              ? 'Enter a 10-digit Indian mobile number.'
              : undefined
          }
          hint="The bill goes here, and the purchase attaches to this number."
        />

        <Input
          label="Note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Optional — printed on the invoice"
          maxLength={500}
        />
      </Card>

      <ItemList
        items={state.items}
        results={results}
        errors={errors}
        onAdd={() => dispatch({ type: 'ADD_ITEM', id: newId() })}
        onChange={(id, patch) => dispatch({ type: 'UPDATE_ITEM', id, patch })}
        onRemove={(id) => dispatch({ type: 'REMOVE_ITEM', id, replacementId: newId() })}
        onDuplicate={(id) => {
          const copyId = newId();
          const source = extras[id];
          if (source) setExtra(copyId, source);
          dispatch({ type: 'DUPLICATE_ITEM', id, newId: copyId });
        }}
        renderExtra={(item) => (
          <div className="flex flex-col gap-4 border-t border-line pt-4">
            {products.length > 0 && (
              <Select
                label="Load from product"
                value=""
                onChange={(event) => loadProduct(item.id, event.target.value)}
              >
                <option value="">Choose a piece from the catalogue…</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </Select>
            )}

            <div className="grid grid-cols-2 gap-4">
              {/* §8.3: "Hallmark / HUID / BIS numbers per item where present." */}
              <Input
                label="HUID"
                value={extras[item.id]?.hallmarkNo ?? ''}
                onChange={(event) =>
                  setExtra(item.id, { hallmarkNo: event.target.value })
                }
                placeholder="Optional"
                maxLength={40}
                autoComplete="off"
              />
              <Input
                label="BIS number"
                value={extras[item.id]?.bisCertNo ?? ''}
                onChange={(event) => setExtra(item.id, { bisCertNo: event.target.value })}
                placeholder="Optional"
                maxLength={40}
                autoComplete="off"
              />
            </div>
          </div>
        )}
      />

      {error && (
        <p
          role="alert"
          className="rounded-field bg-down/10 px-4 py-2 text-small text-down"
        >
          {error}
        </p>
      )}

      {/* §8.1: "Live grand total in a sticky bar." The same StickyBar the calculator and
          the product page use, so the footer clears it without a magic number. */}
      <StickyBar>
        <div className="flex flex-1 flex-col">
          <span className="text-small text-muted">
            {state.items.length} {state.items.length === 1 ? 'item' : 'items'}
          </span>
          <span
            className="text-h2 font-semibold text-ink tabular"
            data-testid="bill-total"
          >
            {total ? formatINR(total.grandTotal) : '—'}
          </span>
        </div>

        <Button
          variant="accent"
          size="lg"
          loading={busy}
          disabled={!canGenerate}
          onClick={() => void generate()}
        >
          Generate
        </Button>
      </StickyBar>
    </div>
  );
}
