-- Least-privilege database roles.
-- Phase 9 §9.1 (specs/09-hardening.md): "DB user has least privilege — no DDL rights at
-- runtime." Closes SEC-029; hardens DEBT-026.
--
-- ─────────────────────────────────────────────────────────────────────────────
--  WHY TWO ROLES
--
--  Changing the SHAPE of the database (creating tables — migrations) and READING AND
--  WRITING ROWS (serving requests) are different jobs with very different exposure. The
--  first is rare and deliberate; the second runs constantly and is reachable from the
--  internet. Before this, one Postgres superuser did both.
--
--  On a superuser connection, any SQL injection reaches `DROP TABLE`, `pg_authid`'s
--  password hashes, and `COPY … FROM PROGRAM` — command execution on the database host.
--  Least privilege does not stop the injection; it decides how bad it is.
--
--  Run as the OWNER role. Idempotent — safe to re-run.
--
--    docker exec -i tirupati-db psql -U tirupati -d tirupati \
--      -v app_password="'the-password'" -f - < scripts/db-roles.sql
--
--  Note the `-i`: without it `docker exec` does not attach stdin and psql silently
--  receives nothing. A REVOKE that never ran looks exactly like a REVOKE that did.
-- ─────────────────────────────────────────────────────────────────────────────

\set ON_ERROR_STOP on

-- ── The runtime role ────────────────────────────────────────────────────────
--
-- psql's `\if`, not a `DO $$ … $$` block, and the difference is not stylistic.
--
-- This was written as a DO block calling `format(…, :'app_password')`, and **psql does not
-- interpolate `:'var'` inside dollar-quoted text** — it is passed through literally, and the
-- server answers `syntax error at or near ":"`. So the documented invocation could never
-- have worked; the role on the development machine was created some other way, and the
-- procedure for the one place it matters most — production — was untested. Verified
-- empirically before rewriting: the same `:'probe'` interpolates fine outside a DO block and
-- errors inside one.
--
-- `\gset` puts the answer in a psql variable, and `\if` branches on it, so the password
-- interpolation happens in ordinary SQL where psql will substitute it. Still idempotent.
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tirupati_app') AS role_missing
\gset

\if :role_missing
CREATE ROLE tirupati_app WITH LOGIN PASSWORD :'app_password';
\else
ALTER ROLE tirupati_app WITH LOGIN PASSWORD :'app_password';
\endif

-- Explicitly NOT a superuser, and cannot create roles or databases.
ALTER ROLE tirupati_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- ── Connect and see the schema, but not add to it ───────────────────────────
-- `current_database()`, not a hardcoded name.
--
-- These two lines named `tirupati` literally, which is correct on the development machine
-- and wrong everywhere else: a managed Postgres (Render) generates its own database name,
-- so the statements failed with `database "tirupati" does not exist` and — with
-- ON_ERROR_STOP set — aborted the whole script. Least privilege would then simply not be
-- applied in production, which is the one place it matters most. Loud rather than silent,
-- but still a setup step that could not succeed where it was needed.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO tirupati_app', current_database());
  EXECUTE format('REVOKE CREATE ON DATABASE %I FROM tirupati_app', current_database());
END $$;

GRANT USAGE ON SCHEMA public TO tirupati_app;
REVOKE CREATE ON SCHEMA public FROM tirupati_app;

-- ── Row-level work on the tables that exist now ─────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tirupati_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tirupati_app;

-- ── …and on the tables the NEXT migration creates ───────────────────────────
--
-- The GRANTs above apply only to tables that exist at the moment they run. Without this
-- block, the next `prisma migrate` produces a table the application cannot touch, and the
-- first sign of it is a permission error in production rather than at migration time.
ALTER DEFAULT PRIVILEGES FOR ROLE tirupati IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tirupati_app;
ALTER DEFAULT PRIVILEGES FOR ROLE tirupati IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO tirupati_app;

-- ── Invoice retention, enforced by the database ─────────────────────────────
--
-- DEBT-026: Indian GST rules require invoice records to be kept for six years. Nothing in
-- the application hard-deletes an order today — `voidBill` only stamps `voidedAt` — but
-- that is a convention, and a `deleteMany` in a future cleanup sweep would breach it
-- silently. Removing the privilege makes it a guarantee instead of a promise.
--
-- If a legitimate purge is ever needed, it runs as the owner, deliberately, once.
REVOKE DELETE ON "Order", "OrderItem", "BillPdf" FROM tirupati_app;

-- ── Show the result rather than assume it ───────────────────────────────────
\echo ''
\echo 'Role flags (all should be f):'
SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
FROM pg_roles WHERE rolname = 'tirupati_app';

\echo 'Schema CREATE (should be f):'
SELECT has_schema_privilege('tirupati_app', 'public', 'CREATE');

\echo 'Invoice tables — expect INSERT, SELECT, UPDATE and no DELETE:'
SELECT table_name, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privs
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND grantee = 'tirupati_app'
  AND table_name IN ('Order', 'OrderItem', 'BillPdf')
GROUP BY table_name ORDER BY table_name;
