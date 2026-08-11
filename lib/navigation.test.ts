/**
 * Stage 2: every navigation destination resolves to a route that exists.
 *
 * This is the regression test for a defect this repository has now shipped twice. The footer
 * linked `/policies/privacy` and `/policies/terms` from Phase 2 and both 404'd until §9.6
 * wrote the pages. Phase 6 hit the same bug in the trust block, fixed it there, and added an
 * E2E that fetched every link **in the trust block** — so the footer's copy survived another
 * three phases. A test that knows about one component cannot prevent a class of bug.
 *
 * This one does not look at components at all. It reads `lib/navigation.ts` — which every
 * nav renders from — and resolves each href against the real `app/` directory, so a menu
 * entry pointing at nothing fails in milliseconds and without a browser.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ADMIN_ALL,
  ADMIN_PRIMARY,
  ADMIN_SECONDARY,
  ADMIN_SHORTCUT,
  allNavHrefs,
  BACK_TO_SITE,
  BOTTOM_NAV,
  isActiveHref,
  STOREFRONT_PRIMARY,
} from '@/lib/navigation';

/**
 * Walk `app/` and collect every route a `page.tsx` publishes.
 *
 * Route groups — `(app)`, `(auth)` — are directories that do NOT appear in the URL, so they
 * are stripped. `%5F%5F` is the on-disk encoding of the `__design` dev route.
 */
function routesOnDisk(dir = join(process.cwd(), 'app'), prefix = ''): string[] {
  const routes: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);

    if (entry === 'page.tsx') {
      routes.push(prefix === '' ? '/' : prefix);
      continue;
    }
    if (!statSync(full).isDirectory()) continue;
    // Route groups are organisational only and contribute nothing to the URL.
    const segment = entry.startsWith('(') && entry.endsWith(')') ? '' : `/${entry}`;
    routes.push(...routesOnDisk(full, `${prefix}${segment}`));
  }

  return routes;
}

const ROUTES = routesOnDisk();

/** `/products/[slug]` matches `/products/anything`. */
function routeExists(href: string): boolean {
  const wanted = href.split('/').filter(Boolean);

  return ROUTES.some((route) => {
    const parts = route.split('/').filter(Boolean);
    if (parts.length !== wanted.length) return false;
    return parts.every(
      (part, i) => part.startsWith('[') || part === wanted[i],
    );
  });
}

describe('the route scanner itself works', () => {
  // A scanner that silently found nothing would make every assertion below vacuously pass.
  it('finds the routes we know exist, through their route groups', () => {
    expect(ROUTES).toContain('/');
    expect(ROUTES).toContain('/rates');
    expect(ROUTES).toContain('/account/orders');
    expect(ROUTES).toContain('/admin/settings');
    expect(ROUTES.length).toBeGreaterThan(15);
  });

  it('does not invent routes', () => {
    expect(routeExists('/admin/orders')).toBe(false);
    expect(routeExists('/about')).toBe(false);
    expect(routeExists('/contact')).toBe(false);
  });

  it('resolves a dynamic segment', () => {
    expect(routeExists('/products/some-slug')).toBe(true);
  });
});

describe('no dead links', () => {
  it.each(allNavHrefs().map((href) => [href]))(
    '%s resolves to a page that exists',
    (href) => {
      expect(routeExists(href)).toBe(true);
    },
  );

  it('every href is internal — no scheme, no protocol-relative', () => {
    for (const href of allNavHrefs()) {
      expect(href.startsWith('/')).toBe(true);
      expect(href.startsWith('//')).toBe(false);
      expect(href).not.toMatch(/^\/[\\]/);
    }
  });

  it('has no placeholder hrefs', () => {
    // brief §12: no `#`, no `/coming-soon`, no dead buttons.
    for (const href of allNavHrefs()) {
      expect(href).not.toBe('#');
      expect(href).not.toContain('coming-soon');
    }
  });
});

/**
 * The other direction, and the reason `/admin/settings` was hard to find: a route can exist,
 * render, and be in no menu at all.
 */
describe('every admin route is reachable from the admin navigation', () => {
  const adminHrefs = new Set(ADMIN_ALL.map((item) => item.href));

  it.each(
    ROUTES.filter(
      (route) =>
        route.startsWith('/admin') &&
        // Leaf and create pages are reached from their section, not from the top-level nav.
        !route.includes('[') &&
        !route.endsWith('/new'),
    ).map((route) => [route]),
  )('%s is in the admin nav', (route) => {
    expect(adminHrefs.has(route)).toBe(true);
  });

  it('C-5: settings and audit are in the navigation, not only on the dashboard', () => {
    expect(adminHrefs.has('/admin/settings')).toBe(true);
    expect(adminHrefs.has('/admin/audit')).toBe(true);
  });

  it('C-6: there is a route back to the storefront', () => {
    expect(BACK_TO_SITE.href).toBe('/');
  });

  it('C-3: admins have a link to the dashboard from the storefront', () => {
    expect(ADMIN_SHORTCUT.href).toBe('/admin');
  });

  it('does not list Orders, because /admin/orders does not exist', () => {
    // UI_REDESIGN_DEBT-004. An Order is created by a bill; /admin/bills is its view.
    expect(ADMIN_ALL.map((i) => i.href)).not.toContain('/admin/orders');
    expect(ADMIN_PRIMARY.find((i) => i.href === '/admin/bills')?.description).toContain(
      'orders',
    );
  });
});

