/**
 * Lighthouse mobile, against a production build (DEBT-020, §9.2 acceptance criterion 1).
 *
 *   pnpm build && pnpm lighthouse
 *
 * ── Why this exists as a script rather than a run someone did once ──
 * §9.2 measured Web Vitals directly and recorded them, and that measurement is more precise
 * per metric than Lighthouse — but it does not produce Lighthouse's category scores, which
 * is what §9.2's acceptance criterion and §6 TEST both ask for. This closes that gap, and it
 * is a script so the number can be reproduced rather than quoted.
 *
 * ── Why it starts its own server ──
 * `next dev` compiles per request and its numbers mean nothing. This boots `next start` on
 * its own port so it cannot collide with the two dev servers `playwright.config.ts` runs,
 * and shuts it down afterwards even on failure.
 *
 * ── Why the product slug is looked up ──
 * §6 TEST names `/products/[slug]`, and DEBT-020 was deferred precisely because the seeded
 * products had no images: a score measured on an imageless page is not the score at launch.
 * The route is resolved from the database and the run FAILS if the chosen product has no
 * image, rather than quietly measuring the easy case again.
 */
import { spawn, type ChildProcess } from 'node:child_process';

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';

config({ path: '.env', quiet: true });

const PORT = 3100;
const ORIGIN = `http://localhost:${PORT}`;

/** §9.2: "Lighthouse mobile ≥ 90 all categories." */
const THRESHOLD = 90;

const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'] as const;

async function main() {
  const db = new PrismaClient();

  const product = await db.product.findFirst({
    where: { isActive: true, images: { some: {} } },
    select: { slug: true, name: true, _count: { select: { images: true } } },
    orderBy: { createdAt: 'asc' },
  });
  await db.$disconnect();

  if (!product) {
    throw new Error(
      'No active product has an image. DEBT-020 exists because a score measured on an ' +
        'imageless page is not the score at launch — seed real photography first.',
    );
  }

  const routes = [
    '/',
    '/rates',
    '/collections',
    `/products/${product.slug}`,
    '/calculator',
  ];

  const server = await startServer();
  const chrome = await chromeLauncher.launch({
    chromeFlags: ['--headless=new', '--no-sandbox'],
  });

  const results: { route: string; scores: Record<string, number> }[] = [];

  try {
    for (const route of routes) {
      // Warm the route first. The first visitor to an image variant waits for
      // `/_next/image` to generate it, which §9.2 measured as 2676ms cold vs 1264ms warm —
      // a real cost, but one that belongs to the first request rather than to the page.
      await fetch(`${ORIGIN}${route}`).then((response) => response.text());

      const run = await lighthouse(
        `${ORIGIN}${route}`,
        { port: chrome.port, output: 'json', logLevel: 'error' },
        // Lighthouse's default config is already the mobile profile: 4× CPU throttle,
        // 1.6 Mbps down, 150ms RTT, 412×823 screen emulation.
        undefined,
      );

      if (!run?.lhr) throw new Error(`Lighthouse returned nothing for ${route}`);

      const scores: Record<string, number> = {};
      for (const key of CATEGORIES) {
        const category = run.lhr.categories[key];
        scores[key] = Math.round((category?.score ?? 0) * 100);
      }
      results.push({ route, scores });
      report(route, scores);
    }
  } finally {
    await chrome.kill();
    server.kill('SIGTERM');
  }

  console.log(`\nProduct measured: ${product.name} (${product._count.images} images)\n`);

  const failures = results.filter((result) =>
    CATEGORIES.some((key) => (result.scores[key] ?? 0) < THRESHOLD),
  );

  if (failures.length > 0) {
    console.error(`FAIL — ${failures.length} route(s) below ${THRESHOLD}:`);
    for (const failure of failures) {
      const below = CATEGORIES.filter((key) => (failure.scores[key] ?? 0) < THRESHOLD)
        .map((key) => `${key} ${failure.scores[key]}`)
        .join(', ');
      console.error(`  ${failure.route} — ${below}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`PASS — every category ≥ ${THRESHOLD} on all ${routes.length} routes.`);
}

function report(route: string, scores: Record<string, number>) {
  const line = CATEGORIES.map(
    (key) => `${key.padEnd(15)} ${String(scores[key]).padStart(3)}`,
  ).join('   ');
  console.log(`${route.padEnd(28)} ${line}`);
}

/** `next start`, waited for rather than slept on. */
async function startServer(): Promise<ChildProcess> {
  const server = spawn('pnpm', ['exec', 'next', 'start', '--port', String(PORT)], {
    stdio: ['ignore', 'pipe', 'inherit'],
    env: process.env,
  });

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${ORIGIN}/api/health`);
      if (response.ok) return server;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  server.kill('SIGTERM');
  throw new Error(`next start did not answer on ${ORIGIN} within 60s`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
