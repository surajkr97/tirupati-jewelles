/**
 * /account/orders/[id] — one purchase, for the customer who made it.
 * Created by Phase 8 (specs/08-billing-whatsapp.md §8.6).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  §8.6: "full breakdown, ownership-checked."
 *  §8 SECURITY: "Customer A cannot fetch customer B's bill by ID or by PDF key."
 *
 *  This is the one route in the customer-facing app that takes an order id from the URL, so
 *  it is where MASTER-SPEC's IDOR control has to be applied literally: "Every fetch of an
 *  order/bill filters by `userId` from the session, never by an ID from the URL alone."
 *
 *  `userId` is therefore part of the WHERE clause, not a check performed on the result. The
 *  difference is not stylistic — a fetch-then-compare leaves a window for someone to add an
 *  early return, and a query that cannot return another person's row has no such window.
 *  An order belonging to somebody else is `notFound()`, identical to one that never existed.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { Section } from '@/components/shell';
import { Badge, Button, Card } from '@/components/ui';
import { getCurrentUser } from '@/lib/auth/guard';
import { getSignedBillUrl } from '@/lib/bills/storage';
import { halfRateLabel, splitGst } from '@/lib/bills/tax';
import { amountInWords } from '@/lib/bills/words';
import { formatShopDateTime } from '@/lib/datetime';
import { db } from '@/lib/db';
import { formatINR } from '@/lib/money';

/** Per-user, never cached (MASTER-SPEC §6). */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your purchase',
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await getCurrentUser();
  // `proxy.ts` bounces a visitor with no cookie, but that is a UX shortcut and explicitly
  // not the boundary (§3.6).
  if (!user) redirect(`/login?next=/account/orders/${id}`);

  if (!UUID.test(id)) notFound();

  const order = await db.order.findFirst({
    // Both conditions, in one query. The session's user id comes from the server; nothing
    // in this filter comes from the request except the id being scoped by it.
    where: { id, userId: user.id },
    select: {
      orderNo: true,
      createdAt: true,
      customerName: true,
      customerPhone: true,
      note: true,
      subtotal: true,
      gstAmount: true,
      grandTotal: true,
      billPdfKey: true,
      voidedAt: true,
      items: {
        select: {
          id: true,
          name: true,
          purity: true,
          weightMg: true,
          ratePerGram: true,
          makingPct: true,
          stoneCharge: true,
          gstPct: true,
          lineTotal: true,
          hallmarkNo: true,
          bisCertNo: true,
        },
      },
      billPdf: { select: { expiresAt: true } },
    },
  });

  if (!order) notFound();

  const gst = splitGst(order.gstAmount);
  const halfRate = halfRateLabel(order.items.map((item) => Number(item.gstPct)));

  /**
   * A freshly signed link, minted only after the ownership check above passed.
   *
   * The customer does not need it — `/bills/{key}` also accepts their session — but a link
   * that carries its own proof works when they forward it to themselves, save it, or open
   * it on a device where they are not signed in.
   */
  const pdfUrl =
    order.billPdfKey && order.billPdf
      ? await getSignedBillUrl(order.billPdfKey, order.billPdf.expiresAt)
      : null;

  return (
    <Section className="pt-8 md:pt-12">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Link
            href="/account/orders"
            className="text-small font-semibold text-taupe-deep"
          >
            ← Your orders
          </Link>
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <h1 className="text-h1 font-semibold tracking-tight text-ink tabular md:text-h1-lg">
              {order.orderNo}
            </h1>
            <p className="text-h2 font-semibold text-ink tabular">
              {formatINR(order.grandTotal)}
            </p>
          </div>
          <p className="text-small text-muted">{formatShopDateTime(order.createdAt)}</p>
          {order.voidedAt && (
            <div>
              <Badge tone="down">Cancelled</Badge>
            </div>
          )}
        </div>

        <Card className="flex flex-col gap-4">
          <h2 className="text-h3 font-semibold text-ink">What you bought</h2>
          <ul className="flex flex-col gap-4">
            {order.items.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-1 border-b border-line pb-4 last:border-0 last:pb-0"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <p className="text-body font-semibold text-ink">{item.name}</p>
                  <p className="text-body font-semibold text-ink tabular">
                    {formatINR(item.lineTotal, true)}
                  </p>
                </div>
                <p className="text-small text-muted tabular">
                  {String(item.purity).replace('_', ' ')} ·{' '}
                  {(item.weightMg / 1000).toFixed(3).replace(/\.?0+$/, '')}g · rate{' '}
                  {formatINR(item.ratePerGram, true)}/g · making {String(item.makingPct)}%
                </p>
                {(item.hallmarkNo || item.bisCertNo) && (
                  <p className="text-small text-muted">
                    {[
                      item.hallmarkNo ? `HUID ${item.hallmarkNo}` : null,
                      item.bisCertNo ? `BIS ${item.bisCertNo}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
              </li>
            ))}
          </ul>

          {/* The rate is the snapshot from the day of purchase, which is the whole reason
              the breakdown is worth showing: it explains the price rather than restating it. */}
          <dl className="flex flex-col gap-2 border-t border-line pt-4 text-small">
            <Row label="Taxable value" value={formatINR(order.subtotal, true)} />
            <Row
              label={`CGST${halfRate ? ` ${halfRate}%` : ''}`}
              value={formatINR(gst.cgst, true)}
            />
            <Row
              label={`SGST${halfRate ? ` ${halfRate}%` : ''}`}
              value={formatINR(gst.sgst, true)}
            />
            <Row label="Total paid" value={formatINR(order.grandTotal, true)} emphasis />
          </dl>

          <p className="text-small text-muted">{amountInWords(order.grandTotal)}</p>
        </Card>

        {pdfUrl && (
          <div>
            <a href={pdfUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="accent" size="lg">
                Download invoice
              </Button>
            </a>
          </div>
        )}
      </div>
    </Section>
  );
}

function Row({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={
        emphasis
          ? 'flex items-baseline justify-between gap-4 border-t border-line pt-2 text-body font-semibold text-ink'
          : 'flex items-baseline justify-between gap-4'
      }
    >
      <dt className={emphasis ? undefined : 'text-muted'}>{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}
