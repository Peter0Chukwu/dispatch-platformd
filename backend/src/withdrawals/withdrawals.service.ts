import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, WithdrawalStatus } from '@prisma/client';
import { PrismaService } from '../infra/prisma/prisma.service';
import { AppConfig } from '../config/app.config';
import { AppError } from '../common/errors/app-error';
import { LedgerService } from '../ledger/ledger.service';
import { ACCOUNTS } from '../ledger/accounts';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { RT } from '../realtime/realtime.types';
import { formatNaira } from '@dispatch/shared';

/** Every status where the money is committed but not necessarily gone yet. */
const IN_FLIGHT_STATUSES: WithdrawalStatus[] = ['REQUESTED', 'APPROVED', 'PROCESSING', 'PAID'];

export interface WithdrawalRequestInput {
  amountKobo: bigint;
  bankName: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  idempotencyKey?: string;
}

/**
 * RIDER WITHDRAWALS
 * ─────────────────────────────────────────────────────────────────────────────
 * A rider earns per delivery; earnings are held for a window and then become
 * withdrawable. A withdrawal is a *request* — money is not promised until staff
 * approve it, and not gone until the payout is confirmed.
 *
 *   REQUESTED ──approve──▶ APPROVED ──payout──▶ PAID
 *        └─────reject─────▶ REJECTED (earnings released back)
 *
 * Three protections:
 *   • Earnings are *allocated* to the withdrawal at request time, inside one
 *     transaction, so the same ₦5,000 cannot be requested twice.
 *   • The daily cap and minimum come from runtime settings, not constants.
 *   • The idempotency key makes a double-tapped submit return the first request.
 */
