import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { formatNaira, percentOfKobo } from '@dispatch/shared';
import { PrismaService } from '../infra/prisma/prisma.service';
import { RedisService } from '../infra/redis/redis.service';
import { AppConfig } from '../config/app.config';
import { AppError } from '../common/errors/app-error';
import { haversineKm } from '../pricing/distance';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { MessagingService } from '../messaging/messaging.service';
import { checkCounter } from './price-bands';

/** Ignore riders whose last location is older than this when ranking candidates. */
/** How old a rider's last position may be before dispatch treats them as unlocatable. */
export const LOCATION_FRESHNESS_MINUTES = 10;

/**
 * HOW THE SEARCH WIDENS
 *
 * Round 1 asks the closest riders only. If nobody takes it, each later round
 * reaches further out. The job is worth more to the business than the petrol is
 * worth to the rider, so "nobody within 5 km" must never mean "nobody at all".
 */
const RADIUS_SCHEDULE_KM = [10, 20, 35, Number.POSITIVE_INFINITY] as const;

/**
 * THE DISPATCH ENGINE
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 4 built the offer race: three riders are asked at once, and exactly one
 * can win. Phase 6 makes the engine run itself. A booking must find a rider
 * without a human watching the screen, and when nobody answers it must widen the
 * search, then escalate — and finally admit defeat loudly rather than silently.
 *
 *   booking placed
 *     → round 1: nearest ≤ 5 km, 3 riders, 20 s each          (offer:new pushed)
 *     → all expired or rejected
 *     → round 2: ≤ 12 km, riders not asked in the last round   (offer:new pushed)
 *     → round 3: ≤ 25 km
 *     → round 4: the whole branch
 *     → still nobody? raise an admin alert and tell the dispatch desk  (dispatch:exhausted)
 *
 * Two invariants hold throughout:
 *
 *   1. **The database decides.** Offers are rows with an expiry; accepting is a
 *      conditional UPDATE. Redis is only a fast path and a cross-process lock.
 *   2. **A rider is never asked twice in a row.** `delivery_assignments` is unique
 *      per (delivery, rider), so the engine edits the existing row instead of
 *      duplicating it, and each round skips the riders asked in the previous one.
 */
