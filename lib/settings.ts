/**
 * Shop settings that affect money.
 * Created by Phase 9 (DEBT-024).
 *
 * Phase 7 §7.9 gave the owner `defaultGstPct` and `defaultMakingPct`, Phase 8 read
 * `billPrefix` and the shop identity block onto the invoice — and these two were still
 * written and never read. Every pricing surface used MASTER-SPEC §4's hardcoded 3%, so the
 * settings screen made a promise the application did not keep.
 *
 * ── Why this could not be wired before ──
 * DEBT-001. Until the client's CA confirmed that making charges sit inside the taxable
 * value, the GST *base* was an open question, and making the *rate* configurable while the
 * base was contested would have produced bills that were wrong in two independent ways.
 * DEBT-001 is closed, so the base is settled and the rate is safe to move.
 *
 * ── The split between the two fields, which is not symmetric ──
 * `defaultGstPct` is a **live** input to pricing: the storefront, the calculator and a bill
 * line with no explicit rate all read it, and changing it changes what every customer sees.
 * `defaultMakingPct` is only a **prefill**: a product carries its own `makingPct` column and
 * a bill line carries its own snapshot, so changing it must never reprice anything that
 * already exists. The schema comment says as much — "defaults for the calculator and new
 * products" — and this module keeps the two roles apart rather than treating them as a pair.
 */
import 'server-only';

import { revalidatePath } from 'next/cache';

import { db } from '@/lib/db';
import { clientEnv } from '@/lib/env';
import { RATE_SURFACES, RATE_SURFACE_PATTERNS } from '@/lib/rates';
import { cached, invalidate } from '@/lib/redis';

export interface PricingDefaults {
  /** Per cent. Live: priced into the storefront, the calculator and unspecified bill lines. */
  gstPct: number;
  /** Per cent. Prefill only: a new calculator line, a new bill line, a new product. */
  makingPct: number;
}

/**
 * What the application prices with when there is no Settings row.
 *
 * MASTER-SPEC §4 fixes GST at 3; 12 is the commonest of §5.4's making chips and matches
 * `prisma/schema.prisma`'s column defaults. Stated once here so the fallback cannot drift
 * from the schema, and exported because the tests assert exactly this pair.
 */
export const SPEC_PRICING_DEFAULTS: PricingDefaults = { gstPct: 3, makingPct: 12 };

export const PRICING_DEFAULTS_KEY = 'settings:pricing';

/** Matches the rates cache (§4.1). Settings change far less often than rates do. */
const TTL_SECONDS = 300;

/**
 * The shop's pricing defaults, cache-aside on Redis.
 *
 * Read on every product card, every catalogue page and every bill, so it is cached for the
 * same reason `getCurrentRates` is. `cached()` never throws — a Redis outage degrades to a
 * Postgres read, and a Postgres outage propagates, because a wrong GST rate is worse than
 * an error page.
 *
 * A `Decimal(5,2)` converts to a number losslessly at these magnitudes, and `calculateLine`
 * snaps the value to integer basis points before any money is touched (`lib/pricing.ts`),
 * so no float ever reaches a rupee.
 */
export async function getPricingDefaults(): Promise<PricingDefaults> {
  return cached(PRICING_DEFAULTS_KEY, TTL_SECONDS, async () => {
    const row = await db.settings.findUnique({
      where: { id: 'singleton' },
      select: { defaultGstPct: true, defaultMakingPct: true },
    });

    if (!row) return SPEC_PRICING_DEFAULTS;

    return {
      gstPct: clampPercent(row.defaultGstPct.toNumber(), SPEC_PRICING_DEFAULTS.gstPct),
      makingPct: clampPercent(
        row.defaultMakingPct.toNumber(),
        SPEC_PRICING_DEFAULTS.makingPct,
      ),
    };
  });
}

/**
 * Drop the cached defaults. Call after writing Settings, BEFORE revalidating any page —
 * a page regenerated first would read the stale value and cache it for its whole ISR
 * window. The same ordering `setRate` uses, and for the same reason.
 */
export async function invalidatePricingDefaults(): Promise<void> {
  await invalidate(PRICING_DEFAULTS_KEY);
}

/**
 * ISR'd routes whose HTML changes when a pricing default changes.
 *
 * The rate surfaces, because a GST rate is priced into every figure they show, plus
 * `/calculator` — which shows no rate server-side but now renders the prefill for a new
 * line. `/admin/*` is absent because the whole tree is `force-dynamic`.
 *
 * DEBT-014's lesson applies to this list exactly as it does to `RATE_SURFACES`: a surface
 * that renders a settings-derived figure and is not listed here serves a stale one for its
 * full ISR window. `lib/settings.test.ts` iterates the exported constant so a new surface
 * added without an entry fails a test rather than a customer.
 */
export const SETTINGS_SURFACES = [...RATE_SURFACES, '/calculator'] as const;

