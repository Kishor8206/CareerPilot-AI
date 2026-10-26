/**
 * Environment for the end-to-end smoke scripts.
 *
 * This exists as a separate module for one reason: ESM hoists imports. Writing
 * `process.env.X = …` at the top of a smoke script *looks* like it runs first,
 * but the engine evaluates every imported module before the first statement of
 * the importing file — so `config/env.ts` has already snapshotted `process.env`
 * by the time those assignments run, and they silently do nothing.
 *
 * Import declarations are evaluated in source order, so importing this module
 * *before* anything that reads configuration is what actually makes it take
 * effect:
 *
 *     import './smokeEnv';            // must be first
 *     import { createApp } from '../src/app';
 *
 * The failure this prevents is not cosmetic. With the assignments inline,
 * `USE_MEMORY_DB=true` never applied, and the smoke runs connected to whatever
 * MongoDB happened to be listening on the developer's machine — writing test
 * users and sessions into a real database, and failing the seed assertions
 * because demo data from an earlier run was already there.
 */
process.env.NODE_ENV = 'test';
process.env.USE_MEMORY_DB = 'true';
process.env.BCRYPT_ROUNDS = '4';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';
process.env.DEMO_MODE = 'false';

process.env.JWT_SECRET = 'smoke-access-secret-value-for-e2e-only';
process.env.JWT_REFRESH_SECRET = 'smoke-refresh-secret-value-for-e2e-only';
process.env.COOKIE_SECRET = 'smoke-cookie-secret-value-for-e2e-only';

// Unlike the automated suites — which point at a closed port to prove graceful
// degradation — the smoke scripts require the AI service to actually be up.
process.env.AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? 'http://127.0.0.1:8000';
process.env.AI_SERVICE_INTERNAL_KEY = process.env.AI_SERVICE_INTERNAL_KEY ?? 'smoke_test_key';
process.env.AI_SERVICE_TIMEOUT_MS = '120000';

/**
 * Fail loudly if the guard did not hold, rather than quietly writing to a real
 * database. Imported by both smoke scripts immediately after connecting.
 */
export async function assertUsingMemoryDatabase(): Promise<void> {
  const mongoose = (await import('mongoose')).default;
  const host = mongoose.connection.host ?? '';
  const { env } = await import('../src/config/env');

  if (!env.USE_MEMORY_DB) {
    throw new Error(
      'Smoke run refused: USE_MEMORY_DB did not take effect, so this would write to a real '
        + `database (${host}/${mongoose.connection.name}). Ensure './smokeEnv' is the first import.`,
    );
  }
}
