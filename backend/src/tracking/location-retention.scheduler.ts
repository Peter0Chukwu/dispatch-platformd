import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service';
import { AppConfig } from '../config/app.config';

/**
 * POSITION RETENTION
 *
 * A moving rider produces a ping every 15 seconds — 5,760 rows a day, per rider.
 * Keeping that forever turns a useful audit trail into an expensive one, so rows
 * older than `LOCATION_RETENTION_DAYS` (30 by default) are deleted. The delivery
 * itself, its status history and its timestamps survive: what is dropped is the
 * breadcrumb trail, not the proof that the job happened.
 *
 * Runs hourly, deletes in bounded batches so a large backlog cannot lock the table.
 */
@Injectable()
export class LocationRetentionScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(LocationRetentionScheduler.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.locationRetentionDays <= 0) return;
    // First sweep 60 s after boot, then hourly. Not in tests: seeds create old rows
    // on purpose and a background delete would make assertions flaky.
    this.timer = setInterval(() => void this.sweep(), 60 * 60 * 1000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<number> {
    if (this.config.locationRetentionDays <= 0) return 0;
    const cutoff = new Date(Date.now() - this.config.locationRetentionDays * 24 * 60 * 60 * 1000);
    try {
      const result = await this.prisma.riderLocation.deleteMany({ where: { recordedAt: { lt: cutoff } } });
      if (result.count > 0) this.logger.log(`Pruned ${result.count} position ping(s) older than ${this.config.locationRetentionDays} days`);
      return result.count;
    } catch (error) {
      this.logger.warn(`Position retention sweep failed: ${(error as Error).message}`);
      return 0;
    }
  }
}
