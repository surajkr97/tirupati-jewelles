'use client';

/**
 * `next/image`, degrading to the branded tile when the photograph cannot be fetched.
 * Created by Phase 9 (specs/09-hardening.md §9.5).
 *
 * ── Why this exists ──
 * §9.5: "Image CDN down → branded empty frames, no broken layout." `ImageFrame` already
 * rendered the monogram tile for a slot with NO `src`, which is the Phase 2 §2.2 case. It
 * had nothing for a slot whose `src` is perfectly good and unreachable — and measurement
 * (a real browser with every request to `res.cloudinary.com` aborted) showed the difference:
 * the frame kept its 335×335 box and its tint, so the layout held, but Chrome painted its
 * torn-page glyph in the corner. Half the requirement: no broken layout, not a branded
 * frame. §2.2's own words are the standard — "must look intentional while empty, not like a
 * broken page."
 *
 * ── Why it is a separate client leaf rather than `'use client'` on ImageFrame ──
 * `onError` is a browser event, so this component has to hydrate. Marking `ImageFrame`
 * itself would pull every one of its call sites — product grids, the gallery, media slots,
 * the homepage hero — across the client boundary, against a §9.2 JS budget with 11 kB of
 * headroom (D-035). This leaf ships instead, and `next/image` was already client-side.
 *
 * ── The hydration gotcha, and why the effect is not redundant ──
 * `onError` only fires for a failure that happens after React attaches the handler. An image
 * that has ALREADY failed by the time the page hydrates — the common case, since the browser
 * starts fetching during parse and a dead CDN refuses immediately — fires nothing, and a
 * component relying on the event alone would sit there showing the broken glyph forever.
 * The effect closes that: a `complete` image with `naturalWidth === 0` is one that finished
 * and finished badly. Both paths are needed; neither is sufficient.
 */
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';

import { EmptyFrameMark } from '@/components/ui/empty-frame-mark';

export interface ImageWithFallbackProps {
  src: string;
  alt: string;
  sizes: string;
  priority: boolean;
  blurDataURL?: string;
}

export function ImageWithFallback({
  src,
  alt,
  sizes,
  priority,
  blurDataURL,
}: ImageWithFallbackProps) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const image = ref.current;
    // `complete` with no intrinsic width is a load that finished and produced nothing —
    // the state an already-failed image is in before React ever sees it.
    if (image?.complete && image.naturalWidth === 0) setFailed(true);
    // `src` in the deps so a gallery swapping to a different photograph re-checks rather
    // than staying failed forever.
  }, [src]);

  if (failed) return <EmptyFrameMark />;

  return (
    <Image
      ref={ref}
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      placeholder={blurDataURL ? 'blur' : 'empty'}
      blurDataURL={blurDataURL}
      className="object-cover"
      onError={() => setFailed(true)}
    />
  );
}
