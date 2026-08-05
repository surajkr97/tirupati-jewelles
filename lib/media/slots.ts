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
}

export const MEDIA_SLOTS: SlotDefinition[] = [
  {
    key: 'HERO_BANNER',
    label: 'Homepage hero',
    where: 'The big image at the top of the homepage',
    recommended: '1600×900',
    ratio: '16/9',
    supportsText: true,
  },
  {
    key: 'OFFER_STRIP',
    label: 'Offer strip',
    where: 'Below the hero, above the rates',
    recommended: '1200×400',
    ratio: '3/1',
    supportsText: true,
  },
  ...Array.from({ length: 6 }, (_, index) => ({
    key: `CATEGORY_TILE_${index + 1}`,
    label: `Category tile ${index + 1}`,
    where: 'The collections grid on the homepage',
    recommended: '800×800',
    ratio: '1/1',
    supportsText: false,
  })),
  {
    key: 'FEATURE_BANNER',
    label: 'Feature banner',
    where: 'Mid homepage',
    recommended: '1200×600',
    ratio: '2/1',
    supportsText: true,
  },
  {
    key: 'ABOUT_IMAGE',
    label: 'About image',
    where: 'The about page',
    recommended: '1200×800',
    ratio: '3/2',
    supportsText: false,
  },
  {
    key: 'FOOTER_BG',
    label: 'Footer background',
    where: 'Behind the footer',
    recommended: '1600×400',
    ratio: '4/1',
    supportsText: false,
  },
];

export const SLOT_BY_KEY = new Map(MEDIA_SLOTS.map((slot) => [slot.key, slot]));

export function isKnownSlot(key: string): boolean {
  return SLOT_BY_KEY.has(key);
}
