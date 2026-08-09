/**
 * AppHeader — transparent over a hero, solid cream once scrolled.
 * Created by Phase 2 (specs/02-design-system.md §2.3).
 */
'use client';

import { Search, User } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Container } from '@/components/shell/container';
import { cn } from '@/lib/utils/cn';

export interface AppHeaderProps {
  /** Start transparent and only solidify on scroll. Set on pages with a hero image. */
  overlay?: boolean;
}

export function AppHeader({ overlay = false }: AppHeaderProps) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!overlay) return;

    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll(); // a refresh can restore mid-page scroll before any event fires

    // `passive` keeps scrolling off the main-thread critical path — this listener runs on
    // every frame of a scroll and must never be able to block it.
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [overlay]);

  const solid = !overlay || scrolled;

  return (
    <header
      className={cn(
        'sticky top-0 z-30 transition-colors duration-base ease-standard',
        solid ? 'border-b border-line bg-cream/90 backdrop-blur-md' : 'bg-transparent',
      )}
    >
      <Container>
        <div className="flex h-header items-center justify-between md:h-header-lg">
          <Link
            href="/"
            className="flex h-tap items-center font-semibold tracking-[0.12em] text-ink"
          >
            TIRUPATI
          </Link>

          <div className="flex items-center gap-2">
            <Link
              href="/search"
              aria-label="Search"
              className="grid size-tap place-items-center rounded-pill text-ink transition-colors duration-fast hover:bg-taupe-lt/40"
            >
              <Search className="size-icon" aria-hidden="true" />
            </Link>
            <Link
              href="/account"
              aria-label="Account"
              className="grid size-tap place-items-center rounded-pill text-ink transition-colors duration-fast hover:bg-taupe-lt/40"
            >
              <User className="size-icon" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </Container>
    </header>
  );
}
