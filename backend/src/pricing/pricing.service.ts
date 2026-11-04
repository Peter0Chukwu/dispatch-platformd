import { Injectable } from '@nestjs/common';
import {
  DeliveryType,
  clampMin,
  roundKobo,
  type Kobo,
} from '@dispatch/shared';
import { PrismaService } from '../infra/prisma/prisma.service';
import { AppError } from '../common/errors/app-error';
import { MapsService } from './maps.service';
import { PromotionsService, type PromoApplication } from './promotions.service';
import { haversineKm, roundTo, type Point } from './distance';

/**
 * Anything beyond this from the nearest zone centre is outside the metro we
 * serve, and is rejected with a clear message instead of being quietly priced.
 * 60 km comfortably covers the Lagos mainland, island and Lekki corridor.
 */
export const MAX_SERVICE_DISTANCE_KM = 60;

/** One row of the price breakdown, ready to render in any portal. */
export interface QuoteLine {
  label: string;
  amountKobo: string;
  /** 'charge' adds to the total, 'discount' subtracts from it. */
  kind: 'charge' | 'discount';
  note?: string;
}

/**
 * The complete, reproducible price for a delivery.
 * Every number the customer sees comes from this object — the same object is
 * frozen onto the delivery row, so a price can always be explained later even
 * after the pricing rules change.
 */
export interface Quote {
  currency: 'NGN';
  deliveryType: DeliveryType;
  zone: { id: string; code: string; name: string } | null;
  rule: { id: string; name: string; version: number };
  distanceKm: number;
  chargeableKm: number;
  freeKmIncluded: number;
  durationMinutes: number;
  routeSource: 'STUB' | 'GOOGLE';
  additionalStops: number;
  subtotalKobo: string;
  discountKobo: string;
  totalKobo: string;
  promo: { promotionId: string; code: string; description: string; discountKobo: string } | null;
  lines: QuoteLine[];
  quotedAt: string;
}

export interface QuoteRequest {
  deliveryType: DeliveryType;
  pickup: Point;
  destination: Point;
  additionalStops?: number;
  scheduledFor?: Date;
  promoCode?: string;
  /** Present once a customer is signed in, so per-customer promo limits apply. */
  customerId?: string;
  branchId?: string;
}

