/**
 * Phase 9 TEST — §9.3's queue, and the promise it exists to keep.
 *
 * §9.3's last bullet is the one worth testing hardest: "Each task must degrade gracefully if
 * the worker is down. **A dead worker must not mean a dead billing feature.**" Everything
 * else here — retries, the dead-letter queue, the beat schedule — is BullMQ's behaviour and
 * belongs to BullMQ's own suite. What is ours is the guarantee that a broker fault turns
 * into work done inline rather than into an error a customer sees.
 *
 * Tested against a DEAD PORT rather than a mocked queue, the same technique Phase 1 used for
 * `cached()`: a mock would only prove the mock throws when told to, and the failure mode
 * here is a real socket refusing a real connection.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Nothing listens here. `redis://127.0.0.1:1` is refused immediately, not slowly. */
const DEAD_BROKER = 'redis://127.0.0.1:1/0';

describe('enqueueOrRun — the worker being down must not break the feature', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function withBroker(url: string) {
    vi.stubEnv('REDIS_URL', url);
    return import('@/lib/queue');
  }

  it('runs the work inline when the broker is unreachable, and returns its result', async () => {
    const { enqueueOrRun, QUEUE, closeQueues } = await withBroker(DEAD_BROKER);

    const fallback = vi.fn(async () => 'rendered');
    const result = await enqueueOrRun(
      QUEUE.bills,
      'generate',
      { orderId: 'x' },
      fallback,
    );

    expect(result.mode).toBe('inline');
    expect(result.result).toBe('rendered');
    expect(fallback).toHaveBeenCalledTimes(1);

    await closeQueues().catch(() => {});
  }, 20_000);

  it('does not swallow a failure in the fallback itself', async () => {
    // The degradation is "do it here instead", not "pretend it happened". A bill that fails
    // to render inline must surface, or the admin is told a PDF exists and it does not.
    const { enqueueOrRun, QUEUE, closeQueues } = await withBroker(DEAD_BROKER);

    await expect(
      enqueueOrRun(QUEUE.bills, 'generate', { orderId: 'x' }, async () => {
        throw new Error('render failed');
      }),
    ).rejects.toThrow('render failed');

    await closeQueues().catch(() => {});
  }, 20_000);

  it('queues rather than running inline when the broker IS reachable', async () => {
    // The positive control. Without it the first test passes just as green against an
    // implementation that never enqueues at all — which would satisfy the degradation
    // requirement by abandoning the queue entirely.
    const { enqueueOrRun, QUEUE, queueFor, closeQueues } = await import('@/lib/queue');

    const fallback = vi.fn(async () => 'should not run');
    const result = await enqueueOrRun(
      QUEUE.cleanup,
      'test-sweep',
      {},
      fallback,
      // Not retried and removed on completion: this job is never processed by a worker in
      // the test environment, and it must not be left behind for one to pick up later.
      { attempts: 1, removeOnComplete: true },
    );

    expect(result.mode).toBe('queued');
    expect(result.jobId).toBeTruthy();
    expect(fallback).not.toHaveBeenCalled();

    // Leave nothing behind — a stray job would be processed by the next `pnpm worker`.
    const job = await queueFor(QUEUE.cleanup).getJob(result.jobId!);
    await job?.remove();
    await closeQueues();
  }, 20_000);
});

describe('job payloads are validated, not trusted', () => {
  it('rejects a payload that is not what the handler expects', async () => {
    // A queue is a boundary in the §9.1 sense: the message was written by one process and is
    // read by another, possibly on a different build mid-deploy.
    const { BillPdfPayload, NotifyPayload } = await import('@/lib/queue/jobs');

    expect(() => BillPdfPayload.parse({ orderId: 'not-a-uuid' })).toThrow();
    expect(() => BillPdfPayload.parse({})).toThrow();
    expect(() => NotifyPayload.parse({ to: '', message: 'x' })).toThrow();
    expect(() =>
      NotifyPayload.parse({ to: 'a@b.test', message: 'x'.repeat(5000) }),
    ).toThrow();
  });

  it('accepts what the enqueue side actually sends', async () => {
    const { BillPdfPayload, NotifyPayload } = await import('@/lib/queue/jobs');

    expect(() =>
      BillPdfPayload.parse({ orderId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' }),
    ).not.toThrow();
    expect(() =>
      NotifyPayload.parse({ to: 'a@b.test', message: 'hello', subject: 'Hi' }),
    ).not.toThrow();
  });
});

describe('the retry policy is a retry policy', () => {
  it('keeps a job that has exhausted its attempts, which is the dead-letter queue', async () => {
    // §9.3 asks for "bounded retries and a dead-letter queue". BullMQ's default discards a
    // failed job, and a retry policy whose final state is "gone" is not one — there is
    // nothing left to inspect or replay.
    const { DEFAULT_JOB_OPTIONS } = await import('@/lib/queue');

    expect(DEFAULT_JOB_OPTIONS.attempts).toBeGreaterThan(1);
    expect(DEFAULT_JOB_OPTIONS.removeOnFail).toBe(false);
    expect(DEFAULT_JOB_OPTIONS.backoff).toMatchObject({ type: 'exponential' });
  });
});
