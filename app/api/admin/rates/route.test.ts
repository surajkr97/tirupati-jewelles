/**
 * Phase 4 SECURITY — POST /api/admin/rates.
 * specs/04-rates-ticker.md, SECURITY section:
 *
 *   "POST /api/admin/rates rejects non-admin with 404."
 *   "Rate input Zod-validated: positive, bounded, integer paise after conversion."
 *   "Every rate change writes an AuditLog with actor and IP."
 *   "Client cannot influence the stored rate through any public route."
 *
 * The guard is mocked so the caller's identity can be varied; `requireAdmin` itself is
 * Phase 3's and is tested there. What is under test here is that this route consults it
 * BEFORE doing anything else, and that a rejection writes nothing.
 *
 * Every denial case also asserts the table is untouched. A route that returns 404 and
 * still writes the row is the failure mode that matters, and a status-code-only assertion
 * would not see it.
 */
import { Metal, Purity, Role } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

/** Hoisted with the `vi.mock` factory, which is lifted above every import. */
const { guardState, UnauthorisedError } = vi.hoisted(() => {
  class UnauthorisedError extends Error {
    constructor() {
      super('Not authenticated');
      this.name = 'UnauthorisedError';
    }
  }
  return {
    guardState: { user: null as { id: string; role: 'ADMIN' | 'CUSTOMER' } | null },
    UnauthorisedError,
  };
});

vi.mock('@/lib/auth/guard', () => ({
  UnauthorisedError,
  requireAdmin: async () => {
    // Mirrors the real guard: a customer and a signed-out visitor are indistinguishable
    // to the caller, so both produce the same 404.
    if (!guardState.user || guardState.user.role !== 'ADMIN') {
      throw new UnauthorisedError();
    }
    return guardState.user;
  },
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.7' }),
}));

import { POST } from '@/app/api/admin/rates/route';
import { db } from '@/lib/db';
import { invalidate } from '@/lib/redis';
import { RATES_CACHE_KEY } from '@/lib/rates';

const HAS_TEST_DB = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = HAS_TEST_DB ? describe : describe.skip;

let adminId: string;
let customerId: string;

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/admin/rates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

const VALID = { metal: 'GOLD', purity: 'K22_916', displayRupees: 118_420 };

