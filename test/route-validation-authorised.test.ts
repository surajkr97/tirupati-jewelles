/**
 * §9.1 item 3, past the authorisation boundary —
 * "Every API route confirmed Zod-validated. **Write a test that enumerates route files and
 * fails if one lacks a schema import** — a checklist item decays, a test does not."
 * Written by TEST for Phase 9 from `specs/09-hardening.md`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHY THERE IS A SECOND ROUTE-VALIDATION FILE
 *
 *  `test/route-validation.test.ts` drives every route with malformed input and asserts a
 *  4xx. For the three ADMIN routes it asserts nothing, and says so in its own header: with
 *  no session, `requireAdmin()` answers 404 before the input reaches a parser (SEC-016 puts
 *  it there deliberately). It was mutation-checked and found green against the broken
 *  parser that caused SEC-033.
 *
 *  DEV's answer was to test the parser where it lives (`lib/bills/query.test.ts`). That is
 *  right and it closed SEC-033 — but it does not restore the ANTI-DECAY property, which is
 *  the entire reason §9.1 asks for a test rather than a checklist. A fourth admin route
 *  added next month with no validation at all passes the route file, and the parser file
 *  never hears about it.
 *
 *  So this file supplies the missing session. `requireAdmin` is mocked to return an admin —
 *  the authorisation control is Phase 3's and is tested there; what is under test here is
 *  what happens to bad input AFTER a real admin sends it, which is the only place the
 *  question can be answered.
 *
 *  Every route runs against the real test Postgres, because "returned 400 and wrote
 *  nothing" is two claims and the second one needs a database to be false in.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

/** Same-origin, so the CSRF control (tested in `lib/http.test.ts`) is not what refuses. */
vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers({
      host: 'shop.example',
      origin: 'https://shop.example',
      'x-forwarded-for': '203.0.113.9',
    }),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

/**
 * A signed-in admin.
 *
 * The point of this file is everything that happens after this check passes. Mocking it is
 * the only way past a guard that is correctly placed in front of validation.
 */
vi.mock('@/lib/auth/guard', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/auth/guard')>('@/lib/auth/guard');

  return {
    ...actual,
    requireAdmin: async () => ({
      id: 'admin-under-test',
      email: 'admin@example.com',
      phone: null,
      name: 'Admin',
      role: 'ADMIN' as const,
      phoneVerified: false,
      emailVerified: true,
      createdAt: new Date(),
    }),
  };
});

const HAS_TEST_DB = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = HAS_TEST_DB ? describe : describe.skip;

