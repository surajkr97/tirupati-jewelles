/**
 * Vitest configuration.
 * Created by Phase 1 (specs/01-cleanup-scaffold.md §1.4).
 */
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) },
  },
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    /**
     * Run test FILES one at a time.
     *
     * The integration suites share one Postgres database and each truncates the tables it
     * touches, so running them concurrently makes one file's cleanup delete another's
     * fixtures mid-test. That surfaced as impossible-looking failures — "no record found
     * for update" on a row the test had just created — rather than as an obvious clash.
     *
     * Cheaper than giving every file its own schema, and the suite is small.
     */
    fileParallelism: false,
    // e2e/ is Playwright's; Vitest must not try to run those specs.
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules/**', '.next/**', 'e2e/**'],
  },
});