describe('C-1: the desktop header exposes the primary storefront routes', () => {
  it.each([['/rates'], ['/calculator'], ['/collections']])(
    '%s is in the desktop header',
    (href) => {
      expect(STOREFRONT_PRIMARY.map((i) => i.href)).toContain(href);
    },
  );

  it('omits Home — the wordmark is the home link', () => {
    expect(STOREFRONT_PRIMARY.map((i) => i.href)).not.toContain('/');
  });
});

describe('isActiveHref', () => {
  it('matches the root exactly, never as a prefix', () => {
    expect(isActiveHref('/', '/')).toBe(true);
    expect(isActiveHref('/rates', '/')).toBe(false);
  });

  it('does not light up /account while on /account/orders', () => {
    // The bug Phase 2 wrote its comment about; preserved through the move into one place.
    expect(isActiveHref('/account/orders', '/account')).toBe(false);
    expect(isActiveHref('/account/orders', '/account/orders')).toBe(true);
    expect(isActiveHref('/account', '/account')).toBe(true);
  });

  it('does not light up /admin on every child route', () => {
    expect(isActiveHref('/admin/rates', '/admin')).toBe(false);
    expect(isActiveHref('/admin', '/admin')).toBe(true);
  });

  it('matches a section by segment, not by string prefix', () => {
    expect(isActiveHref('/admin/products/new', '/admin/products')).toBe(true);
    // The failure a bare startsWith() would produce: /admin/products-archive is NOT products.
    expect(isActiveHref('/admin/products-archive', '/admin/products')).toBe(false);
  });

  it('BOTTOM_NAV and ADMIN_SECONDARY carry the labels the brief names', () => {
    expect(BOTTOM_NAV.map((i) => i.label)).toEqual([
      'Home',
      'Rates',
      'Calculator',
      'Orders',
      'Account',
    ]);
    expect(ADMIN_SECONDARY.map((i) => i.label)).toContain('Settings');
    expect(ADMIN_SECONDARY.map((i) => i.label)).toContain('Audit log');
  });
});

/**
 * `loading.tsx` and `notFound()` cannot coexist on the same route.
 *
 * A route-level `loading.tsx` opts the segment into streaming, and a streamed response has
 * already committed `HTTP 200` by the time the page body runs — so a later `notFound()`
 * renders the 404 UI under a 200 status. Stage 2 shipped exactly that: adding skeletons to
 * `/collections/[slug]` and `/products/[slug]` turned both into soft 404s, which broke §6
 * SECURITY's "an inactive product is a 404" and would have had crawlers indexing every
 * mistyped slug as a real page.
 *
 * It was caught by `catalog.spec.ts`, which asserts the status code. This is the cheap
 * structural version, so the mistake fails in milliseconds and explains itself.
 *
 * The fix, when a skeleton is wanted on such a route, is a `<Suspense>` boundary INSIDE the
 * page — placed after the lookup that decides whether to 404 — not a `loading.tsx`.
 */
describe('streaming does not swallow a 404 status', () => {
  function pagesThatCallNotFound(
    dir = join(process.cwd(), 'app'),
  ): { route: string; dir: string }[] {
    const found: { route: string; dir: string }[] = [];

    function walk(current: string, prefix: string) {
      for (const entry of readdirSync(current)) {
        const full = join(current, entry);
        if (entry === 'page.tsx') {
          const source = readFileSync(full, 'utf8');
          // `notFound()` called directly, not merely imported.
          if (/\bnotFound\s*\(\s*\)/.test(source)) {
            found.push({ route: prefix === '' ? '/' : prefix, dir: current });
          }
          continue;
        }
        if (!statSync(full).isDirectory()) continue;
        const segment = entry.startsWith('(') && entry.endsWith(')') ? '' : `/${entry}`;
        walk(full, `${prefix}${segment}`);
      }
    }

    walk(dir, '');
    return found;
  }

  const risky = pagesThatCallNotFound();

  it('finds the pages that can 404 — otherwise this suite proves nothing', () => {
    const routes = risky.map((r) => r.route);
    expect(routes).toContain('/collections/[slug]');
    expect(routes).toContain('/products/[slug]');
  });

  it.each(risky.map((r) => [r.route, r.dir]))(
    '%s calls notFound(), so it must not have a loading.tsx',
    (_route, dir) => {
      expect(existsSync(join(dir, 'loading.tsx'))).toBe(false);
    },
  );
});
