/**
 * Redis cache hit rate — §9.2's "instrument and confirm". Phase 9.
 *
 *   pnpm cache:stats            report what the counters hold
 *   pnpm cache:stats --reset    zero them, so a measurement starts from a known point
 *   pnpm cache:stats --drive    reset, generate realistic traffic, then report
 *
 * ── What §9.2 asks for, and the part of it that does not exist ──
 * "Redis hit rate > 80% on rates and products." Rates are cache-aside on Redis
 * (`rates:current`) and are measured here. **Products are not in Redis at all** — a product
 * page is ISR'd HTML and a product card is priced from the rate, so the product cache is
 * Next's, not Redis's. Its hit rate is the `x-nextjs-cache` header, which §9.2 already
 * verified in its own checklist item, and `--drive` reports it alongside so the two halves
 * of the criterion appear together rather than one being quietly dropped.
 *
 * ── Why a script and not a dashboard ──
 * The number is wanted at a moment — before a launch, after a change — not watched. A
 * dashboard for it would be a page nobody opens, and §9.4 already owns the alerting surface.
 */
import { config } from 'dotenv';

config({ path: '.env', quiet: true });

const { readCacheStats, resetCacheStats, redis } = await import('../lib/redis.ts');

const ORIGIN = process.env.VERIFY_ORIGIN ?? 'http://localhost:3000';

/** §9.2's threshold, in one place. */
const TARGET = 0.8;

/** The namespaces §9.2 names. `settings` and `search` are reported but not gated. */
const GATED = ['rates'];

