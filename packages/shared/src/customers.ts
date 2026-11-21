import { z } from 'zod';
import { LANGUAGES, USER_STATUSES } from './auth.js';

/** A customer as the dashboard's Customers page lists them. */
export const adminCustomerSchema = z.object({
  id: z.uuid(),
  name: z.string().nullable(),
  phone: z.string(),
  language: z.enum(LANGUAGES),
  status: z.enum(USER_STATUSES),
  /** Why an admin blocked the account, while it is blocked. */
  blockedReason: z.string().nullable(),
  isHelper: z.boolean(),
  joinedAt: z.string(),
  tasks: z.object({
    total: z.number().int(),
    /** Not yet finished or cancelled. */
    open: z.number().int(),
    done: z.number().int(),
    cancelled: z.number().int(),
  }),
  lastTaskAt: z.string().nullable(),
});
export type AdminCustomer = z.infer<typeof adminCustomerSchema>;

export const adminCustomerListSchema = z.object({ items: z.array(adminCustomerSchema) });
export type AdminCustomerList = z.infer<typeof adminCustomerListSchema>;

export const adminCustomerQuerySchema = z.object({
  /** Part of a name or phone number. */
  q: z.string().trim().max(60).optional(),
});
export type AdminCustomerQuery = z.infer<typeof adminCustomerQuerySchema>;

export const blockCustomerSchema = z.object({
  reason: z.string().trim().min(5, 'Say why, in a few words').max(300),
});
export type BlockCustomer = z.infer<typeof blockCustomerSchema>;
