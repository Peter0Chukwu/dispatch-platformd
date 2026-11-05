import { Injectable, Logger } from "@nestjs/common";
import { formatNaira } from "@dispatch/shared";
import { PrismaService } from "../infra/prisma/prisma.service";
import { AppError } from "../common/errors/app-error";
import { AuditService } from "../audit/audit.service";

/**
 * PRICING AND ZONES — the numbers that decide what a customer is charged.
 *
 * Editing a rule never rewrites history: existing deliveries keep the price
 * snapshot they were quoted, and the change only affects future quotes. Fees
 * are edited in naira and stored as integer kobo, so an operator can type
 * "1500" and the database gets 150000 with no floating-point drift.
 */
@Injectable()
export class AdminPricingService {
  private readonly logger = new Logger(AdminPricingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const [rules, zones] = await Promise.all([
      this.prisma.pricingRule.findMany({
        orderBy: [{ isActive: "desc" }, { version: "desc" }],
        include: {
          serviceZone: { select: { name: true } },
          branch: { select: { name: true } },
          creator: {
            select: { user: { select: { firstName: true, lastName: true } } },
          },
        },
      }),
      this.prisma.serviceZone.findMany({
        orderBy: { name: "asc" },
        include: { _count: { select: { deliveries: true } } },
      }),
    ]);

    return {
      rules: rules.map((rule) => ({
        id: rule.id,
        name: rule.name,
        version: rule.version,
        isActive: rule.isActive,
        scopeOf: rule.serviceZone?.name ?? rule.branch?.name ?? "Global",
        effectiveFrom: rule.effectiveFrom,
        baseFeeKobo: rule.baseFeeKobo.toString(),
        baseFeeFormatted: formatNaira(rule.baseFeeKobo),
        perKmFeeKobo: rule.perKmFeeKobo.toString(),
        perKmFeeFormatted: formatNaira(rule.perKmFeeKobo),
        minFeeKobo: rule.minFeeKobo.toString(),
        minFeeFormatted: formatNaira(rule.minFeeKobo),
        freeKmIncluded: rule.freeKmIncluded,
        expressSurchargeKobo: rule.expressSurchargeKobo.toString(),
        scheduledSurchargeKobo: rule.scheduledSurchargeKobo.toString(),
        sameDaySurchargeKobo: rule.sameDaySurchargeKobo.toString(),
        additionalStopFeeKobo: rule.additionalStopFeeKobo.toString(),
        defaultCommissionPct: rule.defaultCommissionPct,
        roundToKobo: rule.roundToKobo,
        createdBy: rule.creator
          ? `${rule.creator.user.firstName} ${rule.creator.user.lastName}`
          : null,
        updatedAt: rule.updatedAt,
      })),
      zones: zones.map((zone) => ({
        id: zone.id,
        name: zone.name,
        code: zone.code,
        centerLat: zone.centerLat,
        centerLng: zone.centerLng,
        radiusKm: zone.radiusKm,
        isActive: zone.isActive,
        deliveries: zone._count.deliveries,
      })),
    };
  }

  /**
   * Updates the editable fees on a rule.
   *
   * Money arrives in **naira** (what an operator types) and is converted to kobo
   * once, here. Negative fees are refused — a discount is a promotion, not a
   * negative base fee — and a commission above 100% is refused because it would
   * pay a rider less than nothing.
   */
  async updateRule(params: {
    ruleId: string;
    changes: {
      baseFeeNaira?: number;
      perKmFeeNaira?: number;
      minFeeNaira?: number;
      freeKmIncluded?: number;
      expressSurchargeNaira?: number;
      scheduledSurchargeNaira?: number;
      sameDaySurchargeNaira?: number;
      additionalStopFeeNaira?: number;
      defaultCommissionPct?: number;
      roundToKobo?: number;
      isActive?: boolean;
    };
    staffId: string;
    actorUserId?: string | null;
  }) {
    const rule = await this.prisma.pricingRule.findUnique({
      where: { id: params.ruleId },
    });
    if (!rule) throw AppError.notFound("Pricing rule not found");

    const nairaToKobo = (value: number) => BigInt(Math.round(value * 100));
    const data: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};

