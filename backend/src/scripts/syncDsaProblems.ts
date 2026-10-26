/**
 * Loads the bundled DSA problem bank into the configured database.
 *
 *   npm run seed:dsa
 *
 * Idempotent: problems are matched by slug and updated in place. It touches
 * only the coding-problem collection; no users, submissions or other demo data.
 */
import { connectDatabase, disconnectDatabase } from '../config/database';
import { logger } from '../config/logger';
import { syncDsaProblems } from '../services/coding.service';

async function main(): Promise<void> {
  await connectDatabase();
  const result = await syncDsaProblems();
  logger.info(result, 'DSA problem bank loaded');
  console.log(`DSA problems loaded: ${result.upserted} upserted, ${result.retired} legacy problem(s) deactivated.`);
  await disconnectDatabase();
}

main().catch(async (error) => {
  console.error('Loading the DSA problem bank failed:', error);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
