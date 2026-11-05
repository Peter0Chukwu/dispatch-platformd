import { Injectable, Logger } from '@nestjs/common';
import type {
  Prisma,
  WalletDirection,
  WalletTxCategory,
  WalletType,
  JournalEventType,
} from '@prisma/client';
import { PrismaService } from '../infra/prisma/prisma.service';
import { AppError } from '../common/errors/app-error';
import { LedgerService } from '../ledger/ledger.service';
import { formatNaira } from '@dispatch/shared';

export interface ApplyWalletInput {
  userId: string;
  type?: WalletType;
  direction: WalletDirection;
  category: WalletTxCategory;
  amountKobo: bigint;
  idempotencyKey: string;
  description: string;
  /** The account on the other side of this movement, and the side it takes. */
  counterCode: string;
  counterSide: 'DEBIT' | 'CREDIT';
  eventType: JournalEventType;
  deliveryId?: string;
  paymentId?: string;
  createdById?: string;
}

/**
 * CUSTOMER WALLETS
 * ─────────────────────────────────────────────────────────────────────────────
 * A wallet balance is a cached liability. Every movement writes a
 * `WalletTransaction` (with the balance after it) *and* a balanced journal entry,
 * in one transaction, in one direction only.
 *
 * Two protections matter here:
 *
 *   • `SELECT … FOR UPDATE` on the wallet row, plus an optimistic `version`
 *     bump, so two simultaneous debits cannot both read ₦500 and both succeed.
 *   • The database CHECK (balance >= 0) is the final backstop: even a bug in this
 *     service cannot create money.
 */
@Injectable()
export class WalletService {
  private readonly logger = new Logger('Wallet');

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  /** Wallets are created on first use — a customer never has to "open" one. */
  async getOrCreate(userId: string, type: WalletType = 'CUSTOMER', client: Prisma.TransactionClient | PrismaService = this.prisma) {
    return client.wallet.upsert({
      where: { userId },
      update: {},
      create: { userId, type },
    });
  }

  async view(userId: string) {
    const wallet = await this.getOrCreate(userId);
    return {
      id: wallet.id,
      type: wallet.type,
      currency: wallet.currency,
      balanceKobo: wallet.balanceKobo.toString(),
      balanceFormatted: formatNaira(wallet.balanceKobo),
      isActive: wallet.isActive,
      updatedAt: wallet.updatedAt,
    };
  }

  async transactions(userId: string, page = 1, pageSize = 20) {
    const wallet = await this.getOrCreate(userId);
    const [rows, total] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.walletTransaction.count({ where: { walletId: wallet.id } }),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        direction: row.direction,
        category: row.category,
        amountKobo: row.amountKobo.toString(),
        amountFormatted: formatNaira(row.amountKobo),
        balanceAfterKobo: row.balanceAfterKobo.toString(),
        balanceAfterFormatted: formatNaira(row.balanceAfterKobo),
        reference: row.reference,
        description: row.description,
        deliveryId: row.deliveryId,
        createdAt: row.createdAt,
      })),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  /**
   * Move money in or out of a wallet, posting the matching journal entry.
   * Must be called inside a transaction when it accompanies another write.
   */
  async apply(input: ApplyWalletInput, client?: Prisma.TransactionClient) {
    if (input.amountKobo <= 0n) {
      throw AppError.validation([{ field: 'amountKobo', message: 'Amount must be greater than zero' }]);
    }

    const run = async (tx: Prisma.TransactionClient) => {
      const wallet = await this.getOrCreate(input.userId, input.type ?? 'CUSTOMER', tx);

      // Duplicate submit (double click, retried webhook) → return the first result.
      const existing = await tx.walletTransaction.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) return { transaction: existing, duplicate: true, journalReference: null };

      // Serialize concurrent movements on this wallet.
      await tx.$queryRaw`SELECT id FROM wallets WHERE id = ${wallet.id}::uuid FOR UPDATE`;
      const fresh = await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } });

      const delta = input.direction === 'CREDIT' ? input.amountKobo : -input.amountKobo;
      const balanceAfter = fresh.balanceKobo + delta;
      if (balanceAfter < 0n) {
        throw AppError.conflict(
          `Insufficient wallet balance: ${formatNaira(fresh.balanceKobo)} available, ${formatNaira(input.amountKobo)} required.`,
          'WALLET_INSUFFICIENT_FUNDS',
        );
      }

      const updated = await tx.wallet.updateMany({
        where: { id: fresh.id, version: fresh.version },
        data: { balanceKobo: balanceAfter, version: { increment: 1 } },
      });
      if (updated.count !== 1) {
        throw AppError.conflict('Wallet changed while this payment was in flight. Please retry.', 'WALLET_CONTENTION');
      }

      const walletSide =
        input.direction === 'CREDIT'
          ? { creditKobo: input.amountKobo }
          : { debitKobo: input.amountKobo };

      const journal = await this.ledger.post(
        {
          eventType: input.eventType,
          description: input.description,
          idempotencyKey: `wallet:${input.idempotencyKey}`,
          deliveryId: input.deliveryId,
          paymentId: input.paymentId,
          createdById: input.createdById,
          lines: [
            { code: '2000_CUSTOMER_WALLET_LIABILITY', ...walletSide, memo: input.description },
            {
              code: input.counterCode,
              ...(input.counterSide === 'DEBIT'
                ? { debitKobo: input.amountKobo }
                : { creditKobo: input.amountKobo }),
              memo: input.description,
            },
          ],
        },
        tx,
      );

      const transaction = await tx.walletTransaction.create({
        data: {
          walletId: fresh.id,
          direction: input.direction,
          category: input.category,
          amountKobo: input.amountKobo,
          balanceAfterKobo: balanceAfter,
          reference: `WTX-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
          idempotencyKey: input.idempotencyKey,
          journalEntryId: journal.entryId,
          description: input.description,
          deliveryId: input.deliveryId ?? null,
        },
      });

      this.logger.log(
        `Wallet ${input.direction} ${formatNaira(input.amountKobo)} (${input.category}) → balance ${formatNaira(balanceAfter)}`,
      );

      return { transaction, duplicate: false, journalReference: journal.reference };
    };

    return client ? run(client) : this.prisma.$transaction(run, { timeout: 15000 });
  }
}
