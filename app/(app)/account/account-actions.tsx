/**
 * Sign out, here and everywhere.
 * Created by Phase 3 (specs/03-auth.md §3.3), restyled by the UI redesign, Stage 3 (C-7).
 *
 * ── What changed, and why it is quieter ──
 *
 * This was a `Card` with a heading, a full-width outline button, a second full-width button
 * and an explanatory paragraph — four elements and the visual weight of a primary action, for
 * something nobody comes to this page to do. Brief §17 asks for a quiet destructive action;
 * the audit (C-7) also found that signing out gave no confirmation at all, only a silent
 * redirect to a homepage that looks identical whether or not it worked.
 *
 * Now: one text button, and "everywhere" demoted to the small print it belongs in. The toast
 * is the confirmation — the redirect lands on `/`, where nothing visibly differs, so without
 * it the only evidence of success is the absence of evidence.
 */
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { toast } from '@/components/ui';
import { cn } from '@/lib/utils/cn';

export function AccountActions() {
  const router = useRouter();
  const [busy, setBusy] = useState<'one' | 'all' | null>(null);

  async function signOut(everywhere: boolean) {
    setBusy(everywhere ? 'all' : 'one');
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ everywhere }),
      });

      // The route clears the cookie even for an already-dead session, so a non-OK response
      // means something genuinely went wrong rather than "you were not signed in".
      if (!response.ok) throw new Error('logout failed');

      toast.success(everywhere ? 'Signed out on every device' : 'Signed out');
      router.replace('/');
      router.refresh();
    } catch {
      toast.error('Could not sign out. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2 pt-4">
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => void signOut(false)}
        className={cn(
          'flex h-tap items-center text-body font-medium',
          // `down`, not a filled red block. Destructive here means "reversible in ten
          // seconds by signing back in", and the styling should say that.
          'text-down transition-opacity duration-fast ease-standard hover:underline',
          'disabled:pointer-events-none disabled:opacity-40',
        )}
      >
        {busy === 'one' ? 'Signing out…' : 'Sign out'}
      </button>

      {/*
        A separate control, not a link inside the sentence.

        MASTER-SPEC §3 requires every interactive element to be at least 44×44px, and an
        inline button in a line of 14px prose cannot be that without wrecking the line height
        around it. So the button is its own 44px row and the explanation follows it — which
        also means the sentence reads the same whether or not you can see the styling.
      */}
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => void signOut(true)}
        aria-describedby="sign-out-everywhere-hint"
        className={cn(
          'flex h-tap items-center text-small font-medium text-rose-deep',
          'transition-opacity duration-fast ease-standard hover:underline',
          'disabled:pointer-events-none disabled:opacity-40',
        )}
      >
        {busy === 'all' ? 'Signing out everywhere…' : 'Sign out of all devices'}
      </button>

      <p id="sign-out-everywhere-hint" className="max-w-prose text-small text-muted">
        Ends every session on every device — use it if you think someone else has access.
      </p>
    </div>
  );
}
