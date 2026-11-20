import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import type { UpdateMe, User } from '@sibimate/shared';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/db.js';
import { type UserRow, users } from '../db/schema.js';

export function toUser({ id, phone, name, language, roles, status }: UserRow): User {
  return { id, phone, name, language, roles, status };
}

@Injectable()
export class UsersRepository {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async findById(id: string): Promise<UserRow | undefined> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id));
    return row;
  }

  /** Returns the account for a phone, creating it on first sign-in. */
  async findOrCreateByPhone(phone: string): Promise<{ user: UserRow; created: boolean }> {
    // One statement decides who creates the row, so two sign-ins at once cannot make two accounts.
    const [created] = await this.db.insert(users).values({ phone }).onConflictDoNothing().returning();
    if (created) {
      return { user: created, created: true };
    }
    const [existing] = await this.db.select().from(users).where(eq(users.phone, phone));
    return { user: existing!, created: false };
  }

  async update(id: string, changes: UpdateMe): Promise<UserRow | undefined> {
    const [row] = await this.db.update(users).set(changes).where(eq(users.id, id)).returning();
    return row;
  }
}
