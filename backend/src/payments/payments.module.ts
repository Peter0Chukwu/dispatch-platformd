import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { PaymentWebhooksController } from './webhooks.controller';
import { WalletModule } from '../wallet/wallet.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { RefundsService } from './refunds.service';

/**
 * Payments depend on the wallet (top-ups credit one, wallet payments debit one),
 * the ledger (global) and realtime (to tell the staff board money arrived).
 */
@Module({
  imports: [WalletModule, RealtimeModule],
  controllers: [PaymentsController, PaymentWebhooksController],
  providers: [PaymentsService, RefundsService],
  exports: [PaymentsService, RefundsService],
})
export class PaymentsModule {}
