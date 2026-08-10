/**
 * Running the Postgres client tools, wherever they happen to live.
 * Created by Phase 9 (specs/09-hardening.md §9.5).
 *
 * Shared by `scripts/backup.mts` and `scripts/verify-restore.mts`, so a backup and the
 * restore that proves it cannot disagree about how they reach the database.
 *
 * ── Why this is not just `spawn('pg_dump', [url])` ──
 * There is no `pg_dump` on this machine's PATH, and there does not need to be: Postgres runs
 * in the `db` compose container and ships its own matching client tools. Matching is the
 * point — `pg_dump` refuses to dump a server NEWER than itself, so a host with Postgres 15
 * installed fails against this 16 server with a version message that reads like corruption.
 *
 * So: use the host binary when there is one, otherwise run inside the container, and SAY
 * which was used. The container path only reaches the compose-local database; a managed
 * Postgres (Render) needs the host binary, and `describeRunner()` prints what was found so a
 * backup taken the wrong way is visible rather than silent.
 *
 * ── The connection is passed as flags plus `PGPASSWORD`, never as a URL argument ──
 * `pg_dump "postgres://user:password@host/db"` puts the database password in argv, where any
 * `ps` on that machine reads it. libpq's own answer is `PGPASSWORD` in the environment with
 * `-h -p -U -d` for the rest, which is what this does. A URL in `PGDATABASE` does NOT work —
 * measured: libpq expands a URI only for the `dbname` conninfo parameter, and the env var
 * gets treated as a literal database name (`FATAL: role "root" does not exist`).
 */
import { spawn } from 'node:child_process';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  /** Send the child's stdout straight to this file descriptor instead of buffering it. */
  stdoutTo?: number;
  /** Feed this file descriptor to the child's stdin — a dump file, for `pg_restore`. */
  stdinFrom?: number;
}

/** The compose service that runs Postgres. */
const DB_SERVICE = 'db';

export type PgTool = 'pg_dump' | 'pg_restore' | 'psql';

export interface PgRunner {
  /** How the tools are being reached, for the run log. */
  readonly via: 'host' | 'compose';
  exec(
    tool: PgTool,
    url: string,
    args: string[],
    options?: ExecOptions,
  ): Promise<CommandResult>;
}

function spawnCapture(
  command: string,
  args: string[],
  options: ExecOptions & { env?: Record<string, string> } = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...options.env },
      stdio: [options.stdinFrom ?? 'ignore', options.stdoutTo ?? 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));

    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

export function run(
  command: string,
  args: string[],
  options: ExecOptions & { env?: Record<string, string> } = {},
): Promise<CommandResult> {
  return spawnCapture(command, args, options);
}

async function hostHas(tool: string): Promise<boolean> {
  const { code } = await spawnCapture('which', [tool]);
  return code === 0;
}

interface Connection {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

export function parseUrl(url: string): Connection {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port || '5432',
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    // Leading slash, and any `?schema=public` Prisma appends.
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
  };
}

/** Same URL with a different database name — for the scratch database a restore test needs. */
export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  parsed.search = '';
  return parsed.toString();
}

/** From the host, Postgres is `localhost:5432`. From inside the compose network it is `db`. */
function forCompose(connection: Connection): Connection {
  return ['localhost', '127.0.0.1', '::1'].includes(connection.host)
    ? { ...connection, host: DB_SERVICE, port: '5432' }
    : connection;
}

function connectionFlags(connection: Connection): string[] {
  return [
    '-h',
    connection.host,
    '-p',
    connection.port,
    '-U',
    connection.user,
    '-d',
    connection.database,
  ];
}

export async function pgRunner(): Promise<PgRunner> {
  if (await hostHas('pg_dump')) {
    return {
      via: 'host',
      exec: (tool, url, args, options) => {
        const connection = parseUrl(url);
        return spawnCapture(tool, [...connectionFlags(connection), ...args], {
          ...options,
          env: { PGPASSWORD: connection.password },
        });
      },
    };
  }

  return {
    via: 'compose',
    exec: (tool, url, args, options) => {
      const connection = forCompose(parseUrl(url));
      return spawnCapture(
        'docker',
        [
          'compose',
          'exec',
          // No TTY. Without this the captured stdout carries terminal control characters
          // and a `.dump` file is silently corrupt.
          '-T',
          '-e',
          `PGPASSWORD=${connection.password}`,
          DB_SERVICE,
          tool,
          ...connectionFlags(connection),
          ...args,
        ],
        options,
      );
    },
  };
}

export function describeRunner(runner: PgRunner): string {
  return runner.via === 'host'
    ? 'host pg_dump / pg_restore'
    : `pg_dump / pg_restore inside the \`${DB_SERVICE}\` container (no host binary found)`;
}
