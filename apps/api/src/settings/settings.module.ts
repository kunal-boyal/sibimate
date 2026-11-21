import { Global, Module } from '@nestjs/common';
import { AuditService } from '../admin/audit.service.js';
import { CommissionService } from './commission.service.js';
import { SettingsService } from './settings.service.js';

/** The platform rules, commission rates and the audit log, which modules all over the API read and write. */
@Global()
@Module({
  providers: [SettingsService, CommissionService, AuditService],
  exports: [SettingsService, CommissionService, AuditService],
})
export class SettingsModule {}
