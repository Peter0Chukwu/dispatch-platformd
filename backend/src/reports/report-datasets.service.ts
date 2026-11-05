import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service';
import { ACCOUNTS } from '../ledger/accounts';
import type { ReportColumn, ReportRow, ReportTable, ReportTotal, ReportTypeName } from './report-types';
import { MAX_REPORT_ROWS } from './report-types';

/**
 * REPORT DATASETS
 * ─────────────────────────────────────────────────────────────────────────────
 * Nine reports, each built from SQL that a reader could have written themselves.
 *
 * Two rules hold them together:
 *
 *   1. **Nothing is pre-aggregated for a dashboard and re-read here.** Every figure
 *      is computed from the rows at the moment of asking, so a report cannot drift
 *      away from the screen it is meant to explain.
 *   2. **Every report declares its own totals**, and those totals are the same
 *      numbers the finance screen and the ledger show — the Phase 9 test asserts
 *      exactly that.
 *
 * Rows are capped at `MAX_REPORT_ROWS` and the table says so (`truncated`) when the
 * cap bites, because a report that silently drops rows is worse than no report.
 */
@Injectable()
export class ReportDatasetsService {
  constructor(private readonly prisma: PrismaService) {}

  async build(type: ReportTypeName, from: Date, to: Date): Promise<ReportTable> {
    switch (type) {
      case 'DAILY_DELIVERIES':
        return this.deliveryPeriodReport('DAILY_DELIVERIES', 'Daily deliveries', "'day'", from, to);
      case 'MONTHLY_DELIVERIES':
        return this.deliveryPeriodReport('MONTHLY_DELIVERIES', 'Monthly deliveries', "'month'", from, to);
      case 'REVENUE':
        return this.revenue(from, to);
      case 'RIDER_EARNINGS':
        return this.riderEarnings(from, to);
      case 'CUSTOMERS':
        return this.customers(from, to);
      case 'CANCELLATIONS':
        return this.cancellations(from, to);
      case 'RIDER_PERFORMANCE':
        return this.riderPerformance(from, to);
      case 'ZONE_PERFORMANCE':
        return this.zonePerformance(from, to);
      case 'FINANCIAL_SUMMARY':
        return this.financialSummary(from, to);
      default:
        throw new Error(`Unknown report type: ${type satisfies never}`);
    }
  }

  /* ─────────────────────── 1 & 2. deliveries by period ─────────────────────── */

  private async deliveryPeriodReport(
    type: string,
    title: string,
    unit: "'day'" | "'month'",
    from: Date,
    to: Date,
  ): Promise<ReportTable> {
    // Raw SQL because Prisma cannot group by date_trunc.
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        bucket: Date;
        bookings: bigint;
        delivered: bigint;
        cancelled: bigint;
        failed: bigint;
        delivered_revenue_kobo: bigint | null;
        avg_distance_km: number | null;
      }>
    >(
      `SELECT date_trunc(${unit}, "createdAt")                       AS bucket,
              COUNT(*)                                              AS bookings,
              COUNT(*) FILTER (WHERE status = 'DELIVERED')           AS delivered,
              COUNT(*) FILTER (WHERE status = 'CANCELLED')           AS cancelled,
              COUNT(*) FILTER (WHERE status = 'FAILED')              AS failed,
              SUM("chargeKobo") FILTER (WHERE status = 'DELIVERED')  AS delivered_revenue_kobo,
              AVG("distanceKm")                                     AS avg_distance_km
         FROM deliveries
        WHERE "createdAt" >= $1 AND "createdAt" <= $2
        GROUP BY 1
        ORDER BY 1 ASC`,
      from,
      to,
    );

    const table: ReportRow[] = rows.map((row) => ({
      period: formatBucket(row.bucket, unit === "'day'" ? 'day' : 'month'),
      bookings: Number(row.bookings),
      delivered: Number(row.delivered),
      cancelled: Number(row.cancelled),
      failed: Number(row.failed),
      completion: row.bookings > 0n ? `${Math.round((Number(row.delivered) / Number(row.bookings)) * 1000) / 10}%` : '—',
      revenueKobo: Number(row.delivered_revenue_kobo ?? 0n),
      avgDistanceKm: row.avg_distance_km === null ? '—' : Math.round(row.avg_distance_km * 10) / 10,
    }));

