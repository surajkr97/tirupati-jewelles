/**
 * Amount in words, Indian numbering.
 * Created by Phase 8 (specs/08-billing-whatsapp.md §8.3).
 *
 * §8.3: "**grand total in figures and in words** (Indian numbering: 'Seventy Thousand Nine
 * Hundred and Ninety-Three Rupees Only'). Amount in words is expected on Indian invoices."
 *
 * It is not decoration. On a disputed invoice the words are the tie-breaker against a
 * tampered figure, which is why it is spelled out from the same `bigint` paise the total
 * was computed in and never from a formatted string.
 *
 * Pure — no imports, no locale data. `Intl` has no Indian word-form, and a dependency for
 * eighty lines of lookup tables is not a trade worth making.
 */

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
] as const;

const TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
] as const;

/**
 * The Indian groups, largest first. Beyond a crore the scale continues (arab, kharab), but
 * invoices do not: ₹250 crore is written "Two Hundred and Fifty Crore", not "Two Arab Fifty
 * Crore". So `CRORE` is the last named group and absorbs everything above it.
 */
const CRORE = 10_000_000n;
const LAKH = 100_000n;
const THOUSAND = 1_000n;

/** 1–99. Compounds are hyphenated: "Twenty-One", never "Twenty One". */
function underHundred(n: number): string {
  if (n < 20) return ONES[n] ?? '';
  const tens = TENS[Math.floor(n / 10)] ?? '';
  const ones = ONES[n % 10] ?? '';
  return ones ? `${tens}-${ones}` : tens;
}

/**
 * 1–999.
 *
 * The "and" sits here rather than at the join, which is what produces §8.3's example:
 * 70,993 → "Seventy Thousand" + "Nine Hundred and Ninety-Three".
 */
function underThousand(n: number): string {
  if (n < 100) return underHundred(n);

  const hundreds = `${ONES[Math.floor(n / 100)]} Hundred`;
  const rest = n % 100;
  return rest === 0 ? hundreds : `${hundreds} and ${underHundred(rest)}`;
}

/**
 * A whole number in Indian words. `0` returns "Zero".
 *
 * `bigint` throughout: the grand total is paise and a ₹1 crore bill is 10^10 paise, which
 * is inside `Number.MAX_SAFE_INTEGER` today but stops being obviously safe the moment
 * someone bills in a currency with more minor units. Converting per group keeps every
 * intermediate under 10^7.
 */
export function numberToIndianWords(value: bigint): string {
  if (value < 0n) return `Minus ${numberToIndianWords(-value)}`;
  if (value === 0n) return 'Zero';

  const parts: string[] = [];

  const crore = value / CRORE;
  const afterCrore = value % CRORE;
  if (crore > 0n) {
    // Recursive, so 250 crore reads "Two Hundred and Fifty Crore" rather than overflowing
    // the three-digit helper.
    parts.push(`${numberToIndianWords(crore)} Crore`);
  }

  const lakh = Number(afterCrore / LAKH);
  const afterLakh = afterCrore % LAKH;
  if (lakh > 0) parts.push(`${underThousand(lakh)} Lakh`);

  const thousand = Number(afterLakh / THOUSAND);
  const remainder = Number(afterLakh % THOUSAND);
  if (thousand > 0) parts.push(`${underThousand(thousand)} Thousand`);

  if (remainder > 0) {
    /**
     * "One Lakh and Fifty", but "One Lakh Nine Hundred and Fifty".
     *
     * The connective belongs before a bare tens-or-units remainder and nowhere else —
     * `underThousand` has already supplied the "and" inside anything with a hundreds digit,
     * and two of them in one number reads as a mistake.
     */

    const connector = parts.length > 0 && remainder < 100 ? 'and ' : '';
    parts.push(`${connector}${underThousand(remainder)}`);
  }

  return parts.join(' ');
}

/**
 * The line printed under the grand total.
 *
 * @param paise integer paise, exactly as stored on the order
 *
 * Paise are named separately because they are a different unit, not a decimal: an invoice
 * saying "Seventy Thousand Nine Hundred and Ninety-Three Point Five Zero Rupees" is not
 * something a customer or an auditor would accept.
 */
export function amountInWords(paise: bigint): string {
  const negative = paise < 0n;
  const absolute = negative ? -paise : paise;

  const rupees = absolute / 100n;
  const paiseRemainder = absolute % 100n;

  const rupeeWords = `${numberToIndianWords(rupees)} ${rupees === 1n ? 'Rupee' : 'Rupees'}`;

  const paiseWords =
    paiseRemainder > 0n
      ? ` and ${numberToIndianWords(paiseRemainder)} ${paiseRemainder === 1n ? 'Paisa' : 'Paise'}`
      : '';

  return `${negative ? 'Minus ' : ''}${rupeeWords}${paiseWords} Only`;
}
