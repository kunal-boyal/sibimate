import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { type Socket, io } from 'socket.io-client';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AdminAuthService } from '../src/admin/admin-auth.service.js';
import { totpCode, totpStep } from '../src/admin/totp.js';
import { AppModule } from '../src/app.module.js';
import { setupApp } from '../src/app.setup.js';
import { SmsSender } from '../src/auth/sms-sender.js';
import type { Database } from '../src/db/db.js';
import { MatchingScheduler } from '../src/matching/matching-scheduler.js';
import { MatchingService } from '../src/matching/matching.service.js';

class FakeSmsSender extends SmsSender {
  lastCode = '';
  async sendOtp(_phone: string, code: string) {
    this.lastCode = code;
  }
}

const HOME = { lat: 26.8505, lng: 75.7628 };
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

describe('Live updates (e2e)', () => {
  let app: INestApplication<App>;
  let url: string;
  let db: Database;
  let sms: FakeSmsSender;
  let adminToken: string;
  let customer: string;
  let helper: string;
  let helperId: string;
  const sockets: Socket[] = [];

  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (path: string) => http().get(`/v1${path}`).set('Authorization', `Bearer ${token}`),
    post: (path: string, body?: object) => http().post(`/v1${path}`).set('Authorization', `Bearer ${token}`).send(body),
    put: (path: string, body?: object) => http().put(`/v1${path}`).set('Authorization', `Bearer ${token}`).send(body),
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

  /** Connects and records every event the socket is sent. */
  async function listen(auth: object) {
    const socket = io(url, { auth, transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    const events: { name: string; data: Record<string, unknown> }[] = [];
    socket.onAny((name: string, data: Record<string, unknown>) => events.push({ name, data }));
    const connected = await new Promise<boolean>((resolve) => {
      socket.on('connect', () => resolve(true));
      socket.on('connect_error', () => resolve(false));
    });
    // A refused client is connected for an instant and then dropped.
    await settle();
    return { socket, events, accepted: connected && socket.connected };
  }

  async function postTask() {
    const response = await as(customer)
      .post('/tasks', {
        title: 'Carry two suitcases',
        description: 'Carry two suitcases from Mansarovar metro station to my home.',
        requiresSkilled: false,
        customerPrice: 15000,
        pickup: HOME,
        address: '14 Shanti Path, Sector 7, Mansarovar',
        paymentMethod: 'cash',
      })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    return response.body.id as string;
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
    await app.listen(0);
    url = (await app.getUrl()).replace('[::1]', 'localhost');
    db = app.get<Database>(getDrizzleToken());
    await migrate(db, { migrationsFolder: './drizzle' });
  });

  beforeEach(async () => {
    await db.execute(
      sql`truncate table users, otp_challenges, refresh_tokens, tasks, task_interpretations, admin_users, admin_sessions, helper_profiles, bookings cascade`,
    );
    const { totpSecret } = await app
      .get(AdminAuthService)
      .upsertAdmin('ops@sibimate.test', 'a long test password', 'owner');
    const login = await http()
      .post('/v1/admin/auth/login')
      .send({
        email: 'ops@sibimate.test',
        password: 'a long test password',
        code: totpCode(totpSecret, totpStep(new Date())),
      })
      .expect(200);
    adminToken = login.body.token;
    customer = await signIn('+919876543210');
    const created = await as(adminToken)
      .post('/admin/helpers', { phone: '9812345678', name: 'Aman', skillTag: 'unskilled' })
      .expect(201);
    helperId = created.body.id;
    helper = await signIn('+919812345678');
    await as(helper)
      .put('/helper/availability', { isOnline: true, location: { lat: 26.86, lng: 75.7628 } })
      .expect(200);
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) {
      socket.disconnect();
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('refuses a connection without a valid token', async () => {
    expect((await listen({})).accepted).toBe(false);
    expect((await listen({ token: 'nonsense' })).accepted).toBe(false);
    expect((await listen({ adminToken: 'nonsense' })).accepted).toBe(false);
    // An app token is not a dashboard token, and the other way round.
    expect((await listen({ adminToken: customer })).accepted).toBe(false);
    expect((await listen({ token: adminToken })).accepted).toBe(false);
    expect((await listen({ token: customer })).accepted).toBe(true);
  });

  it('tells the customer, the helpers shown the task and the dashboard, and nobody else', async () => {
    const forCustomer = await listen({ token: customer });
    const forHelper = await listen({ token: helper });
    const forAdmin = await listen({ adminToken });
    const stranger = await listen({ token: await signIn('+919811111111') });

    const taskId = await postTask();
    await settle();
    const changed = { name: 'task.changed', data: { taskId } };
    // The task starts looking for a helper.
    expect(forCustomer.events).toEqual([changed]);
    expect(forAdmin.events).toEqual([changed]);
    expect(forHelper.events).toEqual([]);

    // The search finds the helper: the task appears for them.
    await app.get(MatchingService).runRing(taskId, 0);
    await settle();
    expect(forHelper.events).toEqual([changed]);

    // The helper quotes: the customer sees the offer arrive.
    forCustomer.events.length = 0;
    await as(helper).post(`/helper/tasks/${taskId}/quote`, { price: 18000 }).expect(200);
    await settle();
    expect(forCustomer.events).toEqual([changed]);

    // The customer chooses: the helper sees the job.
    forHelper.events.length = 0;
    const [offer] = (await as(customer).get(`/tasks/${taskId}/offers`).expect(200)).body.items;
    await as(customer).post(`/tasks/${taskId}/offers/${offer.id}/accept`).expect(204);
    await settle();
    expect(forHelper.events).toEqual([changed]);
    expect(stranger.events).toEqual([]);
  });

  it('shares the helper’s position with the customer only while they are on the way', async () => {
    const forCustomer = await listen({ token: customer });
    const taskId = await postTask();
    await as(adminToken).post(`/admin/tasks/${taskId}/assign`, { helperId }).expect(204);
    const task = async () => (await as(customer).get(`/tasks/${taskId}`).expect(200)).body;
    const bookingId = (await task()).booking.id;
    expect(await task()).toMatchObject({ pickup: HOME, booking: { helperLocation: null } });

    // Confirmed but not yet travelling: nothing is shared.
    await as(helper).put('/helper/location', { lat: 26.859, lng: 75.7628 }).expect(204);
    await settle();
    expect(forCustomer.events.filter((event) => event.name === 'helper.location')).toEqual([]);

    await as(helper).post(`/bookings/${bookingId}/en-route`).expect(200);
    expect((await task()).booking.helperLocation).toEqual({ lat: 26.859, lng: 75.7628 });
    await as(helper).put('/helper/location', { lat: 26.855, lng: 75.7628 }).expect(204);
    await settle();
    expect(forCustomer.events.filter((event) => event.name === 'helper.location')).toEqual([
      { name: 'helper.location', data: { taskId, lat: 26.855, lng: 75.7628 } },
    ]);

    // At the door: sharing stops.
    const { startCode } = (await task()).booking;
    await as(helper).post(`/bookings/${bookingId}/start`, { code: startCode }).expect(200);
    forCustomer.events.length = 0;
    await as(helper).put('/helper/location', { lat: 26.8505, lng: 75.7628 }).expect(204);
    await settle();
    expect(forCustomer.events).toEqual([]);
    expect((await task()).booking.helperLocation).toBeNull();
  });
});