@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: AppConfig,
    private readonly realtime: RealtimeGateway,
    private readonly messaging: MessagingService,
  ) {}

  get offerTimeoutSeconds(): number {
    return this.config.offerTimeoutSeconds;
  }

  get batchSize(): number {
    return this.config.offerBatchSize;
  }

  /* ─────────────────────────── expiry sweep ─────────────────────────── */

  /** Expire offers nobody answered. Cheap, idempotent, called by the scheduler and before every read/write. */
  async sweepExpired(): Promise<number> {
    const result = await this.prisma.deliveryAssignment.updateMany({
      where: {
        status: 'OFFERED',
        expiresAt: { lt: new Date() },
        // A rider who has named their price is not an unanswered offer: the clock
        // has stopped being theirs and started being the customer's. Sweeping it
        // away would delete a question from the customer's screen while they were
        // reading it, and their Accept would then fail with "that price is gone".
        counterState: { not: 'PENDING' },
      },
      data: { status: 'EXPIRED', respondedAt: new Date() },
    });
    if (result.count > 0) this.logger.log(`Expired ${result.count} unanswered offer(s)`);
    return result.count;
  }

  /* ──────────────────────────── the rounds ──────────────────────────── */

  /**
   * Where a delivery is in its search: which round comes next, how far we have
   * already reached, and whether the engine is out of ideas.
   *
   * The round lives on the delivery row (not in memory, not in Redis), so it
   * survives restarts, deploys and any number of API processes — and a round that
   * found nobody still counts, which is what lets the search widen.
   */
  async roundInfo(deliveryId: string): Promise<{
    asked: number;
    round: number;
    radiusKm: number;
    rejected: number;
    maxRounds: number;
    exhausted: boolean;
  }> {
    const [delivery, rows] = await Promise.all([
      this.prisma.delivery.findUnique({ where: { id: deliveryId }, select: { dispatchRound: true } }),
      this.prisma.deliveryAssignment.findMany({
        where: { deliveryId, method: 'AUTO' },
        select: { status: true },
      }),
    ]);

    const completedRounds = delivery?.dispatchRound ?? 0;
    const round = completedRounds + 1;
    const radiusKm = this.radiusForRound(round);

    return {
      asked: rows.length,
      rejected: rows.filter((row) => row.status === 'REJECTED').length,
      round,
      radiusKm,
      maxRounds: this.config.dispatchMaxRounds,
      exhausted: completedRounds >= this.config.dispatchMaxRounds,
    };
  }

  /**
   * Offer one delivery to the next batch of riders. Returns how many offers went
   * out — 0 means nobody suitable is available in this round's radius.
   */
  async offerDelivery(deliveryId: string): Promise<number> {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: {
        id: true,
        reference: true,
        status: true,
        branchId: true,
        serviceZoneId: true,
        customerId: true,
        pickupAddress: true,
        destAddress: true,
        pickupLat: true,
        pickupLng: true,
        distanceKm: true,
        chargeKobo: true,
        deliveryType: true,
      },
    });
    if (!delivery) throw AppError.notFound('Delivery');
    if (delivery.status !== 'PENDING') return 0;

    const info = await this.roundInfo(deliveryId);

    // The schedule is finite on purpose. Once every round has been spent the engine
    // stops rather than quietly starting over: the desk has been told, and a job that
    // has been round the whole branch twice needs a human decision, not round nine.
    if (info.exhausted) {
      this.logger.warn(
        `Delivery ${delivery.reference} · dispatch already exhausted (${info.round - 1}/${info.maxRounds} rounds) — waiting for the desk`,
      );
      return 0;
    }

    // Who must NOT be asked this round:
    //  · anyone holding a live offer right now (asking twice is noise)
    //  · anyone who said no — that is permanent, and the button must mean something
    //  · anyone asked in the previous round (nobody enjoys the same job three times)
    const rows = await this.prisma.deliveryAssignment.findMany({
      where: { deliveryId },
      select: { riderId: true, status: true, offeredAt: true, expiresAt: true, scoreBreakdown: true },
      orderBy: { offeredAt: 'desc' },
    });

    const now = Date.now();
    const previousRound = info.round - 1;
    const exclude = new Set<string>();
    for (const row of rows) {
      if (row.status === 'REJECTED' || row.status === 'ACCEPTED') exclude.add(row.riderId);
      if (row.status === 'OFFERED' && row.expiresAt.getTime() > now) exclude.add(row.riderId);

      // Whoever was asked in the round that just ended is skipped for one round —
      // nobody wants the same job three times in a minute — and comes back into the
      // pool afterwards, because a rider who was driving is not a rider who refused.
      const askedInRound = (row.scoreBreakdown as { round?: number } | null)?.round;
      if (askedInRound === previousRound) exclude.add(row.riderId);
    }

    const candidates = await this.findCandidates(delivery, [...exclude], info.radiusKm);

    // The round is recorded even when it finds nobody — that is what lets the next
    // round reach further out instead of retrying the same empty radius forever.
    const closeRound = async (sent: number) => {
      await this.prisma.delivery.update({
        where: { id: deliveryId },
        data: { dispatchRound: info.round, lastRoundAt: new Date() },
      });
      return sent;
    };

    if (candidates.length === 0) {
      this.logger.warn(
        `Delivery ${delivery.reference} · round ${info.round}/${info.maxRounds}: no rider within ${info.radiusKm === Number.POSITIVE_INFINITY ? 'the branch' : `${info.radiusKm} km`}`,
      );
      return closeRound(0);
    }

    const expiresAt = new Date(Date.now() + this.offerTimeoutSeconds * 1000);
    const chosen = candidates.slice(0, this.batchSize);
    const commissionPct = this.config.commissionPercent;

    let sent = 0;
    for (const [index, candidate] of chosen.entries()) {
      const existing = rows.find((row) => row.riderId === candidate.riderId);

      // `delivery_assignments` is unique per (delivery, rider): re-offering to a
      // rider whose earlier offer expired updates that row rather than inserting a
      // second one. A rejection never reaches here — those riders are excluded.
      const assignment = existing
        ? await this.prisma.deliveryAssignment.update({
            where: { deliveryId_riderId: { deliveryId, riderId: candidate.riderId } },
            data: {
              status: 'OFFERED',
              rank: index + 1,
              method: 'AUTO',
              scoreBreakdown: { ...candidate.score, round: info.round } as never,
              offeredAt: new Date(),
              expiresAt,
              respondedAt: null,
              rejectionReason: null,
            },
            select: { id: true },
          })
        : await this.prisma.deliveryAssignment.create({
            data: {
              deliveryId,
              riderId: candidate.riderId,
              status: 'OFFERED',
              method: 'AUTO',
              rank: index + 1,
              scoreBreakdown: { ...candidate.score, round: info.round } as never,
              expiresAt,
            },
            select: { id: true },
          });

      sent += 1;

      // The push is the difference between "a rider sees it in 20 seconds" and
      // "a rider sees it when they next unlock their phone".
      const commissionKobo = percentOfKobo(delivery.chargeKobo, commissionPct, 50);
      this.realtime.offerNew(candidate.riderId, {
        assignmentId: assignment.id,
        deliveryId,
        reference: delivery.reference,
        pickupAddress: delivery.pickupAddress,
        destAddress: delivery.destAddress,
        distanceToPickupKm: candidate.distanceKm,
        chargeFormatted: formatNaira(delivery.chargeKobo),
        netFormatted: formatNaira(delivery.chargeKobo - commissionKobo),
        expiresAt: expiresAt.toISOString(),
        secondsLeft: this.offerTimeoutSeconds,
      });

      // The socket only reaches a rider whose app is open. The SMS is the safety
      // net for the rider who put the phone in their pocket; it is fire-and-forget
      // because a messaging failure must never cost the delivery its offer.
      const kmText = candidate.distanceKm === null ? '' : ` (${candidate.distanceKm.toFixed(1)} km to pickup)`;
      const phone = candidate.phone;
      if (phone) {
        void this.messaging
        .sendSms({
          to: phone,
          kind: 'DISPATCH_OFFER',
          body: `Dispatch: job ${delivery.reference}${kmText}. You have ${this.offerTimeoutSeconds}s to accept in the app.`,
        })
        .catch((error: unknown) => this.logger.warn(`Offer SMS to ${candidate.riderId} failed: ${String(error)}`));
      }
    }

    this.realtime.toStaff('delivery:updated', {
      id: deliveryId,
      reference: delivery.reference,
      status: 'PENDING',
      note: `Round ${info.round}: offered to ${sent} rider(s)`,
      at: new Date().toISOString(),
    });

    this.logger.log(
      `Delivery ${delivery.reference} · round ${info.round}/${info.maxRounds} · radius ${info.radiusKm === Number.POSITIVE_INFINITY ? 'branch' : `${info.radiusKm}km`} · offered to ${sent} rider(s), ${this.offerTimeoutSeconds}s to respond`,
    );
    return closeRound(sent);
  }

  /**
   * How far round N is allowed to reach. Exposed because the dispatch board shows
   * the same figure the engine will use — one schedule, one reader of it.
   */
  radiusForRound(round: number): number {
    const index = Math.min(Math.max(round, 1) - 1, RADIUS_SCHEDULE_KM.length - 1);
    return RADIUS_SCHEDULE_KM[index] ?? Number.POSITIVE_INFINITY;
  }

  /**
   * Rank riders by how quickly they could reach the pickup.
   *
   * Score = distance to the pickup + a penalty for a stale location + a penalty
   * for being outside the delivery's zone. The zone penalty is deliberately small:
   * a free rider two streets away beats a zone match across the lagoon.
   */
  private async findCandidates(
    delivery: { branchId: string; serviceZoneId: string | null; pickupLat: number; pickupLng: number },
    excludeRiderIds: string[],
    radiusKm: number,
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
        serviceZoneId: true,
        serviceZone: { select: { centerLat: true, centerLng: true } },
        user: { select: { phone: true } },
        locations: { orderBy: { recordedAt: 'desc' }, take: 1, select: { lat: true, lng: true, recordedAt: true } },
        _count: {
          select: {
            deliveries: {
              where: {
                status: {
                  in: ['ASSIGNED', 'ACCEPTED', 'ARRIVED_AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION'],
                },
              },
            },
          },
        },
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
        const distanceKm = from ? haversineKm(from, pickup) : Number.POSITIVE_INFINITY;
        const pingPenalty = hasFreshPing ? 0 : 25;
        const zonePenalty = delivery.serviceZoneId && rider.serviceZoneId !== delivery.serviceZoneId ? 3 : 0;

        return {
          riderId: rider.id,
          phone: rider.user.phone,
          distanceKm: Number.isFinite(distanceKm) ? Math.round(distanceKm * 100) / 100 : null,
          reachKm: distanceKm + pingPenalty + zonePenalty,
          score: {
            distanceToPickupKm: Number.isFinite(distanceKm) ? Math.round(distanceKm * 100) / 100 : null,
            lastPingAgeMinutes: latest ? Math.round((Date.now() - latest.recordedAt.getTime()) / 60000) : null,
            sameZone: !zonePenalty,
            pingPenalty,
            zonePenalty,
          },
        };
      })
      // The radius only ever excludes riders we could actually place: a rider with
      // no location at all has no distance, and is kept for the widest round.
      .filter((candidate) => !Number.isFinite(radiusKm) || candidate.distanceKm === null || candidate.distanceKm <= radiusKm)
      .sort((a, b) => a.reachKm - b.reachKm || a.riderId.localeCompare(b.riderId));
  }

  /* ──────────────────────────── the ticker ──────────────────────────── */

  /**
   * One pass of the engine. Called on a timer, and safe to call concurrently from
   * several API processes: every delivery round takes a Redis lock first.
   */
  async tick(limit = 25): Promise<{ expired: number; scanned: number; offered: number; exhausted: number }> {
    const expired = await this.sweepExpired();

    // A delivery needs help if it is still PENDING and nobody is holding a live
    // offer for it. That is exactly the state after a batch expires.
    const waiting = await this.prisma.delivery.findMany({
      where: {
        status: 'PENDING',
        riderId: null,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        assignments: { none: { status: 'OFFERED', expiresAt: { gt: new Date() } } },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true, reference: true },
    });

    let offered = 0;
    let exhausted = 0;

    for (const delivery of waiting) {
      const lockKey = `dispatch:round:${delivery.id}`;
      const lockToken = randomUUID();
      const locked = await this.redis.client.set(lockKey, lockToken, 'PX', 15_000, 'NX');
      if (locked !== 'OK') continue; // another process is already on this one

      try {
        const info = await this.roundInfo(delivery.id);
        if (info.exhausted) {
          if (await this.raiseExhausted(delivery.id, delivery.reference, info)) exhausted += 1;
          continue;
        }

        const sent = await this.offerDelivery(delivery.id);
        offered += sent;

        if (sent === 0) {
          // Nothing left to try: the widest round is behind us.
          const after = await this.roundInfo(delivery.id);
          if (after.exhausted && (await this.raiseExhausted(delivery.id, delivery.reference, after))) exhausted += 1;
        }
      } catch (error) {
        // One bad row must never stop the queue.
        this.logger.error(`Dispatch failed for ${delivery.reference}: ${(error as Error).message}`);
      } finally {
        const current = await this.redis.client.get(lockKey);
        if (current === lockToken) await this.redis.client.del(lockKey);
      }
    }

    if (offered > 0 || exhausted > 0) {
      this.logger.log(`Dispatch tick: ${waiting.length} waiting · ${offered} offer(s) · ${exhausted} exhausted`);
    }
    return { expired, scanned: waiting.length, offered, exhausted };
  }

  /**
   * Escalation of last resort. The job stays PENDING and a human is told, once per
   * ten minutes per delivery — a page that repeats every five seconds is a page
   * nobody reads.
   */
  private async raiseExhausted(
    deliveryId: string,
    reference: string,
    info: { round: number; asked: number; rejected: number },
  ): Promise<boolean> {
    const quietKey = `dispatch:alerted:${deliveryId}`;
    const first = await this.redis.client.set(quietKey, '1', 'PX', 10 * 60 * 1000, 'NX');
    if (first !== 'OK') return false;

    await this.prisma.adminAlert.create({
      data: {
        type: 'DISPATCH_EXHAUSTED',
        severity: 'WARNING',
        title: `${reference} still has no rider`,
        body: `Dispatch asked ${info.asked} rider(s) over ${Math.max(1, info.round - 1)} round(s)${info.rejected > 0 ? `, ${info.rejected} declined` : ''}. Assign it manually from the delivery board.`,
        entityType: 'Delivery',
        entityId: deliveryId,
      },
    });

    this.realtime.toStaff('dispatch:exhausted', {
      deliveryId,
      reference,
      asked: info.asked,
      rejected: info.rejected,
      at: new Date().toISOString(),
    });

    this.logger.warn(`Delivery ${reference} exhausted dispatch — raised an alert for the desk`);
    return true;
  }

  /**
   * Re-offer deliveries that are still waiting. Called when a rider comes online,
   * because "nobody was available five minutes ago" stops being true the moment
   * somebody is.
   */
  async offerWaitingDeliveries(limit = 25): Promise<{ scanned: number; offered: number }> {
    const waiting = await this.prisma.delivery.findMany({
      where: {
        status: 'PENDING',
        riderId: null,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    });

    let offered = 0;
    for (const delivery of waiting) {
      const live = await this.prisma.deliveryAssignment.count({
        where: { deliveryId: delivery.id, status: 'OFFERED', expiresAt: { gt: new Date() } },
      });
      if (live > 0) continue;

      // A rider is available again — clear the quiet period so a fresh failure can
      // alert the desk instead of being swallowed by the old one.
      await this.redis.client.del(`dispatch:alerted:${delivery.id}`);

      try {
        offered += await this.offerDelivery(delivery.id);
      } catch (error) {
        this.logger.error(`Could not offer waiting delivery ${delivery.id}: ${(error as Error).message}`);
      }
    }

    if (offered > 0) {
      this.logger.log(`Waiting-delivery sweep: ${waiting.length} scanned, ${offered} offer(s) sent`);
    }
    return { scanned: waiting.length, offered };
  }

  /* ───────────────────────────── rider side ──────────────────────────── */

  /** The rider's live offer list, with the money they would actually earn. */
  async offersForRider(riderId: string) {
    await this.sweepExpired();

    const assignments = await this.prisma.deliveryAssignment.findMany({
      where: {
        riderId,
        status: 'OFFERED',
        // Still live, or still being answered: a counter of this rider's own stays on
        // their screen past the twenty-second offer clock, because the wait is now on
        // the other person.
        OR: [{ expiresAt: { gt: new Date() } }, { counterState: 'PENDING' }],
      },
      orderBy: { offeredAt: 'asc' },
      include: {
        delivery: {
          select: {
            id: true,
            reference: true,
            deliveryType: true,
            chargeKobo: true,
            quotedKobo: true,
            askKobo: true,
            isNegotiated: true,
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
      // The number the rider is being asked to accept: the customer's asking price,
      // which is the platform bill unless the customer negotiated it down.
      const askKobo = delivery.askKobo ?? delivery.chargeKobo;
      const quotedKobo = delivery.quotedKobo ?? delivery.chargeKobo;
      const commissionKobo = percentOfKobo(askKobo, commissionPct, 50);
      return {
        assignmentId: assignment.id,
        offeredAt: assignment.offeredAt,
        expiresAt: assignment.expiresAt,
        secondsLeft: Math.max(0, Math.round((assignment.expiresAt.getTime() - Date.now()) / 1000)),
        offerTimeoutSeconds: this.offerTimeoutSeconds,
        distanceToPickupKm:
          (assignment.scoreBreakdown as { distanceToPickupKm?: number } | null)?.distanceToPickupKm ?? null,
        delivery: {
          id: delivery.id,
          reference: delivery.reference,
          deliveryType: delivery.deliveryType,
          zone: delivery.serviceZone?.name ?? null,
          pickup: {
            address: delivery.pickupAddress,
            landmark: delivery.pickupLandmark,
            lat: delivery.pickupLat,
            lng: delivery.pickupLng,
          },
          destination: { address: delivery.destAddress, landmark: delivery.destLandmark },
          distanceKm: delivery.distanceKm,
          durationMinutes: delivery.durationMinutes,
          package: {
            category: delivery.packageCategory,
            description: delivery.packageDescription,
            isFragile: delivery.isFragile,
          },
          recipientName: delivery.recipientName,
        },
        /**
         * The two numbers the rider needs to make a decision — and the third they
         * can propose. `quotedKobo` is what the platform billed; `askKobo` is what
         * the customer has offered. They differ only when the customer negotiated.
         */
        money: {
          quotedKobo: quotedKobo.toString(),
          quotedFormatted: formatNaira(quotedKobo),
          askKobo: askKobo.toString(),
          askFormatted: formatNaira(askKobo),
          isNegotiated: delivery.isNegotiated,
          counterKobo: assignment.counterKobo?.toString() ?? null,
          counterState: assignment.counterState,
        },
        pay: {
          chargeKobo: askKobo.toString(),
          commissionPct,
          commissionKobo: commissionKobo.toString(),
          /** What the rider takes home if they accept the asking price. */
          netKobo: (askKobo - commissionKobo).toString(),
          netFormatted: formatNaira(askKobo - commissionKobo),
        },
      };
    });
  }

  /**
   * Accept an offer. Exactly one rider can win, no matter how many tap at once.
   *
   * The amount agreed is the number on the card the rider just tapped: the
   * customer's asking price. A customer accepting a rider's own price comes through
   * {@link acceptCounter} instead, and both share {@link conclude} — the rules that
   * make an acceptance safe (one winner, frozen commission, rivals told, rider
   * marked busy) exist once.
   */
  async accept(riderId: string, assignmentId: string) {
    const assignment = await this.prisma.deliveryAssignment.findUnique({
      where: { id: assignmentId },
      select: {
        riderId: true,
        delivery: {
          select: { quotedKobo: true, askKobo: true, chargeKobo: true, isNegotiated: true },
        },
      },
    });
    if (!assignment || assignment.riderId !== riderId) throw AppError.notFound('Offer');

    const agreedKobo = assignment.delivery.askKobo ?? assignment.delivery.chargeKobo;
    return this.conclude({
      assignmentId,
      agreedKobo,
      basis: assignment.delivery.isNegotiated ? 'ASK' : 'QUOTE',
      actor: 'RIDER',
      expectedRiderId: riderId,
      requireLiveOffer: true,
    });
  }

  /**
   * A rider asking for more than the number on the offer.
   *
   * Deliberately not an acceptance: nothing is charged and nobody is assigned. The
   * customer is told, and answers with accept or decline. A rider who asks for less
   * than the asking price is told to take the job instead — silently charging the
   * customer less than they offered would be a bug dressed as a favour.
   */
  async counter(riderId: string, assignmentId: string, amountKobo: bigint) {
    const assignment = await this.prisma.deliveryAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        delivery: {
          select: {
            id: true,
            reference: true,
            customerId: true,
            status: true,
            askKobo: true,
            chargeKobo: true,
            quotedKobo: true,
            isNegotiated: true,
          },
        },
        rider: { select: { riderCode: true, user: { select: { firstName: true, lastName: true } } } },
      },
    });
    if (!assignment || assignment.riderId !== riderId) throw AppError.notFound('Offer');
    if (assignment.status !== 'OFFERED') {
      throw AppError.conflict('That offer is no longer open.', 'OFFER_EXPIRED');
    }
    if (assignment.delivery.status !== 'PENDING') {
      throw AppError.conflict('That delivery already has a rider.', 'DELIVERY_TAKEN');
    }
    if (assignment.expiresAt.getTime() <= Date.now()) {
      throw AppError.conflict('That offer has expired. New jobs will appear here.', 'OFFER_EXPIRED');
    }

    const ask = assignment.delivery.askKobo ?? assignment.delivery.chargeKobo;
    const band = checkCounter(ask, amountKobo);
    if (!band.ok) {
      throw AppError.rule(
        band.message,
        amountKobo <= ask ? 'COUNTER_TOO_LOW' : 'COUNTER_TOO_HIGH',
      );
    }

    await this.prisma.deliveryAssignment.update({
      where: { id: assignmentId },
      data: { counterKobo: amountKobo, counterState: 'PENDING', counteredAt: new Date() },
    });

    // The customer's phone is where this is answered, so tell it. The payload only
    // says "something changed"; the page refetches and asks the server for the real
    // number, so a stale socket can never invent a price.
    this.realtime.counterOffered(assignment.delivery.customerId, {
      deliveryId: assignment.delivery.id,
      reference: assignment.delivery.reference,
      assignmentId,
      askFormatted: formatNaira(ask),
      counterFormatted: formatNaira(amountKobo),
      at: new Date().toISOString(),
    });

    this.logger.log(
      `Rider ${assignment.rider.riderCode} countered ${assignment.delivery.reference} at ${formatNaira(amountKobo)} (asked ${formatNaira(ask)})`,
    );

    return {
      countered: true,
      askKobo: ask.toString(),
      counterKobo: amountKobo.toString(),
      askFormatted: formatNaira(ask),
      counterFormatted: formatNaira(amountKobo),
      message: 'The customer has been told. You will see their answer here.',
    };
  }

  /**
   * The customer accepting a rider's price. That rider gets the job at that number,
   * and every other rider is told it is gone.
   */
  async acceptCounter(customerId: string, assignmentId: string) {
    const assignment = await this.prisma.deliveryAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        delivery: { select: { customerId: true, quotedKobo: true, askKobo: true, chargeKobo: true } },
      },
    });
    // A customer may only ever answer a counter on their own delivery, and a
    // delivery that is not theirs must read as "not found" — not "forbidden",
    // which would confirm the id exists.
    if (!assignment || assignment.delivery.customerId !== customerId) {
      throw AppError.notFound('Offer');
    }
    if (assignment.counterState !== 'PENDING' || assignment.counterKobo === null) {
      throw AppError.conflict('That price is no longer on the table.', 'COUNTER_GONE');
    }
    if (assignment.status !== 'OFFERED') {
      throw AppError.conflict('That rider is no longer available for this job.', 'OFFER_EXPIRED');
    }

    return this.conclude({
      assignmentId,
      agreedKobo: assignment.counterKobo,
      basis: 'COUNTER',
      actor: 'CUSTOMER',
      expectedRiderId: assignment.riderId,
      requireLiveOffer: false,
    });
  }

  /**
   * The customer turning a rider's price down. Nothing is assigned: the rider's
   * offer stays open at the asking price, so they can still take the job at the
   * number they were originally shown.
   */
  async declineCounter(customerId: string, assignmentId: string, reason?: string) {
    const assignment = await this.prisma.deliveryAssignment.findUnique({
      where: { id: assignmentId },
      include: { delivery: { select: { customerId: true, id: true, reference: true } } },
    });
    if (!assignment || assignment.delivery.customerId !== customerId) {
      throw AppError.notFound('Offer');
    }
    if (assignment.counterState !== 'PENDING') {
      throw AppError.conflict('That price is no longer on the table.', 'COUNTER_GONE');
    }

    await this.prisma.deliveryAssignment.update({
      where: { id: assignmentId },
      data: { counterState: 'DECLINED', respondedAt: new Date(), rejectionReason: reason ?? null },
    });

    this.realtime.counterAnswered(assignment.riderId, {
      deliveryId: assignment.delivery.id,
      assignmentId,
      answer: 'DECLINED',
      at: new Date().toISOString(),
    });

    return {
      declined: true,
      message: 'Rider told. Their offer stays open at the price you asked.',
    };
  }

  /**
   * What the customer sees while riders are being asked: the bill, their asking
   * price, and every rider who named a price of their own. Names and rider codes
   * only — no phone numbers, ever.
   */
  async offersForCustomer(customerId: string, deliveryId: string) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, customerId },
      select: {
        id: true,
        reference: true,
        status: true,
        quotedKobo: true,
        askKobo: true,
        isNegotiated: true,
        chargeKobo: true,
        agreedKobo: true,
        agreedBasis: true,
        riderId: true,
      },
    });
    if (!delivery) throw AppError.notFound('Delivery');

    const rows = await this.prisma.deliveryAssignment.findMany({
      where: { deliveryId },
      orderBy: { offeredAt: 'desc' },
      include: { rider: { select: { riderCode: true, user: { select: { firstName: true, lastName: true } } } } },
    });

    const pending = rows.filter((row) => row.counterState === 'PENDING' && row.status === 'OFFERED');
    return {
      deliveryId: delivery.id,
      reference: delivery.reference,
      status: delivery.status,
      quotedKobo: (delivery.quotedKobo ?? delivery.chargeKobo).toString(),
      askKobo: (delivery.askKobo ?? delivery.chargeKobo).toString(),
      isNegotiated: delivery.isNegotiated,
      chargeKobo: delivery.chargeKobo.toString(),
      agreedKobo: delivery.agreedKobo?.toString() ?? null,
      agreedBasis: delivery.agreedBasis,
      ridersAsked: rows.filter((row) => row.status === 'OFFERED').length,
      pendingCount: pending.length,
      offers: rows
        .filter((row) => row.status !== 'REJECTED')
        .map((row) => ({
          assignmentId: row.id,
          riderName: `${row.rider.user.firstName} ${row.rider.user.lastName}`.trim(),
          riderCode: row.rider.riderCode,
          status: row.status,
          counterKobo: row.counterKobo?.toString() ?? null,
          counterState: row.counterState,
          agreedKobo: row.agreedKobo?.toString() ?? null,
          offeredAt: row.offeredAt,
          expiresAt: row.expiresAt,
        })),
    };
  }

  /**
   * The one place a delivery gets a rider.
   *
   * Both routes into it — a rider tapping Accept, a customer accepting a rider's
   * price — pass through here, so "exactly one winner" and "the commission is
   * frozen on the agreed number" are true for both rather than true twice.
   */
  private async conclude(input: {
    assignmentId: string;
    agreedKobo: bigint;
    basis: 'QUOTE' | 'ASK' | 'COUNTER';
    actor: 'RIDER' | 'CUSTOMER';
    expectedRiderId: string;
    requireLiveOffer: boolean;
  }) {
    const { assignmentId, agreedKobo, basis, actor, expectedRiderId, requireLiveOffer } = input;
    const lockKey = `dispatch:accept:${assignmentId}`;
    const lockToken = randomUUID();
    // 5 s is longer than any single acceptance can take; the token prevents a slow
    // request from releasing a lock that a later request now owns.
    const locked = await this.redis.client.set(lockKey, lockToken, 'PX', 5000, 'NX');
    if (locked !== 'OK') {
      throw AppError.conflict('This delivery is being accepted by someone else right now.', 'OFFER_TAKEN');
    }

    try {
      // A rider's acceptance has to beat the 20-second clock; a customer answering a
      // price they were shown does not, so the sweep only runs for the rider path.
      if (requireLiveOffer) await this.sweepExpired();

      const result = await this.prisma.$transaction(async (tx) => {
        // 1. Claim the offer atomically. The agreed number is written on this row, so
        //    the rider's side of the deal is recorded where the rider is.
        const claim = await tx.deliveryAssignment.updateMany({
          where: {
            id: assignmentId,
            riderId: expectedRiderId,
            status: 'OFFERED',
            ...(requireLiveOffer ? { expiresAt: { gt: new Date() } } : {}),
            ...(basis === 'COUNTER' ? { counterState: 'PENDING' as const } : {}),
          },
          data: {
            status: 'ACCEPTED',
            respondedAt: new Date(),
            agreedKobo,
            agreedBasis: basis,
            ...(basis === 'COUNTER' ? { counterState: 'ACCEPTED' as const } : {}),
          },
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
            riderId: expectedRiderId,
            acceptedAt: new Date(),
            // The price that was actually agreed is the price that gets charged, and
            // the price the commission is cut from. Both are frozen together below.
            chargeKobo: agreedKobo,
            agreedKobo,
            agreedBasis: basis,
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
        const commissionKobo = percentOfKobo(agreedKobo, commissionPct, 50);
        await tx.delivery.update({
          where: { id: assignment.deliveryId },
          data: {
            commissionSnapshot: {
              commissionPct,
              commissionKobo: commissionKobo.toString(),
              riderNetKobo: (agreedKobo - commissionKobo).toString(),
              agreedKobo: agreedKobo.toString(),
              agreedBasis: basis,
              computedAt: new Date().toISOString(),
            },
          },
        });

        // 5. The rider is now busy — they must stop receiving new offers.
        await tx.rider.update({
          where: { id: expectedRiderId },
          data: { availability: 'ON_DELIVERY' },
        });

        // 6. History.
        await tx.deliveryStatusHistory.create({
          data: {
            deliveryId: assignment.deliveryId,
            fromStatus: 'PENDING',
            toStatus: 'ACCEPTED',
            actorType: actor,
            reason:
              actor === 'RIDER'
                ? `Offer accepted by rider at ${formatNaira(agreedKobo)}`
                : `Customer accepted the rider's price (${formatNaira(agreedKobo)})`,
          },
        });

        return {
          ok: true as const,
          deliveryId: assignment.deliveryId,
          reference: assignment.delivery.reference,
        };
      });

      if (!result.ok) {
        throw AppError.conflict(
          actor === 'RIDER'
            ? 'That offer has expired or was already taken. New jobs will appear here.'
            : 'That price is no longer on the table.',
          'OFFER_EXPIRED',
        );
      }

      // Winner announced: kill the other offers for this delivery, outside the
      // transaction, in a single statement on rows we no longer compete for.
      const rivals = await this.prisma.deliveryAssignment.findMany({
        where: { deliveryId: result.deliveryId, status: 'OFFERED' },
        select: { id: true, riderId: true },
      });

      await this.prisma.deliveryAssignment.updateMany({
        where: { deliveryId: result.deliveryId, status: 'OFFERED' },
        data: { status: 'EXPIRED', respondedAt: new Date() },
      });

      // Tell the riders who lost the race, so the offer disappears from their phone
      // instead of sitting there until it is tapped and refused.
      for (const rival of rivals) {
        if (rival.riderId === expectedRiderId) continue;
        this.realtime.offerRevoked(rival.riderId, {
          assignmentId: rival.id,
          deliveryId: result.deliveryId,
          reason: 'TAKEN',
        });
      }

      this.realtime.deliveryPush(
        {
          id: result.deliveryId,
          reference: result.reference,
          status: 'ACCEPTED',
          at: new Date().toISOString(),
        },
        { staff: true, riderIds: [expectedRiderId] },
      );

      this.logger.log(
        `${actor === 'RIDER' ? `Rider ${expectedRiderId}` : 'Customer'} accepted delivery ${result.reference} at ${formatNaira(agreedKobo)} (${basis})`,
      );
      return { accepted: true, deliveryId: result.deliveryId, agreedKobo: agreedKobo.toString() };
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
      select: { status: true, reference: true },
    });

    // Nobody left to ask: widen the search rather than leaving the job stranded.
    if (stillOpen === 0 && delivery.status === 'PENDING') {
      const sent = await this.offerDelivery(assignment.deliveryId);
      if (sent === 0) {
        const info = await this.roundInfo(assignment.deliveryId);
        if (info.exhausted) await this.raiseExhausted(assignment.deliveryId, delivery.reference, info);
      }
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
