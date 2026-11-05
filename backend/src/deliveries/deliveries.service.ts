import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomInt } from 'node:crypto';
import {
  DeliveryStatus,
  canTransition,
  formatNaira,
  type CreateDeliveryInput,
  type QuoteDeliveryInput,
} from '@dispatch/shared';
import { Prisma, Prisma as PrismaNamespace } from '@prisma/client';
import { PrismaService } from '../infra/prisma/prisma.service';
import { AppError } from '../common/errors/app-error';
import { PricingService, type Quote } from '../pricing/pricing.service';
import { DispatchService } from '../dispatch/dispatch.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { RT } from '../realtime/realtime.types';

const hashOtp = (value: string) => createHash('sha256').update(value).digest('hex');

/** Human-friendly, unique, sortable: DSP-261104-7K2Q */
function buildReference(now = new Date()): string {
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 — read aloud on the phone
  let suffix = '';
  for (let i = 0; i < 4; i += 1) suffix += alphabet[randomInt(alphabet.length)];
  return `DSP-${yy}${mm}${dd}-${suffix}`;
}

/** The frozen price stored on the delivery row. Strings, because BigInt is not JSON. */
function toPriceSnapshot(quote: Quote) {
  return {
    currency: quote.currency,
    deliveryType: quote.deliveryType,
    zoneCode: quote.zone?.code ?? null,
    zoneName: quote.zone?.name ?? null,
    ruleId: quote.rule.id,
    ruleName: quote.rule.name,
    ruleVersion: quote.rule.version,
    distanceKm: quote.distanceKm,
    chargeableKm: quote.chargeableKm,
    freeKmIncluded: quote.freeKmIncluded,
    additionalStops: quote.additionalStops,
    routeSource: quote.routeSource,
    subtotalKobo: quote.subtotalKobo,
    discountKobo: quote.discountKobo,
    totalKobo: quote.totalKobo,
    promoCode: quote.promo?.code ?? null,
    lines: quote.lines,
    quotedAt: quote.quotedAt,
  };
}

/** What every portal receives for a delivery — one shape, no Prisma leakage. */
function toDeliveryDto(delivery: {
  id: string;
  reference: string;
  status: DeliveryStatus;
  paymentStatus: string;
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
  recipientPhone: string;
  packageCategory: string;
  packageDescription: string;
  packageWeightKg: number | null;
  isFragile: boolean;
  specialInstructions: string | null;
  scheduledFor: Date | null;
  chargeKobo: bigint;
  discountKobo: bigint;
  codAmountKobo: bigint;
  priceSnapshot: unknown;
  createdAt: Date;
  updatedAt: Date;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  statusHistory?: { toStatus: string; createdAt: Date; reason: string | null }[];
}) {
  return {
    id: delivery.id,
    reference: delivery.reference,
    status: delivery.status,
    paymentStatus: delivery.paymentStatus,
    deliveryType: delivery.deliveryType,
    pickup: {
      address: delivery.pickupAddress,
      landmark: delivery.pickupLandmark,
      lat: delivery.pickupLat,
      lng: delivery.pickupLng,
    },
    destination: {
      address: delivery.destAddress,
      landmark: delivery.destLandmark,
      lat: delivery.destLat,
      lng: delivery.destLng,
    },
    distanceKm: delivery.distanceKm,
    durationMinutes: delivery.durationMinutes,
    recipient: { name: delivery.recipientName, phone: delivery.recipientPhone },
    package: {
      category: delivery.packageCategory,
      description: delivery.packageDescription,
      weightKg: delivery.packageWeightKg,
      isFragile: delivery.isFragile,
      specialInstructions: delivery.specialInstructions,
    },
    scheduledFor: delivery.scheduledFor,
    chargeKobo: delivery.chargeKobo.toString(),
    discountKobo: delivery.discountKobo.toString(),
    codAmountKobo: delivery.codAmountKobo.toString(),
    chargeFormatted: formatNaira(delivery.chargeKobo),
    priceSnapshot: delivery.priceSnapshot,
    createdAt: delivery.createdAt,
    updatedAt: delivery.updatedAt,
    deliveredAt: delivery.deliveredAt,
    cancelledAt: delivery.cancelledAt,
    cancellationReason: delivery.cancellationReason,
    timeline: delivery.statusHistory?.map((entry) => ({
      status: entry.toStatus,
      at: entry.createdAt,
      reason: entry.reason,
    })),
  };
}

