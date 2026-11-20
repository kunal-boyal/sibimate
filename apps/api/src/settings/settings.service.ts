import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import {
  type Admin,
  DEFAULT_PLATFORM_SETTINGS,
  type PlatformSettings,
  type PlatformSettingsResponse,
  type UpdatePlatformSettings,
} from '@sibimate/shared';
import { eq } from 'drizzle-orm';
import { AuditService } from '../admin/audit.service.js';
import type { Database } from '../db/db.js';
import { adminUsers, platformSettings } from '../db/schema.js';

/** The rules an owner can change from the dashboard: the cancellation fee, the cash dues limit and two time limits. */
@Injectable()
export class SettingsService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** The rules in force. Code that applies a rule reads it here, so a change takes effect at once. */
  async current(): Promise<PlatformSettings> {
    const { updatedAt: _, updatedBy: __, ...settings } = await this.get();
    return settings;
  }

  async get(): Promise<PlatformSettingsResponse> {
    const [row] = await this.db
      .select({ settings: platformSettings, email: adminUsers.email })
      .from(platformSettings)
      .leftJoin(adminUsers, eq(platformSettings.updatedBy, adminUsers.id))
      .where(eq(platformSettings.id, 1));
    if (!row) {
      return { ...DEFAULT_PLATFORM_SETTINGS, updatedAt: null, updatedBy: null };
    }
    const { cancellationFee, cashDuesLimit, disputeWindowHours, completionCodeWaitMinutes, updatedAt } = row.settings;
    return {
      cancellationFee,
      cashDuesLimit,
      disputeWindowHours,
      completionCodeWaitMinutes,
      updatedAt: updatedAt.toISOString(),
      updatedBy: row.email,
    };
  }

  async update(admin: Admin, changes: UpdatePlatformSettings): Promise<PlatformSettingsResponse> {
    const before = await this.current();
    const after = { ...before, ...changes };
    await this.db
      .insert(platformSettings)
      .values({ id: 1, ...after, updatedBy: admin.id, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: platformSettings.id,
        set: { ...after, updatedBy: admin.id, updatedAt: new Date() },
      });
    // Old values are kept in the audit log, with who changed them and when.
    const changed = Object.fromEntries(
      Object.entries(changes).filter(([key, value]) => before[key as keyof PlatformSettings] !== value),
    );
    if (Object.keys(changed).length > 0) {
      const previous = Object.fromEntries(
        Object.keys(changed).map((key) => [key, before[key as keyof PlatformSettings]]),
      );
      await this.audit.record(admin, 'settings.update', 'platform_settings', '1', { before: previous, after: changed });
    }
    return this.get();
  }
}
