import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import type { Admin, AuditEntry } from '@sibimate/shared';
import { desc, eq } from 'drizzle-orm';
import type { Database } from '../db/db.js';
import { adminUsers, auditLog } from '../db/schema.js';

/** Writes the record of what admins did and which documents they opened. */
@Injectable()
export class AuditService {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async record(admin: Admin, action: string, entity: string, entityId: string, meta?: Record<string, unknown>) {
    await this.db.insert(auditLog).values({ adminId: admin.id, action, entity, entityId, meta });
  }

  /** The most recent entries, newest first. */
  async recent(limit = 200): Promise<AuditEntry[]> {
    const rows = await this.db
      .select({ entry: auditLog, email: adminUsers.email })
      .from(auditLog)
      .innerJoin(adminUsers, eq(auditLog.adminId, adminUsers.id))
      .orderBy(desc(auditLog.createdAt))
      .limit(limit);
    return rows.map(({ entry, email }) => ({
      id: entry.id,
      at: entry.createdAt.toISOString(),
      admin: email,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      meta: entry.meta ?? null,
    }));
  }
}
