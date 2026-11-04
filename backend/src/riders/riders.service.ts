import { Injectable, Logger } from '@nestjs/common';
import { formatNaira, nairaToKobo } from '@dispatch/shared';
import { PrismaService } from '../infra/prisma/prisma.service';
import { AppError } from '../common/errors/app-error';
import { StorageService } from '../storage/storage.service';
import { DispatchService } from '../dispatch/dispatch.service';

/** Documents a rider must have approved before they may go online. */
export const REQUIRED_DOCUMENTS = ['NIN', 'DRIVERS_LICENCE', 'VEHICLE_REGISTRATION'] as const;

/** A rider who has not sent a location ping for this long is not dispatchable. */
export const LOCATION_STALE_MINUTES = 10;

/**
 * Rider self-service: profile, availability, documents and location pings.
 *
 * The rule this class enforces: a rider cannot go ONLINE until an administrator has
 * APPROVED their account and their required documents, and cannot keep a location
 * we cannot trust. Everything else in the platform depends on that being true.
 */
@Injectable()
export class RidersService {
  private readonly logger = new Logger(RidersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly dispatch: DispatchService,
  ) {}

  async profile(riderId: string) {
    const rider = await this.prisma.rider.findUnique({
      where: { id: riderId },
      include: {
        user: { select: { firstName: true, lastName: true, email: true, phone: true, status: true, avatarKey: true } },
        branch: { select: { code: true, name: true, city: true } },
        serviceZone: { select: { code: true, name: true } },
        vehicles: { where: { isActive: true }, orderBy: { createdAt: 'desc' }, take: 1 },
        documents: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!rider) throw AppError.notFound('Rider');

    const [earnings] = await Promise.all([this.earningsSummary(riderId)]);
    const approvedTypes = new Set(
      rider.documents.filter((doc) => doc.status === 'APPROVED').map((doc) => doc.docType),
    );
    const missingDocuments = REQUIRED_DOCUMENTS.filter((type) => !approvedTypes.has(type));

    return {
      id: rider.id,
      riderCode: rider.riderCode,
      approvalStatus: rider.approvalStatus,
      availability: rider.availability,
      rating: { average: rider.ratingAvg, count: rider.ratingCount },
      completedCount: rider.completedCount,
      cancelledCount: rider.cancelledCount,
      user: rider.user,
      branch: rider.branch,
      serviceZone: rider.serviceZone,
      vehicle: rider.vehicles[0]
        ? {
            type: rider.vehicles[0].type,
            registrationNumber: rider.vehicles[0].registrationNumber,
            isVerified: rider.vehicles[0].isVerified,
          }
        : null,
      documents: rider.documents.map((doc) => ({
        id: doc.id,
        type: doc.docType,
        status: doc.status,
        reviewNote: doc.reviewNote,
        uploadedAt: doc.createdAt,
        expiresAt: doc.expiresAt,
      })),
      requiredDocuments: REQUIRED_DOCUMENTS,
      missingDocuments,
      canGoOnline:
        rider.approvalStatus === 'APPROVED' &&
        missingDocuments.length === 0 &&
        rider.user.status === 'ACTIVE',
      earnings,
    };
  }

  /**
   * Go ONLINE or OFFLINE.
   *
   * Refusals are specific, because "you cannot go online" with no reason is the
   * single most frustrating thing a rider app can say.
   */
  async setAvailability(riderId: string, next: 'ONLINE' | 'OFFLINE') {
    const rider = await this.prisma.rider.findUniqueOrThrow({
      where: { id: riderId },
      include: { user: { select: { status: true } }, documents: true },
    });

    if (next === 'OFFLINE') {
      if (rider.availability === 'ON_DELIVERY') {
        throw AppError.conflict(
          'Finish or hand over your current delivery before going offline.',
          'RIDER_BUSY',
        );
      }
      const updated = await this.prisma.rider.update({
        where: { id: riderId },
        data: { availability: 'OFFLINE' },
      });
      return { availability: updated.availability };
    }

    // Going online has preconditions.
    if (rider.approvalStatus !== 'APPROVED') {
      throw AppError.forbidden(
        rider.approvalStatus === 'PENDING'
          ? 'Your account is still being reviewed. We will notify you once it is approved.'
          : `Your account is ${rider.approvalStatus.toLowerCase()} and cannot accept deliveries.`,
      );
    }
    if (rider.user.status !== 'ACTIVE') {
      throw AppError.forbidden('Your account is not active. Contact support.');
    }
    const approved = new Set(
      rider.documents.filter((doc) => doc.status === 'APPROVED').map((doc) => doc.docType),
    );
    const missing = REQUIRED_DOCUMENTS.filter((type) => !approved.has(type));
    if (missing.length > 0) {
      throw AppError.conflict(
        `Upload and get approval for: ${missing.map((m) => m.replace(/_/g, ' ').toLowerCase()).join(', ')}.`,
        'DOCUMENTS_INCOMPLETE',
      );
    }
    if (rider.availability === 'ON_DELIVERY') {
      return { availability: 'ON_DELIVERY' };
    }

    const updated = await this.prisma.rider.update({
      where: { id: riderId },
      data: { availability: 'ONLINE', lastOnlineAt: new Date() },
    });

    // Coming online is a capacity event: any paid booking that has been waiting for
    // a rider gets offered now. A failure here must not stop the rider going online —
    // they can still work, and the next rider online (or the sweep) will retry.
    let waitingOffers = 0;
    try {
      const sweep = await this.dispatch.offerWaitingDeliveries();
      waitingOffers = sweep.offered;
    } catch (error) {
      this.logger.error(`Could not offer waiting deliveries: ${(error as Error).message}`);
    }

    return { availability: updated.availability, waitingOffers };
  }

  /** Upload (or replace) a document. Re-uploading resets it to PENDING for review. */
  async uploadDocument(
    riderId: string,
    input: { docType: string; mimeType: string; base64: string; expiresAt?: Date },
  ) {
    const allowed = ['NIN', 'DRIVERS_LICENCE', 'VEHICLE_REGISTRATION', 'PROOF_OF_ADDRESS', 'GUARANTOR_FORM', 'SELFIE'];
    if (!allowed.includes(input.docType)) {
      throw AppError.validation([{ field: 'docType', message: 'Choose a document type' }]);
    }

    const stored = await this.storage.saveBase64({
      keyPrefix: `riders/${riderId}/documents`,
      fileName: input.docType,
      mimeType: input.mimeType,
      base64: input.base64,
    });

    // One current document per type: the newest upload replaces the old row.
    const existing = await this.prisma.riderDocument.findFirst({
      where: { riderId, docType: input.docType as never },
      orderBy: { createdAt: 'desc' },
    });

    const document = existing
      ? await this.prisma.riderDocument.update({
          where: { id: existing.id },
          data: {
            fileKey: stored.key,
            mimeType: input.mimeType,
            sizeBytes: stored.sizeBytes,
            status: 'PENDING',
            reviewNote: null,
            reviewedAt: null,
            reviewedById: null,
            expiresAt: input.expiresAt ?? null,
          },
        })
      : await this.prisma.riderDocument.create({
          data: {
            riderId,
            docType: input.docType as never,
            fileKey: stored.key,
            mimeType: input.mimeType,
            sizeBytes: stored.sizeBytes,
            expiresAt: input.expiresAt ?? null,
          },
        });

    this.logger.log(`Rider ${riderId} uploaded ${input.docType} (${stored.sizeBytes} bytes)`);
    return { id: document.id, type: document.docType, status: document.status };
  }

  /**
   * Location ping. Stored as a time series, never overwritten — Phase 8 replays it
   * to draw the trip, and retention is bounded by LOCATION_RETENTION_DAYS.
   */
  async ping(
    riderId: string,
    input: { lat: number; lng: number; accuracyM?: number; speedKph?: number; heading?: number; batteryPct?: number; deliveryId?: string },
  ) {
    await this.prisma.riderLocation.create({
      data: {
        riderId,
        lat: input.lat,
        lng: input.lng,
        accuracyM: input.accuracyM,
        speedKph: input.speedKph,
        heading: input.heading,
        batteryPct: input.batteryPct,
        deliveryId: input.deliveryId,
      },
    });
    return { recorded: true, at: new Date().toISOString() };
  }

  /** Earnings totals: everything a rider has earned, and what is withdrawable now. */
  async earningsSummary(riderId: string) {
    const [byStatus, adjustmentTotals, withdrawalTotals] = await Promise.all([
      this.prisma.riderEarning.groupBy({
        by: ['status'],
        where: { riderId },
        _sum: { netKobo: true, grossKobo: true, commissionKobo: true },
        _count: { _all: true },
      }),
      this.prisma.riderAdjustment.aggregate({ where: { riderId }, _sum: { amountKobo: true } }),
      this.prisma.withdrawal.aggregate({
        where: { riderId, status: { in: ['REQUESTED', 'APPROVED', 'PROCESSING', 'PAID'] } },
        _sum: { amountKobo: true },
      }),
    ]);

    const sumFor = (statuses: string[], field: 'netKobo' | 'grossKobo' | 'commissionKobo'): bigint =>
      byStatus
        .filter((row) => statuses.includes(row.status))
        .reduce((total, row) => total + (row._sum[field] ?? 0n), 0n);

    const earned = ['PENDING', 'AVAILABLE', 'PAID'];
    const pendingKobo = sumFor(['PENDING'], 'netKobo');
    const availableKobo = sumFor(['AVAILABLE'], 'netKobo');
    const paidKobo = sumFor(['PAID'], 'netKobo');
    const adjustmentsKobo = adjustmentTotals._sum?.amountKobo ?? 0n;
    const withdrawnKobo = withdrawalTotals._sum?.amountKobo ?? 0n;

    const withdrawable = availableKobo + adjustmentsKobo - withdrawnKobo;
    const withdrawableKobo = withdrawable < 0n ? 0n : withdrawable;

    return {
      deliveriesPaid: byStatus.reduce((count, row) => count + row._count._all, 0),
      grossKobo: sumFor(earned, 'grossKobo').toString(),
      commissionKobo: sumFor(earned, 'commissionKobo').toString(),
      pendingKobo: pendingKobo.toString(),
      availableKobo: availableKobo.toString(),
      paidKobo: paidKobo.toString(),
      adjustmentsKobo: adjustmentsKobo.toString(),
      withdrawnKobo: withdrawnKobo.toString(),
      /** What the rider could actually request today. */
      withdrawableKobo: withdrawableKobo.toString(),
      formatted: {
        available: formatNaira(availableKobo),
        pending: formatNaira(pendingKobo),
        paid: formatNaira(paidKobo),
        withdrawable: formatNaira(withdrawableKobo),
      },
    };
  }

  /** Trial calculation used by the UI to show what a job is worth before accepting. */
  static commissionPreview(chargeKobo: bigint, commissionPct: number): { grossKobo: string; netKobo: string } {
    const net = chargeKobo - (chargeKobo * BigInt(Math.round(commissionPct * 100))) / 10_000n;
    return { grossKobo: chargeKobo.toString(), netKobo: net.toString() };
  }
}

export const naira = nairaToKobo;
