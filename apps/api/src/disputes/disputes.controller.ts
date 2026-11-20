import { CurrentUser } from '@nestjs/authentication';
import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { type RaiseDispute, raiseDisputeSchema } from '@sibimate/shared';
import { ApiException } from '../common/api-exception.js';
import type { UserRow } from '../db/schema.js';
import { DisputesService } from './disputes.service.js';

@Controller('bookings')
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  /** The customer or the helper reports a problem with a job. */
  @Post(':id/dispute')
  @HttpCode(204)
  async raise(
    @CurrentUser() user: UserRow,
    @Param('id', new ParseUUIDPipe({ exceptionFactory: () => new ApiException(404, 'not_found', 'Job not found.') }))
    id: string,
    @Body({ schema: raiseDisputeSchema }) body: RaiseDispute,
  ): Promise<void> {
    await this.disputes.raise(user, id, body.reason);
  }
}
