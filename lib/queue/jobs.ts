/**
 * What each queue actually does. Phase 9 §9.3.
 *
 * ── One function per job, callable from either side ──
 * Every handler here is an ordinary async function taking a plain payload. The worker calls
 * it; `enqueueOrRun`'s fallback calls the SAME function inline when the broker is
 * unreachable. That is what makes §9.3's "degrade gracefully if the worker is down" a
 * property of the design rather than a second code path that only runs during an incident
 * and has therefore never been tested.
 *
 * ── Idempotency is a requirement, not an aspiration ──
 * §9.3: "Every task idempotent with bounded retries and a dead-letter queue." A job that is
 * retried three times must not produce three invoices or three emails. Each handler below
 * states how it achieves that; where the answer is "the underlying function already is",
 * that is said rather than assumed.
 */
import 'server-only';

import { z } from 'zod';

import { generateBillPdf } from '@/lib/bills/create';
import { Channel } from '@prisma/client';

import { db } from '@/lib/db';
import { log } from '@/lib/log';
import { notifierFor } from '@/lib/notify';
import { QUEUE, type QueueName } from '@/lib/queue';

/**
 * Payloads are Zod-parsed on the way IN to the handler, not trusted.
 *
 * A queue is a boundary in the §9.1 sense — the message was serialised to Redis by one
 * process and deserialised by another, possibly running a different build mid-deploy. The
 * codebase's rule is "every route body parsed through a Zod schema. Reject, don't coerce";
 * a job payload is the same kind of input and gets the same treatment.
 */
export const BillPdfPayload = z.object({ orderId: z.string().uuid() });
export const NotifyPayload = z.object({
  to: z.string().min(1).max(320),
  message: z.string().min(1).max(4000),
  subject: z.string().min(1).max(200).optional(),
});
export const CleanupPayload = z.object({}).loose();

/**
 * `bills.generate_pdf` — §8.3's render, moved off the request path.
 *
 * **Already idempotent, and that is not luck.** §8.3 split `generateBillPdf` out of
 * `createBill` precisely so it could be the retry path: an order whose render failed has an
 * order row and no `billPdfKey`, and calling this again completes it. An order that already
 * has a key keeps it. Three retries produce one invoice.
 *
 * Note what is NOT moved: the invoice NUMBER. §8.2 allocates it inside the transaction that
 * writes the order, because a gap in a bill sequence is a tax problem. Only the rendering —
 * the slow, retryable, side-effect-free part — is queued.
 */
export async function runGenerateBillPdf(raw: unknown): Promise<{ key: string | null }> {
  const { orderId } = BillPdfPayload.parse(raw);
  return { key: await generateBillPdf(orderId) };
}

/**
 * `notify.retry_failed` — §9.3's "retry queue for failed SMS/email".
 *
 * The retry IS the queue. There is no table of failed sends to sweep — a send either
 * succeeds or throws — so rather than adding one, the send itself is the job: BullMQ retries
 * it three times with exponential backoff and, on exhaustion, leaves it in the failed set,
 * which is the dead-letter queue §9.3 asks for.
 *
 * **Not idempotent in the strict sense, and deliberately so.** A retry can send a second
 * email if the first was delivered and the acknowledgement was lost. For a one-time code or
 * a bill link that is the right trade: a duplicate is a minor annoyance, a silent
 * non-delivery is a customer who cannot sign in. Stated here so the choice is visible.
 */
export async function runNotifyRetry(raw: unknown): Promise<{ delivered: boolean }> {
  const { to, message, subject } = NotifyPayload.parse(raw);
  const result = await notifierFor(Channel.EMAIL).send(to, message, subject);

  // A `delivered: false` that does not throw would be a job that "succeeded" without
  // sending anything, and BullMQ would never retry it.
  if (!result.delivered)
    throw new Error(`notify: delivery reported false for ${subject}`);

  return { delivered: true };
}

/**
 * `cleanup.expire_shares` — DEBT-015, finally swept.
 *
 * `readShare` already refuses anything past `expiresAt`, so the link is dead the moment it
 * expires; the row is what stays. Growth is slow and bounded (30-day TTL, 20 shares per IP
 * per hour) and `@@index([expiresAt])` was added in Phase 5 expressly to make this cheap.
 *
 * Idempotent by shape: deleting rows that are already gone deletes nothing.
 */
export async function runExpireShares(raw: unknown): Promise<{ deleted: number }> {
  CleanupPayload.parse(raw);

  const { count } = await db.calculatorShare.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });

  return { deleted: count };
}

/** The one place a queue name is mapped to the function that serves it. */
export const HANDLERS: Record<QueueName, (payload: unknown) => Promise<unknown>> = {
  [QUEUE.bills]: runGenerateBillPdf,
  [QUEUE.notify]: runNotifyRetry,
  [QUEUE.cleanup]: runExpireShares,
  /**
   * Declared and not yet implemented, on purpose.
   *
   * `rates.rollup_history` needs a table to roll up INTO — daily candles are a new model and
   * a migration — and `media.process_image` duplicates what `scripts/generate-blur.mts`
   * already does at §9.2. Both are listed in §9.3 and neither is built; the checklist says
   * so rather than these being quietly dropped. A job pushed to either queue today would
   * sit unhandled, so nothing pushes to them.
   */
  [QUEUE.rates]: async () => {
    throw new Error('rates.rollup_history is not implemented — see §9.3 and D-042');
  },
  [QUEUE.media]: async () => {
    throw new Error('media.process_image is not implemented — see §9.3 and D-042');
  },
};

/** Queues a worker should actually listen on. */
export const ACTIVE_QUEUES: QueueName[] = [QUEUE.bills, QUEUE.notify, QUEUE.cleanup];

export async function runJob(queue: QueueName, payload: unknown): Promise<unknown> {
  const handler = HANDLERS[queue];
  try {
    return await handler(payload);
  } catch (error) {
    log.error('queue.job.failed', { queue, error: String(error) });
    throw error;
  }
}
