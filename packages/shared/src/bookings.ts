import { z } from 'zod';
import { phoneSchema } from './phone.js';
import { TASK_STATUSES } from './task-state.js';
import { PAYMENT_METHODS, VERIFICATION_LEVELS, taskCategorySchema } from './tasks.js';

export const ADMIN_ROLES = ['owner', 'operations', 'verifier', 'finance'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const SKILL_TAGS = ['unskilled', 'skilled'] as const;
export type SkillTag = (typeof SKILL_TAGS)[number];

export const HELPER_STATUSES = ['pending', 'active', 'paused', 'rejected'] as const;
export type HelperStatus = (typeof HELPER_STATUSES)[number];

export const BOOKING_STATUSES = ['active', 'completed', 'cancelled'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Commission on a completed task, in hundredths of a percent: 1200 is 12%. Editable per category from milestone 3. */
export const DEFAULT_COMMISSION_BPS = 1200;

/** The customer reads these codes out to the helper at the door and when the job is done. */
export const BOOKING_CODE_LENGTH = 4;

export function commissionFor(pricePaise: number, bps: number): number {
  return Math.round((pricePaise * bps) / 10_000);
}

// Admin sign-in

export const adminLoginSchema = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(200),
  /** The 6-digit code from the admin's authenticator app. */
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app'),
});
export type AdminLogin = z.input<typeof adminLoginSchema>;

export const adminSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: z.enum(ADMIN_ROLES),
});
export type Admin = z.infer<typeof adminSchema>;

export const adminLoginResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
  admin: adminSchema,
});
export type AdminLoginResponse = z.infer<typeof adminLoginResponseSchema>;

// Helpers

export const createHelperSchema = z.object({
  phone: phoneSchema,
  name: z.string().trim().min(1).max(80),
  skillTag: z.enum(SKILL_TAGS),
  /** A skilled helper's trades, such as plumbing. */
  skills: z.array(z.string().trim().min(2).max(40)).max(10).default([]),
  verificationLevel: z.enum(VERIFICATION_LEVELS).default('verified'),
});
export type CreateHelper = z.input<typeof createHelperSchema>;

export const helperSchema = z.object({
  id: z.uuid(),
  phone: z.string(),
  name: z.string().nullable(),
  skillTag: z.enum(SKILL_TAGS),
  skills: z.array(z.string()),
  verificationLevel: z.enum(VERIFICATION_LEVELS),
  status: z.enum(HELPER_STATUSES),
  completedCount: z.number().int(),
  cancelledCount: z.number().int(),
  /** True while the helper has a booking under way. */
  busy: z.boolean(),
  /** The average of customers' ratings, from 1 to 5, or null before the first. */
  rating: z.number().nullable(),
  ratingCount: z.number().int(),
});
export type Helper = z.infer<typeof helperSchema>;

export const helperListSchema = z.object({ items: z.array(helperSchema) });
export type HelperList = z.infer<typeof helperListSchema>;

// Admin view of tasks

export const ADMIN_TASK_FILTERS = ['unassigned', 'active', 'all'] as const;

export const adminListTasksQuerySchema = z.object({
  status: z.enum(ADMIN_TASK_FILTERS).default('unassigned'),
});
export type AdminListTasksQuery = z.infer<typeof adminListTasksQuerySchema>;

export const adminTaskSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string(),
  category: taskCategorySchema.nullable(),
  requiresSkilled: z.boolean(),
  helpersNeeded: z.number().int(),
  customerPrice: z.number().int(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  scheduleAt: z.string().nullable(),
  /** How far the search for a helper reaches now, in metres. */
  searchRadiusM: z.number().int(),
  status: z.enum(TASK_STATUSES),
  needsReview: z.boolean(),
  createdAt: z.string(),
  customer: z.object({ name: z.string().nullable(), phone: z.string() }),
  address: z.string(),
  helper: z.object({ id: z.uuid(), name: z.string().nullable(), phone: z.string() }).nullable(),
});
export type AdminTask = z.infer<typeof adminTaskSchema>;

export const adminTaskListSchema = z.object({ items: z.array(adminTaskSchema) });
export type AdminTaskList = z.infer<typeof adminTaskListSchema>;

export const assignHelperSchema = z.object({ helperId: z.uuid() });
export type AssignHelper = z.infer<typeof assignHelperSchema>;

// Bookings

export const bookingCodeSchema = z.object({
  code: z.string().regex(new RegExp(`^\\d{${BOOKING_CODE_LENGTH}}$`), 'Enter the 4-digit code'),
});
export type BookingCode = z.infer<typeof bookingCodeSchema>;

/** What the helper sees of a task they have been given. */
export const helperBookingSchema = z.object({
  id: z.uuid(),
  status: z.enum(TASK_STATUSES),
  title: z.string(),
  description: z.string(),
  category: z.string().nullable(),
  helpersNeeded: z.number().int(),
  scheduleAt: z.string().nullable(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  agreedPrice: z.number().int(),
  commission: z.number().int(),
  /** What the helper keeps: the agreed price minus commission. */
  netAmount: z.number().int(),
  customer: z.object({ name: z.string().nullable(), phone: z.string() }),
  /** The exact address, released when the helper starts travelling. */
  address: z.string().nullable(),
  /** The rating this helper gave the customer, once they have. */
  myRating: z.number().int().nullable(),
  /**
   * Whether the helper can ask an admin to step in now: the customer has not given
   * the completion code within the wait, or within the dispute window after the job.
   */
  canDispute: z.boolean(),
  dispute: z
    .object({
      status: z.enum(['open', 'resolved']),
      raisedByMe: z.boolean(),
      resolution: z.enum(['release', 'refund']).nullable(),
      resolutionNote: z.string().nullable(),
    })
    .nullable(),
  createdAt: z.string(),
});
export type HelperBooking = z.infer<typeof helperBookingSchema>;

export const helperBookingListSchema = z.object({ items: z.array(helperBookingSchema) });
export type HelperBookingList = z.infer<typeof helperBookingListSchema>;

// Platform rules an owner can change from the dashboard. Each change is written to the audit log.

/** The values in force until an owner changes them, as decided on 20 November 2026. */
export const DEFAULT_PLATFORM_SETTINGS = {
  /** Paid to the helper when a customer cancels after the helper has set off. Paise. */
  cancellationFee: 3000,
  /** Unpaid commission from cash jobs above which a helper is shown only online-payment tasks. Paise. */
  cashDuesLimit: 50000,
  /** How long after a job either side can raise a dispute. */
  disputeWindowHours: 48,
  /** How long a helper waits for the completion code before an admin is alerted. */
  completionCodeWaitMinutes: 30,
} as const;

export const platformSettingsSchema = z.object({
  cancellationFee: z.number().int().min(0).max(100_000),
  cashDuesLimit: z.number().int().min(0).max(10_000_000),
  disputeWindowHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30),
  completionCodeWaitMinutes: z
    .number()
    .int()
    .min(5)
    .max(24 * 60),
});
export type PlatformSettings = z.infer<typeof platformSettingsSchema>;

/** A change to some of the settings. */
export const updatePlatformSettingsSchema = platformSettingsSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Send at least one setting');
export type UpdatePlatformSettings = z.infer<typeof updatePlatformSettingsSchema>;

export const platformSettingsResponseSchema = platformSettingsSchema.extend({
  updatedAt: z.string().nullable(),
  updatedBy: z.string().nullable(),
});
export type PlatformSettingsResponse = z.infer<typeof platformSettingsResponseSchema>;
