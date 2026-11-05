import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../infra/prisma/prisma.service';
import { AppConfig } from '../config/app.config';
import { AppError } from '../common/errors/app-error';
import { MapsService } from '../pricing/maps.service';
import { RealtimeGateway, room } from '../realtime/realtime.gateway';
import { RT } from '../realtime/realtime.types';
import { DELIVERY_STATUS_LABELS, formatNaira, type DeliveryStatus } from '@dispatch/shared';

/** Statuses where a rider is physically moving for this delivery. */
const ACTIVE_STATUSES = ['ASSIGNED', 'ACCEPTED', 'ARRIVED_AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION'] as const;

interface Position {
  lat: number;
  lng: number;
  accuracyM: number | null;
  heading: number | null;
  speedKph: number | null;
  recordedAt: Date;
}

/**
 * LIVE TRACKING
 * ─────────────────────────────────────────────────────────────────────────────
 * What this service answers, for three different audiences:
 *
 *   · the customer   — where is my parcel, and when will it arrive?
 *   · a share viewer — the same, through a signed link with no account (Phase 8)
 *   · the dispatcher  — every live rider and job on one map
 *
 * Two rules shape all of it:
 *
 *   1. **A position is never invented.** If the rider's phone has not pinged, the
 *      payload says `stale: true` and reports when it last did. There is no
 *      interpolation, no "predicted" marker, and no moving dot without data.
 *   2. **Coordinates are scoped.** A customer sees the rider carrying *their*
 *      delivery; a share link sees the same and nothing else; the staff map needs
 *      `tracking:read`. Positions are read from `rider_locations`, which is written
 *      by the rider's own authenticated app.
 */
@Injectable()
export class TrackingService {
  private readonly logger = new Logger('Tracking');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly maps: MapsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * The rider reported a new position. Store it and tell whoever is watching.
   *
   * Called from the rider ping endpoint rather than the socket, because a ping must
   * persist even if the socket is down — the socket only decides how fast the map
   * updates, never whether the position exists.
   */
  async recordPing(
    riderId: string,
    input: {
      lat: number;
      lng: number;
      accuracyM?: number;
      speedKph?: number;
      heading?: number;
      batteryPct?: number;
      deliveryId?: string;
    },
  ) {
    // A ping belongs to a delivery only if that rider actually holds the job.
    let deliveryId: string | null = null;
    if (input.deliveryId) {
      const held = await this.prisma.delivery.findFirst({
        where: { id: input.deliveryId, riderId, status: { in: [...ACTIVE_STATUSES] } },
        select: { id: true, customer: { select: { userId: true } } },
      });
      deliveryId = held?.id ?? null;
    } else {
      const active = await this.prisma.delivery.findFirst({
        where: { riderId, status: { in: [...ACTIVE_STATUSES] } },
        select: { id: true, customer: { select: { userId: true } } },
        orderBy: { createdAt: 'desc' },
      });
      deliveryId = active?.id ?? null;
    }

    const location = await this.prisma.riderLocation.create({
      data: {
        riderId,
        deliveryId,
        lat: input.lat,
        lng: input.lng,
        accuracyM: input.accuracyM ?? null,
        speedKph: input.speedKph ?? null,
        heading: input.heading ?? null,
        batteryPct: input.batteryPct ?? null,
      },
    });

    if (deliveryId) {
      const delivery = await this.prisma.delivery.findUniqueOrThrow({
        where: { id: deliveryId },
        select: { id: true, status: true, customer: { select: { userId: true } } },
      });

      const payload = {
        deliveryId,
        riderId,
        lat: input.lat,
        lng: input.lng,
        heading: input.heading ?? null,
        speedKph: input.speedKph ?? null,
        accuracyM: input.accuracyM ?? null,
        status: delivery.status,
        at: location.recordedAt.toISOString(),
      };

      // The room is the authorisation: only the delivery's own customer, the rider,
      // and staff with tracking:read are in it.
      this.realtime.toDelivery(deliveryId, RT.TRACKING_PING, payload);
      this.realtime.toCustomer(delivery.customer.userId, RT.TRACKING_PING, payload);
      this.realtime.toStaff(RT.TRACKING_PING, payload);
    }

    return { recorded: true, deliveryId, at: location.recordedAt.toISOString() };
  }

