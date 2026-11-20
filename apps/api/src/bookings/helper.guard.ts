import { type CanActivate, type ExecutionContext, Injectable, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import { ApiException } from '../common/api-exception.js';
import type { HelperProfileRow, UserRow } from '../db/schema.js';
import { HelpersService } from '../helpers/helpers.service.js';

type HelperRequest = Request & { user?: UserRow; helper?: HelperProfileRow };

/** The signed-in user's helper profile, on a route behind HelperGuard. */
export const CurrentHelper = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => context.switchToHttp().getRequest<HelperRequest>().helper,
);

/**
 * Lets only approved helpers through. The Hire and Earn switch in the app is a
 * view setting; this check runs on every helper route.
 */
@Injectable()
export class HelperGuard implements CanActivate {
  constructor(private readonly helpers: HelpersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<HelperRequest>();
    const helper = request.user && (await this.helpers.findActiveByUser(request.user.id));
    if (!helper) {
      throw new ApiException(403, 'forbidden', 'Only approved helpers can do this.');
    }
    request.helper = helper;
    return true;
  }
}