@Injectable()
export class DeliveriesService {
  private readonly logger = new Logger(DeliveriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly dispatch: DispatchService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** Price preview. No writes — safe to call on every pin drag. */
  async quote(customerId: string | undefined, input: QuoteDeliveryInput): Promise<Quote> {
    return this.pricing.quote({
      deliveryType: input.deliveryType,
      pickup: input.pickup,
      destination: input.destination,
      additionalStops: input.additionalStops,
      scheduledFor: input.scheduledFor,
      promoCode: input.promoCode,
      customerId,
    });
  }

  async create(
    customerId: string,
    input: CreateDeliveryInput,
  ): Promise<ReturnType<typeof toDeliveryDto>> {
    const quote = await this.pricing.quote({
      deliveryType: input.deliveryType,
      pickup: { lat: input.pickup.lat, lng: input.pickup.lng },
      destination: { lat: input.destination.lat, lng: input.destination.lng },
      scheduledFor: input.scheduledFor,
      promoCode: input.promoCode,
      customerId,
    });

    const branchId = await this.pricing.defaultBranchId();
    const snapshot = toPriceSnapshot(quote);
    // The completion OTP is generated now and locked away hashed; the rider types
    // it at the door in Phase 4. Never stored in plain text.
    const otp = String(randomInt(0, 1_000_000)).padStart(6, '0');

    const delivery = await this.prisma.$transaction(async (tx) => {
      let reference = buildReference();
      // Collision odds are ~1 in 1.6M per day; retry rather than fail a booking.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const clash = await tx.delivery.findUnique({ where: { reference }, select: { id: true } });
        if (!clash) break;
        reference = buildReference();
      }

      const created = await tx.delivery.create({
        data: {
          reference,
          customerId,
          branchId,
          serviceZoneId: quote.zone?.id ?? null,
          deliveryType: input.deliveryType,
          status: DeliveryStatus.PENDING,
          pickupAddress: input.pickup.address,
          pickupLandmark: input.pickup.landmark,
          pickupLat: input.pickup.lat,
          pickupLng: input.pickup.lng,
          destAddress: input.destination.address,
          destLandmark: input.destination.landmark,
          destLat: input.destination.lat,
          destLng: input.destination.lng,
          distanceKm: quote.distanceKm,
          durationMinutes: quote.durationMinutes,
          senderName: input.pickup.contactName,
          senderPhone: input.pickup.contactPhone,
          recipientName: input.destination.contactName,
          recipientPhone: input.destination.contactPhone,
          packageCategory: input.packageCategory,
          packageDescription: input.packageDescription,
          packageWeightKg: input.packageWeightKg,
          packagePhotoKey: input.packagePhotoKey,
          isFragile: input.isFragile,
          declaredValueKobo: input.declaredValueKobo,
          specialInstructions: input.specialInstructions,
          scheduledFor: input.scheduledFor,
          chargeKobo: BigInt(quote.totalKobo),
          discountKobo: BigInt(quote.discountKobo),
          codAmountKobo: input.codAmountKobo,
          priceSnapshot: snapshot as unknown as Prisma.InputJsonObject,
          otpHash: hashOtp(otp),
          otpExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          items: {
            create: {
              description: input.packageDescription,
              quantity: 1,
              weightKg: input.packageWeightKg,
              declaredValueKobo: input.declaredValueKobo,
            },
          },
          statusHistory: {
            create: {
              toStatus: DeliveryStatus.PENDING,
              actorType: 'CUSTOMER',
            },
          },
        },
      });

      // Redeem inside the same transaction: if the redemption fails, the delivery
      // does not exist either. A promo can never be used twice by accident.
      if (quote.promo) {
        await tx.promoRedemption.create({
          data: {
            promotionId: quote.promo.promotionId,
            customerId,
            deliveryId: created.id,
            discountKobo: BigInt(quote.discountKobo),
          },
        });
        await tx.promotion.update({
          where: { id: quote.promo.promotionId },
          data: { usageCount: { increment: 1 } },
        });
      }

      return tx.delivery.findUniqueOrThrow({
        where: { id: created.id },
        include: { statusHistory: { orderBy: { createdAt: 'asc' } } },
      });
    });

    this.logger.log(
      `Delivery ${delivery.reference} created for ${formatNaira(delivery.chargeKobo)} (${quote.distanceKm} km)`,
    );

    // The dispatch desk hears about it immediately, before any rider does.
    this.realtime.toStaff(RT.DELIVERY_NEW, {
      id: delivery.id,
      reference: delivery.reference,
      status: delivery.status,
      deliveryType: delivery.deliveryType,
      chargeFormatted: formatNaira(delivery.chargeKobo),
      at: new Date().toISOString(),
    });

    // Hand it to the offer engine immediately. A booking that silently sits
    // unassigned because dispatch threw would be the worst outcome for the
    // customer, so a dispatch failure is logged rather than thrown: the delivery
    // stays PENDING and the dispatch scheduler's next tick (and every rider coming
    // online) will keep trying until somebody takes it.
    try {
      const offers = await this.dispatch.offerDelivery(delivery.id);
      this.logger.log(`Delivery ${delivery.reference} offered to ${offers} rider(s)`);
    } catch (error) {
      this.logger.error(
        `Could not offer delivery ${delivery.reference}: ${(error as Error).message}`,
      );
    }

    return toDeliveryDto({ ...delivery, status: delivery.status as DeliveryStatus });
  }

