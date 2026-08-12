# ROUTE MAP

Every route the application serves, how it is protected, and how a user reaches it.

**Method:** enumerated from `app/` on disk, not from memory or from the specs. Route groups
(`(app)`, `(auth)`) are organisational and contribute nothing to the URL, so they are
stripped here as Next strips them. Authorisation was read from the code that enforces it,
not from where a link happens to appear.

Created by the UI redesign, Stage 5A.

---

## How access is actually enforced

Three layers, and only two of them are boundaries.

| Layer | What it does | Is it a boundary? |
| :--- | :--- | :--- |
| `proxy.ts` | Rewrites `/admin/*` to a 404 when no session **cookie** exists; redirects `/account/*` to `/login?next=…` | **No.** It reads whether a cookie exists, which is a UX signal, not a fact about the caller. Its own header says so. |
| `app/admin/layout.tsx` → `requireAdminPage()` | Resolves the real session and calls `notFound()` for anyone who is not an ADMIN | **Yes** — this is what protects the whole `/admin` tree |
| `requireAdmin()` in handlers/actions | Re-checks on every mutating admin route | **Yes** |

**Navigation is convenience, never authorisation.** A customer who types `/admin` is rejected
by `requireAdminPage()` whether or not a link was ever shown to them. §3.6 requires that
rejection to be a **404, not a 403** — a redirect or a "forbidden" page would confirm the
route exists just as loudly. This is also why there is deliberately no `app/admin/not-found.tsx`
(D-062's neighbour; see `app/not-found.tsx`).

---

## Public — no session required

| Route | Access | Purpose | Navigation |
| :--- | :--- | :--- | :--- |
| `/` | Public | Homepage — hero, today's rates, new arrivals, collections, trust | Header wordmark, bottom nav "Home" |
| `/rates` | Public | Full rate reference + 30-day history | Header nav, bottom nav, rate-card action |
| `/calculator` | Public | Multi-item price calculator | Header nav, bottom nav, rate-card action, product page |
| `/calculator/s/[slug]` | Public | A shared calculator estimate | Share link only — not in navigation by design |
| `/collections` | Public | Category index | Header nav, footer, hero CTA |
| `/collections/[slug]` | Public | Product listing for a category | `/collections`, homepage collection tiles |
| `/products/[slug]` | Public | Product detail + WhatsApp enquiry | Product grids, search, related products |
| `/search` | Public | Product search | Header search icon, mobile menu, footer |
| `/policies/[slug]` | Public | Legal + buyback pages (DB-backed) | Footer "Policies" |
| `/claim/[token]` | Public (token) | Claim an in-shop order by phone OTP | WhatsApp link from the shop — not in navigation |

**No `/about` and no `/contact`.** Neither route exists; D-060 records the decision not to
invent copy for them. The shop's real address and phone reach the page through the
`LocalBusiness` structured data in `app/(app)/layout.tsx`, read from the §7.9 Settings row.

---

## Authentication

| Route | Access | Purpose | Navigation |
| :--- | :--- | :--- | :--- |
| `/login` | Signed-out | Sign in by phone **or** email | Header account icon, `?next=` bounce from `proxy.ts` |
| `/signup` | Signed-out | Email → OTP → password | `/login` footer link |
| `/forgot-password` | Any | Reset by OTP | `/login` "Forgot your password?" |

`/login` and `/signup` redirect an **authenticated** visitor away (D-067). The redirect
resolves the real session rather than reading the cookie, so a stale cookie falls through to
the form instead of trapping the user in a loop. `/forgot-password` is deliberately **not**
bounced — resetting while signed in is legitimate — and is the only one of the three that
stays statically rendered.

---

## Customer — signed in

| Route | Access | Purpose | Navigation |
| :--- | :--- | :--- | :--- |
| `/account` | Session | Profile, phone verification, sign out | Header account icon, bottom nav "Account" |
| `/account/orders` | Session | Order history | Bottom nav "Orders", account, mobile menu |
| `/account/orders/[id]` | Session + ownership | One order, its items and its bill | `/account/orders` row |

`/account/orders/[id]` filters by the session's `userId` — an unguessable id is not an
authorisation (DEBT-021).

---

## Admin — ADMIN role only

Every route below is inside `app/admin/`, so `requireAdminPage()` in the layout guards all of
them. Non-admins get a 404.

| Route | Access | Purpose | Navigation |
| :--- | :--- | :--- | :--- |
| `/admin` | ADMIN | Dashboard — today at a glance | Sidebar, mobile bar, `/account` shortcut, login redirect |
| `/admin/rates` | ADMIN | Set today's gold and silver rates | Sidebar, mobile bar |
| `/admin/products` | ADMIN | Product catalogue | Sidebar, mobile bar |
| `/admin/products/new` | ADMIN | Create a product | `/admin/products` "Add product" |
| `/admin/products/[id]` | ADMIN | Edit a product | `/admin/products` row |
| `/admin/bills` | ADMIN | **Bills & orders** — see the note below | Sidebar, mobile bar |
| `/admin/bills/new` | ADMIN | Build a bill → creates the customer's order | `/admin/bills` "New bill" |
| `/admin/bills/[id]` | ADMIN | One bill, its PDF and its WhatsApp send | `/admin/bills` row |
| `/admin/categories` | ADMIN | Category CRUD | Sidebar, mobile menu, dashboard "More" |
| `/admin/media` | ADMIN | MediaSlot images (hero, tiles, bill logo) | Sidebar, mobile menu, dashboard "More" |
| `/admin/settings` | ADMIN | Shop details, pricing defaults, WhatsApp number | Sidebar, mobile menu, dashboard "More" |
| `/admin/audit` | ADMIN | Who changed what | Sidebar, mobile menu, dashboard "More" |

### There is no `/admin/orders`, and one is not invented

The Stage 5 brief lists "Bills / Orders" as an admin destination. **`/admin/orders` does not
exist**, and the navigation must not pretend otherwise.

An `Order` row is written by `lib/bills/create.ts` when the admin builds a bill — the bill
*is* the order, from the shop's side. The customer sees it at `/account/orders`; the admin
sees it at `/admin/bills`. So the nav entry is labelled **"Bills & orders"**, which is true
about the page it opens.

Recorded as UI_REDESIGN_DEBT-004. If a dedicated order list is ever wanted it is a new page,
not a rename, and `lib/navigation.test.ts` fails if `/admin/orders` is added to the nav
without a route behind it.

---

## Route handlers — no UI

| Route | Access | Purpose |
| :--- | :--- | :--- |
| `/admin/bills/export` | ADMIN (`requireAdmin`) | CSV export of the filtered bill list. Reached from the button on `/admin/bills`, never from the nav — it downloads rather than navigates. |
| `/bills/[key]` | Unguessable key + one of three proofs | The bill PDF. `noindex`, expiring. |
| `/api/auth/*` | Mixed | Login, logout, signup, OTP, password reset, phone, claim |
| `/api/admin/rates`, `/api/admin/bills` | ADMIN | Admin mutations |
| `/api/rates`, `/api/rates/history` | Public | The true rate — what the calculator and every bill read |
| `/api/calculator/share` | Public, rate-limited | The only public write in the application |
| `/api/enquiry` | Public, rate-limited | WhatsApp enquiry beacon |
| `/api/health`, `/api/cron/cleanup` | Ops | Health check; nightly sweep (Vercel Cron, `CRON_SECRET`) |
| `/robots.txt`, `/sitemap.xml` | Public | SEO |

---

## Dev-only

| Route | Access | Purpose |
| :--- | :--- | :--- |
| `/__design` | Dev only | Component gallery — where a primitive is proved before a page uses it |
| `/__sentry-check` | Dev only | Throws a scrubbing-test error against the real Sentry transport |

Both are rewritten to a 404 in production by `proxy.ts`, **and** independently refuse in
their own handlers. One guard can be edited out by accident; two in different files cannot.

`%5F%5F` on disk is the documented escape — Next treats a leading underscore as a private
folder and would drop the route from the router entirely.

---

## Routes that once needed a typed URL

Kept as a record of what the redesign fixed, since "reachable" is easy to regress.

| Route | Was | Now |
| :--- | :--- | :--- |
| `/admin/settings` | Dashboard card only | Sidebar + mobile menu (Stage 2, C-5) |
| `/admin/audit` | Dashboard card only | Sidebar + mobile menu (Stage 2, C-5) |
| `/` from `/admin` | No route back at all | "Back to shop" in the rail and the mobile menu (C-6) |
| `/admin` from the storefront | Type it | `/account` shortcut, shown to admins only (C-3) |
| `/rates`, `/calculator`, `/collections` | Footer only at ≥768px | Desktop header nav (C-1) |

`lib/navigation.test.ts` asserts both directions: every nav href resolves to a real page, and
every top-level `/admin/*` route appears in the admin navigation.
