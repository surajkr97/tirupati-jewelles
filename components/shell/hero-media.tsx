/**
 * HeroMedia — a wine ground, then a photograph, then optionally a video.
 * Created by the UI redesign, Stage 4A (brief §6).
 *
 * ── The ordering is the whole component ──
 *
 * Three layers stack in the same grid cell, so nothing ever reflows:
 *
 *   1. `wine` paints immediately. It is a background colour, so it is there in the first
 *      frame, before any network request resolves. The hero is never a white flash.
 *   2. The poster fades in when it decodes. `blurDataURL` covers the gap with the image's
 *      own colours rather than a grey box.
 *   3. The video mounts ONLY after the poster has loaded, and fades in only once it has
 *      enough data to play. Until then it does not exist in the DOM at all, so it cannot
 *      compete with the poster for bandwidth on the connection that needs the poster most.
 *
 * Each layer is a strict improvement on the one below, and each is a complete hero on its
 * own. That is what makes every failure mode acceptable rather than merely handled: no
 * video, no poster, slow network, blocked autoplay, reduced motion — the result is always
 * a legible wine hero with the headline on it.
 *
 * ── Autoplay is a request, not a guarantee ──
 *
 * iOS Low Power Mode and most data-saver modes refuse `play()` regardless of `muted` and
 * `playsInline`. The promise rejects, we keep the poster, and nothing tells the user
 * anything went wrong — because nothing did.
 *
 * ── Reduced motion ──
 *
 * The video is never mounted. Not paused, not hidden: not requested. Someone who has asked
 * the OS to stop moving things should not pay for a video download to then not watch it.
 */
'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils/cn';

export interface HeroMediaProps {
  /** Poster photograph. `null` renders the wine ground alone, which is a valid hero. */
  src: string | null;
  alt: string;
  blurDataURL?: string;
  /**
   * Optional looping video.
   *
   * Unset everywhere today: `MediaSlot` stores an image and has no video column, so the
   * owner has no way to supply one (UI_REDESIGN_DEBT-001). The prop exists so the
   * behaviour is built and testable now, and adding the column later is a data change
   * rather than a component rewrite.
   */
  videoSrc?: string;
  className?: string;
  /** Above the fold on the homepage, so the poster is the LCP candidate. */
  priority?: boolean;
}

export function HeroMedia({
  src,
  alt,
  blurDataURL,
  videoSrc,
  className,
  priority = false,
}: HeroMediaProps) {
  const [posterLoaded, setPosterLoaded] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  /**
   * Starts `true` so the very first client render never mounts a video, then relaxes if the
   * user has no preference. Defaulting the other way would mount the video for one frame on
   * a machine that asked for stillness.
   */
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReducedMotion(query.matches);
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);

  const wantsVideo = Boolean(videoSrc) && !reducedMotion && (posterLoaded || !src);

  useEffect(() => {
    if (!wantsVideo) return;
    const video = videoRef.current;
    if (!video) return;

    // Rejects under Low Power Mode and most data savers. The poster stays; that is the
    // designed outcome, so there is nothing to report.
    void video.play().catch(() => undefined);
  }, [wantsVideo]);

  return (
    <div
      className={cn(
        // The wine ground. Painted before anything is fetched.
        'relative isolate overflow-hidden bg-wine',
        className,
      )}
    >
      {src && (
        <Image
          src={src}
          alt={alt}
          fill
          // The hero spans the viewport at every breakpoint; capped at the layout max.
          sizes="(max-width: 1200px) 100vw, 1200px"
          placeholder={blurDataURL ? 'blur' : 'empty'}
          blurDataURL={blurDataURL}
          priority={priority}
          onLoad={() => setPosterLoaded(true)}
          className={cn(
            'object-cover transition-opacity duration-slow ease-standard',
            posterLoaded ? 'opacity-100' : 'opacity-0',
          )}
        />
      )}

      {wantsVideo && videoSrc && (
        <video
          ref={videoRef}
          // `muted` and `playsInline` are what make autoplay permissible at all on iOS;
          // without either, `play()` is rejected every time rather than only sometimes.
          muted
          loop
          playsInline
          preload="none"
          // Decorative: the poster's alt already describes the subject, and announcing the
          // same jewellery twice helps nobody.
          aria-hidden="true"
          onCanPlay={() => setVideoReady(true)}
          className={cn(
            'absolute inset-0 size-full object-cover',
            'transition-opacity duration-slow ease-standard',
            videoReady ? 'opacity-100' : 'opacity-0',
          )}
        >
          <source src={videoSrc} />
        </video>
      )}
    </div>
  );
}
