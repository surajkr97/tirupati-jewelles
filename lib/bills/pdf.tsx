/**
 * The invoice PDF.
 * Created by Phase 8 (specs/08-billing-whatsapp.md §8.3).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  §8.3: "A4, and it must look like the shop's brand, not a receipt printer."
 *  §8 DESIGN: "PDF looks like a premium jeweller's invoice, not a system printout."
 *
 *  Everything on this page is a value that was already computed and stored. Nothing here
 *  multiplies, divides or rounds — the renderer is a formatter, and a formatter that
 *  arrives at its own totals is how a PDF ends up disagreeing with the screen that produced
 *  it. §5: "Three implementations of GST rounding is three different totals on the same
 *  purchase, and the customer will find it."
 *
 *  ── Typography ──
 *  Set in Helvetica, one of the fourteen PDF base fonts, rather than the site's Inter. The
 *  colours, the scale and the spacing are all design tokens; the family is not, and D-027
 *  records why: embedding Inter means committing a font binary and resolving its path at
 *  runtime, and the one thing it would buy — the `₹` glyph — is handled by writing `Rs.`,
 *  which is what Indian tax invoices print anyway.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import {
  Document,
  Font,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
  type DocumentProps,
} from '@react-pdf/renderer';

import { splitGst } from '@/lib/bills/tax';
import { amountInWords } from '@/lib/bills/words';
import { COLORS } from '@/lib/design/tokens';
import { formatAmountDigits, formatRupeesAscii } from '@/lib/money';

// ── The data the document renders (all of it already stored) ───────────────

export interface BillPdfItem {
  name: string;
  purityLabel: string;
  /** Grams, formatted — `8.475`. */
  weight: string;
  ratePerGram: bigint;
  metalValue: bigint;
  makingPct: string;
  makingCharge: bigint;
  stoneCharge: bigint;
  /** Metal + making + stones. The GST base, before tax. */
  taxableValue: bigint;
  hallmarkNo: string | null;
  bisCertNo: string | null;
}

export interface BillPdfRate {
  label: string;
  /** Already in the display unit — per 10g for gold, per kg for silver. */
  amount: bigint;
  unit: string;
}

export interface BillPdfData {
  shopName: string;
  address: string | null;
  gstin: string | null;
  contactPhone: string | null;
  logo: { data: Buffer; format: 'png' | 'jpg' } | null;

  orderNo: string;
  issuedOn: string;
  customerName: string | null;
  customerPhone: string;
  note: string | null;

  /** §8.3's rate reference block. */
  ratesAppliedOn: string;
  rates: BillPdfRate[];

  items: BillPdfItem[];
  taxableTotal: bigint;
  gstTotal: bigint;
  grandTotal: bigint;
  /** `1.5` on a 3% bill; null when the lines carry different GST rates. */
  halfRate: string | null;

  /** §8.5: a voided invoice is kept and marked, never deleted. */
  voidedOn: string | null;
  buybackPolicy: string;
}

/**
 * Turn off hyphenation.
 *
 * `@react-pdf/renderer` hyphenates by default, and on a live render it broke a jewellery
 * name as "deliberate-ly" — its dictionary is English prose, and a product name is a proper
 * noun. Wrong hyphenation on an invoice reads as carelessness. The callback returning the
 * whole word unsplit is the documented way to disable it.
 */
Font.registerHyphenationCallback((word) => [word]);

// ── Layout ─────────────────────────────────────────────────────────────────

/**
 * Column weights, not point widths.
 *
 * Ten columns across A4 is tight, so they are proportional and the description takes the
 * slack. Money columns carry no `Rs.` — the header says `(Rs.)` once, which buys back about
 * 28pt per column and is what makes the table fit without shrinking the type below legible.
 */
const COLUMNS = {
  index: 0.5,
  // Widened from 3.4/1.2 after a render: "Silver (999)" wrapped onto two lines, which made
  // a silver row a third taller than a gold one for no reason.
  description: 3.0,
  purity: 1.6,
  weight: 1.1,
  rate: 1.5,
  metal: 1.7,
  makingPct: 0.9,
  making: 1.5,
  stone: 1.3,
  taxable: 1.8,
} as const;

