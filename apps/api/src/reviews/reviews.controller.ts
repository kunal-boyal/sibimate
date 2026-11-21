import { CurrentUser } from '@nestjs/authentication';
import { Body, Controller, HttpCode, Injectable, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { type CreateReview, createReviewSchema } from '@sibimate/shared';
import { eq, sql } from 'drizzle-orm';
import { ApiException } from '../common/api-exception.js';
import type { Database } from '../db/db.js';
import { type UserRow, bookings, helperProfiles, reviews, tasks } from '../db/schema.js';
import { Notifier } from '../live/notifier.js';
import { UserAuth } from '../openapi/openapi.js';

const notFound = () => new ApiException(404, 'not_found', 'Job not found.');

@Injectable()
export class ReviewsService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly notifier: Notifier,
  ) {}

  /** The customer rates the helper, or the helper the customer, once the job is paid. Each can rate once. */
  async create(author: UserRow, bookingId: string, { rating, comment }: CreateReview): Promise<void> {
    const [row] = await this.db
      .select({ booking: bookings, task: tasks, helper: helperProfiles })
      .from(bookings)
      .innerJoin(tasks, eq(bookings.taskId, tasks.id))
      .innerJoin(helperProfiles, eq(bookings.helperId, helperProfiles.id))
      .where(eq(bookings.id, bookingId));
    const isCustomer = row?.task.customerId === author.id;
    const isHelper = row?.helper.userId === author.id;
    if (!row || (!isCustomer && !isHelper)) {
      throw notFound();
    }
    if (row.booking.status !== 'completed') {
      throw new ApiException(409, 'invalid_transition', 'You can rate a job once it is paid.');
    }

    await this.db.transaction(async (tx) => {
      // The unique index decides who is first, so two taps cannot count twice.
      const inserted = await tx
        .insert(reviews)
        .values({
          bookingId,
          authorId: author.id,
          subjectId: isCustomer ? row.helper.userId : row.task.customerId,
          rating,
          comment: comment || null,
        })
        .onConflictDoNothing()
        .returning({ id: reviews.id });
      if (inserted.length === 0) {
        throw new ApiException(409, 'conflict', 'You have already rated this job.');
      }
      if (isCustomer) {
        await tx
          .update(helperProfiles)
          .set({
            ratingSum: sql`${helperProfiles.ratingSum} + ${rating}`,
            ratingCount: sql`${helperProfiles.ratingCount} + 1`,
          })
          .where(eq(helperProfiles.id, row.helper.id));
      }
    });
    await this.notifier.taskChanged(row.task.id);
  }
}

@UserAuth()
@Controller('bookings')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post(':id/review')
  @HttpCode(204)
  async review(
    @CurrentUser() user: UserRow,
    @Param('id', new ParseUUIDPipe({ exceptionFactory: notFound })) id: string,
    @Body({ schema: createReviewSchema }) body: CreateReview,
  ): Promise<void> {
    await this.reviewsService.create(user, id, body);
  }
}
