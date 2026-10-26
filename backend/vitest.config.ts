import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],

    /**
     * Environment must be set HERE, not in `setup.ts`.
     *
     * ESM hoists imports, so any `process.env.X = …` written at the top of a
     * setup file runs *after* the modules that file imports have already been
     * evaluated — including `config/env.ts`, which snapshots `process.env` at
     * module load. Assignments there are silently too late.
     *
     * Getting this wrong is not cosmetic: `AI_SERVICE_URL` would fall back to
     * the real default, and the suite's isolation from the AI service would hold
     * only while nothing happened to be listening on that port.
     */
    env: {
      NODE_ENV: 'test',
      USE_MEMORY_DB: 'true',
      JWT_SECRET: 'test-access-secret-value-for-vitest-only',
      JWT_REFRESH_SECRET: 'test-refresh-secret-value-for-vitest-only',
      COOKIE_SECRET: 'test-cookie-secret-value-for-vitest-only',
      LOG_LEVEL: 'silent',
      DEMO_MODE: 'false',
      // Production uses 12 rounds. The cost factor is what we are NOT testing,
      // and dozens of hashes at 12 rounds would dominate the run time.
      BCRYPT_ROUNDS: '4',
      // A closed port: the tests must prove the platform degrades gracefully
      // when the AI service is unavailable, never depend on it being up.
      AI_SERVICE_URL: 'http://127.0.0.1:59999',
      AI_SERVICE_TIMEOUT_MS: '2000',
      AI_SERVICE_INTERNAL_KEY: 'test_internal_key',
      // The Docker judge is wired in, but pointed at a binary that does not
      // exist: the suite must never start real containers, and the
      // "sandbox unavailable" path is then deterministic on every machine.
      CODE_EXECUTION_PROVIDER: 'docker',
      DOCKER_BIN: 'cp-docker-not-installed-in-tests',
    },

    // The in-memory MongoDB download/boot plus PDF generation needs headroom.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // Mongoose models are module-level singletons; a shared process avoids
    // "Cannot overwrite model" errors across test files.
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
  },
});
