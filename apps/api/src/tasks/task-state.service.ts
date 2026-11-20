import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { type TaskActor, type TaskStatus, canTransitionTask } from '@sibimate/shared';
import { eq } from 'drizzle-orm';
import { ApiException } from '../common/api-exception.js';
import type { Database } from '../db/db.js';
import { type TaskRow, taskEvents, tasks } from '../db/schema.js';
import { Notifier } from '../live/notifier.js';
import { MatchingScheduler } from '../matching/matching-scheduler.js';

export interface Actor {
  role: TaskActor;
  /** Absent for the system. */
  id?: string;
}

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface TransitionOptions {
  /** Refuses the move for this actor (not their task): it then looks like the task does not exist. */
  allow?: (task: TaskRow) => boolean;
  /** Runs in the same transaction after the status has changed. Throwing undoes the move. */
  within?: (tx: Transaction, task: TaskRow) => Promise<unknown>;
}

/**
 * The only place a task changes status. Every move is checked against the
 * state machine in @sibimate/shared and written to task_events.
 */
@Injectable()
export class TaskStateService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly scheduler: MatchingScheduler,
    private readonly notifier: Notifier,
  ) {}

  /** Moves a task to `to`, or throws `invalid_transition`. */
  async transition(taskId: string, to: TaskStatus, actor: Actor, { allow, within }: TransitionOptions = {}) {
    const moved = await this.db.transaction(async (tx) => {
      // The row lock makes two moves at once take turns, so only one can win.
      const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId)).for('update');
      if (!task || (allow && !allow(task))) {
        throw new ApiException(404, 'not_found', 'Task not found.');
      }
      if (!canTransitionTask(task.status, to, actor.role)) {
        throw new ApiException(409, 'invalid_transition', `A task that is ${task.status} cannot become ${to}.`);
      }
      const [updated] = await tx.update(tasks).set({ status: to }).where(eq(tasks.id, taskId)).returning();
      await this.record(tx, taskId, task.status, to, actor);
      await within?.(tx, updated!);
      return updated!;
    });
    // Whenever a task starts looking for a helper, the first search ring runs at once.
    if (to === 'matching') {
      await this.scheduler.schedule(taskId, 0, 0);
    }
    await this.notifier.taskChanged(taskId);
    return moved;
  }

  /** Writes one row of history. Used directly only for the event that creates a task. */
  async record(tx: Transaction, taskId: string, from: TaskStatus | null, to: TaskStatus, actor: Actor) {
    await tx
      .insert(taskEvents)
      .values({ taskId, fromStatus: from, toStatus: to, actorId: actor.id, actorRole: actor.role });
  }
}
