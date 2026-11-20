import { z } from 'zod';
import { TASK_STATUSES } from './task-state.js';

export const VERIFICATION_LEVELS = ['basic', 'verified', 'specialised'] as const;
export type VerificationLevel = (typeof VERIFICATION_LEVELS)[number];

export const RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/** Version 1 of milestone 1 is cash only; `upi` arrives with payments in milestone 3. */
export const PAYMENT_METHODS = ['upi', 'cash'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** What the model may flag. `illegal` and `unsafe` block the request; the others send it to admin review. */
export const RISK_FLAGS = ['illegal', 'unsafe', 'medical', 'valuables', 'unclear'] as const;
export type RiskFlag = (typeof RISK_FLAGS)[number];
export const BLOCKING_RISK_FLAGS: readonly RiskFlag[] = ['illegal', 'unsafe'];

export const TASK_TEXT_MAX = 1000;

export const interpretRequestSchema = z.object({
  /** What the customer typed, or later the transcript of what they said. */
  text: z.string().trim().min(5, 'Say a little more about the task').max(TASK_TEXT_MAX),
});
export type InterpretRequest = z.infer<typeof interpretRequestSchema>;

const minutesRangeSchema = z
  .object({
    min: z
      .number()
      .int()
      .min(5)
      .max(24 * 60),
    max: z
      .number()
      .int()
      .min(5)
      .max(24 * 60),
  })
  .refine((range) => range.max >= range.min, 'max must not be below min');

/**
 * What a TaskInterpreter must return. The API validates every model answer
 * against this before anything reaches the customer.
 */
export const interpreterOutputSchema = z.object({
  title: z.string().trim().min(3).max(80),
  description: z.string().trim().min(10).max(600),
  /** A slug from the list the interpreter was given, or null when nothing fits. */
  categorySlug: z.string().nullable(),
  /** A name for a new category, only when categorySlug is null. */
  proposedCategory: z.string().trim().min(3).max(40).nullable(),
  requiresSkilled: z.boolean(),
  helpersNeeded: z.number().int().min(1).max(10),
  estimatedMinutes: minutesRangeSchema,
  requirements: z.array(z.string().trim().min(2).max(120)).max(6),
  riskFlags: z.array(z.enum(RISK_FLAGS)),
  /** One question, when a key detail is missing. */
  followUpQuestion: z.string().trim().max(200).nullable(),
  confidence: z.number().min(0).max(1),
});
export type InterpreterOutput = z.infer<typeof interpreterOutputSchema>;

export const taskCategorySchema = z.object({
  slug: z.string(),
  name: z.string(),
  /** True for a category the model proposed that an admin has not approved yet. */
  provisional: z.boolean(),
});
export type TaskCategory = z.infer<typeof taskCategorySchema>;

/** The AI-written task details the customer accepts or rejects. */
export const taskInterpretationSchema = z.object({
  id: z.uuid(),
  /** What the customer typed, or what was heard in their recording. */
  inputText: z.string(),
  title: z.string(),
  description: z.string(),
  category: taskCategorySchema,
  requiresSkilled: z.boolean(),
  helpersNeeded: z.number().int(),
  estimatedMinutes: minutesRangeSchema,
  requirements: z.array(z.string()),
  followUpQuestion: z.string().nullable(),
});
export type TaskInterpretation = z.infer<typeof taskInterpretationSchema>;

const pointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type GeoPoint = z.infer<typeof pointSchema>;

/** Prices are whole paise. The platform sets no price limits beyond a sane ceiling of ₹10 lakh. */
const priceSchema = z.number().int().min(100).max(1_000_000_00);

export const createTaskSchema = z.object({
  /** The interpretation the customer accepted. Without one, an admin assigns the category. */
  interpretationId: z.uuid().optional(),
  title: z.string().trim().min(3).max(80),
  description: z.string().trim().min(5).max(TASK_TEXT_MAX),
  requiresSkilled: z.boolean(),
  helpersNeeded: z.number().int().min(1).max(10).default(1),
  customerPrice: priceSchema,
  /** Where the helper should come, from the phone's location. */
  pickup: pointSchema,
  /** The exact address. Stored encrypted and shown to the helper only after confirmation. */
  address: z.string().trim().min(5).max(300),
  /** Null or absent for right now. */
  scheduleAt: z.iso.datetime().nullish(),
  paymentMethod: z.enum(PAYMENT_METHODS),
});
export type CreateTask = z.input<typeof createTaskSchema>;

export const taskSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string(),
  category: taskCategorySchema.nullable(),
  requiresSkilled: z.boolean(),
  helpersNeeded: z.number().int(),
  customerPrice: z.number().int(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  scheduleAt: z.string().nullable(),
  status: z.enum(TASK_STATUSES),
  /** Only ever sent to the customer who posted the task. */
  address: z.string(),
  /** Where the helper should come. */
  pickup: z.object({ lat: z.number(), lng: z.number() }),
  /** The confirmed helper and the codes to give them, once a helper is assigned. */
  booking: z
    .object({
      id: z.uuid(),
      helper: z.object({ name: z.string().nullable(), phone: z.string(), skillTag: z.enum(['unskilled', 'skilled']) }),
      agreedPrice: z.number().int(),
      startCode: z.string().nullable(),
      completionCode: z.string().nullable(),
      /** Where the helper is, while they are on the way. */
      helperLocation: z.object({ lat: z.number(), lng: z.number() }).nullable(),
      /** The rating the customer gave the helper, once they have. */
      myRating: z.number().int().nullable(),
      /** Whether the customer can report a problem now: within the dispute window after the job. */
      canDispute: z.boolean(),
      dispute: z
        .object({
          status: z.enum(['open', 'resolved']),
          raisedByMe: z.boolean(),
          resolution: z.enum(['release', 'refund']).nullable(),
          resolutionNote: z.string().nullable(),
        })
        .nullable(),
    })
    .nullable(),
  createdAt: z.string(),
});
export type Task = z.infer<typeof taskSchema>;

export const TASK_LIST_FILTERS = ['active', 'all'] as const;

export const listTasksQuerySchema = z.object({
  status: z.enum(TASK_LIST_FILTERS).default('all'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

export const taskListSchema = z.object({
  items: z.array(taskSchema),
  /** Pass as `cursor` for the next page; null on the last page. */
  nextCursor: z.string().nullable(),
});
export type TaskList = z.infer<typeof taskListSchema>;

/** ₹150 from 15000 paise and ₹123.20 from 12320, with Indian digit grouping. */
export function formatRupees(paise: number): string {
  // Whole rupees show without paise; anything else shows both paise digits.
  const digits = paise % 100 === 0 ? 0 : 2;
  return `₹${new Intl.NumberFormat('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(paise / 100)}`;
}

/** Recordings the API accepts for POST /tasks/interpret, as the multipart field `audio`. */
export const VOICE_MIME_TYPES = [
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/webm',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
  'audio/mpeg',
] as const;
/** About two minutes at the app's recording quality. */
export const VOICE_MAX_BYTES = 5 * 1024 * 1024;
export const VOICE_MAX_SECONDS = 90;
