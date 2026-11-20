import { z } from 'zod';
import { TASK_STATUSES } from './task-state.js';

export const DISPUTE_STATUSES = ['open', 'resolved'] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

/** release: the helper is owed the agreed price. refund: the customer owes nothing. */
export const DISPUTE_RESOLUTIONS = ['release', 'refund'] as const;
export type DisputeResolution = (typeof DISPUTE_RESOLUTIONS)[number];

export const raiseDisputeSchema = z.object({
  reason: z.string().trim().min(10, 'Tell us a little more about what went wrong').max(500),
});
export type RaiseDispute = z.infer<typeof raiseDisputeSchema>;

export const resolveDisputeSchema = z.object({
  resolution: z.enum(DISPUTE_RESOLUTIONS),
  /** Shown to both sides. */
  note: z.string().trim().min(5).max(500),
});
export type ResolveDispute = z.infer<typeof resolveDisputeSchema>;

/** What each side sees of a dispute on their job. */
export const bookingDisputeSchema = z.object({
  status: z.enum(DISPUTE_STATUSES),
  raisedByMe: z.boolean(),
  resolution: z.enum(DISPUTE_RESOLUTIONS).nullable(),
  resolutionNote: z.string().nullable(),
});
export type BookingDispute = z.infer<typeof bookingDisputeSchema>;

export const adminDisputeSchema = z.object({
  id: z.uuid(),
  status: z.enum(DISPUTE_STATUSES),
  raisedBy: z.enum(['customer', 'helper']),
  reason: z.string(),
  /** The task's status when the dispute was raised. */
  previousStatus: z.enum(TASK_STATUSES),
  createdAt: z.string(),
  task: z.object({ id: z.uuid(), title: z.string(), address: z.string() }),
  agreedPrice: z.number().int(),
  paymentMethod: z.enum(['upi', 'cash']),
  customer: z.object({ name: z.string().nullable(), phone: z.string() }),
  helper: z.object({ name: z.string().nullable(), phone: z.string() }),
  resolution: z.enum(DISPUTE_RESOLUTIONS).nullable(),
  resolutionNote: z.string().nullable(),
});
export type AdminDispute = z.infer<typeof adminDisputeSchema>;

export const adminDisputeListSchema = z.object({ items: z.array(adminDisputeSchema) });

// Overview

export const adminOverviewSchema = z.object({
  today: z.object({
    posted: z.number().int(),
    paid: z.number().int(),
    /** Paise: the agreed prices of jobs paid today. */
    value: z.number().int(),
    commission: z.number().int(),
  }),
  now: z.object({
    lookingForHelper: z.number().int(),
    underWay: z.number().int(),
    expired: z.number().int(),
    helpersOnline: z.number().int(),
    applicationsWaiting: z.number().int(),
    openDisputes: z.number().int(),
  }),
  /** Tasks posted in the last 7 days that found a helper, out of those that finished looking. */
  fulfilment: z.object({ matched: z.number().int(), total: z.number().int() }),
  /** Tasks posted on each of the last 7 days, oldest first. */
  postedByDay: z.array(z.object({ day: z.string(), count: z.number().int() })),
});
export type AdminOverview = z.infer<typeof adminOverviewSchema>;
