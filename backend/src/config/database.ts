import mongoose from 'mongoose';
import { env } from './env';
import { moduleLogger } from './logger';

const log = moduleLogger('database');

let memoryServer: { getUri: () => string; stop: () => Promise<boolean> } | null = null;
let connectedUri = '';
let usingMemoryServer = false;

mongoose.set('strictQuery', true);

/**
 * NOTE on NoSQL-injection defence.
 *
 * `mongoose.set('sanitizeFilter', true)` is deliberately NOT used. It rewrites
 * every `$`-prefixed operator in a filter into `$eq`, which corrupts the
 * application's own legitimate queries (`{ createdAt: { $gte: date } }` becomes
 * `{ createdAt: { $eq: { $gte: date } } }` and throws a CastError).
 *
 * Injection is prevented at the boundary instead: `sanitizeInput` strips
 * `$`-prefixed and dotted keys from every request body, query and params object
 * before a handler sees them, and Zod validation coerces the survivors to
 * primitives. Filters are therefore built only from trusted, typed values.
 */

/**
 * Starts an ephemeral in-memory MongoDB.
 *
 * This keeps the project runnable on a machine without a MongoDB installation
 * (useful for project reviews and CI). Data is lost on restart, which is why it
 * is refused in production.
 */
async function startMemoryServer(): Promise<string> {
  if (env.isProd) {
    throw new Error('The in-memory database cannot be used in production. Set MONGODB_URI.');
  }
  // Imported lazily so the (large) dev dependency is never loaded in production.
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const server = await MongoMemoryServer.create({ instance: { dbName: 'careerpilot' } });
  memoryServer = server;
  usingMemoryServer = true;
  log.warn('Started an in-memory MongoDB instance - data will NOT persist across restarts.');
  return server.getUri();
}

export async function connectDatabase(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose;

  let uri = env.MONGODB_URI;

  if (env.USE_MEMORY_DB || !uri) {
    uri = await startMemoryServer();
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 20,
      minPoolSize: 2,
      autoIndex: !env.isProd, // build indexes automatically outside production
    });
  } catch (error) {
    if (env.isProd || env.USE_MEMORY_DB) throw error;
    // A configured-but-unreachable MongoDB should not block a demo/review run.
    log.warn(
      { err: (error as Error).message, uri: uri.replace(/\/\/.*@/, '//***@') },
      'Could not reach the configured MongoDB. Falling back to an in-memory instance.',
    );
    uri = await startMemoryServer();
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000, autoIndex: true });
  }

  connectedUri = uri;
  log.info({ database: mongoose.connection.name, memory: usingMemoryServer }, 'MongoDB connected');

  mongoose.connection.on('error', (err) => log.error({ err }, 'MongoDB connection error'));
  mongoose.connection.on('disconnected', () => log.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => log.info('MongoDB reconnected'));

  return mongoose;
}

export async function disconnectDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
    usingMemoryServer = false;
  }
}

export function databaseInfo() {
  return {
    connected: mongoose.connection.readyState === 1,
    readyState: mongoose.connection.readyState,
    name: mongoose.connection.name,
    inMemory: usingMemoryServer,
    host: usingMemoryServer ? 'in-memory' : connectedUri.replace(/\/\/.*@/, '//***@'),
  };
}

/** Round-trip ping used by `/health/db` (§38). */
export async function pingDatabase(): Promise<{ ok: boolean; latencyMs: number; detail?: string }> {
  const start = Date.now();
  try {
    if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
      return { ok: false, latencyMs: 0, detail: 'Not connected' };
    }
    await mongoose.connection.db.admin().command({ ping: 1 });
    return { ok: true, latencyMs: Date.now() - start };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - start, detail: (error as Error).message };
  }
}
