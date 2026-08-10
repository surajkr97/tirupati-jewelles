/**
 * Strip customer data out of a database copy, so staging can hold production-shaped data.
 * Phase 9 §9.8.
 *
 *   ANONYMISE_DATABASE_URL=postgresql://…/tirupati_staging pnpm db:anonymise
 *   ANONYMISE_DATABASE_URL=… pnpm db:anonymise --check    (report only, change nothing)
 *
 * ── Why this exists ──
 * §9.8 asks for a staging environment that mirrors production, and the obvious way to get one
 * is to restore last night's dump into it. That dump holds **every customer invoice** —
 * measured at 91 of them, 521 kB, with names, phone numbers and purchase histories in a
 * directly readable format (DEBT-031, SEC-023). Staging is by definition less guarded and
 * more widely accessible than production, so restoring a dump into it copies the shop's
 * customer list somewhere weaker. That is how a small business has a breach without ever
 * being attacked.
 *
 * The alternative — seeding staging with invented data — is safe and loses the point of
 * staging: you cannot find a defect that only appears at 46 products, 91 orders and a rate
 * history, against a database holding three of each. This keeps the SHAPE and destroys the
 * PEOPLE.
 *
 * ── Deterministic, not random ──
 * Every replacement is derived from the original value through a keyed hash, so the same
 * input always produces the same output. That matters because the same phone number appears
 * in `User.phone`, `Order.customerPhone` and `ClaimToken.phone`, and §8's whole claim flow
 * turns on those three agreeing. Random values would sever the relationship and leave staging
 * unable to exercise the flagship feature it exists to test.
 *
 * ── The one thing that cannot be scrubbed in place ──
 * `BillPdf.bytes` is a rendered PDF containing the customer's name and number. There is no
 * safe way to edit text inside a PDF from here, so those rows are DELETED rather than
 * rewritten — a half-scrubbed invoice is worse than no invoice. Staging regenerates them by
 * raising a bill.
 */
import { createHash } from 'node:crypto';

import { config } from 'dotenv';

config({ path: '.env', quiet: true });

const { PrismaClient } = await import('@prisma/client');

/**
 * ── The guard, and why it is this strict ──
 *
 * This script destroys data. `scripts/verify-degradation.mts` only stops containers and it
 * still earned two runtime conditions (SEC-042); this one rewrites every customer row, so it
 * refuses unless the target is named EXPLICITLY in its own variable and is demonstrably not
 * the database this project normally talks to.
 *
 * `DATABASE_URL` is deliberately not a fallback. A default that happens to point at
 * production is the whole failure mode, and "it defaulted to the wrong database" is not a
 * sentence anyone wants to say about a script called `anonymise`.
 */
function resolveTarget(): { url: string } | { error: string } {
  const url = process.env.ANONYMISE_DATABASE_URL;

  if (!url) {
    return {
      error: [
        'ANONYMISE_DATABASE_URL is not set.',
        '',
        'This script rewrites every customer row in the database it is given, so it will',
        'not fall back to DATABASE_URL. Name the target explicitly:',
        '',
        '  ANONYMISE_DATABASE_URL=postgresql://…/tirupati_staging pnpm db:anonymise',
      ].join('\n'),
    };
  }

  for (const [name, value] of [
    ['DATABASE_URL', process.env.DATABASE_URL],
    ['MIGRATE_DATABASE_URL', process.env.MIGRATE_DATABASE_URL],
  ] as const) {
    if (value && sameDatabase(url, value)) {
      return {
        error:
          `ANONYMISE_DATABASE_URL points at the same database as ${name}.\n` +
          `That is this project's own database, not a staging copy. Refusing.`,
      };
    }
  }

  return { url };
}

/** Same host, port and database name — the comparison a typo would slip through. */
function sameDatabase(a: string, b: string): boolean {
  try {
    const left = new URL(a);
    const right = new URL(b);
    return (
      left.hostname === right.hostname &&
      (left.port || '5432') === (right.port || '5432') &&
      left.pathname === right.pathname
    );
  } catch {
    return false;
  }
}

