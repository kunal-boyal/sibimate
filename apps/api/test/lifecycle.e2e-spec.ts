import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { ADMIN_LOGIN_RULES, AdminAuthService } from '../src/admin/admin-auth.service.js';
import { totpCode, totpStep } from '../src/admin/totp.js';
import { AppModule } from '../src/app.module.js';
import { setupApp } from '../src/app.setup.js';
import { SmsSender } from '../src/auth/sms-sender.js';
import { CODE_RULES } from '../src/bookings/bookings.service.js';
import type { Database } from '../src/db/db.js';
import { MatchingScheduler } from '../src/matching/matching-scheduler.js';
import { MatchingService } from '../src/matching/matching.service.js';

class FakeSmsSender extends SmsSender {
  lastCode = '';
  async sendOtp(_phone: string, code: string) {
    this.lastCode = code;
  }
}

const ADMIN = { email: 'ops@sibimate.test', password: 'correct horse battery staple' };
const CUSTOMER_PHONE = '+919876543210';
const HELPER_PHONE = '+919812345678';

describe('A task from posting to paid (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let sms: FakeSmsSender;
  let totpSecret: string;
  let admin: string;
  let customer: string;
  let helper: string;
  let helperId: string;

  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (path: string) => http().get(`/v1${path}`).set('Authorization', `Bearer ${token}`),
    post: (path: string, body?: object) => http().post(`/v1${path}`).set('Authorization', `Bearer ${token}`).send(body),
    put: (path: string, body?: object) => http().put(`/v1${path}`).set('Authorization', `Bearer ${token}`).send(body),
  });
  const currentCode = () => totpCode(totpSecret, totpStep(new Date()));
  const login = (overrides: object = {}) =>
    http()
      .post('/v1/admin/auth/login')
      .send({ ...ADMIN, code: currentCode(), ...overrides });
  /** A code works once, so tests that sign in again first forget the last code used. */
  const loginAgain = async (overrides: object = {}) => {
    await db.execute(sql`update admin_users set totp_last_step = 0`);
    return login(overrides);
  };

  async function signIn(phone: string) {
    const deviceId = `device-${phone}`;
    await http().post('/v1/auth/otp/request').send({ phone, deviceId }).expect(200);
    const verified = await http()
      .post('/v1/auth/otp/verify')
      .send({ acceptedNotice: true, phone, code: sms.lastCode, deviceId })
      .expect(200);
    return verified.body.accessToken as string;
  }

  async function postTask(token = customer, overrides: object = {}) {
    const response = await as(token)
      .post('/tasks', {
        title: 'Carry two suitcases',
        description: 'Carry two suitcases from Mansarovar metro station to my home.',
        requiresSkilled: false,
        customerPrice: 15000,
        pickup: { lat: 26.8505, lng: 75.7628 },
        address: '14 Shanti Path, Sector 7, Mansarovar',
        paymentMethod: 'cash',
        ...overrides,
      })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    return response.body.id as string;
  }

  const task = async (id: string, token = customer) => (await as(token).get(`/tasks/${id}`).expect(200)).body;
  const assign = (taskId: string, to = helperId) => as(admin).post(`/admin/tasks/${taskId}/assign`, { helperId: to });

  /** Posts a task, assigns the helper and returns the ids. */
  async function assigned() {
    const taskId = await postTask();
    await assign(taskId).expect(204);
    const bookingId = (await task(taskId)).booking.id as string;
    return { taskId, bookingId };
  }

  beforeAll(async () => {
    sms = new FakeSmsSender();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SmsSender)
      .useValue(sms)
      // Matching has its own tests; here no search runs in the background.
      .overrideProvider(MatchingScheduler)
      .useValue({ schedule: async () => {} })
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    db = app.get<Database>(getDrizzleToken());
    await migrate(db, { migrationsFolder: './drizzle' });
  });

  beforeEach(async () => {
    await db.execute(
      sql`truncate table users, otp_challenges, refresh_tokens, tasks, task_interpretations, admin_users, admin_sessions, helper_profiles, bookings cascade`,
    );
    ({ totpSecret } = await app.get(AdminAuthService).upsertAdmin(ADMIN.email, ADMIN.password, 'operations'));
    admin = (await login().expect(200)).body.token;
    customer = await signIn(CUSTOMER_PHONE);
    const created = await as(admin)
      .post('/admin/helpers', { phone: '98123 45678', name: 'Aman Singh', skillTag: 'unskilled' })
      .expect(201);
    helperId = created.body.id;
    helper = await signIn(HELPER_PHONE);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('admin sign-in', () => {
    it('signs in with email, password and an authenticator code', async () => {
      const response = await loginAgain();
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        token: expect.any(String),
        expiresAt: expect.any(String),
        admin: { email: ADMIN.email, role: 'operations' },
      });
      expect((await as(response.body.token).get('/admin/me').expect(200)).body.email).toBe(ADMIN.email);
    });

    it('gives one answer for a wrong email, password or code', async () => {
      const answers = [
        await loginAgain({ email: 'nobody@sibimate.test' }),
        await loginAgain({ password: 'wrong' }),
        await loginAgain({ code: currentCode() === '000000' ? '111111' : '000000' }),
      ];
      for (const answer of answers) {
        expect(answer.status).toBe(401);
        expect(answer.body).toEqual({ code: 'admin_login_failed', message: expect.any(String) });
      }
    });

    it('accepts an authenticator code once', async () => {
      // beforeEach signed in with the current code already.
      await login().expect(401);
      expect((await loginAgain()).status).toBe(200);
    });

    it('locks the account after repeated failures', async () => {
      for (let i = 0; i < ADMIN_LOGIN_RULES.maxFailures; i++) {
        expect((await loginAgain({ password: 'wrong' })).status).toBe(401);
      }
      const locked = await loginAgain();
      expect(locked.status).toBe(429);
      expect(locked.body).toMatchObject({ code: 'rate_limited', details: { retryAfter: expect.any(Number) } });
    });

    it('stores neither the password nor the authenticator secret in the clear', async () => {
      const { rows } = await db.execute(sql`select password_hash, totp_secret_enc from admin_users`);
      expect(JSON.stringify(rows)).not.toContain(ADMIN.password);
      expect(JSON.stringify(rows)).not.toContain(totpSecret);
    });

    it('signs out', async () => {
      await as(admin).post('/admin/auth/logout').expect(204);
      await as(admin).get('/admin/me').expect(401);
    });

    it('keeps app users out of the dashboard and admins out of the app', async () => {
      await as(customer).get('/admin/tasks').expect(401);
      await http().get('/v1/admin/tasks').expect(401);
      await as(admin).get('/me').expect(401);
      await as(admin).get('/tasks').expect(401);
    });

    it('limits assigning to the roles that run operations', async () => {
      const { totpSecret: secret } = await app
        .get(AdminAuthService)
        .upsertAdmin('finance@sibimate.test', ADMIN.password, 'finance');
      const signedIn = await http()
        .post('/v1/admin/auth/login')
        .send({
          email: 'finance@sibimate.test',
          password: ADMIN.password,
          code: totpCode(secret, totpStep(new Date())),
        })
        .expect(200);
      const taskId = await postTask();
      await as(signedIn.body.token).get('/admin/tasks').expect(200);
      await as(signedIn.body.token).post(`/admin/tasks/${taskId}/assign`, { helperId }).expect(403);
    });
  });

  describe('helpers', () => {
    it('makes an existing or new phone number a helper', async () => {
      const list = (await as(admin).get('/admin/helpers').expect(200)).body.items;
      expect(list).toEqual([
        expect.objectContaining({
          id: helperId,
          phone: HELPER_PHONE,
          name: 'Aman Singh',
          skillTag: 'unskilled',
          verificationLevel: 'verified',
          status: 'active',
          busy: false,
        }),
      ]);
      expect((await as(helper).get('/me').expect(200)).body.roles.sort()).toEqual(['customer', 'helper']);

      // The customer already has an account and a name of their own choosing.
      await request(app.getHttpServer())
        .patch('/v1/me')
        .set('Authorization', `Bearer ${customer}`)
        .send({ name: 'Asha' })
        .expect(200);
      await as(admin)
        .post('/admin/helpers', {
          phone: CUSTOMER_PHONE,
          name: 'Someone Else',
          skillTag: 'skilled',
          skills: ['plumbing'],
        })
        .expect(201);
      expect((await as(customer).get('/me').expect(200)).body).toMatchObject({
        name: 'Asha',
        roles: ['customer', 'helper'],
      });
    });

    it('keeps people who are not helpers out of helper routes', async () => {
      const refused = await as(customer).get('/helper/bookings').expect(403);
      expect(refused.body.code).toBe('forbidden');
    });
  });

  describe('the whole job', () => {
    it('runs from posting to cash paid', async () => {
      const taskId = await postTask();

      // The admin sees it waiting and assigns the helper.
      const waiting = (await as(admin).get('/admin/tasks').expect(200)).body.items;
      expect(waiting).toEqual([
        expect.objectContaining({
          id: taskId,
          status: 'matching',
          helper: null,
          customer: { name: null, phone: CUSTOMER_PHONE },
          address: '14 Shanti Path, Sector 7, Mansarovar',
        }),
      ]);
      await assign(taskId).expect(204);
      expect((await as(admin).get('/admin/tasks').expect(200)).body.items).toEqual([]);
      expect((await as(admin).get('/admin/tasks?status=active').expect(200)).body.items[0].helper).toEqual({
        id: helperId,
        name: 'Aman Singh',
        phone: HELPER_PHONE,
      });

      // The customer sees the helper and a start code; the helper sees the job without the address.
      const confirmed = await task(taskId);
      expect(confirmed).toMatchObject({
        status: 'assigned',
        booking: {
          helper: { name: 'Aman Singh', phone: HELPER_PHONE, skillTag: 'unskilled' },
          agreedPrice: 15000,
          startCode: expect.stringMatching(/^\d{4}$/),
          completionCode: null,
        },
      });
      const bookingId = confirmed.booking.id;
      const jobs = (await as(helper).get('/helper/bookings').expect(200)).body.items;
      expect(jobs).toEqual([
        expect.objectContaining({
          id: bookingId,
          status: 'assigned',
          agreedPrice: 15000,
          commission: 1800,
          netAmount: 13200,
          customer: { name: null, phone: CUSTOMER_PHONE },
          address: null,
        }),
      ]);

      // On the way: the address is released.
      const enRoute = await as(helper).post(`/bookings/${bookingId}/en-route`).expect(200);
      expect(enRoute.body).toMatchObject({ status: 'en_route', address: '14 Shanti Path, Sector 7, Mansarovar' });

      // At the door: the start code.
      const started = await as(helper)
        .post(`/bookings/${bookingId}/start`, { code: confirmed.booking.startCode })
        .expect(200);
      expect(started.body.status).toBe('in_progress');

      // Done: the customer now has a completion code, different from the start code.
      const working = await task(taskId);
      expect(working.booking).toMatchObject({ startCode: null, completionCode: expect.stringMatching(/^\d{4}$/) });
      await as(helper).post(`/bookings/${bookingId}/complete`, { code: working.booking.completionCode }).expect(200);
      expect((await task(taskId)).status).toBe('completed');

      // Cash in hand.
      const paid = await as(helper).post(`/bookings/${bookingId}/payment/cash-received`).expect(200);
      expect(paid.body).toMatchObject({ status: 'paid', address: null, customer: { phone: '' } });
      expect(await task(taskId)).toMatchObject({ status: 'paid', booking: { startCode: null, completionCode: null } });

      const history = await db.execute(
        sql`select to_status, actor_role from task_events where task_id = ${taskId} order by created_at`,
      );
      expect(history.rows.map((row) => `${String(row.to_status)}:${String(row.actor_role)}`)).toEqual([
        'posted:customer',
        'matching:system',
        'assigned:admin',
        'en_route:helper',
        'in_progress:helper',
        'completed:helper',
        'paid:helper',
      ]);
      expect((await as(admin).get('/admin/helpers').expect(200)).body.items[0]).toMatchObject({
        completedCount: 1,
        busy: false,
      });
    });

    it('does not start or finish without the right code, and locks after too many guesses', async () => {
      const { taskId, bookingId } = await assigned();
      const { startCode } = (await task(taskId)).booking;
      const wrong = startCode === '0000' ? '1111' : '0000';

      // Not on the way yet: even the right code cannot start the job.
      await as(helper).post(`/bookings/${bookingId}/start`, { code: startCode }).expect(409);
      await as(helper).post(`/bookings/${bookingId}/en-route`).expect(200);

      await as(helper).post(`/bookings/${bookingId}/start`, { code: '12' }).expect(400);
      for (let i = 0; i < CODE_RULES.maxAttempts; i++) {
        const response = await as(helper).post(`/bookings/${bookingId}/start`, { code: wrong }).expect(400);
        expect(response.body.code).toBe('code_invalid');
      }
      const locked = await as(helper).post(`/bookings/${bookingId}/start`, { code: startCode }).expect(429);
      expect(locked.body.code).toBe('code_locked');

      await db.execute(sql`update bookings set code_locked_until = now() - interval '1 second'`);
      await as(helper).post(`/bookings/${bookingId}/start`, { code: startCode }).expect(200);

      // The start code does not finish the job.
      await as(helper).post(`/bookings/${bookingId}/complete`, { code: startCode }).expect(400);
      await as(helper).post(`/bookings/${bookingId}/payment/cash-received`).expect(409);
    });

    it('gives a helper one job at a time and a task one helper', async () => {
      const { taskId } = await assigned();
      const second = await postTask();
      const busy = await assign(second).expect(409);
      expect(busy.body).toMatchObject({ code: 'helper_unavailable', message: expect.stringContaining('already') });
      expect((await task(second)).status).toBe('matching');

      const other = await as(admin)
        .post('/admin/helpers', { phone: '9000000001', name: 'Ravi', skillTag: 'unskilled' })
        .expect(201);
      const taken = await assign(taskId, other.body.id).expect(409);
      expect(taken.body.code).toBe('invalid_transition');
    });

    it('refuses a helper who is paused, under-verified, or the customer', async () => {
      const taskId = await postTask();
      await assign(taskId, randomUUID()).expect(409);

      await as(admin)
        .post('/admin/helpers', { phone: CUSTOMER_PHONE, name: 'Asha', skillTag: 'unskilled' })
        .expect(201);
      const self = (await as(admin).get('/admin/helpers').expect(200)).body.items.find(
        (item: { phone: string }) => item.phone === CUSTOMER_PHONE,
      );
      expect((await assign(taskId, self.id).expect(409)).body.message).toContain('own task');

      // Cleaning inside a home needs the verified level.
      await db.execute(sql`update helper_profiles set verification_level = 'basic' where id = ${helperId}`);
      await db.execute(sql`update tasks set category_id = (select id from task_categories where slug = 'cleaning')`);
      expect((await assign(taskId).expect(409)).body.message).toContain('verified');

      await db.execute(sql`update helper_profiles set verification_level = 'verified', status = 'paused'`);
      await assign(taskId).expect(409);
      expect((await task(taskId)).booking).toBeNull();
    });

    it('sends the task back to matching when the helper gives it up', async () => {
      const { taskId, bookingId } = await assigned();
      const given = await as(helper).post(`/bookings/${bookingId}/cancel`).expect(200);
      expect(given.body.status).toBe('cancelled');
      expect(await task(taskId)).toMatchObject({ status: 'matching', booking: null });
      expect((await as(admin).get('/admin/helpers').expect(200)).body.items[0]).toMatchObject({
        cancelledCount: 1,
        busy: false,
      });
      // The helper is free again, and the task can be given to them or anyone else.
      await assign(taskId).expect(204);
    });

    it('frees the helper when the customer cancels', async () => {
      const { taskId, bookingId } = await assigned();
      await as(customer).post(`/tasks/${taskId}/cancel`).expect(200);
      expect((await as(helper).get(`/helper/bookings/${bookingId}`).expect(200)).body.status).toBe('cancelled');
      await as(helper).post(`/bookings/${bookingId}/en-route`).expect(409);
      await assign(await postTask()).expect(204);
    });

    it('shows a job only to its helper', async () => {
      const { bookingId } = await assigned();
      await as(admin).post('/admin/helpers', { phone: '9000000001', name: 'Ravi', skillTag: 'unskilled' }).expect(201);
      const ravi = await signIn('+919000000001');
      await as(ravi).get(`/helper/bookings/${bookingId}`).expect(404);
      await as(ravi).post(`/bookings/${bookingId}/en-route`).expect(404);
      expect((await as(ravi).get('/helper/bookings').expect(200)).body.items).toEqual([]);
    });
  });

  describe('cash commission', () => {
    /** Runs a job paid in cash from posting to cash in hand. */
    async function cashJob(customerPrice: number) {
      const taskId = await postTask(customer, { customerPrice });
      await assign(taskId).expect(204);
      const { booking } = await task(taskId);
      await as(helper).post(`/bookings/${booking.id}/en-route`).expect(200);
      await as(helper).post(`/bookings/${booking.id}/start`, { code: booking.startCode }).expect(200);
      const working = await task(taskId);
      await as(helper).post(`/bookings/${booking.id}/complete`, { code: working.booking.completionCode }).expect(200);
      await as(helper).post(`/bookings/${booking.id}/payment/cash-received`).expect(200);
    }
    const earnings = async () => (await as(helper).get('/helper/earnings').expect(200)).body;

    it('records what a helper owes from cash jobs, stops cash tasks above the limit, and settles', async () => {
      expect(await earnings()).toMatchObject({
        total: 0,
        jobsDone: 0,
        duesOwed: 0,
        duesLimit: 50000,
        overLimit: false,
      });

      // ₹3,000 at 12%: the helper kept ₹2,640 and owes ₹360, under the ₹500 limit.
      await cashJob(300000);
      expect(await earnings()).toMatchObject({
        today: 264000,
        week: 264000,
        month: 264000,
        total: 264000,
        jobsDone: 1,
        duesOwed: 36000,
        overLimit: false,
        recent: [{ title: 'Carry two suitcases', paymentMethod: 'cash', agreedPrice: 300000, commission: 36000 }],
      });

      // Another ₹2,000 takes the dues to ₹600, over the limit.
      await cashJob(200000);
      expect(await earnings()).toMatchObject({ total: 440000, jobsDone: 2, duesOwed: 60000, overLimit: true });
      const listed = (await as(admin).get('/admin/helpers').expect(200)).body.items;
      expect(listed.find((item: { id: string }) => item.id === helperId).duesOwed).toBe(60000);

      // Over the limit, the helper is not shown cash tasks, and cannot take one they were shown before.
      await as(helper)
        .put('/helper/availability', { isOnline: true, location: { lat: 26.851, lng: 75.763 } })
        .expect(200);
      const next = await postTask();
      expect(await app.get(MatchingService).runRing(next, 0)).toEqual({ notified: 0 });
      await db.execute(sql`insert into task_offers (task_id, helper_id, ring) values (${next}, ${helperId}, 0)`);
      const refused = await as(helper).post(`/helper/tasks/${next}/accept`).expect(409);
      expect(refused.body.code).toBe('dues_over_limit');

      // Paying up: only owners and finance record it.
      await as(admin).post(`/admin/helpers/${helperId}/dues/settle`).expect(403);
      const { totpSecret: secret } = await app
        .get(AdminAuthService)
        .upsertAdmin('finance@sibimate.test', ADMIN.password, 'finance');
      const finance = (
        await http()
          .post('/v1/admin/auth/login')
          .send({
            email: 'finance@sibimate.test',
            password: ADMIN.password,
            code: totpCode(secret, totpStep(new Date())),
          })
          .expect(200)
      ).body.token as string;
      expect((await as(finance).post(`/admin/helpers/${helperId}/dues/settle`).expect(200)).body).toEqual({
        settled: 60000,
      });
      await as(finance).post(`/admin/helpers/${helperId}/dues/settle`).expect(409);
      expect(await earnings()).toMatchObject({ duesOwed: 0, overLimit: false, total: 440000 });
      await as(helper).post(`/helper/tasks/${next}/accept`).expect(200);
    });
  });
});
