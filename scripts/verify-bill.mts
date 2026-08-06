/**
 * Prove the Phase 8 billing path against a real Postgres and a real PDF render.
 * Created by Phase 8 (specs/08-billing-whatsapp.md).
 *
 *   pnpm verify:bill
 *
 * DEV's own "demonstrably met" check, in the shape Phase 7 established with
 * `scripts/verify-upload.mts`. It exists as a script rather than a test because it renders
 * real PDF bytes to disk for a human to look at, and because §8 TEST's concurrency case
 * ("50 concurrent bill creations … run this with real concurrency, not a loop") wants a
 * real connection pool rather than a test runner's.
 *
 * TEST owns the assertions that gate the phase. This is the run that says the code works
 * before it is handed over.
 *
 * It bills a throwaway number, resets that number's fixtures before it starts, and deletes
 * them again on success — a failed run leaves its evidence in the database to look at.
 *
 * ⚠ DEVELOPMENT ONLY. It consumes real invoice numbers from `BillSequence`, and §8.2's
 * counter cannot give one back. Never point it at production.
 */
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { config } from 'dotenv';

// `.env` first, then dynamic imports: `lib/env.ts` parses at import time and `tsx` does not
// load `.env` on its own, so a static import would throw before dotenv had run.
config({ path: '.env', quiet: true });

const { db } = await import('../lib/db');
const { createBill } = await import('../lib/bills/create');
const { renderBillPdf, ORDER_PDF_SELECT } = await import('../lib/bills/render');
const { amountInWords } = await import('../lib/bills/words');
const { splitGst } = await import('../lib/bills/tax');
const { createBillSchema } = await import('../lib/bills/schema');
const { signedBillPath, verifyBillSignature, newBillKey } =
  await import('../lib/bills/storage');
const { buildBillMessage, DeepLinkSender } = await import('../lib/whatsapp');
const { parseWhatsAppUrl } = await import('../lib/catalog/whatsapp');
const { formatINR } = await import('../lib/money');

let failures = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const PHONE = '+919000000001';

/**
 * Start from a known state.
 *
 * Found by running this twice: the second run left a VERIFIED user on the fixture number,
 * so "userId is null when nobody has verified that number" failed on data the previous run
 * had created. A verification script whose result depends on whether it has been run before
 * is not a verification script.
 */
await db.order.deleteMany({ where: { customerPhone: PHONE } });
await db.user.deleteMany({ where: { phone: PHONE } });

const admin = await db.user.findFirst({
  where: { role: 'ADMIN' },
  select: { id: true },
});
if (!admin) {
  console.error('No ADMIN user. Run `pnpm seed` first.');
  process.exit(1);
}

const rateCount = await db.metalRate.count();
if (rateCount === 0) {
  console.error('No rates set. Run `pnpm seed` first.');
  process.exit(1);
}

// ── 1. A multi-item bill, server-computed and rate-snapshotted ──────────────

console.log('\n1. Multi-item bill');

const items = [
  {
    id: 'a',
    label: 'Temple necklace',
    metal: 'GOLD' as const,
    purity: 'K22_916' as const,
    weightGrams: '48.500',
    makingPct: '14',
    stoneCharge: '12500.50',
    gstPct: '3',
    hallmarkNo: 'HUID-AB12CD',
    bisCertNo: 'BIS-99881',
  },
  {
    id: 'b',
    label: 'Everyday band & chain',
    metal: 'GOLD' as const,
    purity: 'K18_750' as const,
    weightGrams: '8.475',
    makingPct: '12',
    stoneCharge: '',
    gstPct: '3',
    hallmarkNo: '',
    bisCertNo: '',
  },
  {
    id: 'c',
    label: 'Silver anklets',
    metal: 'SILVER' as const,
    purity: 'SILVER_999' as const,
    weightGrams: '120',
    makingPct: '8',
    stoneCharge: '',
    gstPct: '3',
    hallmarkNo: '',
    bisCertNo: '',
  },
];

