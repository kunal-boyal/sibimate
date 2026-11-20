import { z } from 'zod';
import { HELPER_STATUSES, SKILL_TAGS } from './bookings.js';
import { VERIFICATION_LEVELS, type VerificationLevel } from './tasks.js';

/** identity: a government photo ID. photo: a picture of the helper's face. qualification: proof of a trade. */
export const DOCUMENT_KINDS = ['identity', 'photo', 'qualification'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const;

export const DOCUMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const DOCUMENT_MAX_BYTES = 8 * 1024 * 1024;

/** The documents a helper must have uploaded to be approved at each level. */
export const DOCUMENTS_FOR_LEVEL: Record<VerificationLevel, readonly DocumentKind[]> = {
  basic: ['identity'],
  verified: ['identity', 'photo'],
  specialised: ['identity', 'photo', 'qualification'],
};

export const helperApplicationSchema = z.object({
  name: z.string().trim().min(2).max(80),
  /** Whether the helper has a trade. The skilled tag itself is given only when a verifier has checked proof. */
  claimsSkilled: z.boolean(),
  skills: z.array(z.string().trim().min(2).max(40)).max(10).default([]),
  /** Someone to call if something goes wrong on a job. */
  emergencyContact: z.string().trim().min(5).max(120),
  /** The helper confirms they are 18 or older. */
  isAdult: z.literal(true, 'You must be 18 or older to earn with Sibimate'),
});
export type HelperApplication = z.input<typeof helperApplicationSchema>;

const documentSchema = z.object({
  id: z.uuid(),
  kind: z.enum(DOCUMENT_KINDS),
  reviewStatus: z.enum(DOCUMENT_REVIEW_STATUSES),
});

/** A person's own helper application or profile. */
export const helperProfileSchema = z.object({
  status: z.enum(HELPER_STATUSES),
  skillTag: z.enum(SKILL_TAGS),
  claimsSkilled: z.boolean(),
  skills: z.array(z.string()),
  verificationLevel: z.enum(VERIFICATION_LEVELS),
  /** Why the application was turned down, in the verifier's words. */
  rejectionReason: z.string().nullable(),
  documents: z.array(documentSchema),
});
export type HelperProfile = z.infer<typeof helperProfileSchema>;

/** Null when the person has never applied. */
export const helperProfileResponseSchema = z.object({ profile: helperProfileSchema.nullable() });

export const uploadDocumentSchema = z.object({ kind: z.enum(DOCUMENT_KINDS) });

// Admin review

export const helperApplicationDetailSchema = z.object({
  id: z.uuid(),
  phone: z.string(),
  name: z.string().nullable(),
  status: z.enum(HELPER_STATUSES),
  claimsSkilled: z.boolean(),
  skills: z.array(z.string()),
  emergencyContact: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  appliedAt: z.string(),
  documents: z.array(documentSchema),
});
export type HelperApplicationDetail = z.infer<typeof helperApplicationDetailSchema>;

export const approveHelperSchema = z.object({ verificationLevel: z.enum(VERIFICATION_LEVELS) });
export type ApproveHelper = z.infer<typeof approveHelperSchema>;

export const rejectHelperSchema = z.object({ reason: z.string().trim().min(5).max(300) });
export type RejectHelper = z.infer<typeof rejectHelperSchema>;

// Ratings

export const createReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
});
export type CreateReview = z.infer<typeof createReviewSchema>;
