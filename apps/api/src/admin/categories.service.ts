import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import type { AdminCategory, ApproveCategory } from '@sibimate/shared';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { ApiException } from '../common/api-exception.js';
import type { Database } from '../db/db.js';
import { taskCategories, tasks } from '../db/schema.js';

/** Reviewing the categories the model proposes: approve them as they are or corrected, or fold them into one that exists. */
@Injectable()
export class CategoriesService {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async list(): Promise<AdminCategory[]> {
    const rows = await this.db
      .select({ category: taskCategories, taskCount: count(tasks.id) })
      .from(taskCategories)
      .leftJoin(tasks, eq(tasks.categoryId, taskCategories.id))
      .groupBy(taskCategories.id)
      // Proposals waiting for a decision first, then the active list by name.
      .orderBy(
        sql`${taskCategories.reviewStatus} = 'pending' desc`,
        sql`${taskCategories.active} desc`,
        asc(taskCategories.name),
      );
    return rows.map(({ category, taskCount }) => ({
      id: category.id,
      slug: category.slug,
      name: category.name,
      requiresSkilled: category.requiresSkilled,
      minVerificationLevel: category.minVerificationLevel,
      source: category.source,
      reviewStatus: category.reviewStatus,
      active: category.active,
      taskCount,
    }));
  }

  async approve(id: string, changes: ApproveCategory): Promise<void> {
    await this.pending(id);
    await this.db
      .update(taskCategories)
      .set({ ...changes, reviewStatus: 'approved', active: true })
      .where(eq(taskCategories.id, id));
  }

  async merge(id: string, intoId: string): Promise<void> {
    await this.pending(id);
    const [target] = await this.db
      .select()
      .from(taskCategories)
      .where(and(eq(taskCategories.id, intoId), eq(taskCategories.active, true)));
    if (!target || intoId === id) {
      throw new ApiException(400, 'validation_failed', 'Validation failed', [
        { path: 'intoId', message: 'Choose an active category to merge into.' },
      ]);
    }
    await this.db.transaction(async (tx) => {
      await tx.update(tasks).set({ categoryId: intoId }).where(eq(tasks.categoryId, id));
      await tx.update(taskCategories).set({ reviewStatus: 'rejected', active: false }).where(eq(taskCategories.id, id));
    });
  }

  private async pending(id: string) {
    const [category] = await this.db.select().from(taskCategories).where(eq(taskCategories.id, id));
    if (!category) {
      throw new ApiException(404, 'not_found', 'Category not found.');
    }
    if (category.reviewStatus !== 'pending') {
      throw new ApiException(409, 'conflict', 'This category has already been decided.');
    }
    return category;
  }
}