  /**
   * Counters for the customer dashboard. Real aggregates, computed by Postgres —
   * the home screen must never show an invented number.
   */
  async summary(customerId: string) {
    const [total, byStatus, spend] = await Promise.all([
      this.prisma.delivery.count({ where: { customerId } }),
      this.prisma.delivery.groupBy({
        by: ['status'],
        where: { customerId },
        _count: { _all: true },
      }),
      this.prisma.delivery.aggregate({
        where: { customerId, status: { notIn: ['CANCELLED', 'REJECTED'] } },
        _sum: { chargeKobo: true, discountKobo: true },
      }),
    ]);

    const counts = Object.fromEntries(byStatus.map((row) => [row.status, row._count._all]));
    const active = ['PENDING', 'ASSIGNED', 'ACCEPTED', 'ARRIVED_AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION']
      .reduce((sum, status) => sum + (counts[status] ?? 0), 0);

    return {
      total,
      active,
      delivered: counts['DELIVERED'] ?? 0,
      cancelled: counts['CANCELLED'] ?? 0,
      pending: counts['PENDING'] ?? 0,
      spentKobo: (spend._sum.chargeKobo ?? 0n).toString(),
      savedKobo: (spend._sum.discountKobo ?? 0n).toString(),
    };
  }

  /** A customer's own deliveries, newest first. Always scoped — never global. */
  async listMine(
    customerId: string,
    params: { page?: number; perPage?: number; status?: DeliveryStatus },
  ) {
    const page = Math.max(1, params.page ?? 1);
    const perPage = Math.min(50, Math.max(1, params.perPage ?? 20));
    const where = { customerId, ...(params.status ? { status: params.status } : {}) };

    const [total, rows] = await Promise.all([
      this.prisma.delivery.count({ where }),
      this.prisma.delivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
    ]);

    return {
      items: rows.map((row) => toDeliveryDto({ ...row, status: row.status as DeliveryStatus })),
      page,
      perPage,
      total,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
    };
  }

