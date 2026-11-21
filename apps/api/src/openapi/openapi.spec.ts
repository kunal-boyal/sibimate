import { readFile, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { OpenAPIObject } from '@nestjs/swagger';
import { AppModule } from '../app.module.js';
import { setupApp } from '../app.setup.js';
import { createOpenApiDocument, openApiJson } from './openapi.js';

const PUBLIC = [
  '/v1/health',
  '/v1/auth/otp/request',
  '/v1/auth/otp/verify',
  '/v1/auth/refresh',
  '/v1/auth/logout',
  '/v1/admin/auth/login',
];

describe('OpenAPI document', () => {
  let app: INestApplication;
  let document: OpenAPIObject;
  const operations = () =>
    Object.entries(document.paths).flatMap(([path, item]) =>
      (['get', 'put', 'post', 'patch', 'delete'] as const).flatMap((method) =>
        item[method] ? [{ path, method, operation: item[method] }] : [],
      ),
    );

  beforeAll(async () => {
    // Preview mode reads the routes without connecting to anything.
    app = await NestFactory.create(AppModule, { preview: true, logger: false });
    setupApp(app);
    document = createOpenApiDocument(app);
  });

  afterAll(() => app.close());

  // `pnpm --filter @sibimate/api openapi` writes the file instead of checking it. This runs through
  // Vitest, which compiles in memory, so it never disturbs a dev server watching dist/.
  it('matches the committed openapi.json', async () => {
    const file = new URL('../../openapi.json', import.meta.url);
    if (process.env.UPDATE_OPENAPI) {
      await writeFile(file, openApiJson(app));
    }
    const committed = await readFile(file, 'utf8');
    // Compared as data, so reformatting the file does not matter.
    const current = isDeepStrictEqual(JSON.parse(committed), JSON.parse(openApiJson(app)));
    expect(current, 'Run `pnpm --filter @sibimate/api openapi` and commit openapi.json').toBe(true);
  });

  it('says which sign-in each route needs', () => {
    for (const { path, operation } of operations()) {
      const schemes = (operation.security ?? []).flatMap((requirement) => Object.keys(requirement));
      const expected = PUBLIC.includes(path) ? [] : path.startsWith('/v1/admin/') ? ['admin'] : ['user'];
      expect(schemes, path).toEqual(expected);
    }
  });

  it('describes the body of every response that has one, and the error shape', () => {
    for (const { path, method, operation } of operations()) {
      const ok = operation.responses['200'] ?? operation.responses['201'];
      if (ok) {
        expect('content' in ok && ok.content, `${method} ${path}`).toBeTruthy();
      } else {
        expect(operation.responses['204'], `${method} ${path}`).toBeDefined();
      }
      expect(operation.responses.default, `${method} ${path}`).toBeDefined();
    }
  });
});
