import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { setupApp } from '../src/app.setup.js';
import { SmsSender } from '../src/auth/sms-sender.js';
import type { Database } from '../src/db/db.js';
import { MatchingScheduler } from '../src/matching/matching-scheduler.js';
import { SpeechToText } from '../src/interpretation/speech-to-text.js';
import { TaskInterpreter } from '../src/interpretation/task-interpreter.js';
import { AdminAuthService } from '../src/admin/admin-auth.service.js';
import { totpCode, totpStep } from '../src/admin/totp.js';

class FakeSmsSender extends SmsSender {
  lastCode = '';
  async sendOtp(_phone: string, code: string) {
    this.lastCode = code;
  }
}

/** Stands in for the speech-to-text provider: "hears" whatever the test sets. */
class FakeSpeechToText extends SpeechToText {
  available = true;
  heard: string | Error = '';
  received: { mimeType: string; filename: string; bytes: number }[] = [];

  async transcribe({ audio, mimeType, filename }: { audio: Buffer; mimeType: string; filename: string }) {
    this.received.push({ mimeType, filename, bytes: audio.length });
    if (this.heard instanceof Error) {
      throw this.heard;
    }
    return this.heard;
  }
}

const SUITCASES = 'I need someone to carry two suitcases from Mansarovar metro station to my home.';
const MANSAROVAR = { lat: 26.8505, lng: 75.7628 };

