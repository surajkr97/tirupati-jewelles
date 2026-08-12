/**
 * Every navigation destination in the application, in one place.
 * Created by the UI redesign, Stage 2.
 *
 * ── Why a registry rather than arrays inside each nav component ──
 *
 * The audit found two navigation defects that a registry makes structurally impossible.
 *
 * The first is dead links. `components/shell/footer.tsx` carried `/policies/privacy` and
 * `/policies/terms` from Phase 2 and **both 404'd until §9.6 wrote the pages** — three
 * phases of every storefront page linking to nothing. Phase 6 hit the identical bug in the
 * trust block and added an E2E that fetched every link IN THE TRUST BLOCK, which is why the
 * footer's copy of it survived: the test knew about one component, not about links.
 *
 * `lib/navigation.test.ts` resolves every href here against the real `app/` directory. A
 * destination that does not exist is a unit-test failure in milliseconds, and it cannot be
 * missed by adding a link somewhere the test was not looking.
 *
 * The second is the opposite — routes that exist and are in no menu. `/admin/settings` and
 * `/admin/audit` were reachable only via a card on the dashboard. Listing destinations as
 * data makes "is this route in a menu?" answerable.
 *
 * ── Scope ──
 *
 * Primary WAYFINDING only: the header, the bottom nav, the admin shell. Contextual links —
 * a product card, a "back to bills" on one page — stay where they are. This is the map, not
 * every road.
 */
import {
  Calculator,
  ClipboardList,
  Home,
  Image as ImageIcon,
  LayoutDashboard,
  LayoutGrid,
  Package,
  ReceiptText,
  ScrollText,
  Settings,
  TrendingUp,
  User,
} from 'lucide-react';

import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Longer label for the sidebar, where there is room and ambiguity is costlier. */
  description?: string;
  /**
   * A shorter label for the mobile bottom bar, where a cell is ~57px at 320px.
   *
   * "Bills & orders" wraps to two lines there, and the second line falls out of the 64px
   * row — pushing the icon up and leaving the item visibly broken next to its neighbours.
   * Measured, not guessed. The full label is what the rail and the drawer show, because
   * both have the room and both are where someone goes looking.
   */
  shortLabel?: string;
}

/**
 * Desktop header — the storefront's primary destinations.
 *
 * Home is deliberately absent: the wordmark is the home link, which is the convention every
 * visitor already knows, and repeating it would spend a nav slot on something nobody looks
 * for in a menu. The bottom nav DOES carry Home, because a phone has no persistent wordmark
 * once the header scrolls away.
 */
export const STOREFRONT_PRIMARY: readonly NavItem[] = [
  { href: '/rates', label: 'Rates', icon: TrendingUp },
  { href: '/calculator', label: 'Calculator', icon: Calculator },
  { href: '/collections', label: 'Collections', icon: LayoutGrid },
] as const;

/**
 * The mobile menu's secondary destinations, below the primary set.
 *
 * `/search` is here rather than in the primary list because the header already carries a
 * search icon at every breakpoint; this is the labelled route to the same place for anyone
 * who did not read the icon.
 */
export const STOREFRONT_SECONDARY: readonly NavItem[] = [
  { href: '/search', label: 'Search', icon: LayoutGrid },
  { href: '/account/orders', label: 'Your orders', icon: ReceiptText },
  { href: '/account', label: 'Account', icon: User },
] as const;

/**
 * Mobile bottom navigation — unchanged from Phase 2 §2.3, which chose these five.
 *
 * Moved here rather than restructured: the audit found the bottom nav to be one of the few
 * things that was already right, including the safe-area handling and the spacer that keeps
 * it off the footer. Only the source of the list changed.
 */
export const BOTTOM_NAV: readonly NavItem[] = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/rates', label: 'Rates', icon: TrendingUp },
  /**
   * `shortLabel` because five labels do not fit at 320px and this is the one that breaks it.
   *
   * Measured rather than assumed: at 11px, "Calculator" needs 78px of text in a cell that is
   * 64px wide when five share the bar. `flex-1` cannot shrink past min-content, so the row
   * overflowed the viewport by 2.2px — the same arithmetic that made the admin bar say
   * "Bills" instead of "Bills & orders" in Stage 5A, and the reason `shortLabel` exists.
   *
   * "Price" rather than a truncation: it is the shop's own verb for this page — `/rates`
   * ends on "Price a piece at this rate" — and a clipped "Calculat…" is worse than a shorter
   * true word. The full label stays everywhere the space exists.
   */
  { href: '/calculator', label: 'Calculator', shortLabel: 'Price', icon: Calculator },
  { href: '/account/orders', label: 'Orders', icon: ReceiptText },
  { href: '/account', label: 'Account', icon: User },
] as const;

