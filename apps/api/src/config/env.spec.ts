import { loadEnv } from './env.js';

const valid = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
  JWT_SECRET: 'a'.repeat(32),
  OTP_SECRET: 'b'.repeat(32),
  ADDRESS_KEY: Buffer.alloc(32, 7).toString('base64'),
  TOTP_KEY: Buffer.alloc(32, 9).toString('base64'),
};

describe('loadEnv', () => {
  it('fills in the defaults', () => {
    expect(loadEnv(valid)).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      SMS_PROVIDER: 'console',
    });
  });

  it('names every variable that is missing or too short', () => {
    expect(() => loadEnv({ JWT_SECRET: 'short' })).toThrow(/DATABASE_URL[\s\S]*JWT_SECRET[\s\S]*OTP_SECRET/);
  });

  it('refuses to print codes to the log in production', () => {
    expect(() => loadEnv({ ...valid, NODE_ENV: 'production' })).toThrow(/SMS_PROVIDER/);
  });

  it('refuses the keyword stand-in in production', () => {
    const production = { ...valid, NODE_ENV: 'production', SMS_PROVIDER: undefined };
    expect(() => loadEnv({ ...production, TASK_INTERPRETER: 'rules' })).toThrow(/SMS_PROVIDER|TASK_INTERPRETER/);
  });

  it('needs a key to use OpenAI', () => {
    expect(() => loadEnv({ ...valid, TASK_INTERPRETER: 'openai' })).toThrow(/OPENAI_API_KEY/);
    expect(loadEnv({ ...valid, TASK_INTERPRETER: 'openai', OPENAI_API_KEY: 'sk-test' })).toMatchObject({
      OPENAI_MODEL: 'gpt-6.2-sol',
      OPENAI_TRANSCRIBE_MODEL: 'gpt-transcribe',
    });
  });

  it('needs MSG91 details to send real codes, and a bucket for S3', () => {
    expect(() => loadEnv({ ...valid, SMS_PROVIDER: 'msg91' })).toThrow(/MSG91_AUTH_KEY/);
    expect(
      loadEnv({ ...valid, SMS_PROVIDER: 'msg91', MSG91_AUTH_KEY: 'k', MSG91_OTP_TEMPLATE_ID: 't' }).MSG91_OTP_VARIABLE,
    ).toBe('VAR1');
    expect(() => loadEnv({ ...valid, STORAGE_DRIVER: 's3' })).toThrow(/S3_DOCUMENTS_BUCKET/);
    expect(loadEnv({ ...valid, STORAGE_DRIVER: 's3', S3_DOCUMENTS_BUCKET: 'sibimate-documents' }).S3_REGION).toBe(
      'ap-south-1',
    );
  });
});
