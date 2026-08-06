/**
 * Make free text safe to print in the invoice's font.
 * Created by Phase 8 (specs/08-billing-whatsapp.md §8.3).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  FOUND BY RENDERING A REAL BILL, NOT BY READING THE CODE.
 *
 *  The invoice is set in Helvetica, a PDF base font, which is encoded in WinAnsi (D-027).
 *  WinAnsi covers Latin-1 plus a handful of typographic extras and NOTHING else — and
 *  `@react-pdf/renderer` does not fail on a character it cannot encode, it emits whatever
 *  byte the encoder falls back to. A customer named "Priya & Sons 🙏" printed as
 *  "Priya & Sons =O" on a live render.
 *
 *  Mojibake on a tax invoice is worse than an omission: the customer's name is the field a
 *  dispute turns on. So unrepresentable characters are removed deliberately, and the ones
 *  that have a plain equivalent are transliterated rather than dropped.
 *
 *  ── The limit this does not fix ──
 *  A name written in Devanagari, Gujarati or Tamil has no Latin-1 equivalent and comes out
 *  empty. That is a font problem, not a text problem, and it needs a font with Indic
 *  coverage embedded in the PDF. Tracked as DEBT-027. Until then a name that vanishes
 *  entirely is replaced with the honest placeholder below rather than a blank line.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pure and dependency-free, so a test can enumerate the cases without rendering anything.
 */

/**
 * Characters WinAnsi has above Latin-1 — the CP1252 0x80–0x9F block.
 *
 * Kept rather than stripped because these are what a word processor produces: an admin who
 * pastes a note from WhatsApp brings curly quotes and en dashes with it, and dropping them
 * would gap the sentence.
 */
const WIN_ANSI_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
  0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122,
  0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

/**
 * Characters with an obvious plain-text stand-in.
 *
 * Transliterated instead of dropped because these appear in ordinary Indian shop text and
 * losing them changes the meaning: `₹` and `Rs.` are the same word, `→` and `->` the same
 * arrow. `₹` is here because it is the reason this file exists.
 */
const TRANSLITERATIONS: Record<string, string> = {
  '₹': 'Rs.',
  '→': '->',
  '←': '<-',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  '​': '',
  '﻿': '',
};

function isRepresentable(codePoint: number): boolean {
  // Printable ASCII and Latin-1, minus the C1 control block WinAnsi reuses.
  if (codePoint >= 0x20 && codePoint <= 0x7e) return true;
  if (codePoint >= 0xa0 && codePoint <= 0xff) return true;
  return WIN_ANSI_EXTRAS.has(codePoint);
}

/**
 * Strip a string down to what the invoice's font can actually draw.
 *
 * @param value    the raw text
 * @param fallback what to print when nothing survives — say something true, never blank
 */
export function pdfText(value: string, fallback = ''): string {
  // NFC first, so `e` + combining acute becomes `é`, which WinAnsi has. Decomposed, the
  // accent would be dropped and the letter kept, silently changing the spelling.
  const normalised = value.normalize('NFC');

  let out = '';
  for (const character of normalised) {
    const replacement = TRANSLITERATIONS[character];
    if (replacement !== undefined) {
      out += replacement;
      continue;
    }

    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && isRepresentable(codePoint)) {
      out += character;
    }
    // Anything else is dropped. No `?` placeholder: a row of question marks looks like a
    // rendering bug, and a name with one character missing looks like a typo — both are
    // worse than a name that is visibly shorter.
  }

  // Dropping characters can leave doubled or trailing spaces.
  const tidied = out.replace(/[ \t]{2,}/g, ' ').trim();

  return tidied === '' ? fallback : tidied;
}

/** `pdfText` for a nullable column: null in, null out, so the caller's `&&` still works. */
export function pdfTextOrNull(value: string | null, fallback = ''): string | null {
  if (value === null) return null;
  const cleaned = pdfText(value, fallback);
  return cleaned === '' ? null : cleaned;
}
