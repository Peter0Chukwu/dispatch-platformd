import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, PaymentProvider, PaymentRecordStatus } from '@prisma/client';
import { PrismaService } from '../infra/prisma/prisma.service';
import { AppConfig } from '../config/app.config';
import { AppError } from '../common/errors/app-error';
import { LedgerService, type LedgerLineInput } from '../ledger/ledger.service';
import { ACCOUNTS } from '../ledger/accounts';
import { WalletService } from '../wallet/wallet.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { RT } from '../realtime/realtime.types';
import { formatNaira } from '@dispatch/shared';
import {
  type InitializeResult,
  type PaymentProviderAdapter,
  type VerifyResult,
  FlutterwaveProvider,
  PaystackProvider,
} from './payment-providers';

/** Gateway fee used by the DEVELOPMENT simulator: Paystack's standard 1.5% + ₦100 cap ₦2,000. */
export function simulatedFeeKobo(amountKobo: bigint): bigint {
  const pct = (amountKobo * 15n) / 1000n;
  const flat = 10_000n; // ₦100
  const fee = pct + flat;
  return fee > 200_000n ? 200_000n : fee;
}

type Gateway = 'PAYSTACK' | 'FLUTTERWAVE';

/**
 * PAYMENTS
 * ─────────────────────────────────────────────────────────────────────────────
 * One path in: a `Payment` row is created PENDING with our own reference, the
 * gateway is asked to start a charge, and money only ever becomes real when the
 * *gateway* says so — by a signature-verified webhook that we then re-verify
 * against the gateway's own API, or by the customer polling a verify endpoint.
 *
 * The rules that are not negotiable:
 *
 *   1. An unverified webhook never credits anything. Signature first, then
 *      re-verify with the provider, then compare the amount to the amount we
 *      asked for. A mismatch marks the payment FAILED rather than trusting it.
 *   2. Every webhook is stored, and `(provider, eventId)` is unique, so a
 *      replayed delivery is a no-op rather than a second credit.
 *   3. Settlement is idempotent on the payment row: settled twice in parallel,
 *      one wins and the other sees SUCCESS and stops.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('Payments');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly ledger: LedgerService,
    private readonly wallet: WalletService,
    private readonly realtime: RealtimeGateway,
  ) {}

  get simulated(): boolean {
    return this.config.paymentsMode === 'DEVELOPMENT';
  }

  adapter(provider: Gateway): PaymentProviderAdapter {
    return provider === 'FLUTTERWAVE'
      ? new FlutterwaveProvider(this.config)
      : new PaystackProvider(this.config);
  }

  /** Public, non-secret facts the frontend needs to render a pay button. */
  publicConfig() {
    return {
      mode: this.config.paymentsMode,
      simulated: this.simulated,
      providers: [
        {
          key: 'PAYSTACK' as const,
          label: 'Paystack',
          enabled: true,
          publicKey: this.config.paystackPublicKey || null,
        },
        {
          key: 'FLUTTERWAVE' as const,
          label: 'Flutterwave',
          enabled: true,
          publicKey: this.config.flutterwavePublicKey || null,
        },
      ],
      walletEnabled: true,
    };
  }

  // ── Starting a payment ────────────────────────────────────────────────────

  async initializeForDelivery(
    customerUserId: string,
    deliveryId: string,
    provider: Gateway,
  ) {
    const customer = await this.prisma.customer.findFirstOrThrow({
      where: { userId: customerUserId },
      select: { id: true, userId: true, user: { select: { email: true } } },
    });
    // A gateway receipt needs an address; refusing beats silently inventing one.
    const email = customer.user.email;
    if (!email) {
      throw AppError.validation([
        { field: 'email', message: 'Add an email address to your account before paying online' },
      ]);
    }

    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, customerId: customer.id },
      select: {
        id: true,
        reference: true,
        chargeKobo: true,
        paymentStatus: true,
        status: true,
      },
    });
    if (!delivery) throw AppError.notFound('Delivery');
    if (delivery.paymentStatus === 'PAID') {
      throw AppError.conflict('This delivery is already paid.', 'DELIVERY_ALREADY_PAID');
    }
    if (['CANCELLED', 'DELIVERED', 'FAILED', 'REJECTED_BY_CUSTOMER'].includes(delivery.status)) {
      throw AppError.conflict('This delivery can no longer be paid for.', 'DELIVERY_NOT_PAYABLE');
    }

    // Reuse a live pending payment for the same delivery instead of stacking
    // several "unpaid" records for one booking.
    const pending = await this.prisma.payment.findFirst({
      where: { deliveryId: delivery.id, status: 'PENDING', provider },
      orderBy: { createdAt: 'desc' },
    });

    const payment =
      pending ??
      (await this.prisma.payment.create({
        data: {
          deliveryId: delivery.id,
          customerId: customer.id,
          provider,
          providerReference: buildPaymentReference(delivery.reference),
          amountKobo: delivery.chargeKobo,
          status: 'PENDING',
        },
      }));

    let init: InitializeResult = { authorizationUrl: null, simulated: this.simulated };
    if (!this.simulated) {
      init = await this.adapter(provider).initialize({
        reference: payment.providerReference,
        amountKobo: payment.amountKobo,
        email,
        callbackUrl: `${this.config.frontendUrl}/app/deliveries/${delivery.id}?payment=${payment.providerReference}`,
        metadata: { deliveryId: delivery.id, deliveryReference: delivery.reference },
      });
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { authorizationUrl: init.authorizationUrl ?? null },
      });
    }

    return this.paymentDto({
      ...payment,
      authorizationUrl: init.authorizationUrl ?? payment.authorizationUrl,
    });
  }

  async initializeWalletTopUp(
    customerUserId: string,
    amountKobo: bigint,
    provider: Gateway,
  ) {
    const customer = await this.prisma.customer.findFirstOrThrow({
      where: { userId: customerUserId },
      select: { id: true, user: { select: { email: true } } },
    });
    const email = customer.user.email;
    if (!email) {
      throw AppError.validation([
        { field: 'email', message: 'Add an email address to your account before paying online' },
      ]);
    }

    const payment = await this.prisma.payment.create({
      data: {
        deliveryId: null,
        customerId: customer.id,
        provider,
        providerReference: buildPaymentReference('WALLET'),
        amountKobo,
        status: 'PENDING',
      },
    });

    let init: InitializeResult = { authorizationUrl: null, simulated: this.simulated };
    if (!this.simulated) {
      init = await this.adapter(provider).initialize({
        reference: payment.providerReference,
        amountKobo,
        email,
        callbackUrl: `${this.config.frontendUrl}/app/wallet?topup=${payment.providerReference}`,
        metadata: { purpose: 'WALLET_TOPUP' },
      });
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { authorizationUrl: init.authorizationUrl ?? null },
      });
    }

    return this.paymentDto({
      ...payment,
      authorizationUrl: init.authorizationUrl ?? payment.authorizationUrl,
    });
  }

  // ── Settling ──────────────────────────────────────────────────────────────

  /**
   * The single place money becomes real. Called by the webhook handler, the
   * customer's "I have paid" verify call, and the DEVELOPMENT simulator — so all
   * three take exactly the same path and produce exactly the same ledger.
   */
  async settle(reference: string, verification: VerifyResult) {
    const payment = await this.prisma.payment.findUnique({
      where: { providerReference: reference },
      include: { delivery: { select: { id: true, reference: true, priceSnapshot: true } } },
    });
    if (!payment) throw AppError.notFound('Payment');

    if (payment.status === 'SUCCESS') {
      return { alreadySettled: true, payment: this.paymentDto(payment) };
    }

    if (verification.status === 'FAILED') {
      const failed = await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          verifiedAt: new Date(),
          failureReason: 'The gateway reported this payment as failed.',
          rawResponse: verification.raw as Prisma.InputJsonValue,
        },
      });
      return { alreadySettled: false, payment: this.paymentDto(failed) };
    }

    if (verification.status !== 'SUCCESS') {
      throw AppError.conflict('The gateway has not confirmed this payment yet.', 'PAYMENT_PENDING');
    }

    // ★ The amount we asked for is the only amount we accept. A webhook that
    //   claims a different amount is a bug or an attack, never a discount.
    if (verification.amountKobo !== null && verification.amountKobo !== payment.amountKobo) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          verifiedAt: new Date(),
          failureReason: `Amount mismatch: gateway reported ${verification.amountKobo}, expected ${payment.amountKobo}`,
          rawResponse: verification.raw as Prisma.InputJsonValue,
        },
      });
      this.logger.error(
        `Payment ${payment.providerReference} amount mismatch (${verification.amountKobo} vs ${payment.amountKobo}) — refused.`,
      );
      throw AppError.conflict(
        'The amount the gateway confirmed does not match this payment. Nothing was credited.',
        'PAYMENT_AMOUNT_MISMATCH',
      );
    }

    const feeKobo = verification.feeKobo;

    const result = await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
      if (fresh.status === 'SUCCESS') {
        return { alreadySettled: true, payment: fresh, walletBalance: null as bigint | null };
      }

      const settled = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'SUCCESS',
          paidAt: new Date(),
          verifiedAt: new Date(),
          feeKobo,
          channel: verification.channel,
          providerTransactionId: verification.providerTransactionId,
          rawResponse: verification.raw as Prisma.InputJsonValue,
        },
      });

      const clearing = LedgerService.clearingFor(payment.provider);
      let walletBalance: bigint | null = null;

      if (payment.deliveryId) {
        const delivery = await tx.delivery.findUniqueOrThrow({
          where: { id: payment.deliveryId },
          select: { id: true, reference: true, chargeKobo: true, priceSnapshot: true },
        });

        await tx.delivery.update({
          where: { id: delivery.id },
          data: { paymentStatus: 'PAID' },
        });

        const { deliveryRevenue, surchargeRevenue } = splitRevenue(
          delivery.chargeKobo,
          delivery.priceSnapshot,
        );

        // Money in, revenue out, gateway fee expensed. Balanced to the kobo.
        const lines: LedgerLineInput[] = [
          { code: clearing, debitKobo: payment.amountKobo, memo: `Payment ${payment.providerReference}` },
          { code: ACCOUNTS.DELIVERY_REVENUE, creditKobo: deliveryRevenue, memo: 'Delivery revenue' },
        ];
        if (surchargeRevenue > 0n) {
          lines.push({
            code: ACCOUNTS.SURCHARGE_REVENUE,
            creditKobo: surchargeRevenue,
            memo: 'Express / scheduled surcharge',
          });
        }
        if (feeKobo > 0n) {
          lines.push({ code: ACCOUNTS.GATEWAY_FEES, debitKobo: feeKobo, memo: 'Gateway fee' });
          lines.push({ code: clearing, creditKobo: feeKobo, memo: 'Gateway fee deducted' });
        }

        await this.ledger.post(
          {
            eventType: 'DELIVERY_PAYMENT',
            description: `Delivery ${delivery.reference} paid via ${payment.provider}`,
            idempotencyKey: `payment:${payment.id}`,
            deliveryId: delivery.id,
            paymentId: payment.id,
            lines,
          },
          tx,
        );
      } else {
        // A wallet top-up: the gateway's money becomes a liability to the customer.
        const applied = await this.wallet.apply(
          {
            userId: (
              await tx.customer.findUniqueOrThrow({
                where: { id: payment.customerId },
                select: { userId: true },
              })
            ).userId,
            direction: 'CREDIT',
            category: 'TOPUP',
            amountKobo: payment.amountKobo,
            idempotencyKey: `topup:${payment.id}`,
            description: `Wallet top-up via ${payment.provider}`,
            counterCode: clearing,
            counterSide: 'DEBIT',
            eventType: 'WALLET_TOPUP',
            paymentId: payment.id,
          },
          tx,
        );
        walletBalance = applied.transaction.balanceAfterKobo;

        if (feeKobo > 0n) {
          await this.ledger.post(
            {
              eventType: 'WALLET_TOPUP',
              description: `Gateway fee on top-up ${payment.providerReference}`,
              idempotencyKey: `topup-fee:${payment.id}`,
              paymentId: payment.id,
              lines: [
                { code: ACCOUNTS.GATEWAY_FEES, debitKobo: feeKobo, memo: 'Gateway fee' },
                { code: clearing, creditKobo: feeKobo, memo: 'Gateway fee deducted' },
              ],
            },
            tx,
          );
        }
      }

      return { alreadySettled: false, payment: settled, walletBalance };
    });

    this.logger.log(
      `Payment ${payment.providerReference} settled · ${formatNaira(payment.amountKobo)} · fee ${formatNaira(feeKobo)}`,
    );

    this.realtime.toStaff(RT.PAYMENT_UPDATED, {
      paymentId: payment.id,
      reference: payment.providerReference,
      deliveryId: payment.deliveryId,
      amountFormatted: formatNaira(payment.amountKobo),
      at: new Date().toISOString(),
    });
    if (payment.deliveryId) {
      this.realtime.toDelivery(payment.deliveryId, RT.DELIVERY_UPDATED, {
        id: payment.deliveryId,
        paymentStatus: 'PAID',
      });
    }

    return {
      alreadySettled: result.alreadySettled,
      payment: this.paymentDto(result.payment),
      walletBalanceKobo: result.walletBalance?.toString() ?? null,
    };
  }

  /**
   * Verify with the gateway and settle. This is what the customer's browser calls
   * when they come back from the payment page — the webhook may arrive seconds
   * later, and whichever lands second is a no-op.
   */
  async verifyAndSettle(reference: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { providerReference: reference },
      select: { provider: true, status: true },
    });
    if (!payment) throw AppError.notFound('Payment');
    if (payment.status === 'SUCCESS') {
      return this.findByReference(reference);
    }

    if (this.simulated) {
      throw AppError.conflict(
        'Payments are simulated in this environment — use the "Simulate payment" action.',
        'PAYMENT_SIMULATED',
      );
    }

    const verification = await this.adapter(payment.provider as Gateway).verify(reference);
    await this.settle(reference, verification);
    return this.findByReference(reference);
  }

  /** DEVELOPMENT ONLY — settle as if the gateway had confirmed. */
  async simulate(reference: string) {
    if (!this.simulated) {
      throw AppError.forbidden('The payment simulator is only available in DEVELOPMENT mode.');
    }
    const payment = await this.prisma.payment.findUnique({
      where: { providerReference: reference },
    });
    if (!payment) throw AppError.notFound('Payment');

    return this.settle(reference, {
      status: 'SUCCESS',
      providerTransactionId: `SIM-${payment.id.slice(0, 8)}`,
      amountKobo: payment.amountKobo,
      feeKobo: simulatedFeeKobo(payment.amountKobo),
      channel: 'simulated',
      raw: { simulated: true, at: new Date().toISOString(), reference },
    });
  }

  // ── Webhooks ──────────────────────────────────────────────────────────────

  /**
   * Store-then-process. The row is written first (with the signature verdict),
   * because a webhook we rejected is evidence worth keeping. Duplicate events hit
   * the unique index and are acknowledged without doing anything.
   */
  async handleWebhook(
    provider: Gateway,
    rawBody: string,
    headers: Record<string, string | undefined>,
  ) {
    const adapter = this.adapter(provider);
    const signatureValid = adapter.verifySignature(rawBody, headers);
    const eventType = adapter.eventTypeFrom(rawBody) ?? 'unknown';
    const eventId = adapter.eventIdFrom(rawBody, headers) ?? `unidentified-${Date.now()}`;

    let webhookId: string | null = null;
    try {
      const row = await this.prisma.paymentWebhook.create({
        data: {
          provider,
          eventId,
          eventType,
          signatureValid,
          payload: safeJson(rawBody),
        },
      });
      webhookId = row.id;
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Exactly what the unique index is for: the gateway retried a delivery.
        this.logger.log(`Duplicate ${provider} webhook ${eventId} acknowledged, nothing replayed.`);
        return { received: true, duplicate: true };
      }
      throw error;
    }

    if (!signatureValid) {
      this.logger.warn(`Rejected ${provider} webhook ${eventId}: bad signature`);
      throw AppError.unauthorized('Invalid webhook signature');
    }

    const reference = adapter.referenceFrom(rawBody);
    if (!reference) {
      await this.finishWebhook(webhookId, 'No reference in payload');
      return { received: true, ignored: 'no-reference' };
    }

    try {
      if (this.simulated) {
        // In DEVELOPMENT the gateway is not reachable, and the simulator endpoint
        // is the only way to settle. Record and acknowledge — never call out.
        await this.finishWebhook(webhookId, 'Simulated environment: settlement happens via the simulator endpoint');
        return { received: true, simulated: true };
      }
      // ★ Never trust what the webhook says the amount is. Ask the gateway.
      const verified = await adapter.verify(reference);
      const settled = await this.settle(reference, verified);
      await this.finishWebhook(webhookId, null);
      return { received: true, settled: !settled.alreadySettled };
    } catch (error) {
      await this.finishWebhook(webhookId, (error as Error).message);
      this.logger.error(`Webhook ${eventId} processing failed: ${(error as Error).message}`);
      // Acknowledge anyway: the provider should not keep retrying a payment we
      // cannot reconcile, and the failure is visible in the webhook table.
      return { received: true, error: (error as Error).message };
    }
  }

  private async finishWebhook(id: string, error: string | null) {
    await this.prisma.paymentWebhook.update({
      where: { id },
      data: { processedAt: new Date(), processingError: error },
    });
  }

  // ── Paying with the wallet ────────────────────────────────────────────────

  async payDeliveryWithWallet(customerUserId: string, deliveryId: string) {
    const customer = await this.prisma.customer.findFirstOrThrow({
      where: { userId: customerUserId },
      select: { id: true, userId: true },
    });
    const delivery = await this.prisma.delivery.findFirstOrThrow({
      where: { id: deliveryId, customerId: customer.id },
      select: {
        id: true,
        reference: true,
        chargeKobo: true,
        paymentStatus: true,
        status: true,
        priceSnapshot: true,
      },
    });

    if (delivery.paymentStatus === 'PAID') {
      throw AppError.conflict('This delivery is already paid.', 'DELIVERY_ALREADY_PAID');
    }

    const { deliveryRevenue, surchargeRevenue } = splitRevenue(
      delivery.chargeKobo,
      delivery.priceSnapshot,
    );

    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          deliveryId: delivery.id,
          customerId: customer.id,
          provider: 'WALLET',
          providerReference: buildPaymentReference(delivery.reference),
          amountKobo: delivery.chargeKobo,
          status: 'PENDING',
        },
      });

      // Debit the wallet and post the revenue in the same transaction: if the
      // customer cannot afford it, no payment row survives either.
      const applied = await this.wallet.apply(
        {
          userId: customer.userId,
          direction: 'DEBIT',
          category: 'DELIVERY_PAYMENT',
          amountKobo: delivery.chargeKobo,
          idempotencyKey: `wallet-debit:${delivery.id}`,
          description: `Delivery ${delivery.reference}`,
          counterCode: deliveryRevenue > 0n ? ACCOUNTS.DELIVERY_REVENUE : ACCOUNTS.SURCHARGE_REVENUE,
          counterSide: 'CREDIT',
          eventType: 'DELIVERY_PAYMENT',
          deliveryId: delivery.id,
          paymentId: payment.id,
        },
        tx,
      );

      // The wallet helper posts one revenue line; if the price had a surcharge
      // component, move that portion in a second, balanced line pair.
      if (surchargeRevenue > 0n && deliveryRevenue > 0n) {
        await this.ledger.post(
          {
            eventType: 'DELIVERY_PAYMENT',
            description: `Delivery ${delivery.reference} — surcharge component`,
            idempotencyKey: `wallet-debit-surcharge:${delivery.id}`,
            deliveryId: delivery.id,
            paymentId: payment.id,
            lines: [
              { code: ACCOUNTS.DELIVERY_REVENUE, debitKobo: surchargeRevenue, memo: 'Reclass to surcharge' },
              { code: ACCOUNTS.SURCHARGE_REVENUE, creditKobo: surchargeRevenue, memo: 'Express / scheduled surcharge' },
            ],
          },
          tx,
        );
      }

      const settled = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'SUCCESS',
          paidAt: new Date(),
          verifiedAt: new Date(),
          feeKobo: 0n,
          channel: 'wallet',
          rawResponse: { wallet: true, walletTransactionId: applied.transaction.id },
        },
      });

      await tx.delivery.update({ where: { id: delivery.id }, data: { paymentStatus: 'PAID' } });

      return { payment: settled, balance: applied.transaction.balanceAfterKobo };
    });

    this.realtime.toDelivery(delivery.id, RT.DELIVERY_UPDATED, {
      id: delivery.id,
      paymentStatus: 'PAID',
    });
    this.realtime.toStaff(RT.PAYMENT_UPDATED, {
      paymentId: result.payment.id,
      reference: result.payment.providerReference,
      deliveryId: delivery.id,
      amountFormatted: formatNaira(result.payment.amountKobo),
      at: new Date().toISOString(),
    });

    return {
      payment: this.paymentDto(result.payment),
      walletBalanceKobo: result.balance.toString(),
      walletBalanceFormatted: formatNaira(result.balance),
    };
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async findByReference(reference: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { providerReference: reference },
      include: {
        delivery: { select: { id: true, reference: true, status: true, paymentStatus: true } },
        refunds: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!payment) throw AppError.notFound('Payment');
    return {
      ...this.paymentDto(payment),
      delivery: payment.delivery,
      refunds: payment.refunds.map((refund) => ({
        id: refund.id,
        amountKobo: refund.amountKobo.toString(),
        amountFormatted: formatNaira(refund.amountKobo),
        status: refund.status,
        reason: refund.reason,
        createdAt: refund.createdAt,
      })),
    };
  }

  async listForCustomer(customerUserId: string, page = 1, pageSize = 20) {
    const customer = await this.prisma.customer.findFirstOrThrow({
      where: { userId: customerUserId },
      select: { id: true },
    });
    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({
        where: { customerId: customer.id },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { delivery: { select: { id: true, reference: true } } },
      }),
      this.prisma.payment.count({ where: { customerId: customer.id } }),
    ]);

    return {
      data: rows.map((row) => ({
        ...this.paymentDto(row),
        delivery: row.delivery,
        purpose: row.deliveryId ? 'DELIVERY' : 'WALLET_TOPUP',
      })),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  paymentDto(payment: {
    id: string;
    deliveryId: string | null;
    provider: PaymentProvider;
    providerReference: string;
    providerTransactionId?: string | null;
    amountKobo: bigint;
    feeKobo?: bigint;
    status: PaymentRecordStatus;
    channel?: string | null;
    authorizationUrl?: string | null;
    paidAt?: Date | null;
    createdAt?: Date;
    simulated?: boolean;
  }) {
    return {
      id: payment.id,
      deliveryId: payment.deliveryId,
      provider: payment.provider,
      reference: payment.providerReference,
      providerTransactionId: payment.providerTransactionId ?? null,
      amountKobo: payment.amountKobo.toString(),
      amountFormatted: formatNaira(payment.amountKobo),
      feeKobo: (payment.feeKobo ?? 0n).toString(),
      status: payment.status,
      channel: payment.channel ?? null,
      authorizationUrl: payment.authorizationUrl ?? null,
      paidAt: payment.paidAt ?? null,
      createdAt: payment.createdAt ?? null,
      simulated: this.simulated,
    };
  }
}

