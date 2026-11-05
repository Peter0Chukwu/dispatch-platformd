import { Injectable, Logger } from '@nestjs/common';
import type { JournalEventType, Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma/prisma.service';
import { AppError } from '../common/errors/app-error';
import { ACCOUNTS } from './accounts';

export interface LedgerLineInput {
  /** Account code from `ACCOUNTS` (or any other seeded code). */
  code: string;
  /** Exactly one of debit/credit must be non-zero. Values are integer kobo. */
  debitKobo?: bigint;
  creditKobo?: bigint;
  memo?: string;
}

export interface PostJournalInput {
  eventType: JournalEventType;
  description: string;
  /**
   * One key per business event. Posting the same key twice returns the first
   * entry instead of writing a second — that is the whole defence against a
   * retried webhook, a double-click or a replayed job.
   */
  idempotencyKey: string;
  lines: LedgerLineInput[];
  deliveryId?: string;
  paymentId?: string;
  withdrawalId?: string;
  createdById?: string;
}

type Client = PrismaService | Prisma.TransactionClient;

/**
 * THE DOUBLE-ENTRY LEDGER
 * ─────────────────────────────────────────────────────────────────────────────
 * Every kobo the platform moves is written here as a journal entry whose debits
 * and credits are equal. Wallets and earnings are *cached* answers: the ledger is
 * the record. If the two ever disagree, the ledger wins and the cache is wrong.
 *
 * Rules enforced on every posting:
 *
 *   1. A line carries exactly one side — a debit or a credit, never both.
 *   2. The entry balances. Debits = credits, to the kobo, or nothing is written.
 *   3. The idempotency key is unique per business event, so a retried webhook
 *      cannot double-post a payment.
 *
 * The entry and its lines are written in a single transaction with the caller's
 * work, so money and state can never disagree.
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger('Ledger');

  constructor(private readonly prisma: PrismaService) {}

  /** Post a balanced journal entry. Idempotent on `idempotencyKey`. */
  async post(
    input: PostJournalInput,
    client: Client = this.prisma,
  ): Promise<{ entryId: string; reference: string; duplicate: boolean }> {
    const existing = await client.journalEntry.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true, reference: true },
    });
    if (existing) {
      return { entryId: existing.id, reference: existing.reference, duplicate: true };
    }

    if (input.lines.length < 2) {
      throw AppError.validation([
        { field: 'lines', message: 'A journal entry needs at least two lines' },
      ]);
    }

    let debits = 0n;
    let credits = 0n;
    for (const line of input.lines) {
      const debit = line.debitKobo ?? 0n;
      const credit = line.creditKobo ?? 0n;
      if ((debit > 0n) === (credit > 0n)) {
        throw AppError.validation([
          {
            field: 'lines',
            message: `Line ${line.code} must carry a debit or a credit, not both or neither`,
          },
        ]);
      }
      if (debit < 0n || credit < 0n) {
        throw AppError.validation([{ field: 'lines', message: 'Negative amounts are not postable' }]);
      }
      debits += debit;
      credits += credit;
    }

    if (debits !== credits) {
      // A single unbalanced entry corrupts the books forever; refuse loudly.
      throw AppError.validation([
        {
          field: 'lines',
          message: `Journal entry is unbalanced: debits ${debits} ≠ credits ${credits}`,
        },
      ]);
    }

    const accounts = await this.resolveAccounts(
      client,
      [...new Set(input.lines.map((line) => line.code))],
    );

    const reference = `JE-${input.eventType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const entry = await client.journalEntry.create({
      data: {
        reference,
        eventType: input.eventType,
        description: input.description,
        idempotencyKey: input.idempotencyKey,
        deliveryId: input.deliveryId ?? null,
        paymentId: input.paymentId ?? null,
        withdrawalId: input.withdrawalId ?? null,
        createdById: input.createdById ?? null,
        lines: {
          create: input.lines.map((line) => ({
            accountId: accounts.get(line.code)!,
            debitKobo: line.debitKobo ?? 0n,
            creditKobo: line.creditKobo ?? 0n,
            memo: line.memo ?? null,
          })),
        },
      },
      select: { id: true, reference: true },
    });

    this.logger.log(
      `${input.eventType} ${entry.reference} · ${input.lines.length} lines · ${debits} kobo balanced`,
    );

    return { entryId: entry.id, reference: entry.reference, duplicate: false };
  }

  private async resolveAccounts(client: Client, codes: string[]): Promise<Map<string, string>> {
    const rows = await client.ledgerAccount.findMany({
      where: { code: { in: codes }, isActive: true },
      select: { id: true, code: true },
    });
    const map = new Map(rows.map((row) => [row.code, row.id]));
    const missing = codes.filter((code) => !map.has(code));
    if (missing.length > 0) {
      // Almost always a fresh database where the seed has not run yet.
      throw AppError.conflict(
        `Ledger account(s) missing: ${missing.join(', ')}. Run "npm run db:seed".`,
        'LEDGER_ACCOUNT_MISSING',
      );
    }
    return map;
  }

  /**
   * The trial balance: every account's debits, credits and net position.
   * `balanced` must always be true — the test suite asserts it after money moves.
   */
  async trialBalance(from?: Date, to?: Date) {
    const accounts = await this.prisma.ledgerAccount.findMany({
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true, type: true, normalBalance: true },
    });

    const grouped = await this.prisma.ledgerLine.groupBy({
      by: ['accountId'],
      where:
        from || to
          ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
          : undefined,
      _sum: { debitKobo: true, creditKobo: true },
    });

    const byAccount = new Map(grouped.map((row) => [row.accountId, row._sum]));

    let totalDebits = 0n;
    let totalCredits = 0n;
    const rows = accounts.map((account) => {
      const sums = byAccount.get(account.id);
      const debit = sums?.debitKobo ?? 0n;
      const credit = sums?.creditKobo ?? 0n;
      totalDebits += debit;
      totalCredits += credit;
      const signed = account.normalBalance === 'DEBIT' ? debit - credit : credit - debit;
      return {
        code: account.code,
        name: account.name,
        type: account.type,
        normalBalance: account.normalBalance,
        debitKobo: debit.toString(),
        creditKobo: credit.toString(),
        balanceKobo: signed.toString(),
      };
    });

    return {
      rows,
      totalDebitsKobo: totalDebits.toString(),
      totalCreditsKobo: totalCredits.toString(),
      balanced: totalDebits === totalCredits,
    };
  }

  /** Net balance of one account in the direction of its normal balance. */
  /**
   * Balance of one account, all time — or only the postings inside `window`.
   *
   * The period form matters for reports: a range that says "September" must not
   * include a posting from last year. A balance is a *sum of postings*, so scoping
   * it by `postedAt` is the honest way to ask for a period figure.
   */
  async accountBalance(code: string, window?: { from?: Date; to?: Date }): Promise<bigint> {
    const account = await this.prisma.ledgerAccount.findUniqueOrThrow({
      where: { code },
      select: { id: true, normalBalance: true },
    });
    const postedAt =
      window?.from || window?.to
        ? { ...(window.from ? { gte: window.from } : {}), ...(window.to ? { lte: window.to } : {}) }
        : undefined;
    const sums = await this.prisma.ledgerLine.aggregate({
      where: { accountId: account.id, ...(postedAt ? { journalEntry: { postedAt } } : {}) },
      _sum: { debitKobo: true, creditKobo: true },
    });
    const debit = sums._sum.debitKobo ?? 0n;
    const credit = sums._sum.creditKobo ?? 0n;
    return account.normalBalance === 'DEBIT' ? debit - credit : credit - debit;
  }

  /** Convenience for the common "money in from a provider" shape. */
  static clearingFor(provider: string): string {
    return provider === 'FLUTTERWAVE'
      ? ACCOUNTS.FLUTTERWAVE_CLEARING
      : provider === 'WALLET'
        ? ACCOUNTS.CUSTOMER_WALLET_LIABILITY
        : provider === 'CASH'
          ? ACCOUNTS.CASH_CLEARING
          : ACCOUNTS.PAYSTACK_CLEARING;
  }
}
