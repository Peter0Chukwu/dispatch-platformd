import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { RequireType } from '../auth/decorators/require-type.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AppError } from '../common/errors/app-error';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../infra/prisma/prisma.service';
import type { AuthPrincipal } from '../auth/auth.types';

const payloadSchema = z.object({
  provider: z.enum(['PAYSTACK', 'FLUTTERWAVE']).default('PAYSTACK'),
});
const topUpSchema = z.object({
  amountKobo: z.coerce.bigint().min(10_000n, 'Top up at least ₦100').max(50_000_000n, 'One top-up is limited to ₦500,000'),
  provider: z.enum(['PAYSTACK', 'FLUTTERWAVE']).default('PAYSTACK'),
});
const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * CUSTOMER PAYMENTS
 *
 * A customer can start a payment for their own delivery and nowhere else: the
 * customer id comes from the session, never from the request body.
 */
@Controller('payments')
@RequireType('CUSTOMER')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly prisma: PrismaService,
  ) {}

  /** Non-secret facts the checkout needs (mode, providers, public keys). */
  @Public()
  @Get('config')
  config() {
    return this.payments.publicConfig();
  }

  @Get()
  list(
    @CurrentUser('userId') userId: string,
    @Query(new ZodValidationPipe(pageSchema)) query: z.infer<typeof pageSchema>,
  ) {
    return this.payments.listForCustomer(userId, query.page, query.pageSize);
  }

  @Get(':reference')
  async one(@CurrentUser() user: AuthPrincipal, @Param('reference') reference: string) {
    await this.assertOwn(user, reference);
    return this.payments.findByReference(reference);
  }

  @Post('deliveries/:deliveryId/initialize')
  initialize(
    @CurrentUser('userId') userId: string,
    @Param('deliveryId') deliveryId: string,
    @Body(new ZodValidationPipe(payloadSchema)) body: z.infer<typeof payloadSchema>,
  ) {
    return this.payments.initializeForDelivery(userId, deliveryId, body.provider);
  }

  @Post('deliveries/:deliveryId/pay-with-wallet')
  payWithWallet(
    @CurrentUser('userId') userId: string,
    @Param('deliveryId') deliveryId: string,
  ) {
    return this.payments.payDeliveryWithWallet(userId, deliveryId);
  }

  /** Start a wallet top-up. The money lands in the wallet only when settled. */
  @Post('wallet/topups')
  topUp(
    @CurrentUser('userId') userId: string,
    @Body(new ZodValidationPipe(topUpSchema)) body: z.infer<typeof topUpSchema>,
  ) {
    return this.payments.initializeWalletTopUp(userId, body.amountKobo, body.provider);
  }

  /** Ask the gateway directly — used when the browser returns from checkout. */
  @Post(':reference/verify')
  async verify(@CurrentUser() user: AuthPrincipal, @Param('reference') reference: string) {
    await this.assertOwn(user, reference);
    return this.payments.verifyAndSettle(reference);
  }

  /**
   * DEVELOPMENT ONLY: settle a payment as if the gateway had confirmed it.
   * Refuses outright unless PAYMENTS_MODE=DEVELOPMENT.
   */
  @Post(':reference/simulate')
  async simulate(@CurrentUser() user: AuthPrincipal, @Param('reference') reference: string) {
    await this.assertOwn(user, reference);
    return this.payments.simulate(reference);
  }

  private async assertOwn(user: AuthPrincipal, reference: string) {
    const owner = await this.prisma.payment.findUnique({
      where: { providerReference: reference },
      select: { customerId: true },
    });
    // 404, not 403: another customer's payment is none of your business.
    if (!owner || !user.customerId || owner.customerId !== user.customerId) {
      throw AppError.notFound('Payment');
    }
  }
}
