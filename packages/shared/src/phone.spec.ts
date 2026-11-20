import { describe, expect, it } from 'vitest';
import { otpRequestSchema } from './auth.js';
import { normalizeIndianMobile } from './phone.js';

describe('normalizeIndianMobile', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['98765 43210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['+91 98765-43210', '+919876543210'],
    ['919876543210', '+919876543210'],
  ])('accepts %s', (input, expected) => {
    expect(normalizeIndianMobile(input)).toBe(expected);
  });

  it.each(['', '12345', '5876543210', '98765432101', '+1 415 555 2671', '98765abc10'])('rejects %s', (input) => {
    expect(normalizeIndianMobile(input)).toBeNull();
  });

  it('normalises the phone inside a request schema', () => {
    const parsed = otpRequestSchema.parse({
      phone: '98765 43210',
      deviceId: 'device-1234',
    });
    expect(parsed.phone).toBe('+919876543210');
    expect(otpRequestSchema.safeParse({ phone: '123', deviceId: 'device-1234' }).success).toBe(false);
  });
});

describe('formatRupees', () => {
  it('shows whole rupees without paise, and paise with both digits', async () => {
    const { formatRupees } = await import('./tasks.js');
    expect(formatRupees(15000)).toBe('₹150');
    expect(formatRupees(12320)).toBe('₹123.20');
    expect(formatRupees(21120000)).toBe('₹2,11,200');
  });
});
