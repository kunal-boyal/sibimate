import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { Redis } from 'ioredis';

/**
 * Something a signed-in client should hear about. Events say that something
 * changed, and for whom; the client then fetches what it is allowed to see
 * through the ordinary API, so no private detail travels in an event.
 */
export interface LiveEvent {
  /** App users to tell, by user id. */
  userIds: string[];
  /** Whether dashboards are told too. */
  admins: boolean;
  name: 'task.changed' | 'helper.location' | 'profile.changed' | 'applications.changed';
  data: Record<string, unknown>;
}

export type LiveEventHandler = (event: LiveEvent) => void;

/** Carries events from wherever they happen (the API or the worker) to the process holding the sockets. */
export abstract class EventBus {
  abstract publish(event: LiveEvent): Promise<void>;
  abstract subscribe(handler: LiveEventHandler): void;
}

/** For one process: development with MATCHING_QUEUE=inline, and tests. */
@Injectable()
export class InProcessEventBus extends EventBus {
  private readonly handlers = new Set<LiveEventHandler>();

  async publish(event: LiveEvent): Promise<void> {
    for (const handler of this.handlers) {
      handler(event);
    }
  }

  subscribe(handler: LiveEventHandler): void {
    this.handlers.add(handler);
  }
}

export const REDIS = Symbol('REDIS');
const CHANNEL = 'sibimate:live';

/** Across processes, over Redis publish and subscribe, so the worker's events reach the API's sockets. */
@Injectable()
export class RedisEventBus extends EventBus implements OnModuleDestroy {
  private subscriber?: Redis;

  constructor(@Inject(REDIS) private readonly redis: Redis) {
    super();
  }

  async publish(event: LiveEvent): Promise<void> {
    await this.redis.publish(CHANNEL, JSON.stringify(event));
  }

  subscribe(handler: LiveEventHandler): void {
    // A connection that subscribes can do nothing else, so it gets its own.
    this.subscriber ??= this.redis.duplicate();
    void this.subscriber.subscribe(CHANNEL);
    this.subscriber.on('message', (_channel, message) => handler(JSON.parse(message) as LiveEvent));
  }

  async onModuleDestroy() {
    await this.subscriber?.quit().catch(() => undefined);
  }
}
