import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { ApiError, ErrorCode } from '@sibimate/shared';
import type { Response } from 'express';
import { ApiException } from './api-exception.js';

const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: 'validation_failed',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  429: 'rate_limited',
};

/** Gives every error the same body: { code, message, details }. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof ApiException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body: ApiError = {
        code: CODE_BY_STATUS[status] ?? (status >= 500 ? 'internal' : 'validation_failed'),
        message: exception.message,
      };
      response.status(status).json(body);
      return;
    }

    this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    response.status(500).json({
      code: 'internal',
      message: 'Something went wrong',
    } satisfies ApiError);
  }
}
