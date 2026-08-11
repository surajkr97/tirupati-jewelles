/**
 * /admin/bills/[id] — one invoice.
 * Created by Phase 8 (specs/08-billing-whatsapp.md §8.4, §8.5).
 *
 * §8.5: "Detail page: full bill, download PDF, resend, void."
 *
 * The WhatsApp link is built HERE, on the server, and handed to the client island as a
 * finished string. Two reasons, and both matter:
 *
 *   1. The signed PDF URL requires `SESSION_SECRET`. It can never be minted in a browser.
 *   2. §8.4 puts the message behind a `WhatsAppSender` interface so the Cloud API can
 *      replace the deep link later. A client that assembled the URL itself would be a
 *      second implementation, and the swap would miss it.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BillActions } from '@/components/admin/bill-actions';
import { activeClaimToken } from '@/lib/auth/claim-token';
import { Section } from '@/components/shell';
import { Badge, Button, Card } from '@/components/ui';
import { loadShopIdentity } from '@/lib/bills/render';
import { getSignedBillUrl } from '@/lib/bills/storage';
import { halfRateLabel, splitGst } from '@/lib/bills/tax';
import { amountInWords } from '@/lib/bills/words';
import { formatShopDateTime } from '@/lib/datetime';
import { db } from '@/lib/db';
import { clientEnv, env } from '@/lib/env';
import { formatINR } from '@/lib/money';
import { getSender } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Bill' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function BillDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Next 16: route params are async (D-002).
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const order = await db.order.findUnique({
    where: { id },
    select: {
      id: true,
      orderNo: true,
      createdAt: true,
      customerName: true,
      customerPhone: true,
      note: true,
      subtotal: true,
      gstAmount: true,
      grandTotal: true,
      billPdfKey: true,
      sentViaWa: true,
      sentAt: true,
      userId: true,
      voidedAt: true,
      voidReason: true,
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
   * The signed link, cached in Redis for 24h (§8.3).
   *
   * Stable across views, so an admin who opens the bill twice sends the customer the same
   * URL both times rather than two links that expire on different days.
   */
  const pdfUrl =
    order.billPdfKey && order.billPdf
      ? await getSignedBillUrl(order.billPdfKey, order.billPdf.expiresAt)
      : null;

  const shop = await loadShopIdentity();

  let whatsAppUrl: string | null = null;
  let sendBlockedReason: string | null = null;

  if (!pdfUrl) {
    sendBlockedReason =
      'The invoice PDF has not been rendered yet. Use “Re-render invoice” below, then send.';
  } else if (order.voidedAt) {
    sendBlockedReason = 'This bill is void.';
  } else {
    /**
     * The claim link, recovered rather than re-minted (DEBT-011).
     *
     * Null when the number is already verified, or when the token has been used or has
     * expired — in each case the message falls back to the plain `/account/orders` line.
     * Deriving it here rather than storing it is what lets a resend carry the SAME link the
     * customer already has, instead of quietly killing the one in their WhatsApp.
     */
    const claimToken = await activeClaimToken(order.id);

    // §8.4: "Swap via config." The id comes from lib/env.ts, the only file allowed to read
    // the environment.
    const result = await getSender(env.WHATSAPP_SENDER).sendBill({
      phone: order.customerPhone,
      customerName: order.customerName,
      shopName: shop.shopName,
      orderNo: order.orderNo,
      total: order.grandTotal,
      pdfUrl,
      siteUrl: clientEnv.NEXT_PUBLIC_SITE_URL,
      claimUrl: claimToken
        ? `${clientEnv.NEXT_PUBLIC_SITE_URL}/claim/${claimToken}`
        : null,
    });

    if (result.ok && result.delivery === 'manual') {
      whatsAppUrl = result.url;
    } else if (!result.ok) {
      sendBlockedReason = result.error;
    } else {
      sendBlockedReason = 'This bill was delivered automatically.';
    }
  }

  return (
    <Section className="pt-6 pb-0">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Link href="/admin/bills" className="text-small font-semibold text-rose-deep">
            ← All bills
          </Link>
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <h1 className="text-h1 font-semibold tracking-tight text-ink tabular">
              {order.orderNo}
            </h1>
            <p className="text-h2 font-semibold text-ink tabular">
              {formatINR(order.grandTotal)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={order.sentViaWa ? 'up' : 'neutral'}>
              {order.sentViaWa ? 'Sent' : 'Not sent'}
            </Badge>
            <Badge tone={order.userId ? 'up' : 'neutral'}>
              {order.userId ? 'Claimed' : 'Unclaimed'}
            </Badge>
            {order.voidedAt && <Badge tone="down">Void</Badge>}
            <span className="text-small text-muted">
              {formatShopDateTime(order.createdAt)}
            </span>
          </div>
        </div>

        {order.voidedAt && (
          <Card className="flex flex-col gap-1 ring-1 ring-down/40">
            <p className="text-body font-semibold text-down">
              Voided {formatShopDateTime(order.voidedAt)}
            </p>
            {order.voidReason && (
              <p className="text-small text-muted">{order.voidReason}</p>
            )}
          </Card>
        )}

        <Card className="flex flex-col gap-2">
          <h2 className="text-h3 font-semibold text-ink">Customer</h2>
          <p className="text-body text-ink">{order.customerName || 'Walk-in customer'}</p>
          <p className="text-body text-muted tabular">{order.customerPhone}</p>
          {!order.userId && (
            <p className="text-small text-muted">
              Not yet linked to an account. It attaches automatically when this number is
              verified.
            </p>
          )}
          {order.note && <p className="text-small text-muted">Note: {order.note}</p>}
        </Card>

        <Card className="flex flex-col gap-4">
          <h2 className="text-h3 font-semibold text-ink">Items</h2>
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
                  {(item.weightMg / 1000).toFixed(3).replace(/\.?0+$/, '')}g ·{' '}
                  {formatINR(item.ratePerGram, true)}/g · making {String(item.makingPct)}%
                  {item.stoneCharge > 0n && ` · stones ${formatINR(item.stoneCharge)}`}
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

          <dl className="flex flex-col gap-2 border-t border-line pt-4 text-small">
            <TotalRow label="Taxable value" value={formatINR(order.subtotal, true)} />
            <TotalRow
              label={`CGST${halfRate ? ` ${halfRate}%` : ''}`}
              value={formatINR(gst.cgst, true)}
            />
            <TotalRow
              label={`SGST${halfRate ? ` ${halfRate}%` : ''}`}
              value={formatINR(gst.sgst, true)}
            />
            <TotalRow
              label="Grand total"
              value={formatINR(order.grandTotal, true)}
              emphasis
            />
          </dl>

          <p className="text-small text-muted">{amountInWords(order.grandTotal)}</p>
        </Card>

        <Card className="flex flex-col gap-2">
          <h2 className="text-h3 font-semibold text-ink">Invoice PDF</h2>
          {pdfUrl ? (
            <>
              <a href={pdfUrl} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="md">
                  Open PDF
                </Button>
              </a>
              <p className="text-small text-muted">
                {/* The link the customer receives is the same one, and it expires. Saying so
                    stops "the link stopped working" becoming a mystery months later. */}
                This link expires{' '}
                {order.billPdf ? formatShopDateTime(order.billPdf.expiresAt) : 'shortly'}.
                Re-render the invoice to issue a fresh one.
              </p>
            </>
          ) : (
            <p className="text-body text-muted">Not rendered yet.</p>
          )}
        </Card>

        <BillActions
          orderId={order.id}
          orderNo={order.orderNo}
          whatsAppUrl={whatsAppUrl}
          sendBlockedReason={sendBlockedReason}
          sentAtLabel={order.sentAt ? formatShopDateTime(order.sentAt) : null}
          voided={Boolean(order.voidedAt)}
        />
      </div>
    </Section>
  );
}

function TotalRow({
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