  /**
   * One delivery, with its timeline.
   * Another customer's delivery is reported as NOT FOUND, not FORBIDDEN: a 403
   * would confirm the reference exists, which is exactly what an attacker probing
   * reference codes wants to learn.
   */
  async getMine(customerId: string, id: string) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id, customerId },
      include: { statusHistory: { orderBy: { createdAt: 'asc' } } },
    });
    if (!delivery) throw AppError.notFound('Delivery');
    return toDeliveryDto({ ...delivery, status: delivery.status as DeliveryStatus });
  }

  /** Staff list across every customer. Paginated; the permission gate is the guard. */
  async listAll(params: { page?: number; perPage?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const perPage = Math.min(100, Math.max(1, params.perPage ?? 25));
    const [total, rows] = await Promise.all([
      this.prisma.delivery.count(),
      this.prisma.delivery.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          customer: { select: { user: { select: { firstName: true, lastName: true } } } },
        },
      }),
    ]);
    return {
      items: rows.map((row) => ({
        ...toDeliveryDto({ ...row, status: row.status as DeliveryStatus }),
        customerName: `${row.customer.user.firstName} ${row.customer.user.lastName}`,
      })),
      page,
      perPage,
      total,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
    };
  }

  /** Staff read: no ownership filter, because the permission already gated it. */
  async getAny(id: string) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id },
      include: {
        statusHistory: { orderBy: { createdAt: 'asc' } },
        customer: { select: { user: { select: { firstName: true, lastName: true, phone: true } } } },
      },
    });
    if (!delivery) throw AppError.notFound('Delivery');
    return {
      ...toDeliveryDto({ ...delivery, status: delivery.status as DeliveryStatus }),
      customerName: `${delivery.customer.user.firstName} ${delivery.customer.user.lastName}`,
    };
  }

  /** Cancel before pickup. The state machine decides — not the UI, not the client. */
  async cancel(principal: { customerId: string; userId: string }, id: string, reason: string) {
    const { customerId } = principal;
    const delivery = await this.prisma.delivery.findFirst({
      where: { id, customerId },
      select: { id: true, status: true, reference: true, paymentStatus: true, chargeKobo: true },
    });
    if (!delivery) throw AppError.notFound('Delivery');

    if (!canTransition(delivery.status as DeliveryStatus, DeliveryStatus.CANCELLED)) {
      throw AppError.conflict(
        this.cancelBlockedMessage(delivery.status as DeliveryStatus),
        'DELIVERY_NOT_CANCELLABLE',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.delivery.update({
        where: { id: delivery.id },
        data: {
          status: DeliveryStatus.CANCELLED,
          cancelledAt: new Date(),
          cancellationReason: reason,
          cancelledBy: { connect: { id: principal.userId } },
          statusHistory: {
            create: {
              fromStatus: delivery.status,
              toStatus: DeliveryStatus.CANCELLED,
              actorType: 'CUSTOMER',
              reason,
            },
          },
        },
        include: { statusHistory: { orderBy: { createdAt: 'asc' } } },
      });

      // A paid delivery that is cancelled must be refunded. Refund execution lands
      // in Phase 7 with the payment providers; the flag below is what that job reads.
      if (delivery.paymentStatus === 'PAID') {
        this.logger.warn(
          `Delivery ${delivery.reference} was PAID and is now cancelled — refund owed (${formatNaira(delivery.chargeKobo)})`,
        );
      }
      return result;
    });

    return toDeliveryDto({ ...updated, status: updated.status as DeliveryStatus });
  }

  private cancelBlockedMessage(status: DeliveryStatus): string {
    switch (status) {
      case DeliveryStatus.PICKED_UP:
      case DeliveryStatus.IN_TRANSIT:
      case DeliveryStatus.ARRIVED_AT_DESTINATION:
        return 'This delivery is already on the way and can no longer be cancelled. Contact support if there is a problem.';
      case DeliveryStatus.DELIVERED:
        return 'This delivery has already been completed.';
      case DeliveryStatus.CANCELLED:
        return 'This delivery was already cancelled.';
      default:
        return `A delivery in status ${status} cannot be cancelled.`;
    }
  }
}
