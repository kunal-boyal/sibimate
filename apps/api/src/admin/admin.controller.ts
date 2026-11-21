import { Public } from '@nestjs/authentication';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  type Admin,
  type AdminListTasksQuery,
  type AdminTaskList,
  type ApproveHelper,
  type AssignHelper,
  type AdminCategory,
  type AuditEntry,
  type AdminDispute,
  type ApproveCategory,
  type MergeCategory,
  approveCategorySchema,
  mergeCategorySchema,
  type AdminOverview,
  type HelperApplicationDetail,
  type ResolveDispute,
  resolveDisputeSchema,
  type PlatformSettingsResponse,
  type UpdatePlatformSettings,
  updatePlatformSettingsSchema,
  type RejectHelper,
  approveHelperSchema,
  rejectHelperSchema,
  type Helper,
  type HelperList,
  adminListTasksQuerySchema,
  assignHelperSchema,
  createHelperSchema,
  type SearchArea,
  searchAreaSchema,
  type AdminCustomerList,
  type AdminCustomerQuery,
  type BlockCustomer,
  adminCustomerQuerySchema,
  blockCustomerSchema,
} from '@sibimate/shared';
import type { z } from 'zod';
import { BookingsService } from '../bookings/bookings.service.js';
import { ApiException } from '../common/api-exception.js';
import { HelpersService } from '../helpers/helpers.service.js';
import { MatchingService } from '../matching/matching.service.js';
import { OnboardingService } from '../onboarding/onboarding.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { DisputesService } from '../disputes/disputes.service.js';
import { CategoriesService } from './categories.service.js';
import { CustomersService } from './customers.service.js';
import { OverviewService } from './overview.service.js';
import { AuditService } from './audit.service.js';
import { AdminGuard, AdminRoles, CurrentAdmin } from './admin.guard.js';

const Uuid = (what: string) =>
  new ParseUUIDPipe({ exceptionFactory: () => new ApiException(404, 'not_found', `${what} not found.`) });

