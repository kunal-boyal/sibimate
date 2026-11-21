import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { setupApp } from './app.setup.js';
import { ENV, type Env } from './config/env.js';
import { createOpenApiDocument } from './openapi/openapi.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  setupApp(app);
  const env = app.get<Env>(ENV);
  if (env.CORS_ORIGINS.length > 0) {
    app.enableCors({ origin: env.CORS_ORIGINS });
  }
  // Outside production, /docs shows the API and /docs/openapi.json serves the document.
  if (env.NODE_ENV !== 'production') {
    SwaggerModule.setup('docs', app, () => createOpenApiDocument(app), {
      jsonDocumentUrl: 'docs/openapi.json',
      raw: ['json'],
      customSiteTitle: 'Sibimate API',
    });
  }
  await app.listen(env.PORT);
}
await bootstrap();
