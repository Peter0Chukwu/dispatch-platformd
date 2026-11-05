import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { RequireType } from '../auth/decorators/require-type.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { WalletService } from './wallet.service';

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * The customer's wallet: balance and statement.
 * Read-only here — money enters through `/payments/wallet/topups` and leaves
 * through `/payments/deliveries/:id/pay-with-wallet`, both of which are real,
 * ledger-posted movements.
 */
@Controller('wallet')
@RequireType('CUSTOMER')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  view(@CurrentUser('userId') userId: string) {
    return this.wallet.view(userId);
  }

  @Get('transactions')
  transactions(
    @CurrentUser('userId') userId: string,
    @Query(new ZodValidationPipe(pageSchema)) query: z.infer<typeof pageSchema>,
  ) {
    return this.wallet.transactions(userId, query.page, query.pageSize);
  }
}