/**
 * Room reserved at the bottom of every page for the fixed footer.
 *
 * The footer is absolutely positioned 24pt from the bottom edge, so it does NOT push
 * content out of its way — the page's padding is the only thing that keeps a table row from
 * printing underneath the terms block. At the first value tried (56) the last row of a
 * spilling 20-item bill did exactly that.
 *
 * Exported because it is a contract between two independent pieces of this file, and
 * `pdf.test.ts` measures the rendered footer's real extent and asserts this clears it. A
 * comment saying "about 52pt" is a claim; that test is a check.
 */
export const PAGE_BOTTOM_PADDING = 84;

const styles = StyleSheet.create({
  page: {
    paddingTop: 32,
    paddingBottom: PAGE_BOTTOM_PADDING,
    paddingHorizontal: 32,
    fontFamily: 'Helvetica',
    fontSize: 8,
    color: COLORS.ink,
    backgroundColor: COLORS.white,
  },

  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', gap: 16 },
  logo: { width: 120, maxHeight: 44, objectFit: 'contain' },
  wordmark: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: COLORS.ink },
  shopBlock: { flex: 1 },
  shopMeta: { fontSize: 8, color: COLORS.muted, marginTop: 3, lineHeight: 1.5 },
  invoiceBlock: { alignItems: 'flex-end', width: 170 },
  invoiceTitle: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 1.6,
    color: COLORS.roseDeep,
  },
  invoiceMeta: { fontSize: 8, color: COLORS.muted, marginTop: 4, textAlign: 'right' },
  invoiceNo: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 2 },

  rule: { borderBottomWidth: 1, borderBottomColor: COLORS.roseTint, marginVertical: 12 },
  hairline: { borderBottomWidth: 0.6, borderBottomColor: COLORS.line },

  // Parties + rate reference
  panels: { flexDirection: 'row', gap: 16 },
  panel: {
    flex: 1,
    backgroundColor: COLORS.cream,
    borderRadius: 4,
    padding: 10,
  },
  panelLabel: {
    fontSize: 7,
    letterSpacing: 1,
    color: COLORS.muted,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 4,
  },
  panelName: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  panelLine: { fontSize: 8, color: COLORS.muted, marginTop: 2 },
  rateRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },

  // Items
  sectionTitle: {
    fontSize: 7,
    letterSpacing: 1,
    color: COLORS.muted,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 6,
  },
  tableHead: {
    flexDirection: 'row',
    backgroundColor: COLORS.cream,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.roseTint,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  /**
   * `paddingRight` on every cell, not a `gap` on the row.
   *
   * Flex children with no gutter butt against each other, and on a live render a long
   * description ran straight into the purity column: "…description to test wrapping22K
   * (916)". A gap would work too, but padding survives the columns being reordered.
   */
  headCell: {
    fontSize: 6.5,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.muted,
    paddingRight: 6,
  },
  row: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderBottomWidth: 0.6,
    borderBottomColor: COLORS.line,
  },
  cell: { fontSize: 8, paddingRight: 6 },
  right: { textAlign: 'right' },
  itemName: { fontSize: 8.5, fontFamily: 'Helvetica-Bold' },
  itemMeta: { fontSize: 6.5, color: COLORS.muted, marginTop: 2 },

  // Totals
  totals: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 },
  totalsBox: { width: 240 },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  totalLabel: { fontSize: 8, color: COLORS.muted },
  totalValue: { fontSize: 8, textAlign: 'right' },
  grandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
    paddingVertical: 7,
    paddingHorizontal: 8,
    backgroundColor: COLORS.roseTint,
    borderRadius: 4,
  },
  grandLabel: { fontSize: 9, fontFamily: 'Helvetica-Bold' },
  grandValue: { fontSize: 12, fontFamily: 'Helvetica-Bold', textAlign: 'right' },

  words: {
    marginTop: 10,
    padding: 9,
    borderWidth: 0.6,
    borderColor: COLORS.roseTint,
    borderRadius: 4,
  },
  wordsLabel: { fontSize: 6.5, letterSpacing: 1, color: COLORS.muted },
  wordsValue: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    marginTop: 3,
    lineHeight: 1.4,
  },

  note: { marginTop: 10, fontSize: 8, color: COLORS.muted, lineHeight: 1.5 },

  // Footer
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 32,
    right: 32,
    borderTopWidth: 0.6,
    borderTopColor: COLORS.line,
    paddingTop: 6,
  },
  footerText: { fontSize: 6.5, color: COLORS.muted, lineHeight: 1.5 },
  pageNumber: { fontSize: 6.5, color: COLORS.muted, textAlign: 'right', marginTop: 2 },

  voided: {
    marginTop: 10,
    padding: 8,
    borderWidth: 1,
    borderColor: COLORS.down,
    borderRadius: 4,
  },
  voidedText: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: COLORS.down },
});

