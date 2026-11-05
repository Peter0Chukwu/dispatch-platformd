import { Global, Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';

/**
 * Global because money is posted from several places — payments, earnings,
 * withdrawals, refunds — and threading a provider through each of them would be
 * noise. The service itself holds no state.
 */
@Global()
@Module({ providers: [LedgerService], exports: [LedgerService] })
export class LedgerModule {}