@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly maps: MapsService,
    private readonly promotions: PromotionsService,
  ) {}

  /** The branch every booking belongs to until multi-branch routing exists. */
  async defaultBranchId(): Promise<string> {
    const branch = await this.prisma.branch.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!branch) throw AppError.notFound('Branch');
    return branch.id;
  }

  /**
   * Price a delivery. Pure calculation apart from two reads (zone + rule) and the
   * distance estimate — no writes, no side effects, so it is safe to call as often
   * as the customer drags a pin on the map.
   */
  async quote(request: QuoteRequest): Promise<Quote> {
    const branchId = request.branchId ?? (await this.defaultBranchId());
    const zone = await this.resolveZone(branchId, request.pickup, request.destination);
    const rule = await this.resolveRule(branchId, zone?.id ?? null);
    const route = await this.maps.estimateRoute(request.pickup, request.destination);

    const stops = Math.max(0, Math.min(3, request.additionalStops ?? 0));
    const freeKm = rule.freeKmIncluded;
    const chargeableKm = roundTo(Math.max(0, route.distanceKm - freeKm), 2);

    // ── Trip components ──────────────────────────────────────────────────────
    const baseFee = rule.baseFeeKobo;
    const distanceFee = BigInt(Math.round(chargeableKm * Number(rule.perKmFeeKobo)));
    const stopFee = rule.additionalStopFeeKobo * BigInt(stops);

    // The minimum fee protects the trip itself (base + distance + stops). Express
    // and scheduled surcharges are added AFTER the floor, so a minimum-fee trip is
    // never made more expensive by the floor and never cheaper by it either.
    const tripRaw = baseFee + distanceFee + stopFee;
    const tripFloor = clampMin(tripRaw, rule.minFeeKobo);

    const typeSurcharge = this.typeSurcharge(rule, request.deliveryType);
    const subtotalRaw = tripFloor + typeSurcharge;
    // Round once, on the number the customer actually pays attention to.
    const subtotal = roundKobo(subtotalRaw, rule.roundToKobo);

    // ── Promotion ────────────────────────────────────────────────────────────
    let promo: PromoApplication | null = null;
    if (request.promoCode) {
      promo = await this.promotions.validate({
        code: request.promoCode,
        subtotalKobo: subtotal,
        customerId: request.customerId,
      });
    }
    const discount = promo ? promo.discountKobo : 0n;
    const total = subtotal - discount < 0n ? 0n : subtotal - discount;

    return {
      currency: 'NGN',
      deliveryType: request.deliveryType,
      zone: zone ? { id: zone.id, code: zone.code, name: zone.name } : null,
      rule: { id: rule.id, name: rule.name, version: rule.version },
      distanceKm: route.distanceKm,
      chargeableKm,
      freeKmIncluded: freeKm,
      durationMinutes: route.durationMinutes,
      routeSource: route.source,
      additionalStops: stops,
      subtotalKobo: subtotal.toString(),
      discountKobo: discount.toString(),
      totalKobo: total.toString(),
      promo: promo
        ? {
            promotionId: promo.promotionId,
            code: promo.code,
            description: promo.description,
            discountKobo: discount.toString(),
          }
        : null,
      lines: this.buildLines({
        baseFee,
        distanceFee,
        chargeableKm,
        freeKm,
        stopFee,
        stops,
        tripFloorApplied: tripFloor !== tripRaw,
        typeSurcharge,
        deliveryType: request.deliveryType,
        subtotal,
        discount,
        promo,
        total,
      }),
      quotedAt: new Date().toISOString(),
    };
  }

  /**
   * Which zone the trip belongs to. The pickup decides: a rider has to reach the
   * pickup first, so the zone containing it is the one that sets the rules.
   * Falls back to the nearest centre, and rejects points far outside the metro.
   */
  private async resolveZone(branchId: string, pickup: Point, destination: Point) {
    const zones = await this.prisma.serviceZone.findMany({
      where: { branchId, isActive: true },
      select: { id: true, code: true, name: true, centerLat: true, centerLng: true, radiusKm: true },
    });
    if (zones.length === 0) return null;

    const measured = zones.map((zone) => ({
      zone,
      km: haversineKm(pickup, { lat: zone.centerLat, lng: zone.centerLng }),
    }));
    const nearest = measured.sort((a, b) => a.km - b.km)[0]!;

    if (nearest.km > MAX_SERVICE_DISTANCE_KM) {
      throw AppError.validation([
        {
          field: 'pickup',
          message: `We do not deliver from that location yet — it is ${Math.round(nearest.km)} km from our nearest service zone (${nearest.zone.name}).`,
        },
      ]);
    }
    const inside = measured.find((candidate) => candidate.km <= candidate.zone.radiusKm);
    if (inside) return inside.zone;
    // Between zones: price with the nearest one rather than refusing the booking.
    void destination;
    return nearest.zone;
  }

  /**
   * Rule precedence: zone override → branch rule → global rule.
   * Highest `version` wins among equals, so a new price list can be rolled out by
   * inserting v2 and deactivating v1 — no code deploy, no lost history.
   */
  private async resolveRule(branchId: string, zoneId: string | null) {
    const now = new Date();
    const base = { isActive: true, effectiveFrom: { lte: now } };

    if (zoneId) {
      const zoneRule = await this.prisma.pricingRule.findFirst({
        where: { ...base, serviceZoneId: zoneId },
        orderBy: { version: 'desc' },
      });
      if (zoneRule) return zoneRule;
    }
    const branchRule = await this.prisma.pricingRule.findFirst({
      where: { ...base, branchId, serviceZoneId: null },
      orderBy: { version: 'desc' },
    });
    if (branchRule) return branchRule;

    const globalRule = await this.prisma.pricingRule.findFirst({
      where: { ...base, branchId: null, serviceZoneId: null },
      orderBy: { version: 'desc' },
    });
    if (!globalRule) {
      throw AppError.conflict('No active pricing rule is configured — contact support', 'PRICING_UNAVAILABLE');
    }
    return globalRule;
  }

  private typeSurcharge(
    rule: { expressSurchargeKobo: Kobo; scheduledSurchargeKobo: Kobo; sameDaySurchargeKobo: Kobo },
    deliveryType: DeliveryType,
  ): Kobo {
    switch (deliveryType) {
      case DeliveryType.EXPRESS:
        return rule.expressSurchargeKobo;
      case DeliveryType.SCHEDULED:
        return rule.scheduledSurchargeKobo;
      case DeliveryType.SAME_DAY:
        return rule.sameDaySurchargeKobo;
      default:
        return 0n;
    }
  }

  /** Ordered lines for the UI — the customer sees exactly what makes up the price. */
  private buildLines(input: {
    baseFee: Kobo;
    distanceFee: Kobo;
    chargeableKm: number;
    freeKm: number;
    stopFee: Kobo;
    stops: number;
    tripFloorApplied: boolean;
    typeSurcharge: Kobo;
    deliveryType: DeliveryType;
    subtotal: Kobo;
    discount: Kobo;
    promo: PromoApplication | null;
    total: Kobo;
  }): QuoteLine[] {
    const lines: QuoteLine[] = [
      { label: 'Base fee', amountKobo: input.baseFee.toString(), kind: 'charge' },
      {
        label: `Distance — ${input.chargeableKm} km`,
        amountKobo: input.distanceFee.toString(),
        kind: 'charge',
        note:
          input.freeKm > 0
            ? `First ${input.freeKm} km included in the base fee`
            : undefined,
      },
    ];

    if (input.stops > 0) {
      lines.push({
        label: `Additional ${input.stops === 1 ? 'stop' : 'stops'}`,
        amountKobo: input.stopFee.toString(),
        kind: 'charge',
      });
    }
    if (input.tripFloorApplied) {
      lines.push({
        label: 'Minimum fee adjustment',
        amountKobo: '0',
        kind: 'charge',
        note: 'The minimum delivery fee applied to this trip',
      });
    }
    if (input.typeSurcharge > 0n) {
      lines.push({
        label: this.surchargeLabel(input.deliveryType),
        amountKobo: input.typeSurcharge.toString(),
        kind: 'charge',
      });
    }
    if (input.promo) {
      lines.push({
        label: `Promo ${input.promo.code}`,
        amountKobo: (-input.discount).toString(),
        kind: 'discount',
        note: input.promo.description,
      });
    }
    lines.push({ label: 'Total', amountKobo: input.total.toString(), kind: 'charge' });
    return lines;
  }

  private surchargeLabel(deliveryType: DeliveryType): string {
    switch (deliveryType) {
      case DeliveryType.EXPRESS:
        return 'Express surcharge';
      case DeliveryType.SAME_DAY:
        return 'Same-day surcharge';
      case DeliveryType.SCHEDULED:
        return 'Scheduled delivery surcharge';
      default:
        return 'Surcharge';
    }
  }
}
