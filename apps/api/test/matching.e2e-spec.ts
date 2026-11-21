import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { Test } from '@nestjs/testing';
import { MATCHING_RINGS } from '@sibimate/shared';
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
import { MatchingService } from '../src/matching/matching.service.js';

class FakeSmsSender extends SmsSender {
  lastCode = '';
  async sendOtp(_phone: string, code: string) {
    this.lastCode = code;
  }
}

/** Records what would be queued, so each test runs the rings itself. */
class RecordingScheduler extends MatchingScheduler {
  jobs: { taskId: string; ring: number; delayMs: number }[] = [];
  async schedule(taskId: string, ring: number, delayMs: number) {
    this.jobs.push({ taskId, ring, delayMs });
  }
}

// The customer is at Mansarovar. One hundredth of a degree of latitude is about 1.1 km.
const HOME = { lat: 26.8505, lng: 75.7628 };
const north = (km: number) => ({ lat: HOME.lat + km / 111, lng: HOME.lng });

describe('Matching and offers (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let sms: FakeSmsSender;
  let matching: MatchingService;
  const scheduler = new RecordingScheduler();
  let admin: string;
  let customer: string;
  let phones = 0;

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

  /** Signs in another admin with `role`. */
  async function adminWithRole(role: 'finance' | 'verifier' | 'operations') {
    const email = `${role}@sibimate.test`;
    const { totpSecret } = await app.get(AdminAuthService).upsertAdmin(email, 'a long test password', role);
    const login = await http()
      .post('/v1/admin/auth/login')
      .send({ email, password: 'a long test password', code: totpCode(totpSecret, totpStep(new Date())) })
      .expect(200);
    return login.body.token as string;
  }

  /** Adds a helper and puts them online `km` north of the customer. */
  async function helperAt(km: number, name: string, options: object = {}) {
    const phone = `+9190000${String(10000 + ++phones)}`;
    const created = await as(admin)
      .post('/admin/helpers', { phone, name, skillTag: 'unskilled', ...options })
      .expect(201);
    const token = await signIn(phone);
    await as(token)
      .put('/helper/availability', { isOnline: true, location: north(km) })
      .expect(200);
    return { token, id: created.body.id as string, name };
  }

  async function postTask(overrides: object = {}) {
    const response = await as(customer)
      .post('/tasks', {
        title: 'Carry two suitcases',
        description: 'Carry two suitcases from Mansarovar metro station to my home.',
        requiresSkilled: false,
        customerPrice: 15000,
        pickup: HOME,
        address: '14 Shanti Path, Sector 7, Mansarovar',
        paymentMethod: 'cash',
        ...overrides,
      })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    return response.body.id as string;
  }

  const nearby = async (token: string) => (await as(token).get('/helper/tasks/nearby').expect(200)).body.items;
  const task = async (id: string) => (await as(customer).get(`/tasks/${id}`).expect(200)).body;
  const offers = async (id: string) => (await as(customer).get(`/tasks/${id}/offers`).expect(200)).body.items;

  beforeAll(async () => {
    sms = new FakeSmsSender();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SmsSender)
      .useValue(sms)
      .overrideProvider(MatchingScheduler)
      .useValue(scheduler)
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    db = app.get<Database>(getDrizzleToken());
    matching = app.get(MatchingService);
    await migrate(db, { migrationsFolder: './drizzle' });
  });

  beforeEach(async () => {
    await db.execute(
      sql`truncate table users, otp_challenges, refresh_tokens, tasks, task_interpretations, admin_users, admin_sessions, helper_profiles, bookings cascade`,
    );
    scheduler.jobs = [];
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
    admin = login.body.token;
    customer = await signIn('+919876543210');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('going online', () => {
    it('needs a location the first time, and remembers it', async () => {
      const { token } = await helperAt(1, 'Aman');
      expect((await as(token).get('/helper/availability').expect(200)).body).toEqual({ isOnline: true, radiusM: 5000 });
      await as(token).put('/helper/availability', { isOnline: false }).expect(200);
      const back = await as(token).put('/helper/availability', { isOnline: true, radiusM: 3000 }).expect(200);
      expect(back.body).toEqual({ isOnline: true, radiusM: 3000 });

      const created = await as(admin)
        .post('/admin/helpers', { phone: '9000099999', name: 'New', skillTag: 'unskilled' })
        .expect(201);
      expect(created.body.status).toBe('active');
      const fresh = await signIn('+919000099999');
      const refused = await as(fresh).put('/helper/availability', { isOnline: true }).expect(400);
      expect(refused.body.details).toEqual([{ path: 'location', message: expect.any(String) }]);
      expect((await as(fresh).get('/helper/availability').expect(200)).body.isOnline).toBe(false);
    });

    it('is for helpers only', async () => {
      await as(customer).put('/helper/availability', { isOnline: true, location: HOME }).expect(403);
      await as(customer).get('/helper/tasks/nearby').expect(403);
    });
  });

  describe('search rings', () => {
    it('starts the first ring as soon as a task is posted', async () => {
      const taskId = await postTask();
      expect(scheduler.jobs).toEqual([{ taskId, ring: 0, delayMs: 0 }]);
    });

    it('notifies helpers ring by ring as the search widens', async () => {
      const near = await helperAt(1, 'Near');
      const mid = await helperAt(3.5, 'Mid');
      const far = await helperAt(7, 'Far', {});
      await as(far.token).put('/helper/availability', { isOnline: true, radiusM: 10000 }).expect(200);
      await helperAt(12, 'Too far');
      const taskId = await postTask();

      expect(await matching.runRing(taskId, 0)).toEqual({ notified: 1 });
      expect(scheduler.jobs.at(-1)).toEqual({ taskId, ring: 1, delayMs: MATCHING_RINGS[0].waitSeconds * 1000 });
      expect(await nearby(near.token)).toHaveLength(1);
      expect(await nearby(mid.token)).toHaveLength(0);

      expect(await matching.runRing(taskId, 1)).toEqual({ notified: 1 });
      expect(await nearby(mid.token)).toHaveLength(1);
      expect(await matching.runRing(taskId, 2)).toEqual({ notified: 1 });
      expect(await nearby(far.token)).toHaveLength(1);

      // Running a ring again notifies nobody twice.
      expect(await matching.runRing(taskId, 2)).toEqual({ notified: 0 });
      const { rows } = await db.execute(sql`select ring, distance_m from task_offers order by ring`);
      expect(rows.map((row) => row.ring)).toEqual([0, 1, 2]);
      expect(Number(rows[0]!.distance_m)).toBeGreaterThan(900);
      expect(Number(rows[0]!.distance_m)).toBeLessThan(1100);
    });

    it('skips helpers who are offline, not heard from, busy, out of their own range, or the customer', async () => {
      const offline = await helperAt(0.5, 'Offline');
      await as(offline.token).put('/helper/availability', { isOnline: false }).expect(200);
      const silent = await helperAt(0.5, 'Silent');
      await db.execute(
        sql`update helper_availability set seen_at = now() - interval '10 minutes' where helper_id = ${silent.id}`,
      );
      const homebody = await helperAt(1.5, 'Homebody');
      await as(homebody.token).put('/helper/availability', { isOnline: true, radiusM: 1000 }).expect(200);
      const busy = await helperAt(0.5, 'Busy');
      const other = await postTask({ title: 'Another task' });
      await as(admin).post(`/admin/tasks/${other}/assign`, { helperId: busy.id }).expect(204);
      // The customer is a helper too, and online right here.
      await as(admin).post('/admin/helpers', { phone: '9876543210', name: 'Asha', skillTag: 'unskilled' }).expect(201);
      await as(customer).put('/helper/availability', { isOnline: true, location: HOME }).expect(200);

      const taskId = await postTask();
      expect(await matching.runRing(taskId, 0)).toEqual({ notified: 0 });

      // A location report brings the silent helper back for the next ring.
      await as(silent.token).put('/helper/location', north(0.4)).expect(204);
      expect(await matching.runRing(taskId, 1)).toEqual({ notified: 1 });
      expect(await nearby(silent.token)).toHaveLength(1);
    });

    it('shows a task only to helpers verified to the level it needs', async () => {
      const basic = await helperAt(0.5, 'Basic', { verificationLevel: 'basic' });
      const verified = await helperAt(1, 'Verified');
      // A typed task has no category, so it needs a helper who may enter homes.
      const home = await postTask();
      expect((await task(home)).minVerificationLevel).toBe('verified');
      expect(await matching.runRing(home, 0)).toEqual({ notified: 1 });
      expect(await nearby(basic.token)).toHaveLength(0);
      expect(await nearby(verified.token)).toHaveLength(1);
      // An admin cannot give it to the basic helper either.
      const refused = await as(admin).post(`/admin/tasks/${home}/assign`, { helperId: basic.id }).expect(409);
      expect(refused.body.message).toContain('verified');

      // A task that needs only an ID check goes to both, and the dashboard shows its level.
      const errand = await postTask({ title: 'Drop a parcel' });
      await db.execute(sql`update tasks set min_verification_level = 'basic' where id = ${errand}`);
      expect(await matching.runRing(errand, 0)).toEqual({ notified: 2 });
      const admins = (await as(admin).get('/admin/tasks').expect(200)).body.items;
      expect(admins.find((item: { id: string }) => item.id === errand).minVerificationLevel).toBe('basic');
    });

    it('expires the task after the last ring, and lets the customer post it again at a higher price', async () => {
      const taskId = await postTask();
      for (let ring = 0; ring < MATCHING_RINGS.length; ring++) {
        expect(await matching.runRing(taskId, ring)).toEqual({ notified: 0 });
      }
      expect(await matching.runRing(taskId, MATCHING_RINGS.length)).toBe('expired');
      expect((await task(taskId)).status).toBe('expired');
      expect(await matching.runRing(taskId, 0)).toBe('stopped');
      expect(
        (await as(admin).get('/admin/tasks').expect(200)).body.items.map((item: { status: string }) => item.status),
      ).toEqual(['expired']);

      scheduler.jobs = [];
      const again = await as(customer).post(`/tasks/${taskId}/retry`, { customerPrice: 20000 }).expect(200);
      expect(again.body).toMatchObject({ status: 'matching', customerPrice: 20000 });
      expect(scheduler.jobs).toEqual([{ taskId, ring: 0, delayMs: 0 }]);
      await as(customer).post(`/tasks/${taskId}/retry`, {}).expect(409);
    });

    it('does not expire a task while offers wait for the customer', async () => {
      const helper = await helperAt(1, 'Aman');
      const taskId = await postTask();
      await matching.runRing(taskId, 0);
      await as(helper.token).post(`/helper/tasks/${taskId}/quote`, { price: 20000 }).expect(200);
      expect(await matching.runRing(taskId, MATCHING_RINGS.length)).toBe('waiting-for-customer');
      expect((await task(taskId)).status).toBe('matching');
    });
  });

  describe('taking a task', () => {
    it('shows the helper the job without the address', async () => {
      const helper = await helperAt(1, 'Aman');
      const taskId = await postTask();
      await matching.runRing(taskId, 0);
      const [shown] = await nearby(helper.token);
      expect(shown).toMatchObject({
        id: taskId,
        title: 'Carry two suitcases',
        customerPrice: 15000,
        netAtCustomerPrice: 13200,
        commissionBps: 1200,
        instant: true,
        myOffer: null,
      });
      expect(shown.distanceM).toBeGreaterThan(900);
      expect(JSON.stringify(shown)).not.toContain('Shanti');
    });

    it('gives the task to the first helper who accepts', async () => {
      const first = await helperAt(1, 'First');
      const second = await helperAt(1.2, 'Second');
      const taskId = await postTask();
      await matching.runRing(taskId, 0);

      const [won, lost] = await Promise.all([
        as(first.token).post(`/helper/tasks/${taskId}/accept`),
        as(second.token).post(`/helper/tasks/${taskId}/accept`),
      ]);
      const statuses = [won.status, lost.status].sort((a, b) => a - b);
      expect(statuses).toEqual([200, 409]);
      const winner = won.status === 200 ? won : lost;
      const loser = won.status === 200 ? lost : won;
      expect(winner.body).toEqual({ outcome: 'assigned', bookingId: expect.any(String) });
      expect(loser.body.code).toBe('offer_unavailable');

      expect(await task(taskId)).toMatchObject({
        status: 'assigned',
        booking: { id: winner.body.bookingId, agreedPrice: 15000 },
      });
      const { rows } = await db.execute(sql`select count(*)::int as bookings from bookings where status = 'active'`);
      expect(rows).toEqual([{ bookings: 1 }]);
      expect(await nearby(first.token)).toEqual([]);
      expect(await nearby(second.token)).toEqual([]);
      expect(await matching.runRing(taskId, 1)).toBe('stopped');

      const winnerToken = won.status === 200 ? first.token : second.token;
      expect((await as(winnerToken).get('/helper/bookings').expect(200)).body.items[0]).toMatchObject({
        id: winner.body.bookingId,
        status: 'assigned',
      });
    });

    it('lets only helpers who were shown the task act on it', async () => {
      const shown = await helperAt(1, 'Shown');
      const far = await helperAt(12, 'Far');
      const taskId = await postTask();
      await matching.runRing(taskId, 0);
      await as(far.token).post(`/helper/tasks/${taskId}/accept`).expect(404);
      await as(far.token).post(`/helper/tasks/${taskId}/quote`, { price: 10000 }).expect(404);

      await as(shown.token).post(`/helper/tasks/${taskId}/decline`).expect(204);
      expect(await nearby(shown.token)).toEqual([]);
      const declined = await as(shown.token).post(`/helper/tasks/${taskId}/accept`).expect(409);
      expect(declined.body.code).toBe('offer_unavailable');
    });

    it('lets helpers quote their own price and the customer choose', async () => {
      const cheap = await helperAt(1.5, 'Cheap');
      const dear = await helperAt(0.5, 'Dear', { skillTag: 'skilled', skills: ['carpentry'] });
      const taskId = await postTask();
      const otherTask = await postTask({ title: 'Another task' });
      await matching.runRing(taskId, 0);
      await matching.runRing(otherTask, 0);

      await as(dear.token).post(`/helper/tasks/${taskId}/quote`, { price: 25000, etaMin: 10 }).expect(200);
      const quoted = await as(cheap.token)
        .post(`/helper/tasks/${taskId}/quote`, { price: 18000, etaMin: 20 })
        .expect(200);
      expect(quoted.body).toEqual({ outcome: 'offered', bookingId: null });
      await as(cheap.token).post(`/helper/tasks/${otherTask}/quote`, { price: 12000 }).expect(200);
      await as(cheap.token).post(`/helper/tasks/${taskId}/quote`, { price: 50 }).expect(400);
      expect((await nearby(cheap.token)).find((item: { id: string }) => item.id === taskId).myOffer).toEqual({
        price: 18000,
        etaMin: 20,
      });

      const list = await offers(taskId);
      expect(list).toEqual([
        {
          id: expect.any(String),
          helper: { name: 'Cheap', skillTag: 'unskilled', completedCount: 0, rating: null },
          price: 18000,
          etaMin: 20,
          distanceM: expect.any(Number),
        },
        {
          id: expect.any(String),
          helper: { name: 'Dear', skillTag: 'skilled', completedCount: 0, rating: null },
          price: 25000,
          etaMin: 10,
          distanceM: expect.any(Number),
        },
      ]);

      await as(customer).post(`/tasks/${taskId}/offers/${list[0].id}/accept`).expect(204);
      expect(await task(taskId)).toMatchObject({
        status: 'assigned',
        booking: { helper: { name: 'Cheap' }, agreedPrice: 18000 },
      });
      // The helper keeps the agreed price less commission on that price.
      expect((await as(cheap.token).get('/helper/bookings').expect(200)).body.items[0]).toMatchObject({
        agreedPrice: 18000,
        commission: 2160,
        netAmount: 15840,
      });

      // The losing offer has ended, and the winner's offer on the other task is withdrawn.
      await as(customer).post(`/tasks/${taskId}/offers/${list[1].id}/accept`).expect(409);
      expect(await offers(otherTask)).toEqual([]);
      const { rows } = await db.execute(sql`select status from task_offers order by status`);
      expect(rows.map((row) => String(row.status)).sort()).toEqual(['accepted', 'expired', 'notified', 'withdrawn']);
    });

    it('always lets the customer choose for skilled work', async () => {
      const plumber = await helperAt(1, 'Plumber', { skillTag: 'skilled', skills: ['plumbing'] });
      const taskId = await postTask({ title: 'Fix a leaking tap', requiresSkilled: true });
      await matching.runRing(taskId, 0);
      expect((await nearby(plumber.token))[0].instant).toBe(false);

      const accepted = await as(plumber.token).post(`/helper/tasks/${taskId}/accept`).expect(200);
      expect(accepted.body).toEqual({ outcome: 'offered', bookingId: null });
      expect((await task(taskId)).status).toBe('matching');
      const [offer] = await offers(taskId);
      expect(offer).toMatchObject({ helper: { name: 'Plumber', skillTag: 'skilled' }, price: 15000 });
      await as(customer).post(`/tasks/${taskId}/offers/${offer.id}/accept`).expect(204);
      expect((await task(taskId)).status).toBe('assigned');
    });

    it('keeps offers private to the task’s customer', async () => {
      const helper = await helperAt(1, 'Aman');
      const taskId = await postTask();
      await matching.runRing(taskId, 0);
      await as(helper.token).post(`/helper/tasks/${taskId}/quote`, { price: 18000 }).expect(200);
      const [offer] = await offers(taskId);
      const stranger = await signIn('+919811111111');
      await as(stranger).get(`/tasks/${taskId}/offers`).expect(404);
      await as(stranger).post(`/tasks/${taskId}/offers/${offer.id}/accept`).expect(404);
      await as(customer).post(`/tasks/${taskId}/offers/${randomUUID()}/accept`).expect(409);
      expect((await task(taskId)).status).toBe('matching');
    });

    it('searches again when the helper gives the task up, without asking them twice', async () => {
      const quitter = await helperAt(1, 'Quitter');
      const steady = await helperAt(1.5, 'Steady');
      const taskId = await postTask();
      await matching.runRing(taskId, 0);
      const { body } = await as(quitter.token).post(`/helper/tasks/${taskId}/accept`).expect(200);

      scheduler.jobs = [];
      await as(quitter.token).post(`/bookings/${body.bookingId}/cancel`).expect(200);
      expect(scheduler.jobs).toEqual([{ taskId, ring: 0, delayMs: 0 }]);
      // The helper who gave it up is not asked again; the other one, whose chance had ended, is.
      expect(await matching.runRing(taskId, 0)).toEqual({ notified: 1 });
      expect(await nearby(quitter.token)).toEqual([]);
      expect(await nearby(steady.token)).toHaveLength(1);
      await as(steady.token).post(`/helper/tasks/${taskId}/accept`).expect(200);
    });
  });

  describe('scheduled tasks', () => {
    it('waits for a later task, and starts looking ahead of its time', async () => {
      const helper = await helperAt(1, 'Aman');
      const later = new Date(Date.now() + 26 * 3_600_000).toISOString();
      const taskId = await postTask({ scheduleAt: later });
      expect(await task(taskId)).toMatchObject({ status: 'posted', scheduleAt: later });
      // One job, two hours before the time.
      expect(scheduler.jobs).toHaveLength(1);
      expect(scheduler.jobs[0]).toMatchObject({ taskId, ring: -1 });
      expect(scheduler.jobs[0]!.delayMs).toBeGreaterThan(23.9 * 3_600_000);
      expect(scheduler.jobs[0]!.delayMs).toBeLessThan(24.1 * 3_600_000);

      expect(await matching.runRing(taskId, -1)).toEqual({ notified: 0 });
      expect((await task(taskId)).status).toBe('matching');
      expect(scheduler.jobs.at(-1)).toEqual({ taskId, ring: 0, delayMs: 0 });
      await matching.runRing(taskId, 0);
      expect((await nearby(helper.token))[0].scheduleAt).toBe(later);
      // Running the start again does nothing.
      expect(await matching.runRing(taskId, -1)).toBe('stopped');
    });

    it('looks at once for a task within two hours, and refuses times too far ahead', async () => {
      const soon = await postTask({ scheduleAt: new Date(Date.now() + 90 * 60_000).toISOString() });
      expect((await task(soon)).status).toBe('matching');
      const tooFar = await as(customer)
        .post('/tasks', {
          title: 'Carry two suitcases',
          description: 'Carry two suitcases from the station.',
          requiresSkilled: false,
          customerPrice: 15000,
          pickup: HOME,
          address: '14 Shanti Path',
          paymentMethod: 'cash',
          scheduleAt: new Date(Date.now() + 15 * 86_400_000).toISOString(),
        })
        .set('Idempotency-Key', randomUUID())
        .expect(400);
      expect(tooFar.body.details[0].path).toBe('scheduleAt');
    });

    it('lets the customer cancel a scheduled task before it starts looking', async () => {
      const taskId = await postTask({ scheduleAt: new Date(Date.now() + 26 * 3_600_000).toISOString() });
      await as(customer).post(`/tasks/${taskId}/cancel`).expect(200);
      expect(await matching.runRing(taskId, -1)).toBe('stopped');
    });
  });

  describe('helpers with a job', () => {
    const hoursAhead = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
    /** Posts a task for `hours` ahead and runs its first ring. */
    async function laterTask(hours: number, title: string) {
      const taskId = await postTask({ title, scheduleAt: hoursAhead(hours) });
      if ((await task(taskId)).status === 'posted') {
        await matching.runRing(taskId, -1);
      }
      await matching.runRing(taskId, 0);
      return taskId;
    }
    const ids = (items: { id: string }[]) => items.map((item) => item.id).sort();

    it('shows a busy helper tasks for later, and lets the customer choose them', async () => {
      const busy = await helperAt(0.5, 'Busy');
      await helperAt(1, 'Free');
      const now = await postTask({ title: 'Move a sofa now' });
      await as(admin).post(`/admin/tasks/${now}/assign`, { helperId: busy.id }).expect(204);

      // Within three hours of the job they have, a helper is not shown a task; further away, they are.
      const soon = await laterTask(1.5, 'Soon');
      const afternoon = await laterTask(5, 'Afternoon');
      const alsoAfternoon = await laterTask(6, 'Also afternoon');
      const night = await laterTask(10, 'Night');
      expect(ids(await nearby(busy.token))).toEqual([afternoon, alsoAfternoon, night].sort());
      expect((await db.execute(sql`select 1 from task_offers where task_id = ${soon}`)).rows).toHaveLength(1);

      await as(busy.token).post(`/helper/tasks/${afternoon}/quote`, { price: 16000 }).expect(200);
      await as(busy.token).post(`/helper/tasks/${alsoAfternoon}/quote`, { price: 17000 }).expect(200);
      const [offer] = await offers(afternoon);
      await as(customer).post(`/tasks/${afternoon}/offers/${offer.id}/accept`).expect(204);

      // Two jobs now, the sooner first. The offer for an hour after the new job is withdrawn; the night one stays.
      const jobs = (await as(busy.token).get('/helper/bookings').expect(200)).body.items;
      expect(jobs.map((job: { title: string }) => job.title)).toEqual(['Move a sofa now', 'Afternoon']);
      expect(ids(await nearby(busy.token))).toEqual([night]);
      expect(await offers(alsoAfternoon)).toEqual([]);

      // Nobody can give them a third job around either time.
      const clash = await laterTask(5.5, 'Clash');
      const refused = await as(admin).post(`/admin/tasks/${clash}/assign`, { helperId: busy.id }).expect(409);
      expect(refused.body).toMatchObject({ code: 'helper_unavailable', message: expect.stringContaining('around') });
      const tooSoon = await postTask({ title: 'Also now' });
      await as(admin).post(`/admin/tasks/${tooSoon}/assign`, { helperId: busy.id }).expect(409);
      // A night job is far enough from both.
      await as(busy.token).post(`/helper/tasks/${night}/accept`).expect(200);
    });

    it('sends a helper to one job at a time, and frees the slot when a job is done', async () => {
      const helper = await helperAt(0.5, 'Aman');
      const now = await postTask({ title: 'Now' });
      await as(admin).post(`/admin/tasks/${now}/assign`, { helperId: helper.id }).expect(204);
      const later = await laterTask(4, 'Later');
      await as(helper.token).post(`/helper/tasks/${later}/accept`).expect(200);
      const [first, second] = (await as(helper.token).get('/helper/bookings').expect(200)).body.items;
      expect([first.title, second.title]).toEqual(['Now', 'Later']);

      await as(helper.token).post(`/bookings/${first.id}/en-route`).expect(200);
      const refused = await as(helper.token).post(`/bookings/${second.id}/en-route`).expect(409);
      expect(refused.body.code).toBe('job_under_way');

      // A job that is done and only waiting for payment no longer holds the helper's time.
      await db.execute(sql`update tasks set status = 'completed' where id = ${now}`);
      const next = await postTask({ title: 'Next now' });
      await matching.runRing(next, 0);
      expect(ids(await nearby(helper.token))).toEqual([next]);
    });
  });

  describe('search area', () => {
    it('widens at once when the customer asks, and keeps widening on its own', async () => {
      await helperAt(1, 'Near');
      const mid = await helperAt(4, 'Mid');
      const taskId = await postTask();
      expect(await matching.runRing(taskId, 0)).toEqual({ notified: 1 });
      expect((await task(taskId)).searchRadiusM).toBe(2000);

      await as(customer).post(`/tasks/${taskId}/search-area`, { radiusM: 5000 }).expect(204);
      expect((await task(taskId)).searchRadiusM).toBe(5000);
      expect(await nearby(mid.token)).toHaveLength(1);
      // The last ring still reaches 8 km.
      await matching.runRing(taskId, 2);
      expect((await task(taskId)).searchRadiusM).toBe(8000);
    });

    it('never widens past an area the customer reduced', async () => {
      const taskId = await postTask();
      await matching.runRing(taskId, 0);
      await matching.runRing(taskId, 1);
      await as(customer).post(`/tasks/${taskId}/search-area`, { radiusM: 3000 }).expect(204);
      const far = await helperAt(6, 'Far');
      await as(far.token).put('/helper/availability', { isOnline: true, radiusM: 10000 }).expect(200);
      expect(await matching.runRing(taskId, 2)).toEqual({ notified: 0 });
      expect((await task(taskId)).searchRadiusM).toBe(3000);
    });

    it('accepts only the offered distances, from the task’s customer, while it is looking', async () => {
      const taskId = await postTask();
      await as(customer).post(`/tasks/${taskId}/search-area`, { radiusM: 4321 }).expect(400);
      const stranger = await signIn('+919811111111');
      await as(stranger).post(`/tasks/${taskId}/search-area`, { radiusM: 5000 }).expect(404);
      await as(customer).post(`/tasks/${taskId}/cancel`).expect(200);
      await as(customer).post(`/tasks/${taskId}/search-area`, { radiusM: 5000 }).expect(409);
    });
  });

  describe('admin widening the search', () => {
    it('reaches further at once for a task still looking', async () => {
      await helperAt(1, 'Near');
      const far = await helperAt(9, 'Far');
      await as(far.token).put('/helper/availability', { isOnline: true, radiusM: 15000 }).expect(200);
      const taskId = await postTask();
      expect(await matching.runRing(taskId, 0)).toEqual({ notified: 1 });

      await as(admin).post(`/admin/tasks/${taskId}/widen`, { radiusM: 10000 }).expect(204);
      expect(await nearby(far.token)).toHaveLength(1);
      const listed = (await as(admin).get('/admin/tasks').expect(200)).body.items[0];
      expect(listed).toMatchObject({ id: taskId, searchRadiusM: 10000 });
      // The automatic rings that follow never shrink it again.
      await matching.runRing(taskId, 1);
      expect((await task(taskId)).searchRadiusM).toBe(10000);
      const audit = (await as(admin).get('/admin/audit').expect(200)).body.items[0];
      expect(audit).toMatchObject({ action: 'task.widen', entityId: taskId, meta: { radiusM: 10000 } });
    });

    it('starts an expired task looking again, showing it to helpers who saw it before', async () => {
      const near = await helperAt(1, 'Near');
      const taskId = await postTask();
      await matching.runRing(taskId, 0);
      for (let ring = 1; ring <= MATCHING_RINGS.length; ring++) {
        await matching.runRing(taskId, ring);
      }
      expect((await task(taskId)).status).toBe('expired');
      expect(await nearby(near.token)).toHaveLength(0);

      scheduler.jobs = [];
      await as(admin).post(`/admin/tasks/${taskId}/widen`, { radiusM: 15000 }).expect(204);
      expect((await task(taskId)).status).toBe('matching');
      expect(scheduler.jobs).toEqual([{ taskId, ring: 0, delayMs: 0 }]);
      expect(await matching.runRing(taskId, 0)).toEqual({ notified: 1 });
      expect((await task(taskId)).searchRadiusM).toBe(15000);
      expect(await nearby(near.token)).toHaveLength(1);
    });

    it('only widens, only tasks without a helper, and only for owners and operations', async () => {
      const taskId = await postTask();
      await matching.runRing(taskId, 0);
      const smaller = await as(admin).post(`/admin/tasks/${taskId}/widen`, { radiusM: 2000 }).expect(400);
      expect(smaller.body.details).toEqual([{ path: 'radiusM', message: expect.any(String) }]);
      await as(admin).post(`/admin/tasks/${taskId}/widen`, { radiusM: 4321 }).expect(400);
      await as(admin).post(`/admin/tasks/${randomUUID()}/widen`, { radiusM: 5000 }).expect(404);
      await as(customer).post(`/admin/tasks/${taskId}/widen`, { radiusM: 5000 }).expect(401);

      await as(await adminWithRole('finance'))
        .post(`/admin/tasks/${taskId}/widen`, { radiusM: 5000 })
        .expect(403);

      await as(customer).post(`/tasks/${taskId}/cancel`).expect(200);
      await as(admin).post(`/admin/tasks/${taskId}/widen`, { radiusM: 5000 }).expect(409);
    });
  });

  describe('customers page', () => {
    const customers = async (q = '') =>
      (
        await as(admin)
          .get(`/admin/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`)
          .expect(200)
      ).body.items;

    it('lists everyone signed up, newest first, with their tasks counted, and finds them by name or number', async () => {
      const first = await postTask();
      await postTask();
      await as(customer).post(`/tasks/${first}/cancel`).expect(200);
      const helper = await helperAt(1, 'Aman');
      expect(helper.id).toBeDefined();

      const all = await customers();
      expect(all).toHaveLength(2);
      expect(all[0]).toMatchObject({ name: 'Aman', isHelper: true, tasks: { total: 0 }, lastTaskAt: null });
      expect(all[1]).toMatchObject({
        phone: '+919876543210',
        status: 'active',
        isHelper: false,
        blockedReason: null,
        tasks: { total: 2, open: 1, done: 0, cancelled: 1 },
      });
      expect(await customers('aMa')).toHaveLength(1);
      expect(await customers('76543')).toHaveLength(1);
      expect(await customers('%')).toHaveLength(0);
      await as(customer).get('/admin/customers').expect(401);
    });

    it('blocks an account: cancels its untaken tasks, signs it out and keeps it out until unblocked', async () => {
      const taskId = await postTask();
      const other = await adminWithRole('finance');
      const [person] = (await customers('76543')) as { id: string }[];
      await as(other).post(`/admin/customers/${person!.id}/block`, { reason: 'Abusive to helpers' }).expect(403);
      await as(admin).post(`/admin/customers/${person!.id}/block`, { reason: 'no' }).expect(400);

      const blocked = await as(admin)
        .post(`/admin/customers/${person!.id}/block`, { reason: 'Abusive to helpers' })
        .expect(200);
      expect(blocked.body).toEqual({ cancelledTasks: 1 });
      expect((await customers('76543'))[0]).toMatchObject({ status: 'blocked', blockedReason: 'Abusive to helpers' });
      const { rows } = await db.execute(sql`select status from tasks where id = ${taskId}`);
      expect(rows).toEqual([{ status: 'cancelled' }]);
      await as(customer).get('/tasks').expect(401);
      await as(admin).post(`/admin/customers/${person!.id}/block`, { reason: 'Abusive to helpers' }).expect(409);

      // Earlier codes count towards the number's resend wait and limit, which are not what this test is about.
      await db.execute(sql`delete from otp_challenges`);
      await http().post('/v1/auth/otp/request').send({ phone: '+919876543210', deviceId: 'device-x1' }).expect(200);
      await http()
        .post('/v1/auth/otp/verify')
        .send({ acceptedNotice: true, phone: '+919876543210', code: sms.lastCode, deviceId: 'device-x1' })
        .expect(403);

      await as(admin).post(`/admin/customers/${person!.id}/unblock`).expect(204);
      expect((await customers('76543'))[0]).toMatchObject({ status: 'active', blockedReason: null });
      await db.execute(sql`delete from otp_challenges`);
      customer = await signIn('+919876543210');
      await as(customer).get('/tasks').expect(200);
      const audit = (await as(admin).get('/admin/audit').expect(200)).body.items;
      expect(audit.slice(0, 2).map((entry: { action: string }) => entry.action)).toEqual([
        'user.unblock',
        'user.block',
      ]);
    });

    it('waits until a job under way is settled, for the customer and for the helper', async () => {
      const helper = await helperAt(1, 'Aman');
      const taskId = await postTask();
      await matching.runRing(taskId, 0);
      await as(helper.token).post(`/helper/tasks/${taskId}/accept`).expect(200);

      const people = (await customers()) as { id: string; name: string | null }[];
      for (const person of people) {
        const refused = await as(admin)
          .post(`/admin/customers/${person.id}/block`, { reason: 'Testing the rule' })
          .expect(409);
        expect(refused.body.code).toBe('conflict');
      }
      await as(admin).post(`/admin/customers/${randomUUID()}/block`, { reason: 'Testing the rule' }).expect(404);
    });

    it('stops showing tasks to a blocked helper', async () => {
      const helper = await helperAt(1, 'Aman');
      await as(admin)
        .post(`/admin/customers/${(await customers('Aman'))[0].id}/block`, { reason: 'Fake documents' })
        .expect(200);
      const taskId = await postTask();
      expect(await matching.runRing(taskId, 0)).toEqual({ notified: 0 });
      await as(helper.token).get('/helper/tasks/nearby').expect(401);
    });
  });

  it('shows the audit log to owners only', async () => {
    const helper = await helperAt(1, 'Aman');
    expect(helper.id).toBeDefined();
    const entries = (await as(admin).get('/admin/audit').expect(200)).body.items;
    expect(entries[0]).toMatchObject({ admin: 'ops@sibimate.test', action: 'helper.create', entity: 'helper' });
    await as(customer).get('/admin/audit').expect(401);
  });
});
