import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { formatNaira, percentOfKobo } from '@dispatch/shared';
import { PrismaService } from '../infra/prisma/prisma.service';
import { RedisService } from '../infra/redis/redis.service';
import { AppConfig } from '../config/app.config';
import { AppError } from '../common/errors/app-error';
import { haversineKm } from '../pricing/distance';

/** How many riders receive an offer at once. First to accept wins. */
const OFFER_BATCH_SIZE = 3;

/** Ignore riders whose last location is older than this when ranking candidates. */
const LOCATION_FRESHNESS_MINUTES = 10;

/**
 * THE OFFER ENGINE
 * ─────────────────────────────────────────────────────────────────────────────
 * When a customer books, the delivery must reach a nearby rider within seconds,
 * and exactly one rider must end up with it — even if three phones buzz at once
 * and the rider taps "Accept" twice.
 *
 * How that is guaranteed:
 *
 *   1. Offers are rows (`delivery_assignments`) with status OFFERED and an expiry.
 *   2. Accepting is a single conditional UPDATE:
 *        UPDATE delivery_assignments SET status='ACCEPTED'
 *         WHERE id=? AND riderId=? AND status='OFFERED' AND expiresAt > now
 *      Postgres serialises concurrent updates on the same row, so exactly one
 *      statement can report 1 row affected. Everyone else reports 0 → 409.
 *   3. The delivery itself is claimed the same way (status PENDING → ASSIGNED),
 *      so even a crafted request against a stale offer cannot steal a job.
 *   4. A Redis lock (SET NX PX) short-circuits the common double-tap so the
 *      database never sees the second request at all.
 *
 * The database is the source of truth. Redis only makes the fast path faster.
 */
