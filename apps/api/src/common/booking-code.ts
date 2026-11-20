import { createHmac } from 'node:crypto';
import { BOOKING_CODE_LENGTH } from '@sibimate/shared';

/**
 * The start or completion code of a booking. It is derived from a server
 * secret and the booking id, so nothing that could be replayed is stored, and
 * the customer can be shown the same code every time they open the task.
 */
export function bookingCode(secret: string, bookingId: string, purpose: 'start' | 'completion'): string {
  const digest = createHmac('sha256', secret).update(`booking:${bookingId}:${purpose}`).digest();
  return (digest.readUInt32BE(0) % 10 ** BOOKING_CODE_LENGTH).toString().padStart(BOOKING_CODE_LENGTH, '0');
}
