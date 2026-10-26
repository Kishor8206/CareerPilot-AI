import { afterAll, beforeAll } from 'vitest';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { configService } from '../src/services/config.service';

/**
 * Test lifecycle only.
 *
 * Environment variables are deliberately NOT set here — see the `env` block in
 * `vitest.config.ts`. ESM hoists the imports above, so any assignment written in
 * this file would run after `config/env.ts` had already snapshotted
 * `process.env`, and would silently have no effect.
 */

beforeAll(async () => {
  await connectDatabase();
  await configService.bootstrap();
}, 180_000);

afterAll(async () => {
  await disconnectDatabase();
});
