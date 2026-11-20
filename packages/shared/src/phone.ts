import { z } from 'zod';

/**
 * Version 1 signs in Indian mobile numbers only. Accepts what people type
 * ("98765 43210", "09876543210", "+91 98765-43210") and returns E.164.
 */
export function normalizeIndianMobile(input: string): string | null {
  const compact = input.replace(/[\s\-()]/g, '');
  if (!/^\+?\d+$/.test(compact)) {
    return null;
  }
  let digits = compact.replace(/^\+/, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

/** Parses any accepted spelling of a number into E.164. */
export const phoneSchema = z.string().transform((value, ctx) => {
  const phone = normalizeIndianMobile(value);
  if (!phone) {
    ctx.addIssue({
      code: 'custom',
      message: 'Enter a 10-digit Indian mobile number',
    });
    return z.NEVER;
  }
  return phone;
});
