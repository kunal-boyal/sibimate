import { z } from 'zod';
import { phoneSchema } from './phone.js';

export const LANGUAGES = ['en', 'hi'] as const;
export type Language = (typeof LANGUAGES)[number];

export const USER_ROLES = ['customer', 'helper'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ['active', 'blocked', 'deleted'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const OTP_LENGTH = 6;

/** An id the app generates on first launch and keeps; sessions are tied to it. */
const deviceIdSchema = z.string().min(8).max(128);

export const otpRequestSchema = z.object({
  phone: phoneSchema,
  deviceId: deviceIdSchema,
});
export type OtpRequest = z.infer<typeof otpRequestSchema>;

export const otpRequestResponseSchema = z.object({
  /** Seconds until the code stops working. */
  expiresIn: z.number().int().positive(),
  /** Seconds until another code can be requested for this number. */
  resendIn: z.number().int().nonnegative(),
});
export type OtpRequestResponse = z.infer<typeof otpRequestResponseSchema>;

export const otpVerifySchema = z.object({
  phone: phoneSchema,
  code: z.string().regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), 'Enter the 6-digit code'),
  deviceId: deviceIdSchema,
});
export type OtpVerify = z.infer<typeof otpVerifySchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
  deviceId: deviceIdSchema,
});
export type RefreshRequest = z.infer<typeof refreshSchema>;

export const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});
export type LogoutRequest = z.infer<typeof logoutSchema>;

export const tokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  /** Lifetime of the access token in seconds. */
  expiresIn: z.number(),
});
export type TokenPair = z.infer<typeof tokenPairSchema>;

export const userSchema = z.object({
  id: z.uuid(),
  phone: z.string(),
  name: z.string().nullable(),
  language: z.enum(LANGUAGES),
  roles: z.array(z.enum(USER_ROLES)),
  status: z.enum(USER_STATUSES),
});
export type User = z.infer<typeof userSchema>;

export const otpVerifyResponseSchema = tokenPairSchema.extend({
  user: userSchema,
  /** True when this sign-in created the account. */
  isNewUser: z.boolean(),
});
export type OtpVerifyResponse = z.infer<typeof otpVerifyResponseSchema>;

export const updateMeSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    language: z.enum(LANGUAGES),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Send at least one field');
export type UpdateMe = z.infer<typeof updateMeSchema>;
