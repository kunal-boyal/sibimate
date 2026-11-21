import { Public } from '@nestjs/authentication';
import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  type Admin,
  type AdminLoginResponse,
  adminLoginSchema,
  adminLoginResponseSchema,
  adminSchema,
} from '@sibimate/shared';
import type { z } from 'zod';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminGuard, AdminToken, CurrentAdmin } from './admin.guard.js';
import { AdminAuth, ApiResult } from '../openapi/openapi.js';

@Public()
@Controller('admin')
export class AdminAuthController {
  constructor(private readonly adminAuth: AdminAuthService) {}

  @Post('auth/login')
  @ApiResult(adminLoginResponseSchema)
  @HttpCode(200)
  login(@Body({ schema: adminLoginSchema }) body: z.output<typeof adminLoginSchema>): Promise<AdminLoginResponse> {
    return this.adminAuth.login(body.email, body.password, body.code);
  }

  @Post('auth/logout')
  @AdminAuth()
  @HttpCode(204)
  @UseGuards(AdminGuard)
  async logout(@AdminToken() token: string): Promise<void> {
    await this.adminAuth.logout(token);
  }

  @Get('me')
  @AdminAuth()
  @ApiResult(adminSchema)
  @UseGuards(AdminGuard)
  me(@CurrentAdmin() admin: Admin): Admin {
    return admin;
  }
}
