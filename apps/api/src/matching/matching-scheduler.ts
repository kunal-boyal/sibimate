import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Queue } from 'bullmq';

export const MATCHING_QUEUE = 'matching';

/**
 * The token MatchingService is also provided under. The schedulers must not
 * import the class itself: it depends on TaskStateService, which depends on a
 * scheduler, and the files would import each other in a circle.
 */
export const RING_RUNNER = Symbol('RING_RUNNER');

export interface RingRunner {
  runRing(taskId: string, ring: number): Promise<unknown>;
}

export interface RingJob {
  taskId: string;
  ring: number;
}

/** Runs a search ring for a task after a delay. */
export abstract class MatchingScheduler {
  abstract schedule(taskId: string, ring: number, delayMs: number): Promise<void>;
}

/**
 * Queues each ring as a delayed BullMQ job for the worker process. The job id
 * is the task and ring, so a retry or a restart never runs a ring twice.
 */
@Injectable()
export class BullMqMatchingScheduler extends MatchingScheduler {
  constructor(@InjectQueue(MATCHING_QUEUE) private readonly queue: Queue<RingJob>) {
    super();
  }

  async schedule(taskId: string, ring: number, delayMs: number): Promise<void> {
    await this.queue.add(
      'ring',
      { taskId, ring },
      {
        delay: delayMs,
        jobId: `${taskId}-ring-${ring}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        // Removed when done, so the same ring can be queued again if the task returns to matching.
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
  }
}

/** Runs rings on timers inside this process: for development and tests only. */
@Injectable()
export class InlineMatchingScheduler extends MatchingScheduler implements OnModuleDestroy {
  private readonly logger = new Logger('Matching');
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(private readonly moduleRef: ModuleRef) {
    super();
  }

  async schedule(taskId: string, ring: number, delayMs: number): Promise<void> {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      // Looked up when the timer fires: the runner itself depends on a scheduler.
      this.moduleRef
        .get<RingRunner>(RING_RUNNER, { strict: false })
        .runRing(taskId, ring)
        .catch((error: unknown) => this.logger.error(`Ring ${ring} of task ${taskId} failed: ${String(error)}`));
    }, delayMs);
    this.timers.add(timer);
  }

  onModuleDestroy() {
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
  }
}
