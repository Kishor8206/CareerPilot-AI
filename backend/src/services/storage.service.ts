import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env';
import { moduleLogger } from '../config/logger';
import { ApiError } from '../utils/ApiError';

const log = moduleLogger('storage');

export interface StoredObject {
  key: string;
  size: number;
  checksum: string;
  contentType: string;
}

/**
 * Object-storage abstraction (§3). The application only ever deals in opaque
 * keys, so swapping the local-disk driver for S3 in production requires no
 * changes outside this file.
 */
export interface StorageDriver {
  readonly name: string;
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** Time-limited URL where the driver supports it; null for local disk. */
  signedUrl(key: string, expiresInSeconds: number): Promise<string | null>;
}

/** Magic-byte signatures, checked so a renamed `.exe` cannot pose as a PDF. */
const MAGIC: Array<{ mime: string; test: (b: Buffer) => boolean }> = [
  { mime: 'application/pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  {
    // DOCX is a ZIP container.
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    test: (b) => b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07),
  },
  { mime: 'application/msword', test: (b) => b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) },
  { mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
];

/**
 * Confirms the buffer's real format matches the declared MIME type.
 * `text/plain` is accepted without a signature (it has none) but is rejected if
 * it contains NUL bytes, which would indicate a binary payload.
 */
export function verifyFileSignature(buffer: Buffer, declaredMime: string): boolean {
  if (buffer.length < 8) return false;
  if (declaredMime === 'text/plain') return !buffer.subarray(0, 1024).includes(0x00);
  const rule = MAGIC.find((m) => m.mime === declaredMime);
  if (!rule) return false;
  return rule.test(buffer);
}

/** Rejects traversal and absolute paths before a key ever touches the disk. */
function assertSafeKey(key: string): void {
  if (!key || key.includes('..') || path.isAbsolute(key) || /^[a-zA-Z]:/.test(key) || key.includes('\0')) {
    throw ApiError.badRequest('Invalid storage key.');
  }
}

class LocalStorageDriver implements StorageDriver {
  readonly name = 'local';
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    assertSafeKey(key);
    const full = path.resolve(this.root, key);
    // Defence in depth: the resolved path must stay inside the storage root.
    if (!full.startsWith(path.resolve(this.root) + path.sep)) {
      throw ApiError.badRequest('Invalid storage key.');
    }
    return full;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body, { mode: 0o600 });
    return {
      key,
      size: body.length,
      checksum: crypto.createHash('sha256').update(body).digest('hex'),
      contentType,
    };
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await fs.readFile(this.resolve(key));
    } catch {
      throw ApiError.notFound('Stored file');
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolve(key));
    } catch {
      // Deleting an already-absent object is not an error.
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async signedUrl(): Promise<string | null> {
    // Local files are streamed through an authenticated API route instead.
    return null;
  }
}

/**
 * S3-compatible driver. The AWS SDK is imported lazily so development installs
 * do not have to carry it; production deployments add `@aws-sdk/client-s3`.
 */
class S3StorageDriver implements StorageDriver {
  readonly name = 's3';
  private client: unknown = null;

  private async getClient() {
    if (this.client) return this.client;
    try {
      const mod = await import('@aws-sdk/client-s3' as string);
      const { S3Client } = mod as { S3Client: new (cfg: unknown) => unknown };
      this.client = new S3Client({
        region: env.S3_REGION,
        ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}),
        ...(env.S3_ACCESS_KEY_ID
          ? { credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY } }
          : {}),
      });
      return this.client;
    } catch (error) {
      throw ApiError.serviceUnavailable(
        'S3 storage is configured but the @aws-sdk/client-s3 package is not installed. Run: npm i @aws-sdk/client-s3',
        undefined,
        error,
      );
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    assertSafeKey(key);
    const client = (await this.getClient()) as { send: (cmd: unknown) => Promise<unknown> };
    const { PutObjectCommand } = (await import('@aws-sdk/client-s3' as string)) as {
      PutObjectCommand: new (i: unknown) => unknown;
    };
    await client.send(
      new PutObjectCommand({
        Bucket: env.STORAGE_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: 'AES256',
      }),
    );
    return { key, size: body.length, checksum: crypto.createHash('sha256').update(body).digest('hex'), contentType };
  }

  async get(key: string): Promise<Buffer> {
    assertSafeKey(key);
    const client = (await this.getClient()) as { send: (cmd: unknown) => Promise<{ Body: AsyncIterable<Uint8Array> }> };
    const { GetObjectCommand } = (await import('@aws-sdk/client-s3' as string)) as {
      GetObjectCommand: new (i: unknown) => unknown;
    };
    const result = await client.send(new GetObjectCommand({ Bucket: env.STORAGE_BUCKET, Key: key }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of result.Body) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    const client = (await this.getClient()) as { send: (cmd: unknown) => Promise<unknown> };
    const { DeleteObjectCommand } = (await import('@aws-sdk/client-s3' as string)) as {
      DeleteObjectCommand: new (i: unknown) => unknown;
    };
    await client.send(new DeleteObjectCommand({ Bucket: env.STORAGE_BUCKET, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.get(key);
      return true;
    } catch {
      return false;
    }
  }

  async signedUrl(key: string, expiresInSeconds: number): Promise<string | null> {
    try {
      const client = await this.getClient();
      const { GetObjectCommand } = (await import('@aws-sdk/client-s3' as string)) as {
        GetObjectCommand: new (i: unknown) => unknown;
      };
      const { getSignedUrl } = (await import('@aws-sdk/s3-request-presigner' as string)) as {
        getSignedUrl: (c: unknown, cmd: unknown, o: unknown) => Promise<string>;
      };
      return await getSignedUrl(client, new GetObjectCommand({ Bucket: env.STORAGE_BUCKET, Key: key }), {
        expiresIn: expiresInSeconds,
      });
    } catch {
      return null;
    }
  }
}

export const storage: StorageDriver =
  env.STORAGE_PROVIDER === 's3' ? new S3StorageDriver() : new LocalStorageDriver(env.STORAGE_LOCAL_PATH);

log.info({ provider: storage.name, root: env.STORAGE_PROVIDER === 'local' ? env.STORAGE_LOCAL_PATH : env.STORAGE_BUCKET }, 'Storage driver ready');

/** Builds a collision-proof, non-guessable object key. */
export function buildStorageKey(scope: string, ownerId: string, originalName: string): string {
  const ext = path.extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
  const stamp = new Date().toISOString().slice(0, 10);
  return `${scope}/${ownerId}/${stamp}-${crypto.randomBytes(12).toString('hex')}${ext}`;
}
