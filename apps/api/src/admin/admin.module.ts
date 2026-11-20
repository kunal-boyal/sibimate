import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module.js';
import { AdminAuthController } from './admin-auth.controller.js';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminController } from './admin.controller.js';
import { AdminGuard } from './admin.guard.js';
import { AuditService } from './audit.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { OnboardingModule } from '../onboarding/onboarding.module.js';
import { LiveGateway } from '../live/live.gateway.js';

@Module({
  imports: [BookingsModule, OnboardingModule],
  controllers: [AdminAuthController, AdminController],
  // The live channel lives here because it signs in dashboards as well as app users.
  providers: [AdminAuthService, AdminGuard, AuditService, SettingsService, LiveGateway],
  exports: [AdminAuthService, SettingsService],
})
export class AdminModule {}