// ── The document ───────────────────────────────────────────────────────────

export function BillDocument({
  bill,
}: {
  bill: BillPdfData;
}): React.ReactElement<DocumentProps> {
  const gst = splitGst(bill.gstTotal);
  const taxLabel = bill.halfRate ? ` ${bill.halfRate}%` : '';

  return (
    <Document
      title={`Invoice ${bill.orderNo}`}
      author={bill.shopName}
      subject={`Tax invoice ${bill.orderNo}`}
      creator={bill.shopName}
      producer={bill.shopName}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.shopBlock}>
            {bill.logo ? (
              /*
               * `jsx-a11y/alt-text` does not apply: @react-pdf/renderer's `Image` is a PDF
               * drawing primitive, not an `<img>`. It accepts no `alt` prop, and PDF
               * alternate text lives in structure tags the library does not expose. The
               * shop name is printed as text immediately below, so nothing the logo carries
               * exists only inside the image.
               */
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image
                style={styles.logo}
                src={{ data: bill.logo.data, format: bill.logo.format }}
              />
            ) : (
              // No logo configured, or it could not be fetched. A wordmark is a deliberate
              // design, not a placeholder — an empty box at the top of an invoice is not.
              <Text style={styles.wordmark}>{bill.shopName}</Text>
            )}

            <Text style={styles.shopMeta}>
              {[
                bill.logo ? bill.shopName : null,
                bill.address,
                bill.gstin ? `GSTIN: ${bill.gstin}` : null,
                bill.contactPhone ? `Phone: ${bill.contactPhone}` : null,
              ]
                .filter(Boolean)
                .join('\n')}
            </Text>
          </View>

          <View style={styles.invoiceBlock}>
            <Text style={styles.invoiceTitle}>TAX INVOICE</Text>
            <Text style={styles.invoiceNo}>{bill.orderNo}</Text>
            <Text style={styles.invoiceMeta}>Dated {bill.issuedOn}</Text>
          </View>
        </View>

        <View style={styles.rule} />

        <View style={styles.panels}>
          <View style={styles.panel}>
            <Text style={styles.panelLabel}>BILLED TO</Text>
            <Text style={styles.panelName}>
              {bill.customerName || 'Walk-in customer'}
            </Text>
            <Text style={styles.panelLine}>{bill.customerPhone}</Text>
          </View>

          {/*
            §8.3: "Rate reference block ... this is what makes the bill defensible months
            later." Every rate the shop was quoting that day, not only the ones on this
            bill — the question a customer asks in 2031 is "what was gold that morning?",
            and the answer has to be on the paper.
          */}
          <View style={styles.panel}>
            <Text style={styles.panelLabel}>RATES APPLIED ON {bill.ratesAppliedOn}</Text>
            {bill.rates.map((rate) => (
              <View key={rate.label} style={styles.rateRow}>
                <Text style={styles.panelLine}>
                  {rate.label} {rate.unit}
                </Text>
                <Text style={styles.panelLine}>
                  {formatRupeesAscii(rate.amount, false)}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {bill.voidedOn && (
          <View style={styles.voided}>
            <Text style={styles.voidedText}>
              VOID — cancelled on {bill.voidedOn}. This invoice is not payable.
            </Text>
          </View>
        )}

        <View style={styles.rule} />

        <Text style={styles.sectionTitle}>ITEMS</Text>

        {/* `fixed` repeats the header on every page — a 20-item bill spills, and a
            continuation page of unlabelled numbers is unreadable. */}
        <View style={styles.tableHead} fixed>
          <Text style={[styles.headCell, { flex: COLUMNS.index }]}>#</Text>
          <Text style={[styles.headCell, { flex: COLUMNS.description }]}>
            DESCRIPTION
          </Text>
          <Text style={[styles.headCell, { flex: COLUMNS.purity }]}>PURITY</Text>
          <Text style={[styles.headCell, styles.right, { flex: COLUMNS.weight }]}>
            WT (G)
          </Text>
          <Text style={[styles.headCell, styles.right, { flex: COLUMNS.rate }]}>
            RATE/G
          </Text>
          <Text style={[styles.headCell, styles.right, { flex: COLUMNS.metal }]}>
            METAL VALUE
          </Text>
          <Text style={[styles.headCell, styles.right, { flex: COLUMNS.makingPct }]}>
            MK %
          </Text>
          <Text style={[styles.headCell, styles.right, { flex: COLUMNS.making }]}>
            MAKING
          </Text>
          <Text style={[styles.headCell, styles.right, { flex: COLUMNS.stone }]}>
            STONE
          </Text>
          <Text style={[styles.headCell, styles.right, { flex: COLUMNS.taxable }]}>
            TAXABLE (RS.)
          </Text>
        </View>

        {bill.items.map((item, index) => (
          // `wrap={false}` keeps a row and its hallmark line together rather than splitting
          // a piece across a page break.
          <View key={`${item.name}-${index}`} style={styles.row} wrap={false}>
            <Text style={[styles.cell, { flex: COLUMNS.index }]}>{index + 1}</Text>

            <View style={{ flex: COLUMNS.description, paddingRight: 6 }}>
              <Text style={styles.itemName}>{item.name}</Text>
              {/* §8.3: "Hallmark / HUID / BIS numbers per item where present." */}
              {(item.hallmarkNo || item.bisCertNo) && (
                <Text style={styles.itemMeta}>
                  {[
                    item.hallmarkNo ? `HUID ${item.hallmarkNo}` : null,
                    item.bisCertNo ? `BIS ${item.bisCertNo}` : null,
                  ]
                    .filter(Boolean)
                    .join('  ·  ')}
                </Text>
              )}
            </View>

            <Text style={[styles.cell, { flex: COLUMNS.purity }]}>
              {item.purityLabel}
            </Text>
            <Text style={[styles.cell, styles.right, { flex: COLUMNS.weight }]}>
              {item.weight}
            </Text>
            <Text style={[styles.cell, styles.right, { flex: COLUMNS.rate }]}>
              {formatAmountDigits(item.ratePerGram)}
            </Text>
            <Text style={[styles.cell, styles.right, { flex: COLUMNS.metal }]}>
              {formatAmountDigits(item.metalValue)}
            </Text>
            <Text style={[styles.cell, styles.right, { flex: COLUMNS.makingPct }]}>
              {item.makingPct}
            </Text>
            <Text style={[styles.cell, styles.right, { flex: COLUMNS.making }]}>
              {formatAmountDigits(item.makingCharge)}
            </Text>
            <Text style={[styles.cell, styles.right, { flex: COLUMNS.stone }]}>
              {formatAmountDigits(item.stoneCharge)}
            </Text>
            <Text style={[styles.cell, styles.right, { flex: COLUMNS.taxable }]}>
              {formatAmountDigits(item.taxableValue)}
            </Text>
          </View>
        ))}

        {/* The totals and the amount in words must never be orphaned from each other. */}
        <View wrap={false}>
          <View style={styles.totals}>
            <View style={styles.totalsBox}>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Taxable value</Text>
                <Text style={styles.totalValue}>
                  {formatRupeesAscii(bill.taxableTotal)}
                </Text>
              </View>
              <View style={styles.hairline} />
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>CGST{taxLabel}</Text>
                <Text style={styles.totalValue}>{formatRupeesAscii(gst.cgst)}</Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>SGST{taxLabel}</Text>
                <Text style={styles.totalValue}>{formatRupeesAscii(gst.sgst)}</Text>
              </View>

              <View style={styles.grandRow}>
                <Text style={styles.grandLabel}>GRAND TOTAL</Text>
                <Text style={styles.grandValue}>
                  {formatRupeesAscii(bill.grandTotal)}
                </Text>
              </View>
            </View>
          </View>

          {/* §8.3: "grand total in figures and in words ... Amount in words is expected on
              Indian invoices." */}
          <View style={styles.words}>
            <Text style={styles.wordsLabel}>AMOUNT IN WORDS</Text>
            <Text style={styles.wordsValue}>{amountInWords(bill.grandTotal)}</Text>
          </View>
        </View>

        {bill.note && <Text style={styles.note}>Note: {bill.note}</Text>}

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            {bill.buybackPolicy}
            {'\n'}
            Goods once sold are exchanged only as stated above. Weights and purity are as
            assessed at the time of sale. Prices include GST as itemised. E. & O. E.
            {'\n'}
            This is a computer-generated invoice and is valid without a signature.
          </Text>
          <Text
            style={styles.pageNumber}
            render={({ pageNumber, totalPages }) =>
              `${bill.orderNo}  ·  Page ${pageNumber} of ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}