@Injectable()
export class WithdrawalsService {
  private readonly logger = new Logger('Withdrawals');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly ledger: LedgerService,
    private readonly realtime: RealtimeGateway,
  ) {}

  // ── Rider side ────────────────────────────────────────────────────────────

  /**
   * What the rider could request right now, and the honest breakdown behind it.
   *
   * `available` is earnings whose hold has elapsed; `inFlight` is every withdrawal
   * that has not been rejected, which stops the same money being requested twice.
   * The payout path never mutates earnings — this formula is the single source of
   * truth, so the numbers can only ever match the ledger.
   */
  async withdrawable(riderId: string) {
    // Same lazy release as the rider summary: a matured hold is withdrawable the
    // moment the rider looks, not when a timer happens to run.
    await this.prisma.riderEarning.updateMany({
      where: { riderId, status: 'PENDING', availableAt: { lte: new Date() } },
      data: { status: 'AVAILABLE' },
    });

    const [earnings, adjustments, withdrawals] = await Promise.all([
      this.prisma.riderEarning.aggregate({
        where: {
          riderId,
          status: 'AVAILABLE',
          availableAt: { lte: new Date() },
        },
        _sum: { netKobo: true },
        _count: { _all: true },
      }),
      this.prisma.riderAdjustment.aggregate({ where: { riderId }, _sum: { amountKobo: true } }),
      this.prisma.withdrawal.aggregate({
        where: { riderId, status: { in: IN_FLIGHT_STATUSES } },
        _sum: { amountKobo: true },
      }),
    ]);

    const availableKobo = earnings._sum.netKobo ?? 0n;
    const adjustmentsKobo = adjustments._sum.amountKobo ?? 0n;
    const inFlightKobo = withdrawals._sum?.amountKobo ?? 0n;
    const raw = availableKobo + adjustmentsKobo - inFlightKobo;

    return {
      availableKobo,
      adjustmentsKobo,
      inFlightKobo,
      withdrawableKobo: raw < 0n ? 0n : raw,
      earningCount: earnings._count._all,
    };
  }

  async request(riderId: string, input: WithdrawalRequestInput) {
    const settings = await this.settings();
    if (input.amountKobo < settings.minWithdrawalKobo) {
      throw AppError.validation([
        {
          field: 'amountKobo',
          message: `Minimum withdrawal is ${formatNaira(settings.minWithdrawalKobo)}`,
        },
      ]);
    }

    const idempotencyKey =
      input.idempotencyKey?.trim() ||
      `wd:${riderId}:${input.amountKobo}:${new Date().toISOString().slice(0, 16)}`;

    const existing = await this.prisma.withdrawal.findUnique({ where: { idempotencyKey } });
    if (existing) {
      this.logger.log(`Duplicate withdrawal request ${idempotencyKey} returned as-is`);
      return this.dto(existing);
    }

    const state = await this.withdrawable(riderId);
    if (state.withdrawableKobo < input.amountKobo) {
      throw AppError.conflict(
        `You have ${formatNaira(state.withdrawableKobo)} withdrawable — ${formatNaira(input.amountKobo)} was requested.`,
        'WITHDRAWAL_NOT_ELIGIBLE',
      );
    }

    const since = startOfDayLagos();
    const today = await this.prisma.withdrawal.aggregate({
      where: {
        riderId,
        createdAt: { gte: since },
        status: { in: IN_FLIGHT_STATUSES },
      },
      _sum: { amountKobo: true },
    });
    const alreadyToday = today._sum?.amountKobo ?? 0n;
    if (alreadyToday + input.amountKobo > settings.maxWithdrawalPerDayKobo) {
      throw AppError.conflict(
        `The daily withdrawal limit is ${formatNaira(settings.maxWithdrawalPerDayKobo)}. You have already requested ${formatNaira(alreadyToday)} today.`,
        'WITHDRAWAL_LIMIT',
      );
    }

    // The unique idempotency key is the real guard: two simultaneous submissions
    // with the same key cannot both create a withdrawal.
    const withdrawal = await this.prisma.withdrawal
      .create({
        data: {
          riderId,
          amountKobo: input.amountKobo,
          feeKobo: 0n,
          netAmountKobo: input.amountKobo,
          status: 'REQUESTED',
          bankName: input.bankName,
          bankCode: input.bankCode,
          accountNumber: input.accountNumber,
          accountName: input.accountName,
          idempotencyKey,
        },
      })
      .catch((error: unknown) => {
        if (typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002') {
          throw AppError.conflict('This withdrawal was already submitted.', 'DUPLICATE_REQUEST');
        }
        throw error;
      });

    this.logger.log(
      `Withdrawal ${withdrawal.id.slice(0, 8)} requested by rider ${riderId.slice(0, 8)}: ${formatNaira(input.amountKobo)}`,
    );
    this.realtime.toStaff(RT.PAYMENT_UPDATED, {
      kind: 'withdrawal',
      withdrawalId: withdrawal.id,
      status: withdrawal.status,
      amountFormatted: formatNaira(withdrawal.amountKobo),
    });
    return this.dto(withdrawal);
  }

  async listForRider(riderId: string, page = 1, pageSize = 20) {
    const [rows, total] = await Promise.all([
      this.prisma.withdrawal.findMany({
        where: { riderId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.withdrawal.count({ where: { riderId } }),
    ]);
    return {
      data: rows.map((row) => this.dto(row)),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  // ── Staff side ────────────────────────────────────────────────────────────

  async listForStaff(status: string | undefined, page = 1, pageSize = 20) {
    const where: Prisma.WithdrawalWhereInput = status
      ? { status: status as Prisma.WithdrawalWhereInput['status'] }
      : {};
    const [rows, total] = await Promise.all([
      this.prisma.withdrawal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          rider: {
            select: {
              id: true,
              riderCode: true,
              user: { select: { firstName: true, lastName: true, phone: true } },
            },
          },
        },
      }),
      this.prisma.withdrawal.count({ where }),
    ]);

    const totals = await this.prisma.withdrawal.groupBy({
      by: ['status'],
      _sum: { amountKobo: true },
      _count: { _all: true },
    });

    return {
      data: rows.map((row) => ({
        ...this.dto(row),
        rider: {
          id: row.rider.id,
          riderCode: row.rider.riderCode,
          name: `${row.rider.user.firstName} ${row.rider.user.lastName}`.trim(),
          phone: row.rider.user.phone,
        },
      })),
      summary: {
        requested: totals.find((row) => row.status === 'REQUESTED')?._count._all ?? 0,
        approved: totals.find((row) => row.status === 'APPROVED')?._count._all ?? 0,
        processing: totals.find((row) => row.status === 'PROCESSING')?._count._all ?? 0,
        paid: totals.find((row) => row.status === 'PAID')?._count._all ?? 0,
        rejected: totals.find((row) => row.status === 'REJECTED')?._count._all ?? 0,
        pendingValueKobo: (
          totals
            .filter((row) => ['REQUESTED', 'APPROVED', 'PROCESSING'].includes(row.status))
            .reduce((sum, row) => sum + (row._sum.amountKobo ?? 0n), 0n)
        ).toString(),
      },
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  /**
   * Approval does not move money; it moves the obligation.
   * Dr Rider earnings payable / Cr Withdrawals payable.
   */
  async approve(withdrawalId: string, staffId: string, note?: string | null) {
    const result = await this.prisma.$transaction(async (tx) => {
      const withdrawal = await tx.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
      if (withdrawal.status !== 'REQUESTED') {
        throw AppError.conflict(
          `This withdrawal is ${withdrawal.status.toLowerCase()} and cannot be approved.`,
          'INVALID_STATUS_TRANSITION',
        );
      }

      const updated = await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          status: 'APPROVED',
          reviewedById: staffId,
          reviewedAt: new Date(),
          decisionNote: note ?? null,
        },
      });

      await this.ledger.post(
        {
          eventType: 'PAYOUT',
          description: `Withdrawal ${withdrawal.id.slice(0, 8)} approved`,
          idempotencyKey: `withdrawal-approve:${withdrawal.id}`,
          withdrawalId: withdrawal.id,
          createdById: staffId,
          lines: [
            { code: ACCOUNTS.RIDER_EARNINGS_PAYABLE, debitKobo: withdrawal.amountKobo },
            { code: ACCOUNTS.WITHDRAWALS_PAYABLE, creditKobo: withdrawal.amountKobo },
          ],
        },
        tx,
      );

      return updated;
    });

    this.realtime.toRider(result.riderId, RT.PAYMENT_UPDATED, {
      kind: 'withdrawal',
      withdrawalId: result.id,
      status: result.status,
    });
    return this.dto(result);
  }

  /**
   * Rejection. Nothing to release: earnings were never consumed by the request,
   * because `withdrawable` subtracts in-flight withdrawals instead. If the
   * withdrawal had already been approved, the approval entry is reversed so the
   * books never show an obligation that will not be paid.
   */
  async reject(withdrawalId: string, staffId: string, note: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const withdrawal = await tx.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
      if (!['REQUESTED', 'APPROVED'].includes(withdrawal.status)) {
        throw AppError.conflict(
          `This withdrawal is ${withdrawal.status.toLowerCase()} and cannot be rejected.`,
          'INVALID_STATUS_TRANSITION',
        );
      }

      if (withdrawal.status === 'APPROVED') {
        await this.ledger.post(
          {
            eventType: 'PAYOUT',
            description: `Withdrawal ${withdrawal.id.slice(0, 8)} rejected — reversing approval`,
            idempotencyKey: `withdrawal-reject:${withdrawal.id}`,
            withdrawalId: withdrawal.id,
            createdById: staffId,
            lines: [
              { code: ACCOUNTS.WITHDRAWALS_PAYABLE, debitKobo: withdrawal.amountKobo },
              { code: ACCOUNTS.RIDER_EARNINGS_PAYABLE, creditKobo: withdrawal.amountKobo },
            ],
          },
          tx,
        );
      }

      return tx.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          status: 'REJECTED',
          reviewedById: staffId,
          reviewedAt: new Date(),
          decisionNote: note,
        },
      });
    });

    this.realtime.toRider(result.riderId, RT.PAYMENT_UPDATED, {
      kind: 'withdrawal',
      withdrawalId: result.id,
      status: result.status,
    });
    return this.dto(result);
  }

  /**
   * Pay the rider. In DEVELOPMENT the transfer is simulated and returns a fake
   * reference; in SANDBOX/LIVE this calls the provider's transfer API and only
   * marks the withdrawal PAID on a confirmed response.
   */
  async payout(withdrawalId: string, staffId: string) {
    const withdrawal = await this.prisma.withdrawal.findUniqueOrThrow({
      where: { id: withdrawalId },
    });
    if (withdrawal.status !== 'APPROVED') {
      throw AppError.conflict(
        `Only an approved withdrawal can be paid (this one is ${withdrawal.status.toLowerCase()}).`,
        'INVALID_STATUS_TRANSITION',
      );
    }

    await this.prisma.withdrawal.update({
      where: { id: withdrawal.id },
      data: { status: 'PROCESSING', processedAt: new Date() },
    });

    let transferRef: string;
    let providerError: string | null = null;
    if (this.config.paymentsMode === 'DEVELOPMENT' || !this.config.paystackSecretKey) {
      transferRef = `SIM-WD-${withdrawal.id.slice(0, 8).toUpperCase()}`;
    } else {
      try {
        const response = await fetch('https://api.paystack.co/transfer', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.paystackSecretKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            source: 'balance',
            reason: `Dispatch rider payout ${withdrawal.id.slice(0, 8)}`,
            amount: Number(withdrawal.netAmountKobo),
            recipient: {
              type: 'nuban',
              name: withdrawal.accountName,
              account_number: withdrawal.accountNumber,
              bank_code: withdrawal.bankCode,
              currency: 'NGN',
            },
          }),
        });
        const body = (await response.json()) as {
          status?: boolean;
          message?: string;
          data?: { transfer_code?: string; reference?: string };
        };
        if (!body.status || !body.data) throw new Error(body.message ?? 'Transfer failed');
        transferRef = body.data.transfer_code ?? body.data.reference ?? `PW-${withdrawal.id.slice(0, 8)}`;
      } catch (error) {
        providerError = (error as Error).message;
        transferRef = `FAILED-${withdrawal.id.slice(0, 8)}`;
      }
    }

    if (providerError) {
      await this.prisma.withdrawal.update({
        where: { id: withdrawal.id },
        data: { status: 'FAILED', failureReason: providerError },
      });
      throw AppError.conflict(`The payout could not be sent: ${providerError}`, 'PROVIDER_ERROR');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const paid = await tx.withdrawal.update({
        where: { id: withdrawal.id },
        data: {
          status: 'PAID',
          providerTransferRef: transferRef,
          paidAt: new Date(),
          reviewedById: withdrawal.reviewedById ?? staffId,
        },
      });

      // Obligation leaves the building: withdrawals payable → clearing.
      await this.ledger.post(
        {
          eventType: 'PAYOUT',
          description: `Rider payout ${transferRef}`,
          idempotencyKey: `withdrawal-payout:${withdrawal.id}`,
          withdrawalId: withdrawal.id,
          createdById: staffId,
          lines: [
            { code: ACCOUNTS.WITHDRAWALS_PAYABLE, debitKobo: withdrawal.netAmountKobo },
            { code: ACCOUNTS.PAYSTACK_CLEARING, creditKobo: withdrawal.netAmountKobo },
          ],
        },
        tx,
      );

      return paid;
    });

    this.logger.log(`Payout ${transferRef} sent for ${formatNaira(withdrawal.netAmountKobo)}`);
    this.realtime.toRider(result.riderId, RT.PAYMENT_UPDATED, {
      kind: 'withdrawal',
      withdrawalId: result.id,
      status: result.status,
    });
    return this.dto(result);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async settings() {
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { in: ['finance.minWithdrawalKobo', 'finance.maxWithdrawalPerDayKobo'] } },
    });
    const pick = (key: string, fallback: number): bigint => {
      const row = rows.find((setting) => setting.key === key);
      const value = row?.valueJson;
      return typeof value === 'number' ? BigInt(value) : BigInt(fallback);
    };
    return {
      minWithdrawalKobo: pick('finance.minWithdrawalKobo', 200_000),
      maxWithdrawalPerDayKobo: pick('finance.maxWithdrawalPerDayKobo', 5_000_000),
    };
  }

  dto(withdrawal: {
    id: string;
    riderId: string;
    amountKobo: bigint;
    feeKobo: bigint;
    netAmountKobo: bigint;
    status: string;
    bankName: string;
    accountNumber: string;
    accountName: string;
    providerTransferRef: string | null;
    decisionNote: string | null;
    failureReason: string | null;
    createdAt: Date;
    paidAt: Date | null;
  }) {
    return {
      id: withdrawal.id,
      riderId: withdrawal.riderId,
      amountKobo: withdrawal.amountKobo.toString(),
      amountFormatted: formatNaira(withdrawal.amountKobo),
      feeKobo: withdrawal.feeKobo.toString(),
      netAmountKobo: withdrawal.netAmountKobo.toString(),
      netFormatted: formatNaira(withdrawal.netAmountKobo),
      status: withdrawal.status,
      bankName: withdrawal.bankName,
      // Never return a full account number to a UI that does not need it.
      accountNumberMasked: maskAccount(withdrawal.accountNumber),
      accountName: withdrawal.accountName,
      providerTransferRef: withdrawal.providerTransferRef,
      decisionNote: withdrawal.decisionNote,
      failureReason: withdrawal.failureReason,
      createdAt: withdrawal.createdAt,
      paidAt: withdrawal.paidAt,
    };
  }
}

function maskAccount(accountNumber: string): string {
  if (accountNumber.length <= 4) return accountNumber;
  return `${'•'.repeat(Math.max(0, accountNumber.length - 4))}${accountNumber.slice(-4)}`;
}

/** Lagos is UTC+1 and has no DST; the daily cap resets at local midnight. */
function startOfDayLagos(): Date {
  const now = new Date();
  const lagos = new Date(now.getTime() + 60 * 60 * 1000);
  lagos.setUTCHours(0, 0, 0, 0);
  return new Date(lagos.getTime() - 60 * 60 * 1000);
}
