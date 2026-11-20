// Drizzle tables. `pnpm db:generate` writes the migrations in ./drizzle from this file.
// Enums mirror the constants in @sibimate/shared, so the database rejects a value the code does not know.
import {
  ADMIN_ROLES,
  BOOKING_STATUSES,
  DISPUTE_RESOLUTIONS,
  DISPUTE_STATUSES,
  DOCUMENT_KINDS,
  DOCUMENT_REVIEW_STATUSES,
  HELPER_RADIUS_DEFAULT_M,
  HELPER_STATUSES,
  OFFER_STATUSES,
  SKILL_TAGS,
  type GeoPoint,
  type InterpreterOutput,
  LANGUAGES,
  PAYMENT_METHODS,
  RISK_LEVELS,
  TASK_ACTORS,
  TASK_STATUSES,
  USER_ROLES,
  USER_STATUSES,
  VERIFICATION_LEVELS,
} from '@sibimate/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

const timestamps = {
  createdAt: at('created_at').notNull().defaultNow(),
  updatedAt: at('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const languageEnum = pgEnum('language', LANGUAGES);
export const userRoleEnum = pgEnum('user_role', USER_ROLES);
export const userStatusEnum = pgEnum('user_status', USER_STATUSES);

/** One account per phone. Everyone is a customer; the helper role is added on approval. */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  phone: text('phone').notNull().unique(),
  name: text('name'),
  language: languageEnum('language').notNull().default('en'),
  roles: userRoleEnum('roles')
    .array()
    .notNull()
    .default(sql`ARRAY['customer']::user_role[]`),
  status: userStatusEnum('status').notNull().default('active'),
  /** The privacy notice version the person last agreed to, and when. */
  consentVersion: text('consent_version'),
  consentedAt: at('consented_at'),
  /** When the person deleted their account. Their details are removed at that moment. */
  deletedAt: at('deleted_at'),
  ...timestamps,
});

export type UserRow = typeof users.$inferSelect;

/** One row per code sent. Only a keyed hash of the code is stored. */
export const otpChallenges = pgTable(
  'otp_challenges',
  {
    id: uuid('id').primaryKey(),
    phone: text('phone').notNull(),
    deviceId: text('device_id').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: at('expires_at').notNull(),
    consumedAt: at('consumed_at'),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('otp_challenges_phone_created_at_idx').on(table.phone, table.createdAt),
    index('otp_challenges_device_created_at_idx').on(table.deviceId, table.createdAt),
  ],
);

/** Refresh tokens kept for @nestjs/authentication, stored by their SHA-256. */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: at('created_at').notNull(),
    expiresAt: at('expires_at').notNull(),
    familyExpiresAt: at('family_expires_at').notNull(),
    usedAt: at('used_at'),
    // A family is revoked when any of its tokens is: that covers a successor saved after the revocation.
    revoked: boolean('revoked').notNull().default(false),
    claims: jsonb('claims').$type<Record<string, unknown>>(),
  },
  (table) => [
    index('refresh_tokens_family_id_idx').on(table.familyId),
    index('refresh_tokens_user_id_idx').on(table.userId),
    index('refresh_tokens_family_expires_at_idx').on(table.familyExpiresAt),
  ],
);

/**
 * A PostGIS geography point. Written from { lat, lng }; read it back with
 * ST_Y and ST_X in the query rather than selecting the column.
 */
