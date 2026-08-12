# PHASE 4 — Rates Engine & Homepage Ticker

**Goal:** admin-controlled metal rates, cached in Redis, displayed in a live-feel ticker.
**This is flagship feature #1 — the thing people open the site for.**

**Agents:** DEV → DESIGN → TEST → SECURITY

---

## Read this before writing code

Two rate values exist in this system and they must never be confused:

|                  | Source                                      | Used for                                               |
| :--------------- | :------------------------------------------ | :----------------------------------------------------- |
| **True rate**    | `MetalRate` table → Redis                   | calculator, bills, product prices, anything with money |
| **Display rate** | true rate ± random jitter, client-side only | the homepage ticker animation, nothing else            |

The jitter value lives in React state inside one component and **is never passed to any other
component, never sent to an API, never persisted.** If you find yourself passing it as a
prop, you have made a mistake.

The client asked for ±₹101–199 movement each second for a live-market feel. That is
implemented, with a config flag to disable it and a visible "indicative rate" disclaimer.
Showing a price you won't transact at carries real exposure under Indian consumer-protection
rules — the disclaimer and the working off-switch are the mitigation. Keep both functional.

---

## DEV checklist

### 4.1 Rate service — `lib/rates.ts`

- [ ] `getCurrentRates(): Promise<Rates>` — cache-aside on `rates:current`, TTL 300s, falling
      back to the latest `MetalRate` row per purity.
- [ ] `setRate({ metal, purity, ratePerGram, userId })` — insert a **new row** (never update —
      rate history is an audit trail), then:
  - `redis.del('rates:current')`
  - `redis.zadd('rates:history:{metal}:{purity}', now, rate)`
  - `revalidateTag('rates')`
  - write an `AuditLog` entry
- [ ] `getRateHistory(metal, purity, days)` for the sparkline.
- [ ] Conversion helpers, and **only here**: `perGramToPer10g()`, `perGramToPerKg()`, and the
      inverses for admin input.
- [ ] Shape:

```ts
type Rates = {
  gold22: { perGram: bigint; per10g: bigint; effectiveAt: string };
  gold18: { perGram: bigint; per10g: bigint; effectiveAt: string };
  silver999: { perGram: bigint; perKg: bigint; effectiveAt: string };
};
```

### 4.2 API

```
GET  /api/rates            public, Cache-Control: s-maxage=300
GET  /api/rates/history    public, ?metal=&purity=&days=
POST /api/admin/rates      ADMIN only
```

- [ ] Admin POST accepts the **display unit** (₹ per 10g for gold, ₹ per kg for silver)
      because that is how the shop thinks. Convert to per-gram paise on save. This is the one
      place unit conversion happens on input.
- [ ] Sanity guard: reject a new rate more than 20% from the previous one unless
      `confirmed: true` is passed. A fat-fingered extra zero on a gold rate is the most
      damaging typo available in this app.

### 4.3 The ticker component

`components/rates/RateTicker.tsx` — client component.

- [ ] Receives true rates as props from the ISR'd server page. Does **not** fetch on mount —
      the first paint must already show real numbers.
- [ ] Refetches the true rate every 5 minutes via SWR to stay current.
- [ ] Jitter loop, when `NEXT_PUBLIC_TICKER_JITTER === 'true'`:
  - every 3000ms, pick delta = ±(101–199) rupees on the per-10g value
    (was 1000ms; the owner reset the cadence in Stage 6 — one second read as a stock ticker)
  - random direction; track it for colour
  - the _displayed_ number drifts around the true rate but must **stay within ±₹199 of it**
    — bound it. Unbounded random walk will wander to absurd numbers within a few minutes of
    an open tab.
    (Was ±2%, reset to a flat ±₹199 by the owner in Stage 6: 2% of ₹1,18,420 is ₹2,368, and
    the consumer-protection exposure in MASTER-SPEC §8 is a gap in rupees, not in percent.
    The walk reflects off the band edges rather than clamping, or it would visibly freeze
    there — see `lib/ticker-jitter.ts`.)
- [ ] Up → `text-up` + ▲ ; down → `text-down` + ▼. Brief background tint pulse on change,
      fading over 400ms.
- [ ] Number transitions use tabular-num and a slide animation on changed digits only — not
      the whole number. Prevents the layout jitter that makes cheap tickers look broken.
