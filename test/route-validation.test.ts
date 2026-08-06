/**
 * Every API route validates its input — enforced, not asserted in a checklist.
 * Created by Phase 9 (specs/09-hardening.md §9.1).
 *
 * §9.1: "Every API route confirmed Zod-validated. **Write a test that enumerates route files
 * and fails if one lacks a schema import** — a checklist item decays, a test does not."
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHY THIS DOES NOT TEST FOR A SCHEMA IMPORT
 *
 *  The SECURITY pass pushed back on the literal wording, and the reasoning is worth keeping
 *  next to the code: a test that greps for `parseBody` or a `z.` decays exactly the way the
 *  checklist item does.
 *
 *    - It PASSES a route that imports a schema and forgets to apply it. The import is
 *      present; the validation is not.
 *    - It FAILS `/bills/[key]`, which validates its key against a strict UUIDv4 regex and
 *      is correct. Reject-don't-coerce is the requirement; Zod is one way to meet it.
 *
 *  So this asserts the BEHAVIOUR the requirement exists to produce, in two layers:
 *
 *    1. ENUMERATION — every route file on disk is declared below, and every declaration
 *       still matches the methods the file exports. A new route fails the suite until
 *       somebody states what it does with input. That is the anti-decay property.
 *
 *    2. BEHAVIOUR — every route is driven with deliberately malformed input and must not
 *       return 5xx. Routes that are public and take input must additionally answer 4xx — a
 *       refusal, not a coercion.
 *
 * ── WHAT LAYER 2 DOES **NOT** COVER, measured rather than assumed ──
 *
 *  Admin routes are exercised only as far as their AUTHORISATION boundary. `requireAdmin()`
 *  runs before validation (deliberately — SEC-016), so with no session they answer 404 and
 *  the malformed input never reaches a parser.
 *
 *  That is not a hypothetical gap. This file was mutation-checked by reverting the SEC-033
 *  fix — the impossible date `9999-99-99` that made `/admin/bills/export` throw — and all
 *  21 tests still passed. A route whose authorisation sits in front of its validation
 *  cannot have its validation tested through the route.
 *
 *  So parsers used by admin routes are tested where they live: `lib/bills/query.test.ts`
 *  covers `parseBillFilters`, and six of its cases fail against the pre-fix parser. When a
 *  new admin route is added here, add the parser test too — a green row in this file is not
 *  evidence that an admin route validates anything.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

/** No session, no admin — the denial paths are the fast ones and touch no infrastructure. */
vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers({ host: 'shop.example', 'x-forwarded-for': '203.0.113.9' }),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

type Method = 'GET' | 'POST';

type Handler = (req: Request, ctx?: unknown) => Promise<Response>;

interface RouteContract {
  /** Path from the repo root. */
  file: string;
  /**
   * A STATIC import of the module.
   *
   * Written out per route rather than built from `file`, because Vite can only analyse a
   * dynamic specifier one directory deep and `app/bills/[key]/route.ts` is not. The
   * verbosity buys something anyway: this cannot silently resolve to the wrong module.
   */
  load: () => Promise<Record<string, unknown>>;
  methods: Method[];
  /**
   * How this route refuses bad input. Recorded so the choice is deliberate and reviewable —
   * `zod` for a schema, `guard` for an allowlist or pattern that predates one.
   */
  validates: 'zod' | 'guard' | 'no-input';
  /** Reachable without a session, so a stranger's malformed request must be refused. */
  public: boolean;
  /** A malformed query string, if the route reads one. */
  badQuery?: string;
  /** A malformed body, if the route reads one. `null` sends invalid JSON. */
  badBody?: unknown;
  /** Route params, for a dynamic segment. */
  params?: Record<string, string>;
}

/**
 * The declared surface. Adding a route file without adding a line here fails the first test.
 *
 * `public: true` means "reachable with no session". Those are the ones where a stranger's
 * malformed input must produce a refusal rather than a stack trace.
 */
