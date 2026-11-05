import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ReportsService } from './reports.service';

/**
 * THE REPORT WORKER
 *
 * A tick every two seconds claims the oldest QUEUED report and renders it. That is
 * all it does — no in-memory queue, no lost jobs on restart: the queue *is* the
 * `report_requests` table, so a deploy in the middle of a report leaves it QUEUED
 * (or PROCESSING, which `requeueStale` recovers) rather than vanishing.
 *
 * One report per tick is deliberate. A report is a read-heavy query; running five
 * at once to shave two seconds off the last one is how a reporting feature takes a
 * production database down.
 */
@Injectable()
export class ReportsScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ReportsScheduler.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly reports: ReportsService) {}

  onApplicationBootstrap(): void {
    if (process.env.REPORTS_WORKER === 'off') {
      this.logger.warn('Report worker disabled (REPORTS_WORKER=off)');
      return;
    }
    this.timer = setInterval(() => void this.tick(), 2000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass: recover anything stuck, then render at most one queued report. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.reports.requeueStale();
      await this.reports.processNextQueued();
    } catch (error) {
      this.logger.warn(`Report tick failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
