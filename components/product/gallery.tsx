/**
 * Product image gallery.
 * Created by Phase 6 (specs/06-catalog-enquiry.md §6.2).
 *
 * §6.2: "swipeable, dot indicators, pinch-zoom. Falls back to the branded `ImageFrame`
 * when the admin has supplied no URLs."
 *
 * Swiping is CSS scroll-snap, not a carousel library. It is a horizontal scroller with
 * `snap-mandatory`, which gives native momentum, native pinch-zoom on the image itself,
 * keyboard scrolling and a working scrollbar on desktop — all for no JavaScript and no
 * dependency. The only script here observes which slide is centred so the dots can follow.
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ImageFrame } from '@/components/ui';
import { cn } from '@/lib/utils/cn';

export interface GalleryImage {
  id: string;
  url: string;
  alt: string | null;
}

export function Gallery({ images, name }: { images: GalleryImage[]; name: string }) {
  const scrollerRef = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(0);

  /**
   * Track the centred slide.
   *
   * `IntersectionObserver` against the scroller, not a scroll handler: a scroll listener
   * fires on every frame of a momentum scroll and would re-render the dots dozens of times
   * per swipe.
   */
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || images.length < 2) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number((entry.target as HTMLElement).dataset.index);
          if (Number.isInteger(index)) setActive(index);
        }
      },
      { root: scroller, threshold: 0.6 },
    );

    for (const slide of scroller.querySelectorAll('[data-index]'))
      observer.observe(slide);
    return () => observer.disconnect();
  }, [images.length]);

  const goTo = useCallback((index: number) => {
    const scroller = scrollerRef.current;
    const slide = scroller?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    slide?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
  }, []);

  // §6.2 and §6 TEST: "Product with zero images renders the empty frame without breaking
  // layout." One branded tile at the same aspect ratio — the page is identical in shape.
  if (images.length === 0) {
    return (
      <ImageFrame
        src={null}
        alt={name}
        ratio="1/1"
        sizes="(max-width: 768px) 100vw, 50vw"
        priority
      />
    );
  }

  if (images.length === 1) {
    const only = images[0]!;
    return (
      <ImageFrame
        src={only.url}
        alt={only.alt ?? name}
        ratio="1/1"
        sizes="(max-width: 768px) 100vw, 50vw"
        priority
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ul
        ref={scrollerRef}
        // `snap-x snap-mandatory` gives the swipe; `overflow-x-auto` keeps it inside its
        // own box so the document never scrolls sideways.
        className="flex snap-x snap-mandatory gap-2 overflow-x-auto rounded-card"
        aria-label={`${name} images`}
      >
        {images.map((image, index) => (
          <li
            key={image.id}
            data-index={index}
            className="w-full shrink-0 snap-start"
            aria-label={`Image ${index + 1} of ${images.length}`}
          >
            <ImageFrame
              src={image.url}
              alt={image.alt ?? `${name} — image ${index + 1}`}
              ratio="1/1"
              sizes="(max-width: 768px) 100vw, 50vw"
              // §6.5: priority only on the first gallery image; the rest lazy-load.
              priority={index === 0}
            />
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-center gap-2">
        {images.map((image, index) => (
          <button
            key={image.id}
            type="button"
            onClick={() => goTo(index)}
            aria-label={`Go to image ${index + 1}`}
            aria-current={index === active ? 'true' : undefined}
            // A 44px tap target with a small visible dot inside it — the dot is the
            // affordance, the button is the target (MASTER-SPEC §3).
            className="flex size-tap items-center justify-center"
          >
            <span
              className={cn(
                'block size-2 rounded-pill transition-colors duration-fast ease-standard',
                index === active ? 'bg-ink' : 'bg-line',
              )}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
