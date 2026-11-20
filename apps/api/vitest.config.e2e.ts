import { defineConfig } from 'vitest/config';

// Runs against a real PostgreSQL: `pnpm db:up` creates the sibimate_test database locally.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://sibimate:sibimate@localhost:5432/sibimate_test',
      JWT_SECRET: 'test-only-jwt-secret-of-at-least-32-chars',
      OTP_SECRET: 'test-only-otp-secret-of-at-least-32-chars',
      ADDRESS_KEY: Buffer.alloc(32, 1).toString('base64'),
      TOTP_KEY: Buffer.alloc(32, 2).toString('base64'),
      TASK_INTERPRETER: 'rules',
      MATCHING_QUEUE: 'inline',
      STORAGE_ROOT: '.data/test',
    },
  },
});