/** The dashboard's routes. Every one needs a signed-in admin. */
@Public()
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly bookingsService: BookingsService,
    private readonly helpersService: HelpersService,
    private readonly onboarding: OnboardingService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly disputes: DisputesService,
    private readonly overview: OverviewService,
    private readonly categories: CategoriesService,
    private readonly matching: MatchingService,
    private readonly customers: CustomersService,
  ) {}

  @Get('tasks')
  async tasks(@Query({ schema: adminListTasksQuerySchema }) query: AdminListTasksQuery): Promise<AdminTaskList> {
    return { items: await this.bookingsService.listForAdmin(query) };
  }

  @Post('tasks/:id/assign')
  @HttpCode(204)
  @AdminRoles('owner', 'operations')
  async assign(
    @CurrentAdmin() admin: Admin,
    @Param('id', new ParseUUIDPipe({ exceptionFactory: () => new ApiException(404, 'not_found', 'Task not found.') }))
    id: string,
    @Body({ schema: assignHelperSchema }) body: AssignHelper,
  ): Promise<void> {
    await this.bookingsService.assign(id, body.helperId, admin.id);
    await this.audit.record(admin, 'task.assign', 'task', id, { helperId: body.helperId });
  }

  /** Searches further for a task no helper has taken, including one that expired. */
  @Post('tasks/:id/widen')
  @HttpCode(204)
  @AdminRoles('owner', 'operations')
  async widen(
    @CurrentAdmin() admin: Admin,
    @Param('id', Uuid('Task')) id: string,
    @Body({ schema: searchAreaSchema }) body: SearchArea,
  ): Promise<void> {
    await this.matching.widenForAdmin(id, body.radiusM, admin.id);
    await this.audit.record(admin, 'task.widen', 'task', id, { radiusM: body.radiusM });
  }

  @Get('helpers')
  async helpers(): Promise<HelperList> {
    return { items: await this.helpersService.list() };
  }

  @Post('helpers')
  @AdminRoles('owner', 'operations', 'verifier')
  async createHelper(
    @CurrentAdmin() admin: Admin,
    @Body({ schema: createHelperSchema }) body: z.output<typeof createHelperSchema>,
  ): Promise<Helper> {
    const helper = await this.helpersService.create(body);
    await this.audit.record(admin, 'helper.create', 'helper', helper.id, {
      verificationLevel: helper.verificationLevel,
    });
    return helper;
  }

  @Get('customers')
  async listCustomers(
    @Query({ schema: adminCustomerQuerySchema }) query: AdminCustomerQuery,
  ): Promise<AdminCustomerList> {
    return { items: await this.customers.list(query) };
  }

  /** Signs the person out everywhere and stops them signing in; their untaken tasks are cancelled. */
  @Post('customers/:id/block')
  @HttpCode(200)
  @AdminRoles('owner', 'operations')
  async blockCustomer(
    @CurrentAdmin() admin: Admin,
    @Param('id', Uuid('Customer')) id: string,
    @Body({ schema: blockCustomerSchema }) body: BlockCustomer,
  ): Promise<{ cancelledTasks: number }> {
    const result = await this.customers.block(id, body.reason, admin.id);
    await this.audit.record(admin, 'user.block', 'user', id, { reason: body.reason, ...result });
    return result;
  }

  @Post('customers/:id/unblock')
  @HttpCode(204)
  @AdminRoles('owner', 'operations')
  async unblockCustomer(@CurrentAdmin() admin: Admin, @Param('id', Uuid('Customer')) id: string): Promise<void> {
    await this.customers.unblock(id);
    await this.audit.record(admin, 'user.unblock', 'user', id, {});
  }

  @Get('overview')
  getOverview(): Promise<AdminOverview> {
    return this.overview.get();
  }

  @Get('disputes')
  async listDisputes(@Query('status') status?: string): Promise<{ items: AdminDispute[] }> {
    return { items: await this.disputes.list(status === 'resolved' ? 'resolved' : 'open') };
  }

  /** Decides a dispute: the helper is owed the price (release), or the customer owes nothing (refund). */
  @Post('disputes/:id/resolve')
  @HttpCode(204)
  @AdminRoles('owner', 'operations')
  async resolveDispute(
    @CurrentAdmin() admin: Admin,
    @Param('id', Uuid('Dispute')) id: string,
    @Body({ schema: resolveDisputeSchema }) body: ResolveDispute,
  ): Promise<void> {
    await this.disputes.resolve(id, body.resolution, body.note, admin.id);
    await this.audit.record(admin, 'dispute.resolve', 'dispute', id, { resolution: body.resolution });
  }

  @Get('categories')
  async listCategories(): Promise<{ items: AdminCategory[] }> {
    return { items: await this.categories.list() };
  }

  /** Approves a category the model proposed, with any corrections, so it is offered from now on. */
  @Post('categories/:id/approve')
  @HttpCode(204)
  @AdminRoles('owner', 'operations')
  async approveCategory(
    @CurrentAdmin() admin: Admin,
    @Param('id', Uuid('Category')) id: string,
    @Body({ schema: approveCategorySchema }) body: ApproveCategory,
  ): Promise<void> {
    await this.categories.approve(id, body);
    await this.audit.record(admin, 'category.approve', 'task_category', id, body);
  }

  /** Folds a proposed category into an existing one; its tasks move across. */
  @Post('categories/:id/merge')
  @HttpCode(204)
  @AdminRoles('owner', 'operations')
  async mergeCategory(
    @CurrentAdmin() admin: Admin,
    @Param('id', Uuid('Category')) id: string,
    @Body({ schema: mergeCategorySchema }) body: MergeCategory,
  ): Promise<void> {
    await this.categories.merge(id, body.intoId);
    await this.audit.record(admin, 'category.merge', 'task_category', id, { intoId: body.intoId });
  }

  /** What admins did and which documents they opened. Owners only. */
  @Get('audit')
  @AdminRoles('owner')
  async auditLog(): Promise<{ items: AuditEntry[] }> {
    return { items: await this.audit.recent() };
  }

  @Get('settings')
  getSettings(): Promise<PlatformSettingsResponse> {
    return this.settings.get();
  }

  /** Changes the platform's rules. Owners and finance only; each change is recorded with its old value. */
  @Put('settings')
  @AdminRoles('owner', 'finance')
  updateSettings(
    @CurrentAdmin() admin: Admin,
    @Body({ schema: updatePlatformSettingsSchema }) body: UpdatePlatformSettings,
  ): Promise<PlatformSettingsResponse> {
    return this.settings.update(admin, body);
  }

  /** Applications waiting for a decision, oldest first. */
  @Get('applications')
  async applications(): Promise<{ items: HelperApplicationDetail[] }> {
    return { items: await this.onboarding.applications() };
  }

  /** A document's image. Only owners and verifiers may open one, and every view is recorded. */
  @Get('documents/:id/file')
  @AdminRoles('owner', 'verifier')
  async document(@CurrentAdmin() admin: Admin, @Param('id', Uuid('Document')) id: string): Promise<StreamableFile> {
    const { body, contentType, helperId } = await this.onboarding.openDocument(id);
    await this.audit.record(admin, 'document.view', 'helper_document', id, { helperId });
    return new StreamableFile(body, { type: contentType, disposition: 'inline' });
  }

  @Post('applications/:id/approve')
  @HttpCode(204)
  @AdminRoles('owner', 'verifier')
  async approve(
    @CurrentAdmin() admin: Admin,
    @Param('id', Uuid('Application')) id: string,
    @Body({ schema: approveHelperSchema }) body: ApproveHelper,
  ): Promise<void> {
    await this.onboarding.approve(id, body.verificationLevel, admin.id);
    await this.audit.record(admin, 'helper.approve', 'helper', id, { verificationLevel: body.verificationLevel });
  }

  @Post('applications/:id/reject')
  @HttpCode(204)
  @AdminRoles('owner', 'verifier')
  async reject(
    @CurrentAdmin() admin: Admin,
    @Param('id', Uuid('Application')) id: string,
    @Body({ schema: rejectHelperSchema }) body: RejectHelper,
  ): Promise<void> {
    await this.onboarding.reject(id, body.reason);
    await this.audit.record(admin, 'helper.reject', 'helper', id, { reason: body.reason });
  }
}
