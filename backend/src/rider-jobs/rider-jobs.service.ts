import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  DELIVERY_STATUS_LABELS,
  canTransition,
  formatNaira,
  percentOfKobo,
  type DeliveryStatus,
} from '@dispatch/shared';
import { PrismaService } from '../infra/prisma/prisma.service';
import { AppError } from '../common/errors/app-error';
import { AppConfig } from '../config/app.config';
import { StorageService } from '../storage/storage.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { RT } from '../realtime/realtime.types';
import { DispatchService } from '../dispatch/dispatch.service';

const hashOtp = (value: string) => createHash('sha256').update(value).digest('hex');

/** How long a completed delivery's earnings stay PENDING before withdrawal. */
const EARNINGS_HOLD_HOURS = 24;

/**
 * RIDER JOB WORKFLOW
 * ─────────────────────────────────────────────────────────────────────────────
 * Once a rider accepts an offer they walk the delivery through a fixed sequence:
 *
 *   ASSIGNED → ACCEPTED → ARRIVED_AT_PICKUP → PICKED_UP → IN_TRANSIT
 *            → ARRIVED_AT_DESTINATION → DELIVERED
 *
 * Every step is recorded with a timestamp on the delivery and a row in the status
 * history. The shared state machine (`@dispatch/shared`) decides what is legal, so
 * the rider app can never show a button the API would reject, and a hand-crafted
 * request can never skip a step.
 *
 * Proof of delivery: the recipient's 6-digit OTP, or a photo plus the recipient's
 * name. The OTP is stored only as a SHA-256 hash and is capped at 5 attempts.
 */
@Injectable()
export class RiderJobsService {
  private readonly logger = new Logger(RiderJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeGateway,
    private readonly dispatch: DispatchService,
  ) {}

  /** The job the rider is currently working, if any. */
  async activeJob(riderId: string) {
    const delivery = await this.prisma.delivery.findFirst({
      where: {
        riderId,
        status: { in: ['ASSIGNED', 'ACCEPTED', 'ARRIVED_AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION'] },
      },
      orderBy: { acceptedAt: 'desc' },
      include: { statusHistory: { orderBy: { createdAt: 'asc' } } },
    });
    return delivery ? this.toJob(delivery) : null;
  }

  /** Everything this rider has worked, newest first. */
  async history(riderId: string, page = 1, perPage = 20) {
    const safePage = Math.max(1, page);
    const take = Math.min(50, Math.max(1, perPage));
    const [total, rows] = await Promise.all([
      this.prisma.delivery.count({ where: { riderId } }),
      this.prisma.delivery.findMany({
        where: { riderId },
        orderBy: { updatedAt: 'desc' },
        skip: (safePage - 1) * take,
        take,
        include: { earning: true },
      }),
    ]);

    return {
      items: rows.map((row) => this.toJob(row)),
      page: safePage,
      perPage: take,
      total,
      totalPages: Math.max(1, Math.ceil(total / take)),
    };
  }

