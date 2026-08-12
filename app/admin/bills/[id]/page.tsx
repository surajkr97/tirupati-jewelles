/**
 * /admin/bills/[id] — one invoice.
 * Created by Phase 8 (specs/08-billing-whatsapp.md §8.4, §8.5), redesigned by Stage 5E.
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
 *
 * ── Stage 5E: the screen shows what the invoice shows ──
 *
 * §7 asks for identity → customer → items → rate snapshot → charges → GST → total, and this
 * page had three of those. The metal/making/stone split and the rate reference block existed
 * only inside `lib/bills/render.ts`, so an admin asking "where did ₹68,920 of this go?" or
 * "what rate did we bill at?" had to open the PDF and read it there.
 *
 * Both now come from `splitStoredLine` and `billRateReference` — the same functions the
 * invoice is built from, exported rather than re-implemented. §9 forbids recalculating the
 * total in the UI and nothing here does: every figure is either stored on the order or
 * recovered from the line's own snapshot by the engine, and the recovery asserts itself
 * against the stored line total.
 *
 * ── When the bill disagrees with itself ──
 *
 * `splitStoredLine` throws if a stored `lineTotal` does not match its own inputs, which is
 * what stops a corrupt invoice being printed. A screen must not 500 on the same condition —
 * this is the one page an admin would open to investigate it — so the split is attempted,
 * and on failure the page falls back to the stored figures and says plainly that the
 * breakdown cannot be shown. The stored total is authoritative either way.
 */
import { ArrowLeft, Ban, ExternalLink, FileText, Send } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { Metadata } from 'next';

import { BillActions } from '@/components/admin/bill-actions';
import { Section } from '@/components/shell';
import { Badge, buttonClasses, Card } from '@/components/ui';
import { activeClaimToken } from '@/lib/auth/claim-token';
import {
  billRateReference,
  BILL_PURITY_LABEL,
  loadShopIdentity,
  splitStoredLine,
} from '@/lib/bills/render';
import { getSignedBillUrl } from '@/lib/bills/storage';
import { halfRateLabel, splitGst } from '@/lib/bills/tax';
import { amountInWords } from '@/lib/bills/words';
import { formatShopDateTime } from '@/lib/datetime';
import { db } from '@/lib/db';
import { clientEnv, env } from '@/lib/env';
import { formatINR } from '@/lib/money';
import { getSender } from '@/lib/whatsapp';

