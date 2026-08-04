# PHASE 2 — Design System

**Goal:** build the component library and shell so every later phase composes instead of
styling. Mobile-first, whitespace-heavy, soft rounded edges.

**Agents:** DESIGN → DEV → TEST

---

## Design intent

Airbnb and Headout, adapted for Indian jewellery retail. Warm neutral base, one taupe accent,
near-black text, no heavy chrome. Rounded photo cards, pill buttons, soft shadows, and — most
importantly — a lot of empty space.

**The governing rule: when a screen feels cramped, add padding. Never shrink text.**
Whitespace is what makes a jewellery site read as premium. A dense layout reads as a
marketplace.

---

## DEV checklist

### 2.1 Tokens

- [ ] Port MASTER-SPEC §3 into `tailwind.config.ts`: colours, radii, shadow.
- [ ] Restrict the spacing scale to 4/8/16/24/32/48/64 by overriding Tailwind's default
      scale. Arbitrary values should be hard to reach by accident.
- [ ] Type scale in `globals.css` as CSS custom properties.
- [ ] Font via `next/font` — Inter or General Sans. `display: swap`.
- [ ] Verify `muted` (#8A817C) on `cream` (#FAF7F4) hits 4.5:1. **It is borderline —
      measure it.** If it fails, darken to #756C66 and update the token everywhere.

### 2.2 Primitives — `components/ui/`

Each with variants, `forwardRef`, and full a11y attributes.

- [ ] `Button` — variants `primary` (ink) / `accent` (taupe) / `ghost` / `outline`; sizes sm
      44px / md 52px / lg 56px; loading spinner state; `disabled` visually distinct, not just
      faded.
- [ ] `Card` — radius 24px, white, soft shadow, **no border**. Optional `interactive` prop
      adding a lift on hover/press.
- [ ] `Input` — radius 16px, 52px tall, floating or top label, error text slot, `inputMode`
      prop (critical for mobile numeric entry).
- [ ] `Select` — native `<select>` styled. Do not build a custom listbox; native is better on
      mobile and free a11y.
- [ ] `Toggle` / `SegmentedControl` — the pill switcher for 22K / 18K / Silver. Animated
      thumb via `transform` only. Arrow-key navigable.
- [ ] `Sheet` — bottom sheet, radius 32px top corners, drag-to-dismiss, focus trap, `Esc` to
      close, background scroll lock.
- [ ] `Badge`, `Skeleton`, `Toast`, `EmptyState`, `Spinner`.
- [ ] `ImageFrame` — wraps `next/image` with radius, aspect ratio, blur placeholder, and a
      **branded empty state when `url` is null**. Client has no real photos yet; every image
      slot must look intentional while empty, not like a broken page.

### 2.3 Shell

- [ ] `AppHeader` — transparent over hero, solid cream on scroll. Logo, search icon, account
      icon. 56px mobile / 72px desktop.
- [ ] `BottomNav` — mobile only, fixed, `backdrop-blur`, 5 items (Home · Rates · Calculator ·
      Orders · Account), active item in taupe.
      `padding-bottom: env(safe-area-inset-bottom)` — without it the nav sits under the
      iPhone home indicator.
- [ ] `Footer` — links, BIS/hallmark trust strip, contact, WhatsApp button.
- [ ] `Container` — max 1200px, gutters 20px mobile / 40px desktop.
- [ ] `Section` — vertical rhythm 48px mobile / 80px desktop, optional eyebrow + heading +
      "See all" link.

### 2.4 Motion

- [ ] Transitions 150–250ms, `cubic-bezier(0.4, 0, 0.2, 1)`.
- [ ] Animate `transform` and `opacity` only. No layout-triggering properties.
- [ ] Respect `prefers-reduced-motion` — this must also disable the rate ticker animation in
      Phase 4.
- [ ] Press states use `scale(0.98)`. Mobile has no hover; it needs press feedback instead.

### 2.5 Component gallery

- [ ] Route `/__design` (dev-only, blocked in production proxy) rendering every component in
      every state. This is how DESIGN audits without clicking through the whole app.

---

## Dependencies added

`clsx` · `tailwind-merge` · `class-variance-authority` · `lucide-react` · `vaul` (bottom
sheet) · `sonner` (toast)

---

## TEST

- [ ] Render test per primitive, all variants.
- [ ] Keyboard: Tab order correct, focus rings visible, `Esc` closes Sheet.
- [ ] Focus trap actually traps — Tab from the last element returns to the first.
- [ ] Playwright at 375 / 768 / 1280 on `/__design`: no horizontal scroll at any width.
- [ ] Automated contrast check on token pairs.
- [ ] Every tap target ≥ 44×44px, asserted programmatically.
- [ ] `/__design` returns 404 with `NODE_ENV=production`.

---

## DESIGN audit

- [ ] Every screen reviewed at 375px **first**.
- [ ] No hardcoded hex, no arbitrary radius, no off-scale spacing anywhere.
- [ ] Empty `ImageFrame` looks deliberate.
- [ ] Reduced-motion mode is genuinely calm, not partially animated.

---

## Acceptance criteria

1. `/__design` shows the full library, dev-only.
2. Zero hardcoded colours or spacing outside tokens.
3. No horizontal scroll at 375px anywhere.
4. Contrast and tap-target tests pass.
5. Bottom nav clears the iOS home indicator on a real device or simulator.