/**
 * Admin — the four destinations a jeweller touches daily.
 *
 * These are the bottom nav on a phone (§7.1: "standing in a shop, between customers") and
 * the top of the sidebar on a desktop.
 */
export const ADMIN_PRIMARY: readonly NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, description: 'Today at a glance' },
  { href: '/admin/rates', label: 'Rates', icon: TrendingUp, description: "Set today's rate" },
  { href: '/admin/products', label: 'Products', icon: Package, description: 'Catalogue' },
  {
    href: '/admin/bills',
    // "Bills & orders", because that is what the page is. There is no /admin/orders:
    // an Order row is written by `lib/bills/create.ts` when a bill is built, so the bill
    // IS the order from the shop's side. Labelling it "Orders" and pointing it at /admin/bills
    // would be honest about the destination and dishonest about the name; labelling it
    // "Bills" alone hides where orders live. See specs/ROUTE-MAP.md and DEBT-004.
    label: 'Bills & orders',
    shortLabel: 'Bills',
    icon: ReceiptText,
    description: 'Invoices and orders',
  },
] as const;

/**
 * Admin — everything else. The phone reaches these through "More"; the sidebar shows them.
 *
 * **There is no `/admin/orders`, and one is not invented here.** The Stage 2 brief lists
 * "Orders" as an admin destination, but a customer Order is CREATED BY a bill — `lib/bills/
 * create.ts` writes the `Order` row — and the admin's view of orders is `/admin/bills`.
 * Adding a menu entry for a route that does not exist is the exact defect this file was
 * written to prevent, so `Bills` above is labelled "Bills and orders" instead.
 * See UI_REDESIGN_DEBT-004.
 */
export const ADMIN_SECONDARY: readonly NavItem[] = [
  { href: '/admin/categories', label: 'Collections', icon: LayoutGrid, description: 'Categories' },
  { href: '/admin/media', label: 'Media', icon: ImageIcon, description: 'Site images' },
  { href: '/admin/settings', label: 'Settings', icon: Settings, description: 'Shop details' },
  { href: '/admin/audit', label: 'Audit log', icon: ScrollText, description: 'Who changed what' },
] as const;

export const ADMIN_ALL: readonly NavItem[] = [...ADMIN_PRIMARY, ...ADMIN_SECONDARY];

/**
 * The complete admin menu, in the order the mobile drawer shows it.
 *
 * Stage 5 §11 requires the phone's menu to expose EVERY destination plus the way back to the
 * shop, rather than only the four the bottom bar could not fit. `ADMIN_ALL` is that list;
 * `BACK_TO_SITE` is appended by the component so the exit is always last.
 */
export const ADMIN_MENU: readonly NavItem[] = ADMIN_ALL;

/** The way out of the admin. Its absence was audit finding C-6. */
export const BACK_TO_SITE: NavItem = {
  href: '/',
  // "shop", not "site" — this is a jeweller's admin, and the thing they are going back to
  // is the shop their customers see. Stage 5 §9 asks for exactly this label.
  label: 'Back to shop',
  icon: Home,
};

/** Storefront shortcut shown to admins on /account, so /admin is never typed. Finding C-3. */
export const ADMIN_SHORTCUT: NavItem = {
  href: '/admin',
  label: 'Admin dashboard',
  icon: ClipboardList,
};

/**
 * Is `href` the current page?
 *
 * Exact for roots, prefix for sections. `/account` must not light up while on
 * `/account/orders` — Phase 2 got this right and the logic is preserved verbatim, now in one
 * place instead of two copies that could drift.
 */
export function isActiveHref(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  if (href === '/account') return pathname === '/account';
  if (href === '/admin') return pathname === '/admin';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Every href this module publishes, for the dead-link test. */
export function allNavHrefs(): string[] {
  return [
    ...STOREFRONT_PRIMARY,
    ...STOREFRONT_SECONDARY,
    ...BOTTOM_NAV,
    ...ADMIN_ALL,
    BACK_TO_SITE,
    ADMIN_SHORTCUT,
  ].map((item) => item.href);
}