import type { PurityKey, LineResult } from '@/lib/pricing';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Bill' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Grams from integer milligrams, trailing zeros trimmed — the invoice's own formatting. */
function grams(weightMg: number): string {
  return (weightMg / 1000).toFixed(3).replace(/\.?0+$/, '') || '0';
}

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
      // Stage 5E: `metal` feeds the split, `ratesSnapshot`/`ratesAt` the §7 rate block.
      ratesSnapshot: true,
      ratesAt: true,
      items: {
        select: {
          id: true,
          name: true,
          metal: true,
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
  const rateReference = billRateReference(order);

  /**
   * The per-line split, recovered from each line's own snapshot.
   *
   * Two ways this can be untrustworthy, and both end in the same fallback: a line whose
   * stored total disagrees with its inputs (which `splitStoredLine` throws on), or component
   * values that do not add up to the stored taxable total. Showing a breakdown that does not
   * reconcile with the figure beneath it is worse than showing no breakdown, because it
   * invites an admin to check the arithmetic and find it wrong.
   */
  let lines: LineResult[] | null = null;
  try {
    const split = order.items.map((item) => splitStoredLine(item, order.orderNo));
    const components = split.reduce(
      (sum, line) => sum + line.metalValue + line.makingCharge + line.stoneCharge,
      0n,
    );
    lines = components === order.subtotal ? split : null;
  } catch {
    lines = null;
  }

  const metalTotal = lines?.reduce((sum, line) => sum + line.metalValue, 0n) ?? 0n;
  const makingTotal = lines?.reduce((sum, line) => sum + line.makingCharge, 0n) ?? 0n;
  const stoneTotal = lines?.reduce((sum, line) => sum + line.stoneCharge, 0n) ?? 0n;

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
      {/* §23 — a bill is a document, and a document has a measure. Grouping stays legible at
          1440px instead of one invoice line stretched across the whole screen. */}
      <div className="flex max-w-3xl flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Link
            href="/admin/bills"
            className="flex h-tap w-fit items-center gap-2 text-small font-semibold text-rose-deep hover:underline"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            All bills
          </Link>

          {/* The heading is the invoice number and nothing else — it is the identifier the
              shop and the customer both quote. */}
          <h1 className="text-h1 font-semibold tracking-tight text-ink num">
            {order.orderNo}
          </h1>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <time
              dateTime={order.createdAt.toISOString()}
              className="text-small text-muted num"
            >
              {formatShopDateTime(order.createdAt)}
            </time>

            {/*
              §5 — the exceptions are badged; the ordinary outcomes are stated. A void bill
              says so first, because nothing else on the page matters as much.
            */}
            {order.voidedAt ? (
              <Badge tone="down">
                <Ban className="size-4" aria-hidden="true" />
                Void
              </Badge>
            ) : !order.sentViaWa ? (
              <Badge tone="outline">
                <Send className="size-4" aria-hidden="true" />
                Not sent
              </Badge>
            ) : (
              <span className="text-small text-muted">
                Sent{order.sentAt ? ` ${formatShopDateTime(order.sentAt)}` : ''}
              </span>
            )}

            {/*
              The list, the filter and this line all say "Claimed"/"Unclaimed".

              An earlier draft read "Not claimed yet" here, which is friendlier and was
              wrong: the filter above it offers "Unclaimed only", and a screen that uses two
              words for one state makes an admin wonder whether they are two states. What
              the word MEANS is explained once, in the customer card below.
            */}
            <span className="text-small text-muted">
              {order.userId ? 'Claimed' : 'Unclaimed'}
            </span>
          </div>
        </div>

        {/*
          §9 — impossible to miss.

          `md:text-display`, not `text-display` outright: DEBT-038 measured a ₹1000-crore
          figure overflowing a 375px tile, and a wedding-set invoice is the one bill where
          the number is genuinely long.
        */}
        <Card className="flex flex-col gap-1">
          <p className="text-small font-medium tracking-[0.08em] text-muted uppercase">
            Total charged
          </p>
          <p className="text-h1 font-semibold text-ink num md:text-display">
            {formatINR(order.grandTotal, true)}
          </p>
          <p className="text-small text-muted">{amountInWords(order.grandTotal)}</p>
        </Card>

        {order.voidedAt && (
          <Card className="flex flex-col gap-1 ring-1 ring-down/40">
            <p className="text-body font-semibold text-down">
              Voided {formatShopDateTime(order.voidedAt)}
            </p>
            {order.voidReason && (
              <p className="text-small text-muted">{order.voidReason}</p>
            )}
            <p className="text-small text-muted">
              The invoice and its number are kept — the law requires that — and it is
              excluded from every sales total.
            </p>
          </Card>
        )}

        {/* §10 — name, phone, and the claim state. Nothing else about the person. */}
        <Card className="flex flex-col gap-2">
          <h2 className="text-h3 font-semibold text-ink">Customer</h2>
          <p className="text-body text-ink">
            {order.customerName || 'Walk-in customer — no name taken'}
          </p>
          <p className="text-body text-muted num">{order.customerPhone}</p>
          {!order.userId && (
            <p className="text-small text-muted">
              Not yet linked to an account. It attaches automatically when this number is
              verified.
            </p>
          )}
          {order.note && (
            <p className="text-small text-muted">
              Note: <span className="text-ink">{order.note}</span>
            </p>
          )}
        </Card>

        <Card className="flex flex-col gap-6">
          <h2 className="text-h3 font-semibold text-ink">Items</h2>

          {lines === null && (
            <p
              role="alert"
              className="rounded-field bg-down/10 px-4 py-4 text-small text-down"
            >
              The saved totals on this bill do not match the rate and weight recorded
              against its lines, so the metal and making breakdown is not shown. The amounts
              below are what was stored and charged. Re-rendering the invoice will fail
              until this is looked at.
            </p>
          )}

          <ul className="flex flex-col gap-6">
            {order.items.map((item, index) => {
              const line = lines?.[index] ?? null;
              const purity = item.purity as PurityKey;

              return (
                <li
                  key={item.id}
                  className="flex flex-col gap-2 border-b border-line pb-6 last:border-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className="text-body font-semibold text-ink">{item.name}</p>
                    <p className="text-body font-semibold text-ink num">
                      {formatINR(item.lineTotal, true)}
                    </p>
                  </div>

                  {/* §8 — purity, weight and the snapshotted rate, each with its unit. */}
                  <p className="text-small text-muted">
                    {BILL_PURITY_LABEL[purity] ?? String(item.purity)} ·{' '}
                    <span className="num">{grams(item.weightMg)}</span> g at{' '}
                    <span className="num">{formatINR(item.ratePerGram, true)}</span>/g
                  </p>

                  {line && (
                    <dl className="flex flex-col gap-1 rounded-field bg-cream p-4 text-small">
                      <Row label="Metal value" value={formatINR(line.metalValue, true)} />
                      {/* §9 — no invented zero rows. A piece with no making charge does
                          not get a "Making ₹0.00" line to keep the table tidy. */}
                      {line.makingCharge > 0n && (
                        <Row
                          label={`Making ${String(item.makingPct).replace(/\.?0+$/, '')}%`}
                          value={formatINR(line.makingCharge, true)}
                        />
                      )}
                      {line.stoneCharge > 0n && (
                        <Row
                          label="Stones and other"
                          value={formatINR(line.stoneCharge, true)}
                        />
                      )}
                      <Row
                        label="Taxable value"
                        value={formatINR(line.subtotal, true)}
                        emphasis
                      />
                      <Row
                        label={`GST ${String(item.gstPct).replace(/\.?0+$/, '')}%`}
                        value={formatINR(line.gstAmount, true)}
                      />
                    </dl>
                  )}

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
              );
            })}
          </ul>
        </Card>

        {/*
          §7's rate snapshot.

          §8.2 stores every purity's rate at bill time so the invoice is defensible months
          later; the PDF has always printed it and the screen never did. Same function, so
          the two cannot drift.
        */}
        {rateReference.length > 0 && (
          <Card className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-h3 font-semibold text-ink">Rates applied</h2>
              <p className="text-small text-muted">
                What the shop was quoting when this bill was raised
                {order.ratesAt && (
                  <>
                    , on{' '}
                    <time dateTime={order.ratesAt.toISOString()} className="num">
                      {formatShopDateTime(order.ratesAt)}
                    </time>
                  </>
                )}
                . These are frozen — changing today&rsquo;s rates never changes this bill.
              </p>
            </div>
            <dl className="flex flex-col gap-2 text-small">
              {rateReference.map((rate) => (
                <Row
                  key={rate.label}
                  label={`${rate.label} ${rate.unit}`}
                  value={formatINR(rate.amount)}
                />
              ))}
            </dl>
          </Card>
        )}

        {/* §9 — where the money went, ending in the figure at the top of the page. */}
        <Card className="flex flex-col gap-4">
          <h2 className="text-h3 font-semibold text-ink">Charges</h2>

          <dl className="flex flex-col gap-2 text-body">
            {lines && (
              <>
                <Row label="Metal value" value={formatINR(metalTotal, true)} />
                {makingTotal > 0n && (
                  <Row label="Making charges" value={formatINR(makingTotal, true)} />
                )}
                {stoneTotal > 0n && (
                  <Row label="Stones and other" value={formatINR(stoneTotal, true)} />
                )}
              </>
            )}
            <Row
              label="Taxable value"
              value={formatINR(order.subtotal, true)}
              emphasis={Boolean(lines)}
            />
            <Row
              label={`CGST${halfRate ? ` ${halfRate}%` : ''}`}
              value={formatINR(gst.cgst, true)}
            />
            <Row
              label={`SGST${halfRate ? ` ${halfRate}%` : ''}`}
              value={formatINR(gst.sgst, true)}
            />

            <div className="flex items-baseline justify-between gap-4 border-t border-line pt-4">
              <dt className="text-h3 font-semibold text-ink">Total</dt>
              <dd className="text-h3 font-semibold text-ink num">
                {formatINR(order.grandTotal, true)}
              </dd>
            </div>
          </dl>
        </Card>

        <Card className="flex flex-col gap-4">
          <h2 className="text-h3 font-semibold text-ink">Invoice PDF</h2>
          {pdfUrl ? (
            <>
              {/*
                A plain anchor wearing the button's classes.

                It used to be `<a><Button/></a>` — a `<button>` inside a link, which is
                interactive content the anchor's content model forbids, and two tab stops for
                one action. `buttonClasses` exists precisely so a server-rendered link can
                look identical without being one (UI_REDESIGN_DEBT-003, closed in Stage 1).
              */}
              <a
                href={pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClasses({
                  variant: 'outline',
                  size: 'md',
                  className: 'w-fit',
                })}
              >
                <FileText className="size-4" aria-hidden="true" />
                Open PDF
                <ExternalLink className="size-4" aria-hidden="true" />
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
            <p className="text-body text-muted">
              Not rendered yet. Use <strong>Re-render invoice</strong> below — the bill
              cannot be sent until there is a PDF to send.
            </p>
          )}
        </Card>

        <BillActions
          orderId={order.id}
          orderNo={order.orderNo}
          totalLabel={formatINR(order.grandTotal)}
          customerLabel={order.customerName || order.customerPhone}
          whatsAppUrl={whatsAppUrl}
          sendBlockedReason={sendBlockedReason}
          sentAtLabel={order.sentAt ? formatShopDateTime(order.sentAt) : null}
          voided={Boolean(order.voidedAt)}
        />
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
          ? 'flex items-baseline justify-between gap-4 border-t border-line pt-2 font-semibold text-ink'
          : 'flex items-baseline justify-between gap-4'
      }
    >
      <dt className={emphasis ? undefined : 'text-muted'}>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}
