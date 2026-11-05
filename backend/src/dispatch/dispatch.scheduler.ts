import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { AppConfig } from '../config/app.config';
import { DispatchService } from './dispatch.service';

/**
 * THE HEARTBEAT
 *
 * Until this existed, a delivery was only offered to somebody when a rider
 * happened to open their phone or an admin refreshed a page. A paid booking could
 * sit untouched for minutes with riders online — the engine was manual.
 *
 * Every tick (5 s by default):
 *   1. offers past their deadline are expired;
 *   2. every PENDING delivery with nobody holding a live offer gets its next round
 *      (a wider radius, riders not asked a moment ago);
 *   3. if the last round found nobody, the dispatch desk is told, once.
 *
 * Safety notes:
 *   · Each delivery round takes a Redis lock, so running several API processes (or
 *     a hot reload overlapping a tick) cannot double-offer.
 *   · A tick never throws: a failure is logged and the next tick tries again.
 *   · In tests the timer is off. The suite calls `tick()` directly, which is why
 *     the engine's behaviour is provable without waiting on wall-clock time.
 */
@Injectable()
export class DispatchScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DispatchScheduler.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly dispatch: DispatchService,
    private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.DISPATCH_SCHEDULER === 'off') {
      this.logger.warn('Dispatch scheduler disabled (DISPATCH_SCHEDULER=off) — tests drive tick() directly');
      return;
    }

    const interval = this.config.dispatchTickMs;
    this.timer = setInterval(() => void this.tick(), interval);
    // Never hold the process open just for the heartbeat.
    this.timer.unref?.();
    this.logger.log(`Dispatch heart beating every ${interval} ms`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One pass. Overlapping ticks are skipped rather than queued. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.dispatch.tick();
    } catch (error) {
      this.logger.error(`Dispatch tick failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
