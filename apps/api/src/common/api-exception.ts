import { HttpException } from '@nestjs/common';
import type { ApiError, ErrorCode } from '@sibimate/shared';

/** An error with one of the stable codes the clients translate. */
export class ApiException extends HttpException {
  constructor(
    status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super({ code, message, details } satisfies ApiError, status);
  }
}
