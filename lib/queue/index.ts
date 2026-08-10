/**
 * The job queue. Phase 9 §9.3.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE WORKER BEING DOWN MUST NEVER BREAK A FEATURE.
 *
 *  §9.3's last bullet: "Each task must degrade gracefully if the worker is down. PDF
 *  generation falls back to synchronous rendering. A dead worker must not mean a dead
 *  billing feature."
 *
 *  That is a promise about behaviour, so `enqueueOrRun` below makes it STRUCTURAL rather
 *  than a thing each call site remembers: the fallback is the same function the worker
 *  would have called, invoked inline. A caller cannot forget it, because there is no API
 *  that enqueues without one.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why this is Node and not Celery — read this before "fixing" it ──
 * §9.3 and MASTER-SPEC §2 both name Celery, and `backend/celery_app/` is dormant
 * infrastructure kept expressly for it. It is still there, still in `docker-compose`, still
 * connected, and **must not be deleted** (AGENTS.md hard rule).
 *
 * It cannot run these jobs. Three of §9.3's five tasks are TypeScript by their nature, not
 * by accident:
 *
 *   `bills.generate_pdf`   `lib/bills/render.ts` renders through `@react-pdf/renderer` —
 *                          React components, `lib/pricing.ts`, Prisma. A Python worker
 *                          would need a SECOND invoice implementation, which is the one
 *                          thing §8 forbids outright: "Three implementations of GST
 *                          rounding is three different totals on the same purchase, and
 *                          the customer will find it." It would also duplicate DEBT-027's
 *                          unfinished Indic-font work.
 *   `notify.retry_failed`  `lib/notify/` posts to Resend over HTTPS (D-011).
 *   `media.process_image`  Cloudinary transforms driven from TypeScript (§9.2).
 *
 * The remaining two are pure SQL and Python could do them — but the worker container has
 * only `REDIS_URL` and no database access at all, and Prisma owns the schema. Splitting
 * five jobs across two queue technologies to use both would be worse than either.
 *
 * So the jobs run where the code is. Recorded as **D-042**, with the same standard D-035
 * set for changing something the spec wrote down: state the measurement, state the
 * reasoning, do not quietly edit the spec.
 */
import 'server-only';

import { Queue, type JobsOptions } from 'bullmq';

import { env } from '@/lib/env';
import { log } from '@/lib/log';

/**
 * Every queue in the application, named after §9.3's task list.
 *
 * One queue per kind of work rather than one shared queue: a stuck PDF render must not
 * delay the nightly rollup, and the retry policies below are genuinely different — a failed
 * email is worth retrying for hours, a failed image transform is not.
 */
