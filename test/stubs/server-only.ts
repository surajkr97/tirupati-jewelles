/**
 * Test stub for `server-only`.
 * Created by Phase 4.
 *
 * The real package throws on import outside a React Server Component. That guard is
 * working as intended — Vitest has no RSC graph, so it resolves the client build and the
 * module refuses to load, taking any suite that touches `lib/rates.ts` with it.
 *
 * `vitest.config.mts` aliases the package to this empty module, which is exactly what
 * Next.js swaps in for server bundles. The guard still protects application code at build
 * time; it is neutralised only for the test runner.
 *
 * The package's own `empty.js` cannot be used — its `exports` map does not expose it.
 */
export {};