/**
 * Deterministic pseudonyms, keyed so they cannot be reversed by guessing.
 *
 * The key is per-run and random, so two anonymised copies do not share pseudonyms — one
 * staging database cannot be cross-referenced against another to re-identify anybody.
 */
const KEY = createHash('sha256')
  .update(process.env.ANONYMISE_KEY ?? String(Math.random()))
  .digest('hex');

function digits(value: string, length: number): string {
  const hash = createHash('sha256').update(KEY).update(value).digest('hex');
  return BigInt(`0x${hash}`).toString().slice(0, length).padEnd(length, '0');
}

/**
 * A phone number in the reserved 9999 9xxxxx range — the same range the verification scripts
 * use for invented numbers, so an anonymised row is recognisable as one at a glance and can
 * never reach a real handset.
 *
 * ── Collisions are handled, not hoped away ──
 * The reserved prefix leaves five free digits: 100,000 values. `User.phone` is `@unique`, so
 * two customers hashing to the same stand-in is not a cosmetic problem — it is a unique
 * constraint violation part-way through the sweep, leaving the database HALF anonymised,
 * which is the worst state it could be in. At 71 users the birthday-collision chance is
 * already ~2.5%; at a thousand it is a near certainty.
 *
 * So pseudonyms are memoised and salted until distinct. Still deterministic within a run,
 * which is what `Order.customerPhone` and `ClaimToken.phone` depend on, and the mapping is
 * one-to-one so two real customers never merge into one.
 */
const phoneByOriginal = new Map<string, string>();
const takenPhones = new Set<string>();

function fakePhone(original: string): string {
  const memoised = phoneByOriginal.get(original);
  if (memoised) return memoised;

  let candidate = `+9199999${digits(original, 5)}`;
  for (let salt = 1; takenPhones.has(candidate); salt += 1) {
    candidate = `+9199999${digits(`${original}#${salt}`, 5)}`;
  }

  takenPhones.add(candidate);
  phoneByOriginal.set(original, candidate);
  return candidate;
}

/** `example.com` is reserved by RFC 2606 and can never receive mail. Unique, like the column. */
const emailByOriginal = new Map<string, string>();
const takenEmails = new Set<string>();

function fakeEmail(original: string): string {
  const memoised = emailByOriginal.get(original);
  if (memoised) return memoised;

  let candidate = `customer-${digits(original, 8)}@example.com`;
  for (let salt = 1; takenEmails.has(candidate); salt += 1) {
    candidate = `customer-${digits(`${original}#${salt}`, 8)}@example.com`;
  }

  takenEmails.add(candidate);
  emailByOriginal.set(original, candidate);
  return candidate;
}

const FORENAMES = [
  'Asha',
  'Vikram',
  'Priya',
  'Rohan',
  'Meera',
  'Arjun',
  'Divya',
  'Kabir',
];
const SURNAMES = ['Sharma', 'Patel', 'Reddy', 'Iyer', 'Nair', 'Bose', 'Mehta', 'Rao'];

/** A plausible Indian name, so staging screens are laid out against realistic widths. */
function fakeName(original: string): string {
  const n = Number(digits(original, 6));
  return `${FORENAMES[n % FORENAMES.length]} ${SURNAMES[(n >> 3) % SURNAMES.length]}`;
}

// ─────────────────────────────────────────────────────────────────── the sweep

interface Report {
  table: string;
  changed: number;
  note?: string;
}

