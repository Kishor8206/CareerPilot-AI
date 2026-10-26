/**
 * Remove test residue from a real database.
 *
 * Why this exists: the end-to-end smoke scripts used to set `USE_MEMORY_DB=true`
 * in statements written above their imports. ESM evaluates imported modules
 * before the importing file's own statements, so `config/env.ts` had already
 * read the environment and the flag never applied — the runs connected to
 * whatever MongoDB was listening locally and wrote test users, sessions and
 * attempts into it. `tests/smokeEnv.ts` fixes the cause; this cleans up after it.
 *
 * Test accounts are identifiable by their email domain, which is reserved for
 * this purpose and can never belong to a real user:
 *
 *   *@test.careerpilot.local   (tests/helpers.ts uniqueEmail)
 *   *@test.local               (e2e.smoke.ts smoke admin)
 *
 * Everything owned by those users is removed with them. Seeded DEMO data and
 * the six `@careerpilot.demo` accounts are deliberately left alone — they are
 * intended content, not residue.
 *
 * Run:
 *   npx tsx src/scripts/purgeTestData.ts            # dry run, reports only
 *   npx tsx src/scripts/purgeTestData.ts --apply    # actually delete
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { logger } from '../config/logger';

/** Reserved test-only domains. Anchored, so `foo@nottest.local` cannot match. */
const TEST_EMAIL = /@test\.careerpilot\.local$|@test\.local$/i;

/** Collections holding per-user data, and the field naming the owning user. */
const OWNED_COLLECTIONS: Array<{ collection: string; field: string }> = [
  { collection: 'studentprofiles', field: 'userId' },
  { collection: 'alumniprofiles', field: 'userId' },
  { collection: 'resumes', field: 'userId' },
  { collection: 'interviewsessions', field: 'userId' },
  { collection: 'assessmentattempts', field: 'userId' },
  { collection: 'readinesssnapshots', field: 'userId' },
  { collection: 'mentorshipsessions', field: 'studentUserId' },
  { collection: 'refreshtokens', field: 'userId' },
  { collection: 'auditlogs', field: 'actorId' },
  { collection: 'notifications', field: 'userId' },
];

/** Children keyed by a parent session rather than directly by user. */
const SESSION_CHILDREN: Array<{ collection: string; field: string; parent: string }> = [
  { collection: 'interviewquestions', field: 'sessionId', parent: 'interviewsessions' },
  { collection: 'interviewresponses', field: 'sessionId', parent: 'interviewsessions' },
  { collection: 'integrityevents', field: 'attemptId', parent: 'assessmentattempts' },
];

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  await connectDatabase();
  const db = mongoose.connection.db;
  if (!db) throw new Error('No database handle after connect.');

  const target = `${mongoose.connection.host}/${mongoose.connection.name}`;
  /* eslint-disable no-console */
  console.log(`\n${apply ? 'PURGING' : 'DRY RUN against'} ${target}\n${'-'.repeat(60)}`);

  const testUsers = await db
    .collection('users')
    .find({ email: { $regex: TEST_EMAIL } }, { projection: { _id: 1, email: 1 } })
    .toArray();

  if (testUsers.length === 0) {
    console.log('No test accounts found. Nothing to do.');
    await disconnectDatabase();
    return;
  }

  const userIds = testUsers.map((u) => u._id);
  console.log(`users: ${testUsers.length}`);

  // Collect session ids before their parents are removed.
  const childFilters = new Map<string, unknown[]>();
  for (const { collection, field, parent } of SESSION_CHILDREN) {
    const parentIds = await db
      .collection(parent)
      .find({ userId: { $in: userIds } }, { projection: { _id: 1 } })
      .toArray();
    childFilters.set(collection, [field, parentIds.map((p) => p._id)]);
  }

  let removed = 0;

  for (const { collection, field } of OWNED_COLLECTIONS) {
    const filter = { [field]: { $in: userIds } };
    const count = await db.collection(collection).countDocuments(filter);
    if (count === 0) continue;
    console.log(`${collection}: ${count}`);
    if (apply) removed += (await db.collection(collection).deleteMany(filter)).deletedCount;
  }

  for (const { collection } of SESSION_CHILDREN) {
    const [field, ids] = childFilters.get(collection) as [string, unknown[]];
    if (ids.length === 0) continue;
    const filter = { [field]: { $in: ids } };
    const count = await db.collection(collection).countDocuments(filter);
    if (count === 0) continue;
    console.log(`${collection}: ${count}`);
    if (apply) removed += (await db.collection(collection).deleteMany(filter)).deletedCount;
  }

  if (apply) {
    removed += (await db.collection('users').deleteMany({ _id: { $in: userIds } })).deletedCount;
    console.log(`\nRemoved ${removed} documents.`);
    logger.info({ module: 'purgeTestData', removed, target }, 'test residue purged');
  } else {
    console.log('\nDry run — nothing was deleted. Re-run with --apply to remove the above.');
  }
  /* eslint-enable no-console */

  await disconnectDatabase();
}

main().catch((error) => {
  logger.error({ module: 'purgeTestData', err: error }, 'purge failed');
  process.exitCode = 1;
});
