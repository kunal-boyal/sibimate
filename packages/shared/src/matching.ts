import { z } from 'zod';
import { SKILL_TAGS } from './bookings.js';
import { PAYMENT_METHODS } from './tasks.js';

/**
 * The search rings: how far to look for helpers, and how long to wait for one
 * to take the task before widening. After the last ring the task expires.
 * These are the starting values from the strategy plan.
 */
export const MATCHING_RINGS = [
  { radiusM: 2000, waitSeconds: 120 },
  { radiusM: 5000, waitSeconds: 180 },
  { radiusM: 8000, waitSeconds: 180 },
] as const;

/** Helpers notified in each ring. */
export const MATCHING_NOTIFY_LIMIT = 10;
/** A helper counts as online only if the app has been heard from this recently. */
export const HELPER_SEEN_SECONDS = 5 * 60;
/** How often the app reports a helper's location while they are online. */
export const HELPER_LOCATION_INTERVAL_SECONDS = 60;

export const HELPER_RADIUS_DEFAULT_M = 5000;
export const HELPER_RADIUS_MAX_M = 15_000;

/**
 * notified: the helper has been shown the task. quoted: they named a price, or
 * offered to do a skilled job at the customer's price. accepted: they got the
 * job. declined: they passed. withdrawn: they were confirmed on another task.
 * expired: someone else got the job, or the task ended.
 */
export const OFFER_STATUSES = ['notified', 'quoted', 'accepted', 'declined', 'withdrawn', 'expired'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

const pointSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const priceSchema = z.number().int().min(100).max(1_000_000_00);

// Helper availability

export const setAvailabilitySchema = z.object({
  isOnline: z.boolean(),
  /** How far the helper is willing to travel. */
  radiusM: z.number().int().min(500).max(HELPER_RADIUS_MAX_M).optional(),
  /** Needed to go online, so the first search can already find the helper. */
  location: pointSchema.optional(),
});
export type SetAvailability = z.infer<typeof setAvailabilitySchema>;

export const helperLocationSchema = pointSchema;

export const availabilitySchema = z.object({
  isOnline: z.boolean(),
  radiusM: z.number().int(),
});
export type Availability = z.infer<typeof availabilitySchema>;

// What a helper sees of a task they can take

export const nearbyTaskSchema = z.object({
  /** The task's id. */
  id: z.uuid(),
  title: z.string(),
  description: z.string(),
  category: z.string().nullable(),
  requiresSkilled: z.boolean(),
  helpersNeeded: z.number().int(),
  scheduleAt: z.string().nullable(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  /** How far the pickup point is from the helper, in metres. The exact address is not shown. */
  distanceM: z.number().int(),
  customerPrice: z.number().int(),
  /** What the helper would keep at the customer's price. */
  netAtCustomerPrice: z.number().int(),
  /** Hundredths of a percent. */
  commissionBps: z.number().int(),
  /**
   * True when accepting gives the helper the job at once. For skilled jobs the
   * customer always chooses, so accepting sends an offer at the customer's price.
   */
  instant: z.boolean(),
  /** The helper's own offer, once they have made one. */
  myOffer: z.object({ price: z.number().int(), etaMin: z.number().int().nullable() }).nullable(),
  createdAt: z.string(),
});
export type NearbyTask = z.infer<typeof nearbyTaskSchema>;

export const nearbyTaskListSchema = z.object({ items: z.array(nearbyTaskSchema) });
export type NearbyTaskList = z.infer<typeof nearbyTaskListSchema>;

export const quoteSchema = z.object({
  /** The helper's own price, in paise. */
  price: priceSchema,
  /** Minutes until the helper can arrive. */
  etaMin: z.number().int().min(1).max(600).optional(),
});
export type Quote = z.infer<typeof quoteSchema>;

/** What accepting or quoting led to. */
export const offerResultSchema = z.object({
  /** `assigned`: the job is yours. `offered`: the customer will choose. */
  outcome: z.enum(['assigned', 'offered']),
  /** The booking to open, when the job was assigned. */
  bookingId: z.uuid().nullable(),
});
export type OfferResult = z.infer<typeof offerResultSchema>;

// What the customer sees of helpers' offers

export const taskOfferSchema = z.object({
  id: z.uuid(),
  helper: z.object({
    name: z.string().nullable(),
    skillTag: z.enum(SKILL_TAGS),
    completedCount: z.number().int(),
    rating: z.number().nullable(),
  }),
  price: z.number().int(),
  etaMin: z.number().int().nullable(),
  distanceM: z.number().int().nullable(),
});
export type TaskOffer = z.infer<typeof taskOfferSchema>;

export const taskOfferListSchema = z.object({ items: z.array(taskOfferSchema) });
export type TaskOfferList = z.infer<typeof taskOfferListSchema>;

/** Posting an expired task again, optionally at a higher price. */
export const retryTaskSchema = z.object({ customerPrice: priceSchema.optional() });
export type RetryTask = z.infer<typeof retryTaskSchema>;
