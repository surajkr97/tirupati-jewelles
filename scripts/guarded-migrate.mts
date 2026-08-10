/**
 * `prisma migrate dev`, with a refusal in front of it. Phase 9 §9.8 (D-054).
 *
 *   pnpm db:migrate [--name add_thing]
 *
 * ── Why this wrapper exists ──
 * `migrate dev` is the most destructive command in this repository and it does not read like
 * one. When it detects drift between the migration history and the database it **resets** —
 * drops everything and replays from scratch. That is correct and useful on a laptop, and
 * against production it is total loss.
 *
 * Prisma's CLI has no hook to check first, so the check lives here and the package script
 * points at this file instead of at Prisma. `pnpm db:deploy` (`migrate deploy`) is the safe
 * command — forward-only, never resets — and is what Render runs; it is deliberately NOT
 * wrapped, because a deploy applying pending migrations to a remote database is its job.
 */
import { spawn } from 'node:child_process';

import { config } from 'dotenv';

config({ path: '.env', quiet: true });

const { env, assertLocalDatabase } = await import('../lib/env.ts');

try {
  /**
   * `migrate dev` connects through `directUrl` — the OWNER url — so that is the one to check.
   *
   * Read from `process.env` rather than `lib/env.ts`, because `MIGRATE_DATABASE_URL` is not
   * in that schema: `schema.prisma` resolves it itself via `env("MIGRATE_DATABASE_URL")`, so
   * the application never reads it and adding it to the Zod schema would make every runtime
   * demand a variable only migrations use. This file is a `.mts` script and outside the
   * `no-restricted-properties` rule for exactly this kind of harness concern.
   */
  assertLocalDatabase(
    process.env.MIGRATE_DATABASE_URL ?? env.DATABASE_URL,
    'pnpm db:migrate',
  );
} catch (error) {
  console.error(`Refusing to run.\n\n${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

const child = spawn(
  'pnpm',
  ['exec', 'prisma', 'migrate', 'dev', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
  },
);
child.on('exit', (code) => process.exit(code ?? 1));
