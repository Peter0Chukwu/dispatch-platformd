import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service';
import { RedisService } from '../infra/redis/redis.service';
import { AppConfig } from '../config/app.config';
import { Public } from '../auth/decorators/public.decorator';

type CheckResult = { ok: boolean; latencyMs: number };

/**
 * GET /api/v1/health
 *
 * The single source of truth for "is the platform actually up". It touches the
 * database and Redis on every call, so it cannot report healthy while a
 * dependency is down. Used by the deployment platform, monitoring and CI.
 */
@Public()
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: AppConfig,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async health() {
    const [database, cache]: [CheckResult, CheckResult] = await Promise.all([
      this.prisma.ping(),
      this.redis.ping(),
    ]);

    const healthy = database.ok && cache.ok;

    return {
      status: healthy ? 'ok' : 'degraded',
      service: this.config.appName,
      version: process.env.npm_package_version ?? '0.1.0',
      environment: this.config.nodeEnv,
      integrations: {
        payments: this.config.paymentsMode,
        maps: this.config.mapsProvider,
        sms: this.config.smsMode,
        email: this.config.emailMode,
      },
      checks: { database, redis: cache },
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  /** Liveness probe: cheap, no dependencies. Used by container orchestrators. */
  @Get('live')
  live() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