@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: AppConfig,
  ) {}

  get offerTimeoutSeconds(): number {
    return this.config.offerTimeoutSeconds;
  }

  /** Expire offers nobody answered. Cheap, idempotent, called before every read/write. */
  async sweepExpired(): Promise<number> {
    const result = await this.prisma.deliveryAssignment.updateMany({
      where: { status: 'OFFERED', expiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED', respondedAt: new Date() },
    });
    if (result.count > 0) this.logger.log(`Expired ${result.count} unanswered offer(s)`);
    return result.count;
  }

  /**
   * Offer a pending delivery to the best available riders.
   * Returns how many offers were created (0 means nobody is available right now).
   */
  /**
   * Re-offers deliveries that are still waiting for a rider.
   *
   * A paid booking must never rot because every rider happened to be offline when
   * it was placed. Called when a rider comes online, and safe to call from a cron:
   * `offerDelivery` is idempotent per delivery and skips anyone holding a live offer.
   */
  async offerWaitingDeliveries(limit = 25): Promise<{ scanned: number; offered: number }> {
    const waiting = await this.prisma.delivery.findMany({
      where: {
        status: 'PENDING',
        riderId: null,
        // Do not resurrect ancient bookings the customer has almost certainly given up on.
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    });

    let offered = 0;
    for (const delivery of waiting) {
      try {
        offered += await this.offerDelivery(delivery.id);
      } catch (error) {
        // One bad row must not stop the rest of the queue.
        this.logger.error(`Could not offer waiting delivery ${delivery.id}: ${(error as Error).message}`);
      }
    }

    if (offered > 0) {
      this.logger.log(`Waiting-delivery sweep: ${waiting.length} scanned, ${offered} offer(s) sent`);
    }
    return { scanned: waiting.length, offered };
  }

  async offerDelivery(deliveryId: string): Promise<number> {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: {
        id: true,
        status: true,
        branchId: true,
        pickupLat: true,
        pickupLng: true,
        chargeKobo: true,
        deliveryType: true,
      },
    });
    if (!delivery) throw AppError.notFound('Delivery');
    if (delivery.status !== 'PENDING') return 0;

    // Who must NOT be offered this job:
    //  · riders holding a live offer right now (double-offering would be noise)
    //  · riders who said no — respecting a rejection is the whole point of the button
    //  · riders who already accepted it
    // An offer that merely EXPIRED does not exclude anyone: the rider may have been
    // offline or driving, and this delivery still needs a home.
    const blocking = await this.prisma.deliveryAssignment.findMany({
      where: {
        deliveryId,
        OR: [{ status: 'REJECTED' }, { status: 'ACCEPTED' }, { status: 'OFFERED', expiresAt: { gt: new Date() } }],
      },
      select: { riderId: true },
    });
    const excludeRiderIds = [...new Set(blocking.map((row) => row.riderId))];

    const candidates = await this.findCandidates(delivery, excludeRiderIds);
    if (candidates.length === 0) {
      this.logger.log(`Delivery ${deliveryId} has no available rider right now`);
      return 0;
    }

    const expiresAt = new Date(Date.now() + this.offerTimeoutSeconds * 1000);
    const chosen = candidates.slice(0, OFFER_BATCH_SIZE);

    await this.prisma.deliveryAssignment.createMany({
      data: chosen.map((candidate, index) => ({
        deliveryId,
        riderId: candidate.riderId,
        status: 'OFFERED',
        method: 'AUTO',
        rank: index + 1,
        scoreBreakdown: { distanceToPickupKm: candidate.distanceKm, lastPingAgeMinutes: candidate.pingAgeMinutes },
        expiresAt,
      })),
      skipDuplicates: true,
    });

    this.logger.log(
      `Offered ${deliveryId.slice(0, 8)} (${formatNaira(delivery.chargeKobo)}) to ${chosen.length} rider(s), ${this.offerTimeoutSeconds}s to respond`,
    );
    return chosen.length;
  }

  /** Rank riders by how quickly they could reach the pickup. */
  private async findCandidates(
    delivery: { branchId: string; pickupLat: number; pickupLng: number },
    excludeRiderIds: string[],
  ) {
    const maxActive = this.config.maxActivePerRider;

    const riders = await this.prisma.rider.findMany({
      where: {
        branchId: delivery.branchId,
        approvalStatus: 'APPROVED',
        availability: 'ONLINE',
        user: { status: 'ACTIVE' },
        ...(excludeRiderIds.length > 0 ? { id: { notIn: excludeRiderIds } } : {}),
      },
      select: {
        id: true,
        serviceZone: { select: { centerLat: true, centerLng: true } },
        locations: { orderBy: { recordedAt: 'desc' }, take: 1, select: { lat: true, lng: true, recordedAt: true } },
        _count: { select: { deliveries: { where: { status: { in: ['ASSIGNED', 'ACCEPTED', 'ARRIVED_AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION'] } } } } },
      },
    });

    const pickup = { lat: delivery.pickupLat, lng: delivery.pickupLng };
    const freshnessMs = LOCATION_FRESHNESS_MINUTES * 60 * 1000;

    return riders
      .filter((rider) => rider._count.deliveries < maxActive)
      .map((rider) => {
        // Prefer the live ping. A rider with no recent ping is ranked from their
        // zone centre AND pushed down the list — we do not pretend they are close.
        const latest = rider.locations[0];
        const hasFreshPing = latest && Date.now() - latest.recordedAt.getTime() < freshnessMs;
        const from = hasFreshPing
          ? { lat: latest.lat, lng: latest.lng }
          : rider.serviceZone
            ? { lat: rider.serviceZone.centerLat, lng: rider.serviceZone.centerLng }
            : null;
        const distanceKm = from ? haversineKm(from, pickup) : 999;
        return {
          riderId: rider.id,
          distanceKm: Math.round(distanceKm * 100) / 100,
          pingAgeMinutes: latest ? Math.round((Date.now() - latest.recordedAt.getTime()) / 60000) : null,
          rankPenalty: hasFreshPing ? 0 : 25,
        };
      })
      .sort((a, b) => a.distanceKm + a.rankPenalty - (b.distanceKm + b.rankPenalty));
  }

  /** The rider's live offer list, with the money they would actually earn. */
  async offersForRider(riderId: string) {
    await this.sweepExpired();

    const assignments = await this.prisma.deliveryAssignment.findMany({
      where: { riderId, status: 'OFFERED', expiresAt: { gt: new Date() } },
      orderBy: { offeredAt: 'asc' },
      include: {
        delivery: {
          select: {
            id: true,
            reference: true,
            deliveryType: true,
            chargeKobo: true,
            distanceKm: true,
            durationMinutes: true,
            pickupAddress: true,
            pickupLandmark: true,
            pickupLat: true,
            pickupLng: true,
            destAddress: true,
            destLandmark: true,
            packageCategory: true,
            packageDescription: true,
            isFragile: true,
            recipientName: true,
            commissionSnapshot: true,
            serviceZone: { select: { name: true } },
          },
        },
      },
    });

    const commissionPct = this.config.commissionPercent;
    return assignments.map((assignment) => {
      const delivery = assignment.delivery;
      const commissionKobo = percentOfKobo(delivery.chargeKobo, commissionPct, 50);
      return {
        assignmentId: assignment.id,
        offeredAt: assignment.offeredAt,
        expiresAt: assignment.expiresAt,
        secondsLeft: Math.max(0, Math.round((assignment.expiresAt.getTime() - Date.now()) / 1000)),
        offerTimeoutSeconds: this.offerTimeoutSeconds,
        distanceToPickupKm: (assignment.scoreBreakdown as { distanceToPickupKm?: number } | null)?.distanceToPickupKm ?? null,
        delivery: {
          id: delivery.id,
          reference: delivery.reference,
          deliveryType: delivery.deliveryType,
          zone: delivery.serviceZone?.name ?? null,
          pickup: { address: delivery.pickupAddress, landmark: delivery.pickupLandmark, lat: delivery.pickupLat, lng: delivery.pickupLng },
          destination: { address: delivery.destAddress, landmark: delivery.destLandmark },
          distanceKm: delivery.distanceKm,
          durationMinutes: delivery.durationMinutes,
          package: { category: delivery.packageCategory, description: delivery.packageDescription, isFragile: delivery.isFragile },
          recipientName: delivery.recipientName,
        },
        pay: {
          chargeKobo: delivery.chargeKobo.toString(),
          commissionPct,
          commissionKobo: commissionKobo.toString(),
          /** What the rider takes home. */
          netKobo: (delivery.chargeKobo - commissionKobo).toString(),
          netFormatted: formatNaira(delivery.chargeKobo - commissionKobo),
        },
      };
    });
  }

  /**
   * Accept an offer. Exactly one rider can win, no matter how many tap at once.
   */
  async accept(riderId: string, assignmentId: string) {
    const lockKey = `dispatch:accept:${assignmentId}`;
    const lockToken = randomUUID();
    // 5 s is longer than any single acceptance can take; the token prevents a slow
    // request from releasing a lock that a later request now owns.
    const locked = await this.redis.client.set(lockKey, lockToken, 'PX', 5000, 'NX');
    if (locked !== 'OK') {
      throw AppError.conflict('This delivery is being accepted by someone else right now.', 'OFFER_TAKEN');
    }

    try {
      await this.sweepExpired();

      const result = await this.prisma.$transaction(async (tx) => {
        // 1. Claim the offer atomically.
        const claim = await tx.deliveryAssignment.updateMany({
          where: { id: assignmentId, riderId, status: 'OFFERED', expiresAt: { gt: new Date() } },
          data: { status: 'ACCEPTED', respondedAt: new Date() },
        });
        if (claim.count === 0) return { ok: false as const, reason: 'offer-gone' as const };

        const assignment = await tx.deliveryAssignment.findUniqueOrThrow({
          where: { id: assignmentId },
          include: { delivery: { select: { id: true, status: true, chargeKobo: true, reference: true } } },
        });

        // 2. Claim the delivery itself. If another rider already did, roll back.
        const deliveryClaim = await tx.delivery.updateMany({
          where: { id: assignment.deliveryId, status: 'PENDING' },
          data: {
            // The rider has explicitly accepted, so the delivery moves straight to
            // ACCEPTED. (ASSIGNED is for staff assignments the rider must confirm.)
            status: 'ACCEPTED',
            riderId,
            acceptedAt: new Date(),
          },
        });
        if (deliveryClaim.count === 0) {
          // Someone else has it, or it was cancelled: undo the offer claim and stop.
          throw new AssignmentLostError();
        }

        // NOTE: other riders' offers are expired AFTER this transaction commits.
        // Expiring them inside it would mean two simultaneous accepts each lock the
        // other's assignment row — a classic ABBA deadlock that Postgres resolves by
        // killing one request with a 500. Now every acceptance locks only its own row
        // and then the delivery, so the loser simply waits and gets a clean 409.

        // 4. Freeze the commission split onto the delivery so it can never drift.
        const commissionPct = this.config.commissionPercent;
        const commissionKobo = percentOfKobo(assignment.delivery.chargeKobo, commissionPct, 50);
        await tx.delivery.update({
          where: { id: assignment.deliveryId },
          data: {
            commissionSnapshot: {
              commissionPct,
              commissionKobo: commissionKobo.toString(),
              riderNetKobo: (assignment.delivery.chargeKobo - commissionKobo).toString(),
              computedAt: new Date().toISOString(),
            },
          },
        });

        // 5. The rider is now busy — they must stop receiving new offers.
        await tx.rider.update({ where: { id: riderId }, data: { availability: 'ON_DELIVERY' } });

        // 6. History.
        await tx.deliveryStatusHistory.create({
          data: {
            deliveryId: assignment.deliveryId,
            fromStatus: 'PENDING',
            toStatus: 'ACCEPTED',
            actorType: 'RIDER',
            reason: 'Offer accepted by rider',
          },
        });

        return { ok: true as const, deliveryId: assignment.deliveryId };
      });

      if (!result.ok) {
        throw AppError.conflict(
          'That offer has expired or was already taken. New jobs will appear here.',
          'OFFER_EXPIRED',
        );
      }

      // Winner announced: kill the other offers for this delivery, outside the
      // transaction, in a single statement on rows we no longer compete for.
      await this.prisma.deliveryAssignment.updateMany({
        where: { deliveryId: result.deliveryId, status: 'OFFERED' },
        data: { status: 'EXPIRED', respondedAt: new Date() },
      });

      this.logger.log(`Rider ${riderId} accepted delivery ${result.deliveryId}`);
      return { accepted: true, deliveryId: result.deliveryId };
    } catch (error) {
      // Duck-typed on purpose: `instanceof` is unreliable when a bundled build can
      // load this module twice (the same trap that once turned Zod errors into 500s).
      if ((error as { isAssignmentLost?: boolean })?.isAssignmentLost) {
        throw AppError.conflict(
          'Another rider is already on this delivery. It has been removed from your list.',
          'DELIVERY_TAKEN',
        );
      }
      if (error instanceof AssignmentLostError) {
        throw AppError.conflict(
          'Another rider is already on this delivery. It has been removed from your list.',
          'DELIVERY_TAKEN',
        );
      }
      throw error;
    } finally {
      // Release only if we still own the lock.
      const current = await this.redis.client.get(lockKey);
      if (current === lockToken) await this.redis.client.del(lockKey);
    }
  }

  /** Decline an offer and immediately try the next best rider. */
  async reject(riderId: string, assignmentId: string, reason?: string) {
    const claim = await this.prisma.deliveryAssignment.updateMany({
      where: { id: assignmentId, riderId, status: 'OFFERED' },
      data: { status: 'REJECTED', respondedAt: new Date(), rejectionReason: reason ?? 'Declined by rider' },
    });
    if (claim.count === 0) {
      throw AppError.conflict('That offer is no longer open.', 'OFFER_EXPIRED');
    }

    const assignment = await this.prisma.deliveryAssignment.findUniqueOrThrow({
      where: { id: assignmentId },
      select: { deliveryId: true },
    });

    const stillOpen = await this.prisma.deliveryAssignment.count({
      where: { deliveryId: assignment.deliveryId, status: 'OFFERED', expiresAt: { gt: new Date() } },
    });
    const delivery = await this.prisma.delivery.findUniqueOrThrow({
      where: { id: assignment.deliveryId },
      select: { status: true },
    });

    // Nobody left to ask: widen the search rather than leaving the job stranded.
    if (stillOpen === 0 && delivery.status === 'PENDING') {
      await this.offerDelivery(assignment.deliveryId);
    }
    return { rejected: true };
  }

  /** Staff view: who has been offered what, and what happened. */
  async assignmentsForDelivery(deliveryId: string) {
    return this.prisma.deliveryAssignment.findMany({
      where: { deliveryId },
      orderBy: { offeredAt: 'desc' },
      include: { rider: { select: { riderCode: true, user: { select: { firstName: true, lastName: true } } } } },
    });
  }
}

/** Internal signal: this transaction must roll back because the job was taken. */
class AssignmentLostError extends Error {
  /** Marker read by the catch block instead of relying on `instanceof`. */
  readonly isAssignmentLost = true;
}
