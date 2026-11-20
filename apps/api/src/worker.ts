// The worker process: the same code as the API, started without an HTTP server,
// taking matching jobs from the Redis queue. A slow job delays other jobs and
// never a customer's request.
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ENV, type Env } from './config/env.js';
import { MatchingModule } from './matching/matching.module.js';
import { MatchingProcessor } from './matching/matching.processor.js';

@Module({
  imports: [AppModule, MatchingModule],
  providers: [MatchingProcessor],
})
class WorkerModule {}

if (process.env.MATCHING_QUEUE === 'inline') {
  console.error(
    'MATCHING_QUEUE=inline runs matching inside the API process. Set MATCHING_QUEUE=redis to use the worker.',
  );
  process.exit(1);
}

const app = await NestFactory.createApplicationContext(WorkerModule);
app.enableShutdownHooks();
console.log(`Worker ready, taking matching jobs from ${new URL(app.get<Env>(ENV).REDIS_URL).host}`);
