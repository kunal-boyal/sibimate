import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import {
  type BookingCode,
  type HelperBooking,
  type HelperBookingList,
  bookingCodeSchema,
  helperBookingListSchema,
  helperBookingSchema,
} from '@sibimate/shared';
import { ApiException } from '../common/api-exception.js';
import type { HelperProfileRow } from '../db/schema.js';
import { BookingsService } from './bookings.service.js';
import { CurrentHelper, HelperGuard } from './helper.guard.js';
import { ApiResult, UserAuth } from '../openapi/openapi.js';

const Id = () =>
  Param('id', new ParseUUIDPipe({ exceptionFactory: () => new ApiException(404, 'not_found', 'Job not found.') }));

/** What a helper does with the jobs they have been given. */
@UserAuth()
@Controller()
@UseGuards(HelperGuard)
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Get('helper/bookings')
  @ApiResult(helperBookingListSchema)
  async list(@CurrentHelper() helper: HelperProfileRow): Promise<HelperBookingList> {
    return { items: await this.bookingsService.listForHelper(helper) };
  }

  @Get('helper/bookings/:id')
  @ApiResult(helperBookingSchema)
  get(@CurrentHelper() helper: HelperProfileRow, @Id() id: string): Promise<HelperBooking> {
    return this.bookingsService.getForHelper(helper, id);
  }

  @Post('bookings/:id/en-route')
  @ApiResult(helperBookingSchema)
  @HttpCode(200)
  enRoute(@CurrentHelper() helper: HelperProfileRow, @Id() id: string): Promise<HelperBooking> {
    return this.bookingsService.enRoute(helper, id);
  }

  @Post('bookings/:id/start')
  @ApiResult(helperBookingSchema)
  @HttpCode(200)
  start(
    @CurrentHelper() helper: HelperProfileRow,
    @Id() id: string,
    @Body({ schema: bookingCodeSchema }) body: BookingCode,
  ): Promise<HelperBooking> {
    return this.bookingsService.start(helper, id, body.code);
  }

  @Post('bookings/:id/complete')
  @ApiResult(helperBookingSchema)
  @HttpCode(200)
  complete(
    @CurrentHelper() helper: HelperProfileRow,
    @Id() id: string,
    @Body({ schema: bookingCodeSchema }) body: BookingCode,
  ): Promise<HelperBooking> {
    return this.bookingsService.complete(helper, id, body.code);
  }

  @Post('bookings/:id/payment/cash-received')
  @ApiResult(helperBookingSchema)
  @HttpCode(200)
  cashReceived(@CurrentHelper() helper: HelperProfileRow, @Id() id: string): Promise<HelperBooking> {
    return this.bookingsService.cashReceived(helper, id);
  }

  @Post('bookings/:id/cancel')
  @ApiResult(helperBookingSchema)
  @HttpCode(200)
  cancel(@CurrentHelper() helper: HelperProfileRow, @Id() id: string): Promise<HelperBooking> {
    return this.bookingsService.cancel(helper, id);
  }
}
