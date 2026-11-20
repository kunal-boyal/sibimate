import {
  type Admin,
  type AdminLogin,
  type AdminTaskList,
  type CreateHelper,
  type ErrorCode,
  type Helper,
  type AdminCategory,
  type AuditEntry,
  auditListSchema,
  type AdminDispute,
  type ApproveCategory,
  adminCategoryListSchema,
  type AdminOverview,
  type DisputeResolution,
  adminDisputeListSchema,
  adminOverviewSchema,
  type HelperApplicationDetail,
  type PlatformSettingsResponse,
  type UpdatePlatformSettings,
  platformSettingsResponseSchema,
  type VerificationLevel,
  helperApplicationDetailSchema,
  type HelperList,
  adminLoginResponseSchema,
  adminSchema,
  adminTaskListSchema,
  apiErrorSchema,
  helperListSchema,
  helperSchema,
} from '@sibimate/shared';
import { z } from 'zod';

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000/v1';
export const API_ORIGIN = new URL(BASE_URL).origin;
const TOKEN_KEY = 'sibimate.admin.token';

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | 'network',
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

// The session lives for this browser tab only: closing the tab signs the admin out here.
export const session = {
  get: () => sessionStorage.getItem(TOKEN_KEY),
  set: (token: string) => sessionStorage.setItem(TOKEN_KEY, token),
  clear: () => sessionStorage.removeItem(TOKEN_KEY),
};

/** Called when the API says the session has ended, so the app can show the sign-in page. */
let onSignedOut = () => {};
export function setOnSignedOut(handler: () => void) {
  onSignedOut = handler;
}

async function request<S extends z.ZodType | undefined = undefined>(
  path: string,
  { method = 'GET', body, schema }: { method?: string; body?: unknown; schema?: S } = {},
): Promise<S extends z.ZodType ? z.infer<S> : void> {
  const token = session.get();
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('network', 'The API could not be reached. Check that it is running.');
  }
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
    if (response.status === 401 && token && !path.startsWith('/admin/auth/')) {
      session.clear();
      onSignedOut();
    }
    throw parsed.success
      ? new ApiError(parsed.data.code, parsed.data.message, response.status)
      : new ApiError('internal', `The request failed with status ${response.status}.`, response.status);
  }
  return (schema ? schema.parse(await response.json()) : undefined) as S extends z.ZodType ? z.infer<S> : void;
}

export const api = {
  login: (credentials: AdminLogin) =>
    request('/admin/auth/login', { method: 'POST', body: credentials, schema: adminLoginResponseSchema }),
  logout: () => request('/admin/auth/logout', { method: 'POST' }),
  me: (): Promise<Admin> => request('/admin/me', { schema: adminSchema }),
  tasks: (status: 'unassigned' | 'active' | 'all'): Promise<AdminTaskList> =>
    request(`/admin/tasks?status=${status}`, { schema: adminTaskListSchema }),
  assign: (taskId: string, helperId: string) =>
    request(`/admin/tasks/${taskId}/assign`, { method: 'POST', body: { helperId } }),
  helpers: (): Promise<HelperList> => request('/admin/helpers', { schema: helperListSchema }),
  categories: (): Promise<{ items: AdminCategory[] }> =>
    request('/admin/categories', { schema: adminCategoryListSchema }),
  approveCategory: (id: string, changes: ApproveCategory) =>
    request(`/admin/categories/${id}/approve`, { method: 'POST', body: changes }),
  mergeCategory: (id: string, intoId: string) =>
    request(`/admin/categories/${id}/merge`, { method: 'POST', body: { intoId } }),
  audit: (): Promise<{ items: AuditEntry[] }> => request('/admin/audit', { schema: auditListSchema }),
  overview: (): Promise<AdminOverview> => request('/admin/overview', { schema: adminOverviewSchema }),
  disputes: (status: 'open' | 'resolved'): Promise<{ items: AdminDispute[] }> =>
    request(`/admin/disputes?status=${status}`, { schema: adminDisputeListSchema }),
  resolveDispute: (id: string, resolution: DisputeResolution, note: string) =>
    request(`/admin/disputes/${id}/resolve`, { method: 'POST', body: { resolution, note } }),
  settings: (): Promise<PlatformSettingsResponse> =>
    request('/admin/settings', { schema: platformSettingsResponseSchema }),
  updateSettings: (changes: UpdatePlatformSettings): Promise<PlatformSettingsResponse> =>
    request('/admin/settings', { method: 'PUT', body: changes, schema: platformSettingsResponseSchema }),
  applications: (): Promise<{ items: HelperApplicationDetail[] }> =>
    request('/admin/applications', { schema: z.object({ items: z.array(helperApplicationDetailSchema) }) }),
  approveApplication: (id: string, verificationLevel: VerificationLevel) =>
    request(`/admin/applications/${id}/approve`, { method: 'POST', body: { verificationLevel } }),
  rejectApplication: (id: string, reason: string) =>
    request(`/admin/applications/${id}/reject`, { method: 'POST', body: { reason } }),
  /** A document's image. It is fetched with the admin's token, so it cannot be an ordinary image link. */
  documentImage: async (id: string): Promise<Blob> => {
    const response = await fetch(`${BASE_URL}/admin/documents/${id}/file`, {
      headers: { Authorization: `Bearer ${session.get() ?? ''}` },
    });
    if (!response.ok) {
      const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
      throw new ApiError(
        parsed.success ? parsed.data.code : 'internal',
        parsed.success ? parsed.data.message : 'The document could not be opened.',
        response.status,
      );
    }
    return response.blob();
  },
  createHelper: (helper: CreateHelper): Promise<Helper> =>
    request('/admin/helpers', { method: 'POST', body: helper, schema: helperSchema }),
};
