import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service';

/**
 * THE EARNINGS HOLD
 *
 * A delivery that completes at 23:50 should not be withdrawable at 23:51 — the
 * hold window (`finance.earningsHoldHours`, 24 h by default) exists so a failed
 * delivery or a chargeback can be handled before the rider is paid.
 *
 * This sweep flips matured earnings from PENDING to AVAILABLE. It runs lazily:
 * once at boot, then on a timer, and the read paths call it too, so a rider who
 * opens the app at 09:00 sees the right number even if the timer has not fired.
 */
@Injectable()
export class EarningsScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(EarningsScheduler.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    if (process.env.FINANCE_SCHEDULER === 'off') {
      this.logger.warn('Earnings sweep disabled (FINANCE_SCHEDULER=off)');
      return;
    }
    void this.releaseMatured();
    this.timer = setInterval(() => void this.releaseMatured(), 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Idempotent: only rows still PENDING and past their hold are touched. */
  async releaseMatured(): Promise<number> {
    try {
      const result = await this.prisma.riderEarning.updateMany({
        where: { status: 'PENDING', availableAt: { lte: new Date() } },
        data: { status: 'AVAILABLE' },
      });
      if (result.count > 0) {
        this.logger.log(`${result.count} earning(s) became withdrawable`);
      }
      return result.count;
    } catch (error) {
      this.logger.warn(`Earnings sweep failed: ${(error as Error).message}`);
      return 0;
    }
  }
}
