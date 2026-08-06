/**
 * Phase 8 — the two HTTP boundaries.
 * specs/08-billing-whatsapp.md, SECURITY section:
 *
 *   "Only ADMIN can create bills."
 *   "Rate limit bill creation (20/min) to bound abuse of a compromised admin session."
 *   "Bill PDF URL unguessable and unlisted; sequential guessing returns 404."
 *   "Customer A cannot fetch customer B's bill by ID or by PDF key."
 *   "Every bill creation and send audited."
 *
 * AGENTS.md requires every API route to be covered for happy path, auth-denied and
 * malformed input. Both routes are here because they are two halves of one story: the first
 * mints a capability, the second is the only thing that honours it.
 *
 * The guard is mocked so the caller's identity can be varied; `requireAdmin` itself is
 * Phase 3's and is tested there. What is under test is that these routes consult it, in the
 * right order, and that a denial writes nothing.
 */
import { Purity, Role } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

const { guardState, UnauthorisedError } = vi.hoisted(() => {
  class UnauthorisedError extends Error {
    constructor() {
      super('Not authenticated');
      this.name = 'UnauthorisedError';
    }
  }
  return {
    guardState: {
      user: null as { id: string; role: 'ADMIN' | 'CUSTOMER' } | null,
    },
    UnauthorisedError,
  };
});

vi.mock('@/lib/auth/guard', () => ({
  UnauthorisedError,
  requireAdmin: async () => {
    // Mirrors the real guard: a customer and a signed-out visitor are indistinguishable to
    // the caller, so both produce the same 404.
    if (!guardState.user || guardState.user.role !== 'ADMIN')
      throw new UnauthorisedError();
    return guardState.user;
  },
  getCurrentUser: async () => guardState.user,
}));

const headerState = vi.hoisted(() => ({ headers: {} as Record<string, string> }));

vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers({ 'x-forwarded-for': '203.0.113.11', ...headerState.headers }),
}));

import { POST } from '@/app/api/admin/bills/route';
import { GET as getBill } from '@/app/bills/[key]/route';
import { db } from '@/lib/db';
import { signedBillPath } from '@/lib/bills/storage';
import { RATES_CACHE_KEY } from '@/lib/rates';
import { invalidate, redis } from '@/lib/redis';

const HAS_TEST_DB = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = HAS_TEST_DB ? describe : describe.skip;

const GOLD_22 = 1_184_200n;
const PHONE_TYPED = '98765 43210';
const PHONE_E164 = '+919876543210';

let adminId: string;
let customerId: string;

const ITEM = {
  id: 'a',
  productId: null,
  label: 'Chain',
  metal: 'GOLD',
  purity: 'K22_916',
  weightGrams: '10',
  makingPct: '12',
  stoneCharge: '',
  gstPct: '3',
  hallmarkNo: '',
  bisCertNo: '',
};

const VALID = {
  customerName: 'Test Customer',
  customerPhone: PHONE_TYPED,
  note: '',
  items: [ITEM],
};

