/**
 * The branded monogram that stands in for a photograph.
 * Extracted by Phase 9 (§9.5) from `ImageFrame`, where Phase 2 §2.2 created it.
 *
 * One definition, two callers: a slot that has never had an image (`ImageFrame`) and a slot
 * whose image cannot be fetched (`ImageWithFallback`). §9.5 asks for "branded empty frames"
 * when the CDN is down, and two copies of the tile would be two things to keep in step —
 * with the drift only visible during an outage, which is when nobody is looking at CSS.
 */
export function EmptyFrameMark() {
  return (
    <div
      // Decorative — the alt text describes content that does not exist here, so announcing
      // it would be a lie. Callers render real copy alongside.
      aria-hidden="true"
      className="absolute inset-0 grid place-items-center"
    >
      {/*
        `muted`, not `rose/60`, and the change is forced rather than chosen (§9.7).

        The mark measured 1.83:1 on the frame's own tint under the old palette — the worst
        contrast anywhere in the application — because a brand colour at 60% alpha over a tint
        of the same family is very nearly the tint. The wrapper is already `aria-hidden`, and
        axe still flags it, correctly: contrast is a rule about what a sighted low-vision user
        can see, and marking something decorative does not make a smudge legible.

        The wine/rose palette does not rescue it: `rose/60` on the tint measures **2.18:1**,
        still a smudge. `rose` cannot be AA body text on any light surface either — that is
        D-057's finding, and the frame's tint is lighter still.

        `muted` measures 4.65:1 on the flat tint, at any frame size. A dedicated fourth rose
        token was considered and rejected as disproportionate for a placeholder: the tile's
        brand signal is the rose TINT, which is untouched, and the mark stands in for a
        missing photograph rather than expressing the brand. See D-038, D-057.
      */}
      <span className="text-small font-semibold tracking-[0.2em] text-muted">TJ</span>
    </div>
  );
}