const parsed = createBillSchema.safeParse({
  customerName: 'Priya & Sons 🙏',
  customerPhone: PHONE,
  note: 'Wedding set — balance settled in store.',
  items,
});
check('request parses', parsed.success, parsed.success ? '' : 'schema rejected it');
if (!parsed.success) process.exit(1);

const created = await createBill(parsed.data, {
  adminId: admin.id,
  customerPhone: PHONE,
});
check('bill created', created.ok, created.ok ? created.orderNo : created.error);
if (!created.ok) process.exit(1);

check(
  'orderNo is JW-{YYYY}-{seq}',
  /^[A-Z]{1,8}-\d{4}-\d{4,}$/.test(created.orderNo),
  created.orderNo,
);

const order = await db.order.findUnique({
  where: { id: created.orderId },
  select: {
    ...ORDER_PDF_SELECT,
    billPdfKey: true,
    billPdf: { select: { byteSize: true, expiresAt: true } },
  },
});
if (!order) {
  console.error('The order vanished after creation.');
  process.exit(1);
}

check(
  'lines sum to the grand total',
  order.items.reduce((sum, item) => sum + item.lineTotal, 0n) === order.grandTotal,
  formatINR(order.grandTotal, true),
);
check(
  'every line snapshotted a rate',
  order.items.every((item) => item.ratePerGram > 0n),
);
check('rates snapshot stored', order.ratesSnapshot !== null);
check(
  'hallmark and BIS snapshotted',
  order.items[0]?.hallmarkNo === 'HUID-AB12CD' &&
    order.items[0]?.bisCertNo === 'BIS-99881',
);

const gst = splitGst(order.gstAmount);
check(
  'CGST + SGST === total GST',
  gst.cgst + gst.sgst === order.gstAmount,
  `${formatINR(gst.cgst, true)} + ${formatINR(gst.sgst, true)}`,
);

// ── 2. The client cannot submit a total ─────────────────────────────────────

console.log('\n2. Price tampering');

const tampered = createBillSchema.safeParse({
  customerName: 'Attacker',
  customerPhone: PHONE,
  note: '',
  items,
  grandTotal: '1',
});
check('a client-submitted grandTotal is rejected', !tampered.success);

const tamperedRate = createBillSchema.safeParse({
  customerName: 'Attacker',
  customerPhone: PHONE,
  note: '',
  items: [{ ...items[1], ratePerGram: '1' }],
});
check('a client-submitted ratePerGram is rejected', !tamperedRate.success);

// ── 3. The PDF ──────────────────────────────────────────────────────────────

console.log('\n3. Invoice PDF');

check('a PDF key was assigned', Boolean(order.billPdfKey), order.billPdfKey ?? 'none');
check(
  'bytes were stored',
  (order.billPdf?.byteSize ?? 0) > 1000,
  `${order.billPdf?.byteSize} bytes`,
);

const oneItem = await renderBillPdf({ ...order, items: order.items.slice(0, 1) });
const twentyItems = await renderBillPdf({
  ...order,
  items: Array.from({ length: 20 }, (_, index) => ({
    ...order.items[index % order.items.length]!,
    name: `Piece ${index + 1} — a deliberately long description to test wrapping`,
  })),
});