const geographyPoint = customType<{ data: GeoPoint; driverData: unknown }>({
  dataType: () => 'geography(Point, 4326)',
  toDriver: ({ lat, lng }) => sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`,
});

export const verificationLevelEnum = pgEnum('verification_level', VERIFICATION_LEVELS);
export const riskLevelEnum = pgEnum('risk_level', RISK_LEVELS);
export const categorySourceEnum = pgEnum('category_source', ['seed', 'ai', 'admin']);
export const categoryReviewStatusEnum = pgEnum('category_review_status', ['approved', 'pending', 'rejected']);
export const taskStatusEnum = pgEnum('task_status', TASK_STATUSES);
export const taskActorEnum = pgEnum('task_actor', TASK_ACTORS);
export const paymentMethodEnum = pgEnum('payment_method', PAYMENT_METHODS);
export const interpretationDecisionEnum = pgEnum('interpretation_decision', ['accepted', 'blocked']);

/** The list AI assigns from. AI can propose a new category, which an admin approves or merges. */
export const taskCategories = pgTable('task_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  requiresSkilled: boolean('requires_skilled').notNull().default(false),
  /** The trade a skilled category needs, such as plumbing. */
  skill: text('skill'),
  source: categorySourceEnum('source').notNull().default('seed'),
  reviewStatus: categoryReviewStatusEnum('review_status').notNull().default('approved'),
  riskLevel: riskLevelEnum('risk_level').notNull().default('low'),
  minVerificationLevel: verificationLevelEnum('min_verification_level').notNull().default('verified'),
  /** Only active categories are offered to the model. */
  active: boolean('active').notNull().default(true),
  ...timestamps,
});

export type TaskCategoryRow = typeof taskCategories.$inferSelect;

/** What the customer said, what the model wrote, and what the customer decided, kept to improve the prompts. */
export const taskInterpretations = pgTable(
  'task_interpretations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    inputText: text('input_text').notNull(),
    output: jsonb('output').$type<InterpreterOutput>().notNull(),
    provider: text('provider').notNull(),
    /** Null until the customer posts a task from it; an interpretation never accepted was rejected or abandoned. */
    decision: interpretationDecisionEnum('decision'),
    needsReview: boolean('needs_review').notNull().default(false),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (table) => [index('task_interpretations_customer_id_idx').on(table.customerId)],
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => users.id),
    /** Null when no interpretation was used; an admin assigns it. */
    categoryId: uuid('category_id').references(() => taskCategories.id),
    interpretationId: uuid('interpretation_id').references(() => taskInterpretations.id),
    title: text('title').notNull(),
    descriptionRaw: text('description_raw').notNull(),
    descriptionRefined: text('description_refined').notNull(),
    requiresSkilled: boolean('requires_skilled').notNull(),
    details: jsonb('details').$type<{ estimatedMinutes?: { min: number; max: number }; requirements?: string[] }>(),
    pickupPoint: geographyPoint('pickup_point').notNull(),
    dropPoint: geographyPoint('drop_point'),
    /** The exact address, encrypted. Released to the helper only after confirmation. */
    addressEnc: text('address_enc').notNull(),
    scheduleAt: at('schedule_at'),
    /** Paise. */
    customerPrice: integer('customer_price').notNull(),
    searchRadiusM: integer('search_radius_m').notNull().default(2000),
    helpersNeeded: integer('helpers_needed').notNull().default(1),
    paymentMethod: paymentMethodEnum('payment_method').notNull(),
    status: taskStatusEnum('status').notNull(),
    /** Low confidence, a risk flag, a provisional category or no category at all. */
    needsReview: boolean('needs_review').notNull().default(false),
    idempotencyKey: text('idempotency_key').notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('tasks_customer_idempotency_key_idx').on(table.customerId, table.idempotencyKey),
    index('tasks_customer_created_at_idx').on(table.customerId, table.createdAt),
    index('tasks_status_idx').on(table.status),
    index('tasks_pickup_point_idx').using('gist', table.pickupPoint),
  ],
);

export type TaskRow = typeof tasks.$inferSelect;

/** Append-only history of every status change. */
export const taskEvents = pgTable(
  'task_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    /** Null for the event that creates the task. */
    fromStatus: taskStatusEnum('from_status'),
    toStatus: taskStatusEnum('to_status').notNull(),
    /** Null when the system made the move. */
    actorId: uuid('actor_id'),
    actorRole: taskActorEnum('actor_role').notNull(),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (table) => [index('task_events_task_id_idx').on(table.taskId, table.createdAt)],
);

export const adminRoleEnum = pgEnum('admin_role', ADMIN_ROLES);
export const skillTagEnum = pgEnum('skill_tag', SKILL_TAGS);
export const helperStatusEnum = pgEnum('helper_status', HELPER_STATUSES);
export const bookingStatusEnum = pgEnum('booking_status', BOOKING_STATUSES);

/** Dashboard accounts, separate from app users. */
export const adminUsers = pgTable('admin_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  /** The authenticator secret, encrypted. */
  totpSecretEnc: text('totp_secret_enc').notNull(),
  /** The last 30-second step a code was accepted for, so a code works once. */
  totpLastStep: integer('totp_last_step').notNull().default(0),
  role: adminRoleEnum('role').notNull(),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockedUntil: at('locked_until'),
  ...timestamps,
});

export type AdminUserRow = typeof adminUsers.$inferSelect;

/** Dashboard sign-ins, stored by the SHA-256 of their token. */
export const adminSessions = pgTable('admin_sessions', {
  id: text('id').primaryKey(),
  adminId: uuid('admin_id')
    .notNull()
    .references(() => adminUsers.id, { onDelete: 'cascade' }),
  expiresAt: at('expires_at').notNull(),
  createdAt: at('created_at').notNull().defaultNow(),
});

export const helperProfiles = pgTable('helper_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  skillTag: skillTagEnum('skill_tag').notNull().default('unskilled'),
  /** A skilled helper's trades. */
  skills: text('skills')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  verificationLevel: verificationLevelEnum('verification_level').notNull().default('basic'),
  status: helperStatusEnum('status').notNull().default('pending'),
  completedCount: integer('completed_count').notNull().default(0),
  cancelledCount: integer('cancelled_count').notNull().default(0),
  /** Whether the helper says they have a trade. The skilled tag is granted separately, on proof. */
  claimsSkilled: boolean('claims_skilled').notNull().default(false),
  emergencyContact: text('emergency_contact'),
  rejectionReason: text('rejection_reason'),
  /** The sum and count of customers' ratings; the average is their ratio. */
  ratingSum: integer('rating_sum').notNull().default(0),
  ratingCount: integer('rating_count').notNull().default(0),
  ...timestamps,
});

export type HelperProfileRow = typeof helperProfiles.$inferSelect;

/** Created when a helper is confirmed on a task. The commission rate in force is copied here. */
export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    helperId: uuid('helper_id')
      .notNull()
      .references(() => helperProfiles.id),
    /** Paise. */
    agreedPrice: integer('agreed_price').notNull(),
    /** Hundredths of a percent: 1200 is 12%. */
    commissionBps: integer('commission_bps').notNull(),
    commission: integer('commission').notNull(),
    status: bookingStatusEnum('status').notNull().default('active'),
    /** Wrong start or completion codes entered in a row. */
    codeAttempts: integer('code_attempts').notNull().default(0),
    codeLockedUntil: at('code_locked_until'),
    startedAt: at('started_at'),
    completedAt: at('completed_at'),
    paidAt: at('paid_at'),
    ...timestamps,
  },
  (table) => [
    // The database itself refuses a second helper on a task, or a second job for a busy helper.
    uniqueIndex('bookings_one_active_per_task_idx')
      .on(table.taskId)
      .where(sql`${table.status} = 'active'`),
    uniqueIndex('bookings_one_active_per_helper_idx')
      .on(table.helperId)
      .where(sql`${table.status} = 'active'`),
    index('bookings_helper_created_at_idx').on(table.helperId, table.createdAt),
  ],
);

export type BookingRow = typeof bookings.$inferSelect;

export const offerStatusEnum = pgEnum('offer_status', OFFER_STATUSES);

/** One row per helper, updated while they are online. Only the latest location is kept. */
export const helperAvailability = pgTable(
  'helper_availability',
  {
    helperId: uuid('helper_id')
      .primaryKey()
      .references(() => helperProfiles.id, { onDelete: 'cascade' }),
    isOnline: boolean('is_online').notNull().default(false),
    lastLocation: geographyPoint('last_location'),
    /** How far the helper is willing to travel. */
    radiusM: integer('radius_m').notNull().default(HELPER_RADIUS_DEFAULT_M),
    /** When the app last reported in. A helper not heard from recently is treated as offline. */
    seenAt: at('seen_at').notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [index('helper_availability_location_idx').using('gist', table.lastLocation)],
);

/** One row per helper shown a task. It holds the helper's own price when they quote one. */
export const taskOffers = pgTable(
  'task_offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    helperId: uuid('helper_id')
      .notNull()
      .references(() => helperProfiles.id, { onDelete: 'cascade' }),
    /** The search ring that found this helper, from 0. */
    ring: integer('ring').notNull(),
    status: offerStatusEnum('status').notNull().default('notified'),
    /** Paise. Null until the helper makes an offer. */
    price: integer('price'),
    etaMin: integer('eta_min'),
    /** Metres from the helper to the pickup point when they were notified. */
    distanceM: integer('distance_m'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('task_offers_task_helper_idx').on(table.taskId, table.helperId),
    index('task_offers_helper_status_idx').on(table.helperId, table.status),
  ],
);

export type TaskOfferRow = typeof taskOffers.$inferSelect;

export const documentKindEnum = pgEnum('document_kind', DOCUMENT_KINDS);
export const documentReviewStatusEnum = pgEnum('document_review_status', DOCUMENT_REVIEW_STATUSES);

/** The image stays in private storage; only its key is here. No identity number is stored. */
export const helperDocuments = pgTable(
  'helper_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    helperId: uuid('helper_id')
      .notNull()
      .references(() => helperProfiles.id, { onDelete: 'cascade' }),
    kind: documentKindEnum('kind').notNull(),
    storageKey: text('storage_key').notNull(),
    contentType: text('content_type').notNull(),
    reviewStatus: documentReviewStatusEnum('review_status').notNull().default('pending'),
    reviewedBy: uuid('reviewed_by').references(() => adminUsers.id),
    ...timestamps,
  },
  // A new upload of the same kind replaces the old one.
  (table) => [uniqueIndex('helper_documents_helper_kind_idx').on(table.helperId, table.kind)],
);

/** Every admin write and every document view. Rows are only ever added. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => adminUsers.id),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (table) => [index('audit_log_created_at_idx').on(table.createdAt)],
);

/** Both sides rate each other after a job is paid. */
export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rating: integer('rating').notNull(),
    comment: text('comment'),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('reviews_booking_author_idx').on(table.bookingId, table.authorId),
    index('reviews_subject_idx').on(table.subjectId),
  ],
);

/** The platform's editable rules: a single row, id 1. Without it, DEFAULT_PLATFORM_SETTINGS apply. */
export const platformSettings = pgTable('platform_settings', {
  id: integer('id').primaryKey().default(1),
  cancellationFee: integer('cancellation_fee').notNull(),
  cashDuesLimit: integer('cash_dues_limit').notNull(),
  disputeWindowHours: integer('dispute_window_hours').notNull(),
  completionCodeWaitMinutes: integer('completion_code_wait_minutes').notNull(),
  updatedBy: uuid('updated_by').references(() => adminUsers.id),
  updatedAt: at('updated_at').notNull().defaultNow(),
});

export const disputeStatusEnum = pgEnum('dispute_status', DISPUTE_STATUSES);
export const disputeResolutionEnum = pgEnum('dispute_resolution', DISPUTE_RESOLUTIONS);

/** A problem with a job, raised by either side and decided by an admin. */
export const disputes = pgTable(
  'disputes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    raisedBy: uuid('raised_by')
      .notNull()
      .references(() => users.id),
    raisedByRole: taskActorEnum('raised_by_role').notNull(),
    reason: text('reason').notNull(),
    /** The task's status before it became disputed. */
    previousStatus: taskStatusEnum('previous_status').notNull(),
    status: disputeStatusEnum('status').notNull().default('open'),
    resolution: disputeResolutionEnum('resolution'),
    resolutionNote: text('resolution_note'),
    resolvedBy: uuid('resolved_by').references(() => adminUsers.id),
    resolvedAt: at('resolved_at'),
    ...timestamps,
  },
  // One dispute per job.
  (table) => [uniqueIndex('disputes_booking_idx').on(table.bookingId)],
);
