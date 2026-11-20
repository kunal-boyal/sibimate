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
import { MatchingService } from '../src/matching/matching.service.js';

class FakeSmsSender extends SmsSender {
  lastCode = '';
  async sendOtp(_phone: string, code: string) {
    this.lastCode = code;
  }
}

// The smallest files that start the way each image format does.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('a test photo, not a real one')]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('a test scan')]);
const HOME = { lat: 26.8505, lng: 75.7628 };
const APPLICATION = {
  name: 'Aman Singh',
  claimsSkilled: true,
  skills: ['plumbing'],
  emergencyContact: 'Ravi Singh, brother, 98290 00000',
  isAdult: true,
};

describe('From application to first task (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let sms: FakeSmsSender;
  let verifier: string;
  let operations: string;
  let applicant: string;
  let customer: string;

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

  async function admin(email: string, role: 'verifier' | 'operations' | 'owner') {
    const { totpSecret } = await app.get(AdminAuthService).upsertAdmin(email, 'a long test password', role);
    const login = await http()
      .post('/v1/admin/auth/login')
      .send({ email, password: 'a long test password', code: totpCode(totpSecret, totpStep(new Date())) })
      .expect(200);
    return login.body.token as string;
  }

  const upload = (token: string, kind: string, bytes = JPEG, type = 'image/jpeg') =>
    http()
      .post('/v1/helper/documents')
      .set('Authorization', `Bearer ${token}`)
      .field('kind', kind)
      .attach('file', bytes, { filename: 'photo', contentType: type });

  const applications = async () => (await as(verifier).get('/admin/applications').expect(200)).body.items;

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
    verifier = await admin('verifier@sibimate.test', 'verifier');
    operations = await admin('ops@sibimate.test', 'operations');
    applicant = await signIn('+919812345678');
    customer = await signIn('+919876543210');
  });

  afterAll(async () => {
    await app.close();
  });

  it('takes a new helper from application to a rated first task, with no manual database work', async () => {
    // Apply and upload documents.
    expect((await as(applicant).get('/helper/profile').expect(200)).body).toEqual({ profile: null });
    const applied = await as(applicant).post('/helper/profile', APPLICATION).expect(201);
    expect(applied.body).toMatchObject({
      status: 'pending',
      skillTag: 'unskilled',
      claimsSkilled: true,
      documents: [],
    });
    await as(applicant).get('/helper/tasks/nearby').expect(403);
    await upload(applicant, 'identity', PNG, 'image/png').expect(201);
    const withPhoto = await upload(applicant, 'photo').expect(201);
    expect(withPhoto.body.documents.map((document: { kind: string }) => document.kind)).toEqual(['identity', 'photo']);

    // The verifier sees the application and opens a document; the view is recorded.
    const [application] = await applications();
    expect(application).toMatchObject({
      phone: '+919812345678',
      name: 'Aman Singh',
      claimsSkilled: true,
      skills: ['plumbing'],
      emergencyContact: APPLICATION.emergencyContact,
    });
    const identity = application.documents.find((document: { kind: string }) => document.kind === 'identity');
    const image = await as(verifier).get(`/admin/documents/${identity.id}/file`).buffer(true).expect(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(image.body, PNG)).toBe(0);

    // Approval at the level the documents support.
    const tooHigh = await as(verifier)
      .post(`/admin/applications/${application.id}/approve`, { verificationLevel: 'specialised' })
      .expect(409);
    expect(tooHigh.body).toMatchObject({ code: 'documents_missing', details: { missing: ['qualification'] } });
    await as(verifier)
      .post(`/admin/applications/${application.id}/approve`, { verificationLevel: 'verified' })
      .expect(204);
    expect(await applications()).toEqual([]);
    expect((await as(applicant).get('/helper/profile').expect(200)).body.profile).toMatchObject({
      status: 'active',
      verificationLevel: 'verified',
      // No qualification was checked, so no skilled tag.
      skillTag: 'unskilled',
    });
    expect((await as(applicant).get('/me').expect(200)).body.roles.sort()).toEqual(['customer', 'helper']);

    // First task: found by matching, done, paid.
    await as(applicant).put('/helper/availability', { isOnline: true, location: HOME }).expect(200);
    const posted = await as(customer)
      .post('/tasks', {
        title: 'Carry two suitcases',
        description: 'Carry two suitcases from the station to my home.',
        requiresSkilled: false,
        customerPrice: 15000,
        pickup: HOME,
        address: '14 Shanti Path, Sector 7, Mansarovar',
        paymentMethod: 'cash',
      })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    const taskId = posted.body.id as string;
    await app.get(MatchingService).runRing(taskId, 0);
    const { body: taken } = await as(applicant).post(`/helper/tasks/${taskId}/accept`).expect(200);
    const task = async () => (await as(customer).get(`/tasks/${taskId}`).expect(200)).body;
    await as(applicant).post(`/bookings/${taken.bookingId}/en-route`).expect(200);
    await as(applicant)
      .post(`/bookings/${taken.bookingId}/start`, { code: (await task()).booking.startCode })
      .expect(200);
    await as(customer).post(`/bookings/${taken.bookingId}/review`, { rating: 5 }).expect(409);
    await as(applicant)
      .post(`/bookings/${taken.bookingId}/complete`, { code: (await task()).booking.completionCode })
      .expect(200);
    await as(applicant).post(`/bookings/${taken.bookingId}/payment/cash-received`).expect(200);

    // Both sides rate, once each.
    expect((await task()).booking.myRating).toBeNull();
    await as(customer)
      .post(`/bookings/${taken.bookingId}/review`, { rating: 4, comment: 'On time and careful.' })
      .expect(204);
    await as(customer).post(`/bookings/${taken.bookingId}/review`, { rating: 1 }).expect(409);
    await as(applicant).post(`/bookings/${taken.bookingId}/review`, { rating: 5 }).expect(204);
    await as(customer).post(`/bookings/${taken.bookingId}/review`, { rating: 9 }).expect(400);
    expect((await task()).booking.myRating).toBe(4);
    expect((await as(applicant).get(`/helper/bookings/${taken.bookingId}`).expect(200)).body.myRating).toBe(5);
    const [listed] = (await as(operations).get('/admin/helpers').expect(200)).body.items;
    expect(listed).toMatchObject({
      name: 'Aman Singh',
      status: 'active',
      completedCount: 1,
      rating: 4,
      ratingCount: 1,
    });

    // A stranger cannot rate someone else's job.
    await as(await signIn('+919811111111'))
      .post(`/bookings/${taken.bookingId}/review`, { rating: 1 })
      .expect(404);

    const audit = await db.execute(sql`select action, entity from audit_log order by created_at`);
    expect(audit.rows).toEqual([
      { action: 'document.view', entity: 'helper_document' },
      { action: 'helper.approve', entity: 'helper' },
    ]);
  });

  it('lets only owners and verifiers open documents and decide applications', async () => {
    await as(applicant).post('/helper/profile', APPLICATION).expect(201);
    await upload(applicant, 'identity').expect(201);
    const [application] = await applications();
    await as(operations).get(`/admin/documents/${application.documents[0].id}/file`).expect(403);
    await as(operations)
      .post(`/admin/applications/${application.id}/approve`, { verificationLevel: 'basic' })
      .expect(403);
    await as(applicant).get(`/admin/documents/${application.documents[0].id}/file`).expect(401);
    await http().get(`/v1/admin/documents/${application.documents[0].id}/file`).expect(401);
    const { rows } = await db.execute(sql`select count(*)::int as views from audit_log`);
    expect(rows).toEqual([{ views: 0 }]);
  });

  it('turns an application down with a reason, and lets the person apply again', async () => {
    await as(applicant).post('/helper/profile', APPLICATION).expect(201);
    await upload(applicant, 'identity').expect(201);
    const [application] = await applications();
    await as(verifier)
      .post(`/admin/applications/${application.id}/reject`, { reason: 'The ID photo is too blurred to read.' })
      .expect(204);
    expect((await as(applicant).get('/helper/profile').expect(200)).body.profile).toMatchObject({
      status: 'rejected',
      rejectionReason: 'The ID photo is too blurred to read.',
    });
    await as(verifier)
      .post(`/admin/applications/${application.id}/approve`, { verificationLevel: 'basic' })
      .expect(409);
    expect((await as(applicant).get('/me').expect(200)).body.roles).toEqual(['customer']);

    // A clearer photo replaces the old one, and the application is pending again.
    await upload(applicant, 'identity', PNG, 'image/png').expect(201);
    const again = await as(applicant).post('/helper/profile', APPLICATION).expect(201);
    expect(again.body).toMatchObject({ status: 'pending', rejectionReason: null });
    expect(again.body.documents).toHaveLength(1);
    await as(verifier)
      .post(`/admin/applications/${application.id}/approve`, { verificationLevel: 'basic' })
      .expect(204);
    await as(applicant).post('/helper/profile', APPLICATION).expect(409);
  });

  it('gives the skilled tag only with a checked qualification', async () => {
    await as(applicant).post('/helper/profile', APPLICATION).expect(201);
    for (const kind of ['identity', 'photo', 'qualification']) {
      await upload(applicant, kind).expect(201);
    }
    const [application] = await applications();
    await as(verifier)
      .post(`/admin/applications/${application.id}/approve`, { verificationLevel: 'specialised' })
      .expect(204);
    expect((await as(applicant).get('/helper/profile').expect(200)).body.profile).toMatchObject({
      skillTag: 'skilled',
      verificationLevel: 'specialised',
    });
  });

  it('checks what is uploaded', async () => {
    await upload(applicant, 'identity').expect(409);
    await as(applicant)
      .post('/helper/profile', { ...APPLICATION, isAdult: false })
      .expect(400);
    await as(applicant).post('/helper/profile', APPLICATION).expect(201);
    const notAnImage = await upload(applicant, 'identity', Buffer.from('%PDF-1.7 not an image'), 'image/jpeg').expect(
      400,
    );
    expect(notAnImage.body.details).toEqual([{ path: 'file', message: expect.any(String) }]);
    await upload(applicant, 'identity', JPEG, 'application/pdf').expect(400);
    await upload(applicant, 'passport').expect(400);
    await http().post('/v1/helper/documents').field('kind', 'identity').attach('file', JPEG, 'photo.jpg').expect(401);
    expect((await as(applicant).get('/helper/profile').expect(200)).body.profile.documents).toEqual([]);
  });

  describe('platform settings', () => {
    it('starts from the decided values, and lets owners and finance change them with a record', async () => {
      const owner = await admin('owner@sibimate.test', 'owner');
      expect((await as(operations).get('/admin/settings').expect(200)).body).toEqual({
        cancellationFee: 3000,
        cashDuesLimit: 50000,
        disputeWindowHours: 48,
        completionCodeWaitMinutes: 30,
        updatedAt: null,
        updatedBy: null,
      });

      await as(operations).put('/admin/settings', { cancellationFee: 5000 }).expect(403);
      await as(owner).put('/admin/settings', { cancellationFee: -1 }).expect(400);
      await as(owner).put('/admin/settings', {}).expect(400);
      await as(customer).put('/admin/settings', { cancellationFee: 5000 }).expect(401);

      const changed = await as(owner)
        .put('/admin/settings', { cancellationFee: 4000, disputeWindowHours: 48 })
        .expect(200);
      expect(changed.body).toMatchObject({
        cancellationFee: 4000,
        cashDuesLimit: 50000,
        disputeWindowHours: 48,
        updatedBy: 'owner@sibimate.test',
        updatedAt: expect.any(String),
      });
      const { rows } = await db.execute(sql`select action, meta from audit_log where action = 'settings.update'`);
      // Only the value that actually changed is recorded, with what it was before.
      expect(rows).toEqual([
        { action: 'settings.update', meta: { before: { cancellationFee: 3000 }, after: { cancellationFee: 4000 } } },
      ]);
    });
  });

  describe('privacy', () => {
    it('signs in only with consent to the privacy notice, and records which version', async () => {
      await http()
        .post('/v1/auth/otp/request')
        .send({ phone: '+919811111111', deviceId: 'device-consent' })
        .expect(200);
      const refused = await http()
        .post('/v1/auth/otp/verify')
        .send({ phone: '+919811111111', code: sms.lastCode, deviceId: 'device-consent' })
        .expect(400);
      expect(refused.body.details).toEqual([{ path: 'acceptedNotice', message: expect.any(String) }]);
      const { rows } = await db.execute(sql`select consent_version from users where phone = '+919876543210'`);
      expect(rows).toEqual([{ consent_version: '2026-11-20' }]);
    });

    it('deletes an account and the person’s details, but not while work is open', async () => {
      await as(applicant).post('/helper/profile', APPLICATION).expect(201);
      await upload(applicant, 'identity').expect(201);
      const [application] = await applications();
      await as(verifier)
        .post(`/admin/applications/${application.id}/approve`, { verificationLevel: 'basic' })
        .expect(204);
      await as(applicant).put('/helper/availability', { isOnline: true, location: HOME }).expect(200);
      const posted = await as(applicant)
        .post('/tasks', {
          title: 'Carry two suitcases',
          description: 'Call me on 98123 45678 when you reach the station.',
          requiresSkilled: false,
          customerPrice: 15000,
          pickup: HOME,
          address: '14 Shanti Path, Sector 7, Mansarovar',
          paymentMethod: 'cash',
        })
        .set('Idempotency-Key', randomUUID())
        .expect(201);

      const busy = await http().delete('/v1/me').set('Authorization', `Bearer ${applicant}`).expect(409);
      expect(busy.body.code).toBe('account_busy');
      await as(applicant).post(`/tasks/${posted.body.id}/cancel`).expect(200);
      await http().delete('/v1/me').set('Authorization', `Bearer ${applicant}`).expect(204);

      // Signed out everywhere, and the details are gone.
      await as(applicant).get('/me').expect(401);
      const { rows } = await db.execute(
        sql`select phone, name, status, deleted_at from users where phone like 'deleted:%'`,
      );
      expect(rows).toEqual([
        { phone: expect.stringMatching(/^deleted:/), name: null, status: 'deleted', deleted_at: expect.anything() },
      ]);
      const documents = await db.execute(sql`select count(*)::int as n from helper_documents`);
      expect(documents.rows).toEqual([{ n: 0 }]);
      const taskRow = await db.execute(sql`select description_raw from tasks where id = ${posted.body.id}`);
      expect(taskRow.rows).toEqual([{ description_raw: '' }]);
      expect((await as(verifier).get('/admin/helpers').expect(200)).body.items[0].status).toBe('paused');

      // The number can sign up again, as a new person.
      const fresh = await signIn('+919812345678');
      expect((await as(fresh).get('/helper/profile').expect(200)).body.profile).toBeNull();
    });
  });
});
