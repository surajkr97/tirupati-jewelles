# PHASE 5 — Multi-Item Price Calculator

**Goal:** anyone — customer or admin — prices several pieces at once and gets one total.
**Flagship feature #2.** In Phase 8 this same engine becomes the billing tool, so build it to
be reused, not copy-pasted.

**Agents:** DEV → TEST → DESIGN

---

## The core rule

`lib/pricing.ts` is the **only** place jewellery money is calculated. The calculator UI, the
product page, and the Phase 8 bill generator all call it. Three implementations of GST
rounding is three different totals on the same purchase, and the customer will find it.

The server recomputes every total independently. A client-submitted total is display-only and
is discarded on arrival.

---

## DEV checklist

### 5.1 Pricing engine — `lib/pricing.ts`

```ts
export type LineInput = {
  metal: 'GOLD' | 'SILVER';
  purity: 'K22_916' | 'K18_750' | 'SILVER_999';
  weightMg: number; // integer milligrams
  makingPct: number; // 0–100
  stoneCharge: bigint; // paise
  gstPct: number; // default 3
};

export type LineResult = {
  metalValue: bigint;
  makingCharge: bigint;
  stoneCharge: bigint;
  subtotal: bigint;
  gstAmount: bigint;
  lineTotal: bigint;
};

export function calculateLine(input: LineInput, ratePerGram: bigint): LineResult;
export function calculateTotal(
  lines: LineInput[],
  rates: Rates,
): {
  lines: LineResult[];
  subtotal: bigint;
  totalGst: bigint;
  grandTotal: bigint;
};
```

- [ ] Pure functions. No I/O, no clock, no randomness. Fully unit-testable.
- [ ] All arithmetic in `bigint` paise.
- [ ] Round **once**, at `lineTotal`, banker's rounding to nearest paise. Never round
      intermediates — that is the source of ₹1 mismatches between the on-screen total and the
      printed bill.
- [ ] `grandTotal` = sum of rounded `lineTotal`s, so the bill's line items visibly add up to
      its total. A total that doesn't equal the sum of its lines destroys trust instantly.
- [ ] Reject negative or non-finite inputs by throwing. Do not clamp silently.

### 5.2 GST note for the developer

Indian jewellery attracts 3% GST (1.5% CGST + 1.5% SGST intra-state, or 3% IGST
inter-state). Making charges are included in the taxable value here.

- [ ] Default `gstPct = 3`, admin-configurable in settings.
- [ ] The bill shows the CGST/SGST split; the calculator shows a single 3% line.
- [ ] Note in code that GST treatment of making charges has been contested and the client
      should confirm with their CA. **Flag it in DEBT.md — do not present the split as tax
      advice.**

### 5.3 Calculator state

- [ ] `useReducer`, not a pile of `useState`. Actions: `ADD_ITEM`, `REMOVE_ITEM`,
      `UPDATE_ITEM`, `DUPLICATE_ITEM`, `CLEAR_ALL`, `SET_GLOBAL_GST`.
- [ ] Item shape: `{ id, label, metal, purity, weightGrams, makingPct, stoneCharge, gstPct }`.
- [ ] Persist to `sessionStorage` on change; restore on mount. Someone pricing eight items who
      accidentally refreshes should not lose the work.
- [ ] Max 20 items; explain the limit rather than silently ignoring the add.
- [ ] Debounce recalculation by 150ms while typing.

### 5.4 Calculator UI — `/calculator`

Rendered CSR inside a static shell. Rates fetched once on mount from `/api/rates`, then held.

**Item card** — one per piece, radius 24px, white, generous padding:

- [ ] Optional name field, placeholder `Item 1`.
- [ ] Metal/purity segmented control: `22K` · `18K` · `Silver`.
- [ ] Weight: numeric, `inputMode="decimal"`, unit suffix `g`, 3 decimals.
- [ ] Making charge: numeric with `%` suffix, plus quick-pick chips (8% · 10% · 12% · 15%) —
      most shops use a small set of standard rates and chips beat typing on mobile.
- [ ] Stone/other charges: optional ₹ field, collapsed by default.
- [ ] Per-item breakdown, collapsed by default, expanding to show metal value → making →
      stones → GST → total.
- [ ] Remove (trash) and duplicate icons. Duplicate matters — pricing four similar bangles is
      the common case.

**Add control**

- [ ] Prominent `+ Add another item` button below the last card, full width, dashed outline.

**Sticky total bar**

- [ ] Fixed to the bottom above the nav, `backdrop-blur`.
- [ ] Grand total, large and tabular. Item count. Chevron to expand a full breakdown sheet.
- [ ] Buttons: `Share` (Web Share API → falls back to copy) and, **for admins only**,
      `Create Bill` — which carries the state into Phase 8.
- [ ] Animate the total on change with a brief count-up. Under 300ms — long count-ups read as
      slow, not delightful.

**Empty state**

- [ ] One item card pre-added. Never an empty screen with a lone add button.

### 5.5 Shareable results

- [ ] `POST /api/calculator/share` → stores the item set, returns a short slug.
- [ ] `/calculator/s/[slug]` → SSR, recomputes with rates **snapshotted at share time**, so a
      shared link doesn't silently change price. Show the snapshot date.
- [ ] 30-day expiry.

### 5.6 Product page integration

- [ ] "Calculate with current rates" on a product page preloads the calculator with that
      product's metal, purity, weight, and making %.

---

## TEST — the most test-critical phase

Money bugs here become customer disputes.

- [ ] **Golden-file tests:** 20 hand-computed cases in a fixture file, verified independently
      with a spreadsheet. If code and fixture disagree, the fixture is right until proven
      otherwise.
- [ ] Zero weight → zero total, no crash, no NaN.
- [ ] Weight 0.001g and 99999g.
- [ ] Making 0% and 100%.
- [ ] Negative weight → throws.
- [ ] `'abc'` in a numeric field → rejected at the Zod boundary.
- [ ] **Rounding:** construct a case landing exactly on a half-paise boundary; assert banker's
      rounding.
- [ ] **Sum invariant:** for 100 random item sets, assert `grandTotal === sum(lineTotals)`
      exactly. This is the property that must never break.
- [ ] 20 items → correct total, no perf degradation.
- [ ] `sessionStorage` restore after refresh.
- [ ] Shared link recomputes to an identical total.
- [ ] Client sends a tampered total → server discards it and returns its own.
- [ ] E2E at 375px: add 3 items, change purity on one, remove one, verify total by independent
      calculation in the test.
- [ ] Verify the calculator uses the **true** rate while the ticker is jittering.

---

## DESIGN

- [ ] One item card fits comfortably at 375px without scrolling internally.
- [ ] Numeric keyboards appear for every numeric field — check on a real device.
- [ ] Sticky bar never covers the last item's inputs (bottom padding on the list must exceed
      the bar height).
- [ ] Total is the most visually prominent element on the screen.

---

## Acceptance criteria

1. Multiple items, one total, correct to the paise.
2. Sum invariant holds under property testing.
3. Rounding matches hand-computed golden files.
4. Server authoritative; client totals discarded.
5. Works one-handed at 375px.
6. Shared links stable over time.
