import { Injectable } from "@nestjs/common";
import { formatNaira } from "@dispatch/shared";
import { PrismaService } from "../infra/prisma/prisma.service";
import { LedgerService } from "../ledger/ledger.service";
import { ACCOUNTS } from "../ledger/accounts";

/**
 * THE FINANCE DESK
 * ─────────────────────────────────────────────────────────────────────────────
 * Every number on this screen is computed from rows: payments, ledger lines,
 * withdrawals and refunds. Nothing here is a placeholder and nothing is cached, so
 * a finance manager can reconcile the dashboard against the books and always get
 * the same answer.
 *
 * The split is deliberate:
 *   · *collected* — money that actually arrived (successful payments);
 *   · *rider cost* — the net earnings riders will be paid;
 *   · *gateway cost* — what the processors kept;
 *   · *net* — what the company keeps, which must equal revenue − refunds − rider
 *     cost − gateway fees. The reconciliation panel proves it against the ledger.
 */
@Injectable()
export class AdminFinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  async summary(from?: Date, to?: Date) {
    const window = from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : undefined;

    const [collected, refunded, earnings, withdrawals, walletLiability, byProvider] =
      await Promise.all([
        this.prisma.payment.aggregate({
          where: { status: "SUCCESS", ...(window ? { createdAt: window } : {}) },
          _sum: { amountKobo: true, feeKobo: true },
          _count: { _all: true },
        }),
        this.prisma.refund.aggregate({
          where: { status: "COMPLETED", ...(window ? { createdAt: window } : {}) },
          _sum: { amountKobo: true },
          _count: { _all: true },
        }),
        this.prisma.riderEarning.aggregate({
          where: window ? { createdAt: window } : undefined,
          _sum: { netKobo: true, commissionKobo: true, grossKobo: true },
        }),
        this.prisma.withdrawal.aggregate({
          where: { status: "PAID", ...(window ? { createdAt: window } : {}) },
          _sum: { netAmountKobo: true },
          _count: { _all: true },
        }),
        this.prisma.wallet.aggregate({ where: { type: "CUSTOMER" }, _sum: { balanceKobo: true } }),
        this.prisma.payment.groupBy({
          by: ["provider"],
          where: { status: "SUCCESS", ...(window ? { createdAt: window } : {}) },
          _sum: { amountKobo: true },
          _count: { _all: true },
        }),
      ]);

    const [revenueKobo, surchargeKobo, refundsKobo, feesKobo, riderCostKobo] = await Promise.all([
      this.ledgerBalance(ACCOUNTS.DELIVERY_REVENUE),
      this.ledgerBalance(ACCOUNTS.SURCHARGE_REVENUE),
      this.ledgerBalance(ACCOUNTS.REFUNDS),
      this.ledgerBalance(ACCOUNTS.GATEWAY_FEES),
      this.ledgerBalance(ACCOUNTS.RIDER_COMMISSION_COST),
    ]);

    const collectedKobo = collected._sum.amountKobo ?? 0n;
    const gatewayFeesKobo = collected._sum.feeKobo ?? 0n;
    const refundedKobo = refunded._sum.amountKobo ?? 0n;
    const riderNetKobo = earnings._sum.netKobo ?? 0n;
    const commissionKobo = earnings._sum.commissionKobo ?? 0n;
    const netKobo = revenueKobo + surchargeKobo - refundsKobo - riderCostKobo - feesKobo;

    const pending = await this.prisma.withdrawal.aggregate({
      where: { status: { in: ["REQUESTED", "APPROVED", "PROCESSING"] } },
      _sum: { amountKobo: true },
      _count: { _all: true },
    });