    const moneyFields: Array<[keyof typeof params.changes, string]> = [
      ["baseFeeNaira", "baseFeeKobo"],
      ["perKmFeeNaira", "perKmFeeKobo"],
      ["minFeeNaira", "minFeeKobo"],
      ["expressSurchargeNaira", "expressSurchargeKobo"],
      ["scheduledSurchargeNaira", "scheduledSurchargeKobo"],
      ["sameDaySurchargeNaira", "sameDaySurchargeKobo"],
      ["additionalStopFeeNaira", "additionalStopFeeKobo"],
    ];

    for (const [inputKey, column] of moneyFields) {
      const value = params.changes[inputKey] as number | undefined;
      if (value === undefined) continue;
      if (value < 0) {
        throw AppError.validation([
          { field: inputKey, message: "Fees cannot be negative" },
        ]);
      }
      data[column] = nairaToKobo(value);
      const previous = (rule as unknown as Record<string, bigint | undefined>)[
        column
      ];
      before[column] = previous === undefined ? null : previous.toString();
      after[column] = nairaToKobo(value).toString();
    }

    if (params.changes.freeKmIncluded !== undefined) {
      if (params.changes.freeKmIncluded < 0) {
        throw AppError.validation([
          {
            field: "freeKmIncluded",
            message: "Free kilometres cannot be negative",
          },
        ]);
      }
      data.freeKmIncluded = params.changes.freeKmIncluded;
      before.freeKmIncluded = rule.freeKmIncluded;
      after.freeKmIncluded = params.changes.freeKmIncluded;
    }

    if (params.changes.defaultCommissionPct !== undefined) {
      const pct = params.changes.defaultCommissionPct;
      if (pct < 0 || pct > 100) {
        throw AppError.validation([
          {
            field: "defaultCommissionPct",
            message: "Commission must be between 0 and 100%",
          },
        ]);
      }
      data.defaultCommissionPct = pct;
      before.defaultCommissionPct = rule.defaultCommissionPct;
      after.defaultCommissionPct = pct;
    }

    if (params.changes.roundToKobo !== undefined) {
      if (![1, 10, 50, 100].includes(params.changes.roundToKobo)) {
        throw AppError.validation([
          {
            field: "roundToKobo",
            message: "Rounding must be 1, 10, 50 or 100 kobo",
          },
        ]);
      }
      data.roundToKobo = params.changes.roundToKobo;
      before.roundToKobo = rule.roundToKobo;
      after.roundToKobo = params.changes.roundToKobo;
    }

    if (params.changes.isActive !== undefined) {
      data.isActive = params.changes.isActive;
      before.isActive = rule.isActive;
      after.isActive = params.changes.isActive;
    }

    if (Object.keys(data).length === 0) {
      throw AppError.validation([
        { field: "changes", message: "Nothing to update" },
      ]);
    }

    // A minimum above the base fee would make the "floor" meaningless; refuse the
    // combination rather than storing a rule that behaves unlike its label.
    const nextMin = (data.minFeeKobo as bigint | undefined) ?? rule.minFeeKobo;
    const nextBase =
      (data.baseFeeKobo as bigint | undefined) ?? rule.baseFeeKobo;
    if (nextMin < nextBase) {
      throw AppError.validation([
        {
          field: "minFeeNaira",
          message: "The minimum fee cannot be lower than the base fee",
        },
      ]);
    }

    const updated = await this.prisma.pricingRule.update({
      where: { id: rule.id },
      data: data as never,
    });

    await this.audit.record({
      actorUserId: params.actorUserId ?? null,
      actorRole: "STAFF",
      action: "pricing.rule.update",
      entityType: "PricingRule",
      entityId: rule.id,
      before,
      after: { ...after, staffId: params.staffId },
    });

    this.logger.log(
      `Pricing rule ${rule.name} updated by staff ${params.staffId}`,
    );

    return {
      id: updated.id,
      name: updated.name,
      isActive: updated.isActive,
      baseFeeFormatted: formatNaira(updated.baseFeeKobo),
      perKmFeeFormatted: formatNaira(updated.perKmFeeKobo),
      minFeeFormatted: formatNaira(updated.minFeeKobo),
      defaultCommissionPct: updated.defaultCommissionPct,
      roundToKobo: updated.roundToKobo,
      note: "Existing deliveries keep the price they were quoted; the change applies to new quotes.",
    };
  }
}