describeDb('POST /api/admin/rates', () => {
  beforeEach(async () => {
    await db.auditLog.deleteMany();
    await db.metalRate.deleteMany();
    await db.user.deleteMany();
    await invalidate(RATES_CACHE_KEY);

    const admin = await db.user.create({
      data: { email: `admin-${Date.now()}@example.com`, role: Role.ADMIN },
      select: { id: true },
    });
    const customer = await db.user.create({
      data: { email: `customer-${Date.now()}@example.com`, role: Role.CUSTOMER },
      select: { id: true },
    });

    adminId = admin.id;
    customerId = customer.id;
    guardState.user = { id: adminId, role: Role.ADMIN };
  });

  afterAll(async () => {
    await db.auditLog.deleteMany();
    await db.metalRate.deleteMany();
    await db.user.deleteMany();
    await db.$disconnect();
  });

  describe('authorisation', () => {
    it('answers 404 to a signed-out visitor', async () => {
      guardState.user = null;

      const response = await post(VALID);

      // 404, not 403 — §3.6: "Do not confirm the route exists."
      expect(response.status).toBe(404);
      expect(await db.metalRate.count()).toBe(0);
    });

    it('answers 404 to a signed-in CUSTOMER', async () => {
      guardState.user = { id: customerId, role: Role.CUSTOMER };

      const response = await post(VALID);

      expect(response.status).toBe(404);
      expect(await db.metalRate.count()).toBe(0);
    });

    it('gives a customer and a stranger the identical response', async () => {
      guardState.user = null;
      const anonymous = await post(VALID);
      const anonymousBody = await anonymous.json();

      guardState.user = { id: customerId, role: Role.CUSTOMER };
      const customer = await post(VALID);

      // Any difference — status, body, or a distinct message — is an oracle telling an
      // attacker that a route worth attacking is there.
      expect(customer.status).toBe(anonymous.status);
      expect(await customer.json()).toEqual(anonymousBody);
    });

    it('checks authorisation before validating the body', async () => {
      guardState.user = null;

      // A malformed body from a stranger must still be 404, not a 400 that reveals the
      // schema and confirms the endpoint.
      const response = await post({ metal: 'NONSENSE' });

      expect(response.status).toBe(404);
    });

    it('accepts an ADMIN', async () => {
      const response = await post(VALID);

      expect(response.status).toBe(201);
      expect(await db.metalRate.count()).toBe(1);
    });
  });

  describe('input validation — reject, do not coerce', () => {
    it.each([
      ['a missing body', {}],
      ['an unknown metal', { ...VALID, metal: 'PLATINUM' }],
      ['an unknown purity', { ...VALID, purity: 'K24' }],
      ['a purity from the wrong metal', { ...VALID, purity: 'SILVER_999' }],
      ['a zero rate', { ...VALID, displayRupees: 0 }],
      ['a negative rate', { ...VALID, displayRupees: -118_420 }],
      ['a rate above the ceiling', { ...VALID, displayRupees: 100_000_001 }],
      ['a string rate', { ...VALID, displayRupees: '118420' }],
      ['a null rate', { ...VALID, displayRupees: null }],
      ['NaN', { ...VALID, displayRupees: Number.NaN }],
      [
        'a rate too small to store as a paise-per-gram integer',
        {
          ...VALID,
          displayRupees: 0.001,
        },
      ],
    ])('rejects %s and writes nothing', async (_name, body) => {
      const response = await post(body);

      expect(response.status).toBe(400);
      expect(await db.metalRate.count()).toBe(0);
    });

    it('rejects a body that is not JSON', async () => {
      const response = await post('not json at all');

      expect(response.status).toBe(400);
      expect(await db.metalRate.count()).toBe(0);
    });

    it('ignores extra fields rather than trusting them', async () => {
      // The client must never be able to name the stored value directly. `ratePerGram` is
      // derived from `displayRupees` on the server; a client-supplied one is discarded.
      const response = await post({
        ...VALID,
        ratePerGram: 999_999_999,
        setByUserId: customerId,
        role: 'ADMIN',
      });

      expect(response.status).toBe(201);

      const row = await db.metalRate.findFirstOrThrow();
      expect(row.ratePerGram).toBe(1_184_200n); // ₹1,18,420 per 10g → paise per gram
      expect(row.setByUserId).toBe(adminId);
    });
  });

  describe('unit conversion happens on the server', () => {
    it('converts gold from ₹ per 10g to paise per gram', async () => {
      await post({ metal: 'GOLD', purity: 'K22_916', displayRupees: 118_420 });

      expect((await db.metalRate.findFirstOrThrow()).ratePerGram).toBe(1_184_200n);
    });

    it('converts silver from ₹ per kg to paise per gram', async () => {
      await post({ metal: 'SILVER', purity: 'SILVER_999', displayRupees: 158_900 });

      // ₹1,58,900/kg = 15,890,000 paise/kg = 15,890 paise/g.
      expect((await db.metalRate.findFirstOrThrow()).ratePerGram).toBe(15_890n);
    });

    it('stores an integer, never a float', async () => {
      await post({ metal: 'GOLD', purity: 'K22_916', displayRupees: 118_420.37 });

      const { ratePerGram } = await db.metalRate.findFirstOrThrow();

      // MASTER-SPEC §4: money is integer paise. bigint cannot hold a fraction, so the
      // assertion is that it round-trips exactly rather than throwing on the way in.
      expect(typeof ratePerGram).toBe('bigint');
      expect(ratePerGram).toBe(1_184_203n);
    });
  });

  describe('the fat-finger guard', () => {
    it('answers 409 with both figures rather than saving', async () => {
      await post(VALID);

      const response = await post({ ...VALID, displayRupees: 1_184_200 }); // 10×

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ needsConfirmation: true });
      expect(await db.metalRate.count()).toBe(1);
    });

    it('saves the same change when confirmed', async () => {
      await post(VALID);

      const response = await post({
        ...VALID,
        displayRupees: 1_184_200,
        confirmed: true,
      });

      expect(response.status).toBe(201);
      expect(await db.metalRate.count()).toBe(2);
    });
  });

  describe('audit trail', () => {
    it('records the actor and the IP on every accepted change', async () => {
      await post(VALID);

      const log = await db.auditLog.findFirstOrThrow({ where: { action: 'RATE_SET' } });

      expect(log.actorId).toBe(adminId);
      expect(log.ip).toBe('203.0.113.7');
      expect(log.entity).toBe('MetalRate');
      expect(log.after).toEqual({ ratePerGram: '1184200' });
    });

    it('records the previous value so a change can be reconstructed', async () => {
      await post(VALID);
      await post({ ...VALID, displayRupees: 120_000 });

      const log = await db.auditLog.findFirstOrThrow({
        where: { action: 'RATE_SET' },
        orderBy: { createdAt: 'desc' },
      });

      expect(log.before).toEqual({ ratePerGram: '1184200' });
      expect(log.after).toEqual({ ratePerGram: '1200000' });
    });

    it('writes no audit entry for a rejected change', async () => {
      guardState.user = null;
      await post(VALID);

      guardState.user = { id: adminId, role: Role.ADMIN };
      await post({ ...VALID, displayRupees: -1 });

      expect(await db.auditLog.count()).toBe(0);
    });
  });

  describe('the rate history is an audit trail', () => {
    it('never updates a row in place', async () => {
      await post(VALID);
      await post({ ...VALID, displayRupees: 120_000 });
      await post({ ...VALID, displayRupees: 121_000 });

      // Phase 8 bills snapshot from this table. Rewriting a row would change what a past
      // invoice says it charged.
      const rows = await db.metalRate.findMany({
        where: { metal: Metal.GOLD, purity: Purity.K22_916 },
      });
      expect(rows).toHaveLength(3);
    });
  });
});
