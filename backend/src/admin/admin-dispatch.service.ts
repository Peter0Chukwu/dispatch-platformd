import { Injectable, Logger } from "@nestjs/common";
import { formatNaira } from "@dispatch/shared";
import { PrismaService } from "../infra/prisma/prisma.service";
import { AppConfig } from "../config/app.config";
import { AppError } from "../common/errors/app-error";
import { DispatchService } from "../dispatch/dispatch.service";

/** Radius schedule as the desk should read it (last step is the whole branch). */
const RADIUS_LABEL = (radiusKm: number) => (Number.isFinite(radiusKm) ? `${radiusKm} km` : "the whole branch");

/**
 * THE DISPATCH BOARD
 * ─────────────────────────────────────────────────────────────────────────────
 * The engine is supposed to place every job on its own. This screen is what the
 * desk watches while it does, and what they use when it cannot: every booking
 * still waiting for a rider, how far the search has widened, who has been asked,
 * and a button that runs the next round immediately instead of waiting for the
 * 20-second batch to expire.
 *
 * Nothing here invents data. The round counter and the offers are read from the
 * same tables the engine writes, so the board can never disagree with reality.
 */
@Injectable()
export class AdminDispatchService {
  private readonly logger = new Logger("AdminDispatchBoard");

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly dispatch: DispatchService,
  ) {}

  /** Every delivery the engine is currently working, plus the floor's capacity. */
  async board() {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const now = new Date();

    const [waiting, onlineRiders, exhaustedToday, justAssigned, activeOffers] = await Promise.all([
      this.prisma.delivery.findMany({
        where: { status: "PENDING", riderId: null, createdAt: { gte: since } },
        orderBy: { createdAt: "asc" },
        take: 50,
        select: {
          id: true,
          reference: true,
          createdAt: true,
          deliveryType: true,
          chargeKobo: true,
          distanceKm: true,
          pickupAddress: true,
          destAddress: true,
          pickupLat: true,
          pickupLng: true,
          dispatchRound: true,
          lastRoundAt: true,
          serviceZone: { select: { name: true } },
          customer: { select: { user: { select: { firstName: true, lastName: true, phone: true } } } },
          assignments: {
            orderBy: { offeredAt: "desc" },
            take: 12,
            select: {
              id: true,
              status: true,
              method: true,
              rank: true,
              offeredAt: true,
              expiresAt: true,
              respondedAt: true,
              rejectionReason: true,
              rider: { select: { riderCode: true, user: { select: { firstName: true, lastName: true } } } },
            },
          },
        },
      }),
      this.prisma.rider.count({
        where: { approvalStatus: "APPROVED", availability: "ONLINE", user: { status: "ACTIVE" } },
      }),
      this.prisma.adminAlert.count({
        where: { type: "DISPATCH_EXHAUSTED", createdAt: { gte: since } },
      }),
      this.prisma.delivery.findMany({
        where: { createdAt: { gte: since }, riderId: { not: null } },
        orderBy: { updatedAt: "desc" },
        take: 10,
        select: {
          id: true,
          reference: true,
          status: true,
          updatedAt: true,
          rider: { select: { riderCode: true, user: { select: { firstName: true, lastName: true } } } },
        },
      }),
      this.prisma.deliveryAssignment.count({ where: { status: "OFFERED", expiresAt: { gt: now } } }),
    ]);

    return {
      summary: {
        waiting: waiting.length,
        offersOut: activeOffers,
        onlineRiders,
        exhaustedToday,
        batchSize: this.config.offerBatchSize,
        offerTimeoutSeconds: this.config.offerTimeoutSeconds,
        maxRounds: this.config.dispatchMaxRounds,
      },
      waiting: waiting.map((delivery) => {
        const round = delivery.dispatchRound + 1;
        const radiusKm = this.dispatch.radiusForRound(round);
        const liveOffers = delivery.assignments.filter(
          (row) => row.status === "OFFERED" && row.expiresAt > now,
        );
        const askedRiders = new Set(delivery.assignments.map((row) => row.rider.riderCode));

        return {
          id: delivery.id,
          reference: delivery.reference,
          createdAt: delivery.createdAt,
          waitingMinutes: Math.max(0, Math.round((now.getTime() - delivery.createdAt.getTime()) / 60000)),
          deliveryType: delivery.deliveryType,
          chargeFormatted: formatNaira(delivery.chargeKobo),
          distanceKm: delivery.distanceKm,
          pickup: { address: delivery.pickupAddress, lat: delivery.pickupLat, lng: delivery.pickupLng },
          destination: { address: delivery.destAddress },
          zone: delivery.serviceZone?.name ?? null,
          customer: delivery.customer
            ? {
                name: `${delivery.customer.user.firstName} ${delivery.customer.user.lastName}`,
                phone: delivery.customer.user.phone,
              }
            : null,
          dispatch: {
            round,
            radiusLabel: RADIUS_LABEL(radiusKm),
            maxRounds: this.config.dispatchMaxRounds,
            lastRoundAt: delivery.lastRoundAt,
            exhausted: round > this.config.dispatchMaxRounds,
            offersOut: liveOffers.length,
            liveOffers: liveOffers.map((row) => ({
              assignmentId: row.id,
              rider: `${row.rider.user.firstName} ${row.rider.user.lastName}`,
              riderCode: row.rider.riderCode,
              rank: row.rank,
              expiresAt: row.expiresAt,
              secondsLeft: Math.max(0, Math.round((row.expiresAt.getTime() - now.getTime()) / 1000)),
            })),
            askedCount: askedRiders.size,
            history: delivery.assignments.map((row) => ({
              id: row.id,
              rider: `${row.rider.user.firstName} ${row.rider.user.lastName}`,
              riderCode: row.rider.riderCode,
              status: row.status,
              method: row.method,
              rank: row.rank,
              offeredAt: row.offeredAt,
              expiresAt: row.expiresAt,
              respondedAt: row.respondedAt,
              rejectionReason: row.rejectionReason,
            })),
          },
        };
      }),
      justAssigned: justAssigned.map((delivery) => ({
        id: delivery.id,
        reference: delivery.reference,
        status: delivery.status,
        at: delivery.updatedAt,
        rider: delivery.rider
          ? {
              code: delivery.rider.riderCode,
              name: `${delivery.rider.user.firstName} ${delivery.rider.user.lastName}`,
            }
          : null,
      })),
    };
  }

  /**
   * Run the next round now.
   *
   * The desk uses this when a delivery is sitting there and the clock is the only
   * thing between it and a rider. It is the same engine method the scheduler
   * calls — refusing to duplicate it is the whole point: one placement path.
   */
  async runNow(deliveryId: string) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: { id: true, reference: true, status: true, riderId: true, dispatchRound: true },
    });
    if (!delivery) throw AppError.notFound("Delivery not found");

    if (delivery.status !== "PENDING" || delivery.riderId) {
      throw AppError.conflict(
        "This delivery is no longer waiting for a rider. Reassign it from the delivery screen instead.",
      );
    }

    const round = delivery.dispatchRound + 1;
    if (round > this.config.dispatchMaxRounds) {
      throw AppError.conflict(
        "The automatic search is exhausted for this delivery. Assign a rider by hand from the delivery screen.",
      );
    }

    const live = await this.prisma.deliveryAssignment.count({
      where: { deliveryId, status: "OFFERED", expiresAt: { gt: new Date() } },
    });
    if (live > 0) {
      throw AppError.conflict(
        `${live} rider(s) are still deciding on this delivery. Wait for the offer to expire or be answered.`,
      );
    }

    const sent = await this.dispatch.offerDelivery(deliveryId);
    this.logger.log(`Desk ran round ${round} for ${delivery.reference}: ${sent} offer(s)`);
    return { reference: delivery.reference, round, offered: sent };
  }
}
