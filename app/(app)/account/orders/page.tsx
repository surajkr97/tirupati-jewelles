/**
 * /account/orders — purchase history.
 * Created by Phase 6 (specs/06-catalog-enquiry.md §6.6).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  ORDERS ARE FETCHED BY THE SESSION'S userId. THERE IS NO ID IN THIS ROUTE.
 *
 *  §6.6: "Lists orders where `userId` matches the session — **never** filtered by a URL
 *  parameter." MASTER-SPEC's IDOR control says the same thing for every order and bill
 *  fetch in the application.
 *
 *  This route takes no parameters at all, which is the strongest form of that guarantee:
 *  there is no id for an attacker to change, so the §6 SECURITY case — "fetch another
 *  user's order by ID → 404" — has no surface here to attack.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Section } from '@/components/shell';
import { Button, Card, EmptyState } from '@/components/ui';
import { getCurrentUser } from '@/lib/auth/guard';
import { formatShopDate } from '@/lib/datetime';
import { db } from '@/lib/db';
import { formatINR } from '@/lib/money';

/** Per-user, never cached (MASTER-SPEC §6). */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your orders',
  robots: { index: false, follow: false },
};

export default async function OrdersPage() {
  const user = await getCurrentUser();

  // `proxy.ts` already bounces a visitor with no session cookie, but that is a UX shortcut
  // and explicitly not the boundary (§3.6). The real check is here.
  if (!user) redirect('/login?next=/account/orders');

  const orders = await db.order.findMany({
    // The session's user id, from the server. Nothing here comes from the request.
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      orderNo: true,
      createdAt: true,
      grandTotal: true,
      billPdfKey: true,
      voidedAt: true,
      _count: { select: { items: true } },
    },
  });

  return (
    <Section className="pt-8 md:pt-12">
      <div className="flex flex-col gap-6">
        <h1 className="text-h1 font-semibold tracking-tight text-ink md:text-h1-lg">
          Your orders
        </h1>

        {/*
          §8.6: "Prominent prompt for users without a verified phone: 'Bought from us
          before? Verify your phone to see your purchases.'"

          Shown to anyone whose number is unverified, whether or not they already have
          orders — a customer can have one online purchase showing and three in-shop ones
          waiting against a number nobody has proved they hold. The empty state below says
          the same thing to a first-time visitor.

          What it does NOT promise is that verifying today will attach them: with email-only
          OTP (D-011) nothing yet proves possession of a number, so the claim does not run.
          DEBT-011 tracks it, and the copy stops short of the claim rather than making one
          the system cannot keep.
        */}
        {!user.phoneVerified && (
          <Card className="flex flex-col gap-2 bg-rose-tint">
            <p className="text-h3 font-semibold text-ink">Bought from us before?</p>
            <p className="text-body text-muted">
              Purchases made in the shop are held against your mobile number. Add and
              confirm your number to see them here.
            </p>
            <div>
              <Link href="/account">
                <Button variant="accent" size="md">
                  Add your mobile number
                </Button>
              </Link>
            </div>
          </Card>
        )}

        {orders.length === 0 ? (
          /*
           * §6.6 gives this copy almost verbatim, and explains why it matters: "This is the
           * discovery path for the Phase 8 claim mechanism." A customer who bought in store
           * has orders waiting against their phone number and no way to know it.
           *
           * Note what it does NOT promise. D-011 records that phone verification currently
           * proves control of the account, not of the number, so the claim does not run
           * yet (DEBT-011). The link is the right destination for when it does.
           */
          <EmptyState
            title="No purchases yet"
            description="If you've bought from us, verify your phone number to see your history."
            action={
              <Link href="/account">
                <Button variant="accent" size="md">
                  Verify your phone number
                </Button>
              </Link>
            }
          />
        ) : (
          <ul className="flex flex-col gap-4">
            {orders.map((order) => (
              <li key={order.id}>
                {/*
                  The whole row is the link, and it goes to the ownership-checked detail
                  page (§8.6) rather than straight at the PDF. `/bills/{key}` still serves
                  this customer — their session is one of the three proofs it accepts — but
                  an unguessable URL is not an authorisation (DEBT-021), and the route that
                  filters by the session's `userId` is the one that belongs in a list.
                */}
                <Link href={`/account/orders/${order.id}`} className="block">
                  <Card className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="flex flex-col gap-1">
                      <p className="text-body font-semibold text-ink tabular">
                        {order.orderNo}
                      </p>
                      <p className="text-small text-muted">
                        <time dateTime={order.createdAt.toISOString()}>
                          {formatShopDate(order.createdAt)}
                        </time>{' '}
                        · {order._count.items}{' '}
                        {order._count.items === 1 ? 'item' : 'items'}
                        {order.voidedAt && ' · cancelled'}
                      </p>
                    </div>

                    <div className="flex items-center gap-4">
                      <p className="text-h3 font-semibold text-ink tabular">
                        {formatINR(order.grandTotal)}
                      </p>
                      {order.billPdfKey && (
                        <span className="inline-flex h-tap items-center rounded-pill px-4 text-small font-semibold text-rose-deep ring-1 ring-line ring-inset">
                          Invoice
                        </span>
                      )}
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
