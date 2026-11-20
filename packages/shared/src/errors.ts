import { z } from 'zod';

/**
 * Stable error codes. The API returns one in every error body, and the clients
 * translate it into Hindi or English instead of showing the server's message.
 */
export const ERROR_CODES = [
  'validation_failed',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'otp_invalid',
  'otp_expired',
  'otp_too_many_attempts',
  'invalid_transition',
  'task_not_allowed',
  'interpreter_unavailable',
  'speech_unavailable',
  'speech_not_understood',
  'admin_login_failed',
  'helper_unavailable',
  'code_invalid',
  'code_locked',
  'offer_unavailable',
  'documents_missing',
  'internal',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const apiErrorSchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string(),
  details: z.unknown().optional(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
