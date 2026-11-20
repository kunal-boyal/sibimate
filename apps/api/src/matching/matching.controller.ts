import { CurrentUser } from '@nestjs/authentication';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import {
  type Availability,
  type GeoPoint,
  type NearbyTaskList,
  type OfferResult,
  type Quote,
  type SetAvailability,
  type TaskOfferList,
  helperLocationSchema,
  quoteSchema,
  setAvailabilitySchema,
} from '@sibimate/shared';
import { CurrentHelper, HelperGuard } from '../bookings/helper.guard.js';
import { ApiException } from '../common/api-exception.js';
import type { HelperProfileRow, UserRow } from '../db/schema.js';
import { AvailabilityService } from './availability.service.js';
import { OffersService } from './offers.service.js';

const Id = (name = 'id') =>
  Param(name, new ParseUUIDPipe({ exceptionFactory: () => new ApiException(404, 'not_found', 'Task not found.') }));

/** A helper's availability and the tasks they are shown. */
@Controller('helper')
@UseGuards(HelperGuard)
export class HelperMatchingController {
  constructor(
    private readonly availability: AvailabilityService,
    private readonly offers: OffersService,
  ) {}

  @Get('availability')
  getAvailability(@CurrentHelper() helper: HelperProfileRow): Promise<Availability> {
    return this.availability.get(helper);
  }

  @Put('availability')
  setAvailability(
    @CurrentHelper() helper: HelperProfileRow,
    @Body({ schema: setAvailabilitySchema }) body: SetAvailability,
  ): Promise<Availability> {
    return this.availability.set(helper, body);
  }

  @Put('location')
  @HttpCode(204)
  async location(
    @CurrentHelper() helper: HelperProfileRow,
    @Body({ schema: helperLocationSchema }) body: GeoPoint,
  ): Promise<void> {
    await this.availability.reportLocation(helper, body);
  }

  @Get('tasks/nearby')
  async nearby(@CurrentHelper() helper: HelperProfileRow): Promise<NearbyTaskList> {
    return { items: await this.offers.nearby(helper) };
  }

  @Post('tasks/:id/accept')
  @HttpCode(200)
  accept(@CurrentHelper() helper: HelperProfileRow, @Id() id: string): Promise<OfferResult> {
    return this.offers.accept(helper, id);
  }

  @Post('tasks/:id/quote')
  @HttpCode(200)
  quote(
    @CurrentHelper() helper: HelperProfileRow,
    @Id() id: string,
    @Body({ schema: quoteSchema }) body: Quote,
  ): Promise<OfferResult> {
    return this.offers.quote(helper, id, body);
  }

  @Post('tasks/:id/decline')
  @HttpCode(204)
  async decline(@CurrentHelper() helper: HelperProfileRow, @Id() id: string): Promise<void> {
    await this.offers.decline(helper, id);
  }
}

/** The customer's side: helpers' offers on their task. */
@Controller('tasks')
export class TaskOffersController {
  constructor(private readonly offers: OffersService) {}

  @Get(':id/offers')
  async list(@CurrentUser() user: UserRow, @Id() id: string): Promise<TaskOfferList> {
    return { items: await this.offers.listForCustomer(user, id) };
  }

  @Post(':id/offers/:offerId/accept')
  @HttpCode(204)
  async accept(@CurrentUser() user: UserRow, @Id() id: string, @Id('offerId') offerId: string): Promise<void> {
    await this.offers.choose(user, id, offerId);
  }
}
