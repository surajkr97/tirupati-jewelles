/**
 * ImageFrame — next/image with a branded empty state.
 * Created by Phase 2 (specs/02-design-system.md §2.2).
 *
 * The empty state is the point. §2.2: "Client has no real photos yet; every image slot
 * must look intentional while empty, not like a broken page." Phase 7 lets the admin fill
 * these slots; until then — and whenever the image CDN is down (Phase 9 §9.5) — every slot
 * renders as a deliberate monogram tile rather than a broken-image icon.
 */
import Image from 'next/image';

import { cn } from '@/lib/utils/cn';

export interface ImageFrameProps {
  src?: string | null;
  alt: string;
  /** CSS aspect ratio, e.g. '16/9' or '1/1'. Fixed ratio => no layout shift. */
  ratio?: string;
  sizes?: string;
  priority?: boolean;
  blurDataURL?: string;
  className?: string;
  rounded?: 'card' | 'field' | 'none';
}

const ROUNDING = {
  card: 'rounded-card',
  field: 'rounded-field',
  none: '',
} as const;

export function ImageFrame({
  src,
  alt,
  ratio = '4/3',
  // Sensible default for the single-column mobile layout; callers override per grid.
  sizes = '(max-width: 768px) 100vw, 33vw',
  priority = false,
  blurDataURL,
  className,
  rounded = 'card',
}: ImageFrameProps) {
  return (
    <div
      style={{ aspectRatio: ratio }}
      className={cn(
        'relative w-full overflow-hidden bg-taupe-lt/40',
        ROUNDING[rounded],
        className,
      )}
    >
      {src ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          placeholder={blurDataURL ? 'blur' : 'empty'}
          blurDataURL={blurDataURL}
          className="object-cover"
        />
      ) : (
        <div
          // Decorative placeholder — the alt text describes content that does not exist yet,
          // so announcing it would be a lie. Callers render real copy alongside.
          aria-hidden="true"
          className="absolute inset-0 grid place-items-center"
        >
          {/*
            `muted`, not `taupe/60`, and the change is forced rather than chosen (§9.7).

            The mark measured **1.83:1** on the frame's own tint — the worst contrast
            anywhere in the application — because a brand colour at 60% alpha over a tint of
            the same family is very nearly the tint. The wrapper is already `aria-hidden`,
            and axe still flags it, correctly: contrast is a rule about what a sighted
            low-vision user can see, and marking something decorative does not make a smudge
            legible.

            No taupe in this palette can be AA body text on a light surface — that is D-007's
            finding, and the frame's tint is lighter still. `taupe-deep` reaches only 4.13
            here. A fourth taupe token was considered and rejected as disproportionate for a
            placeholder: the tile's brand signal is the taupe TINT, which is untouched, and
            the mark stands in for a missing photograph rather than expressing the brand.
            4.76:1 at any frame size. See D-038.
          */}
          <span className="text-small font-semibold tracking-[0.2em] text-muted">TJ</span>
        </div>
      )}
    </div>
  );
}