/** Row counts for everything an admin mutation could plausibly write. */
async function snapshot() {
  const { db } = await import('@/lib/db');

  const [orders, orderItems, rates, products, categories, media, audit] =
    await Promise.all([
      db.order.count(),
      db.orderItem.count(),
      db.metalRate.count(),
      db.product.count(),
      db.category.count(),
      db.mediaSlot.count(),
      db.auditLog.count(),
    ]);

  return { orders, orderItems, rates, products, categories, media, audit };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE CONTROL FOR THIS WHOLE FILE. Read it before trusting anything below.
 *
 *  If the `requireAdmin` mock does not take effect, every route answers 404 and every
 *  action returns `{ ok: false, error: 'Not found.' }` — and every assertion in this file
 *  passes for that reason instead of the one it claims. That is precisely how
 *  `test/route-validation.test.ts` came to assert nothing, so the same trap is closed here
 *  by proving the door is open before testing what happens inside it.
 * ═══════════════════════════════════════════════════════════════════════════
 */
describeDb('control — the mocked admin session really does get past the guard', () => {
  it('a well-formed export request returns a CSV, not a 404', async () => {
    const { GET } = await import('@/app/admin/bills/export/route');

    const response = await GET(
      new Request('https://shop.example/admin/bills/export?from=2026-01-01'),
    );

    expect(
      response.status,
      'requireAdmin is still refusing — every other test in this file is vacuous',
    ).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
  });

  it('an admin Server Action gets past authorisation and CSRF', async () => {
    // Zero-argument, writes nothing, and reaches its body only once `adminAction` has
    // accepted both the role and the origin.
    const { createUploadTicket } = await import('@/app/admin/products/actions');

    const result = await createUploadTicket();

    expect(
      result,
      'adminAction is refusing before the body runs — the action tests below are vacuous',
    ).toMatchObject({ ok: true });
  });
});

describeDb(
  '§9.1 — an admin route refuses malformed input rather than breaking on it',
  () => {
    /**
     * The three admin routes, driven with input `test/route-validation.test.ts` sends but
     * cannot deliver. Each declares only what the SPEC requires: a refusal, and no write.
     */
    const CASES = [
      {
        name: 'GET /admin/bills/export — the SEC-033 impossible date',
        load: () => import('@/app/admin/bills/export/route'),
        method: 'GET' as const,
        url: 'https://shop.example/admin/bills/export?from=9999-99-99&to=abc&page=-1',
        /**
         * §8.5's parser falls back on unrecognised values rather than erroring, so a 200 with
         * an unfiltered export is the correct answer here — "reject, don't coerce" is about
         * not letting the value through to something that breaks on it. A 500 is the failure.
         */
        expect5xx: false,
        expect4xx: false,
      },
      {
        name: 'GET /admin/bills/export — a date that rolls forward silently',
        load: () => import('@/app/admin/bills/export/route'),
        method: 'GET' as const,
        url: 'https://shop.example/admin/bills/export?from=2026-02-30',
        expect5xx: false,
        expect4xx: false,
      },
      {
        name: 'POST /api/admin/bills — items is not an array',
        load: () => import('@/app/api/admin/bills/route'),
        method: 'POST' as const,
        url: 'https://shop.example/api/admin/bills',
        body: { items: 'not-an-array' },
        expect5xx: false,
        expect4xx: true,
      },
      {
        name: 'POST /api/admin/bills — a weight that is not a number',
        load: () => import('@/app/api/admin/bills/route'),
        method: 'POST' as const,
        url: 'https://shop.example/api/admin/bills',
        body: {
          customerName: 'Test',
          customerPhone: '+919876543210',
          items: [{ description: 'ring', purity: 'K22_916', weightGrams: 'abc' }],
        },
        expect5xx: false,
        expect4xx: true,
      },
      {
        name: 'POST /api/admin/rates — an invented metal',
        load: () => import('@/app/api/admin/rates/route'),
        method: 'POST' as const,
        url: 'https://shop.example/api/admin/rates',
        body: { metal: 'PLUTONIUM', purity: 'K22_916', displayRupees: 100 },
        expect5xx: false,
        expect4xx: true,
      },
      {
        name: 'POST /api/admin/rates — a rate that is not a number',
        load: () => import('@/app/api/admin/rates/route'),
        method: 'POST' as const,
        url: 'https://shop.example/api/admin/rates',
        body: { metal: 'GOLD', purity: 'K22_916', displayRupees: '1,18,420' },
        expect5xx: false,
        expect4xx: true,
      },
      {
        name: 'POST /api/admin/bills — invalid JSON entirely',
        load: () => import('@/app/api/admin/bills/route'),
        method: 'POST' as const,
        url: 'https://shop.example/api/admin/bills',
        rawBody: '{ not json',
        expect5xx: false,
        expect4xx: true,
      },
    ];

    it.each(CASES.map((c) => [c.name, c] as const))('%s', async (_name, testCase) => {
      const before = await snapshot();
      // The union of two route modules has no common index signature; the method is checked
      // against the file by `test/route-validation.test.ts`'s enumeration.
      const mod = (await testCase.load()) as Record<string, unknown>;
      const handler = mod[testCase.method] as (req: Request) => Promise<Response>;

      const request = new Request(testCase.url, {
        method: testCase.method,
        ...(testCase.rawBody !== undefined
          ? { headers: { 'content-type': 'application/json' }, body: testCase.rawBody }
          : testCase.body !== undefined
            ? {
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(testCase.body),
              }
            : {}),
      });

      const response = await handler(request);

      /**
       * A 5xx on malformed input means the value got past validation and broke something
       * downstream, which is the definition of coercing rather than rejecting — whatever the
       * source code looks like. This is the assertion that would have caught SEC-033, and
       * the one the unauthenticated version of this test could not make.
       */
      expect(
        response.status,
        `${testCase.name} → ${response.status}; malformed input reached something that threw`,
      ).toBeLessThan(500);

      if (testCase.expect4xx) {
        expect(
          response.status,
          `${testCase.name} accepted malformed input`,
        ).toBeGreaterThanOrEqual(400);
      }

      // Nothing was written. A route that errors *after* writing passes a status assertion.
      expect(await snapshot(), `${testCase.name} wrote to the database`).toEqual(before);
    });
  },
);

/**
 * ── The surface the route enumeration cannot see ──
 *
 * D-024 made every admin mutation in this application a Server Action, so `app/**\/route.ts`
 * is not where the admin input surface lives — six `'use server'` modules are. §9.1's item
 * is written in terms of "API routes" because it was written before D-024; the requirement
 * it encodes ("reject, don't coerce", every phase's SECURITY checklist) is about input, and
 * these take input.
 *
 * The enumeration below is the anti-decay half: a new action gets no free pass, because it
 * is discovered from disk rather than listed.
 */
describeDb('§9.1 — every admin Server Action refuses garbage input', () => {
  const ACTION_MODULES = [
    'app/admin/bills/actions.ts',
    'app/admin/categories/actions.ts',
    'app/admin/media/actions.ts',
    'app/admin/products/actions.ts',
    'app/admin/rates/actions.ts',
    'app/admin/settings/actions.ts',
  ] as const;

  const load = {
    'app/admin/bills/actions.ts': () => import('@/app/admin/bills/actions'),
    'app/admin/categories/actions.ts': () => import('@/app/admin/categories/actions'),
    'app/admin/media/actions.ts': () => import('@/app/admin/media/actions'),
    'app/admin/products/actions.ts': () => import('@/app/admin/products/actions'),
    'app/admin/rates/actions.ts': () => import('@/app/admin/rates/actions'),
    'app/admin/settings/actions.ts': () => import('@/app/admin/settings/actions'),
  } as const;

  it('the declared list still matches what is on disk', async () => {
    /**
     * The anti-decay assertion, in the same shape §9.1 asks for. A seventh action module
     * fails this until somebody adds it below and it starts being driven.
     */
    const { readdirSync, existsSync } = await import('node:fs');

    const onDisk = readdirSync('app/admin', { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `app/admin/${entry.name}/actions.ts`)
      .filter((path) => existsSync(path))
      .sort();

    expect(onDisk).toEqual([...ACTION_MODULES].sort());
  });

  it.each(ACTION_MODULES)('%s', async (file) => {
    const before = await snapshot();
    const mod = await load[file]();

    const actions = Object.entries(mod).filter(
      (entry): entry is [string, (...args: unknown[]) => Promise<unknown>] =>
        typeof entry[1] === 'function',
    );

    expect(actions.length, `${file} exports no actions`).toBeGreaterThan(0);

    for (const [name, action] of actions) {
      /**
       * An action that declares no parameters reads no input, so there is nothing here to
       * reject — `createUploadTicket()` is the case. It still must not throw.
       */
      const readsInput = action.length > 0;

      for (const garbage of [undefined, 'not-an-object', 42, [], { nope: true }]) {
        let result: unknown;

        // A Server Action that THROWS on bad input is a 500 on the admin's screen with no
        // message, which is the same defect as a route returning 500.
        try {
          result = await action(garbage);
        } catch (err) {
          expect.fail(
            `${file} → ${name}(${JSON.stringify(garbage) ?? 'undefined'}) threw: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }

        if (readsInput) {
          expect(
            result,
            `${file} → ${name} accepted ${JSON.stringify(garbage) ?? 'undefined'}`,
          ).toMatchObject({ ok: false });
        }
      }
    }

    // Reject, don't coerce — and don't write on the way to rejecting.
    expect(await snapshot(), `${file} wrote to the database on garbage input`).toEqual(
      before,
    );
  });
});
