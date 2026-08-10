/**
 * Restore a backup into a scratch database and prove it came back whole. Phase 9 §9.5.
 *
 *   pnpm verify:restore            take a fresh backup, restore it, compare
 *   pnpm verify:restore --latest   use the newest file already in backups/
 *
 * ── §9.5: "Restored tested. An untested backup is a hope, not a backup." ──
 * The failure this exists to catch is not "pg_dump crashed" — that is visible. It is a dump
 * that succeeds, restores without error, and is missing something. Three ways that happens
 * here, all specific to this schema:
 *
 *   1. `BillPdf.bytes` is `bytea` holding rendered invoices (D-026). Binary is where dump
 *      and restore pipelines corrupt silently — an encoding setting, a stray text filter, a
 *      transfer in text mode. So the bytes are compared by DIGEST, not by row count.
 *   2. Money is `bigint` paise (MASTER-SPEC §4). A restore that lands `numeric` or truncates
 *      would still count the right number of rows.
 *   3. Expression and GIN indexes are invisible to Prisma's schema diff, and DEBT-023 found
 *      one that had been silently DROPPED for two phases with nothing failing. A restore is
 *      the other way to lose them, and the symptom — search still works, just unindexed — is
 *      equally invisible at 25 products.
 *
 * So this compares the source and the restored copy on all three, plus every table's exact
 * row count, and fails loudly on any difference.
 *
 * ⚠ It CREATEs and DROPs a scratch database (`<db>_restore_check`). It never writes to the
 * source. Safe to run against production only if the role may create databases there;
 * ordinarily, run it against a copy.
 */
