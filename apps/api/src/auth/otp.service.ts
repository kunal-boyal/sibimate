import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { OTP_LENGTH, type OtpRequestResponse } from '@sibimate/shared';
import { and, count, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { ApiException } from '../common/api-exception.js';
import { ENV, type Env } from '../config/env.js';
import type { Database } from '../db/db.js';
import { otpChallenges } from '../db/schema.js';
import { SmsSender } from './sms-sender.js';

export const OTP_RULES = {
  ttlSeconds: 5 * 60,
  resendSeconds: 30,
  maxAttempts: 5,
  maxPerPhonePerHour: 5,
  maxPerDevicePerHour: 10,
} as const;

const HOUR_MS = 60 * 60 * 1000;

@Injectable()
export class OtpService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly sms: SmsSender,
  ) {}

  async request(phone: string, deviceId: string): Promise<OtpRequestResponse> {
    const now = new Date();
    await this.checkRateLimits(phone, deviceId, now);

    const id = randomUUID();
    const code = randomInt(0, 10 ** OTP_LENGTH)
      .toString()
      .padStart(OTP_LENGTH, '0');
    await this.db.insert(otpChallenges).values({
      id,
      phone,
      deviceId,
      codeHash: this.hash(id, code),
      expiresAt: new Date(now.getTime() + OTP_RULES.ttlSeconds * 1000),
      createdAt: now,
    });
    // Old rows are only needed for the hourly limits.
    await this.db.delete(otpChallenges).where(lt(otpChallenges.createdAt, new Date(now.getTime() - 24 * HOUR_MS)));

    await this.sms.sendOtp(phone, code);
    return {
      expiresIn: OTP_RULES.ttlSeconds,
      resendIn: OTP_RULES.resendSeconds,
    };
  }

  /** Resolves when `code` is the latest code sent to `phone` on this device, and spends it. */
  async verify(phone: string, code: string, deviceId: string): Promise<void> {
    const now = new Date();
    const [challenge] = await this.db
      .select()
      .from(otpChallenges)
      .where(eq(otpChallenges.phone, phone))
      .orderBy(desc(otpChallenges.createdAt))
      .limit(1);

    if (!challenge || challenge.consumedAt || challenge.expiresAt <= now) {
      throw new ApiException(400, 'otp_expired', 'This code has expired. Request a new one.');
    }

    // Counted before the comparison, in one conditional statement, so parallel guesses cannot exceed the limit.
    const counted = await this.db
      .update(otpChallenges)
      .set({ attempts: sql`${otpChallenges.attempts} + 1` })
      .where(
        and(
          eq(otpChallenges.id, challenge.id),
          lt(otpChallenges.attempts, OTP_RULES.maxAttempts),
          isNull(otpChallenges.consumedAt),
        ),
      )
      .returning({ id: otpChallenges.id });
    if (counted.length === 0) {
      throw new ApiException(429, 'otp_too_many_attempts', 'Too many wrong codes. Request a new one.');
    }

    const expected = Buffer.from(challenge.codeHash, 'hex');
    const given = Buffer.from(this.hash(challenge.id, code), 'hex');
    if (challenge.deviceId !== deviceId || !timingSafeEqual(expected, given)) {
      throw new ApiException(400, 'otp_invalid', 'That code is not correct.');
    }

    // A code works once: of two correct submissions, one consumes the row.
    const consumed = await this.db
      .update(otpChallenges)
      .set({ consumedAt: now })
      .where(and(eq(otpChallenges.id, challenge.id), isNull(otpChallenges.consumedAt)))
      .returning({ id: otpChallenges.id });
    if (consumed.length === 0) {
      throw new ApiException(400, 'otp_expired', 'This code has expired. Request a new one.');
    }
  }

  private async checkRateLimits(phone: string, deviceId: string, now: Date) {
    const [latest] = await this.db
      .select({ createdAt: otpChallenges.createdAt })
      .from(otpChallenges)
      .where(eq(otpChallenges.phone, phone))
      .orderBy(desc(otpChallenges.createdAt))
      .limit(1);
    if (latest) {
      const waited = (now.getTime() - latest.createdAt.getTime()) / 1000;
      if (waited < OTP_RULES.resendSeconds) {
        throw tooMany(Math.ceil(OTP_RULES.resendSeconds - waited));
      }
    }

    const hourAgo = new Date(now.getTime() - HOUR_MS);
    const sentTo = (column: typeof otpChallenges.phone | typeof otpChallenges.deviceId, value: string) =>
      this.db
        .select({ sent: count() })
        .from(otpChallenges)
        .where(and(eq(column, value), gt(otpChallenges.createdAt, hourAgo)));

    const [[byPhone], [byDevice]] = await Promise.all([
      sentTo(otpChallenges.phone, phone),
      sentTo(otpChallenges.deviceId, deviceId),
    ]);
    if (byPhone!.sent >= OTP_RULES.maxPerPhonePerHour || byDevice!.sent >= OTP_RULES.maxPerDevicePerHour) {
      throw tooMany(HOUR_MS / 1000);
    }
  }

  private hash(challengeId: string, code: string): string {
    return createHmac('sha256', this.env.OTP_SECRET).update(`${challengeId}:${code}`).digest('hex');
  }
}

function tooMany(retryAfter: number) {
  return new ApiException(429, 'rate_limited', 'Too many codes requested. Try again later.', { retryAfter });
}
