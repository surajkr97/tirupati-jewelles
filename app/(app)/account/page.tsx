/**
 * /account — profile, phone verification, sign out.
 * Created by Phase 3 (specs/03-auth.md §3.7).
 *
 * SSR, force-dynamic (MASTER-SPEC §6): per-user, never cached.
 *
 * The phone-verification block is the discovery path for the Phase 8 claim mechanism —
 * §6.6 wants an unverified customer to be told, in plain words, that verifying their
 * number is how past purchases appear.
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AccountActions } from '@/app/(app)/account/account-actions';
import { VerifyPhoneCard } from '@/app/(app)/account/verify-phone-card';
import { Section } from '@/components/shell';
import { Badge, buttonClasses, Card } from '@/components/ui';
import { countClaimableOrders } from '@/lib/auth/claim';
import { getCurrentUser } from '@/lib/auth/guard';
import { ADMIN_SHORTCUT } from '@/lib/navigation';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Your account — Tirupati Jewelles' };

export default async function AccountPage() {
  // The proxy already redirects a cookie-less visitor, but this is the actual boundary —
  // the proxy cannot tell whether the session is real (§3.6).
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/account');

  const claimable =
    user.phone && !user.phoneVerified ? await countClaimableOrders(user.phone) : 0;

  return (
    <Section heading="Your account">
      <div className="flex flex-col gap-6">
        <Card className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <p className="text-h3 font-semibold text-ink">{user.name ?? 'Customer'}</p>
              {user.email && <p className="text-body text-muted">{user.email}</p>}
              {user.phone && <p className="text-body text-muted tabular">{user.phone}</p>}
            </div>
            {user.role === 'ADMIN' && <Badge tone="accent">Admin</Badge>}
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge tone={user.emailVerified ? 'up' : 'outline'}>
              {user.emailVerified ? 'Email verified' : 'Email unverified'}
            </Badge>
            <Badge tone={user.phoneVerified ? 'up' : 'outline'}>
              {user.phoneVerified ? 'Phone verified' : 'Phone unverified'}
            </Badge>
          </div>
        </Card>

        {/*
          Audit C-3, the other half.

          An admin's only marker on this page was the `<Badge>` above — a label, not a link —
          so the dashboard could only be reached by typing `/admin`. `login-form.tsx` now
          routes admins straight there, but this page is still where an admin lands after a
          password reset, or after tapping "Account" in the bottom nav, so it needs the way
          through as well.

          Rendered only for admins. `requireAdminPage()` still guards the destination; this
          is wayfinding, not authorisation.
        */}
        {user.role === 'ADMIN' && (
          <Card className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-h3 font-semibold text-ink">{ADMIN_SHORTCUT.label}</h2>
              <p className="text-small text-muted">
                Set today&rsquo;s rates, build a bill, manage the catalogue.
              </p>
            </div>
            <Link
              href={ADMIN_SHORTCUT.href}
              className={buttonClasses({ variant: 'accent', className: 'w-full sm:w-fit' })}
            >
              <ADMIN_SHORTCUT.icon className="size-4" aria-hidden="true" />
              Open the dashboard
            </Link>
          </Card>
        )}

        {!user.phoneVerified && <VerifyPhoneCard claimableHint={claimable} />}

        <AccountActions />
      </div>
    </Section>
  );
}