function pct(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

async function report(): Promise<boolean> {
  const stats = await readCacheStats();

  if (stats.length === 0) {
    console.log(
      'No counters yet. Nothing has read through `cached()` since the last reset —\n' +
        'run `pnpm cache:stats --drive`, or browse the site and try again.',
    );
    return true;
  }

  console.log('  namespace     hits    misses   faults   hit rate   since');
  console.log('  ─────────────────────────────────────────────────────────────────────');
  for (const s of stats) {
    const gate = GATED.includes(s.namespace)
      ? s.hitRate !== null && s.hitRate >= TARGET
        ? ' ✓'
        : ' ✗'
      : '';
    console.log(
      `  ${s.namespace.padEnd(12)}${String(s.hit).padStart(6)}${String(s.miss).padStart(9)}` +
        `${String(s.fault).padStart(9)}${pct(s.hitRate).padStart(11)}${gate}   ` +
        `${s.since ? s.since.toISOString().replace('T', ' ').slice(0, 19) : '—'}`,
    );
  }

  const failures = stats.filter(
    (s) => GATED.includes(s.namespace) && (s.hitRate === null || s.hitRate < TARGET),
  );

  console.log();
  if (failures.length) {
    for (const s of failures) {
      console.error(
        `  ✗ ${s.namespace} is at ${pct(s.hitRate)}, under §9.2's ${TARGET * 100}%`,
      );
    }
    return false;
  }

  console.log(`  ✓ every gated namespace is at or above §9.2's ${TARGET * 100}%`);
  return true;
}

/**
 * Realistic traffic, not a loop on one URL.
 *
 * A hit rate is only meaningful against the access pattern it will actually see. The
 * homepage and `/api/rates` are the two surfaces §9.2's rate budget is about, and the
 * catalogue is included because it reads the same `rates:current` key on every render.
 *
 * The FIRST request of each kind is a miss by definition — the cache is cold after a reset
 * — which is exactly why the target is 80% and not 100%. That is stated rather than hidden
 * by warming the cache before measuring.
 */
async function drive(): Promise<void> {
  const paths = [
    '/api/rates',
    '/',
    '/collections',
    '/rates',
    '/api/rates/history?days=30',
  ];
  const rounds = 12;

  /**
   * Start COLD, deliberately.
   *
   * The first version of this reset only the counters, leaving `rates:current` warm from
   * whatever had been browsing earlier — and reported 100% with zero misses. That number
   * looks like the best possible result and is actually the weakest: a run that never sees
   * a miss has not exercised the miss counter at all, so it cannot tell a working
   * instrument from one that only ever increments `hit`.
   *
   * Dropping the key first means the run measures a cache warming from empty, which is also
   * the honest shape of the question — a deploy restarts with a cold cache, and the budget
   * has to hold through that rather than only in the steady state.
   */
  const { invalidate } = await import('../lib/redis.ts');
  const { RATES_CACHE_KEY } = await import('../lib/rates.ts');
  await invalidate(RATES_CACHE_KEY);

  console.log(
    `Driving ${paths.length * rounds} requests at ${ORIGIN}, from a cold rates cache…\n`,
  );

  let isrHit = 0;
  let isrTotal = 0;

  for (let round = 0; round < rounds; round += 1) {
    for (const path of paths) {
      try {
        const response = await fetch(`${ORIGIN}${path}`, { cache: 'no-store' });
        await response.text();

        // The other half of §9.2's criterion: products and pages are cached by Next, not
        // by Redis, and `x-nextjs-cache` is where that shows.
        const header = response.headers.get('x-nextjs-cache');
        if (header) {
          isrTotal += 1;
          if (header === 'HIT') isrHit += 1;
        }
      } catch (error) {
        console.error(`  ! ${path} — ${String(error)}`);
      }
    }
  }

  if (isrTotal > 0) {
    console.log(
      `  ISR (the product/page cache, x-nextjs-cache): ` +
        `${((isrHit / isrTotal) * 100).toFixed(1)}% of ${isrTotal} cacheable responses\n`,
    );
  }

  await checkEdge();
}

/**
 * §9.2's other item: "Enable compression and a CDN for static assets."
 *
 * Checked here rather than in a fourth script because it is the same question one layer
 * out — Redis caches data, ISR caches pages, and this is what the browser and any CDN in
 * front are allowed to cache. All three have to be right for a page to be fast, and all
 * three are silent when they are wrong.
 *
 * ── What is code and what is ops ──
 * Compression and the cache headers are the application's job and are asserted. The CDN
 * itself is not: on Render that is a platform setting or a proxy in front, and there is
 * nothing in this repository that can turn it on. What this proves is that the assets are
 * *cacheable by* a CDN — `immutable` with a one-year max-age on content-hashed filenames —
 * because a CDN in front of assets that forbid caching buys precisely nothing.
 */
async function checkEdge(): Promise<void> {
  const html = await fetch(`${ORIGIN}/`, { headers: { 'accept-encoding': 'gzip' } });
  const body = await html.text();

  const chunk = /\/_next\/static\/chunks\/[A-Za-z0-9_.-]+\.js/.exec(body)?.[0];
  if (!chunk) {
    console.error('  ! could not find a static chunk in the homepage HTML');
    return;
  }

  const asset = await fetch(`${ORIGIN}${chunk}`, {
    headers: { 'accept-encoding': 'gzip' },
  });

  const rows: [string, boolean, string][] = [
    [
      'HTML is compressed',
      html.headers.get('content-encoding') === 'gzip',
      html.headers.get('content-encoding') ?? 'none',
    ],
    [
      'static JS is compressed',
      asset.headers.get('content-encoding') === 'gzip',
      asset.headers.get('content-encoding') ?? 'none',
    ],
    [
      'static JS is cacheable by a CDN for a year',
      /max-age=31536000/.test(asset.headers.get('cache-control') ?? '') &&
        /immutable/.test(asset.headers.get('cache-control') ?? ''),
      asset.headers.get('cache-control') ?? 'none',
    ],
    [
      'Vary: Accept-Encoding, so a proxy cannot serve gzip to a client that cannot read it',
      /accept-encoding/i.test(asset.headers.get('vary') ?? ''),
      asset.headers.get('vary') ?? 'none',
    ],
  ];

  console.log('  Edge caching');
  for (const [label, ok, detail] of rows) {
    console.log(`    ${ok ? '✓' : '✗'} ${label} — ${detail}`);
  }
  console.log();
}

async function main(): Promise<void> {
  try {
    if (process.argv.includes('--reset') || process.argv.includes('--drive')) {
      const cleared = await resetCacheStats();
      console.log(`Counters reset (${cleared} namespace(s) cleared).\n`);
      if (!process.argv.includes('--drive')) return;
    }

    if (process.argv.includes('--drive')) await drive();

    const ok = await report();
    if (!ok) process.exitCode = 1;
  } finally {
    redis.disconnect();
  }
}

await main();
