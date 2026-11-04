import { Injectable } from '@nestjs/common';
import { percentOfKobo, roundKobo } from '@dispatch/shared';
import { PrismaService } from '../infra/prisma/prisma.service';
import { AppError } from '../common/errors/app-error';

export interface PromoApplication {
  promotionId: string;
  code: string;
  type: 'PERCENT' | 'FIXED' | 'FREE_DELIVERY';
  /** Human-readable rule, e.g. "10% off, capped at ₦1,000". */
  description: string;
  discountKobo: bigint;
}

/**
 * PromotionService — decides whether a promo code is usable RIGHT NOW.
 *
 * Every rejection is explicit and user-facing, because "invalid promo" tells a
 * customer nothing. Caps that matter:
 *   • outside its start/end window        → PROMO_EXPIRED
 *   • global usage limit reached          → PROMO_EXHAUSTED
 *   • this customer already used it       → PROMO_ALREADY_USED
 *   • basket below the minimum            → PROMO_MIN_ORDER
 *
 * The discount is never allowed to exceed the subtotal, so a promo can make a
 * delivery free but can never make it negative.
 */
@Injectable()
export class PromotionsService {
  constructor(private readonly prisma: PrismaService) {}

  async validate(params: {
    code: string;
    subtotalKobo: bigint;
    customerId?: string;
  }): Promise<PromoApplication> {
    const code = params.code.trim().toUpperCase();
    const now = new Date();

    const promotion = await this.prisma.promotion.findUnique({ where: { code } });
    if (!promotion || !promotion.isActive) {
      throw AppError.validation([{ field: 'promoCode', message: 'That promo code is not valid' }]);
    }
    if (promotion.startsAt > now) {
      throw AppError.validation([{ field: 'promoCode', message: 'That promo code is not active yet' }]);
    }
    if (promotion.endsAt < now) {
      throw AppError.validation([{ field: 'promoCode', message: 'That promo code has expired' }]);
    }
    if (promotion.usageLimit !== null && promotion.usageCount >= promotion.usageLimit) {
      throw AppError.validation([
        { field: 'promoCode', message: 'That promo code has been fully redeemed' },
      ]);
    }
    if (
      promotion.minOrderKobo !== null &&
      params.subtotalKobo < promotion.minOrderKobo
    ) {
      const minimum = Number(promotion.minOrderKobo) / 100;
      throw AppError.validation([
        {
          field: 'promoCode',
          message: `That promo needs a delivery of at least ₦${minimum.toLocaleString('en-NG')}`,
        },
      ]);
    }

    // Per-customer limit can only be checked for a signed-in customer. During a
    // pre-login quote we surface the discount optimistically and re-check on create.
    if (params.customerId) {
      const used = await this.prisma.promoRedemption.count({
        where: { promotionId: promotion.id, customerId: params.customerId },
      });
      if (used >= promotion.perCustomerLimit) {
        throw AppError.validation([
          { field: 'promoCode', message: 'You have already used that promo code' },
        ]);
      }
    }

    const discountKobo = this.computeDiscount(promotion, params.subtotalKobo);

    return {
      promotionId: promotion.id,
      code: promotion.code,
      type: promotion.type,
      description: this.describe(promotion),
      discountKobo,
    };
  }

  private computeDiscount(
    promotion: { type: 'PERCENT' | 'FIXED' | 'FREE_DELIVERY'; value: number; maxDiscountKobo: bigint | null },
    subtotalKobo: bigint,
  ): bigint {
    if (promotion.type === 'FREE_DELIVERY') return subtotalKobo;

    let discount: bigint;
    if (promotion.type === 'PERCENT') {
      discount = percentOfKobo(subtotalKobo, promotion.value, 50);
    } else {
      discount = BigInt(promotion.value);
    }

    if (promotion.maxDiscountKobo !== null && discount > promotion.maxDiscountKobo) {
      discount = promotion.maxDiscountKobo;
    }
    // A promo can make a delivery free, never negative.
    return discount > subtotalKobo ? subtotalKobo : roundKobo(discount, 50);
  }

  private describe(promotion: {
    type: 'PERCENT' | 'FIXED' | 'FREE_DELIVERY';
    value: number;
    maxDiscountKobo: bigint | null;
  }): string {
    if (promotion.type === 'FREE_DELIVERY') return 'Free delivery';
    if (promotion.type === 'FIXED') return `₦${(promotion.value / 100).toLocaleString('en-NG')} off`;
    const cap =
      promotion.maxDiscountKobo !== null
        ? `, capped at ₦${(Number(promotion.maxDiscountKobo) / 100).toLocaleString('en-NG')}`
        : '';
    return `${promotion.value}% off${cap}`;
  }
}
