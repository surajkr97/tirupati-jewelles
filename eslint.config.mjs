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
    ignores: ['lib/env.ts', 'vitest.setup.ts', '*.config.ts', '*.config.mts'],
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
