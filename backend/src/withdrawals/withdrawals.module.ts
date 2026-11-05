import { Module } from '@nestjs/common';
import { WithdrawalsService } from './withdrawals.service';
import { WithdrawalsController } from './withdrawals.controller';
import { EarningsScheduler } from './earnings.scheduler';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [RealtimeModule],
  controllers: [WithdrawalsController],
  providers: [WithdrawalsService, EarningsScheduler],
  exports: [WithdrawalsService, EarningsScheduler],
})
export class WithdrawalsModule {}
