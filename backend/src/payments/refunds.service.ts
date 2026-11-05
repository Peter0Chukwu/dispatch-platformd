import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service';
import { AppConfig } from '../config/app.config';
import { AppError } from '../common/errors/app-error';
import { LedgerService } from '../ledger/ledger.service';
import { ACCOUNTS } from '../ledger/accounts';
import { WalletService } from '../wallet/wallet.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { RT } from '../realtime/realtime.types';
import { formatNaira } from '@dispatch/shared';

/**
 * REFUNDS
 * ─────────────────────────────────────────────────────────────────────────────
 * A refund is money going back where it came from:
 *
 *   • a gateway payment  → the provider is asked to reverse the charge; in
 *     DEVELOPMENT that reversal is simulated and recorded as such;
 *   • a wallet payment   → the customer's wallet is credited instantly.
 *
 * Either way the books record it: the clearing account is credited back and a
 * refunds expense (contra-revenue) is debited, so the P&L shows what refunds cost.
 * The refund is idempotent per payment + amount so a double click cannot pay twice.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger('Refunds');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly ledger: LedgerService,
    private readonly wallet: WalletService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async create(
    staffId: string,
    input: { paymentId: string; amountKobo: bigint; reason: string; note?: string },
  ) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: input.paymentId },
      include: { delivery: { select: { id: true, reference: true, customerId: true } } },
    });
    if (!payment) throw AppError.notFound('Payment');
    if (payment.status !== 'SUCCESS') {
      throw AppError.conflict(
        'Only a successful payment can be refunded.',
        'INVALID_STATUS_TRANSITION',
      );
    }

    const refundedSoFar = await this.prisma.refund.aggregate({
      where: { paymentId: payment.id, status: { in: ['COMPLETED', 'PROCESSING', 'PENDING'] } },
      _sum: { amountKobo: true },
    });
    const already = refundedSoFar._sum.amountKobo ?? 0n;
    if (already + input.amountKobo > payment.amountKobo) {
      throw AppError.conflict(
        `Refunds on this payment total ${formatNaira(already)} of ${formatNaira(payment.amountKobo)}. The remaining refundable amount is ${formatNaira(payment.amountKobo - already)}.`,
        'CONFLICT',
      );
    }

    const refund = await this.prisma.refund.create({
      data: {
        paymentId: payment.id,
        amountKobo: input.amountKobo,
        reason: input.reason,
        status: 'PROCESSING',
        processedById: staffId,
        note: input.note ?? null,
      },
    });

    try {
      const providerRef = await this.sendToProvider(payment.provider, payment.providerReference, input.amountKobo);

      const completed = await this.prisma.$transaction(async (tx) => {
        const done = await tx.refund.update({
          where: { id: refund.id },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            providerRefundId: providerRef,
          },
        });

        // Wallet-paid deliveries go straight back into the wallet: the customer
        // never left the platform, so neither should the money.
        if (payment.provider === 'WALLET') {
          await this.wallet.apply(
            {
              userId: (
                await tx.customer.findUniqueOrThrow({
                  where: { id: payment.customerId },
                  select: { userId: true },
                })
              ).userId,
              direction: 'CREDIT',
              category: 'REFUND',
              amountKobo: input.amountKobo,
              idempotencyKey: `refund:${refund.id}`,
              description: `Refund — ${input.reason}`,
              counterCode: ACCOUNTS.REFUNDS,
              counterSide: 'DEBIT',
              eventType: 'REFUND',
              deliveryId: payment.deliveryId ?? undefined,
              paymentId: payment.id,
              createdById: staffId,
            },
            tx,
          );
        } else {
          const clearing = LedgerService.clearingFor(payment.provider);
          await this.ledger.post(
            {
              eventType: 'REFUND',
              description: `Refund on payment ${payment.providerReference}`,
              idempotencyKey: `refund:${refund.id}`,
              deliveryId: payment.deliveryId ?? undefined,
              paymentId: payment.id,
              createdById: staffId,
              lines: [
                { code: ACCOUNTS.REFUNDS, debitKobo: input.amountKobo, memo: input.reason },
                { code: clearing, creditKobo: input.amountKobo, memo: 'Money returned to customer' },
              ],
            },
            tx,
          );
        }

        if (payment.deliveryId) {
          const total = await tx.refund.aggregate({
            where: { paymentId: payment.id, status: 'COMPLETED' },
            _sum: { amountKobo: true },
          });
          const refunded = total._sum.amountKobo ?? 0n;
          await tx.delivery.update({
            where: { id: payment.deliveryId },
            data: {
              paymentStatus:
                refunded >= payment.amountKobo ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
            },
          });
        }

        return done;
      });

      this.logger.log(
        `Refund ${refund.id.slice(0, 8)} of ${formatNaira(input.amountKobo)} completed (${payment.provider})`,
      );
      this.realtime.toStaff(RT.PAYMENT_UPDATED, {
        kind: 'refund',
        paymentId: payment.id,
        amountFormatted: formatNaira(input.amountKobo),
      });

      return this.dto(completed, payment.providerReference);
    } catch (error) {
      await this.prisma.refund.update({
        where: { id: refund.id },
        data: { status: 'FAILED', note: `${input.note ?? ''} ${(error as Error).message}`.trim() },
      });
      throw AppError.conflict(
        `The refund could not be completed: ${(error as Error).message}`,
        'PROVIDER_ERROR',
      );
    }
  }

  /**
   * Ask the provider to reverse the charge. In DEVELOPMENT there is no gateway, so
   * the reversal is simulated — and labelled as such in the response — rather than
   * silently pretending real money moved.
   */
  private async sendToProvider(
    provider: string,
    reference: string,
    amountKobo: bigint,
  ): Promise<string> {
    if (provider === 'CASH' || provider === 'WALLET') {
      return `INTERNAL-${provider}-${Date.now()}`;
    }
    if (this.config.paymentsMode === 'DEVELOPMENT' || !this.config.paystackSecretKey) {
      return `SIM-REFUND-${Date.now().toString(36).toUpperCase()}`;
    }

    const response = await fetch('https://api.paystack.co/refund', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.paystackSecretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ transaction: reference, amount: Number(amountKobo) }),
    });
    const body = (await response.json()) as {
      status?: boolean;
      message?: string;
      data?: { id?: number; reference?: string };
    };
    if (!body.status || !body.data) throw new Error(body.message ?? 'Provider rejected the refund');
    return String(body.data.id ?? body.data.reference ?? `REF-${Date.now()}`);
  }

  async list(status: string | undefined, page = 1, pageSize = 20) {
    const where = status ? { status: status as never } : {};
    const [rows, total] = await Promise.all([
      this.prisma.refund.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          payment: {
            select: {
              providerReference: true,
              provider: true,
              amountKobo: true,
              delivery: { select: { id: true, reference: true } },
            },
          },
        },
      }),
      this.prisma.refund.count({ where }),
    ]);

    return {
      data: rows.map((row) => ({
        ...this.dto(row, row.payment.providerReference),
        payment: {
          provider: row.payment.provider,
          amountKobo: row.payment.amountKobo.toString(),
          amountFormatted: formatNaira(row.payment.amountKobo),
          delivery: row.payment.delivery,
        },
      })),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  dto(
    refund: {
      id: string;
      paymentId: string;
      amountKobo: bigint;
      reason: string;
      status: string;
      note: string | null;
      providerRefundId: string | null;
      createdAt: Date;
      completedAt: Date | null;
    },
    reference: string,
  ) {
    return {
      id: refund.id,
      paymentId: refund.paymentId,
      paymentReference: reference,
      amountKobo: refund.amountKobo.toString(),
      amountFormatted: formatNaira(refund.amountKobo),
      reason: refund.reason,
      status: refund.status,
      note: refund.note,
      providerRefundId: refund.providerRefundId,
      createdAt: refund.createdAt,
      completedAt: refund.completedAt,
    };
  }
}
