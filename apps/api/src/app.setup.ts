import { type INestApplication, StandardSchemaValidationPipe } from '@nestjs/common';
import { ApiException } from './common/api-exception.js';
import { ApiExceptionFilter } from './common/api-exception.filter.js';

/** Everything main.ts and the e2e tests must configure the same way. */
export function setupApp(app: INestApplication) {
  app.setGlobalPrefix('v1');
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalPipes(
    new StandardSchemaValidationPipe({
      exceptionFactory: (issues) =>
        new ApiException(
          400,
          'validation_failed',
          'Validation failed',
          issues.map((issue) => ({
            path: issue.path?.map((segment) => (typeof segment === 'object' ? segment.key : segment)).join('.'),
            message: issue.message,
          })),
        ),
    }),
  );
  app.enableShutdownHooks();
}