const ROUTE_CONTRACTS: RouteContract[] = [
  // ── Admin. Authorisation runs BEFORE validation (SEC-016), so these answer 404 first.
  {
    file: 'app/admin/bills/export/route.ts',
    load: () => import('@/app/admin/bills/export/route'),
    methods: ['GET'],
    validates: 'guard',
    public: false,
    badQuery: 'from=9999-99-99&to=abc&page=-1',
  },
  {
    file: 'app/api/admin/bills/route.ts',
    load: () => import('@/app/api/admin/bills/route'),
    methods: ['POST'],
    validates: 'zod',
    public: false,
    badBody: { items: 'not-an-array' },
  },
  {
    file: 'app/api/admin/rates/route.ts',
    load: () => import('@/app/api/admin/rates/route'),
    methods: ['POST'],
    validates: 'zod',
    public: false,
    badBody: { metal: 'PLUTONIUM' },
  },

  // ── Auth. Public by necessity — these are how you get a session.
  {
    file: 'app/api/auth/claim/route.ts',
    load: () => import('@/app/api/auth/claim/route'),
    methods: ['POST'],
    validates: 'zod',
    public: true,
    badBody: { token: 12345 },
  },
  {
    file: 'app/api/auth/login/route.ts',
    load: () => import('@/app/api/auth/login/route'),
    methods: ['POST'],
    validates: 'zod',
    public: true,
    badBody: { identifier: [], password: null },
  },
  {
    file: 'app/api/auth/logout/route.ts',
    load: () => import('@/app/api/auth/logout/route'),
    methods: ['POST'],
    validates: 'zod',
    public: true,
    badBody: { everywhere: 'yes-please' },
  },
  {
    file: 'app/api/auth/me/route.ts',
    load: () => import('@/app/api/auth/me/route'),
    methods: ['GET'],
    validates: 'no-input',
    public: true,
  },
  {
    file: 'app/api/auth/password/forgot/route.ts',
    load: () => import('@/app/api/auth/password/forgot/route'),
    methods: ['POST'],
    validates: 'zod',
    public: true,
    badBody: { email: 42 },
  },
  {
    file: 'app/api/auth/password/reset/route.ts',
    load: () => import('@/app/api/auth/password/reset/route'),
    methods: ['POST'],
    validates: 'zod',
    public: true,
    badBody: { code: {}, password: 1 },
  },
  {
    file: 'app/api/auth/phone/start/route.ts',
    load: () => import('@/app/api/auth/phone/start/route'),
    methods: ['POST'],
    validates: 'zod',
    public: true,
    badBody: { phone: ['+91'] },
  },
  {
    file: 'app/api/auth/phone/verify/route.ts',
    load: () => import('@/app/api/auth/phone/verify/route'),
    methods: ['POST'],
    validates: 'zod',
    public: true,
    badBody: { code: 999999 },
  },
  {
    file: 'app/api/auth/signup/complete/route.ts',
    load: () => import('@/app/api/auth/signup/complete/route'),
    methods: ['POST'],
    validates: 'zod',
    public: true,
    badBody: { email: 'not-an-email', password: 1 },
  },
  {
    file: 'app/api/auth/signup/start/route.ts',
    load: () => import('@/app/api/auth/signup/start/route'),
    methods: ['POST'],
    validates: 'zod',
    public: true,
    badBody: { email: {} },
  },
  {
    file: 'app/api/auth/signup/verify/route.ts',
    load: () => import('@/app/api/auth/signup/verify/route'),
    methods: ['POST'],
    validates: 'zod',
    public: true,
    badBody: { code: null },
  },

  // ── Public writes and reads.
  {
    file: 'app/api/calculator/share/route.ts',
    load: () => import('@/app/api/calculator/share/route'),
    methods: ['POST'],
    validates: 'zod',
    public: true,
    badBody: { items: [{ weightGrams: 'abc' }] },
  },
  {
    file: 'app/api/enquiry/route.ts',
    load: () => import('@/app/api/enquiry/route'),
    methods: ['POST'],
    validates: 'zod',
    public: true,
    badBody: { productId: 12345, source: 'nowhere' },
    // Answers 204 to everything on purpose — §6.3: an analytics beacon must not tell a
    // visitor their enquiry failed. `expectRefusal` is therefore false for this one.
  },
  {
    file: 'app/api/health/route.ts',
    load: () => import('@/app/api/health/route'),
    methods: ['GET'],
    validates: 'no-input',
    public: true,
  },
  {
    file: 'app/api/rates/history/route.ts',
    load: () => import('@/app/api/rates/history/route'),
    methods: ['GET'],
    validates: 'zod',
    public: true,
    badQuery: 'metal=GOLD&purity=SILVER_999&days=-5',
  },
  {
    file: 'app/api/rates/route.ts',
    load: () => import('@/app/api/rates/route'),
    methods: ['GET'],
    validates: 'no-input',
    public: true,
  },

  // ── The bill capability URL. A UUIDv4 pattern, not Zod, and correct (see the header).
  {
    file: 'app/bills/[key]/route.ts',
    load: () => import('@/app/bills/[key]/route'),
    methods: ['GET'],
    validates: 'guard',
    public: true,
    params: { key: '../../etc/passwd' },
  },
];

