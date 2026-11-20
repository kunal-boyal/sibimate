import type { INestApplication } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { setupApp } from '../src/app.setup.js';
import { OTP_RULES } from '../src/auth/otp.service.js';
import { SmsSender } from '../src/auth/sms-sender.js';
import type { Database } from '../src/db/db.js';

class FakeSmsSender extends SmsSender {
  readonly sent: { phone: string; code: string }[] = [];

  async sendOtp(phone: string, code: string) {
    this.sent.push({ phone, code });
  }

  get lastCode() {
    return this.sent.at(-1)!.code;
  }
}

const PHONE = '+919876543210';
const DEVICE = 'device-aaaa-1111';

describe('OTP sign-in (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let sms: FakeSmsSender;

  const post = (path: string, body: object) => request(app.getHttpServer()).post(`/v1${path}`).send(body);
  const wrongCode = () => (sms.lastCode === '000000' ? '111111' : '000000');

  async function signIn(phone = PHONE, deviceId = DEVICE) {
    await post('/auth/otp/request', { phone, deviceId }).expect(200);
    const response = await post('/auth/otp/verify', {
      phone,
      code: sms.lastCode,
      deviceId,
    }).expect(200);
    return response.body as {
      accessToken: string;
      refreshToken: string;
      isNewUser: boolean;
      user: { id: string };
    };
  }

  beforeAll(async () => {
    sms = new FakeSmsSender();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SmsSender)
      .useValue(sms)
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    db = app.get<Database>(getDrizzleToken());
    await migrate(db, { migrationsFolder: './drizzle' });
  });

  beforeEach(async () => {
    await db.execute(sql`truncate table users, otp_challenges, refresh_tokens cascade`);
    sms.sent.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers the health check without a token', async () => {
    await request(app.getHttpServer()).get('/v1/health').expect(200, { status: 'ok' });
  });

  it('signs a new number in and reads the profile', async () => {
    const requested = await post('/auth/otp/request', {
      phone: '98765 43210',
      deviceId: DEVICE,
    }).expect(200);
    expect(requested.body).toEqual({
      expiresIn: OTP_RULES.ttlSeconds,
      resendIn: OTP_RULES.resendSeconds,
    });
    expect(sms.sent).toEqual([{ phone: PHONE, code: expect.stringMatching(/^\d{6}$/) }]);

    const verified = await post('/auth/otp/verify', {
      phone: PHONE,
      code: sms.lastCode,
      deviceId: DEVICE,
    }).expect(200);
    expect(verified.body).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      expiresIn: 900,
      isNewUser: true,
      user: {
        phone: PHONE,
        name: null,
        language: 'en',
        roles: ['customer'],
        status: 'active',
      },
    });

    const me = await request(app.getHttpServer())
      .get('/v1/me')
      .set('Authorization', `Bearer ${verified.body.accessToken}`)
      .expect(200);
    expect(me.body).toEqual(verified.body.user);
  });

  it('never stores the code itself', async () => {
    await post('/auth/otp/request', { phone: PHONE, deviceId: DEVICE }).expect(200);
    const { rows } = await db.execute(sql`select * from otp_challenges`);
    expect(JSON.stringify(rows)).not.toContain(sms.lastCode);
  });

  it('signs the same number in again without a second account', async () => {
    const first = await signIn();
    await db.execute(sql`update otp_challenges set created_at = created_at - interval '1 minute'`);
    const second = await signIn();
    expect(first.isNewUser).toBe(true);
    expect(second.isNewUser).toBe(false);
    expect(second.user.id).toBe(first.user.id);
  });

  it('updates name and language', async () => {
    const { accessToken } = await signIn();
    const updated = await request(app.getHttpServer())
      .patch('/v1/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: '  Asha  ', language: 'hi' })
      .expect(200);
    expect(updated.body).toMatchObject({ name: 'Asha', language: 'hi' });

    await request(app.getHttpServer())
      .patch('/v1/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ language: 'fr' })
      .expect(400);
  });

  it('refuses requests without a valid token, in the standard error shape', async () => {
    const missing = await request(app.getHttpServer()).get('/v1/me').expect(401);
    expect(missing.body).toMatchObject({
      code: 'unauthorized',
      message: expect.any(String),
    });
    await request(app.getHttpServer()).get('/v1/me').set('Authorization', 'Bearer nonsense').expect(401);
  });

  it('refuses a blocked account at once', async () => {
    const { accessToken } = await signIn();
    await db.execute(sql`update users set status = 'blocked'`);
    await request(app.getHttpServer()).get('/v1/me').set('Authorization', `Bearer ${accessToken}`).expect(401);
  });

  it('reports invalid input with the fields that failed', async () => {
    const response = await post('/auth/otp/request', {
      phone: '12345',
      deviceId: DEVICE,
    }).expect(400);
    expect(response.body).toMatchObject({
      code: 'validation_failed',
      details: [{ path: 'phone' }],
    });
    expect(sms.sent).toHaveLength(0);
  });

  it('rejects a wrong code and then accepts the right one', async () => {
    await post('/auth/otp/request', { phone: PHONE, deviceId: DEVICE }).expect(200);
    const wrong = await post('/auth/otp/verify', {
      phone: PHONE,
      code: wrongCode(),
      deviceId: DEVICE,
    }).expect(400);
    expect(wrong.body.code).toBe('otp_invalid');
    await post('/auth/otp/verify', {
      phone: PHONE,
      code: sms.lastCode,
      deviceId: DEVICE,
    }).expect(200);
  });

  it('locks a code after too many wrong guesses, even for the right one', async () => {
    await post('/auth/otp/request', { phone: PHONE, deviceId: DEVICE }).expect(200);
    for (let i = 0; i < OTP_RULES.maxAttempts; i++) {
      await post('/auth/otp/verify', {
        phone: PHONE,
        code: wrongCode(),
        deviceId: DEVICE,
      }).expect(400);
    }
    const locked = await post('/auth/otp/verify', {
      phone: PHONE,
      code: sms.lastCode,
      deviceId: DEVICE,
    }).expect(429);
    expect(locked.body.code).toBe('otp_too_many_attempts');
  });

  it('accepts a code once', async () => {
    await signIn();
    const again = await post('/auth/otp/verify', {
      phone: PHONE,
      code: sms.lastCode,
      deviceId: DEVICE,
    }).expect(400);
    expect(again.body.code).toBe('otp_expired');
  });

  it('accepts a code only on the device that asked for it', async () => {
    await post('/auth/otp/request', { phone: PHONE, deviceId: DEVICE }).expect(200);
    const other = await post('/auth/otp/verify', {
      phone: PHONE,
      code: sms.lastCode,
      deviceId: 'device-bbbb-2222',
    }).expect(400);
    expect(other.body.code).toBe('otp_invalid');
  });

  it('rejects an expired code', async () => {
    await post('/auth/otp/request', { phone: PHONE, deviceId: DEVICE }).expect(200);
    await db.execute(sql`update otp_challenges set expires_at = now() - interval '1 second'`);
    const expired = await post('/auth/otp/verify', {
      phone: PHONE,
      code: sms.lastCode,
      deviceId: DEVICE,
    }).expect(400);
    expect(expired.body.code).toBe('otp_expired');
  });

  it('makes a number wait before another code, and caps codes per hour', async () => {
    await post('/auth/otp/request', { phone: PHONE, deviceId: DEVICE }).expect(200);
    const tooSoon = await post('/auth/otp/request', {
      phone: PHONE,
      deviceId: DEVICE,
    }).expect(429);
    expect(tooSoon.body).toMatchObject({
      code: 'rate_limited',
      details: { retryAfter: expect.any(Number) },
    });

    for (let i = 1; i < OTP_RULES.maxPerPhonePerHour; i++) {
      await db.execute(sql`update otp_challenges set created_at = created_at - interval '1 minute'`);
      await post('/auth/otp/request', {
        phone: PHONE,
        deviceId: DEVICE,
      }).expect(200);
    }
    await db.execute(sql`update otp_challenges set created_at = created_at - interval '1 minute'`);
    await post('/auth/otp/request', { phone: PHONE, deviceId: DEVICE }).expect(429);
    expect(sms.sent).toHaveLength(OTP_RULES.maxPerPhonePerHour);
  });

  it('rotates refresh tokens and signs everyone out when a spent one comes back', async () => {
    const first = await signIn();
    const second = await post('/auth/refresh', {
      refreshToken: first.refreshToken,
      deviceId: DEVICE,
    }).expect(200);
    expect(second.body.refreshToken).not.toBe(first.refreshToken);
    await request(app.getHttpServer())
      .get('/v1/me')
      .set('Authorization', `Bearer ${second.body.accessToken}`)
      .expect(200);

    // The spent token is presented again: two parties hold it.
    const reused = await post('/auth/refresh', {
      refreshToken: first.refreshToken,
      deviceId: DEVICE,
    }).expect(401);
    expect(reused.body.code).toBe('unauthorized');
    await post('/auth/refresh', {
      refreshToken: second.body.refreshToken,
      deviceId: DEVICE,
    }).expect(401);
  });

  it('refuses a refresh token on another device and ends that sign-in', async () => {
    const { refreshToken } = await signIn();
    await post('/auth/refresh', {
      refreshToken,
      deviceId: 'device-bbbb-2222',
    }).expect(401);
    await post('/auth/refresh', { refreshToken, deviceId: DEVICE }).expect(401);
  });

  it('signs a device out', async () => {
    const { refreshToken } = await signIn();
    await post('/auth/logout', { refreshToken }).expect(204);
    await post('/auth/refresh', { refreshToken, deviceId: DEVICE }).expect(401);
    await post('/auth/logout', { refreshToken: 'unknown' }).expect(204);
  });
});
