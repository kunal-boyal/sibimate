import { Public } from '@nestjs/authentication';
import { Controller, Get } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/db.js';
import { z } from 'zod';
import { ApiResult } from '../openapi/openapi.js';

@Public()
@Controller('health')
export class HealthController {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  @Get()
  @ApiResult(z.object({ status: z.literal('ok') }))
  async check() {
    await this.db.execute(sql`select 1`);
    return { status: 'ok' };
  }
}
