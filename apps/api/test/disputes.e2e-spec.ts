import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AdminAuthService } from '../src/admin/admin-auth.service.js';
import { totpCode, totpStep } from '../src/admin/totp.js';
import { AppModule } from '../src/app.module.js';
import { setupApp } from '../src/app.setup.js';
import { SmsSender } from '../src/auth/sms-sender.js';
import type { Database } from '../src/db/db.js';
import { MatchingScheduler } from '../src/matching/matching-scheduler.js';

class FakeSmsSender extends SmsSender {
  lastCode = '';
  async sendOtp(_phone: string, code: string) {
    this.lastCode = code;
  }
}

describe('Disputes and the overview (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let sms: FakeSmsSender;
  let admin: string;
  let customer: string;
  let helper: string;
  let helperId: string;

  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (path: string) => http().get(`/v1${path}`).set('Authorization', `Bearer ${token}`),
    post: (path: string, body?: object) => http().post(`/v1${path}`).set('Authorization', `Bearer ${token}`).send(body),
  });

  async function signIn(phone: string) {
    const deviceId = `device-${phone}`;
    await http().post('/v1/auth/otp/request').send({ phone, deviceId }).expect(200);
    const verified = await http()
      .post('/v1/auth/otp/verify')
      .send({ acceptedNotice: true, phone, code: sms.lastCode, deviceId })
      .expect(200);
    return verified.body.accessToken as string;
  }

  const task = async (id: string) => (await as(customer).get(`/tasks/${id}`).expect(200)).body;
  const job = async (bookingId: string) => (await as(helper).get(`/helper/bookings/${bookingId}`).expect(200)).body;

  /** A task assigned and taken as far as `stage`. */
  async function jobAt(stage: 'in_progress' | 'paid') {
    const posted = await as(customer)
      .post('/tasks', {
        title: 'Carry two suitcases',
        description: 'Carry two suitcases from the station to my home.',
        requiresSkilled: false,
        customerPrice: 15000,
        pickup: { lat: 26.85, lng: 75.76 },
        address: '14 Shanti Path, Sector 7, Mansarovar',
        paymentMethod: 'cash',
      })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    const taskId = posted.body.id as string;
    await as(admin).post(`/admin/tasks/${taskId}/assign`, { helperId }).expect(204);
    const bookingId = (await task(taskId)).booking.id as string;
    await as(helper).post(`/bookings/${bookingId}/en-route`).expect(200);
    await as(helper)
      .post(`/bookings/${bookingId}/start`, { code: (await task(taskId)).booking.startCode })
      .expect(200);
    if (stage === 'paid') {
      await as(helper)
        .post(`/bookings/${bookingId}/complete`, { code: (await task(taskId)).booking.completionCode })
        .expect(200);
      await as(helper).post(`/bookings/${bookingId}/payment/cash-received`).expect(200);
    }
    return { taskId, bookingId };
  }

  beforeAll(async () => {
    sms = new FakeSmsSender();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SmsSender)
      .useValue(sms)
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
      sql`truncate table users, otp_challenges, refresh_tokens, tasks, task_interpretations, audit_log, platform_settings, admin_users, admin_sessions, helper_profiles, bookings cascade`,
    );
    const { totpSecret } = await app
      .get(AdminAuthService)
      .upsertAdmin('ops@sibimate.test', 'a long test password', 'operations');
    admin = (
      await http()
        .post('/v1/admin/auth/login')
        .send({
          email: 'ops@sibimate.test',
          password: 'a long test password',
          code: totpCode(totpSecret, totpStep(new Date())),
        })
        .expect(200)
    ).body.token;
    customer = await signIn('+919876543210');
    helperId = (
      await as(admin).post('/admin/helpers', { phone: '9812345678', name: 'Aman', skillTag: 'unskilled' }).expect(201)
    ).body.id;
    helper = await signIn('+919812345678');
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets the customer report a problem after a paid job, and an admin refund it', async () => {
    const { taskId, bookingId } = await jobAt('paid');
    expect((await task(taskId)).booking).toMatchObject({ canDispute: true, dispute: null });

    await as(customer).post(`/bookings/${bookingId}/dispute`, { reason: 'short' }).expect(400);
    await as(customer)
      .post(`/bookings/${bookingId}/dispute`, { reason: 'One suitcase arrived with a broken wheel.' })
      .expect(204);
    await as(customer)
      .post(`/bookings/${bookingId}/dispute`, { reason: 'Trying to report it a second time.' })
      .expect(409);
    expect(await task(taskId)).toMatchObject({
      status: 'disputed',
      booking: { canDispute: false, dispute: { status: 'open', raisedByMe: true, resolution: null } },
    });
    expect((await job(bookingId)).dispute).toEqual({
      status: 'open',
      raisedByMe: false,
      resolution: null,
      resolutionNote: null,
    });

    const [dispute] = (await as(admin).get('/admin/disputes').expect(200)).body.items;
    expect(dispute).toMatchObject({
      raisedBy: 'customer',
      reason: 'One suitcase arrived with a broken wheel.',
      previousStatus: 'paid',
      agreedPrice: 15000,
      customer: { phone: '+919876543210' },
      helper: { name: 'Aman' },
    });
    await as(admin)
      .post(`/admin/disputes/${dispute.id}/resolve`, {
        resolution: 'refund',
        note: 'Customer pays nothing for this job.',
      })
      .expect(204);
    await as(admin)
      .post(`/admin/disputes/${dispute.id}/resolve`, { resolution: 'release', note: 'Second decision.' })
      .expect(409);
    expect(await task(taskId)).toMatchObject({
      status: 'closed',
      booking: {
        dispute: { status: 'resolved', resolution: 'refund', resolutionNote: 'Customer pays nothing for this job.' },
      },
    });
    expect((await as(admin).get('/admin/disputes').expect(200)).body.items).toEqual([]);
    expect((await as(admin).get('/admin/disputes?status=resolved').expect(200)).body.items).toHaveLength(1);
  });

  it('closes the window after the set hours', async () => {
    const { taskId, bookingId } = await jobAt('paid');
    await db.execute(sql`update bookings set completed_at = now() - interval '49 hours' where id = ${bookingId}`);
    expect((await task(taskId)).booking.canDispute).toBe(false);
    await as(customer)
      .post(`/bookings/${bookingId}/dispute`, { reason: 'Something went wrong with the job.' })
      .expect(409);
  });

  it('lets a helper ask for help when the customer withholds the completion code, and frees them on release', async () => {
    const { taskId, bookingId } = await jobAt('in_progress');
    expect((await job(bookingId)).canDispute).toBe(false);
    await as(helper)
      .post(`/bookings/${bookingId}/dispute`, { reason: 'Job done, customer will not give the code.' })
      .expect(409);
    // Customers cannot dispute while the work is under way.
    await as(customer).post(`/bookings/${bookingId}/dispute`, { reason: 'I would like to complain now.' }).expect(409);

    await db.execute(sql`update bookings set started_at = now() - interval '31 minutes' where id = ${bookingId}`);
    expect((await job(bookingId)).canDispute).toBe(true);
    await as(helper)
      .post(`/bookings/${bookingId}/dispute`, { reason: 'Job done, customer will not give the code.' })
      .expect(204);
    expect((await task(taskId)).booking.dispute).toMatchObject({ raisedByMe: false });

    const [dispute] = (await as(admin).get('/admin/disputes').expect(200)).body.items;
    expect(dispute).toMatchObject({ raisedBy: 'helper', previousStatus: 'in_progress' });
    await as(admin)
      .post(`/admin/disputes/${dispute.id}/resolve`, {
        resolution: 'release',
        note: 'Customer confirmed by phone the job was done.',
      })
      .expect(204);
    expect((await job(bookingId)).status).toBe('closed');
    expect((await as(admin).get('/admin/helpers').expect(200)).body.items[0]).toMatchObject({
      completedCount: 1,
      busy: false,
    });
    // The helper can be given work again.
    const audit = await db.execute(sql`select action from audit_log where action = 'dispute.resolve'`);
    expect(audit.rows).toHaveLength(1);
  });

  it('keeps disputes to the two sides of the job', async () => {
    const { bookingId } = await jobAt('paid');
    await as(await signIn('+919811111111'))
      .post(`/bookings/${bookingId}/dispute`, { reason: 'Not my job but complaining anyway.' })
      .expect(404);
    await as(customer)
      .post(`/bookings/${randomUUID()}/dispute`, { reason: 'A job that does not exist at all.' })
      .expect(404);
  });

  it('counts today’s work for the overview', async () => {
    await jobAt('paid');
    await jobAt('in_progress');
    const overview = (await as(admin).get('/admin/overview').expect(200)).body;
    expect(overview).toMatchObject({
      today: { posted: 2, paid: 1, value: 15000, commission: 1800 },
      now: { lookingForHelper: 0, underWay: 1, expired: 0, applicationsWaiting: 0, openDisputes: 0 },
      fulfilment: { matched: 2, total: 2 },
    });
    expect(overview.postedByDay).toHaveLength(7);
    expect(overview.postedByDay.at(-1).count).toBe(2);
    await as(customer).get('/admin/overview').expect(401);
  });
});