describe('Posting a task (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let sms: FakeSmsSender;
  let interpreter: TaskInterpreter;
  const speech = new FakeSpeechToText();
  let asha: string;

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

  const interpret = async (token: string, text = SUITCASES) =>
    (await as(token).post('/tasks/interpret', { text }).expect(200)).body;

  const taskBody = (overrides: object = {}) => ({
    title: 'Carry two suitcases',
    description: SUITCASES,
    requiresSkilled: false,
    customerPrice: 15000,
    pickup: MANSAROVAR,
    address: '14 Shanti Path, Sector 7, Mansarovar',
    paymentMethod: 'cash',
    ...overrides,
  });

  const postTask = (token: string, body: object, key = randomUUID()) =>
    as(token).post('/tasks', body).set('Idempotency-Key', key);

  beforeAll(async () => {
    sms = new FakeSmsSender();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SmsSender)
      .useValue(sms)
      // Matching has its own tests; here no search runs in the background.
      .overrideProvider(MatchingScheduler)
      .useValue({ schedule: async () => {} })
      .overrideProvider(SpeechToText)
      .useValue(speech)
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    db = app.get<Database>(getDrizzleToken());
    interpreter = app.get(TaskInterpreter);
    await migrate(db, { migrationsFolder: './drizzle' });
  });

  beforeEach(async () => {
    await db.execute(
      sql`truncate table users, otp_challenges, refresh_tokens, tasks, task_interpretations, admin_users, admin_sessions, audit_log cascade`,
    );
    await db.execute(sql`delete from task_categories where source = 'ai'`);
    asha = await signIn('+919876543210');
    Object.assign(speech, { available: true, heard: '', received: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /tasks/interpret', () => {
    it('writes task details with a category from the list', async () => {
      const draft = await interpret(asha);
      expect(draft).toMatchObject({
        id: expect.any(String),
        title: 'Carry two suitcases from Mansarovar metro station to my home',
        category: { slug: 'carry-luggage', name: 'Carrying and luggage', provisional: false },
        requiresSkilled: false,
        helpersNeeded: 1,
        estimatedMinutes: { min: 30, max: 45 },
      });
    });

    it('marks skilled work', async () => {
      const draft = await interpret(asha, 'The kitchen tap is leaking and the pipe under the sink needs fixing.');
      expect(draft).toMatchObject({ category: { slug: 'plumbing' }, requiresSkilled: true });
    });

    it('needs a signed-in customer and some words', async () => {
      await http().post('/v1/tasks/interpret').send({ text: SUITCASES }).expect(401);
      const short = await as(asha).post('/tasks/interpret', { text: 'hi' }).expect(400);
      expect(short.body).toMatchObject({ code: 'validation_failed', details: [{ path: 'text' }] });
    });

    it('removes contact details before the text leaves the API, and keeps the original', async () => {
      const seen = vi.spyOn(interpreter, 'interpret');
      await interpret(asha, 'Pick up my parcel from the courier office, call 98765 43210 when you reach.');
      expect(seen.mock.calls[0]![0].text).toBe(
        'Pick up my parcel from the courier office, call [phone] when you reach.',
      );
      const { rows } = await db.execute(sql`select input_text, provider, decision from task_interpretations`);
      expect(rows).toEqual([{ input_text: expect.stringContaining('98765 43210'), provider: 'rules', decision: null }]);
    });

    it('blocks a request that is not allowed, and records it', async () => {
      const blocked = await as(asha)
        .post('/tasks/interpret', { text: 'I need someone to bring me drugs tonight' })
        .expect(422);
      expect(blocked.body.code).toBe('task_not_allowed');
      const { rows } = await db.execute(sql`select decision, needs_review from task_interpretations`);
      expect(rows).toEqual([{ decision: 'blocked', needs_review: true }]);
    });

    it('sends the customer to the typed form when the model answer is unusable', async () => {
      vi.spyOn(interpreter, 'interpret').mockResolvedValueOnce({ title: 'x' });
      const failed = await as(asha).post('/tasks/interpret', { text: SUITCASES }).expect(503);
      expect(failed.body.code).toBe('interpreter_unavailable');

      vi.spyOn(interpreter, 'interpret').mockRejectedValueOnce(new Error('provider timeout'));
      await as(asha).post('/tasks/interpret', { text: SUITCASES }).expect(503);
    });
  });

  describe('POST /tasks/interpret with a recording', () => {
    const speak = (token: string, type = 'audio/mp4', name = 'task.m4a', bytes = Buffer.from('fake-audio')) =>
      http()
        .post('/v1/tasks/interpret')
        .set('Authorization', `Bearer ${token}`)
        .attach('audio', bytes, { filename: name, contentType: type });

    it('transcribes the recording and writes task details from what was heard', async () => {
      speech.heard = SUITCASES;
      const response = await speak(asha).expect(200);
      expect(response.body).toMatchObject({ inputText: SUITCASES, category: { slug: 'carry-luggage' } });
      expect(speech.received).toEqual([{ mimeType: 'audio/mp4', filename: 'task.m4a', bytes: 10 }]);

      // The transcript is kept; the recording is not stored anywhere.
      const { rows } = await db.execute(sql`select input_text from task_interpretations`);
      expect(rows).toEqual([{ input_text: SUITCASES }]);
    });

    it("accepts the web build's webm recordings", async () => {
      speech.heard = SUITCASES;
      await speak(asha, 'audio/webm;codecs=opus', 'task.webm').expect(200);
      expect(speech.received[0]!.mimeType).toBe('audio/webm');
    });

    it('refuses a file that is not a recording, or is too large', async () => {
      const wrong = await speak(asha, 'application/pdf', 'task.pdf').expect(400);
      expect(wrong.body).toMatchObject({ code: 'validation_failed', details: [{ path: 'audio' }] });
      await speak(asha, 'audio/mp4', 'long.m4a', Buffer.alloc(5 * 1024 * 1024 + 1)).expect(413);
      expect(speech.received).toEqual([]);
    });

    it('says so when nothing was said', async () => {
      speech.heard = 'um';
      const response = await speak(asha).expect(422);
      expect(response.body.code).toBe('speech_not_understood');
    });

    it('asks the customer to type when voice is switched off or the provider fails', async () => {
      speech.heard = new Error('provider timeout');
      expect((await speak(asha).expect(503)).body.code).toBe('speech_unavailable');
      speech.available = false;
      expect((await speak(asha).expect(503)).body.code).toBe('speech_unavailable');
    });

    it('hands back what was heard when the details cannot be written', async () => {
      speech.heard = SUITCASES;
      vi.spyOn(interpreter, 'interpret').mockRejectedValueOnce(new Error('provider timeout'));
      const response = await speak(asha).expect(503);
      expect(response.body).toMatchObject({ code: 'interpreter_unavailable', details: { text: SUITCASES } });
    });

    it('needs a signed-in customer', async () => {
      await http().post('/v1/tasks/interpret').attach('audio', Buffer.from('x'), 'task.m4a').expect(401);
    });
  });

  describe('POST /tasks', () => {
    it('posts an accepted interpretation and starts matching', async () => {
      const draft = await interpret(asha);
      const posted = await postTask(asha, taskBody({ interpretationId: draft.id })).expect(201);
      expect(posted.body).toMatchObject({
        title: 'Carry two suitcases',
        category: { slug: 'carry-luggage', provisional: false },
        customerPrice: 15000,
        paymentMethod: 'cash',
        helpersNeeded: 1,
        scheduleAt: null,
        status: 'matching',
        address: '14 Shanti Path, Sector 7, Mansarovar',
      });

      const events = await db.execute(
        sql`select from_status, to_status, actor_role from task_events order by created_at, to_status desc`,
      );
      expect(events.rows).toEqual([
        { from_status: null, to_status: 'posted', actor_role: 'customer' },
        { from_status: 'posted', to_status: 'matching', actor_role: 'system' },
      ]);
      const decisions = await db.execute(sql`select decision from task_interpretations`);
      expect(decisions.rows).toEqual([{ decision: 'accepted' }]);
    });

    it('stores the address encrypted and the location as a point', async () => {
      await postTask(asha, taskBody()).expect(201);
      const { rows } = await db.execute(
        sql`select address_enc, round(ST_Y(pickup_point::geometry)::numeric, 4)::float as lat,
                   round(ST_X(pickup_point::geometry)::numeric, 4)::float as lng,
                   description_raw, needs_review from tasks`,
      );
      expect(rows[0]).toMatchObject({ ...MANSAROVAR, description_raw: SUITCASES });
      expect(rows[0]!.address_enc).not.toContain('Shanti');
    });

    it('posts a typed task with no category, for an admin to review', async () => {
      const posted = await postTask(asha, taskBody()).expect(201);
      expect(posted.body).toMatchObject({ category: null, status: 'matching' });
      const { rows } = await db.execute(sql`select needs_review from tasks`);
      expect(rows).toEqual([{ needs_review: true }]);
    });

    it('saves a category the model proposed as provisional', async () => {
      vi.spyOn(interpreter, 'interpret').mockResolvedValueOnce({
        title: 'Walk my dog',
        description: 'Walk a friendly labrador around the park for half an hour.',
        categorySlug: null,
        proposedCategory: 'Pet care',
        requiresSkilled: false,
        helpersNeeded: 1,
        estimatedMinutes: { min: 30, max: 40 },
        requirements: ['Comfortable with large dogs'],
        riskFlags: [],
        followUpQuestion: null,
        confidence: 0.9,
      });
      const draft = await interpret(asha, 'Someone to walk my dog in the park this evening');
      expect(draft.category).toEqual({ slug: 'pet-care', name: 'Pet care', provisional: true });

      const posted = await postTask(asha, taskBody({ interpretationId: draft.id, title: draft.title })).expect(201);
      expect(posted.body.category).toEqual({ slug: 'pet-care', name: 'Pet care', provisional: true });
      const { rows } = await db.execute(
        sql`select source, review_status, active from task_categories where slug = 'pet-care'`,
      );
      expect(rows).toEqual([{ source: 'ai', review_status: 'pending', active: false }]);
    });

    it('lets an admin approve or merge a category the model proposed', async () => {
      const proposal = (name: string) => ({
        title: `Walk my dog ${name}`,
        description: 'Walk a friendly labrador around the park for half an hour.',
        categorySlug: null,
        proposedCategory: name,
        requiresSkilled: false,
        helpersNeeded: 1,
        estimatedMinutes: { min: 30, max: 40 },
        requirements: [],
        riskFlags: [],
        followUpQuestion: null,
        confidence: 0.9,
      });
      for (const name of ['Pet care', 'Dog walking']) {
        vi.spyOn(interpreter, 'interpret').mockResolvedValueOnce(proposal(name));
        const draft = await interpret(asha, `Someone to walk my dog, ${name}`);
        await postTask(asha, taskBody({ interpretationId: draft.id, title: draft.title })).expect(201);
      }
      const { totpSecret } = await app
        .get(AdminAuthService)
        .upsertAdmin('ops@sibimate.test', 'a long test password', 'operations');
      const admin = (
        await http()
          .post('/v1/admin/auth/login')
          .send({
            email: 'ops@sibimate.test',
            password: 'a long test password',
            code: totpCode(totpSecret, totpStep(new Date())),
          })
          .expect(200)
      ).body.token as string;
      const list = async () =>
        (await http().get('/v1/admin/categories').set('Authorization', `Bearer ${admin}`).expect(200)).body.items;
      const [first, second] = await list();
      expect([first.reviewStatus, second.reviewStatus, first.taskCount]).toEqual(['pending', 'pending', 1]);
      const petCare = [first, second].find((item: { slug: string }) => item.slug === 'pet-care');
      const dogWalking = [first, second].find((item: { slug: string }) => item.slug === 'dog-walking');

      await http()
        .post(`/v1/admin/categories/${petCare.id}/approve`)
        .set('Authorization', `Bearer ${admin}`)
        .send({ name: 'Pet care', requiresSkilled: false, minVerificationLevel: 'verified' })
        .expect(204);
      await http()
        .post(`/v1/admin/categories/${dogWalking.id}/merge`)
        .set('Authorization', `Bearer ${admin}`)
        .send({ intoId: petCare.id })
        .expect(204);
      const after = await list();
      expect(after.find((item: { id: string }) => item.id === petCare.id)).toMatchObject({
        active: true,
        reviewStatus: 'approved',
        taskCount: 2,
      });
      expect(after.find((item: { id: string }) => item.id === dogWalking.id)).toMatchObject({
        active: false,
        reviewStatus: 'rejected',
        taskCount: 0,
      });

      // The approved category is now offered to the model, and the merged one is not.
      const seen = vi.spyOn(interpreter, 'interpret');
      await interpret(asha);
      const slugs = seen.mock.calls.at(-1)![0].categories.map((category) => category.slug);
      expect(slugs).toContain('pet-care');
      expect(slugs).not.toContain('dog-walking');
    });

    it('returns the same task when a request is retried with its key', async () => {
      const key = randomUUID();
      const first = await postTask(asha, taskBody(), key).expect(201);
      const retry = await postTask(asha, taskBody(), key).expect(201);
      expect(retry.body.id).toBe(first.body.id);
      const { rows } = await db.execute(sql`select count(*)::int as tasks from tasks`);
      expect(rows).toEqual([{ tasks: 1 }]);
    });

    it('makes one task when the same request arrives twice at once', async () => {
      const key = randomUUID();
      const [a, b] = await Promise.all([postTask(asha, taskBody(), key), postTask(asha, taskBody(), key)]);
      expect(a.status).toBe(201);
      expect(b.body.id).toBe(a.body.id);
    });

    it('requires the Idempotency-Key header', async () => {
      const response = await as(asha).post('/tasks', taskBody()).expect(400);
      expect(response.body.details).toEqual([{ path: 'Idempotency-Key', message: expect.any(String) }]);
    });

    it.each([
      ['a price below one rupee', { customerPrice: 50 }, 'customerPrice'],
      ['a price that is not whole paise', { customerPrice: 150.5 }, 'customerPrice'],
      ['a location off the map', { pickup: { lat: 126, lng: 75 } }, 'pickup.lat'],
      ['no address', { address: '' }, 'address'],
      ['UPI, which is not available yet', { paymentMethod: 'upi' }, 'paymentMethod'],
      ['a time in the past', { scheduleAt: '2020-01-01T10:00:00Z' }, 'scheduleAt'],
    ])('refuses %s', async (_name, overrides, path) => {
      const response = await postTask(asha, taskBody(overrides)).expect(400);
      expect(response.body).toMatchObject({ code: 'validation_failed', details: [{ path }] });
    });

    it('accepts a scheduled time in the future', async () => {
      const scheduleAt = new Date(Date.now() + 86_400_000).toISOString();
      const posted = await postTask(asha, taskBody({ scheduleAt })).expect(201);
      expect(posted.body.scheduleAt).toBe(scheduleAt);
    });

    it('refuses an interpretation that belongs to someone else, or was blocked', async () => {
      const draft = await interpret(asha);
      const ravi = await signIn('+919812345678');
      await postTask(ravi, taskBody({ interpretationId: draft.id })).expect(400);

      await as(asha).post('/tasks/interpret', { text: 'I need someone to bring me drugs tonight' }).expect(422);
      const { rows } = await db.execute(sql`select id from task_interpretations where decision = 'blocked'`);
      await postTask(asha, taskBody({ interpretationId: rows[0]!.id })).expect(400);
    });
  });

  describe('reading and cancelling', () => {
    it('shows a task only to the customer who posted it', async () => {
      const posted = await postTask(asha, taskBody()).expect(201);
      const ravi = await signIn('+919812345678');
      await as(asha).get(`/tasks/${posted.body.id}`).expect(200);
      await as(ravi).get(`/tasks/${posted.body.id}`).expect(404);
      await as(ravi).post(`/tasks/${posted.body.id}/cancel`).expect(404);
      await as(asha).get('/tasks/not-a-uuid').expect(404);
      expect((await as(ravi).get('/tasks').expect(200)).body).toEqual({ items: [], nextCursor: null });
    });

    it('lists newest first, a page at a time', async () => {
      for (const title of ['First task', 'Second task', 'Third task']) {
        await postTask(asha, taskBody({ title })).expect(201);
      }
      const pageOne = (await as(asha).get('/tasks?limit=2').expect(200)).body;
      expect(pageOne.items.map((task: { title: string }) => task.title)).toEqual(['Third task', 'Second task']);
      expect(pageOne.nextCursor).toEqual(expect.any(String));

      const pageTwo = (await as(asha).get(`/tasks?limit=2&cursor=${pageOne.nextCursor}`).expect(200)).body;
      expect(pageTwo.items.map((task: { title: string }) => task.title)).toEqual(['First task']);
      expect(pageTwo.nextCursor).toBeNull();

      await as(asha).get('/tasks?cursor=nonsense').expect(400);
    });

    it('cancels a task before the work starts, once', async () => {
      const posted = await postTask(asha, taskBody()).expect(201);
      const cancelled = await as(asha).post(`/tasks/${posted.body.id}/cancel`).expect(200);
      expect(cancelled.body.status).toBe('cancelled');

      const again = await as(asha).post(`/tasks/${posted.body.id}/cancel`).expect(409);
      expect(again.body.code).toBe('invalid_transition');

      expect((await as(asha).get('/tasks?status=active').expect(200)).body.items).toEqual([]);
      expect((await as(asha).get('/tasks').expect(200)).body.items).toHaveLength(1);
    });

    it('does not cancel a task once the work is under way', async () => {
      const posted = await postTask(asha, taskBody()).expect(201);
      await db.execute(sql`update tasks set status = 'in_progress'`);
      await as(asha).post(`/tasks/${posted.body.id}/cancel`).expect(409);
    });
  });
});
