import { type CanActivate, type ExecutionContext, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Admin, AdminRole } from '@sibimate/shared';
import type { Request } from 'express';
import { ApiException } from '../common/api-exception.js';
import { AdminAuthService } from './admin-auth.service.js';

type AdminRequest = Request & { admin?: Admin; adminToken?: string };

const ROLES_KEY = 'adminRoles';

/** Limits a route to these roles. Without it, any signed-in admin may call the route. */
export const AdminRoles = (...roles: AdminRole[]) => SetMetadata(ROLES_KEY, roles);

/** The signed-in admin, on a route behind AdminGuard. */
export const CurrentAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => context.switchToHttp().getRequest<AdminRequest>().admin,
);

/** The session token the request came with, for signing out. */
export const AdminToken = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => context.switchToHttp().getRequest<AdminRequest>().adminToken,
);

/**
 * Signs in dashboard requests from their session token. Admin routes are
 * marked @Public() for the app's own guard, and use this one instead: an app
 * user's token is never accepted here, and an admin's never works in the app.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly adminAuth: AdminAuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    const admin = scheme === 'Bearer' && token ? await this.adminAuth.findBySession(token) : undefined;
    if (!admin) {
      throw new ApiException(401, 'unauthorized', 'Sign in to the dashboard.');
    }
    const roles = this.reflector.getAllAndOverride<AdminRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles && !roles.includes(admin.role)) {
      throw new ApiException(403, 'forbidden', 'Your role cannot do this.');
    }
    request.admin = admin;
    request.adminToken = token;
    return true;
  }
}
