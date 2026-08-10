/**
 * Automated Postgres backup with 30-day retention. Phase 9 §9.5.
 *
 *   pnpm backup
 *
 * ── What this is, and what it deliberately is not ──
 * §9.5 asks for "automated daily Postgres backups, 30-day retention". That is two halves: a
 * command that takes a correct backup and prunes old ones, and something that runs it every
 * day. This is the first half, and it is the half that can be tested — the schedule is one
 * cron line (printed by `--help`) and is ops, not code.
 *
 * It is NOT a replacement for the deploy platform's own backups. Render's managed Postgres
 * takes its own daily snapshots, and those are the primary. This exists because a snapshot
 * you cannot restore is not a backup (§9.5's second item), and because a provider snapshot
 * cannot be restored anywhere except back into that provider. `pnpm verify:restore` proves
 * THIS file's output, on this machine, into a scratch database.
 *
 * ── Custom format, not plain SQL ──
 * `-Fc` compresses, and more importantly `pg_restore` can read it selectively and in
 * parallel. It also survives the thing plain SQL does not: `BillPdf.bytes` is `bytea`
 * (D-026), and a plain dump renders 91 invoices as multi-megabyte hex string literals that
 * one stray `sed` in a "fix the dump" script silently corrupts. `verify-restore.mts` checks
 * those bytes by digest for exactly that reason.
 *
 * ── Backups are personal data — DEBT-031 ──
 * D-026 put rendered invoice PDFs in Postgres, so a dump holds customer names, phone numbers
 * and purchase histories in a directly readable document format. This writes them 0600 into
 * a 0700 directory, and `backups/` is in `.gitignore` so a dump cannot be committed by a
 * careless `git add -A`. Encryption at rest is the storage layer's job — FileVault here,
 * provider-side encryption for the off-box copy — and the off-box copy is still owed
 * (DEBT-049).
 */
import { createHash } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { chmodSync } from 'node:fs';
import { resolve } from 'node:path';

import { config } from 'dotenv';

config({ path: '.env', quiet: true });

const { pgRunner, describeRunner, parseUrl } = await import('./lib/pg.mts');
const { backupFileName, backupFiles } = await import('./lib/backup-files.mts');

/** Kept in step with §9.5's "30-day retention". */
const RETENTION_DAYS = 30;

const BACKUP_DIR = resolve(process.env.BACKUP_DIR ?? 'backups');

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Retention is by file mtime, not by the timestamp in the name.
 *
 * A name can be wrong — a file copied from another machine keeps its name and gets a new
 * mtime — and the consequence of getting this backwards is deleting a backup that is still
 * inside the window. mtime is what the filesystem knows.
 */
function prune(directory: string, keepDays: number): string[] {
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  const removed: string[] = [];

  for (const name of backupFiles(directory)) {
    const path = `${directory}/${name}`;
    if (statSync(path).mtimeMs < cutoff) {
      rmSync(path);
      rmSync(`${path}.sha256`, { force: true });
      removed.push(name);
    }
  }

  return removed;
}

function usage(): void {
  console.log(
    [
      'pnpm backup — Postgres dump with 30-day retention (specs/09-hardening.md §9.5)',
      '',
      '  BACKUP_DIR=<path>   where dumps are written (default: ./backups)',
      '',
      'To run it daily, this is the cron line:',
      '',
      `  15 2 * * *  cd ${process.cwd()} && /usr/bin/env pnpm backup >> backups/backup.log 2>&1`,
      '',
      '02:15 — an hour before the 03:15 IST share sweep in scripts/worker.mts, so a',
      'backup is never taken mid-delete. On Render the same command is a Cron Job',
      'service pointed at the managed database URL.',
      '',
      'Prove the output is restorable with:  pnpm verify:restore',
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  if (process.argv.includes('--help')) {
    usage();
    return;
  }

  /**
   * The OWNER url, not the runtime one.
   *
   * SEC-029 dropped the application role to SELECT/INSERT/UPDATE with no DELETE on the
   * invoice tables (DEBT-035). `pg_dump` as that role would succeed and produce a dump that
   * silently omits anything it cannot read, which is the worst possible failure for a
   * backup: a file of the right shape and the wrong contents.
   */
  const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('Neither MIGRATE_DATABASE_URL nor DATABASE_URL is set.');
    process.exitCode = 1;
    return;
  }

  // 0700: the dump holds customer invoices (DEBT-031). `recursive` so it is a no-op when
  // the directory already exists, and the mode is re-applied either way.
  mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  chmodSync(BACKUP_DIR, 0o700);

  const runner = await pgRunner();
  const connection = parseUrl(url);
  const path = `${BACKUP_DIR}/${backupFileName()}`;

  console.log(`Backing up ${connection.database} via ${describeRunner(runner)}`);

  const startedAt = Date.now();
  const fd = openSync(path, 'w', 0o600);
  let result;
  try {
    result = await runner.exec(
      'pg_dump',
      url,
      [
        // Custom format: compressed, and restorable selectively.
        '--format=custom',
        // The restore target is created by verify-restore.mts, and a dump that carries
        // ownership/ACL statements fails noisily against a role set that does not exist on
        // the restoring machine. The grants are reproducible from scripts/db-roles.sql,
        // which is the file that owns them.
        '--no-owner',
        '--no-acl',
      ],
      { stdoutTo: fd },
    );
  } finally {
    closeSync(fd);
  }

  if (result.code !== 0) {
    // A failed dump leaves a partial file, and a partial file in a backup directory is
    // worse than no file: it is a restore that starts and then stops halfway.
    rmSync(path, { force: true });
    console.error(`pg_dump failed (exit ${result.code}):\n${result.stderr}`);
    process.exitCode = 1;
    return;
  }

  const bytes = readFileSync(path);
  const digest = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(`${path}.sha256`, `${digest}  ${path.split('/').pop()}\n`, {
    mode: 0o600,
  });

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`  ✓ ${path} — ${humanBytes(bytes.length)} in ${elapsed}s`);
  console.log(`    sha256 ${digest.slice(0, 16)}…`);

  /**
   * A dump of an empty database is ~3 kB of header and succeeds with exit 0. That is the
   * failure mode a backup script must not have — a green cron job producing files nobody
   * looks at until the day they are needed.
   */
  if (bytes.length < 10_000) {
    console.error(
      `  ✗ ${humanBytes(bytes.length)} is implausibly small for this database. Refusing to ` +
        `call this a backup; check the connection URL and the role's read access.`,
    );
    process.exitCode = 1;
    return;
  }

  const removed = prune(BACKUP_DIR, RETENTION_DAYS);
  const kept = backupFiles(BACKUP_DIR);
  console.log(
    `  ✓ retention ${RETENTION_DAYS} days — ${kept.length} kept` +
      (removed.length
        ? `, ${removed.length} pruned (${removed.join(', ')})`
        : ', 0 pruned'),
  );
}

await main();
