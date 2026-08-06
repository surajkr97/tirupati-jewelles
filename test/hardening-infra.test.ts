/**
 * §9.1 items 4–7 and 10 — the checklist items that are facts about the deployment rather
 * than about a function.
 * Written by TEST for Phase 9 from `specs/09-hardening.md`.
 *
 *   4.  `pnpm audit` clean; enable Dependabot.
 *   5.  Secrets rotated before launch. No secret ever committed.
 *   6.  DB user has least privilege — no DDL rights at runtime.
 *   7.  Redis password-protected, not publicly bound.
 *   10. Full OWASP Top 10 review documented in `SECURITY-LOG.md`.
 *
 * ── Why these are tests and not a paragraph in SIGNOFF.md ──
 * The SECURITY pass verified all five by hand and its evidence is good. §9.1's own argument
 * for the enumeration test applies to every one of them: "a checklist item decays, a test
 * does not". A revoked grant can be re-granted by a migration run as the owner, a
 * `requirepass` can be dropped while debugging, and neither leaves a trace anywhere the
 * suite looks. Item 6 in particular closes DEBT-026 structurally — six-year invoice
 * retention is now a database grant, and nothing else notices if it comes back.
 *
 * Every destructive probe below runs inside a transaction that is rolled back, and the two
 * that are not (`DELETE`) carry `WHERE 1=0`. Postgres checks the privilege before it
 * matches rows, so a refusal is proven without a row being at risk.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * The application's own `DATABASE_URL`, read from `.env`.
 *
 * `vitest.setup.ts` deliberately overwrites `process.env.DATABASE_URL` with the throwaway
 * test database — which is the right default and is also why 919 unit tests say nothing
 * about the restricted role (the trap the SECURITY pass flagged). Item 6 is a claim about
 * the connection the running application uses, so it has to be read from source.
 */
