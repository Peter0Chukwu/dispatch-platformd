import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { RequireType } from '../auth/decorators/require-type.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AppError } from '../common/errors/app-error';
import { WithdrawalsService } from './withdrawals.service';

const requestSchema = z.object({
  amountKobo: z.coerce.bigint().positive('Enter an amount to withdraw'),
  bankName: z.string().trim().min(2, 'Enter your bank name').max(60),
  bankCode: z.string().trim().min(2, 'Select your bank').max(10),
  accountNumber: z
    .string()
    .trim()
    .regex(/^\d{10}$/, 'Nigerian account numbers are 10 digits'),
  accountName: z.string().trim().min(2, 'Enter the account name').max(80),
  idempotencyKey: z.string().trim().min(8).max(80).optional(),
});

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * RIDER WITHDRAWALS
 *
 * The rider can see what is withdrawable and ask for it. They cannot approve
 * themselves: approval and payout need `withdrawal:approve` / `withdrawal:payout`,
 * which no rider account holds.
 */
@Controller('rider/withdrawals')
@RequireType('RIDER')
export class WithdrawalsController {
  constructor(private readonly withdrawals: WithdrawalsService) {}

  @Get()
  async list(
    @CurrentUser('riderId') riderId: string | undefined,
    @Query(new ZodValidationPipe(pageSchema)) query: z.infer<typeof pageSchema>,
  ) {
    if (!riderId) throw AppError.forbidden('Rider profile missing');
    const [list, state] = await Promise.all([
      this.withdrawals.listForRider(riderId, query.page, query.pageSize),
      this.withdrawals.withdrawable(riderId),
    ]);
    return {
      ...list,
      withdrawable: {
        availableKobo: state.availableKobo.toString(),
        adjustmentsKobo: state.adjustmentsKobo.toString(),
        inFlightKobo: state.inFlightKobo.toString(),
        withdrawableKobo: state.withdrawableKobo.toString(),
      },
    };
  }

  @Post()
  async create(
    @CurrentUser('riderId') riderId: string | undefined,
    @Body(new ZodValidationPipe(requestSchema)) body: z.infer<typeof requestSchema>,
  ) {
    if (!riderId) throw AppError.forbidden('Rider profile missing');
    return this.withdrawals.request(riderId, body);
  }
}
