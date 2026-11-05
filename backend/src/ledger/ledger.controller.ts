import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { RequireType } from '../auth/decorators/require-type.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { LedgerService } from './ledger.service';

const trialBalanceQuery = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

/**
 * THE BOOKS
 *
 * Read-only on purpose: entries are written by business events, never by hand.
 * `finance:read` is enough to see totals; the raw entries need `ledger:read`.
 */
@Controller('admin/ledger')
@RequireType('STAFF')
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get('trial-balance')
  @RequirePermissions('finance:read')
  trialBalance(@Query(new ZodValidationPipe(trialBalanceQuery)) query: z.infer<typeof trialBalanceQuery>) {
    return this.ledger.trialBalance(
      query.from ? new Date(query.from) : undefined,
      query.to ? new Date(query.to) : undefined,
    );
  }
}
