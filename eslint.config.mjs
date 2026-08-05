/**
 * ESLint flat config.
 * Created by Phase 1 (specs/01-cleanup-scaffold.md §1.4, §1.5).
 *
 * eslint-config-next 16 exports a native flat-config array, so there is no FlatCompat
 * shim here — passing it through FlatCompat crashes ESLint 10 with a circular-structure
 * error while serialising the react plugin.
 */
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';

const config = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'backend/**',
      'prisma/migrations/**',
      'next-env.d.ts',
    ],
  },

  ...nextCoreWebVitals,

  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      // Phase 1 §1.4 names this one explicitly. DEBUG is also forbidden from reaching
      // for `any` to silence a type error (AGENTS.md, anti-patterns).
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  /**
   * Phase 1 §1.5: "Add an ESLint rule banning process.env outside this file."
   *
   * lib/env.ts is the one place allowed to read process.env; everything else imports the
   * parsed, typed object. Without this rule the Zod schema silently stops being the source
   * of truth the first time someone reaches for process.env directly in a route handler.
   *
   * vitest.setup.ts is exempt because its whole job is populating process.env before
   * lib/env.ts parses it.
   */
  {
    files: ['**/*.ts', '**/*.tsx'],
    // proxy.ts is exempt for one variable only. It runs in the edge runtime, before any
    // route renders, and importing lib/env.ts there would drag the whole Zod-parsed server
    // config (DATABASE_URL, secrets) into the edge bundle. NODE_ENV is a build-time
    // constant Next inlines, not configuration.
    // Test files are exempt too: they read TEST_DATABASE_URL to decide whether a real
    // database is available and skip the integration suites otherwise. That is a harness
    // concern, not application configuration, and routing it through lib/env.ts would
    // make the Zod schema demand a test-only variable in production.
    ignores: [
      'lib/env.ts',
      'proxy.ts',
      'vitest.setup.ts',
      'playwright.config.ts',
      '**/*.test.ts',
      '**/*.test.tsx',
      'e2e/**',
      '*.config.ts',
      '*.config.mts',
    ],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message:
            'Read config from lib/env.ts, never process.env directly (specs/01-cleanup-scaffold.md §1.5).',
        },
      ],
    },
  },

  prettier,
];

export default config;
