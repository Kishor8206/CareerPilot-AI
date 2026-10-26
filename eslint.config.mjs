// @ts-check
/**
 * Flat ESLint config for the whole monorepo (ESLint 9+).
 *
 * One config at the root rather than one per workspace: the rules that matter
 * here are about correctness and about the project's stated guarantees, and
 * those should not differ between the Node service and the browser app.
 *
 * Type-aware linting is deliberately not enabled. `npm run typecheck` already
 * runs the compiler over both workspaces with `strict`, so turning on
 * `projectService` would re-do that work at several times the cost while
 * catching nothing extra.
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      'ai-service/**',
      '**/*.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // Unused code is usually a leftover from a refactor. The underscore
      // prefix is the escape hatch for deliberately-ignored bindings.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],

      // `any` erases the type safety the strict compiler settings buy us, but
      // it is occasionally the honest annotation at a library boundary — warn
      // so it stays visible rather than becoming invisible.
      '@typescript-eslint/no-explicit-any': 'warn',

      // A floating `==` against null is idiomatic and safe; everything else
      // should be explicit.
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      'no-console': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  /* ---- Backend: Node ---- */
  {
    files: ['backend/**/*.ts', 'shared/**/*.ts', 'database/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  /**
   * CLI scripts are the one place console output is the interface rather than a
   * stray debug statement: seeding, training and purging all report to a human
   * running them in a terminal.
   */
  {
    files: ['backend/src/scripts/**/*.ts', 'database/**/*.ts'],
    rules: { 'no-console': 'off' },
  },

  /* ---- Tests ---- */
  {
    files: ['**/tests/**/*.ts', '**/*.test.ts', '**/*.test.tsx'],
    languageOptions: {
      globals: { ...globals.node, ...globals.vitest },
    },
    rules: {
      'no-console': 'off',
      // Tests reach into internals and fixtures where precise typing costs more
      // than it protects.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  /* ---- Frontend: browser + React ---- */
  {
    files: ['frontend/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // A missing dependency is a stale-closure bug waiting to happen — and the
      // voice flows (timers, recognisers, audio contexts) are exactly where that
      // bites hardest.
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  /* ---- Config files run in Node ---- */
  {
    files: ['**/*.config.{js,mjs,cjs,ts}', '**/vite.config.ts', '**/vitest.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },

  /**
   * Plain-JS config files (tailwind.config.js) are loaded by tools that expect
   * CommonJS, so `require()` is correct there — the TypeScript-oriented rules
   * that forbid it do not apply.
   */
  {
    files: ['**/*.{js,cjs}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-var-requires': 'off',
    },
  },
);
