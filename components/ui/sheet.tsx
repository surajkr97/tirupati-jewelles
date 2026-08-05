/**
 * Sheet — bottom sheet with drag-to-dismiss.
 * Created by Phase 2 (specs/02-design-system.md §2.2).
 *
 * Wraps `vaul`, which already provides the focus trap, Esc-to-close, background scroll
 * lock and drag physics that §2.2 requires. Rebuilding those by hand is how focus traps
 * end up not actually trapping.
 *
 * Used by Phase 5's breakdown sheet and Phase 6's mobile filters.
 */
'use client';

import { X } from 'lucide-react';
import { useRef } from 'react';
import { Drawer } from 'vaul';

import { cn } from '@/lib/utils/cn';

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: SheetProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <Drawer.Content
          ref={contentRef}
          /**
           * Move focus into the sheet on open.
           *
           * vaul suppresses the default auto-focus, which is right for a bottom sheet —
           * focusing the first input would raise the mobile keyboard the instant it
           * opens. But it also leaves focus on the trigger, outside the dialog, so the
           * focus trap has nothing to contain and the very first Tab escapes.
           *
           * Focusing the container (it carries tabindex="-1") anchors the trap without
           * touching any input, so the keyboard stays down and Tab stays inside.
           */
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            contentRef.current?.focus();
          }}
          aria-modal="true"
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col',
            'rounded-t-sheet bg-cream outline-none',
            // Without this the sheet's own content sits under the iPhone home indicator.
            'pb-[env(safe-area-inset-bottom)]',
            className,
          )}
        >
          {/* Drag handle — the affordance that tells a thumb this is draggable. */}
          <div
            aria-hidden="true"
            className="mx-auto mt-4 h-1 w-16 rounded-pill bg-line"
          />

          <div className="flex items-start justify-between gap-4 px-6 pt-4">
            <div className="flex flex-col gap-1">
              <Drawer.Title className="text-h3 font-semibold text-ink">
                {title}
              </Drawer.Title>
              {description && (
                <Drawer.Description className="text-small text-muted">
                  {description}
                </Drawer.Description>
              )}
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close"
              className="grid size-tap shrink-0 place-items-center rounded-pill text-muted transition-colors duration-fast hover:bg-taupe-lt/40 hover:text-ink"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          <div className="overflow-y-auto px-6 pt-4 pb-8">{children}</div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