- [ ] `prefers-reduced-motion` → no jitter at all, static true rate.
- [ ] Pause the interval when the tab is hidden (`visibilitychange`). A tab left open
      overnight should not burn a timer 30,000 times.
- [ ] Clean up the interval on unmount. React strict mode will double-invoke the effect —
      verify no leaked timers.

### 4.4 Ticker UI

The homepage centrepiece.

- [ ] Segmented control: `Gold 22K` · `Gold 18K` · `Silver 999`. Large, pill-shaped, animated
      thumb, thumb-reachable at the bottom of the card on mobile.
- [ ] Selected metal shown large: 40px+ semibold, tabular numerals.
- [ ] Unit label beneath: `per 10 grams` / `per 1 kilogram`.
- [ ] Delta line: `▲ ₹142 (0.21%)` in up/down colour.
- [ ] 7-day sparkline from history — thin line, no axes, no grid, no labels. Decoration, not
      a chart.
- [ ] Footer of card, always visible, muted 13px:
      `Indicative rate · Updated 11:42 AM · Final price confirmed in store.`
- [ ] Card: white, radius 24px, generous padding (24px mobile / 32px desktop), soft shadow,
      no border.
- [ ] Skeleton state matching final dimensions exactly — zero layout shift.

### 4.5 Homepage

- [ ] `export const revalidate = 300`
- [ ] Order: hero (MediaSlot `HERO_BANNER`) → **rate ticker** → offer strip (`OFFER_STRIP`) →
      categories → featured products → calculator CTA → trust strip (BIS / hallmark /
      certification) → footer.
- [ ] Ticker sits above the fold on a 375px screen. It is the reason people visit; it does
      not go below a marketing banner.
- [ ] Every image slot renders the branded empty `ImageFrame` until the admin supplies a URL.

### 4.6 `/rates` page

- [ ] All three rates as cards, stacked on mobile.
- [ ] History table: date, rate, change. Last 30 days.
- [ ] "Rates last updated" timestamp, prominent.
- [ ] Same disclaimer as the ticker card.

---

## Dependencies added

`swr` · _(sparkline hand-rolled SVG — ~30 lines, avoids a 100kb charting dependency for one
decorative line)_

---

## TEST

- [ ] Unit: `perGramToPer10g` / `perGramToPerKg` round-trip without drift.
- [ ] Unit: jitter band — simulate 10,000 ticks, assert the display value never exits ±₹199 of
      the true rate.
- [ ] Unit: sanity guard rejects a 10× rate without `confirmed`.
- [ ] Integration: `setRate` → Redis key deleted → `getCurrentRates` returns the new value.
- [ ] Integration: `/api/rates` served from cache on the second call (assert via a DB query
      spy, not by timing).
- [ ] **Critical:** admin sets rate → open the calculator → assert the calculator uses the
      true rate, not a jittered one. Run this test with jitter enabled.
- [ ] Redis down → `/api/rates` still returns correct data from Postgres.
- [ ] E2E: ticker visible above the fold at 375×667.
- [ ] E2E: toggle switches metal without a layout shift (assert CLS ≈ 0).
- [ ] E2E: `NEXT_PUBLIC_TICKER_JITTER=false` → value stays constant across 10s.
- [ ] E2E: reduced-motion → no jitter.
- [ ] Memory: mount/unmount the ticker 100× → no growing timer count.

---

## SECURITY

- [ ] `POST /api/admin/rates` rejects non-admin with 404.
- [ ] Rate input Zod-validated: positive, bounded, integer paise after conversion.
- [ ] Every rate change writes an `AuditLog` with actor and IP.
- [ ] Client cannot influence the stored rate through any public route.

---

## DESIGN

- [ ] Ticker is the visual anchor of the homepage.
- [ ] Colour is not the only up/down signal — arrows carry it too (colour-blind users).
- [ ] Disclaimer readable, not hidden in 10px grey.
- [ ] Toggle reachable one-handed at 375px.

---

## Acceptance criteria

1. Admin sets rates; site reflects them within one revalidation window.
2. Ticker animates convincingly, clamped, colour-correct.
3. Jitter is provably display-only — the calculator test proves it.
4. Off-switch works.
5. Disclaimer always visible.
6. No layout shift, no timer leaks.
