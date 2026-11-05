import { Injectable, Logger } from "@nestjs/common";
import {
  ACTIVE_STATUSES,
  canTransition,
  formatNaira,
  percentOfKobo,
  type DeliveryStatus,
} from "@dispatch/shared";
import { PrismaService } from "../infra/prisma/prisma.service";
import { AppConfig } from "../config/app.config";
import { AppError } from "../common/errors/app-error";
import { AuditService } from "../audit/audit.service";

/**
 * STAFF DELIVERY MANAGEMENT
 *
 * The offer engine runs itself, but dispatchers need a manual override: a rider
 * who is offline, a job nobody accepted, a delivery that must be moved to
 * somebody else. Everything here is that override — and every override is
 * recorded with who did it and why.
 */
@Injectable()
export class AdminDeliveriesService {
  private readonly logger = new Logger(AdminDeliveriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {}

  /** Filterable, paginated delivery list for the ops table. */
  async list(params: {
    status?: string;
    q?: string;
    riderId?: string;
    from?: Date;
    to?: Date;
    page: number;
    perPage: number;
  }) {
    const where = {
      ...(params.status ? { status: params.status as never } : {}),
      ...(params.riderId ? { riderId: params.riderId } : {}),
      ...(params.from || params.to
        ? {
            createdAt: {
              ...(params.from ? { gte: params.from } : {}),
              ...(params.to ? { lte: params.to } : {}),
            },
          }
        : {}),
      ...(params.q
        ? {
            OR: [
              {
                reference: { contains: params.q, mode: "insensitive" as const },
              },
              {
                recipientName: {
                  contains: params.q,
                  mode: "insensitive" as const,
                },
              },
              {
                pickupAddress: {
                  contains: params.q,
                  mode: "insensitive" as const,
                },
              },
              {
                destAddress: {
                  contains: params.q,
                  mode: "insensitive" as const,
                },
              },
              {
                customer: {
                  user: {
                    firstName: {
                      contains: params.q,
                      mode: "insensitive" as const,
                    },
                  },
                },
              },
              {
                customer: {
                  user: {
                    lastName: {
                      contains: params.q,
                      mode: "insensitive" as const,
                    },
                  },
                },
              },
              {
                rider: {
                  riderCode: {
                    contains: params.q,
                    mode: "insensitive" as const,
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.delivery.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (params.page - 1) * params.perPage,
        take: params.perPage,
        select: {
          id: true,
          reference: true,
          status: true,
          chargeKobo: true,
          deliveryType: true,
          createdAt: true,
          deliveredAt: true,
          pickupAddress: true,
          destAddress: true,
          recipientName: true,
          distanceKm: true,
          customer: {
            select: {
              user: {
                select: { firstName: true, lastName: true, phone: true },
              },
            },
          },
          rider: {
            select: {
              id: true,
              riderCode: true,
              user: { select: { firstName: true, lastName: true } },
            },
          },
          serviceZone: { select: { name: true } },
        },
      }),
      this.prisma.delivery.count({ where }),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        reference: row.reference,
        status: row.status,
        deliveryType: row.deliveryType,
        chargeKobo: row.chargeKobo.toString(),
        chargeFormatted: formatNaira(row.chargeKobo),
        customer: `${row.customer.user.firstName} ${row.customer.user.lastName}`,
        customerPhone: row.customer.user.phone,
        rider: row.rider
          ? {
              id: row.rider.id,
              code: row.rider.riderCode,
              name: `${row.rider.user.firstName} ${row.rider.user.lastName}`,
            }
          : null,
        pickup: row.pickupAddress,
        destination: row.destAddress,
        recipientName: row.recipientName,
        zone: row.serviceZone?.name ?? null,
        distanceKm: row.distanceKm,
        createdAt: row.createdAt,
        deliveredAt: row.deliveredAt,
      })),
      meta: {
        page: params.page,
        pageSize: params.perPage,
        total,
        totalPages: Math.max(1, Math.ceil(total / params.perPage)),
      },
    };
  }

  /** One delivery with everything support needs: assignments, history and proof. */
  async detail(id: string) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            id: true,
            userId: true,
            user: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
                status: true,
              },
            },
          },
        },
        rider: {
          select: {
            id: true,
            riderCode: true,
            availability: true,
            user: { select: { firstName: true, lastName: true, phone: true } },
          },
        },
        serviceZone: { select: { name: true } },
        statusHistory: { orderBy: { createdAt: "asc" } },
        assignments: {
          orderBy: { createdAt: "desc" },
          include: {
            rider: {
              select: {
                riderCode: true,
                user: { select: { firstName: true, lastName: true } },
              },
            },
          },
        },
        proofs: { orderBy: { capturedAt: "desc" }, take: 1 },
      },
    });
    if (!delivery) throw AppError.notFound("Delivery not found");

    return {
      id: delivery.id,
      reference: delivery.reference,
      status: delivery.status,
      deliveryType: delivery.deliveryType,
      paymentStatus: delivery.paymentStatus,
      chargeKobo: delivery.chargeKobo.toString(),
      chargeFormatted: formatNaira(delivery.chargeKobo),
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
      recipient: {
        name: delivery.recipientName,
        phone: delivery.recipientPhone,
      },
      package: {
        category: delivery.packageCategory,
        description: delivery.packageDescription,
        weightKg: delivery.packageWeightKg,
        isFragile: delivery.isFragile,
        instructions: delivery.specialInstructions,
      },
      zone: delivery.serviceZone?.name ?? null,
      distanceKm: delivery.distanceKm,
      priceSnapshot: delivery.priceSnapshot,
      commissionSnapshot: delivery.commissionSnapshot,
      customer: delivery.customer
        ? {
            id: delivery.customer.id,
            name: `${delivery.customer.user.firstName} ${delivery.customer.user.lastName}`,
            email: delivery.customer.user.email,
            phone: delivery.customer.user.phone,
            accountStatus: delivery.customer.user.status,
          }
        : null,
      rider: delivery.rider
        ? {
            id: delivery.rider.id,
            code: delivery.rider.riderCode,
            name: `${delivery.rider.user.firstName} ${delivery.rider.user.lastName}`,
            phone: delivery.rider.user.phone,
            availability: delivery.rider.availability,
          }
        : null,
      assignments: delivery.assignments.map((row) => ({
        id: row.id,
        riderCode: row.rider.riderCode,
        riderName: `${row.rider.user.firstName} ${row.rider.user.lastName}`,
        status: row.status,
        method: row.method,
        rank: row.rank,
        offeredAt: row.offeredAt,
        expiresAt: row.expiresAt,
        respondedAt: row.respondedAt,
        rejectionReason: row.rejectionReason,
      })),
      timeline: delivery.statusHistory.map((entry) => ({
        status: entry.toStatus,
        from: entry.fromStatus,
        at: entry.createdAt,
        reason: entry.reason,
        by: entry.actorType,
      })),
      proof: delivery.proofs[0]
        ? {
            type: delivery.proofs[0].type,
            fileKey: delivery.proofs[0].fileKey,
            recipientName: delivery.proofs[0].recipientNameEntered,
            otpVerifiedAt: delivery.proofs[0].otpVerifiedAt,
            capturedAt: delivery.proofs[0].capturedAt,
          }
        : null,
      createdAt: delivery.createdAt,
      acceptedAt: delivery.acceptedAt,
      pickedUpAt: delivery.pickedUpAt,
      deliveredAt: delivery.deliveredAt,
      cancelledAt: delivery.cancelledAt,
      cancellationReason: delivery.cancellationReason,
    };
  }

  /**
   * Assign (or reassign) a delivery to a rider by hand.
   *
   * The delivery becomes ASSIGNED — not ACCEPTED — because a staff assignment is
   * a proposal the rider still has to pick up. The rider's own workflow starts
   * from ASSIGNED, so the app shows them the job without a second button.
   */
  async assign(params: {
    deliveryId: string;
    riderId: string;
    staffId: string;
    reason?: string;
    actorUserId?: string | null;
  }) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: params.deliveryId },
      select: {
        id: true,
        reference: true,
        status: true,
        riderId: true,
        chargeKobo: true,
        commissionSnapshot: true,
      },
    });
    if (!delivery) throw AppError.notFound("Delivery not found");

    if (["DELIVERED", "FAILED", "CANCELLED"].includes(delivery.status)) {
      throw AppError.conflict(
        `A ${delivery.status.toLowerCase()} delivery cannot be assigned.`,
        "INVALID_STATUS_TRANSITION",
      );
    }
    if (delivery.riderId === params.riderId) {
      throw AppError.conflict(
        "That rider already has this delivery.",
        "DUPLICATE_REQUEST",
      );
    }

    const rider = await this.prisma.rider.findUnique({
      where: { id: params.riderId },
      include: {
        user: { select: { status: true } },
        _count: {
          select: {
            deliveries: {
              where: { status: { in: ACTIVE_STATUSES as unknown as never[] } },
            },
          },
        },
      },
    });
    if (!rider) throw AppError.notFound("Rider not found");
    if (rider.approvalStatus !== "APPROVED") {
      throw AppError.conflict(
        "That rider is not approved yet, so they cannot take deliveries.",
        "RIDER_NOT_APPROVED",
      );
    }
    if (rider.user.status !== "ACTIVE") {
      throw AppError.conflict(
        "That rider’s account is not active.",
        "RIDER_INACTIVE",
      );
    }
    if (rider._count.deliveries >= this.config.maxActivePerRider) {
      throw AppError.conflict(
        `That rider already has ${rider._count.deliveries} active deliveries (limit ${this.config.maxActivePerRider}).`,
        "RIDER_BUSY",
      );
    }

    const previousRiderId = delivery.riderId;
    const commissionPct =
      rider.commissionRatePct ?? this.config.commissionPercent;
    const commissionKobo = percentOfKobo(
      delivery.chargeKobo,
      commissionPct,
      50,
    );

    const result = await this.prisma.$transaction(async (tx) => {
      // Any live offer for this delivery becomes moot the moment a human decides.
      await tx.deliveryAssignment.updateMany({
        where: { deliveryId: delivery.id, status: "OFFERED" },
        data: { status: "EXPIRED", respondedAt: new Date() },
      });

      const updated = await tx.delivery.update({
        where: { id: delivery.id },
        data: {
          riderId: rider.id,
          status: "ASSIGNED",
          acceptedAt: null,
          // The commission is frozen to whoever ends up carrying it.
          commissionSnapshot: {
            commissionPct,
            commissionKobo: commissionKobo.toString(),
            riderNetKobo: (delivery.chargeKobo - commissionKobo).toString(),
            assignedBy: "STAFF",
          },
        },
      });

      await tx.deliveryAssignment.create({
        data: {
          deliveryId: delivery.id,
          riderId: rider.id,
          status: "ACCEPTED",
          method: "MANUAL",
          respondedAt: new Date(),
          assignedById: params.staffId,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });

      await tx.deliveryStatusHistory.create({
        data: {
          deliveryId: delivery.id,
          fromStatus: delivery.status as DeliveryStatus,
          toStatus: "ASSIGNED",
          actorType: "STAFF",
          reason: params.reason ?? "Assigned by dispatch",
        },
      });

      await tx.rider.update({
        where: { id: rider.id },
        data: { availability: "ON_DELIVERY" },
      });

      // Free the rider who lost the job, if they were only holding this one.
      if (previousRiderId && previousRiderId !== rider.id) {
        const remaining = await tx.delivery.count({
          where: {
            riderId: previousRiderId,
            id: { not: delivery.id },
            status: { in: ACTIVE_STATUSES as unknown as never[] },
          },
        });
        if (remaining === 0) {
          await tx.rider.update({
            where: { id: previousRiderId },
            data: { availability: "ONLINE" },
          });
        }
      }

      return updated;
    });

    await this.audit.record({
      actorUserId: params.actorUserId ?? null,
      actorRole: "STAFF",
      action: previousRiderId ? "delivery.reassign" : "delivery.assign",
      entityType: "Delivery",
      entityId: delivery.id,
      before: { riderId: previousRiderId, status: delivery.status },
      after: {
        riderId: rider.id,
        status: result.status,
        reason: params.reason ?? null,
        staffId: params.staffId,
      },
    });

    this.logger.log(
      `Staff ${params.staffId} assigned ${delivery.reference} to ${rider.riderCode}${previousRiderId ? " (reassignment)" : ""}`,
    );

    return {
      id: result.id,
      reference: result.reference,
      status: result.status,
      rider: { id: rider.id, code: rider.riderCode },
      reassignedFrom: previousRiderId,
      commissionPct,
      riderNetFormatted: formatNaira(delivery.chargeKobo - commissionKobo),
    };
  }

  /** Staff cancellation. Refunds are a Phase 7 concern; the record is kept here. */
  async cancel(params: {
    deliveryId: string;
    reason: string;
    staffId: string;
    actorUserId?: string | null;
  }) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: params.deliveryId },
      select: { id: true, reference: true, status: true, riderId: true },
    });
    if (!delivery) throw AppError.notFound("Delivery not found");

    if (!canTransition(delivery.status as DeliveryStatus, "CANCELLED")) {
      throw AppError.conflict(
        `A ${delivery.status.toLowerCase()} delivery can no longer be cancelled.`,
        "DELIVERY_NOT_CANCELLABLE",
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.delivery.update({
        where: { id: delivery.id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancellationReason: params.reason,
        },
      });
      await tx.deliveryStatusHistory.create({
        data: {
          deliveryId: delivery.id,
          fromStatus: delivery.status as DeliveryStatus,
          toStatus: "CANCELLED",
          actorType: "STAFF",
          reason: params.reason,
        },
      });
      await tx.deliveryAssignment.updateMany({
        where: {
          deliveryId: delivery.id,
          status: { in: ["OFFERED", "ACCEPTED"] },
        },
        data: { status: "CANCELLED", respondedAt: new Date() },
      });
      if (delivery.riderId) {
        await tx.rider.update({
          where: { id: delivery.riderId },
          data: { availability: "ONLINE" },
        });
      }
      return row;
    });

    await this.audit.record({
      actorUserId: params.actorUserId ?? null,
      actorRole: "STAFF",
      action: "delivery.cancel",
      entityType: "Delivery",
      entityId: delivery.id,
      before: { status: delivery.status },
      after: {
        status: updated.status,
        reason: params.reason,
        staffId: params.staffId,
      },
    });

    return {
      id: updated.id,
      reference: updated.reference,
      status: updated.status,
      reason: updated.cancellationReason,
    };
  }

  /**
   * CSV export of the current filter.
   *
   * Capped so one click cannot stream the entire table into memory or into a
   * dispatcher's spreadsheet by accident.
   */
  async exportCsv(params: {
    status?: string;
    q?: string;
    from?: Date;
    to?: Date;
    limit?: number;
  }) {
    const take = Math.min(params.limit ?? 5000, 10_000);
    const page = await this.list({ ...params, page: 1, perPage: take });

    const header = [
      "reference",
      "status",
      "created_at",
      "delivered_at",
      "customer",
      "customer_phone",
      "rider_code",
      "zone",
      "pickup",
      "destination",
      "recipient",
      "distance_km",
      "charge_kobo",
      "charge_ngn",
    ];

    const escape = (value: unknown) => {
      const text = value === null || value === undefined ? "" : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };

    const lines = page.data.map((row) =>
      [
        row.reference,
        row.status,
        row.createdAt.toISOString(),
        row.deliveredAt?.toISOString() ?? "",
        row.customer,
        row.customerPhone ?? "",
        row.rider?.code ?? "",
        row.zone ?? "",
        row.pickup,
        row.destination,
        row.recipientName,
        row.distanceKm ?? "",
        row.chargeKobo,
        (Number(row.chargeKobo) / 100).toFixed(2),
      ]
        .map(escape)
        .join(","),
    );

    return {
      csv: [header.join(","), ...lines].join("\n"),
      rows: page.data.length,
      total: page.meta.total,
    };
  }
}