/**
 * Routes that answer 2xx to malformed input **by design**. Two, each for a stated reason —
 * this set is not a place to park a failure.
 *
 * `enquiry` — §6.3 makes it a fire-and-forget analytics beacon sent with `sendBeacon`. It
 * answers 204 to everything so a customer on their way to WhatsApp is never shown an error
 * about a log write they did not ask for.
 *
 * `logout` — the body is optional and `everywhere` is a flag, so a malformed body is
 * ignored and the caller is signed out anyway. Refusing to end a session because its JSON
 * was bad would be the worse security outcome. Note the flag defaults to `false`, the
 * conservative branch, so garbage cannot escalate this to "log out of all devices".
 */
const SILENT_BY_DESIGN = new Set([
  'app/api/enquiry/route.ts',
  'app/api/auth/logout/route.ts',
]);

function discoverRouteFiles(dir = 'app', found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) discoverRouteFiles(path, found);
    else if (entry.name === 'route.ts' || entry.name === 'route.tsx') found.push(path);
  }
  return found;
}

describe('§9.1 — every API route is declared and validates its input', () => {
  const onDisk = discoverRouteFiles().sort();
  const declared = ROUTE_CONTRACTS.map((c) => c.file).sort();

  describe('enumeration — the list cannot silently drift', () => {
    it('every route file on disk is declared here', () => {
      /**
       * The anti-decay assertion. A new route handler fails this until somebody states what
       * it does with input — which is the review step §9.1 is really asking for.
       */
      expect(onDisk).toEqual(declared);
    });

    it('every declared route still exists', () => {
      for (const contract of ROUTE_CONTRACTS) {
        expect(
          existsSync(contract.file),
          `${contract.file} is declared but missing`,
        ).toBe(true);
      }
    });

    it('the declared methods match what each file exports', () => {
      // Catches a POST added to a route declared GET-only — a new input surface that would
      // otherwise inherit a passing row.
      for (const contract of ROUTE_CONTRACTS) {
        const source = readFileSync(contract.file, 'utf8');
        const exported = (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const).filter(
          (m) => new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b`).test(source),
        );
        expect(exported.sort(), `${contract.file} exports`).toEqual(
          [...contract.methods].sort(),
        );
      }
    });

    it('a route that reads input declares how it refuses bad input', () => {
      for (const contract of ROUTE_CONTRACTS) {
        const readsInput = Boolean(
          contract.badBody || contract.badQuery || contract.params,
        );
        if (readsInput) {
          expect(contract.validates, `${contract.file}`).not.toBe('no-input');
        }
      }
    });
  });

  describe('behaviour — malformed input is refused, never a 500', () => {
    const drivable = ROUTE_CONTRACTS.filter(
      (c) =>
        c.badBody !== undefined || c.badQuery !== undefined || c.params !== undefined,
    );

    it.each(drivable.map((c) => [c.file, c] as const))(
      '%s refuses malformed input',
      async (_name, contract) => {
        const mod = await contract.load();

        for (const method of contract.methods) {
          const handler = mod[method] as Handler | undefined;
          expect(handler, `${contract.file} exports ${method}`).toBeTypeOf('function');

          const url = `https://shop.example/x${contract.badQuery ? `?${contract.badQuery}` : ''}`;
          const request = new Request(url, {
            method,
            ...(contract.badBody !== undefined
              ? {
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify(contract.badBody),
                }
              : {}),
          });

          const context = contract.params
            ? { params: Promise.resolve(contract.params) }
            : undefined;

          const response = await handler!(request, context);

          /**
           * The assertion that matters, and the one SEC-033 would have failed.
           *
           * A 500 on malformed input means the value got past validation and broke
           * something downstream — which is the definition of coercing rather than
           * rejecting, whatever the code looks like.
           */
          expect(
            response.status,
            `${contract.file} ${method} returned ${response.status} for malformed input`,
          ).toBeLessThan(500);

          // A public route that takes input must REFUSE, not quietly accept.
          if (contract.public && !SILENT_BY_DESIGN.has(contract.file)) {
            expect(
              response.status,
              `${contract.file} ${method} accepted malformed input`,
            ).toBeGreaterThanOrEqual(400);
          }
        }
      },
    );
  });
});