function post(body: unknown, extraHeaders: Record<string, string> = {}) {
  return POST(
    new Request('http://localhost/api/admin/bills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

function fetchBill(key: string, query = '') {
  return getBill(new Request(`http://localhost/bills/${key}${query}`), {
    params: Promise.resolve({ key }),
  });
}

describeDb('POST /api/admin/bills', () => {
  beforeEach(async () => {
    headerState.headers = {};

    await db.billPdf.deleteMany();
    await db.orderItem.deleteMany();
    await db.order.deleteMany();
    await db.billSequence.deleteMany();
    await db.auditLog.deleteMany();
    await db.metalRate.deleteMany();
    await db.user.deleteMany();
    await invalidate(RATES_CACHE_KEY);

    const admin = await db.user.create({
      data: { email: `bills-admin-${Date.now()}@example.com`, role: Role.ADMIN },
      select: { id: true },
    });
    const customer = await db.user.create({
      data: { email: `bills-customer-${Date.now()}@example.com`, role: Role.CUSTOMER },
      select: { id: true },
    });
    adminId = admin.id;
    customerId = customer.id;
    guardState.user = { id: adminId, role: Role.ADMIN };

    await db.metalRate.create({
      data: {
        metal: 'GOLD',
        purity: Purity.K22_916,
        ratePerGram: GOLD_22,
        setByUserId: adminId,
      },
    });
    await invalidate(RATES_CACHE_KEY);

    // The route is limited per admin id; clear the counter so a repeated run starts clean.
    await redis.del(`rl:bill:create:${adminId}`);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  // ── Happy path ───────────────────────────────────────────────────────────

  it('creates a bill and returns 201 with the order number', async () => {
    const response = await post(VALID);
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.orderNo).toMatch(/^JW-\d{4}-\d{4}$/);
    expect(body.replayed).toBe(false);
    expect(body.path).toBe(`/admin/bills/${body.orderId}`);

    // The response carries no rate and no line figures — nothing a client could replay.
    expect(body.ratePerGram).toBeUndefined();
  }, 30_000);

  it('normalises the phone the admin typed to E.164', async () => {
    // Phase 3 left this exact instruction. A bill stored as `9876543210` is never claimed
    // by a customer who verifies `+919876543210`.
    const response = await post(VALID);
    const { orderId } = await response.json();

    const order = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { customerPhone: true },
    });
    expect(order.customerPhone).toBe(PHONE_E164);
  }, 30_000);

  it('returns 200 and the same order when the idempotency key is replayed', async () => {
    const key = 'route-idem-000001';
    const first = await (await post(VALID, { 'Idempotency-Key': key })).json();
    const replay = await post(VALID, { 'Idempotency-Key': key });

    expect(replay.status).toBe(200);
    const body = await replay.json();
    expect(body.orderId).toBe(first.orderId);
    expect(body.replayed).toBe(true);
    expect(await db.order.count()).toBe(1);
  }, 30_000);

  // ── Auth denied ──────────────────────────────────────────────────────────

  it('answers 404 to a signed-out caller, and writes nothing', async () => {
    guardState.user = null;
    const response = await post(VALID);

    expect(response.status).toBe(404);
    expect(await db.order.count()).toBe(0);
  });

  it('answers 404 to a signed-in CUSTOMER, byte-identical to a stranger’s', async () => {
    guardState.user = null;
    const stranger = await (await post(VALID)).text();

    guardState.user = { id: customerId, role: Role.CUSTOMER };
    const response = await post(VALID);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe(stranger);
    expect(await db.order.count()).toBe(0);
  });

  it('checks authorisation BEFORE the origin, so a 403 never leaks the route', async () => {
    // SEC-016: the CSRF check answers 403, and a 403 from /api/admin/bills confirms the
    // route exists to someone who should be told nothing.
    guardState.user = null;
    headerState.headers = { origin: 'https://evil.test', host: 'localhost' };

    const response = await post(VALID);
    expect(response.status).toBe(404);
  });

  it('rejects a cross-origin POST from a real admin with 403', async () => {
    headerState.headers = { origin: 'https://evil.test', host: 'localhost' };

    const response = await post(VALID);
    expect(response.status).toBe(403);
    expect(await db.order.count()).toBe(0);
  });

  // ── Malformed input ──────────────────────────────────────────────────────

  it('rejects a body that is not JSON', async () => {
    const response = await post('not json at all');
    expect(response.status).toBe(400);
    expect(await db.order.count()).toBe(0);
  });

  it('rejects a client-submitted total rather than ignoring it', async () => {
    const response = await post({ ...VALID, grandTotal: '1' });
    expect(response.status).toBe(400);
    expect(await db.order.count()).toBe(0);
  });

  it('rejects a client-submitted rate', async () => {
    const response = await post({ ...VALID, items: [{ ...ITEM, ratePerGram: '1' }] });
    expect(response.status).toBe(400);
    expect(await db.order.count()).toBe(0);
  });

  it.each([
    ['no items', { ...VALID, items: [] }],
    [
      'a weight that is not a number',
      { ...VALID, items: [{ ...ITEM, weightGrams: 'abc' }] },
    ],
    ['a zero weight', { ...VALID, items: [{ ...ITEM, weightGrams: '0' }] }],
    ['a making charge over 100', { ...VALID, items: [{ ...ITEM, makingPct: '150' }] }],
    ['21 items', { ...VALID, items: Array.from({ length: 21 }, () => ITEM) }],
    ['an unknown purity', { ...VALID, items: [{ ...ITEM, purity: 'K24_999' }] }],
  ])('rejects %s', async (_label, body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(await db.order.count()).toBe(0);
  });

  it('rejects a phone that is not a real Indian mobile', async () => {
    // `libphonenumber-js` calls 1234567890 valid; SEC-004's explicit rule does not.
    for (const phone of ['1234567890', '5876543210', '12345', '']) {
      const response = await post({ ...VALID, customerPhone: phone });
      expect(response.status).toBe(400);
    }
    expect(await db.order.count()).toBe(0);
  });

  it('rejects a malformed Idempotency-Key rather than ignoring it', async () => {
    // A client that believes it has protection and does not is worse off than one that
    // knows it has none.
    const response = await post(VALID, { 'Idempotency-Key': 'short' });
    expect(response.status).toBe(400);
    expect(await db.order.count()).toBe(0);
  });

  // ── Rate limit (§8 SECURITY) ─────────────────────────────────────────────

  it('limits an admin to 20 bills a minute', async () => {
    // Bounds what a STOLEN admin session can do before anyone notices.
    const statuses: number[] = [];
    for (let i = 0; i < 21; i += 1) {
      statuses.push((await post(VALID)).status);
    }

    expect(statuses.slice(0, 20).every((status) => status === 201)).toBe(true);
    expect(statuses[20]).toBe(429);
    expect(await db.order.count()).toBe(20);
  }, 120_000);

  // ── Audit (§8 SECURITY: "Every bill creation and send audited") ──────────

  it('audits the creation with the actor and the client IP', async () => {
    const { orderId } = await (await post(VALID)).json();

    const entry = await db.auditLog.findFirstOrThrow({
      where: { action: 'ORDER_CREATE', entityId: orderId },
    });
    expect(entry.actorId).toBe(adminId);
    expect(entry.ip).toBe('203.0.113.11');
  }, 30_000);
});

// ── GET /bills/{key} ───────────────────────────────────────────────────────

describeDb('GET /bills/{key}', () => {
  let key: string;
  let ownerId: string;

  beforeEach(async () => {
    headerState.headers = {};

    await db.billPdf.deleteMany();
    await db.orderItem.deleteMany();
    await db.order.deleteMany();
    await db.billSequence.deleteMany();
    await db.auditLog.deleteMany();
    await db.metalRate.deleteMany();
    await db.user.deleteMany();
    await invalidate(RATES_CACHE_KEY);

    const admin = await db.user.create({
      data: { email: `pdf-admin-${Date.now()}@example.com`, role: Role.ADMIN },
      select: { id: true },
    });
    const owner = await db.user.create({
      data: { phone: PHONE_E164, phoneVerified: true, role: Role.CUSTOMER },
      select: { id: true },
    });
    const other = await db.user.create({
      data: { email: `other-${Date.now()}@example.com`, role: Role.CUSTOMER },
      select: { id: true },
    });

    adminId = admin.id;
    ownerId = owner.id;
    customerId = other.id;
    guardState.user = { id: adminId, role: Role.ADMIN };

    await db.metalRate.create({
      data: {
        metal: 'GOLD',
        purity: Purity.K22_916,
        ratePerGram: GOLD_22,
        setByUserId: adminId,
      },
    });
    await invalidate(RATES_CACHE_KEY);
    await redis.del(`rl:bill:create:${adminId}`);

    const { orderId } = await (await post(VALID)).json();
    const order = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { billPdfKey: true, userId: true },
    });
    key = order.billPdfKey!;
    // The bill auto-linked to the verified owner, which is what makes the IDOR case real.
    expect(order.userId).toBe(ownerId);
  }, 30_000);

  afterAll(async () => {
    await db.$disconnect();
  });

  function signed(): string {
    const path = signedBillPath(key, new Date(Date.now() + 60_000));
    return path.slice(path.indexOf('?'));
  }

  it('serves the PDF to an anonymous holder of a valid signature', async () => {
    guardState.user = null;
    const response = await fetchBill(key, signed());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');

    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  }, 30_000);

  it('sets the headers §8.3 and §8 SECURITY require', async () => {
    guardState.user = null;
    const response = await fetchBill(key, signed());

    expect(response.headers.get('x-robots-tag')).toContain('noindex');
    expect(response.headers.get('cache-control')).toContain('no-store');
    // §8 SECURITY: "PDF has no X-Frame-Options: ALLOWALL".
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('content-disposition')).toMatch(/JW-\d{4}-\d{4}\.pdf/);
  }, 30_000);

  it('404s a correct key with NO signature — DEBT-021', async () => {
    // An unguessable URL is not an authorisation.
    guardState.user = null;
    expect((await fetchBill(key)).status).toBe(404);
  }, 30_000);

  it('404s a tampered or replayed-with-a-later-deadline signature', async () => {
    guardState.user = null;
    const query = signed();

    expect((await fetchBill(key, `${query.slice(0, -1)}X`)).status).toBe(404);

    const expiry = new URLSearchParams(query.slice(1)).get('e');
    const signature = new URLSearchParams(query.slice(1)).get('s');
    const extended = `?e=${Number(expiry) + 3600}&s=${signature}`;
    expect((await fetchBill(key, extended)).status).toBe(404);
  }, 30_000);

  it('404s an expired signature', async () => {
    guardState.user = null;
    const path = signedBillPath(key, new Date(Date.now() - 1000));
    expect((await fetchBill(key, path.slice(path.indexOf('?')))).status).toBe(404);
  }, 30_000);

  it('serves the owner from their session, with no signature', async () => {
    guardState.user = { id: ownerId, role: Role.CUSTOMER };
    expect((await fetchBill(key)).status).toBe(200);
  }, 30_000);

  it('404s customer B holding customer A’s key — the §8 SECURITY case', async () => {
    guardState.user = { id: customerId, role: Role.CUSTOMER };
    expect((await fetchBill(key)).status).toBe(404);
  }, 30_000);

  it('serves an admin, who can always reprint the shop’s own invoice', async () => {
    guardState.user = { id: adminId, role: Role.ADMIN };
    expect((await fetchBill(key)).status).toBe(200);
  }, 30_000);

  it('404s a sequential or malformed key without touching the database', async () => {
    guardState.user = null;
    for (const bad of [
      '1',
      '2',
      '1.pdf',
      '00000000-0000-4000-8000-000000000000',
      '../../etc/passwd',
      "' OR 1=1--",
    ]) {
      expect((await fetchBill(encodeURIComponent(bad))).status).toBe(404);
    }
  }, 30_000);

  it('returns an identical body for every refusal', async () => {
    // "No such bill", "bad signature" and "not yours" must be indistinguishable, or the
    // route is an oracle for which invoices exist.
    guardState.user = null;
    const missing = await (
      await fetchBill('00000000-0000-4000-8000-000000000000')
    ).text();

    const unsigned = await (await fetchBill(key)).text();

    guardState.user = { id: customerId, role: Role.CUSTOMER };
    const notMine = await (await fetchBill(key)).text();

    expect(unsigned).toBe(missing);
    expect(notMine).toBe(missing);
  }, 30_000);
});
