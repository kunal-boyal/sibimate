import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module.js';
import { AdminAuthController } from './admin-auth.controller.js';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminController } from './admin.controller.js';
import { AdminGuard } from './admin.guard.js';
import { CategoriesService } from './categories.service.js';
import { OverviewService } from './overview.service.js';
import { OnboardingModule } from '../onboarding/onboarding.module.js';
import { DisputesModule } from '../disputes/disputes.module.js';
import { LiveGateway } from '../live/live.gateway.js';

@Module({
  imports: [BookingsModule, OnboardingModule, DisputesModule],
  controllers: [AdminAuthController, AdminController],
  // The live channel lives here because it signs in dashboards as well as app users.
  providers: [AdminAuthService, AdminGuard, OverviewService, CategoriesService, LiveGateway],
  exports: [AdminAuthService],
})
export class AdminModule {}