import { existsSync, openSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';

import { config } from 'dotenv';

config({ path: '.env', quiet: true });

const { pgRunner, describeRunner, parseUrl, withDatabase, run } =
  await import('./lib/pg.mts');
const { backupFiles } = await import('./lib/backup-files.mts');

type Runner = Awaited<ReturnType<typeof pgRunner>>;

const BACKUP_DIR = resolve(process.env.BACKUP_DIR ?? 'backups');

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** One-row, one-column query. `-At` gives unaligned tuples-only output. */
async function query(runner: Runner, url: string, sql: string): Promise<string> {
  const { code, stdout, stderr } = await runner.exec('psql', url, [
    '-At',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    sql,
  ]);
  if (code !== 0) throw new Error(`psql failed: ${stderr.trim()}`);
  return stdout.trim();
}

/**
 * Exact row counts for every table, in one round trip.
 *
 * `count(*)`, not `pg_stat_user_tables.n_live_tup`: the statistics view is an estimate
 * maintained by autovacuum and is stale on a freshly restored database by definition — it
 * would report 0 for everything and this check would pass by accident.
 */
const ROW_COUNTS = `
  select string_agg(table_name || '=' || row_count, ',' order by table_name)
  from (
    select table_name,
           (xpath('/row/c/text()', query_to_xml(
              format('select count(*) as c from %I.%I', table_schema, table_name),
              false, true, '')))[1]::text::bigint as row_count
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  ) counts`;

/**
 * The invoice bytes, digested.
 *
 * `md5(bytea)` is Postgres's own, computed server-side, so nothing large crosses the wire
 * and no client encoding can affect the answer. Ordered by `key` — BillPdf's primary key is
 * the bill key, not an `id` (§8.3) — so two databases holding the same rows in a different
 * physical order agree.
 */
const BILL_PDF_DIGEST = `
  select coalesce(count(*), 0) || ':' || coalesce(sum(length(bytes)), 0) || ':' ||
         coalesce(md5(string_agg(md5(bytes), ',' order by key)), 'empty')
  from "BillPdf"`;

/** Every index, so a lost GIN or expression index (DEBT-023) is a failure, not a mystery. */
const INDEXES = `
  select string_agg(indexname, ',' order by indexname)
  from pg_indexes where schemaname = 'public'`;

/** Money must come back as bigint, and with the same totals to the paise. */
const MONEY_SHAPE = `
  select (select data_type from information_schema.columns
          where table_name = 'Order' and column_name = 'grandTotal')
      || ':' || (select coalesce(sum("grandTotal"), 0)::text from "Order")
      || ':' || (select coalesce(sum("lineTotal"), 0)::text from "OrderItem")`;

/** The migration ledger — a restore that loses it makes the next deploy re-run everything. */
const MIGRATIONS = `
  select count(*) || ':' || coalesce(max(migration_name), 'none')
  from _prisma_migrations where finished_at is not null`;

async function main(): Promise<void> {
  const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('Neither MIGRATE_DATABASE_URL nor DATABASE_URL is set.');
    process.exitCode = 1;
    return;
  }

  const runner = await pgRunner();
  const source = parseUrl(url);
  const scratchName = `${source.database}_restore_check`;
  const scratchUrl = withDatabase(url, scratchName);
  // `CREATE DATABASE` cannot run inside the database being copied, so the admin connection
  // goes to `postgres` — the one database guaranteed to exist.
  const adminUrl = withDatabase(url, 'postgres');

  console.log(`Restore check — ${source.database} via ${describeRunner(runner)}\n`);

  // ── 1. The file ─────────────────────────────────────────────────────────────
  let dumpPath: string;
  if (process.argv.includes('--latest')) {
    const files = backupFiles(BACKUP_DIR);
    const newest = files.at(-1);
    if (!newest) {
      console.error(`No backups in ${BACKUP_DIR}. Run \`pnpm backup\` first.`);
      process.exitCode = 1;
      return;
    }
    dumpPath = `${BACKUP_DIR}/${newest}`;
    console.log(`Using the newest existing backup: ${newest}`);
  } else {
    console.log('Taking a fresh backup first…');
    const { code, stdout, stderr } = await run('pnpm', ['backup']);
    process.stdout.write(stdout.replace(/^/gm, '  │ '));
    if (code !== 0) {
      console.error(stderr);
      process.exitCode = 1;
      return;
    }
    const newest = backupFiles(BACKUP_DIR).at(-1);
    dumpPath = `${BACKUP_DIR}/${newest}`;
  }
  check('the backup file exists', existsSync(dumpPath), dumpPath.split('/').pop());
  if (failures) return;

  // ── 2. Fingerprint the source, BEFORE restoring ────────────────────────────
  const before = {
    rows: await query(runner, url, ROW_COUNTS),
    pdfs: await query(runner, url, BILL_PDF_DIGEST),
    indexes: await query(runner, url, INDEXES),
    money: await query(runner, url, MONEY_SHAPE),
    migrations: await query(runner, url, MIGRATIONS),
  };

  const tableCount = before.rows.split(',').length;
  const totalRows = before.rows
    .split(',')
    .reduce((sum, entry) => sum + Number(entry.split('=')[1] ?? 0), 0);
  console.log(
    `\nSource: ${tableCount} tables, ${totalRows} rows, ` +
      `${before.pdfs.split(':')[0]} invoice PDFs (${before.pdfs.split(':')[1]} bytes)\n`,
  );

  // ── 3. Restore into a scratch database ─────────────────────────────────────
  console.log(`Restoring into ${scratchName}…`);
  await query(runner, adminUrl, `drop database if exists "${scratchName}"`);
  await query(runner, adminUrl, `create database "${scratchName}"`);

  const startedAt = Date.now();
  const fd = openSync(dumpPath, 'r');
  let restore;
  try {
    restore = await runner.exec(
      'pg_restore',
      scratchUrl,
      ['--no-owner', '--no-acl', '--exit-on-error', '--single-transaction'],
      { stdinFrom: fd },
    );
  } finally {
    closeSync(fd);
  }
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  check(
    'pg_restore completed without error',
    restore.code === 0,
    restore.code === 0
      ? `${elapsed}s`
      : restore.stderr.trim().split('\n').slice(-3).join(' / '),
  );

  if (restore.code === 0) {
    // ── 4. Fingerprint the copy and compare ──────────────────────────────────
    const after = {
      rows: await query(runner, scratchUrl, ROW_COUNTS),
      pdfs: await query(runner, scratchUrl, BILL_PDF_DIGEST),
      indexes: await query(runner, scratchUrl, INDEXES),
      money: await query(runner, scratchUrl, MONEY_SHAPE),
      migrations: await query(runner, scratchUrl, MIGRATIONS),
    };

    check(
      'every table has the same exact row count',
      before.rows === after.rows,
      before.rows === after.rows
        ? `${tableCount} tables, ${totalRows} rows`
        : diff(before.rows, after.rows),
    );

    check(
      'invoice PDF bytes are byte-identical (bytea round trip)',
      before.pdfs === after.pdfs,
      before.pdfs === after.pdfs
        ? `${before.pdfs.split(':')[0]} PDFs, md5 ${before.pdfs.split(':')[2]?.slice(0, 12)}…`
        : `${before.pdfs} → ${after.pdfs}`,
    );

    check(
      'money is still bigint and the totals match to the paise',
      before.money === after.money,
      before.money === after.money ? before.money : `${before.money} → ${after.money}`,
    );

    check(
      'every index came back, including the GIN and trigram ones',
      before.indexes === after.indexes,
      before.indexes === after.indexes
        ? `${before.indexes.split(',').length} indexes`
        : diff(before.indexes, after.indexes),
    );

    check(
      'the Prisma migration ledger is intact',
      before.migrations === after.migrations,
      `${after.migrations.split(':')[0]} applied, latest ${after.migrations.split(':')[1]}`,
    );
  }

  // ── 5. Clean up ────────────────────────────────────────────────────────────
  await query(runner, adminUrl, `drop database if exists "${scratchName}"`);
  console.log(`\nScratch database dropped.`);

  if (failures) {
    console.error(`\n${failures} check(s) failed. This backup is NOT proven restorable.`);
    process.exitCode = 1;
  } else {
    console.log(
      `\nAll checks passed — ${dumpPath.split('/').pop()} restores to an identical database.`,
    );
  }
}

/** Report only what differs. Two 17-table strings side by side are unreadable. */
function diff(a: string, b: string): string {
  const left = new Set(a.split(','));
  const right = new Set(b.split(','));
  const missing = [...left].filter((entry) => !right.has(entry));
  const extra = [...right].filter((entry) => !left.has(entry));
  return [
    missing.length ? `missing after restore: ${missing.join(' ')}` : '',
    extra.length ? `unexpected after restore: ${extra.join(' ')}` : '',
  ]
    .filter(Boolean)
    .join('; ');
}

await main();
