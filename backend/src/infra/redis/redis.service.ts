import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { Env } from '../../config/env.config';

/**
 * Shared Redis connection for health checks and, from Phase 6, BullMQ queues,
 * rate limiting and the Socket.IO adapter.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(config: ConfigService<Env, true>) {
    this.client = new Redis(config.get('REDIS_URL', { infer: true }), {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
      retryStrategy: (attempt) => Math.min(attempt * 200, 2000),
    });
    this.client.on('error', (error) => this.logger.warn(`Redis error: ${error.message}`));
    this.client.on('connect', () => this.logger.log('Redis connected'));
  }

  async ping(): Promise<{ ok: boolean; latencyMs: number }> {
    const startedAt = Date.now();
    try {
      const reply = await this.client.ping();
      return { ok: reply === 'PONG', latencyMs: Date.now() - startedAt };
    } catch {
      return { ok: false, latencyMs: Date.now() - startedAt };
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => undefined);
  }
}
