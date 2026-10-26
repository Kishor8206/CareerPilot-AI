import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Environment loading & validation.
 *
 * The monorepo keeps a single `.env` at the repository root so the Node backend
 * and the Python AI service read the same values. We fall back to `backend/.env`
 * for deployments that ship the backend alone.
 */
const ROOT = path.resolve(__dirname, '..', '..', '..');
const candidates = [
  path.join(ROOT, '.env'),
  path.resolve(__dirname, '..', '..', '.env'),
];
for (const file of candidates) {
  if (fs.existsSync(file)) dotenv.config({ path: file });
}

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const int = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().int());

const num = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number());

const str = (def: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_NAME: str('CareerPilot AI'),
  PORT: int(5000),
  API_PREFIX: str('/api/v1'),
  CORS_ORIGIN: str('http://localhost:5173'),

  MONGODB_URI: str(''),
  USE_MEMORY_DB: bool(false),

  JWT_SECRET: str(''),
  JWT_REFRESH_SECRET: str(''),
  JWT_ACCESS_EXPIRES_IN: str('15m'),
  JWT_REFRESH_EXPIRES_IN: str('7d'),
  COOKIE_SECRET: str(''),
  BCRYPT_ROUNDS: int(12),

  RATE_LIMIT_WINDOW_MS: int(15 * 60 * 1000),
  RATE_LIMIT_MAX: int(300),
  AUTH_RATE_LIMIT_MAX: int(20),

  AI_SERVICE_URL: str('http://127.0.0.1:8000'),
  AI_SERVICE_INTERNAL_KEY: str('dev_internal_key'),
  AI_SERVICE_TIMEOUT_MS: int(120_000),
  AI_PROVIDER: str('mock'),

  STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_PATH: str(''),
  STORAGE_BUCKET: str('careerpilot-uploads'),
  S3_REGION: str('ap-south-1'),
  S3_ENDPOINT: str(''),
  S3_ACCESS_KEY_ID: str(''),
  S3_SECRET_ACCESS_KEY: str(''),
  MAX_UPLOAD_SIZE_MB: num(5),

  SOCKET_PATH: str('/socket.io'),
  WEBRTC_STUN_URLS: str('stun:stun.l.google.com:19302'),
  WEBRTC_TURN_URL: str(''),
  WEBRTC_TURN_USERNAME: str(''),
  WEBRTC_TURN_CREDENTIAL: str(''),

  // docker = isolated container per submission; disabled = never run code.
  // `stub` is accepted as an alias of `disabled` so older .env files keep working.
  CODE_EXECUTION_PROVIDER: z
    .enum(['docker', 'disabled', 'stub'])
    .default('docker')
    .transform((value) => (value === 'stub' ? 'disabled' : value)),
  CODE_RUNNER_IMAGE: str('careerpilot-judge:1'),
  DOCKER_BIN: str('docker'),
  CODE_RUNNER_CPUS: num(1),
  CODE_RUNNER_PIDS_LIMIT: int(128),
  CODE_RUNNER_MAX_CONCURRENT: int(2),

  MAIL_PROVIDER: z.enum(['console', 'smtp']).default('console'),
  MAIL_FROM: str('no-reply@careerpilot.ai'),
  SMTP_HOST: str(''),
  SMTP_PORT: int(587),
  SMTP_USER: str(''),
  SMTP_PASS: str(''),

  LOG_LEVEL: str('info'),
  LOG_PRETTY: bool(true),

  DEMO_MODE: bool(true),
  DATA_RETENTION_DAYS: int(365),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const raw = parsed.data;

const isProd = raw.NODE_ENV === 'production';
const isTest = raw.NODE_ENV === 'test';

/**
 * Secrets are mandatory in production. In development/test we derive stable
 * throwaway secrets so a fresh clone runs without any setup - never in prod.
 */
function requireSecret(name: string, value: string, devFallback: string): string {
  if (value && value !== `change_me_${devFallback}`) return value;
  if (isProd) {
    // eslint-disable-next-line no-console
    console.error(`FATAL: ${name} must be set to a strong unique value in production.`);
    process.exit(1);
  }
  return `dev-only-${devFallback}-do-not-use-in-production`;
}

export const env = {
  ...raw,
  isProd,
  isTest,
  isDev: raw.NODE_ENV === 'development',
  JWT_SECRET: requireSecret('JWT_SECRET', raw.JWT_SECRET, 'access_token_secret'),
  JWT_REFRESH_SECRET: requireSecret('JWT_REFRESH_SECRET', raw.JWT_REFRESH_SECRET, 'refresh_token_secret'),
  COOKIE_SECRET: requireSecret('COOKIE_SECRET', raw.COOKIE_SECRET, 'cookie_secret'),
  MAX_UPLOAD_BYTES: Math.round(raw.MAX_UPLOAD_SIZE_MB * 1024 * 1024),
  STORAGE_LOCAL_PATH: raw.STORAGE_LOCAL_PATH
    ? path.resolve(ROOT, raw.STORAGE_LOCAL_PATH)
    : path.resolve(__dirname, '..', '..', 'storage'),
  CORS_ORIGINS: raw.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean),
  ROOT_DIR: ROOT,
  VERSION: '1.0.0',
};

export type Env = typeof env;
