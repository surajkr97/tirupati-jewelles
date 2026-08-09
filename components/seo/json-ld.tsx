/**
 * JSON-LD script tag. Phase 9 §9.6.
 *
 * ── Why `dangerouslySetInnerHTML` is correct here, and is not a hole ──
 * This is the one place in the application that writes raw markup, and the codebase's rule
 * (§6 SECURITY) is that it does not. The exception is narrow and the reasoning is not "it is
 * fine because we control the data" — that argument fails the moment a product name is
 * attacker-influenced, which product names are: §7.4 lets an admin type anything.
 *
 * What makes it safe is that the payload goes through `JSON.stringify`, so every character is
 * already JSON-escaped, and the ONE sequence that can still break out of a `<script>` element
 * — the literal `</script`, which the HTML parser recognises inside script content regardless
 * of JSON — is escaped explicitly below. React would not escape it for us: inside
 * `dangerouslySetInnerHTML` nothing is escaped, and outside it React would emit `&lt;` and
 * produce structured data no parser can read.
 *
 * `<` is escaped wholesale rather than pattern-matching `</script`, because the pattern is
 * case-insensitive, tolerates whitespace, and is exactly the kind of near-miss regex that
 * makes an XSS report. `<` is valid JSON and every JSON-LD parser reads it back as `<`.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // See the module comment: the payload is JSON.stringify'd and `<` is escaped, which
      // is the documented safe form for embedding JSON-LD.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, '\\u003c'),
      }}
    />
  );
}
