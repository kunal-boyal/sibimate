import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { InjectDisk, type StorageDisk } from '@nestjs/storage';
import {
  DOCUMENTS_FOR_LEVEL,
  type DocumentKind,
  type HelperApplicationDetail,
  type HelperProfile,
  type VerificationLevel,
  type helperApplicationSchema,
} from '@sibimate/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { ApiException } from '../common/api-exception.js';
import type { Database } from '../db/db.js';
import { type UserRow, helperDocuments, helperProfiles, users } from '../db/schema.js';
import { Notifier } from '../live/notifier.js';

type Application = z.output<typeof helperApplicationSchema>;
const notFound = () => new ApiException(404, 'not_found', 'Application not found.');

/** A person applies to be a helper and uploads their documents; a verifier approves or turns them down. */
@Injectable()
export class OnboardingService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    @InjectDisk('documents') private readonly disk: StorageDisk,
    private readonly notifier: Notifier,
  ) {}

  // The applicant

  async profile(user: UserRow): Promise<HelperProfile | null> {
    const [profile] = await this.db.select().from(helperProfiles).where(eq(helperProfiles.userId, user.id));
    if (!profile) {
      return null;
    }
    return {
      status: profile.status,
      skillTag: profile.skillTag,
      claimsSkilled: profile.claimsSkilled,
      skills: profile.skills,
      verificationLevel: profile.verificationLevel,
      rejectionReason: profile.rejectionReason,
      documents: await this.documents(profile.id),
    };
  }

  /** Applies, or applies again after being turned down. An approved helper cannot re-apply. */
  async apply(user: UserRow, input: Application): Promise<HelperProfile> {
    const details = {
      claimsSkilled: input.claimsSkilled,
      skills: input.claimsSkilled ? input.skills : [],
      emergencyContact: input.emergencyContact,
    };
    const [existing] = await this.db.select().from(helperProfiles).where(eq(helperProfiles.userId, user.id));
    if (existing && existing.status !== 'pending' && existing.status !== 'rejected') {
      throw new ApiException(409, 'conflict', 'You are already a helper.');
    }
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ name: input.name }).where(eq(users.id, user.id));
      await tx
        .insert(helperProfiles)
        .values({ userId: user.id, status: 'pending', ...details })
        .onConflictDoUpdate({
          target: helperProfiles.userId,
          set: { status: 'pending', rejectionReason: null, ...details },
        });
    });
    await this.notifier.applicationsChanged();
    return (await this.profile(user))!;
  }

  /** Stores a document image privately. A second upload of the same kind replaces the first. */
  async upload(
    user: UserRow,
    kind: DocumentKind,
    file: { buffer: Buffer; contentType: string },
  ): Promise<HelperProfile> {
    const [profile] = await this.db.select().from(helperProfiles).where(eq(helperProfiles.userId, user.id));
    if (!profile) {
      throw new ApiException(409, 'conflict', 'Apply to be a helper before uploading documents.');
    }
    // The key says nothing about whose document it is.
    const storageKey = `${randomUUID()}.${file.contentType.split('/')[1]}`;
    await this.disk.put(storageKey, file.buffer, { contentType: file.contentType });

    const [previous] = await this.db
      .select({ storageKey: helperDocuments.storageKey })
      .from(helperDocuments)
      .where(and(eq(helperDocuments.helperId, profile.id), eq(helperDocuments.kind, kind)));
    const values = { storageKey, contentType: file.contentType, reviewStatus: 'pending' as const, reviewedBy: null };
    await this.db
      .insert(helperDocuments)
      .values({ helperId: profile.id, kind, ...values })
      .onConflictDoUpdate({ target: [helperDocuments.helperId, helperDocuments.kind], set: values });
    if (previous) {
      await this.disk.delete(previous.storageKey).catch(() => undefined);
    }
    await this.notifier.applicationsChanged();
    return (await this.profile(user))!;
  }

  // The verifier

  async applications(): Promise<HelperApplicationDetail[]> {
    const rows = await this.db
      .select({ profile: helperProfiles, name: users.name, phone: users.phone })
      .from(helperProfiles)
      .innerJoin(users, eq(helperProfiles.userId, users.id))
      .where(eq(helperProfiles.status, 'pending'))
      .orderBy(asc(helperProfiles.updatedAt));
    return Promise.all(
      rows.map(async ({ profile, name, phone }) => ({
        id: profile.id,
        phone,
        name,
        status: profile.status,
        claimsSkilled: profile.claimsSkilled,
        skills: profile.skills,
        emergencyContact: profile.emergencyContact,
        rejectionReason: profile.rejectionReason,
        appliedAt: profile.updatedAt.toISOString(),
        documents: await this.documents(profile.id),
      })),
    );
  }

  /** The image of a document, for a verifier to look at. The caller records the view. */
  async openDocument(documentId: string): Promise<{ body: Readable; contentType: string; helperId: string }> {
    const [document] = await this.db.select().from(helperDocuments).where(eq(helperDocuments.id, documentId));
    if (!document) {
      throw new ApiException(404, 'not_found', 'Document not found.');
    }
    const { body } = await this.disk.get(document.storageKey);
    return { body, contentType: document.contentType, helperId: document.helperId };
  }

  /** Approves an application at a level, once the documents that level needs are there. */
  async approve(helperId: string, level: VerificationLevel, adminId: string): Promise<void> {
    const profile = await this.pending(helperId);
    const uploaded = (await this.documents(helperId)).map((document) => document.kind);
    const missing = DOCUMENTS_FOR_LEVEL[level].filter((kind) => !uploaded.includes(kind));
    if (missing.length > 0) {
      throw new ApiException(409, 'documents_missing', `This level needs: ${missing.join(', ')}.`, { missing });
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(helperProfiles)
        .set({
          status: 'active',
          verificationLevel: level,
          // Only a helper whose qualification was checked carries the skilled tag.
          skillTag: level === 'specialised' ? 'skilled' : 'unskilled',
          rejectionReason: null,
        })
        .where(eq(helperProfiles.id, helperId));
      await tx
        .update(helperDocuments)
        .set({ reviewStatus: 'approved', reviewedBy: adminId })
        .where(eq(helperDocuments.helperId, helperId));
      await tx
        .update(users)
        .set({ roles: sql`array(select distinct unnest(${users.roles} || 'helper'::user_role))` })
        .where(eq(users.id, profile.userId));
    });
    await this.notifier.profileChanged(profile.userId);
  }

  async reject(helperId: string, reason: string): Promise<void> {
    const profile = await this.pending(helperId);
    await this.db
      .update(helperProfiles)
      .set({ status: 'rejected', rejectionReason: reason })
      .where(eq(helperProfiles.id, helperId));
    await this.notifier.profileChanged(profile.userId);
  }

  private async pending(helperId: string) {
    const [profile] = await this.db.select().from(helperProfiles).where(eq(helperProfiles.id, helperId));
    if (!profile) {
      throw notFound();
    }
    if (profile.status !== 'pending') {
      throw new ApiException(409, 'conflict', 'This application has already been decided.');
    }
    return profile;
  }

  private documents(helperId: string) {
    return this.db
      .select({ id: helperDocuments.id, kind: helperDocuments.kind, reviewStatus: helperDocuments.reviewStatus })
      .from(helperDocuments)
      .where(eq(helperDocuments.helperId, helperId))
      .orderBy(asc(helperDocuments.kind));
  }
}
