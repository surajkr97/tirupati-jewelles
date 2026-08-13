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
 *
 *  Helvetica's digits are all 556 units wide, so every money column is tabular by
 *  construction — §8 of the Stage 5G brief asks for that "where supported by the PDF
 *  font/system", and here it needs no `font-variant-numeric` because the base-14 metrics
 *  already provide it.
 *
 *  ── Stage 5G: quieter than the website, on purpose ──
 *
 *  The site is wine, rose and cream. An invoice is not a marketing surface, and three of the
 *  things that made this document feel designed on screen made it worse on paper:
 *
 *    · `roseTint` (#FCEEF1) carried the rules and the grand-total box. Against white that is
 *      1.04:1 — it is not a hairline, it is nothing, and it prints as nothing. The same is
 *      true of `line` (#F0EEF0) on the row separators and of the `cream` panel fills.
 *    · The one large colour block on the page was behind the grand total, which is exactly
 *      the element that should be carried by weight rather than by fill.
 *    · Rose was the accent. Rose is the site's accent; wine is the brand, it is darker, and
 *      it survives a grayscale printer.
 *
 *  So: white ground, ink type, muted secondary text, rules in real grey, and wine used three
 *  times — the invoice label, the rule under the table head and the rule above the total.
 *  Rose does not appear on the invoice at all.
 *
 *  ── There is no QR code, and 5G did not add one ──
 *
 *  §13 of the brief asks that existing QR/verification behaviour be preserved. There is
 *  none: nothing in this repository generates or encodes one. The only verification artefact
 *  the application has is the signed, EXPIRING URL the PDF is served from
 *  (`lib/bills/storage.ts`) — a capability credential, which is the last thing that belongs
 *  printed on a customer's copy. Adding one would mean inventing an encoding, a verification
 *  route and a dependency. Recorded as UI_REDESIGN_DEBT-016.
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
  /**
   * Metal / making / stones, summed across the lines by `buildBillData`.
   *
   * Null when they do not add up to `taxableTotal`, in which case the invoice prints the
   * stored totals alone rather than a breakdown that does not reconcile.
   */
  components: { metal: bigint; making: bigint; stone: bigint } | null;
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
  //
  // Narrowed again by Stage 5G, and the money columns widened with what it gave up. On a
  // ₹1.2-crore bill `12,66,146.64` and `2,50,000.00` filled MAKING and STONE completely and
  // read as one run of digits — not an overflow, since each sits in its own flex box, but
  // the gutter had gone. Description is the column that can afford it: it wraps by design,
  // and a name on two lines is legible in a way two adjacent numbers are not.
  description: 2.4,
  purity: 1.6,
  weight: 1.1,
  rate: 1.5,
  metal: 1.75,
  makingPct: 0.85,
  making: 1.75,
  stone: 1.6,
  taxable: 1.85,
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

/**
 * The three rule weights, in one place.
 *
 * §18 asks that the document survive an ordinary office printer, and the previous rules
 * failed that test on colour rather than on weight: `roseTint` and `line` are both under
 * 1.1:1 against white. `muted` (#6E6B72) at a fine weight is a real grey line — subtle on a
 * screen, present on paper, and unambiguous in grayscale.
 */
const RULE = {
  /** Row separators. Fine enough not to stripe a 20-line bill. */
  hair: 0.4,
  /** Section divisions. */
  fine: 0.6,
  /** The two rules that carry structure: under the table head, above the total. */
  strong: 1.2,
} as const;

const styles = StyleSheet.create({
  page: {
    // 32pt of air, measured from BELOW the 8pt masthead (7pt wine + 1pt gold) rather than
    // from the paper edge, so the band does not eat into the header's breathing room.
    paddingTop: 40,
    paddingBottom: PAGE_BOTTOM_PADDING,
    paddingHorizontal: 32,
    fontFamily: 'Helvetica',
    fontSize: 8,
    color: COLORS.ink,
    backgroundColor: COLORS.white,
  },

  // ── Header ───────────────────────────────────────────────────────────────
  /**
   * A wine bar across the top edge, and a gold hairline under it.
   *
   * Stage 5G stripped this document to white and ink for a good reason — every tint it had
   * been using was under 1.1:1 and printed as nothing. That fixed the invisible colour and
   * left the page reading as a plain-text receipt, which is the note this pass answers.
   *
   * A band at the paper's edge is the cheapest way to make a document look considered: it
   * costs one strip of toner, it cannot interfere with any figure, and it is the first thing
   * seen. `position: absolute` with `top/left/right: 0` escapes the page padding so it bleeds
   * the full width — inset by the padding it would read as a stray rule.
   *
   * Gold appears once, as a 1pt line ON the wine. D-057 restricts it to wine surfaces
   * (2.27:1 on cream, 6.84:1 on wine), and this is the only wine surface in the document.
   */
  topBand: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 7,
    backgroundColor: COLORS.wine,
  },
  topBandAccent: {
    position: 'absolute',
    top: 7,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: COLORS.gold,
  },

  header: { flexDirection: 'row', justifyContent: 'space-between', gap: 16 },
  logo: { width: 120, maxHeight: 44, objectFit: 'contain' },
  wordmark: { fontSize: 17, fontFamily: 'Helvetica-Bold', color: COLORS.ink },
  shopBlock: { flex: 1 },
  shopMeta: { fontSize: 8, color: COLORS.muted, marginTop: 4, lineHeight: 1.5 },

  invoiceBlock: { alignItems: 'flex-end', width: 180 },
  /**
   * The one place wine appears at type size.
   *
   * Small, letterspaced and bold: it names the document without competing with the shop
   * above it or the total below it. #3D0C1E on white is 15.9:1, so it is legible at 9pt and
   * still black-ish in grayscale — which `roseDeep` at 6.4:1 was not.
   */
  invoiceTitle: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 2,
    color: COLORS.wine,
  },
  invoiceNo: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    marginTop: 3,
    // Wine, not ink: the number is what anyone references the document by, and #3D0C1E is
    // 15.9:1 on white — it reads as brand colour on screen and as black in grayscale.
    color: COLORS.wine,
  },
  invoiceMeta: { fontSize: 8, color: COLORS.muted, marginTop: 3, textAlign: 'right' },

  headerRule: {
    borderBottomWidth: RULE.fine,
    borderBottomColor: COLORS.muted,
    marginTop: 12,
    marginBottom: 12,
  },
  sectionRule: {
    borderBottomWidth: RULE.hair,
    borderBottomColor: COLORS.muted,
    marginTop: 10,
    marginBottom: 12,
  },

  // ── Parties + rate reference ─────────────────────────────────────────────
  /**
   * No panel fill.
   *
   * These were two `cream` boxes. Cream on white is 1.02:1 — invisible on screen and gone in
   * print, so the boxes were doing nothing but suggesting they were. Type hierarchy and a
   * gutter separate the two blocks perfectly well.
   */
  panels: { flexDirection: 'row', gap: 28 },
  panel: { flex: 1 },
  /**
   * The small caps labels are wine, not grey.
   *
   * At 7pt letterspaced they are navigation, not content — and wine at 15.9:1 is both more
   * legible than `muted` at 6.3:1 and the thing that makes the page look laid out rather
   * than typed. Costs nothing to print.
   */
  panelLabel: {
    fontSize: 7,
    letterSpacing: 1.2,
    color: COLORS.wine,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 5,
  },
  panelName: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  panelLine: { fontSize: 8, color: COLORS.muted, marginTop: 3 },
  rateRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 3 },
  rateValue: { fontSize: 8, color: COLORS.ink, marginTop: 3 },

  // ── Items ────────────────────────────────────────────────────────────────
  sectionTitle: {
    fontSize: 7,
    letterSpacing: 1.2,
    color: COLORS.wine,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 6,
  },
  /**
   * The table head IS a fill now — and the earlier note against fills still stands.
   *
   * Stage 5G replaced a `cream` band with a wine underline, and it was right to: cream on
   * white is 1.02:1, so the band was invisible on screen and absent in print. The objection
   * was to a fill nobody could see, not to fills.
   *
   * Wine at 15.9:1 has the opposite problem to solve. A filled head is what separates a
   * priced table from a list of numbers, it survives grayscale as a black band, and it costs
   * one 15pt strip of toner. `headCell` inverts to white on it — 15.9:1 the other way.
   */
  tableHead: {
    flexDirection: 'row',
    backgroundColor: COLORS.wine,
    paddingVertical: 5,
    paddingHorizontal: 6,
    marginHorizontal: -4,
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
    letterSpacing: 0.3,
    color: COLORS.white,
    paddingRight: 6,
  },
  row: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 2,
    borderBottomWidth: RULE.hair,
    borderBottomColor: COLORS.muted,
  },
  cell: { fontSize: 8, paddingRight: 6 },
  right: { textAlign: 'right' },
  itemName: { fontSize: 8.5, fontFamily: 'Helvetica-Bold' },
  itemMeta: { fontSize: 6.5, color: COLORS.muted, marginTop: 2 },

  // ── Totals ───────────────────────────────────────────────────────────────
  totals: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 14 },
  totalsBox: { width: 250 },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  totalLabel: { fontSize: 8, color: COLORS.muted },
  totalValue: { fontSize: 8, textAlign: 'right' },
  totalsDivider: {
    borderBottomWidth: RULE.hair,
    borderBottomColor: COLORS.muted,
    marginVertical: 4,
  },

  /**
   * §11 — the strongest financial element on the page, carried by weight and a rule.
   *
   * It was a filled `roseTint` box, which is the one thing §4 and §11 both name: a large
   * colour area doing the job that type should do, in the site's accent rather than the
   * brand's, and invisible the moment the page is printed in grayscale. A 1.2pt wine rule
   * above it and 15pt bold ink is unmistakably the final amount and costs nothing to print.
   */
  grandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: RULE.strong,
    borderTopColor: COLORS.wine,
  },
  grandLabel: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 1,
    color: COLORS.wine,
  },
  /**
   * Wine, still carried by weight rather than by a fill.
   *
   * §11's point was that the largest colour area on the page should not be the one element
   * type can carry on its own, and that has not changed — this is 15pt bold under a 1.2pt
   * wine rule. Colouring the glyphs adds the brand without adding a block, and in grayscale
   * #3D0C1E is indistinguishable from the ink it replaced.
   */
  grandValue: {
    fontSize: 15,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'right',
    color: COLORS.wine,
  },

  words: { marginTop: 12 },
  wordsLabel: { fontSize: 6.5, letterSpacing: 1.2, color: COLORS.wine },
  wordsValue: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    marginTop: 3,
    lineHeight: 1.4,
  },

  note: { marginTop: 12, fontSize: 8, color: COLORS.muted, lineHeight: 1.5 },

  // ── Footer ───────────────────────────────────────────────────────────────
  /**
   * A wine rule closes the page, so the document is bracketed rather than only topped.
   * `fine` rather than `strong`: the footer is small print and a heavy rule above it would
   * out-weigh the total, which is the one thing on the page that must stay loudest.
   */
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 32,
    right: 32,
    borderTopWidth: RULE.fine,
    borderTopColor: COLORS.wine,
    paddingTop: 6,
  },
  footerText: { fontSize: 6.5, color: COLORS.muted, lineHeight: 1.5 },
  pageNumber: { fontSize: 6.5, color: COLORS.muted, textAlign: 'right', marginTop: 2 },

  /**
   * §21 — never colour alone. The word VOID and the cancellation date carry the meaning;
   * the red border and red type are the second channel, not the only one.
   */
  voided: {
    marginTop: 12,
    padding: 8,
    borderWidth: 1,
    borderColor: COLORS.down,
    borderRadius: 2,
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

  /**
   * §8: "Do not force empty columns into the document."
   *
   * Most bills in a jewellery shop carry no stone charge at all, and the column printed
   * `0.00` on every line — a column of zeroes that says nothing, on the page where every
   * other figure means something. It appears when at least one line has a stone charge, and
   * its width goes to the description when it does not.
   */
  const hasStoneCharge = bill.items.some((item) => item.stoneCharge > 0n);
  const descriptionFlex = hasStoneCharge
    ? COLUMNS.description
    : COLUMNS.description + COLUMNS.stone;

  return (
    <Document
      title={`Invoice ${bill.orderNo}`}
      author={bill.shopName}
      subject={`Tax invoice ${bill.orderNo}`}
      creator={bill.shopName}
      producer={bill.shopName}
    >
      <Page size="A4" style={styles.page}>
        {/* `fixed` so the band and its gold hairline repeat on a bill that runs to a second
            page — a masthead that appears once and then stops reads as a printing fault. */}
        <View style={styles.topBand} fixed />
        <View style={styles.topBandAccent} fixed />

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

        <View style={styles.headerRule} />

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
                <Text style={styles.rateValue}>
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

        <View style={styles.sectionRule} />

        {/*
          The unit, said once.

          Only the last column's header carried `(RS.)`, so RATE/G, METAL VALUE, MAKING and
          STONE printed bare digits with nothing on the page naming their currency. Widening
          four headers is not available — ten columns across A4 is already tight (see
          COLUMNS) — and one line above the table costs no width at all.
        */}
        <Text style={styles.sectionTitle}>ITEMS  ·  ALL AMOUNTS IN RUPEES</Text>

        {/* `fixed` repeats the header on every page — a 20-item bill spills, and a
            continuation page of unlabelled numbers is unreadable. */}
        <View style={styles.tableHead} fixed>
          <Text style={[styles.headCell, { flex: COLUMNS.index }]}>#</Text>
          <Text style={[styles.headCell, { flex: descriptionFlex }]}>DESCRIPTION</Text>
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
          {hasStoneCharge && (
            <Text style={[styles.headCell, styles.right, { flex: COLUMNS.stone }]}>
              STONE
            </Text>
          )}
          <Text style={[styles.headCell, styles.right, { flex: COLUMNS.taxable }]}>
            TAXABLE
          </Text>
        </View>

        {bill.items.map((item, index) => (
          // `wrap={false}` keeps a row and its hallmark line together rather than splitting
          // a piece across a page break.
          <View key={`${item.name}-${index}`} style={styles.row} wrap={false}>
            <Text style={[styles.cell, { flex: COLUMNS.index }]}>{index + 1}</Text>

            <View style={{ flex: descriptionFlex, paddingRight: 6 }}>
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
            {hasStoneCharge && (
              <Text style={[styles.cell, styles.right, { flex: COLUMNS.stone }]}>
                {formatAmountDigits(item.stoneCharge)}
              </Text>
            )}
            <Text style={[styles.cell, styles.right, { flex: COLUMNS.taxable }]}>
              {formatAmountDigits(item.taxableValue)}
            </Text>
          </View>
        ))}

        {/* The totals and the amount in words must never be orphaned from each other. */}
        <View wrap={false}>
          <View style={styles.totals}>
            <View style={styles.totalsBox}>
              {/*
                §10 — where the taxable value came from, when it can be shown honestly.

                `components` is summed by `buildBillData` from the same per-line split the
                table above prints, and is null unless those parts add up to the stored
                `taxableTotal`. Making and stones appear only when they are non-zero: §10 is
                explicit that a zero row invented to balance the table is worse than no row,
                and on an invoice it would imply a charge that was never made.
              */}
              {bill.components && (
                <>
                  <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>Metal value</Text>
                    <Text style={styles.totalValue}>
                      {formatRupeesAscii(bill.components.metal)}
                    </Text>
                  </View>
                  {bill.components.making > 0n && (
                    <View style={styles.totalRow}>
                      <Text style={styles.totalLabel}>Making charges</Text>
                      <Text style={styles.totalValue}>
                        {formatRupeesAscii(bill.components.making)}
                      </Text>
                    </View>
                  )}
                  {bill.components.stone > 0n && (
                    <View style={styles.totalRow}>
                      <Text style={styles.totalLabel}>Stones and other</Text>
                      <Text style={styles.totalValue}>
                        {formatRupeesAscii(bill.components.stone)}
                      </Text>
                    </View>
                  )}
                  <View style={styles.totalsDivider} />
                </>
              )}

              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Taxable value</Text>
                <Text style={styles.totalValue}>
                  {formatRupeesAscii(bill.taxableTotal)}
                </Text>
              </View>
              <View style={styles.totalsDivider} />
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
