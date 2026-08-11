/**
 * The job worker. Phase 9 §9.3.
 *
 *   pnpm worker
 *
 * One process, listening on every active queue, plus the repeatable schedule that replaces
 * Celery Beat. Run it alongside `next start` in production; `docker-compose` runs it as the
 * `jobs` service.
 *
 * ── Why this is Node and not Celery ──
 * D-042, and the header of `lib/queue/index.ts`. The short version: three of §9.3's five
 * tasks render React, post to Resend, or drive Cloudinary — TypeScript by nature — and a
 * Python worker would need a second invoice implementation, which §8 forbids outright. The
 * dormant Celery package that §9.3 originally named was removed on 2026-08-11.
 *
 * ── Shutdown is graceful on purpose ──
 * A worker killed mid-render leaves a job in the active set until its lock expires, and the
 * next worker retries it. That is correct but slow, and during a deploy it is entirely
 * avoidable: `close()` finishes the job in hand and stops taking new ones.
 */
import { Worker, type Job } from 'bullmq';
import { config } from 'dotenv';

// `.env` first, then dynamic imports. `lib/env.ts` parses at import time and `tsx` does not
// load `.env` on its own, so a static import would throw before dotenv had run — the same
// ordering `scripts/verify-bill.mts` and `scripts/lighthouse.mts` use.
config({ path: '.env', quiet: true });

const { env } = await import('@/lib/env');
const { log } = await import('@/lib/log');
const { closeQueues, DEFAULT_JOB_OPTIONS, QUEUE, queueFor } = await import('@/lib/queue');
const { ACTIVE_QUEUES, runJob } = await import('@/lib/queue/jobs');

const connection = { url: env.REDIS_URL, maxRetriesPerRequest: null } as const;

/**
 * §9.3: "Celery Beat schedule for the periodic ones."
 *
 * `upsertJobScheduler` — BullMQ 6's replacement for `add({ repeat })`, and the reason to use
 * it is the "upsert": the schedule lives in Redis under a stable key, so re-running this
 * file REPLACES its definition instead of adding a second timer. A scheduler that doubles
 * its work on every deploy is the classic way a nightly job quietly becomes an hourly one.
 *
 * The first attempt used `add(name, data, { repeat, jobId })`, which is the older form; it
 * ran the cleanup immediately on boot rather than only at the pattern. Harmless here — the
 * sweep is idempotent — but it is not what "nightly" means, and it was visible in the boot
 * log rather than assumed.
 *
 * Times are IST. The rest of the application pins `Asia/Kolkata` (D-014) because the shop is
 * in one place, and a cleanup that runs at "midnight UTC" runs at 5:30am to the owner.
 */
const SCHEDULE = [
  {
    queue: QUEUE.cleanup,
    name: 'nightly',
    payload: {},
    // 03:15 IST — after the shop closes, before anyone opens the dashboard.
    pattern: '15 3 * * *',
  },
] as const;

async function installSchedule(): Promise<void> {
  for (const entry of SCHEDULE) {
    await queueFor(entry.queue).upsertJobScheduler(
      // The scheduler key. Stable, so a restart updates rather than duplicates.
      `${entry.queue}:${entry.name}`,
      { pattern: entry.pattern, tz: 'Asia/Kolkata' },
      { name: entry.name, data: entry.payload, opts: DEFAULT_JOB_OPTIONS },
    );
    log.info('worker.schedule.installed', { queue: entry.queue, pattern: entry.pattern });
  }
}

function startWorkers(): Worker[] {
  return ACTIVE_QUEUES.map((name) => {
    const worker = new Worker(name, async (job: Job) => runJob(name, job.data), {
      connection,
      // One job at a time per queue. A PDF render is CPU-bound and this process shares a
      // box with `next start`; parallelism here buys throughput the shop does not need and
      // costs latency on the page a customer is waiting for.
      concurrency: 1,
    });

    worker.on('completed', (job) =>
      log.info('worker.job.completed', { queue: name, jobId: job.id }),
    );

    worker.on('failed', (job, error) =>
      log.error('worker.job.failed', {
        queue: name,
        jobId: job?.id,
        // `attemptsMade` against `attempts` is what distinguishes "will retry" from "this
        // is now in the dead-letter set", which is the only part an alert should page on.
        attempt: job?.attemptsMade,
        of: job?.opts.attempts,
        error: String(error),
      }),
    );

    worker.on('error', (error) =>
      log.error('worker.error', { queue: name, error: String(error) }),
    );

    log.info('worker.listening', { queue: name });
    return worker;
  });
}

async function main(): Promise<void> {
  await installSchedule();
  const workers = startWorkers();

  const shutdown = async (signal: string) => {
    log.info('worker.shutdown', { signal });
    await Promise.all(workers.map((worker) => worker.close()));
    await closeQueues();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  log.error('worker.boot.failed', { error: String(error) });
  process.exitCode = 1;
});