/** `DSP-...` deliveries get `PAY-...` references; top-ups get `TOP-...`. */
function buildPaymentReference(seed: string): string {
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  const prefix = seed.startsWith('WALLET') ? 'TOP' : 'PAY';
  return `${prefix}-${seed.replace(/^DSP-/, '')}-${suffix}`;
}

/**
 * Split a delivery charge into "delivery" and "surcharge" revenue using the
 * frozen price snapshot, so the P&L explains itself months later.
 */
export function splitRevenue(
  chargeKobo: bigint,
  priceSnapshot: unknown,
): { deliveryRevenue: bigint; surchargeRevenue: bigint } {
  const lines =
    (priceSnapshot as { lines?: { label?: string; amountKobo?: string; kind?: string }[] } | null)
      ?.lines ?? [];
  let surcharge = 0n;
  for (const line of lines) {
    if (line.kind !== 'charge') continue;
    if (line.label === 'Total') continue;
    if (!/express|scheduled|same-day/i.test(line.label ?? '')) continue;
    surcharge += BigInt(line.amountKobo ?? '0');
  }
  if (surcharge > chargeKobo) surcharge = chargeKobo;
  return { deliveryRevenue: chargeKobo - surcharge, surchargeRevenue: surcharge };
}

function safeJson(raw: string): Prisma.InputJsonValue {
  try {
    return JSON.parse(raw) as Prisma.InputJsonValue;
  } catch {
    return { raw };
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}