/**
 * Bust the cache and refresh every surface that prices with these figures.
 *
 * Ordering matters and is the same as `setRate`'s: invalidate first, revalidate second. A
 * page regenerated before the cache is dropped reads the old value and re-caches it, which
 * is the failure mode Phase 4 measured and D-012 records.
 */
export async function applyPricingDefaultsChange(): Promise<void> {
  await invalidatePricingDefaults();

  for (const path of SETTINGS_SURFACES) revalidatePath(path);
  // `type: 'page'` is what makes one call cover every product rather than one product.
  for (const pattern of RATE_SURFACE_PATTERNS) revalidatePath(pattern, 'page');
}

/**
 * Refuse a percentage the engine would throw on.
 *
 * `lib/pricing.ts` rejects negative, non-finite and >100 values by design, and it is called
 * on the render path of every product card. A settings row that somehow held one would take
 * the storefront down rather than mispricing it, so the value is bounded here at the read.
 * The admin form already validates on write (`app/admin/settings/actions.ts`); this guards
 * the rows that form did not write — a seed, a migration, a manual `psql` edit.
 */
function clampPercent(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) return fallback;
  return value;
}

// ───────────────────────────────────────────────────── the shop's contact number

/**
 * The number every `wa.me` link on the site points at. Phase 9 (DEBT-050).
 *
 * ── The defect this closes ──
 * §7.9 gave the owner an `ownerWhatsApp` field. The server action validated it, stored it,
 * and the settings screen read it back — and **not one surface that builds a WhatsApp link
 * ever looked at it.** The footer, the floating button, the product enquiry bar and the
 * policy enquiry button all read `NEXT_PUBLIC_OWNER_WA` straight from the environment. The
 * owner could change their number, watch it save, and every customer would keep messaging
 * the old one.
 *
 * That is DEBT-024's shape exactly, in the field that ticket did not sweep — and worse in
 * one respect: `NEXT_PUBLIC_*` is inlined at BUILD time, so the environment value cannot be
 * corrected by an env change alone. It needs a redeploy. Which is precisely the situation
 * §7.9 introduced the settings row to avoid.
 *
 * ── The env value stays as the fallback, deliberately ──
 * Not as a legacy path but as the answer for a shop that has never opened the settings
 * screen: `Settings` is a singleton that may not exist yet, and a missing row must not mean
 * a missing WhatsApp link on every page of the site.
 */
export interface ShopContact {
  /** Digits only, e.g. `919876543210` — the form `wa.me/{number}` requires. */
  ownerWhatsApp: string;
}

export const SHOP_CONTACT_KEY = 'settings:contact';

/**
 * The same rule `lib/env.ts` applies to `NEXT_PUBLIC_OWNER_WA`, applied to the stored value.
 *
 * The admin action strips non-digits (`replace(/\D/g, '')`) but does not check the LENGTH,
 * so `ownerWhatsApp: "12"` is a value the database will happily hold. Without this the
 * storefront would render `wa.me/12` on every page — a link that fails silently in
 * WhatsApp rather than erroring anywhere a developer would see. A malformed row falls back
 * to the environment, the same way a malformed percentage falls back in `clampPercent`.
 */
const WHATSAPP_DIGITS = /^\d{10,15}$/;

/**
 * The shop's WhatsApp number, cache-aside on Redis.
 *
 * Read on every page — the footer and the floating button are in the storefront layout —
 * so it is cached for the same reason the pricing defaults are, and `cached()` never throws:
 * a Redis outage degrades to one Postgres read.
 */
export async function getShopContact(): Promise<ShopContact> {
  return cached(SHOP_CONTACT_KEY, TTL_SECONDS, async () => {
    const row = await db.settings.findUnique({
      where: { id: 'singleton' },
      select: { ownerWhatsApp: true },
    });

    const stored = row?.ownerWhatsApp ?? '';
    return {
      ownerWhatsApp: WHATSAPP_DIGITS.test(stored)
        ? stored
        : clientEnv.NEXT_PUBLIC_OWNER_WA,
    };
  });
}

/** Drop the cached contact. Call BEFORE revalidating, for D-012's reason. */
export async function invalidateShopContact(): Promise<void> {
  await invalidate(SHOP_CONTACT_KEY);
}

/**
 * Bust the cache and refresh every page that renders the number.
 *
 * `revalidatePath('/', 'layout')` rather than a `SETTINGS_SURFACES`-style list, and the
 * difference matters: the footer and the floating button live in the storefront LAYOUT, so
 * the number is on every page in the group — including `/policies/*` and every product,
 * which no curated list would have remembered to include. Next's own documentation is
 * explicit that a layout path "invalidates the layout, all nested layouts beneath it, and
 * all pages beneath them", which is the whole storefront in one call.
 *
 * Broad on purpose. A number change is rare and a missed page is a customer messaging a
 * number the shop no longer answers.
 */
export async function applyShopContactChange(): Promise<void> {
  await invalidateShopContact();
  revalidatePath('/', 'layout');
}
