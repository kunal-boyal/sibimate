import type { BookingDispute, PlatformSettings, TaskStatus } from '@sibimate/shared';
import type { BookingRow } from '../db/schema.js';

const AFTER_JOB: readonly TaskStatus[] = ['completed', 'paid'];

/**
 * Whether one side of a job can raise a dispute now. Either side can within the
 * dispute window after the job is completed. A helper can also once the work has
 * been under way for longer than the completion-code wait, when the customer has
 * not given the code.
 */
export function canRaiseDispute(
  role: 'customer' | 'helper',
  taskStatus: TaskStatus,
  booking: Pick<BookingRow, 'startedAt' | 'completedAt'>,
  rules: Pick<PlatformSettings, 'disputeWindowHours' | 'completionCodeWaitMinutes'>,
  hasDispute: boolean,
  now = new Date(),
): boolean {
  if (hasDispute) {
    return false;
  }
  if (AFTER_JOB.includes(taskStatus) && booking.completedAt) {
    return now.getTime() - booking.completedAt.getTime() <= rules.disputeWindowHours * 3_600_000;
  }
  if (role === 'helper' && taskStatus === 'in_progress' && booking.startedAt) {
    return now.getTime() - booking.startedAt.getTime() >= rules.completionCodeWaitMinutes * 60_000;
  }
  return false;
}

/** What one side sees of the dispute on their job. */
export function disputeView(
  dispute: {
    status: 'open' | 'resolved';
    raisedBy: string;
    resolution: 'release' | 'refund' | null;
    resolutionNote: string | null;
  } | null,
  viewerUserId: string,
): BookingDispute | null {
  return dispute
    ? {
        status: dispute.status,
        raisedByMe: dispute.raisedBy === viewerUserId,
        resolution: dispute.resolution,
        resolutionNote: dispute.resolutionNote,
      }
    : null;
}
