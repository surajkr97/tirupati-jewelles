/**
 * Toast — thin wrapper over `sonner`, themed to the design tokens.
 * Created by Phase 2 (specs/02-design-system.md §2.2).
 *
 * Re-exporting `toast` here means feature code imports from the design system rather than
 * the vendor, so swapping the library later touches one file.
 */
'use client';

import { Toaster as SonnerToaster } from 'sonner';

export { toast } from 'sonner';

export function Toaster() {
  return (
    <SonnerToaster
      position="top-center"
      // Errors must not evaporate before they are read.
      duration={4000}
      toastOptions={{
        classNames: {
          toast: 'rounded-card bg-white text-ink shadow-lift border-0',
          description: 'text-muted',
          actionButton: 'rounded-pill bg-ink text-white',
          cancelButton: 'rounded-pill bg-line text-ink',
          error: 'text-down',
          success: 'text-up',
        },
      }}
    />
  );
}