  async getJob(riderId: string, deliveryId: string) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, riderId },
      include: { statusHistory: { orderBy: { createdAt: 'asc' } }, earning: true },
    });
    if (!delivery) throw AppError.notFound('Delivery');
    return this.toJob(delivery);
  }

  /**
   * Advance the job one step. One method for the whole lifecycle, because every
   * step shares the same three guards: ownership, legality, and idempotency.
   */
  async advance(
    riderId: string,
    deliveryId: string,
    action: 'ARRIVE_AT_PICKUP' | 'PICK_UP' | 'START_TRANSIT' | 'ARRIVE_AT_DESTINATION',
    location?: { lat?: number; lng?: number },
  ) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, riderId },
      select: { id: true, status: true, reference: true },
    });
    if (!delivery) throw AppError.notFound('Delivery');

    const target: DeliveryStatus =
      action === 'ARRIVE_AT_PICKUP'
        ? 'ARRIVED_AT_PICKUP'
        : action === 'PICK_UP'
          ? 'PICKED_UP'
          : action === 'START_TRANSIT'
            ? 'IN_TRANSIT'
            : 'ARRIVED_AT_DESTINATION';

    if (!canTransition(delivery.status as DeliveryStatus, target)) {
      throw AppError.conflict(
        `You cannot mark this delivery as ${DELIVERY_STATUS_LABELS[target].toLowerCase()} while it is ${DELIVERY_STATUS_LABELS[delivery.status as DeliveryStatus].toLowerCase()}.`,
        'INVALID_STATUS_TRANSITION',
      );
    }

    const timestamps: Record<string, Date> = {};
    if (target === 'PICKED_UP') timestamps['pickedUpAt'] = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.delivery.update({
        where: { id: delivery.id },
        data: {
          status: target,
          ...timestamps,
          statusHistory: {
            create: {
              fromStatus: delivery.status,
              toStatus: target,
              actorType: 'RIDER',
              lat: location?.lat,
              lng: location?.lng,
            },
          },
        },
        include: { statusHistory: { orderBy: { createdAt: 'asc' } }, earning: true },
      });

      if (target === 'PICKED_UP' && location?.lat !== undefined && location.lng !== undefined) {
        await tx.riderLocation.create({
          data: { riderId, deliveryId, lat: location.lat, lng: location.lng },
        });
      }
      return result;
    });

    this.pushStatus(updated, riderId);
    return this.toJob(updated);
  }

  /**
   * Complete the delivery. Requires the recipient OTP, or a photo plus the
   * recipient's name — never a bare "delivered" tap.
   */
  /**
   * Stores the proof-of-delivery photo and returns its key.
   *
   * The photo is only accepted from the rider who owns the job, only while the
   * job is still in transit, and only before it is completed — otherwise a rider
   * could swap the proof after the fact.
   */
  async uploadProofPhoto(
    riderId: string,
    deliveryId: string,
    input: { mimeType: string; base64: string },
  ) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, riderId },
      select: { id: true, status: true },
    });
    if (!delivery) throw AppError.notFound('Delivery not found');

    if (!['PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION'].includes(delivery.status)) {
      throw AppError.conflict(
        'You can only attach proof once the package is on the way to the recipient.',
        'INVALID_STATUS_TRANSITION',
      );
    }

    const stored = await this.storage.saveBase64({
      keyPrefix: `proofs/${deliveryId}`,
      fileName: 'proof',
      mimeType: input.mimeType,
      base64: input.base64,
    });

    this.logger.log(`Rider ${riderId} uploaded proof ${stored.key} (${stored.sizeBytes} bytes)`);
    return { proofPhotoKey: stored.key, sizeBytes: stored.sizeBytes };
  }

  async complete(
    riderId: string,
    deliveryId: string,
    input: {
      otp?: string;
      proofPhotoKey?: string;
      recipientNameEntered?: string;
      lat?: number;
      lng?: number;
    },
  ) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, riderId },
      include: { customer: { select: { id: true } } },
    });
    if (!delivery) throw AppError.notFound('Delivery');

    if (!canTransition(delivery.status as DeliveryStatus, 'DELIVERED')) {
      throw AppError.conflict(
        delivery.status === 'DELIVERED'
          ? 'This delivery is already complete.'
          : 'Mark the delivery as arrived at the destination before completing it.',
        'INVALID_STATUS_TRANSITION',
      );
    }

    // ── Proof of delivery ────────────────────────────────────────────────────
    let proofType: 'RECIPIENT_OTP' | 'PHOTO';
    if (input.otp) {
      if (!delivery.otpHash) throw AppError.conflict('No delivery code was issued for this job', 'OTP_MISSING');
      if (delivery.otpAttempts >= 5) {
        throw AppError.conflict(
          'Too many incorrect codes. Ask the recipient to check the app, or use a photo plus their name.',
          'OTP_LOCKED',
        );
      }
      if (hashOtp(input.otp) !== delivery.otpHash) {
        await this.prisma.delivery.update({
          where: { id: delivery.id },
          data: { otpAttempts: { increment: 1 } },
        });
        throw AppError.validation([{ field: 'otp', message: 'That code is not correct' }]);
      }
      proofType = 'RECIPIENT_OTP';
    } else if (input.proofPhotoKey && input.recipientNameEntered) {
      proofType = 'PHOTO';
    } else {
      throw AppError.validation([
        { field: 'otp', message: 'Enter the recipient’s code, or attach a photo and their name' },
      ]);
    }

    const commissionPct =
      ((delivery.commissionSnapshot as { commissionPct?: number } | null)?.commissionPct ?? this.config.commissionPercent);
    const commissionKobo = percentOfKobo(delivery.chargeKobo, commissionPct, 50);
    const netKobo = delivery.chargeKobo - commissionKobo;
    const availableAt = new Date(Date.now() + EARNINGS_HOLD_HOURS * 60 * 60 * 1000);

    const updated = await this.prisma.$transaction(async (tx) => {
      // Claim the delivery; two taps on "Complete" must not pay twice.
      const claim = await tx.delivery.updateMany({
        where: { id: delivery.id, riderId, status: 'ARRIVED_AT_DESTINATION' },
        data: { status: 'DELIVERED', deliveredAt: new Date(), paymentStatus: 'PAID' },
      });
      if (claim.count === 0) {
        throw AppError.conflict('This delivery has already been completed.', 'DUPLICATE_REQUEST');
      }

      await tx.deliveryProof.create({
        data: {
          deliveryId: delivery.id,
          type: proofType,
          fileKey: input.proofPhotoKey,
          otpVerifiedAt: proofType === 'RECIPIENT_OTP' ? new Date() : null,
          recipientNameEntered: input.recipientNameEntered,
          lat: input.lat,
          lng: input.lng,
        },
      });

      await tx.deliveryStatusHistory.create({
        data: {
          deliveryId: delivery.id,
          fromStatus: 'ARRIVED_AT_DESTINATION',
          toStatus: 'DELIVERED',
          actorType: 'RIDER',
          reason: proofType === 'RECIPIENT_OTP' ? 'Completed with recipient OTP' : 'Completed with photo proof',
          lat: input.lat,
          lng: input.lng,
        },
      });

      // Earnings are created ONCE per delivery (deliveryId is unique).
      const earning = await tx.riderEarning.create({
        data: {
          riderId,
          deliveryId: delivery.id,
          grossKobo: delivery.chargeKobo,
          commissionKobo,
          netKobo,
          status: 'PENDING',
          availableAt,
        },
      });

      await tx.rider.update({
        where: { id: riderId },
        // Free again the moment the job is done, so the next offer can arrive.
        data: { availability: 'ONLINE', completedCount: { increment: 1 } },
      });

      return { delivery: await tx.delivery.findUniqueOrThrow({
        where: { id: delivery.id },
        include: { statusHistory: { orderBy: { createdAt: 'asc' } }, earning: true },
      }), earning };
    });

    this.logger.log(
      `Delivery ${delivery.reference} completed by rider ${riderId} — rider earns ${formatNaira(netKobo)}`,
    );

    this.pushStatus(updated.delivery, riderId);
    // This rider is free again: anything still waiting for a rider deserves a
    // fresh attempt right now rather than on the next tick.
    void this.dispatch
      .offerWaitingDeliveries(10)
      .catch((error) => this.logger.warn(`Post-delivery dispatch sweep failed: ${(error as Error).message}`));

    return {
      ...this.toJob(updated.delivery),
      earning: {
        grossKobo: updated.earning.grossKobo.toString(),
        commissionKobo: updated.earning.commissionKobo.toString(),
        netKobo: updated.earning.netKobo.toString(),
        netFormatted: formatNaira(updated.earning.netKobo),
        availableAt: updated.earning.availableAt,
        status: updated.earning.status,
      },
    };
  }

  /** Report a problem: the rider cannot complete the job. */
  async fail(riderId: string, deliveryId: string, reason: string) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, riderId },
      select: { id: true, status: true },
    });
    if (!delivery) throw AppError.notFound('Delivery');

    if (!canTransition(delivery.status as DeliveryStatus, 'FAILED')) {
      throw AppError.conflict('This delivery cannot be marked as failed right now.', 'INVALID_STATUS_TRANSITION');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.delivery.update({
        where: { id: delivery.id },
        data: {
          status: 'FAILED',
          statusHistory: {
            create: {
              fromStatus: delivery.status,
              toStatus: 'FAILED',
              actorType: 'RIDER',
              reason,
            },
          },
        },
        include: { statusHistory: { orderBy: { createdAt: 'asc' } } },
      });
      await tx.rider.update({ where: { id: riderId }, data: { availability: 'ONLINE' } });
      return result;
    });

    this.pushStatus(updated, riderId);
    void this.dispatch
      .offerWaitingDeliveries(10)
      .catch((error) => this.logger.warn(`Post-failure dispatch sweep failed: ${(error as Error).message}`));

    return this.toJob(updated);
  }

  /**
   * One status change, three audiences: the customer watching their parcel, the
   * dispatch desk, and the rider's own other devices.
   */
  private pushStatus(
    delivery: { id: string; reference: string; status: string; customerId?: string },
    riderId: string,
  ): void {
    this.realtime.deliveryPush(
      {
        id: delivery.id,
        reference: delivery.reference,
        status: delivery.status,
        at: new Date().toISOString(),
      },
      { staff: true, customerId: delivery.customerId ?? null, riderIds: [riderId] },
    );
  }

  /** Shared projection: the rider app never sees internal ids it does not need. */
  private toJob(delivery: {
    id: string;
    reference: string;
    status: string;
    deliveryType: string;
    pickupAddress: string;
    pickupLandmark: string | null;
    pickupLat: number;
    pickupLng: number;
    destAddress: string;
    destLandmark: string | null;
    destLat: number;
    destLng: number;
    distanceKm: number | null;
    durationMinutes: number | null;
    recipientName: string;
    packageCategory: string;
    packageDescription: string;
    packageWeightKg: number | null;
    isFragile: boolean;
    specialInstructions: string | null;
    chargeKobo: bigint;
    commissionSnapshot: unknown;
    createdAt: Date;
    acceptedAt: Date | null;
    pickedUpAt: Date | null;
    deliveredAt: Date | null;
    statusHistory?: { toStatus: string; createdAt: Date; reason: string | null }[];
    earning?: { netKobo: bigint; status: string } | null;
  }) {
    const snapshot = delivery.commissionSnapshot as { commissionPct?: number; riderNetKobo?: string } | null;
    const commissionPct = snapshot?.commissionPct ?? this.config.commissionPercent;
    // Frozen at acceptance. Falls back to the live rate only for legacy rows that
    // were created before the snapshot existed.
    const net = snapshot?.riderNetKobo
      ? BigInt(snapshot.riderNetKobo)
      : delivery.chargeKobo - percentOfKobo(delivery.chargeKobo, commissionPct, 50);

    return {
      id: delivery.id,
      reference: delivery.reference,
      status: delivery.status,
      statusLabel: DELIVERY_STATUS_LABELS[delivery.status as DeliveryStatus] ?? delivery.status,
      deliveryType: delivery.deliveryType,
      pickup: { address: delivery.pickupAddress, landmark: delivery.pickupLandmark, lat: delivery.pickupLat, lng: delivery.pickupLng },
      destination: { address: delivery.destAddress, landmark: delivery.destLandmark, lat: delivery.destLat, lng: delivery.destLng },
      distanceKm: delivery.distanceKm,
      durationMinutes: delivery.durationMinutes,
      recipientName: delivery.recipientName,
      package: {
        category: delivery.packageCategory,
        description: delivery.packageDescription,
        weightKg: delivery.packageWeightKg,
        isFragile: delivery.isFragile,
        specialInstructions: delivery.specialInstructions,
      },
      pay: {
        chargeKobo: delivery.chargeKobo.toString(),
        commissionPct,
        netKobo: net.toString(),
        netFormatted: formatNaira(net),
      },
      createdAt: delivery.createdAt,
      acceptedAt: delivery.acceptedAt,
      pickedUpAt: delivery.pickedUpAt,
      deliveredAt: delivery.deliveredAt,
      timeline: delivery.statusHistory?.map((entry) => ({
        status: entry.toStatus,
        at: entry.createdAt,
        reason: entry.reason,
      })),
      earning: delivery.earning
        ? { netKobo: delivery.earning.netKobo.toString(), status: delivery.earning.status }
        : null,
    };
  }
}
