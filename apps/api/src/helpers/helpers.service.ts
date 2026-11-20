import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import type { Helper, createHelperSchema } from '@sibimate/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database } from '../db/db.js';
import { type HelperProfileRow, bookings, helperProfiles, users } from '../db/schema.js';

type CreateHelperInput = z.output<typeof createHelperSchema>;

@Injectable()
export class HelpersService {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  /**
   * Makes the person with this phone an active helper, creating their account
   * if they have never signed in. Until onboarding is built in milestone 4, an
   * admin does this after checking the helper by hand.
   */
  async create(input: CreateHelperInput): Promise<Helper> {
    const id = await this.db.transaction(async (tx) => {
      await tx.insert(users).values({ phone: input.phone, name: input.name }).onConflictDoNothing();
      const [user] = await tx
        .update(users)
        .set({
          // Keeps a name the person chose themselves.
          name: sql`coalesce(${users.name}, ${input.name})`,
          roles: sql`array(select distinct unnest(${users.roles} || 'helper'::user_role))`,
        })
        .where(eq(users.phone, input.phone))
        .returning({ id: users.id });

      const profile = {
        skillTag: input.skillTag,
        skills: input.skills,
        verificationLevel: input.verificationLevel,
        status: 'active' as const,
      };
      const [row] = await tx
        .insert(helperProfiles)
        .values({ userId: user!.id, ...profile })
        .onConflictDoUpdate({ target: helperProfiles.userId, set: profile })
        .returning({ id: helperProfiles.id });
      return row!.id;
    });
    return (await this.list()).find((helper) => helper.id === id)!;
  }

  async list(): Promise<Helper[]> {
    const rows = await this.db
      .select({
        profile: helperProfiles,
        name: users.name,
        phone: users.phone,
        busy: sql<boolean>`exists (select 1 from ${bookings} where ${bookings.helperId} = ${helperProfiles.id} and ${bookings.status} = 'active')`,
      })
      .from(helperProfiles)
      .innerJoin(users, eq(helperProfiles.userId, users.id))
      .orderBy(desc(helperProfiles.createdAt));
    return rows.map(({ profile, name, phone, busy }) => ({
      id: profile.id,
      phone,
      name,
      skillTag: profile.skillTag,
      skills: profile.skills,
      verificationLevel: profile.verificationLevel,
      status: profile.status,
      completedCount: profile.completedCount,
      cancelledCount: profile.cancelledCount,
      busy,
      rating: profile.ratingCount > 0 ? Math.round((profile.ratingSum / profile.ratingCount) * 10) / 10 : null,
      ratingCount: profile.ratingCount,
    }));
  }

  /** The active helper profile of an app user, if they have one. */
  async findActiveByUser(userId: string): Promise<HelperProfileRow | undefined> {
    const [row] = await this.db
      .select()
      .from(helperProfiles)
      .where(and(eq(helperProfiles.userId, userId), eq(helperProfiles.status, 'active')));
    return row;
  }
}
