import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { AvailabilityService } from './availability.service.js';
import { RING_RUNNER } from './matching-scheduler.js';
import { HelperMatchingController, TaskOffersController } from './matching.controller.js';
import { MatchingService } from './matching.service.js';
import { OffersService } from './offers.service.js';

@Module({
  imports: [TasksModule, BookingsModule],
  controllers: [HelperMatchingController, TaskOffersController],
  providers: [
    MatchingService,
    { provide: RING_RUNNER, useExisting: MatchingService },
    OffersService,
    AvailabilityService,
  ],
  exports: [MatchingService],
})
export class MatchingModule {}
