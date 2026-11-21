import type { INestApplication } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { apiErrorSchema } from '@sibimate/shared';
import { z } from 'zod';

type SchemaObject = Record<string, unknown>;

/** A Zod schema as an OpenAPI 3.0 schema, describing what the API sends. */
function toOpenApi(schema: z.ZodType): SchemaObject {
  const { $schema: _, ...converted } = z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'output' });
  return tidy(converted) as SchemaObject;
}

/**
 * Drops what only makes the document harder to read or use: the long patterns
 * Zod adds beside a `format` that already says it, and `additionalProperties:
 * false` on responses, so a client keeps working when the API adds a field.
 */
function tidy(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(tidy);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([key, item]) =>
      !(key === 'additionalProperties' && item === false) && !(key === 'pattern' && 'format' in (value as object)),
  );
  return Object.fromEntries(entries.map(([key, item]) => [key, tidy(item)]));
}

/**
 * The body a route answers with. Request bodies, queries and parameters are
 * read from the route's own schemas; responses need saying, since a return
 * type is gone at runtime.
 */
export const ApiResult = (schema: z.ZodType, status = 200) =>
  ApiResponse({ status, description: status === 201 ? 'Created' : 'OK', schema: toOpenApi(schema) });

/** Signed in to the app: the access token from OTP sign-in. */
export const UserAuth = () => ApiBearerAuth('user');
/** Signed in to the dashboard: the token from admin sign-in. */
export const AdminAuth = () => ApiBearerAuth('admin');

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Sibimate API')
    .setDescription(
      'The API behind the Sibimate app and admin dashboard. Every error has the ApiError shape, with a stable `code` the clients translate.',
    )
    .setVersion('1')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'user')
    .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'admin')
    .build();
  const document = SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controller, method) => `${controller.replace(/Controller$/, '')}_${method}`,
  });

  // One error shape for every route.
  document.components = {
    ...document.components,
    schemas: { ...document.components?.schemas, ApiError: toOpenApi(apiErrorSchema) },
  };
  for (const item of Object.values(document.paths)) {
    for (const method of ['get', 'put', 'post', 'patch', 'delete'] as const) {
      const operation = item[method];
      if (operation) {
        // Every id in a path is a UUID; the pipes that check it are invisible to the document.
        for (const parameter of operation.parameters ?? []) {
          if ('in' in parameter && parameter.in === 'path' && /id$/i.test(parameter.name)) {
            parameter.schema = { type: 'string', format: 'uuid' };
          }
        }
        operation.responses = {
          ...operation.responses,
          default: {
            description: 'An error',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
          },
        };
      }
    }
  }
  return document;
}

/** The document as the committed openapi.json holds it. */
export function openApiJson(app: INestApplication): string {
  return `${JSON.stringify(createOpenApiDocument(app), null, 2)}\n`;
}