export const QUEUE = {
  bills: 'bills.generate_pdf',
  rates: 'rates.rollup_history',
  media: 'media.process_image',
  notify: 'notify.retry_failed',
  cleanup: 'cleanup.expire_shares',
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

/**
 * The PRODUCER connection, and it must fail fast. This is not a detail.
 *
 * ── The bug this shape exists to prevent, which the tests caught ──
 * BullMQ's documentation says connections need `maxRetriesPerRequest: null`, and the first
 * version of this file used that here. It is correct for a WORKER — blocking commands
 * (`BZPOPMIN`) hold a connection open for seconds by design and a retry limit kills them.
 * It is catastrophic for a producer: `null` means retry FOREVER, so with the broker down
 * `queue.add()` never rejects. It hangs.
 *
 * Which means `enqueueOrRun` never reaches its fallback, and §9.3's promise — "a dead worker
 * must not mean a dead billing feature" — inverts into a request that hangs until the client
 * gives up. `lib/queue/queue.test.ts` found it by pointing at a dead port: both degradation
 * cases timed out at 20s instead of falling back in milliseconds.
 *
 * This is SEC-008's shape exactly, one layer out. Phase 4 found `enableOfflineQueue: true`
 * measuring 13.4s per call against a dead Redis and rejected it for the same reason: a
 * setting that turns "Redis is down" into "the site is down". The worker keeps `null`, in
 * `scripts/worker.mts`, where it belongs and where hanging is the correct behaviour.
 */
const connection = {
  url: env.REDIS_URL,
  // Reject rather than queue. The fallback is right there and does the work properly.
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  // A page render must not wait a second on a broker to enqueue a background job. The same
  // figure `lib/redis.ts` uses, for the same reason.
  connectTimeout: 1000,
} as const;

/**
 * §9.3: "Every task idempotent with bounded retries and a dead-letter queue."
 *
 * `attempts: 3` with exponential backoff, and — the part that makes it a dead-letter queue
 * rather than a leak — `removeOnFail: false`, so a job that exhausts its attempts STAYS in
 * the failed set where it can be inspected and replayed. BullMQ's default discards it, and
 * a retry policy whose final state is "gone" is not a retry policy.
 *
 * Completed jobs are trimmed: they are worth keeping long enough to answer "did that bill
 * ever render?" and not one row longer.
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 200 },
  removeOnFail: false,
};

const queues = new Map<QueueName, Queue>();

/** Lazily constructed: a module import must not open a socket at build time. */
export function queueFor(name: QueueName): Queue {
  const existing = queues.get(name);
  if (existing) return existing;

  const queue = new Queue(name, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
  // Same reason `lib/redis.ts` attaches one: an unhandled 'error' on an EventEmitter kills
  // the process, which would turn "Redis is down" into "the site is down".
  queue.on('error', (error) =>
    log.error('queue.error', { queue: name, error: String(error) }),
  );

  queues.set(name, queue);
  return queue;
}

export interface EnqueueResult<T> {
  /** `queued` — the worker will do it. `inline` — it has already been done, here. */
  mode: 'queued' | 'inline';
  /** Present only when `mode` is `inline`. */
  result?: T;
  jobId?: string;
}

/**
 * Enqueue `payload`, or do the work here if the queue is unreachable.
 *
 * ── The signature is the requirement ──
 * `run` is not optional. §9.3 asks that every task degrade gracefully, and the reliable way
 * to get that is to make it impossible to enqueue without saying what to do instead — so
 * "we forgot the fallback for this one" cannot happen. It also means the fallback is by
 * construction the SAME code the worker runs, rather than a second, less-tested path that
 * only executes during an incident.
 *
 * ── Why the failure is caught rather than checked ──
 * There is no "is the worker up?" question worth asking: the answer can change between the
 * check and the push, and a worker that is up but wedged looks identical to one that is
 * running fine. What is knowable is whether the push SUCCEEDED, so that is what is tested.
 *
 * Note this degrades on a broker fault, not on a slow worker. A job that is accepted and
 * then never processed is a different failure — that is what the dead-letter queue and
 * §9.4's queue-depth alert are for.
 */
export const ENQUEUE_TIMEOUT_MS = 1000;

/** Reject after `ms`, so a hung broker cannot hold a request open. */
function timeout(ms: number): Promise<never> {
  return new Promise((_resolve, reject) =>
    setTimeout(() => reject(new Error(`enqueue timed out after ${ms}ms`)), ms).unref?.(),
  );
}

export async function enqueueOrRun<T>(
  name: QueueName,
  jobName: string,
  payload: Record<string, unknown>,
  run: () => Promise<T>,
  options?: JobsOptions,
): Promise<EnqueueResult<T>> {
  try {
    /**
     * Raced against a deadline, not merely awaited.
     *
     * Setting `enableOfflineQueue: false` on the connection was the first attempt and it did
     * not work: BullMQ constructs its own ioredis client and forces `maxRetriesPerRequest`
     * to `null` — retry forever — because its blocking commands require that. So with the
     * broker down `add()` does not reject, it HANGS, and the fallback below is never
     * reached. `lib/queue/queue.test.ts` caught it against a dead port: both degradation
     * cases timed out at 20s instead of falling back in milliseconds.
     *
     * A deadline is the right control anyway, and stronger than the setting would have been.
     * It bounds the request path regardless of WHY the broker is slow — down, wedged,
     * failing over, or simply saturated — where a connection flag only covers "refused".
     *
     * The cost, stated: if the push lands after the deadline, the job runs twice — once here
     * and once on the worker. That is exactly why §9.3 requires every task to be idempotent,
     * and why each handler in `jobs.ts` says how it achieves that. A duplicate render
     * overwrites the same PDF key; a duplicate sweep deletes nothing.
     */
    const job = await Promise.race([
      queueFor(name).add(jobName, payload, options),
      timeout(ENQUEUE_TIMEOUT_MS),
    ]);
    return { mode: 'queued', jobId: job.id };
  } catch (error) {
    // Not a warning that something might be wrong — a statement that the queue is down and
    // the work is being done on the request path instead. §9.4 alerts on this line.
    log.error('queue.unavailable.ran_inline', {
      queue: name,
      job: jobName,
      error: String(error),
    });
    return { mode: 'inline', result: await run() };
  }
}

/**
 * Close every queue connection. For scripts and tests; the server never calls it.
 *
 * Without this a `tsx` script that enqueues one job hangs on exit, because BullMQ keeps its
 * connection open — which reads as "the script is stuck" rather than "the socket is open".
 */
export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((queue) => queue.close()));
  queues.clear();
}
