/**
 * Loading UI for the order history. Created by Stage 2 (audit C-2).
 *
 * This route is `force-dynamic` and per-user, so it is the one most likely to be waiting on
 * the database rather than served from a cache — the strongest case for a skeleton in the app.
 */
import { OrdersLoading } from '@/components/shell/route-skeletons';

export default function Loading() {
  return <OrdersLoading />;
}