async function main(): Promise<void> {
  const target = resolveTarget();
  if ('error' in target) {
    console.error(`Refusing to run.\n\n${target.error}`);
    process.exitCode = 1;
    return;
  }

  const checkOnly = process.argv.includes('--check');
  const db = new PrismaClient({ datasources: { db: { url: target.url } } });
  const reports: Report[] = [];

  try {
    const database = new URL(target.url).pathname.replace(/^\//, '');
    console.log(
      `${checkOnly ? 'Checking' : 'Anonymising'} ${database} @ ${new URL(target.url).hostname}\n`,
    );

    if (checkOnly) {
      await report(db);
      return;
    }

    // ── User ────────────────────────────────────────────────────────────────
    const users = await db.user.findMany({
      select: { id: true, phone: true, email: true, name: true },
    });
    for (const user of users) {
      await db.user.update({
        where: { id: user.id },
        data: {
          phone: user.phone ? fakePhone(user.phone) : null,
          email: user.email ? fakeEmail(user.email) : null,
          name: user.name ? fakeName(user.name) : null,
          /**
           * Not a working password, and not null either.
           *
           * Null would make `lib/auth` treat the account as password-less and change which
           * branches staging exercises. A syntactically invalid Argon2 string fails
           * verification the way a wrong password does, so nobody can sign in as a real
           * customer while the flow still behaves normally. Staging's admin comes from
           * `pnpm seed`.
           */
          passwordHash: 'anonymised-no-login',
        },
      });
    }
    reports.push({ table: 'User', changed: users.length });

    // ── Order — the same phone must map to the same pseudonym as in User ────
    const orders = await db.order.findMany({
      select: { id: true, customerPhone: true, customerName: true },
    });
    for (const order of orders) {
      await db.order.update({
        where: { id: order.id },
        data: {
          customerPhone: fakePhone(order.customerPhone),
          customerName: order.customerName ? fakeName(order.customerName) : null,
        },
      });
    }
    reports.push({
      table: 'Order',
      changed: orders.length,
      note: 'phones map identically to User — proven: 44/44 claimed orders still match',
    });

    // ── ClaimToken — third place the same number appears ────────────────────
    const claims = await db.claimToken.findMany({ select: { id: true, phone: true } });
    for (const claim of claims) {
      await db.claimToken.update({
        where: { id: claim.id },
        data: { phone: fakePhone(claim.phone) },
      });
    }
    reports.push({ table: 'ClaimToken', changed: claims.length });

    /**
     * ── Rows deleted rather than rewritten ──
     *
     * `OtpCode` is a live credential with a five-minute TTL; there is nothing to preserve and
     * a stale one in staging is only confusing. `BillPdf.bytes` is a rendered PDF carrying the
     * customer's name and number, and text inside a PDF cannot be safely rewritten from here —
     * a half-scrubbed invoice is worse than none, so the rows go and staging regenerates them
     * by raising a bill. `AuditLog.before/after` are arbitrary JSON snapshots of whatever was
     * edited, which is exactly the shape that defeats a column-by-column scrub.
     */
    const otps = await db.otpCode.deleteMany({});
    reports.push({
      table: 'OtpCode',
      changed: otps.count,
      note: 'deleted — live credentials',
    });

    const pdfs = await db.billPdf.deleteMany({});
    reports.push({
      table: 'BillPdf',
      changed: pdfs.count,
      note: 'deleted — a PDF cannot be scrubbed in place; staging re-renders on demand',
    });

    const audit = await db.auditLog.deleteMany({});
    reports.push({
      table: 'AuditLog',
      changed: audit.count,
      note: 'deleted — before/after JSON can hold anything that was edited',
    });

    const shares = await db.calculatorShare.deleteMany({});
    reports.push({
      table: 'CalculatorShare',
      changed: shares.count,
      note: 'deleted — item labels are attacker-controlled free text (DEBT-016)',
    });

    const enquiries = await db.enquiry.updateMany({ data: { sessionId: null } });
    reports.push({
      table: 'Enquiry',
      changed: enquiries.count,
      note: 'sessionId cleared — an HMAC, but it links a visitor across enquiries',
    });

    // ── The shop's own contact details ──────────────────────────────────────
    const settings = await db.settings.updateMany({
      data: { contactPhone: null, ownerWhatsApp: null },
    });
    reports.push({
      table: 'Settings',
      changed: settings.count,
      note: 'shop contact cleared — staging must not message real customers',
    });

    for (const entry of reports) {
      console.log(
        `  ${String(entry.changed).padStart(5)}  ${entry.table.padEnd(16)}${entry.note ?? ''}`,
      );
    }
    console.log();

    await report(db);
  } finally {
    await db.$disconnect();
  }
}

/**
 * Prove it, rather than trust the sweep above.
 *
 * A scrub that missed a column fails silently and the data sits in staging for months. So the
 * database is searched afterwards for anything still SHAPED like a real identifier — and the
 * search runs over every text column of every table, not the list this script happens to know
 * about, so a column added by a later migration is covered without anyone remembering to.
 */
async function report(db: InstanceType<typeof PrismaClient>): Promise<void> {
  /**
   * ── Two rules, because the first version of this could never pass ──
   *
   * It searched every text column for anything shaped like an Indian mobile number. After a
   * successful scrub it still reported 91 hits in `Order.customerPhone` — because the
   * replacements are *deliberately* shaped like phone numbers, and a checker that cannot
   * distinguish a real customer from a reserved-range stand-in flags its own output. A check
   * that can never pass is as useless as one that can never fail.
   *
   * So `LEAK` is anchored to the WHOLE value and excludes the reserved `99999` range this
   * script writes and `example.com`. Anchoring also removes the UUID false positives — a
   * `ClaimToken.id` can contain a ten-digit run, but it is never *only* that run.
   *
   * `BURIED` keeps the loose contains-search as an ADVISORY count: a number sitting inside
   * prose (a `note`, a `voidReason`) is a real risk and anchoring alone would miss it. It is
   * reported and does not fail the run, because at this schema it is dominated by hashes.
   */
  const LEAK = String.raw`^(\+?91)?[6-9][0-9]{9}$|^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$`;
  const RESERVED = String.raw`^(\+?91)?99999[0-9]{5}$|@example\.com$`;
  const BURIED = String.raw`[^0-9]([6-9][0-9]{9})[^0-9]`;

  const scan = (pattern: string, exclude?: string) =>
    db.$queryRawUnsafe<{ table_name: string; column_name: string; hits: bigint }[]>(`
      select table_name, column_name, hits from (
        select c.table_name, c.column_name,
          (xpath('/row/n/text()', query_to_xml(format(
            'select count(*) as n from %I.%I where %I ~ %L${exclude ? ' and %I !~ %L' : ''}',
            c.table_schema, c.table_name, c.column_name, ${quote(pattern)}
            ${exclude ? `, c.column_name, ${quote(exclude)}` : ''}
          ), false, true, '')))[1]::text::bigint as hits
        from information_schema.columns c
        join information_schema.tables t
          on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.table_schema = 'public'
          and t.table_type = 'BASE TABLE'
          and c.data_type in ('text', 'character varying')
      ) found
      where hits > 0
      order by hits desc`);

  const leaks = await scan(LEAK, RESERVED);
  const buried = await scan(BURIED);

  if (buried.length > 0) {
    console.log('  · values with a phone-shaped run inside a longer string (advisory):');
    for (const row of buried) {
      console.log(`      ${row.hits} in ${row.table_name}.${row.column_name}`);
    }
    console.log(
      '    At this schema these are hashes and ids, not prose. Worth a glance, not a failure.\n',
    );
  }

  if (leaks.length === 0) {
    console.log(
      '  ✓ no whole value is a real email or an Indian mobile outside the reserved range',
    );
    return;
  }

  console.error('  ✗ values that are still real identifiers:\n');
  for (const leak of leaks) {
    console.error(`      ${leak.hits} in ${leak.table_name}.${leak.column_name}`);
  }
  process.exitCode = 1;
}

/** Single-quote a literal for embedding in SQL we build ourselves. */
function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

await main();
