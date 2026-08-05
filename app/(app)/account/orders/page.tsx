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
      _count: { select: { items: true } },
    },
  });

  return (
    <Section className="pt-8 md:pt-12">
      <div className="flex flex-col gap-6">
        <h1 className="text-h1 font-semibold tracking-tight text-ink md:text-h1-lg">
          Your orders
        </h1>

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
                <Card className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex flex-col gap-1">
                    <p className="text-body font-semibold text-ink tabular">
                      {order.orderNo}
                    </p>
                    <p className="text-small text-muted">
                      <time dateTime={order.createdAt.toISOString()}>
                        {formatShopDate(order.createdAt)}
                      </time>{' '}
                      · {order._count.items} {order._count.items === 1 ? 'item' : 'items'}
                    </p>
                  </div>

                  <div className="flex items-center gap-4">
                    <p className="text-h3 font-semibold text-ink tabular">
                      {formatINR(order.grandTotal)}
                    </p>
                    {/*
                      Phase 8 owns bill delivery. The key is rendered as a link only when
                      one exists; the route that serves it will re-check ownership itself,
                      because a URL that is unguessable is not the same as a URL that is
                      authorised.
                    */}
                    {order.billPdfKey && (
                      <Link href={`/bills/${order.billPdfKey}`}>
                        <Button variant="outline" size="sm">
                          Bill
                        </Button>
                      </Link>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
