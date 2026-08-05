/**
 * Sign out, here and everywhere.
 * Created by Phase 3 (specs/03-auth.md §3.3).
 */
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, Card, toast } from '@/components/ui';

export function AccountActions() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut(everywhere: boolean) {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ everywhere }),
      });
      router.replace('/');
      router.refresh();
    } catch {
      toast.error('Could not sign out. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-h3 font-semibold text-ink">Sign out</h2>

      <Button variant="outline" full loading={busy} onClick={() => void signOut(false)}>
        Sign out
      </Button>

      <Button variant="ghost" full disabled={busy} onClick={() => void signOut(true)}>
        Sign out of all devices
      </Button>
      <p className="text-small text-muted">
        Signing out everywhere ends every session on every device — use it if you think
        someone else has access.
      </p>
    </Card>
  );
}
