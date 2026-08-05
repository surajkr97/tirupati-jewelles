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
          <span className="font-semibold tracking-[0.2em] text-taupe/60 text-small">
            TJ
          </span>
        </div>
      )}
    </div>
  );
}
