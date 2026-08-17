/**
 * Media slot definitions.
 * Created by Phase 7 (specs/07-admin-panel.md §7.6).
 *
 * §7.6: "This is what the client asked for repeatedly: **every image on the site
 * replaceable from the dashboard.**"
 *
 * The table below is §7.6's, verbatim. It is the single source of truth for which slots
 * exist, where they appear and what size to supply — the seed creates rows from the same
 * keys, so a slot cannot exist in the UI without existing in the database, or vice versa.
 */
import 'server-only';

export interface SlotDefinition {
  key: string;
  label: string;
  /** §7.6: "Where". Shown so the owner knows what they are changing. */
  where: string;
  /** §7.6: "Recommended" dimensions. */
  recommended: string;
  /** CSS aspect ratio for the preview, derived from the recommendation. */
  ratio: string;
  /** Slots where a headline and link make sense; a category tile is just an image. */
  supportsText: boolean;
  /**
   * Does anything actually render this slot today?
   *
   * Added by the UI redesign, Stage 5D, and it is a correction rather than a feature.
   * §7.6's table was written as a plan for eleven surfaces; two of them were built. Traced
   * through the repository rather than through the spec:
   *
   *   HERO_BANNER → `app/(app)/page.tsx` (image, headline, subtext, `isActive`)
   *   BILL_LOGO   → `lib/bills/logo.ts`, on every invoice
   *
   * and the other ten are read by nothing. The admin page told the owner each one appeared
   * somewhere specific — "Below the hero, above the rates", "Behind the footer", "The about
   * page", a page that does not exist at all (see specs/ROUTE-MAP.md). Uploading to them is
   * accepted, audited, stored, and invisible.
   *
   * The rows are NOT removed: they are seeded, they hold data an owner may already have put
   * there, and deleting a slot is a schema decision rather than a redesign one. What
   * changes is that the screen stops claiming they are live. UI_REDESIGN_DEBT-011.
   */
  live: boolean;
  /**
   * May this slot carry a looping background video behind its image?
   *
   * Only the hero. `HeroMedia` is the one component built for the poster-then-video
   * sequence, and a video is meaningless in a category tile or an invoice logo. Gating it
   * here rather than in the form means the admin action can refuse a video on a slot that
   * does not support one, instead of trusting the screen not to have offered it.
   */
  supportsVideo: boolean;
}

export const MEDIA_SLOTS: SlotDefinition[] = [
  {
    key: 'HERO_BANNER',
    label: 'Homepage hero',
    where: 'The big image at the top of the homepage',
    recommended: '1600×900',
    ratio: '16/9',
    supportsText: true,
    // The only slot with a video, and the only one whose component knows what to do with
    // one. Closes UI_REDESIGN_DEBT-001.
    supportsVideo: true,
    live: true,
  },
  {
    key: 'OFFER_STRIP',
    label: 'Offer strip',
    where: 'Not shown on the site yet',
    recommended: '1200×400',
    ratio: '3/1',
    supportsText: true,
    supportsVideo: false,
    live: false,
  },
  ...Array.from({ length: 6 }, (_, index) => ({
    key: `CATEGORY_TILE_${index + 1}`,
    label: `Category tile ${index + 1}`,
    // The homepage collections grid reads each collection's own image, not this slot.
    where: 'Not shown on the site yet',
    recommended: '800×800',
    ratio: '1/1',
    supportsText: false,
    supportsVideo: false,
    live: false,
  })),
  {
    key: 'FEATURE_BANNER',
    label: 'Feature banner',
    where: 'Not shown on the site yet',
    recommended: '1200×600',
    ratio: '2/1',
    supportsText: true,
    supportsVideo: false,
    live: false,
  },
  {
    key: 'ABOUT_IMAGE',
    label: 'About image',
    // There is no about page — specs/ROUTE-MAP.md, and D-060 records the decision not to
    // invent one. This slot has never had anywhere to appear.
    where: 'Not shown on the site yet',
    recommended: '1200×800',
    ratio: '3/2',
    supportsText: false,
    supportsVideo: false,
    live: false,
  },
  {
    key: 'FOOTER_BG',
    label: 'Footer background',
    where: 'Not shown on the site yet',
    recommended: '1600×400',
    ratio: '4/1',
    supportsText: false,
    supportsVideo: false,
    live: false,
  },
  /**
   * Added by Phase 8 (specs/08-billing-whatsapp.md §8.3: "Logo from a MediaSlot").
   *
   * §7.6's table has eleven slots and no logo, because nothing on the storefront rendered
   * one. The invoice does, and §8.3 says where it comes from — so the slot is created here
   * rather than the logo being hardcoded or pasted into Settings as a twelfth URL field
   * with none of §7.7's SSRF checking behind it.
   *
   * PNG or JPEG only, and the reason is a hard constraint rather than a preference: PDF
   * embeds those two and nothing else. WebP and AVIF are accepted by the slot's validator
   * and silently ignored by the invoice, so the recommendation says so.
   */
  {
    key: 'BILL_LOGO',
    label: 'Invoice logo',
    where: 'The top of every bill PDF',
    recommended: '600×200 (PNG or JPEG)',
    ratio: '3/1',
    supportsText: false,
    supportsVideo: false,
    live: true,
  },
];

export const SLOT_BY_KEY = new Map(MEDIA_SLOTS.map((slot) => [slot.key, slot]));

export function isKnownSlot(key: string): boolean {
  return SLOT_BY_KEY.has(key);
}

/**
 * May this slot store a looping background video?
 *
 * Read by `saveMediaSlot` as well as by the form, so a video posted directly to the action
 * for, say, `BILL_LOGO` is refused rather than stored somewhere nothing renders it. Defaults
 * to `false` for an unknown key, which cannot happen — `isKnownSlot` runs first — but a
 * permission helper that says "yes" when it does not recognise the subject is the wrong
 * shape regardless.
 */
export function slotSupportsVideo(key: string): boolean {
  return SLOT_BY_KEY.get(key)?.supportsVideo ?? false;
}
