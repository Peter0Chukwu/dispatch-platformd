import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service';
import { AppError } from '../common/errors/app-error';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { REQUIRED_DOCUMENTS } from './riders.service';

/**
 * ADMIN SIDE OF RIDER ONBOARDING
 *
 * A rider cannot work until a human has looked at their papers. This service is
 * that human's interface: review each document, then approve, reject or suspend
 * the rider. Nothing here approves anything automatically — `createApprovedRider`
 * in the tests exists precisely so that the tests do not skip this path silently.
 *
 * Every decision is written to the audit trail with before/after values.
 */
@Injectable()
export class AdminRidersService {
  private readonly logger = new Logger(AdminRidersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /** Rider queue, newest application first. `status` filters the approval state. */
  async list(params: { status?: string; q?: string; page?: number; perPage?: number }) {
    const perPage = Math.min(Math.max(params.perPage ?? 20, 1), 100);
    const page = Math.max(params.page ?? 1, 1);
    const search = params.q?.trim();

    const where = {
      ...(params.status ? { approvalStatus: params.status as never } : {}),
      ...(search
        ? {
            OR: [
              { riderCode: { contains: search, mode: 'insensitive' as const } },
              { user: { firstName: { contains: search, mode: 'insensitive' as const } } },
              { user: { lastName: { contains: search, mode: 'insensitive' as const } } },
              { user: { email: { contains: search, mode: 'insensitive' as const } } },
              { user: { phone: { contains: search } } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.rider.findMany({
        where,
        orderBy: [{ approvalStatus: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          user: { select: { firstName: true, lastName: true, email: true, phone: true, status: true } },
          branch: { select: { name: true } },
          serviceZone: { select: { name: true } },
          vehicles: { select: { type: true, registrationNumber: true, isVerified: true } },
          documents: { select: { docType: true, status: true } },
        },
      }),
      this.prisma.rider.count({ where }),
    ]);

    return {
      items: rows.map((rider) => ({
        id: rider.id,
        riderCode: rider.riderCode,
        name: `${rider.user.firstName} ${rider.user.lastName}`,
        email: rider.user.email,
        phone: rider.user.phone,
        accountStatus: rider.user.status,
        approvalStatus: rider.approvalStatus,
        availability: rider.availability,
        branch: rider.branch?.name ?? null,
        zone: rider.serviceZone?.name ?? null,
        vehicle: rider.vehicles[0] ?? null,
        completedCount: rider.completedCount,
        rating: { average: rider.ratingAvg, count: rider.ratingCount },
        documents: {
          approved: rider.documents.filter((doc) => doc.status === 'APPROVED').length,
          pending: rider.documents.filter((doc) => doc.status === 'PENDING').length,
          rejected: rider.documents.filter((doc) => doc.status === 'REJECTED').length,
          required: REQUIRED_DOCUMENTS.length,
        },
        createdAt: rider.createdAt,
      })),
      page,
      perPage,
      total,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
    };
  }

  /** One application in full: the rider, their vehicle, and every document with its review state. */
  async detail(riderId: string) {
    const rider = await this.prisma.rider.findUnique({
      where: { id: riderId },
      include: {
        user: {
          select: { firstName: true, lastName: true, email: true, phone: true, status: true, emailVerifiedAt: true, phoneVerifiedAt: true },
        },
        branch: { select: { name: true } },
        serviceZone: { select: { name: true } },
        vehicles: true,
        documents: { orderBy: { createdAt: 'desc' } },
        reviewer: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
      },
    });
    if (!rider) throw AppError.notFound('Rider not found');

    const approvedTypes = new Set(rider.documents.filter((doc) => doc.status === 'APPROVED').map((doc) => doc.docType));
    const missing = REQUIRED_DOCUMENTS.filter((type) => !approvedTypes.has(type));

    return {
      id: rider.id,
      riderCode: rider.riderCode,
      approvalStatus: rider.approvalStatus,
      availability: rider.availability,
      rejectionReason: rider.rejectionReason,
      reviewedAt: rider.reviewedAt,
      approvedAt: rider.approvedAt,
      reviewer: rider.reviewer
        ? { name: `${rider.reviewer.user.firstName} ${rider.reviewer.user.lastName}` }
        : null,
      user: {
        firstName: rider.user.firstName,
        lastName: rider.user.lastName,
        email: rider.user.email,
        phone: rider.user.phone,
        status: rider.user.status,
        emailVerified: !!rider.user.emailVerifiedAt,
        phoneVerified: !!rider.user.phoneVerifiedAt,
      },
      branch: rider.branch?.name ?? null,
      zone: rider.serviceZone?.name ?? null,
      vehicles: rider.vehicles.map((vehicle) => ({
        type: vehicle.type,
        registrationNumber: vehicle.registrationNumber,
        isVerified: vehicle.isVerified,
      })),
      // The storage key is staff-only. It is never a URL and cannot be fetched without this permission check.
      documents: rider.documents.map((doc) => ({
        id: doc.id,
        type: doc.docType,
        status: doc.status,
        mimeType: doc.mimeType,
        sizeBytes: doc.sizeBytes,
        fileKey: doc.fileKey,
        reviewNote: doc.reviewNote,
        reviewedAt: doc.reviewedAt,
        uploadedAt: doc.createdAt,
        expiresAt: doc.expiresAt,
      })),
      requiredDocuments: REQUIRED_DOCUMENTS,
      missingDocuments: missing,
      canApprove: missing.length === 0,
    };
  }

  /**
   * Approve or reject ONE document.
   *
   * A rejected rider can be re-reviewed after re-uploading: uploading replaces the
   * row and resets it to PENDING, so the queue never gets stuck.
   */
  async reviewDocument(
    params: { riderId: string; documentId: string; decision: 'APPROVE' | 'REJECT'; note?: string; staffId: string },
  ) {
    const document = await this.prisma.riderDocument.findFirst({
      where: { id: params.documentId, riderId: params.riderId },
    });
    if (!document) throw AppError.notFound('Document not found');

    if (params.decision === 'REJECT' && !params.note?.trim()) {
      throw AppError.validation([{ field: 'note', message: 'Say why the document was rejected — the rider sees this' }]);
    }

    const updated = await this.prisma.riderDocument.update({
      where: { id: document.id },
      data: {
        status: params.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        reviewNote: params.note?.trim() ?? null,
        reviewedById: params.staffId,
        reviewedAt: new Date(),
      },
    });

    await this.audit.record({
      actorUserId: null,
      actorRole: 'STAFF',
      action: `rider.document.${params.decision.toLowerCase()}`,
      entityType: 'RiderDocument',
      entityId: document.id,
      before: { status: document.status, reviewNote: document.reviewNote },
      after: { status: updated.status, reviewNote: updated.reviewNote, staffId: params.staffId },
    });

    this.logger.log(`Staff ${params.staffId} ${params.decision.toLowerCase()}d document ${document.id}`);
    return { id: updated.id, status: updated.status, reviewNote: updated.reviewNote, reviewedAt: updated.reviewedAt };
  }

  /**
   * Approve, reject or suspend the rider.
   *
   * Approval is refused while any required document is not APPROVED — the same
   * rule the rider-facing `canGoOnline` uses, so the two can never disagree.
   */
  async setApproval(
    params: { riderId: string; decision: 'APPROVE' | 'REJECT' | 'SUSPEND'; reason?: string; staffId: string },
  ) {
    const rider = await this.prisma.rider.findUnique({
      where: { id: params.riderId },
      include: { documents: true },
    });
    if (!rider) throw AppError.notFound('Rider not found');

    if (params.decision === 'APPROVE') {
      const approved = new Set(rider.documents.filter((doc) => doc.status === 'APPROVED').map((doc) => doc.docType));
      const missing = REQUIRED_DOCUMENTS.filter((type) => !approved.has(type));
      if (missing.length > 0) {
        throw AppError.conflict(
          `Approve their documents first — still unapproved: ${missing.join(', ')}`,
          'DOCUMENTS_INCOMPLETE',
        );
      }
      if (rider.approvalStatus === 'APPROVED') {
        throw AppError.conflict('This rider is already approved.', 'DUPLICATE_REQUEST');
      }
    }

    if ((params.decision === 'REJECT' || params.decision === 'SUSPEND') && !params.reason?.trim()) {
      throw AppError.validation([{ field: 'reason', message: 'Give a reason — the rider sees it' }]);
    }

    const now = new Date();
    const updated = await this.prisma.rider.update({
      where: { id: rider.id },
      data: {
        approvalStatus:
          params.decision === 'APPROVE' ? 'APPROVED' : params.decision === 'REJECT' ? 'REJECTED' : 'SUSPENDED',
        reviewedById: params.staffId,
        reviewedAt: now,
        approvedAt: params.decision === 'APPROVE' ? now : null,
        rejectionReason: params.decision === 'APPROVE' ? null : (params.reason?.trim() ?? null),
        // A suspended or rejected rider must not keep receiving offers.
        ...(params.decision === 'APPROVE' ? {} : { availability: 'OFFLINE' as never }),
      },
    });

    await this.audit.record({
      actorUserId: null,
      actorRole: 'STAFF',
      action: `rider.${params.decision.toLowerCase()}`,
      entityType: 'Rider',
      entityId: rider.id,
      before: { approvalStatus: rider.approvalStatus },
      after: { approvalStatus: updated.approvalStatus, reason: params.reason ?? null, staffId: params.staffId },
    });

    if (params.decision === 'APPROVE') {
      this.logger.log(`Rider ${rider.riderCode} approved by staff ${params.staffId}`);
    }
    return {
      id: updated.id,
      riderCode: updated.riderCode,
      approvalStatus: updated.approvalStatus,
      rejectionReason: updated.rejectionReason,
      reviewedAt: updated.reviewedAt,
    };
  }

  /** Streams a private document to an authorised staff member. There is no other read path. */
  async documentFile(riderId: string, documentId: string) {
    const document = await this.prisma.riderDocument.findFirst({
      where: { id: documentId, riderId },
    });
    if (!document) throw AppError.notFound('Document not found');

    const { readFile } = await import('node:fs/promises');
    let buffer: Buffer;
    try {
      buffer = await readFile(this.storage.absolutePath(document.fileKey));
    } catch {
      // The row survived but the bytes did not (a restored database, a wiped disk).
      // Say so plainly instead of leaking a stack trace to the reviewer.
      throw AppError.notFound('The stored file for this document is missing. Ask the rider to upload it again.');
    }
    return { buffer, mimeType: document.mimeType, fileName: document.docType.toLowerCase() };
  }
}