check('1-item PDF renders', oneItem.subarray(0, 5).toString() === '%PDF-');
check('20-item PDF renders', twentyItems.subarray(0, 5).toString() === '%PDF-');
check(
  '20 items spill onto a second page',
  (twentyItems.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length >= 2,
);
check(
  'no unrenderable rupee sign reached the page',
  !twentyItems.toString('latin1').includes('₹'),
);

const realPath = join(tmpdir(), `${order.orderNo}.pdf`);
const longPath = join(tmpdir(), `${order.orderNo}-20-items.pdf`);
writeFileSync(realPath, await renderBillPdf(order));
writeFileSync(longPath, twentyItems);
console.log(`  → invoices written to ${realPath}\n    and ${longPath}`);

// ── 4. Amount in words ──────────────────────────────────────────────────────

console.log('\n4. Amount in words');

const wordCases: [bigint, string][] = [
  [100n, 'One Rupee Only'],
  [10_000n, 'One Hundred Rupees Only'],
  [10_000_000n, 'One Lakh Rupees Only'],
  [1_000_000_000n, 'One Crore Rupees Only'],
  [
    7_099_350n,
    'Seventy Thousand Nine Hundred and Ninety-Three Rupees and Fifty Paise Only',
  ],
];
for (const [paise, expected] of wordCases) {
  const actual = amountInWords(paise);
  check(`${formatINR(paise, true)}`, actual === expected, actual);
}

// ── 5. Concurrency — §8 TEST's hard case ────────────────────────────────────

console.log('\n5. Fifty concurrent bills');

const concurrent = await Promise.all(
  Array.from({ length: 50 }, () =>
    createBill(
      { customerName: 'Load', customerPhone: PHONE, note: '', items: [items[1]!] },
      { adminId: admin.id, customerPhone: PHONE },
    ),
  ),
);

const numbers = concurrent.flatMap((result) => (result.ok ? [result.orderNo] : []));
check('all 50 succeeded', numbers.length === 50, `${numbers.length}/50`);
check('all 50 numbers are unique', new Set(numbers).size === numbers.length);

const sequences = numbers.map((no) => Number(no.split('-')[2])).sort((a, b) => a - b);
const gapless = sequences.every(
  (value, index) => index === 0 || value === sequences[index - 1]! + 1,
);
check('the sequence has no gaps', gapless, `${sequences[0]}–${sequences.at(-1)}`);

// ── 6. Idempotency ──────────────────────────────────────────────────────────

console.log('\n6. Idempotency');

const key = `verify-${Date.now()}`;
const first = await createBill(parsed.data, {
  adminId: admin.id,
  customerPhone: PHONE,
  idempotencyKey: key,
});
const second = await createBill(parsed.data, {
  adminId: admin.id,
  customerPhone: PHONE,
  idempotencyKey: key,
});
check(
  'the same key twice returns one order',
  first.ok && second.ok && first.orderId === second.orderId,
);
check('the replay is reported as one', second.ok && second.replayed);

const racing = await Promise.all(
  Array.from({ length: 5 }, () =>
    createBill(parsed.data, {
      adminId: admin.id,
      customerPhone: PHONE,
      idempotencyKey: `verify-race-${key}`,
    }),
  ),
);
const raceIds = new Set(racing.flatMap((r) => (r.ok ? [r.orderId] : [])));
check('five simultaneous requests with one key create one order', raceIds.size === 1);

// ── 7. Linking rules ────────────────────────────────────────────────────────

console.log('\n7. Auto-link on a verified phone');

check('a bill for an unknown phone is unclaimed', order.voidedAt === null);
const unclaimed = await db.order.findUnique({
  where: { id: created.orderId },
  select: { userId: true },
});
check('userId is null when nobody has verified that number', unclaimed?.userId === null);

const unverified = await db.user.upsert({
  where: { phone: PHONE },
  update: { phoneVerified: false },
  create: { phone: PHONE, phoneVerified: false, name: 'Unverified' },
  select: { id: true },
});
const againstUnverified = await createBill(parsed.data, {
  adminId: admin.id,
  customerPhone: PHONE,
});
const unverifiedOrder = againstUnverified.ok
  ? await db.order.findUnique({
      where: { id: againstUnverified.orderId },
      select: { userId: true },
    })
  : null;
check('an UNVERIFIED matching phone does not link', unverifiedOrder?.userId === null);

await db.user.update({ where: { id: unverified.id }, data: { phoneVerified: true } });
const againstVerified = await createBill(parsed.data, {
  adminId: admin.id,
  customerPhone: PHONE,
});
const verifiedOrder = againstVerified.ok
  ? await db.order.findUnique({
      where: { id: againstVerified.orderId },
      select: { userId: true },
    })
  : null;
check('a VERIFIED matching phone links', verifiedOrder?.userId === unverified.id);

// ── 8. The WhatsApp message ─────────────────────────────────────────────────

console.log('\n8. WhatsApp deep link');

const pdfUrl = `https://example.test${signedBillPath(order.billPdfKey!, new Date(Date.now() + 86_400_000))}`;
const sendInput = {
  phone: PHONE,
  customerName: 'Priya & Sons 🙏 <b>',
  shopName: 'Tirupati Jewelles',
  orderNo: order.orderNo,
  total: order.grandTotal,
  pdfUrl,
  siteUrl: 'https://example.test',
};

const sent = await new DeepLinkSender().sendBill(sendInput);
check(
  'the deep-link sender returns a manual send',
  sent.ok && sent.delivery === 'manual',
);

if (sent.ok && sent.delivery === 'manual') {
  const round = parseWhatsAppUrl(sent.url);
  check(
    'the URL decodes back to the intended message',
    round?.message === buildBillMessage(sendInput),
  );
  check(
    'the ampersand survived encoding',
    round?.message.includes('Priya & Sons') === true,
  );
  check('the emoji survived encoding', round?.message.includes('🙏') === true);
  check('the phone is digits only in the path', round?.phone === '919000000001');
  check(
    'nothing broke out of text=',
    new URL(sent.url).searchParams.get('text') !== null,
  );
  check('the PDF link is inside the message', round?.message.includes(pdfUrl) === true);
}

// ── 9. Signed bill URLs ─────────────────────────────────────────────────────

console.log('\n9. Signed PDF URLs');

const validKey = order.billPdfKey!;
const future = new Date(Date.now() + 86_400_000);
const url = new URL(`https://example.test${signedBillPath(validKey, future)}`);
const e = url.searchParams.get('e');
const s = url.searchParams.get('s');

check('a fresh signature verifies', verifyBillSignature(validKey, e, s) === 'valid');
check('no signature is "absent"', verifyBillSignature(validKey, null, null) === 'absent');
check(
  'a tampered signature is invalid',
  verifyBillSignature(validKey, e, `${s!.slice(0, -1)}x`) === 'invalid',
);
check(
  'a signature for another key is invalid',
  verifyBillSignature(newBillKey(), e, s) === 'invalid',
);
check(
  'extending the expiry invalidates it',
  verifyBillSignature(validKey, String(Number(e) + 3600), s) === 'invalid',
);

const pastUrl = new URL(
  `https://example.test${signedBillPath(validKey, new Date(Date.now() - 1000))}`,
);
check(
  'an expired signature is reported expired',
  verifyBillSignature(
    validKey,
    pastUrl.searchParams.get('e'),
    pastUrl.searchParams.get('s'),
  ) === 'expired',
);

// ── Done ────────────────────────────────────────────────────────────────────

const createdCount = await db.order.count({ where: { customerPhone: PHONE } });

if (failures === 0) {
  // Clean up on success only. A failed run leaves its evidence in the database to look at.
  await db.order.deleteMany({ where: { customerPhone: PHONE } });
  await db.user.deleteMany({ where: { phone: PHONE } });
  console.log(`\nCleaned up ${createdCount} fixture orders on ${PHONE}.`);
} else {
  console.log(
    `\nLeft behind for inspection: ${createdCount} orders on ${PHONE}. Remove with:\n` +
      `  DELETE FROM "Order" WHERE "customerPhone" = '${PHONE}';\n` +
      `  DELETE FROM "User" WHERE phone = '${PHONE}';`,
  );
}

/**
 * The invoice numbers this run consumed are gone for good.
 *
 * That is the correct behaviour, not a bug: §8.2's counter hands out a number inside the
 * transaction, and deleting the order afterwards cannot give it back. Said out loud because
 * a gap in a numbered invoice series is exactly the thing an accountant asks about.
 */
console.log('Note: this run consumed invoice numbers. Do not run it against production.');

console.log(
  failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) FAILED.\n`,
);

await db.$disconnect();
process.exit(failures === 0 ? 0 : 1);