  /** The customer's own tracking view. */
  async trackForCustomer(customerId: string, deliveryId: string) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, customerId },
      select: trackingSelect,
    });
    if (!delivery) throw AppError.notFound('Delivery');
    return this.buildTracking(delivery, { includeIdentity: true });
  }

  /** A signed share link: no account needed, expires, and can be rotated. */
  async createShareLink(customerId: string, deliveryId: string) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, customerId },
      select: { id: true, shareToken: true, shareTokenExpiresAt: true },
    });
    if (!delivery) throw AppError.notFound('Delivery');

    const ttlHours = await this.settingNumber('tracking.shareLinkTtlHours', 72);
    const token = delivery.shareToken ?? randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    await this.prisma.delivery.update({
      where: { id: delivery.id },
      data: { shareToken: token, shareTokenExpiresAt: expiresAt },
    });

    return {
      token,
      url: `${this.config.frontendUrl}/track/${token}`,
      expiresAt,
      ttlHours,
    };
  }

  /** Revoke a share link — the old URL stops working immediately. */
  async revokeShareLink(customerId: string, deliveryId: string) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, customerId },
      select: { id: true },
    });
    if (!delivery) throw AppError.notFound('Delivery');
    await this.prisma.delivery.update({
      where: { id: delivery.id },
      data: { shareToken: null, shareTokenExpiresAt: null },
    });
    return { revoked: true };
  }

  /**
   * PUBLIC tracking by token.
   *
   * Deliberately thin: the reference, the status, the rider's first name and the
   * live position. No phone numbers, no addresses' contacts, no customer identity.
   * Whoever holds the link can watch the parcel move — and nothing else.
   */
  async trackByToken(token: string) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { shareToken: token },
      select: { ...trackingSelect, shareTokenExpiresAt: true },
    });
    if (!delivery) throw AppError.notFound('Tracking link');
    if (delivery.shareTokenExpiresAt && delivery.shareTokenExpiresAt.getTime() < Date.now()) {
      throw AppError.conflict('This tracking link has expired.', 'CONFLICT');
    }

    const tracking = await this.buildTracking(delivery, { includeIdentity: false });
    return { ...tracking, shareExpiresAt: delivery.shareTokenExpiresAt };
  }

  /**
   * The dispatcher's map: every rider and every live job, in one payload.
   * Riders are only shown when their last ping is recent — an offline rider is not
   * drawn somewhere they were half an hour ago.
   */
  async liveMap() {
    const staleAfterMs = 10 * 60 * 1000;
    const since = new Date(Date.now() - staleAfterMs);

    const [riders, deliveries] = await Promise.all([
      this.prisma.rider.findMany({
        where: { availability: { in: ['ONLINE', 'ON_DELIVERY'] }, user: { status: 'ACTIVE' } },
        select: {
          id: true,
          riderCode: true,
          availability: true,
          user: { select: { firstName: true, lastName: true, phone: true } },
          locations: {
            orderBy: { recordedAt: 'desc' },
            take: 1,
            select: { lat: true, lng: true, heading: true, speedKph: true, recordedAt: true, batteryPct: true },
          },
          deliveries: {
            where: { status: { in: [...ACTIVE_STATUSES] } },
            select: { id: true, reference: true, status: true },
            take: 1,
          },
        },
      }),
      this.prisma.delivery.findMany({
        where: {
          status: { in: [...ACTIVE_STATUSES, 'PENDING'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true,
          reference: true,
          status: true,
          pickupAddress: true,
          destAddress: true,
          pickupLat: true,
          pickupLng: true,
          destLat: true,
          destLng: true,
          chargeKobo: true,
          createdAt: true,
          rider: {
            select: {
              id: true,
              riderCode: true,
              user: { select: { firstName: true, lastName: true } },
              locations: { orderBy: { recordedAt: 'desc' }, take: 1, select: { lat: true, lng: true, recordedAt: true } },
            },
          },
        },
      }),
    ]);

    const markers = riders
      .filter((rider) => rider.locations.length > 0)
      .map((rider) => {
        const last = rider.locations[0]!;
        return {
          riderId: rider.id,
          riderCode: rider.riderCode,
          name: `${rider.user.firstName} ${rider.user.lastName}`.trim(),
          phone: rider.user.phone,
          availability: rider.availability,
          lat: last.lat,
          lng: last.lng,
          heading: last.heading,
          speedKph: last.speedKph,
          batteryPct: last.batteryPct,
          recordedAt: last.recordedAt,
          /** Older than the freshness window: drawn hollow, never moved. */
          stale: last.recordedAt.getTime() < since.getTime(),
          activeDelivery: rider.deliveries[0] ?? null,
        };
      });

    return {
      generatedAt: new Date().toISOString(),
      freshnessWindowSeconds: staleAfterMs / 1000,
      summary: {
        onlineRiders: riders.filter((rider) => rider.availability === 'ONLINE').length,
        ridersOnDelivery: riders.filter((rider) => rider.availability === 'ON_DELIVERY').length,
        unassigned: deliveries.filter((delivery) => delivery.status === 'PENDING').length,
        activeDeliveries: deliveries.filter((delivery) => delivery.status !== 'PENDING').length,
        positioned: markers.length,
      },
      riders: markers,
      deliveries: deliveries.map((delivery) => ({
        id: delivery.id,
        reference: delivery.reference,
        status: delivery.status,
        pickup: { address: delivery.pickupAddress, lat: delivery.pickupLat, lng: delivery.pickupLng },
        destination: { address: delivery.destAddress, lat: delivery.destLat, lng: delivery.destLng },
        chargeFormatted: formatNaira(delivery.chargeKobo),
        rider: delivery.rider
          ? {
              id: delivery.rider.id,
              riderCode: delivery.rider.riderCode,
              name: `${delivery.rider.user.firstName} ${delivery.rider.user.lastName}`.trim(),
              position: delivery.rider.locations[0]
                ? {
                    lat: delivery.rider.locations[0].lat,
                    lng: delivery.rider.locations[0].lng,
                    recordedAt: delivery.rider.locations[0].recordedAt,
                  }
                : null,
            }
          : null,
        createdAt: delivery.createdAt,
      })),
      mapProvider: this.maps.provider,
    };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private async buildTracking(
    delivery: {
      id: string;
      reference: string;
      status: string;
      pickupAddress: string;
      destAddress: string;
      pickupLat: number;
      pickupLng: number;
      destLat: number;
      destLng: number;
      riderId: string | null;
      deliveredAt: Date | null;
      rider: { riderCode: string; user: { firstName: string; lastName: string } } | null;
      statusHistory: Array<{ toStatus: string; createdAt: Date; reason: string | null }>;
      locations: Array<{ lat: number; lng: number; accuracyM: number | null; heading: number | null; speedKph: number | null; recordedAt: Date }>;
    },
    options: { includeIdentity: boolean },
  ) {
    // Tracking stops at DELIVERED: once the parcel is in the recipient's hands the
    // rider's position is nobody else's business, so the map closes even though the
    // link keeps working to show the final status.
    const finished = delivery.status === 'DELIVERED' || delivery.status === 'CANCELLED';
    const latest: Position | null = finished ? null : (delivery.locations[0] ?? null);
    const freshnessMs = 2 * 60 * 1000;
    const stale = latest ? Date.now() - latest.recordedAt.getTime() > freshnessMs : false;
    // "Live" describes the job, not the data: a delivery that is underway is live
    // even before the rider's first ping. The absence of a position is reported
    // separately as `position: null`, never filled in with a guess.
    const live = !finished && (ACTIVE_STATUSES as readonly string[]).includes(delivery.status);

    // Where the rider is heading right now: the pickup until collection, the
    // recipient afterwards. The ETA is measured from the rider's actual position.
    const headingToPickup = ['ASSIGNED', 'ACCEPTED', 'ARRIVED_AT_PICKUP'].includes(delivery.status);
    const target = headingToPickup
      ? { lat: delivery.pickupLat, lng: delivery.pickupLng, label: 'pickup' as const }
      : { lat: delivery.destLat, lng: delivery.destLng, label: 'destination' as const };

    let etaMinutes: number | null = null;
    let distanceRemainingKm: number | null = null;
    let etaSource: string | null = null;
    if (live && latest) {
      const route = await this.maps.estimateRoute(
        { lat: latest.lat, lng: latest.lng },
        { lat: target.lat, lng: target.lng },
      );
      distanceRemainingKm = route.distanceKm;
      etaMinutes = route.durationMinutes;
      etaSource = route.source;
    }

    return {
      delivery: {
        id: delivery.id,
        reference: delivery.reference,
        status: delivery.status,
        statusLabel:
          DELIVERY_STATUS_LABELS[delivery.status as DeliveryStatus] ?? delivery.status.replace(/_/g, ' '),
        pickupAddress: delivery.pickupAddress,
        destAddress: delivery.destAddress,
        pickup: { lat: delivery.pickupLat, lng: delivery.pickupLng },
        destination: { lat: delivery.destLat, lng: delivery.destLng },
        deliveredAt: delivery.deliveredAt,
      },
      rider: delivery.rider
        ? {
            riderCode: delivery.rider.riderCode,
            // The share link gets a first name; the customer gets the full name.
            name: options.includeIdentity
              ? `${delivery.rider.user.firstName} ${delivery.rider.user.lastName}`.trim()
              : delivery.rider.user.firstName,
          }
        : null,
      position: latest
        ? {
            lat: latest.lat,
            lng: latest.lng,
            accuracyM: latest.accuracyM,
            heading: latest.heading,
            speedKph: latest.speedKph,
            recordedAt: latest.recordedAt,
            ageSeconds: Math.round((Date.now() - latest.recordedAt.getTime()) / 1000),
          }
        : null,
      live: Boolean(live),
      /** True when the last ping is older than the freshness window. */
      stale: Boolean(live && latest && stale),
      eta: etaMinutes === null ? null : { minutes: etaMinutes, distanceRemainingKm, source: etaSource, headingTo: target.label },
      timeline: delivery.statusHistory.map((entry) => ({
        status: entry.toStatus,
        label: DELIVERY_STATUS_LABELS[entry.toStatus as DeliveryStatus] ?? entry.toStatus,
        at: entry.createdAt,
        reason: entry.reason,
      })),
      mapProvider: this.maps.provider,
    };
  }

  private async settingNumber(key: string, fallback: number): Promise<number> {
    const setting = await this.prisma.systemSetting.findUnique({ where: { key } });
    const value = setting?.valueJson;
    return typeof value === 'number' ? value : fallback;
  }

  /** Room helper exposed so the controller can say what it subscribed to. */
  static deliveryRoom(deliveryId: string) {
    return room.delivery(deliveryId);
  }
}

/** One select shape used by every tracking reader, so they cannot drift apart. */
const trackingSelect = {
  id: true,
  reference: true,
  status: true,
  pickupAddress: true,
  destAddress: true,
  pickupLat: true,
  pickupLng: true,
  destLat: true,
  destLng: true,
  riderId: true,
  deliveredAt: true,
  shareTokenExpiresAt: true,
  rider: { select: { riderCode: true, user: { select: { firstName: true, lastName: true } } } },
  statusHistory: {
    orderBy: { createdAt: 'desc' as const },
    take: 20,
    select: { toStatus: true, createdAt: true, reason: true },
  },
  locations: {
    orderBy: { recordedAt: 'desc' as const },
    take: 1,
    select: { lat: true, lng: true, accuracyM: true, heading: true, speedKph: true, recordedAt: true },
  },
} as const;
