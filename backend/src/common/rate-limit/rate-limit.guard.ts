import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { RedisService } from '../../infra/redis/redis.service';
import { AppError } from '../errors/app-error';
import { RATE_LIMIT_KEY, type RateLimitOptions } from './rate-limit.decorator';

/**
 * Redis-backed fixed-window rate limiter.
 *
 * Why Redis and not in-memory: the API will run more than one process, and a
 * per-process counter would multiply the effective limit by the number of
 * instances. Redis gives one shared, atomic counter.
 *
 * INCR + EXPIRE is done with SET NX / INCR semantics so the first hit of a window
 * always sets the expiry — no permanent lockout from a lost EXPIRE.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return true;

    const request = context.switchToHttp().getRequest<Request & { body?: Record<string, unknown> }>();
    const route = `${request.method}:${request.route?.path ?? request.path}`;
    const ip = (request.ip ?? request.socket.remoteAddress ?? 'unknown').replace(/^::ffff:/, '');

    let subject = ip;
    if (options.keyBy === 'ip+route') subject = `${ip}|${route}`;
    if (options.keyBy === 'body') {
      const field = options.bodyField ?? 'identifier';
      const raw = request.body?.[field] ?? request.body?.email ?? request.body?.phone ?? 'anonymous';
      subject = `${ip}|${String(raw).toLowerCase().slice(0, 80)}`;
    }

    const bucket = createHash('sha256').update(`${route}|${subject}`).digest('hex').slice(0, 32);
    const key = `ratelimit:${bucket}`;

    const count = await this.redis.client.incr(key);
    if (count === 1) {
      await this.redis.client.expire(key, options.windowSeconds);
    }

    if (count > options.points) {
      const ttl = await this.redis.client.ttl(key);
      throw new AppError(
        'RATE_LIMITED',
        options.message ?? `Too many attempts. Please wait ${Math.max(ttl, 1)} seconds and try again.`,
        429,
      );
    }

    return true;
  }
}