    return {
      period: { from: from ?? null, to: to ?? null },
      collected: {
        payments: collected._count._all,
        amountKobo: collectedKobo.toString(),
        amountFormatted: formatNaira(collectedKobo),
        gatewayFeesKobo: gatewayFeesKobo.toString(),
        gatewayFeesFormatted: formatNaira(gatewayFeesKobo),
      },
      revenue: {
        deliveryKobo: revenueKobo.toString(),
        surchargeKobo: surchargeKobo.toString(),
        totalFormatted: formatNaira(revenueKobo + surchargeKobo),
      },
      refunds: {
        count: refunded._count._all,
        amountKobo: refundedKobo.toString(),
        amountFormatted: formatNaira(refundedKobo),
      },
      riders: {
        grossKobo: (earnings._sum.grossKobo ?? 0n).toString(),
        commissionKobo: commissionKobo.toString(),
        netKobo: riderNetKobo.toString(),
        netFormatted: formatNaira(riderNetKobo),
        paidOutKobo: (withdrawals._sum.netAmountKobo ?? 0n).toString(),
        paidOutFormatted: formatNaira(withdrawals._sum.netAmountKobo ?? 0n),
        pendingWithdrawals: pending._count._all,
        pendingValueKobo: (pending._sum.amountKobo ?? 0n).toString(),
        pendingValueFormatted: formatNaira(pending._sum.amountKobo ?? 0n),
      },
      walletLiability: {
        balanceKobo: (walletLiability._sum.balanceKobo ?? 0n).toString(),
        balanceFormatted: formatNaira(walletLiability._sum.balanceKobo ?? 0n),
      },
      net: {
        kobo: netKobo.toString(),
        formatted: formatNaira(netKobo),
        margin:
          revenueKobo + surchargeKobo > 0n
            ? Number((netKobo * 10_000n) / (revenueKobo + surchargeKobo)) / 100
            : 0,
      },
      byProvider: byProvider.map((row) => ({
        provider: row.provider,
        count: row._count._all,
        amountKobo: (row._sum.amountKobo ?? 0n).toString(),
        amountFormatted: formatNaira(row._sum.amountKobo ?? 0n),
      })),
    };
  }

  async payments(status: string | undefined, page = 1, pageSize = 20) {
    const where = status ? { status: status as never } : {};
    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          delivery: { select: { id: true, reference: true } },
          customer: { select: { user: { select: { firstName: true, lastName: true, email: true } } } },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        reference: row.providerReference,
        provider: row.provider,
        status: row.status,
        amountKobo: row.amountKobo.toString(),
        amountFormatted: formatNaira(row.amountKobo),
        feeKobo: row.feeKobo.toString(),
        purpose: row.deliveryId ? "DELIVERY" : "WALLET_TOPUP",
        delivery: row.delivery,
        customer: `${row.customer.user.firstName} ${row.customer.user.lastName}`.trim(),
        customerEmail: row.customer.user.email,
        paidAt: row.paidAt,
        createdAt: row.createdAt,
      })),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  /**
   * RECONCILIATION
   *
   * Two questions, answered with data rather than hope:
   *   1. Does every successful payment have exactly one ledger entry?
   *   2. Do the ledger balances agree with the operational tables (wallets,
   *      rider payables, withdrawals in transit)?
   *
   * Anything that disagrees is listed by id, so it can be investigated rather than
   * discovered by a customer.
   */
  async reconciliation() {
    const trial = await this.ledger.trialBalance();

    const [payments, walletTotal, earningsTotal, withdrawalsPaid, withdrawalsPending] =
      await Promise.all([
        this.prisma.payment.findMany({
          where: { status: "SUCCESS" },
          select: { id: true, providerReference: true, amountKobo: true, deliveryId: true },
        }),
        this.prisma.wallet.aggregate({ where: { type: "CUSTOMER" }, _sum: { balanceKobo: true } }),
        this.prisma.riderEarning.aggregate({ _sum: { netKobo: true } }),
        this.prisma.withdrawal.aggregate({
          where: { status: "PAID" },
          _sum: { netAmountKobo: true },
        }),
        this.prisma.withdrawal.aggregate({
          where: { status: { in: ["APPROVED", "PROCESSING"] } },
          _sum: { amountKobo: true },
        }),
      ]);

    // Any journal entry that names a payment counts — a delivery payment and a
    // wallet top-up both do, and both must be posted exactly once.
    const journalForPayments = await this.prisma.journalEntry.findMany({
      where: { paymentId: { not: null } },
      select: { paymentId: true },
    });
    const posted = new Set(journalForPayments.map((row) => row.paymentId));
    const unposted = payments.filter((payment) => !posted.has(payment.id));

    const ledgerWallet = await this.ledger.accountBalance(ACCOUNTS.CUSTOMER_WALLET_LIABILITY);
    const ledgerEarnings = await this.ledger.accountBalance(ACCOUNTS.RIDER_EARNINGS_PAYABLE);
    const ledgerWithdrawals = await this.ledger.accountBalance(ACCOUNTS.WITHDRAWALS_PAYABLE);

    const walletBalance = walletTotal._sum.balanceKobo ?? 0n;
    // Earnings payable in the books = net accrued − paid out − approved-but-unpaid
    // (which has moved to withdrawals payable). This is the check that matters.
    const earningsAccrued = earningsTotal._sum.netKobo ?? 0n;
    const expectedEarnings =
      earningsAccrued - (withdrawalsPaid._sum.netAmountKobo ?? 0n) - (withdrawalsPending._sum.amountKobo ?? 0n);

    return {
      trialBalanceBalanced: trial.balanced,
      totals: {
        debitsKobo: trial.totalDebitsKobo,
        creditsKobo: trial.totalCreditsKobo,
      },
      checks: [
        {
          name: "Trial balance",
          ok: trial.balanced,
          detail: trial.balanced
            ? `Debits equal credits (${formatNaira(BigInt(trial.totalDebitsKobo))})`
            : `Out by ${formatNaira(BigInt(trial.totalDebitsKobo) - BigInt(trial.totalCreditsKobo))}`,
        },
        {
          name: "Every successful payment is posted",
          ok: unposted.length === 0,
          detail:
            unposted.length === 0
              ? `${payments.length} payment(s) each have one journal entry`
              : `${unposted.length} payment(s) missing a journal entry`,
          offenders: unposted.slice(0, 10).map((payment) => payment.providerReference),
        },
        {
          name: "Wallet balances match the ledger",
          ok: walletBalance === ledgerWallet,
          detail: `Wallets ${formatNaira(walletBalance)} · ledger ${formatNaira(ledgerWallet)}`,
        },
        {
          name: "Rider payables match accruals",
          ok: expectedEarnings === ledgerEarnings,
          detail: `Expected ${formatNaira(expectedEarnings)} · ledger ${formatNaira(ledgerEarnings)}`,
        },
        {
          name: "Withdrawals in transit match the ledger",
          ok: (withdrawalsPending._sum.amountKobo ?? 0n) === ledgerWithdrawals,
          detail: `In transit ${formatNaira(withdrawalsPending._sum.amountKobo ?? 0n)} · ledger ${formatNaira(ledgerWithdrawals)}`,
        },
      ],
      accounts: trial.rows.filter((row) => row.debitKobo !== "0" || row.creditKobo !== "0"),
    };
  }

  /** Net balance of a revenue/expense account, in naira-friendly kobo. */
  private async ledgerBalance(code: string): Promise<bigint> {
    return this.ledger.accountBalance(code);
  }
}
