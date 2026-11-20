import { Global, Module } from '@nestjs/common';
import { z } from 'zod';

const secret = z.string().min(32, 'must be at least 32 characters (openssl rand -base64 32)');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),
  /** Signs access tokens. */
  JWT_SECRET: secret,
  /** Keys the hash of one-time codes, so a copy of the database cannot be used to guess them. */
  OTP_SECRET: secret,
  /** Encrypts exact addresses at rest: 32 random bytes in base64 (openssl rand -base64 32). */
  ADDRESS_KEY: z
    .string()
    .transform((value) => Buffer.from(value, 'base64'))
    .refine((key) => key.length === 32, 'must be 32 bytes in base64 (openssl rand -base64 32)'),
  /** Encrypts admins' authenticator secrets: 32 random bytes in base64. */
  TOTP_KEY: z
    .string()
    .transform((value) => Buffer.from(value, 'base64'))
    .refine((key) => key.length === 32, 'must be 32 bytes in base64 (openssl rand -base64 32)'),
  /**
   * Who writes the task details. `openai` uses a model and also transcribes voice;
   * `rules` is a keyword stand-in for development, with no voice; `none` sends
   * customers to the typed form.
   */
  TASK_INTERPRETER: z.enum(['openai', 'rules', 'none']).default('rules'),
  /** Needed when TASK_INTERPRETER is openai. */
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).default('gpt-6.2-sol'),
  OPENAI_TRANSCRIBE_MODEL: z.string().min(1).default('gpt-transcribe'),
  /** `local` keeps helpers' documents in STORAGE_ROOT, for development. `s3` keeps them in a private S3 bucket. */
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_ROOT: z.string().min(1).default('.data'),
  /** The private bucket for helpers' documents. AWS credentials come from the usual AWS_* variables or the host's role. */
  S3_DOCUMENTS_BUCKET: z.string().min(3).optional(),
  /** Mumbai, so documents stay in India. */
  S3_REGION: z.string().min(1).default('ap-south-1'),
  /** Holds the queue of matching jobs. */
  REDIS_URL: z.url().default('redis://localhost:6379'),
  /**
   * Where matching jobs run. `redis` queues them for the worker process, which
   * survives restarts. `inline` runs them on timers inside the API process, for
   * development without a worker; jobs are lost when it stops.
   */
  MATCHING_QUEUE: z.enum(['redis', 'inline']).default('redis'),
  /** `console` prints codes to the log, for development. `msg91` sends them through MSG91. */
  SMS_PROVIDER: z.enum(['console', 'msg91']).default('console'),
  /** From the MSG91 dashboard. Needed when SMS_PROVIDER is msg91. */
  MSG91_AUTH_KEY: z.string().min(1).optional(),
  /** The id of the DLT-approved OTP template in MSG91. */
  MSG91_OTP_TEMPLATE_ID: z.string().min(1).optional(),
  /** The template's variable that holds the code, as written in the template. */
  MSG91_OTP_VARIABLE: z.string().min(1).default('VAR1'),
  /** Browser origins allowed to call the API, comma separated: the admin dashboard, and the app's web build in development. */
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.SMS_PROVIDER === 'console') {
    throw new Error('Invalid environment:\n  SMS_PROVIDER: console must not be used in production');
  }
  if (parsed.data.SMS_PROVIDER === 'msg91' && (!parsed.data.MSG91_AUTH_KEY || !parsed.data.MSG91_OTP_TEMPLATE_ID)) {
    throw new Error(
      'Invalid environment:\n  MSG91_AUTH_KEY, MSG91_OTP_TEMPLATE_ID: required when SMS_PROVIDER is msg91',
    );
  }
  if (parsed.data.STORAGE_DRIVER === 's3' && !parsed.data.S3_DOCUMENTS_BUCKET) {
    throw new Error('Invalid environment:\n  S3_DOCUMENTS_BUCKET: required when STORAGE_DRIVER is s3');
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.STORAGE_DRIVER === 'local') {
    throw new Error('Invalid environment:\n  STORAGE_DRIVER: local must not be used in production');
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.TASK_INTERPRETER === 'rules') {
    throw new Error('Invalid environment:\n  TASK_INTERPRETER: rules must not be used in production');
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.MATCHING_QUEUE === 'inline') {
    throw new Error('Invalid environment:\n  MATCHING_QUEUE: inline must not be used in production');
  }
  if (parsed.data.TASK_INTERPRETER === 'openai' && !parsed.data.OPENAI_API_KEY) {
    throw new Error('Invalid environment:\n  OPENAI_API_KEY: required when TASK_INTERPRETER is openai');
  }
  return parsed.data;
}

export const ENV = Symbol('ENV');

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }],
  exports: [ENV],
})
export class EnvModule {}
