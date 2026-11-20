import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import type { Admin, AdminLoginResponse, AdminRole } from '@sibimate/shared';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { ApiException } from '../common/api-exception.js';
import { open, seal } from '../common/secret-box.js';
import { ENV, type Env } from '../config/env.js';
import type { Database } from '../db/db.js';
import { type AdminUserRow, adminSessions, adminUsers } from '../db/schema.js';
import { hashPassword, verifyPassword } from './password.js';
import { generateTotpSecret, matchTotp, otpauthUri } from './totp.js';

export const ADMIN_LOGIN_RULES = { maxFailures: 5, lockMinutes: 15, sessionHours: 12 } as const;

// Checked when the email is unknown, so that answer takes as long as a wrong password.
const NO_SUCH_ADMIN = hashPassword(randomBytes(16).toString('hex'));

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const toAdmin = ({ id, email, role }: AdminUserRow): Admin => ({ id, email, role });

@Injectable()
export class AdminAuthService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async login(email: string, password: string, code: string): Promise<AdminLoginResponse> {
    const now = new Date();
    const [admin] = await this.db.select().from(adminUsers).where(eq(adminUsers.email, email));

    if (admin?.lockedUntil && admin.lockedUntil > now) {
      throw new ApiException(429, 'rate_limited', 'Too many failed sign-ins. Try again later.', {
        retryAfter: Math.ceil((admin.lockedUntil.getTime() - now.getTime()) / 1000),
      });
    }

    const passwordOk = await verifyPassword(password, admin?.passwordHash ?? (await NO_SUCH_ADMIN));
    const step = admin ? matchTotp(open(this.env.TOTP_KEY, admin.totpSecretEnc), code, now) : null;
    if (!admin || !passwordOk || step === null) {
      if (admin) {
        await this.countFailure(admin, now);
      }
      // One answer for every failure, so nothing reveals which part was wrong.
      throw failed();
    }

    // A code works once: of two sign-ins with the same code, one moves the step forward.
    const claimed = await this.db
      .update(adminUsers)
      .set({ totpLastStep: step, failedAttempts: 0, lockedUntil: null })
      .where(and(eq(adminUsers.id, admin.id), lt(adminUsers.totpLastStep, step)))
      .returning({ id: adminUsers.id });
    if (claimed.length === 0) {
      throw failed();
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + ADMIN_LOGIN_RULES.sessionHours * 3_600_000);
    await this.db.insert(adminSessions).values({ id: sha256(token), adminId: admin.id, expiresAt });
    await this.db.delete(adminSessions).where(lt(adminSessions.expiresAt, now));
    return { token, expiresAt: expiresAt.toISOString(), admin: toAdmin(admin) };
  }

  async logout(token: string): Promise<void> {
    await this.db.delete(adminSessions).where(eq(adminSessions.id, sha256(token)));
  }

  /** The admin a session token belongs to, if the session is still live. */
  async findBySession(token: string): Promise<Admin | undefined> {
    const [row] = await this.db
      .select({ admin: adminUsers })
      .from(adminSessions)
      .innerJoin(adminUsers, eq(adminSessions.adminId, adminUsers.id))
      .where(and(eq(adminSessions.id, sha256(token)), gt(adminSessions.expiresAt, new Date())));
    return row && toAdmin(row.admin);
  }

  /**
   * Creates an admin, or replaces the password and authenticator of an existing
   * one. Returns the address to add to an authenticator app. Used by the
   * command-line tools; there is no route for it.
   */
  async upsertAdmin(email: string, password: string, role: AdminRole, totpSecret = generateTotpSecret()) {
    const values = {
      email: email.toLowerCase(),
      passwordHash: await hashPassword(password),
      totpSecretEnc: seal(this.env.TOTP_KEY, totpSecret),
      role,
    };
    await this.db
      .insert(adminUsers)
      .values(values)
      .onConflictDoUpdate({
        target: adminUsers.email,
        set: { ...values, totpLastStep: 0, failedAttempts: 0, lockedUntil: null },
      });
    return { totpSecret, otpauthUri: otpauthUri(totpSecret, values.email) };
  }

  private async countFailure(admin: AdminUserRow, now: Date) {
    const lock = admin.failedAttempts + 1 >= ADMIN_LOGIN_RULES.maxFailures;
    await this.db
      .update(adminUsers)
      .set({
        failedAttempts: lock ? 0 : sql`${adminUsers.failedAttempts} + 1`,
        lockedUntil: lock ? new Date(now.getTime() + ADMIN_LOGIN_RULES.lockMinutes * 60_000) : admin.lockedUntil,
      })
      .where(eq(adminUsers.id, admin.id));
  }
}

function failed() {
  return new ApiException(401, 'admin_login_failed', 'The email, password or code is not correct.');
}
