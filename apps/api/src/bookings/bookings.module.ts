import { Module } from '@nestjs/common';
import { AddressCipher } from '../common/address-cipher.js';
import { HelpersService } from '../helpers/helpers.service.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { BookingsController } from './bookings.controller.js';
import { BookingsService } from './bookings.service.js';
import { HelperGuard } from './helper.guard.js';

@Module({
  imports: [TasksModule],
  controllers: [BookingsController],
  providers: [BookingsService, HelpersService, HelperGuard, AddressCipher],
  exports: [BookingsService, HelpersService],
})
export class BookingsModule {}
