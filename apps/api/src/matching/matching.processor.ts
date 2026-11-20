import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { MATCHING_QUEUE, type RingJob } from './matching-scheduler.js';
import { MatchingService } from './matching.service.js';

/** Runs queued search rings. Only the worker process registers this class. */
@Processor(MATCHING_QUEUE)
export class MatchingProcessor extends WorkerHost {
  private readonly logger = new Logger('Matching');

  constructor(private readonly matching: MatchingService) {
    super();
  }

  async process(job: Job<RingJob>) {
    const outcome = await this.matching.runRing(job.data.taskId, job.data.ring);
    this.logger.debug(`Ring ${job.data.ring} of task ${job.data.taskId}: ${JSON.stringify(outcome)}`);
    return outcome;
  }
}