function envFile(): Record<string, string> {
  try {
    const out: Record<string, string> = {};
    for (const line of readFileSync('.env', 'utf8').split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (match?.[1]) out[match[1]] = match[2]!.trim().replace(/^["']|["']$/g, '');
    }
    return out;
  } catch {
    return {};
  }
}

const ENV = envFile();
const APP_DATABASE_URL = ENV.DATABASE_URL;
const APP_REDIS_URL = ENV.REDIS_URL;

// ── Item 4: dependencies ───────────────────────────────────────────────────

describe('§9.1 item 4 — Dependabot is enabled', () => {
  const dependabot = (() => {
    try {
      return readFileSync('.github/dependabot.yml', 'utf8');
    } catch {
      return '';
    }
  })();

  it('has a config at the path GitHub actually reads', async () => {
    // `.github/dependabot.yml` or nothing — GitHub does not look anywhere else, and a
    // misplaced file is indistinguishable from no file until an advisory lands.
    expect(dependabot, '.github/dependabot.yml is missing').not.toBe('');
    expect(dependabot).toMatch(/version:\s*2/);
  });

  it.each([
    ['the Node dependencies the storefront ships', 'npm'],
    [
      'the dormant Celery worker (§1.3 keeps it, so it is still an attack surface)',
      'pip',
    ],
    ['the container images', 'docker'],
    ['the CI workflow’s own actions', 'github-actions'],
  ])('covers %s', (_name, ecosystem) => {
    expect(dependabot).toContain(`package-ecosystem: ${ecosystem}`);
  });
});

// ── Item 5: secrets ────────────────────────────────────────────────────────

describe('§9.1 item 5 — no secret is committed', () => {
  it('.env is not tracked by git', () => {
    // The single fact that matters. `.gitignore` is the mechanism; this is the outcome.
    const tracked = execFileSync('git', ['ls-files', '.env'], {
      encoding: 'utf8',
    }).trim();

    expect(tracked, '.env is tracked in git').toBe('');
  });

  it('.env is ignored, so it cannot be added by accident', () => {
    const ignored = execFileSync('git', ['check-ignore', '.env'], {
      encoding: 'utf8',
    }).trim();

    expect(ignored).toBe('.env');
  });

  it('.env.example holds placeholders, not working credentials', () => {
    /**
     * The example file IS committed, so anything real in it is a leak. `lib/env.ts` refuses
     * to boot in production on a `CHANGE_ME` value, which makes the placeholder safe; a
     * plausible-looking value would boot and be wrong.
     */
    const example = readFileSync('.env.example', 'utf8');

    const secretLines = example
      .split('\n')
      .filter((line) =>
        /^(SESSION_SECRET|OTP_PEPPER|.*_API_SECRET|.*PASSWORD)=/.test(line),
      )
      .filter((line) => !/=\s*$/.test(line));

    expect(
      secretLines.length,
      'no secret-shaped keys found — has the file changed?',
    ).toBeGreaterThan(0);

    for (const line of secretLines) {
      const key = line.split('=')[0];
      expect(line, `${key} in .env.example does not look like a placeholder`).toMatch(
        /CHANGE_ME/,
      );
    }
  });

  it('no .env file is committed anywhere in the tree', () => {
    const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
      .split('\n')
      .filter((path) => /(^|\/)\.env($|\.[^e])/.test(path));

    expect(tracked).toEqual([]);
  });
});

// ── Item 6: database privileges ────────────────────────────────────────────

const describeDb = APP_DATABASE_URL ? describe : describe.skip;

describeDb('§9.1 item 6 — the runtime DB user has no DDL rights', () => {
  /**
   * A client bound to the APPLICATION's URL, not the suite's. `vitest.setup.ts` points
   * `DATABASE_URL` at the throwaway test database on the owner role, so `lib/db.ts` is the
   * one connection that cannot answer this question.
   */
  const app = new PrismaClient({ datasourceUrl: APP_DATABASE_URL });

  afterAll(async () => {
    await app.$disconnect();
  });

  /** Run a statement, roll it back whatever happens, and return the error if it was refused. */
  async function refusal(sql: string): Promise<string | null> {
    const SENTINEL = '__tj_rollback__';

    try {
      await app.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(sql);
        // Never commit a privilege probe, even a successful one.
        throw new Error(SENTINEL);
      });
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return message.includes(SENTINEL) ? null : message;
    }
  }

  it('can still do its job', async () => {
    /**
     * The positive control, and it comes first deliberately: a connection that could do
     * nothing at all would pass every refusal below while the site was down.
     */
    const rows = await app.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`;

    expect(rows[0]?.ok).toBe(1);
    await expect(app.product.count()).resolves.toBeTypeOf('number');
  });

  it('is not a superuser', async () => {
    // The finding SEC-029 opened with. A superuser bypasses every grant asserted below, so
    // this is the assertion the others rest on.
    const rows = await app.$queryRaw<
      { rolsuper: boolean; rolcreaterole: boolean; rolcreatedb: boolean }[]
    >`SELECT rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = current_user`;

    expect(rows[0]?.rolsuper, 'the application connects to Postgres as a superuser').toBe(
      false,
    );
    expect(rows[0]?.rolcreaterole).toBe(false);
    expect(rows[0]?.rolcreatedb).toBe(false);
  });

  it.each([
    ['CREATE TABLE', 'CREATE TABLE "_tj_probe" (id integer)'],
    ['DROP TABLE', 'DROP TABLE IF EXISTS "Enquiry"'],
    ['ALTER TABLE', 'ALTER TABLE "Product" ADD COLUMN "_tj_probe" integer'],
    ['TRUNCATE', 'TRUNCATE "Enquiry"'],
    ['CREATE INDEX', 'CREATE INDEX "_tj_probe_idx" ON "Product" ("slug")'],
  ])('is refused %s at runtime', async (_name, sql) => {
    // "no DDL rights at runtime", quoted from §9.1. Migrations use the owner role through
    // the datasource's directUrl, which is a different connection entirely.
    const error = await refusal(sql);

    expect(error, `${sql} was NOT refused`).toBeTruthy();
    expect(error).toMatch(/permission denied|must be owner/i);
  });

  it.each([['Order'], ['OrderItem'], ['BillPdf']])(
    'cannot DELETE from %s — six-year invoice retention (DEBT-026)',
    async (table) => {
      /**
       * `WHERE 1=0` matches nothing. Postgres checks the DELETE privilege before it matches
       * rows, so the refusal is proven without an invoice ever being at risk.
       *
       * This is the assertion that turned DEBT-026 from a convention into a control: GST
       * rules require the invoice series be kept intact, and before SEC-029 the only thing
       * stopping a cleanup sweep from deleting one was that nobody had written it.
       */
      const error = await refusal(`DELETE FROM "${table}" WHERE 1=0`);

      expect(error, `DELETE on ${table} was NOT refused`).toBeTruthy();
      expect(error).toMatch(/permission denied/i);
    },
  );

  it('cannot read the password hashes of other database roles', async () => {
    // The other half of what a superuser connection would have reached.
    const error = await refusal('SELECT rolpassword FROM pg_authid');

    expect(error, 'pg_authid is readable').toBeTruthy();
  });
});

// ── Item 7: Redis ──────────────────────────────────────────────────────────

const describeRedis = APP_REDIS_URL ? describe : describe.skip;

describeRedis('§9.1 item 7 — Redis is password-protected and not publicly bound', () => {
  it('refuses a connection that presents no password', async () => {
    /**
     * The property, driven rather than read: strip the credentials out of the configured
     * URL and the server must refuse. Phase 1's SEC-001 set this up; nothing has asserted
     * it since, and `--requirepass` is exactly the kind of flag that gets dropped while
     * debugging and never put back.
     */
    const { default: Redis } = await import('ioredis');

    const anonymous = APP_REDIS_URL!.replace(/\/\/[^@]*@/, '//');
    expect(anonymous, 'the configured REDIS_URL carries no password').not.toBe(
      APP_REDIS_URL,
    );

    const client = new Redis(anonymous, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });

    /**
     * The refusal arrives on the `error` EVENT, not as a rejected promise — the server
     * answers `NOAUTH` and closes, so the command rejects with "Connection is closed" and
     * the reason is only on the emitter. Asserting on the rejection alone would pass just
     * as green against a Redis that was simply unreachable, which is not the same fact.
     */
    const failures: string[] = [];
    client.on('error', (err: Error) => void failures.push(String(err)));

    try {
      await client.connect().catch((err: unknown) => void failures.push(String(err)));
      await client.ping().catch((err: unknown) => void failures.push(String(err)));
    } finally {
      client.disconnect();
    }

    expect(failures.join(' | '), 'Redis accepted an unauthenticated connection').toMatch(
      /NOAUTH|WRONGPASS|auth/i,
    );
  });

  it('is published on loopback only', () => {
    /**
     * "not publicly bound". Asserted against `docker-compose.yml`, which is the
     * reproducible artifact — the running container is one `docker run` from disagreeing
     * with it, and the file is what a fresh machine gets.
     */
    const compose = readFileSync('docker-compose.yml', 'utf8');

    const published = [...compose.matchAll(/-\s*'([^']*:\d+->?[^']*)'/g)].map(
      (m) => m[1],
    );
    const bare = [...compose.matchAll(/-\s*'(\d+:\d+)'/g)].map((m) => m[1]);

    expect(bare, `these ports are bound to 0.0.0.0: ${bare.join(', ')}`).toEqual([]);
    for (const entry of published) {
      expect(entry, `${entry} is not loopback-bound`).toMatch(/^127\.0\.0\.1:/);
    }
  });

  it('requires a password in the compose definition', () => {
    const compose = readFileSync('docker-compose.yml', 'utf8');

    expect(compose).toContain('--requirepass');
  });

  it('does not share a database index with the development server (DEBT-030)', () => {
    /**
     * The obligation Phase 8 left for Phase 9 TEST, stated in DEBT-030.
     *
     * `vitest.setup.ts` forced `DATABASE_URL` to the test database and let `.env`'s
     * `REDIS_URL` stand, so integration tests wrote `rates:current` from test data and the
     * running dev app served it — `/api/rates` reporting gold 18K at ₹0 on a machine whose
     * Postgres was perfectly fine. It surfaced three layers away, as an E2E total
     * assertion, which is why it is worth a test rather than a comment: the setup file
     * fixes it today, and the next person to add a backing service will make the same
     * assumption.
     */
    const databaseIndex = (url: string) => /\/(\d+)$/.exec(url)?.[1] ?? '0';

    expect(process.env.REDIS_URL, 'the suite has no REDIS_URL').toBeTruthy();
    expect(
      databaseIndex(process.env.REDIS_URL!),
      'the test suite and the development server share one Redis database',
    ).not.toBe(databaseIndex(APP_REDIS_URL!));
  });
});

// ── Item 10: the OWASP review ──────────────────────────────────────────────

describe('§9.1 item 10 — the OWASP Top 10 review is documented', () => {
  const log = readFileSync('specs/SECURITY-LOG.md', 'utf8');

  it.each([
    ['A01', 'Broken Access Control'],
    ['A02', 'Cryptographic Failures'],
    ['A03', 'Injection'],
    ['A04', 'Insecure Design'],
    ['A05', 'Security Misconfiguration'],
    ['A06', 'Vulnerable'],
    ['A07', 'Identification and Authentication Failures'],
    ['A08', 'Software and Data Integrity Failures'],
    ['A09', 'Security Logging and Monitoring Failures'],
    ['A10', 'Server-Side Request Forgery'],
  ])('covers %s — %s', (code, title) => {
    // "Full OWASP Top 10 review documented in SECURITY-LOG.md" — all ten, each with a
    // verdict. A review missing a category is a review that has not been done.
    expect(log, `${code} is not documented`).toContain(code);
    expect(log).toContain(title);
  });

  it('records a verdict for each category, not just a heading', () => {
    const headings = [...log.matchAll(/^##\s+A(\d{2})\s+—\s+(.+)$/gm)];

    expect(headings).toHaveLength(10);
    for (const heading of headings) {
      expect(heading[0], `A${heading[1]} has no verdict`).toMatch(
        /PASS|FAIL|PARTIAL|N\/A/,
      );
    }
  });
});
