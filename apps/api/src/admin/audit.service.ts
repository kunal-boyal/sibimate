import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import type { Admin } from '@sibimate/shared';
import type { Database } from '../db/db.js';
import { auditLog } from '../db/schema.js';

/** Writes the record of what admins did and which documents they opened. */
@Injectable()
export class AuditService {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async record(admin: Admin, action: string, entity: string, entityId: string, meta?: Record<string, unknown>) {
    await this.db.insert(auditLog).values({ adminId: admin.id, action, entity, entityId, meta });
  }
}
