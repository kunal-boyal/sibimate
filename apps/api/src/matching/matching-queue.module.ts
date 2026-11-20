import { BullModule } from '@nestjs/bullmq';
import { type DynamicModule, Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ENV, type Env } from '../config/env.js';
import { EventBus, InProcessEventBus, REDIS, RedisEventBus } from '../live/event-bus.js';
import { Notifier } from '../live/notifier.js';
import {
  BullMqMatchingScheduler,
  InlineMatchingScheduler,
  MATCHING_QUEUE,
  MatchingScheduler,
} from './matching-scheduler.js';

/** Closes the Redis connection when the process stops, so it can exit. */
@Injectable()
class RedisLifecycle implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown() {
    await this.redis.quit().catch(() => undefined);
  }
}

@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ENV],
      // BullMQ needs a client that never gives up on a blocked request.
      useFactory: (env: Env) => new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }),
    },
    RedisLifecycle,
  ],
  exports: [REDIS],
})
class RedisModule {}

/**
 * Provides MatchingScheduler, and the event bus that carries live updates, everywhere. With MATCHING_QUEUE=redis it is backed
 * by a BullMQ queue; with inline it needs no Redis. Which one is decided when
 * this file is imported, because the Redis connection is itself a module: the
 * variable must be set before the process starts (--env-file does that).
 */
@Global()
@Module({})
export class MatchingQueueModule {
  static register(): DynamicModule {
    if (process.env.MATCHING_QUEUE === 'inline') {
      return {
        module: MatchingQueueModule,
        providers: [
          { provide: MatchingScheduler, useClass: InlineMatchingScheduler },
          { provide: EventBus, useClass: InProcessEventBus },
          Notifier,
        ],
        exports: [MatchingScheduler, EventBus, Notifier],
      };
    }
    return {
      module: MatchingQueueModule,
      imports: [
        BullModule.forRootAsync({
          imports: [RedisModule],
          inject: [REDIS],
          useFactory: (connection: Redis) => ({ connection }),
        }),
        BullModule.registerQueue({ name: MATCHING_QUEUE }),
        RedisModule,
      ],
      providers: [
        { provide: MatchingScheduler, useClass: BullMqMatchingScheduler },
        { provide: EventBus, useClass: RedisEventBus },
        Notifier,
      ],
      exports: [MatchingScheduler, EventBus, Notifier, BullModule],
    };
  }
}