    const bookings = rows.reduce((sum, row) => sum + Number(row.bookings), 0);
    const delivered = rows.reduce((sum, row) => sum + Number(row.delivered), 0);
    const revenueKobo = rows.reduce((sum, row) => sum + Number(row.delivered_revenue_kobo ?? 0n), 0);

    return {
      type,
      title,
      subtitle: `${bookings} booking${bookings === 1 ? '' : 's'} in the period, ${delivered} delivered. Revenue counts delivered deliveries only.`,
      meta: [],
      columns: [
        { key: 'period', label: unit === "'day'" ? 'Day' : 'Month' },
        { key: 'bookings', label: 'Bookings', align: 'right' },
        { key: 'delivered', label: 'Delivered', align: 'right' },
        { key: 'cancelled', label: 'Cancelled', align: 'right' },
        { key: 'failed', label: 'Failed', align: 'right' },
        { key: 'completion', label: 'Completion', align: 'right' },
        { key: 'revenueKobo', label: 'Delivered revenue', align: 'right', money: true },
        { key: 'avgDistanceKm', label: 'Avg km', align: 'right' },
      ],
      rows: table,
      totals: [
        { label: 'Bookings', value: bookings },
        { label: 'Delivered', value: delivered },
        { label: 'Delivered revenue', value: BigInt(revenueKobo), money: true, emphasis: true },
      ],
    };
  }

  /* ───────────────────────────── 3. revenue ───────────────────────────── */

  private async revenue(from: Date, to: Date): Promise<ReportTable> {
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        bucket: Date;
        provider: string;
        payments: bigint;
        amount_kobo: bigint | null;
        fee_kobo: bigint | null;
      }>
    >(
      `SELECT date_trunc('day', "createdAt") AS bucket,
              provider,
              COUNT(*)                       AS payments,
              SUM("amountKobo")              AS amount_kobo,
              SUM("feeKobo")                 AS fee_kobo
         FROM payments
        WHERE status = 'SUCCESS' AND "createdAt" >= $1 AND "createdAt" <= $2
        GROUP BY 1, 2
        ORDER BY 1 ASC, 2 ASC`,
      from,
      to,
    );

    const table: ReportRow[] = rows.map((row) => {
      const amount = BigInt(row.amount_kobo ?? 0n);
      const fee = BigInt(row.fee_kobo ?? 0n);
      return {
        day: formatBucket(row.bucket, 'day'),
        provider: row.provider,
        payments: Number(row.payments),
        amountKobo: Number(amount),
        feeKobo: Number(fee),
        netKobo: Number(amount - fee),
      };
    });

    const totalAmount = rows.reduce((sum, row) => sum + BigInt(row.amount_kobo ?? 0n), 0n);
    const totalFee = rows.reduce((sum, row) => sum + BigInt(row.fee_kobo ?? 0n), 0n);
    const totalPayments = rows.reduce((sum, row) => sum + Number(row.payments), 0);

    return {
      type: 'REVENUE',
      title: 'Revenue by provider and day',
      subtitle: `Settled payments only. ${totalPayments} payment${totalPayments === 1 ? '' : 's'}; gateway fees are subtracted to show the net.`,
      meta: [],
      columns: [
        { key: 'day', label: 'Day' },
        { key: 'provider', label: 'Provider' },
        { key: 'payments', label: 'Payments', align: 'right' },
        { key: 'amountKobo', label: 'Collected', align: 'right', money: true },
        { key: 'feeKobo', label: 'Gateway fee', align: 'right', money: true },
        { key: 'netKobo', label: 'Net', align: 'right', money: true },
      ],
      rows: table,
      totals: [
        { label: 'Collected', value: totalAmount, money: true },
        { label: 'Gateway fees', value: totalFee, money: true },
        { label: 'Net after fees', value: totalAmount - totalFee, money: true, emphasis: true },
      ],
    };
  }

  /* ───────────────────────────── 4. rider earnings ───────────────────────────── */

  private async riderEarnings(from: Date, to: Date): Promise<ReportTable> {
    const riders = await this.prisma.rider.findMany({
      where: { deletedAt: null },
      orderBy: { riderCode: 'asc' },
      select: {
        id: true,
        riderCode: true,
        user: { select: { firstName: true, lastName: true } },
        earnings: {
          where: { createdAt: { gte: from, lte: to } },
          select: { grossKobo: true, commissionKobo: true, netKobo: true, status: true },
        },
        withdrawals: {
          where: { status: 'PAID', createdAt: { gte: from, lte: to } },
          select: { netAmountKobo: true },
        },
      },
    });

    const rows: ReportRow[] = [];
    let gross = 0n;
    let commission = 0n;
    let net = 0n;
    let pending = 0n;
    let available = 0n;
    let paidOut = 0n;

    for (const rider of riders) {
      if (rider.earnings.length === 0 && rider.withdrawals.length === 0) continue;
      const sum = (pick: (line: (typeof rider.earnings)[number]) => bigint) =>
        rider.earnings.reduce((total, line) => total + pick(line), 0n);

      const riderGross = sum((line) => line.grossKobo);
      const riderCommission = sum((line) => line.commissionKobo);
      const riderNet = sum((line) => line.netKobo);
      const riderPending = sum((line) => (line.status === 'PENDING' ? line.netKobo : 0n));
      const riderAvailable = sum((line) => (line.status === 'AVAILABLE' ? line.netKobo : 0n));
      const riderPaid = rider.withdrawals.reduce((total, line) => total + line.netAmountKobo, 0n);

      gross += riderGross;
      commission += riderCommission;
      net += riderNet;
      pending += riderPending;
      available += riderAvailable;
      paidOut += riderPaid;

      rows.push({
        rider: `${rider.user.firstName} ${rider.user.lastName}`.trim(),
        riderCode: rider.riderCode,
        deliveries: rider.earnings.length,
        grossKobo: Number(riderGross),
        commissionKobo: Number(riderCommission),
        netKobo: Number(riderNet),
        pendingKobo: Number(riderPending),
        availableKobo: Number(riderAvailable),
        paidOutKobo: Number(riderPaid),
      });
    }

    return {
      type: 'RIDER_EARNINGS',
      title: 'Rider earnings',
      subtitle: `${rows.length} rider${rows.length === 1 ? '' : 's'} earned in the period. "On hold" is still PENDING; "cleared" has passed the hold window.`,
      meta: [],
      columns: [
        { key: 'riderCode', label: 'Rider' },
        { key: 'rider', label: 'Name' },
        { key: 'deliveries', label: 'Jobs', align: 'right' },
        { key: 'grossKobo', label: 'Gross', align: 'right', money: true },
        { key: 'commissionKobo', label: 'Commission', align: 'right', money: true },
        { key: 'netKobo', label: 'Net', align: 'right', money: true },
        { key: 'pendingKobo', label: 'On hold', align: 'right', money: true },
        { key: 'availableKobo', label: 'Cleared', align: 'right', money: true },
        { key: 'paidOutKobo', label: 'Paid out', align: 'right', money: true },
      ],
      rows,
      totals: [
        { label: 'Gross earnings', value: gross, money: true },
        { label: 'Commission', value: commission, money: true },
        { label: 'Net owed to riders', value: net, money: true },
        { label: 'Still on hold', value: pending, money: true },
        { label: 'Cleared', value: available, money: true },
        { label: 'Paid out in period', value: paidOut, money: true, emphasis: true },
      ],
    };
  }

  /* ───────────────────────────── 5. customers ───────────────────────────── */

  private async customers(from: Date, to: Date): Promise<ReportTable> {
    const rows = await this.prisma.customer.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        notes: true,
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            status: true,
            wallet: { select: { balanceKobo: true } },
          },
        },
        deliveries: {
          where: { createdAt: { gte: from, lte: to } },
          select: { status: true, chargeKobo: true, createdAt: true },
        },
      },
    });

    const table: ReportRow[] = rows
      .map((customer) => {
        const delivered = customer.deliveries.filter((delivery) => delivery.status === 'DELIVERED');
        const spend = delivered.reduce((sum, delivery) => sum + delivery.chargeKobo, 0n);
        const last = customer.deliveries.reduce<Date | null>(
          (latest, delivery) => (!latest || delivery.createdAt > latest ? delivery.createdAt : latest),
          null,
        );
        return {
          name: `${customer.user.firstName} ${customer.user.lastName}`.trim(),
          email: customer.user.email,
          status: customer.user.status,
          bookings: customer.deliveries.length,
          delivered: delivered.length,
          spendKobo: Number(spend),
          walletKobo: Number(customer.user.wallet?.balanceKobo ?? 0n),
          lastBooking: last ? formatBucket(last, 'day') : '—',
        };
      })
      .filter((row) => row.bookings > 0)
      .sort((a, b) => b.spendKobo - a.spendKobo);

    const spendTotal = table.reduce((sum, row) => sum + Number(row.spendKobo), 0);
    const bookingsTotal = table.reduce((sum, row) => sum + Number(row.bookings), 0);

    return {
      type: 'CUSTOMERS',
      title: 'Customers',
      subtitle: `${table.length} customer${table.length === 1 ? '' : 's'} booked in the period, highest spend first. Only DELIVERED charges count as spend.`,
      meta: [],
      columns: [
        { key: 'name', label: 'Customer' },
        { key: 'email', label: 'Email' },
        { key: 'bookings', label: 'Bookings', align: 'right' },
        { key: 'delivered', label: 'Delivered', align: 'right' },
        { key: 'spendKobo', label: 'Spend', align: 'right', money: true },
        { key: 'walletKobo', label: 'Wallet', align: 'right', money: true },
        { key: 'lastBooking', label: 'Last booking' },
      ],
      rows: table,
      totals: [
        { label: 'Bookings', value: bookingsTotal },
        { label: 'Delivered revenue', value: BigInt(spendTotal), money: true, emphasis: true },
      ],
    };
  }

  /* ───────────────────────── 6. cancellations ───────────────────────── */

  private async cancellations(from: Date, to: Date): Promise<ReportTable> {
    const total = await this.prisma.delivery.count({
      where: { status: 'CANCELLED', cancelledAt: { gte: from, lte: to } },
    });
    const rows = await this.prisma.delivery.findMany({
      where: { status: 'CANCELLED', cancelledAt: { gte: from, lte: to } },
      orderBy: { cancelledAt: 'desc' },
      take: MAX_REPORT_ROWS,
      select: {
        reference: true,
        cancelledAt: true,
        cancellationReason: true,
        chargeKobo: true,
        status: true,
        customer: { select: { user: { select: { firstName: true, lastName: true } } } },
        rider: { select: { riderCode: true } },
      },
    });

    const table: ReportRow[] = rows.map((row) => ({
      reference: row.reference,
      cancelledAt: row.cancelledAt ? formatBucket(row.cancelledAt, 'datetime') : '—',
      customer: `${row.customer.user.firstName} ${row.customer.user.lastName}`.trim(),
      rider: row.rider?.riderCode ?? '—',
      reason: row.cancellationReason ?? 'No reason recorded',
      valueKobo: Number(row.chargeKobo),
    }));

    return {
      type: 'CANCELLATIONS',
      title: 'Cancellations',
      subtitle: `${total} cancellation${total === 1 ? '' : 's'} in the period. The value column is what the booking would have been worth.`,
      meta: [],
      columns: [
        { key: 'reference', label: 'Reference' },
        { key: 'cancelledAt', label: 'Cancelled' },
        { key: 'customer', label: 'Customer' },
        { key: 'rider', label: 'Rider' },
        { key: 'reason', label: 'Reason', weight: 2 },
        { key: 'valueKobo', label: 'Lost value', align: 'right', money: true },
      ],
      rows: table,
      totals: [
        { label: 'Cancellations', value: total },
        {
          label: 'Lost booking value',
          value: rows.reduce((sum, row) => sum + row.chargeKobo, 0n),
          money: true,
          emphasis: true,
        },
      ],
      ...(total > rows.length ? { truncated: { shown: rows.length, total } } : {}),
    };
  }

  /* ───────────────────── 7. rider performance ───────────────────── */

  private async riderPerformance(from: Date, to: Date): Promise<ReportTable> {
    const riders = await this.prisma.rider.findMany({
      where: { deletedAt: null },
      orderBy: { riderCode: 'asc' },
      select: {
        id: true,
        riderCode: true,
        ratingAvg: true,
        ratingCount: true,
        user: { select: { firstName: true, lastName: true } },
        deliveries: {
          where: { createdAt: { gte: from, lte: to } },
          select: { status: true, acceptedAt: true, deliveredAt: true },
        },
        assignments: {
          where: { offeredAt: { gte: from, lte: to } },
          select: { status: true },
        },
      },
    });

    const rows: ReportRow[] = [];
    for (const rider of riders) {
      const completed = rider.deliveries.filter((delivery) => delivery.status === 'DELIVERED');
      const cancelled = rider.deliveries.filter((delivery) => delivery.status === 'CANCELLED').length;
      const failed = rider.deliveries.filter((delivery) => delivery.status === 'FAILED').length;
      const offered = rider.assignments.length;
      const accepted = rider.assignments.filter((assignment) => assignment.status === 'ACCEPTED').length;

      // Average wall-clock time from acceptance to delivery, in minutes.
      const durations = completed
        .filter((delivery) => delivery.acceptedAt && delivery.deliveredAt)
        .map((delivery) => (delivery.deliveredAt!.getTime() - delivery.acceptedAt!.getTime()) / 60000);
      const avgMinutes = durations.length
        ? Math.round((durations.reduce((sum, value) => sum + value, 0) / durations.length) * 10) / 10
        : null;

      if (offered === 0 && rider.deliveries.length === 0) continue;

      rows.push({
        riderCode: rider.riderCode,
        rider: `${rider.user.firstName} ${rider.user.lastName}`.trim(),
        offered,
        accepted,
        acceptance: offered > 0 ? `${Math.round((accepted / offered) * 1000) / 10}%` : '—',
        completed: completed.length,
        cancelled,
        failed,
        completion:
          rider.deliveries.length > 0
            ? `${Math.round((completed.length / rider.deliveries.length) * 1000) / 10}%`
            : '—',
        avgMinutes: avgMinutes === null ? '—' : avgMinutes,
        rating: rider.ratingCount > 0 ? `${Math.round(rider.ratingAvg * 10) / 10} (${rider.ratingCount})` : '—',
      });
    }

    return {
      type: 'RIDER_PERFORMANCE',
      title: 'Rider performance',
      subtitle: 'Acceptance is offers accepted ÷ offers received. Average time is measured from acceptance to delivery, not from booking.',
      meta: [],
      columns: [
        { key: 'riderCode', label: 'Rider' },
        { key: 'rider', label: 'Name' },
        { key: 'offered', label: 'Offered', align: 'right' },
        { key: 'accepted', label: 'Accepted', align: 'right' },
        { key: 'acceptance', label: 'Acceptance', align: 'right' },
        { key: 'completed', label: 'Delivered', align: 'right' },
        { key: 'cancelled', label: 'Cancelled', align: 'right' },
        { key: 'failed', label: 'Failed', align: 'right' },
        { key: 'completion', label: 'Completion', align: 'right' },
        { key: 'avgMinutes', label: 'Avg min', align: 'right' },
        { key: 'rating', label: 'Rating', align: 'right' },
      ],
      rows,
      totals: [
        { label: 'Deliveries completed', value: rows.reduce((sum, row) => sum + Number(row.completed), 0) },
        { label: 'Offers accepted', value: rows.reduce((sum, row) => sum + Number(row.accepted), 0) },
      ],
    };
  }

  /* ───────────────────────── 8. zone performance ───────────────────────── */

  private async zonePerformance(from: Date, to: Date): Promise<ReportTable> {
    const zones = await this.prisma.serviceZone.findMany({
      orderBy: { code: 'asc' },
      select: {
        code: true,
        name: true,
        deliveries: {
          where: { createdAt: { gte: from, lte: to } },
          select: { status: true, chargeKobo: true, discountKobo: true, distanceKm: true },
        },
      },
    });

    const rows: ReportRow[] = [];
    let revenue = 0n;
    let delivered = 0;
    for (const zone of zones) {
      const completed = zone.deliveries.filter((delivery) => delivery.status === 'DELIVERED');
      const zoneRevenue = completed.reduce((sum, delivery) => sum + (delivery.chargeKobo - delivery.discountKobo), 0n);
      const distances = completed.map((delivery) => delivery.distanceKm ?? 0).filter((km) => km > 0);
      revenue += zoneRevenue;
      delivered += completed.length;
      if (zone.deliveries.length === 0) continue;

      rows.push({
        zone: `${zone.code} — ${zone.name}`,
        bookings: zone.deliveries.length,
        delivered: completed.length,
        cancelled: zone.deliveries.filter((delivery) => delivery.status === 'CANCELLED').length,
        revenueKobo: Number(zoneRevenue),
        avgKm: distances.length ? Math.round((distances.reduce((sum, km) => sum + km, 0) / distances.length) * 10) / 10 : '—',
        avgRevenueKobo: completed.length ? Math.round(Number(zoneRevenue) / completed.length) : 0,
      });
    }

    return {
      type: 'ZONE_PERFORMANCE',
      title: 'Zone performance',
      subtitle: `${delivered} delivered deliveries across ${rows.length} zone${rows.length === 1 ? '' : 's'}. Revenue is net of booking discounts.`,
      meta: [],
      columns: [
        { key: 'zone', label: 'Zone', weight: 2 },
        { key: 'bookings', label: 'Bookings', align: 'right' },
        { key: 'delivered', label: 'Delivered', align: 'right' },
        { key: 'cancelled', label: 'Cancelled', align: 'right' },
        { key: 'revenueKobo', label: 'Revenue', align: 'right', money: true },
        { key: 'avgRevenueKobo', label: 'Avg per delivery', align: 'right', money: true },
        { key: 'avgKm', label: 'Avg km', align: 'right' },
      ],
      rows,
      totals: [
        { label: 'Delivered', value: delivered },
        { label: 'Revenue', value: revenue, money: true, emphasis: true },
      ],
    };
  }

  /* ───────────────────── 9. financial summary ───────────────────── */

  /**
   * The one report that is a *statement* rather than a list.
   *
   * Every line is a ledger balance or a payment aggregate — the same sources the
   * finance screen reads — so the bottom line here and the net on
   * `GET /admin/finance/summary` are the same number by construction.
   */
  private async financialSummary(from: Date, to: Date): Promise<ReportTable> {
    const window = { gte: from, lte: to };

    const [payments, refunds, earnings, withdrawals, ledgerBalances] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { status: 'SUCCESS', createdAt: window },
        _sum: { amountKobo: true, feeKobo: true },
        _count: { _all: true },
      }),
      this.prisma.refund.aggregate({
        where: { status: 'COMPLETED', createdAt: window },
        _sum: { amountKobo: true },
        _count: { _all: true },
      }),
      this.prisma.riderEarning.aggregate({
        where: { createdAt: window },
        _sum: { grossKobo: true, commissionKobo: true, netKobo: true },
        _count: { _all: true },
      }),
      this.prisma.withdrawal.aggregate({
        where: { status: 'PAID', createdAt: window },
        _sum: { netAmountKobo: true },
        _count: { _all: true },
      }),
      this.prisma.ledgerAccount.findMany({
        where: {
          code: {
            in: [
              ACCOUNTS.DELIVERY_REVENUE,
              ACCOUNTS.SURCHARGE_REVENUE,
              ACCOUNTS.REFUNDS,
              ACCOUNTS.GATEWAY_FEES,
              ACCOUNTS.RIDER_COMMISSION_COST,
              ACCOUNTS.CUSTOMER_WALLET_LIABILITY,
              ACCOUNTS.RIDER_EARNINGS_PAYABLE,
              ACCOUNTS.WITHDRAWALS_PAYABLE,
            ],
          },
        },
        select: {
          code: true,
          name: true,
          type: true,
          // Only postings dated inside the requested window — a report for September
          // must not carry a balance from last year.
          lines: { where: { journalEntry: { postedAt: window } }, select: { debitKobo: true, creditKobo: true } },
        },
      }),
    ]);

    /** Debits − credits for an asset/expense account; credits − debits for the rest. */
    const balanceOf = (code: string): bigint => {
      const account = ledgerBalances.find((row) => row.code === code);
      if (!account) return 0n;
      const debit = account.lines.reduce((sum, line) => sum + line.debitKobo, 0n);
      const credit = account.lines.reduce((sum, line) => sum + line.creditKobo, 0n);
      const liabilityOrRevenue = account.type === 'LIABILITY' || account.type === 'EQUITY' || account.type === 'REVENUE';
      return liabilityOrRevenue ? credit - debit : debit - credit;
    };

    const deliveryRevenue = balanceOf(ACCOUNTS.DELIVERY_REVENUE);
    const surchargeRevenue = balanceOf(ACCOUNTS.SURCHARGE_REVENUE);
    const refundsFromLedger = balanceOf(ACCOUNTS.REFUNDS);
    const gatewayFees = balanceOf(ACCOUNTS.GATEWAY_FEES);
    const riderCost = balanceOf(ACCOUNTS.RIDER_COMMISSION_COST);
    const net = deliveryRevenue + surchargeRevenue - refundsFromLedger - riderCost - gatewayFees;

    const collected = payments._sum.amountKobo ?? 0n;
    const collectedFees = payments._sum.feeKobo ?? 0n;
    const refunded = refunds._sum.amountKobo ?? 0n;
    const riderNet = earnings._sum.netKobo ?? 0n;
    const commission = earnings._sum.commissionKobo ?? 0n;
    const paidOut = withdrawals._sum.netAmountKobo ?? 0n;

    const line = (label: string, value: bigint, note: string): ReportRow => ({
      line: label,
      valueKobo: Number(value),
      note,
    });

    return {
      type: 'FINANCIAL_SUMMARY',
      title: 'Financial summary',
      subtitle:
        'Revenue and costs are ledger postings inside the period; collected and refunded are payment aggregates. The net line is the same figure the finance screen shows for the same dates.',
      meta: [],
      columns: [
        { key: 'line', label: 'Line', weight: 2 },
        { key: 'valueKobo', label: 'Amount', align: 'right', money: true },
        { key: 'note', label: 'Where it comes from', weight: 3 },
      ],
      rows: [
        line('Collected from customers', collected, `${payments._count._all} settled payment(s), any provider`),
        line('Delivery revenue', deliveryRevenue, 'Ledger 4000 — recognised when a delivery is paid'),
        line('Surcharges', surchargeRevenue, 'Ledger 4100 — express, scheduled, extra stops'),
        line('Refunds issued', refunded, `${refunds._count._all} completed refund(s) — ledger 5300`),
        line('Rider cost', riderCost, 'Ledger 5000 — commission owed to riders on delivered jobs'),
        line('Gateway fees', gatewayFees, `Ledger 5100 — ${collectedFees.toString()} kobo charged by providers`),
        line('Rider earnings accrued', riderNet, `${earnings._count._all} earning row(s); commission ${commission.toString()} kobo`),
        line('Rider withdrawals paid', paidOut, `${withdrawals._count._all} payout(s) — ledger 2200`),
        line('Customer wallet liability', balanceOf(ACCOUNTS.CUSTOMER_WALLET_LIABILITY), 'Ledger 2000 — money held on behalf of customers'),
        line('Rider earnings payable', balanceOf(ACCOUNTS.RIDER_EARNINGS_PAYABLE), 'Ledger 2100 — cleared but not yet withdrawn'),
        line('Withdrawals payable', balanceOf(ACCOUNTS.WITHDRAWALS_PAYABLE), 'Ledger 2200 — approved, not yet paid'),
      ],
      // Gross and net are separate lines on purpose: "we invoiced ₦X" and "we kept
      // ₦Y" are different questions, and a single blended number answers neither.
      totals: [
        { label: 'Collected', value: collected, money: true },
        { label: 'Gross revenue', value: deliveryRevenue + surchargeRevenue, money: true },
        { label: 'Refunds', value: refundsFromLedger, money: true },
        { label: 'Net revenue', value: deliveryRevenue + surchargeRevenue - refundsFromLedger, money: true },
        { label: 'Rider cost', value: riderCost, money: true },
        { label: 'Gateway fees', value: gatewayFees, money: true },
        { label: 'Net', value: net, money: true, emphasis: true },
      ],
    };
  }
}

/* ───────────────────────────── helpers ───────────────────────────── */

function formatBucket(value: Date, unit: 'day' | 'month' | 'datetime'): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  if (unit === 'month') return date.toISOString().slice(0, 7);
  if (unit === 'datetime') {
    // Lagos is UTC+1 year-round — no daylight saving to get wrong.
    return new Date(date.getTime() + 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ');
  }
  return new Date(date.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

export type { ReportColumn, ReportTotal };
