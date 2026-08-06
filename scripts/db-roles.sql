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
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tirupati_app') THEN
    EXECUTE format('CREATE ROLE tirupati_app WITH LOGIN PASSWORD %L', :'app_password');
  ELSE
    EXECUTE format('ALTER ROLE tirupati_app WITH LOGIN PASSWORD %L', :'app_password');
  END IF;
END
$$;

-- Explicitly NOT a superuser, and cannot create roles or databases.
ALTER ROLE tirupati_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- ── Connect and see the schema, but not add to it ───────────────────────────
GRANT CONNECT ON DATABASE tirupati TO tirupati_app;
GRANT USAGE ON SCHEMA public TO tirupati_app;

REVOKE CREATE ON SCHEMA public FROM tirupati_app;
REVOKE CREATE ON DATABASE tirupati FROM tirupati_app;

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
