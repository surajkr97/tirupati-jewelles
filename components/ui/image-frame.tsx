/**
 * ImageFrame — next/image with a branded empty state.
 * Created by Phase 2 (specs/02-design-system.md §2.2).
 *
 * The empty state is the point. §2.2: "Client has no real photos yet; every image slot
 * must look intentional while empty, not like a broken page." Phase 7 lets the admin fill
 * these slots; until then — and whenever the image CDN is down (Phase 9 §9.5) — every slot
 * renders as a deliberate monogram tile rather than a broken-image icon.
 *
 * ── §9.5 made that sentence true for the second case, which it was not ──
 * Until Phase 9 the monogram appeared only when `src` was absent. A slot with a good `src`
 * and an unreachable CDN kept its box and its tint — so the layout held — and painted the
 * browser's broken-image glyph on top of it. Measured in a browser with every request to
 * the image host aborted, not reasoned about. `ImageWithFallback` is the leaf that closes
 * it, and it is a separate client component so this one can stay on the server.
 */
import { EmptyFrameMark } from '@/components/ui/empty-frame-mark';
import { ImageWithFallback } from '@/components/ui/image-with-fallback';
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
      // §9.5 measures these boxes with the image CDN unreachable: the fixed ratio is what
      // keeps a failed load a hole of the right shape rather than a collapsed row. A class
      // selector would be the alternative, and `cn()` merging makes that quietly brittle.
      data-image-frame=""
      style={{ aspectRatio: ratio }}
      className={cn(
        'relative w-full overflow-hidden bg-rose-tint',
        ROUNDING[rounded],
        className,
      )}
    >
      {src ? (
        <ImageWithFallback
          src={src}
          alt={alt}
          sizes={sizes}
          priority={priority}
          blurDataURL={blurDataURL}
        />
      ) : (
        <EmptyFrameMark />
      )}
    </div>
  );
}
