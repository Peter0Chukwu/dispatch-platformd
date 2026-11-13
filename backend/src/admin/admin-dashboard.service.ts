import { Injectable } from "@nestjs/common";
import { PrismaService } from "../infra/prisma/prisma.service";
import { formatNaira } from "@dispatch/shared";
import { LOCATION_FRESHNESS_MINUTES } from "../dispatch/dispatch.service";
import { AppConfig } from "../config/app.config";

/**
 * ADMIN DASHBOARD
 *
 * Every figure on this screen is computed by PostgreSQL at request time. There
 * are no cached counters, no seeded "demo" numbers and no placeholders: if the
 * database is empty the dashboard reads zero, which is the honest answer.
 *
 * Money is summed as BigInt kobo and formatted once, at the edge. Percentages are
 * derived from the same counts the table shows, so the two can never disagree.
 */
@Injectable()
export class AdminDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  /** `from`/`to` are inclusive dates; the default window is the last 30 days. */
  async overview(range: { from?: Date; to?: Date }) {
    const to = range.to ?? new Date();
    const from =
      range.from ?? new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    const window = { gte: from, lte: to };

    const [
      statusCounts,
      revenue,
      riderCounts,
      customerCounts,
      pendingDocuments,
      pendingApplications,
      onlineWithoutPing,
      awaitingHuman,
      zoneRows,
      dailyRows,
      waiting,
      recent,
      earningsTotals,
      openAlerts,
    ] = await Promise.all([
      this.prisma.delivery.groupBy({
        by: ["status"],
        where: { createdAt: window },
        _count: { _all: true },
      }),
      this.prisma.delivery.aggregate({
        where: { createdAt: window, status: "DELIVERED" },
        _sum: { chargeKobo: true, discountKobo: true },
        _avg: { distanceKm: true },
      }),
      this.prisma.rider.groupBy({
        by: ["availability"],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.customer.count({ where: { deletedAt: null } }),
      this.prisma.riderDocument.count({ where: { status: "PENDING" } }),
      // How many people are waiting on the desk to let them work at all.
      this.prisma.rider.count({
        where: { approvalStatus: "PENDING", deletedAt: null },
      }),
      // Online, approved riders the engine cannot use because their phone has not
      // reported a position recently. Without this number "nobody accepted" and
      // "nobody was reachable" look identical, and the desk guesses.
      this.prisma.rider.count({
        where: {
          approvalStatus: "APPROVED",
          availability: "ONLINE",
          deletedAt: null,
          user: { status: "ACTIVE" },
          locations: {
            none: {
              recordedAt: {
                gte: new Date(Date.now() - LOCATION_FRESHNESS_MINUTES * 60 * 1000),
              },
            },
          },
        },
      }),
      // Jobs the automatic search has given up on: a human must decide now.
      this.prisma.delivery.count({
        where: {
          status: "PENDING",
          riderId: null,
          dispatchRound: { gte: this.config.dispatchMaxRounds },
        },
      }),
      this.prisma.delivery.groupBy({
        by: ["serviceZoneId"],
        where: { createdAt: window, status: "DELIVERED" },
        _count: { _all: true },
        _sum: { chargeKobo: true },
      }),
      // Date series for the chart. Raw SQL because Prisma cannot group by a date_trunc.
      this.prisma.$queryRaw<
        Array<{
          day: Date;
          deliveries: bigint;
          delivered: bigint;
          revenue_kobo: bigint | null;
        }>
      >`
        SELECT date_trunc('day', "createdAt") AS day,
               COUNT(*)                        AS deliveries,
               COUNT(*) FILTER (WHERE status = 'DELIVERED') AS delivered,
               SUM("chargeKobo") FILTER (WHERE status = 'DELIVERED') AS revenue_kobo
          FROM deliveries
         WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
         GROUP BY 1
         ORDER BY 1 ASC`,
      this.prisma.delivery.count({
        where: { status: "PENDING", riderId: null },
      }),
      this.prisma.delivery.findMany({
        where: { createdAt: window },
        orderBy: { createdAt: "desc" },
        take: 6,
        select: {
          id: true,
          reference: true,
          status: true,
          chargeKobo: true,
          createdAt: true,
          pickupAddress: true,
          destAddress: true,
          customer: {
            select: { user: { select: { firstName: true, lastName: true } } },
          },
          rider: { select: { riderCode: true } },
        },
      }),
      this.prisma.riderEarning.aggregate({
        where: { createdAt: window },
        _sum: { grossKobo: true, commissionKobo: true, netKobo: true },
        _count: { _all: true },
      }),
      this.prisma.adminAlert
        .count({ where: { acknowledgedAt: null } })
        .catch(() => 0),
    ]);

    const countFor = (status: string) =>
      statusCounts
        .filter((row) => row.status === status)
        .reduce((total, row) => total + row._count._all, 0);

    const total = statusCounts.reduce((sum, row) => sum + row._count._all, 0);
    const delivered = countFor("DELIVERED");
    const failed = countFor("FAILED");
    const cancelled = countFor("CANCELLED");
    const active = statusCounts
      .filter((row) =>
        [
          "ASSIGNED",
          "ACCEPTED",
          "ARRIVED_AT_PICKUP",
          "PICKED_UP",
          "IN_TRANSIT",
          "ARRIVED_AT_DESTINATION",
        ].includes(row.status),
      )
      .reduce((sum, row) => sum + row._count._all, 0);

    const grossKobo = revenue._sum.chargeKobo ?? 0n;
    const discountKobo = revenue._sum.discountKobo ?? 0n;
    const commissionKobo = earningsTotals._sum.commissionKobo ?? 0n;
    const riderNetKobo = earningsTotals._sum.netKobo ?? 0n;

    // Average time from booking to delivery, over deliveries that actually finished.
    const finished = await this.prisma.delivery.findMany({
      where: {
        createdAt: window,
        status: "DELIVERED",
        deliveredAt: { not: null },
      },
      select: { createdAt: true, deliveredAt: true },
    });
    const avgMinutes =
      finished.length > 0
        ? Math.round(
            finished.reduce(
              (sum, row) =>
                sum + (row.deliveredAt!.getTime() - row.createdAt.getTime()),
              0,
            ) /
              finished.length /
              60000,
          )
        : null;

    const zoneNames = await this.prisma.serviceZone.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    });
    const nameOf = new Map(zoneNames.map((zone) => [zone.id, zone.name]));
    const counted = new Map(
      zoneRows.map((row) => [
        row.serviceZoneId ?? "none",
        { delivered: row._count._all, revenue: row._sum.chargeKobo ?? 0n },
      ]),
    );
    // Every live zone is listed, zero or not: the operator wants to see coverage,
    // not just the zones that happened to be busy.
    const zones = [
      ...zoneNames.map((zone) => ({ key: zone.id, zone: zone.name })),
      ...(counted.has("none") ? [{ key: "none", zone: "Outside a zone" }] : []),
    ]
      .map((entry) => {
        const stats = counted.get(entry.key);
        return {
          zone: entry.zone,
          delivered: stats?.delivered ?? 0,
          revenueKobo: (stats?.revenue ?? 0n).toString(),
          revenueFormatted: formatNaira(stats?.revenue ?? 0n),
        };
      })
      .sort(
        (a, b) => b.delivered - a.delivered || a.zone.localeCompare(b.zone),
      );

    const availability = (state: string) =>
      riderCounts
        .filter((row) => row.availability === state)
        .reduce((t, row) => t + row._count._all, 0);

    return {
      range: { from, to },
      deliveries: {
        total,
        delivered,
        failed,
        cancelled,
        active,
        awaitingAssignment: waiting,
        // Past every dispatch round: the engine has stopped and is waiting for staff.
        awaitingHuman,
        // Undefined (null) when nothing has reached a terminal state yet — 0% would
        // wrongly imply every order failed.
        successRate:
          delivered + cancelled + failed > 0
            ? Math.round((delivered / (delivered + cancelled + failed)) * 100)
            : null,
        avgDeliveryMinutes: avgMinutes,
        byStatus: Object.fromEntries(
          statusCounts.map((row) => [row.status, row._count._all]),
        ),
      },
      money: {
        // Gross is what customers were charged; net is what is left after rider commission.
        grossKobo: grossKobo.toString(),
        grossFormatted: formatNaira(grossKobo),
        discountKobo: discountKobo.toString(),
        commissionKobo: commissionKobo.toString(),
        commissionFormatted: formatNaira(commissionKobo),
        riderNetKobo: riderNetKobo.toString(),
        riderNetFormatted: formatNaira(riderNetKobo),
        averageOrderFormatted: formatNaira(
          delivered > 0 ? grossKobo / BigInt(delivered) : 0n,
        ),
        earningRows: earningsTotals._count._all,
        // What the business keeps: commission plus any charges not paid out to riders.
        marginKobo: (grossKobo - riderNetKobo).toString(),
        marginFormatted: formatNaira(grossKobo - riderNetKobo),
      },
      riders: {
        total: riderCounts.reduce((sum, row) => sum + row._count._all, 0),
        online: availability("ONLINE"),
        onDelivery: availability("ON_DELIVERY"),
        offline: availability("OFFLINE"),
        pendingDocuments,
        // The approval queue: riders who signed up and are waiting on a human.
        pendingApplications,
        // Online but unlocatable — the reason dispatch can stall while the roster looks busy.
        onlineWithoutPing,
      },
      customers: { total: customerCounts },
      fleet: {
        avgDistanceKm: revenue._avg.distanceKm
          ? Number(revenue._avg.distanceKm.toFixed(2))
          : null,
        openAlerts,
      },
      zones,
      daily: dailyRows.map((row) => ({
        date: row.day.toISOString().slice(0, 10),
        deliveries: Number(row.deliveries),
        delivered: Number(row.delivered),
        revenueKobo: (row.revenue_kobo ?? 0n).toString(),
      })),
      recent: recent.map((row) => ({
        id: row.id,
        reference: row.reference,
        status: row.status,
        chargeKobo: row.chargeKobo.toString(),
        chargeFormatted: formatNaira(row.chargeKobo),
        customer: `${row.customer.user.firstName} ${row.customer.user.lastName}`,
        riderCode: row.rider?.riderCode ?? null,
        pickup: row.pickupAddress,
        destination: row.destAddress,
        createdAt: row.createdAt,
      })),
    };
  }
}
