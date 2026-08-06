/**
 * /claim/[token] — "these purchases are yours".
 * Created by Phase 9 (DEBT-011). Closes Phase 8's acceptance criterion 4.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THIS PAGE LOOKS. IT DOES NOT ACT.
 *
 *  The token is a single-use credential and this is a GET, so it must not consume anything:
 *  a WhatsApp link preview, a browser prefetch, or the customer forwarding the message to
 *  themselves would each burn it, and they cannot ask for another one. `peekClaimToken`
 *  reads; `POST /api/auth/claim` is what redeems.
 *
 *  A signed-out visitor is sent to log in and brought back here. That is not friction for
 *  its own sake: the token proves who holds the NUMBER, and the session decides which
 *  ACCOUNT the purchases attach to. Both are needed or "claim" has no destination.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ClaimCard } from '@/app/(app)/claim/[token]/claim-card';
import { Section } from '@/components/shell';
import { Button, Card } from '@/components/ui';
import { countClaimableOrders } from '@/lib/auth/claim';
import { peekClaimToken } from '@/lib/auth/claim-token';
import { getCurrentUser } from '@/lib/auth/guard';

/** Per-visitor and never cached. The answer depends on a session and on a one-shot token. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your purchases',
  // The URL is a credential. It must never be indexed, and nothing should follow from it.
  robots: { index: false, follow: false, nocache: true },
};

/** The last four digits, so the customer can recognise the number without it being shown. */
function maskPhone(phone: string): string {
  return `••••• ${phone.slice(-5)}`;
}

export default async function ClaimPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const looked = await peekClaimToken(token);
  const user = await getCurrentUser();

  /**
   * A spent link, from an account that has already proven a number.
   *
   * Almost always the same customer reloading, or re-opening the WhatsApp message after
   * claiming. Telling them the link is dead is technically true and useless; telling them
   * they are already set up is both. This reveals nothing about the token — the fact
   * asserted is about the visitor's own account.
   */
  if (!looked.ok && user?.phoneVerified) {
    return (
      <Section className="pt-8 md:pt-12">
        <Card className="flex flex-col gap-4">
          <h1 className="text-h2 font-semibold text-ink">You&rsquo;re all set</h1>
          <p className="text-body text-muted">
            Your number is confirmed, so your purchases are in your account.
          </p>
          <div>
            <Link href="/account/orders">
              <Button variant="accent" size="md">
                See your orders
              </Button>
            </Link>
          </div>
        </Card>
      </Section>
    );
  }

  if (!looked.ok) {
    return (
      <Section className="pt-8 md:pt-12">
        <Card className="flex flex-col gap-4">
          <h1 className="text-h2 font-semibold text-ink">This link is no longer valid</h1>
          {/*
            One message for expired, already-used and never-existed. Telling them apart
            would confirm to a guesser which tokens exist — and to the customer standing
            there, the next step is the same either way.
          */}
          <p className="text-body text-muted">
            Links expire after seven days and can only be used once. Ask the shop to
            resend your bill and we&rsquo;ll include a fresh one.
          </p>
          <div>
            <Link href="/">
              <Button variant="outline" size="md">
                Back to the shop
              </Button>
            </Link>
          </div>
        </Card>
      </Section>
    );
  }

  if (!user) {
    // Straight back here afterwards, token intact — it has not been touched.
    redirect(`/login?next=${encodeURIComponent(`/claim/${token}`)}`);
  }

  const waiting = await countClaimableOrders(looked.phone);

  return (
    <Section className="pt-8 md:pt-12">
      <div className="flex flex-col gap-6">
        <h1 className="text-h1 font-semibold tracking-tight text-ink md:text-h1-lg">
          Your purchases
        </h1>

        <ClaimCard
          token={token}
          maskedPhone={maskPhone(looked.phone)}
          waiting={waiting}
          alreadyVerified={user.phoneVerified && user.phone === looked.phone}
        />
      </div>
    </Section>
  );
}
