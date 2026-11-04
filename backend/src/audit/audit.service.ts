import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service';

export interface AuditEntry {
  actorUserId?: string | null;
  actorRole?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * APPEND-ONLY AUDIT TRAIL
 *
 * Every sensitive action writes one immutable row: who, what, before, after, when,
 * from where. There is no update or delete path in this service on purpose.
 *
 * Auditing must never break the business operation it is recording, so failures
 * are logged and swallowed rather than rethrown.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: entry.actorUserId ?? null,
          actorRole: entry.actorRole ?? null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          before: (entry.before ?? undefined) as never,
          after: (entry.after ?? undefined) as never,
          ip: entry.ip?.slice(0, 64) ?? null,
          userAgent: entry.userAgent?.slice(0, 255) ?? null,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to write audit log for ${entry.action}: ${(error as Error).message}`);
    }
  }

  async list(params: { entityType?: string; entityId?: string; actorUserId?: string; take?: number; skip?: number }) {
    return this.prisma.auditLog.findMany({
      where: {
        ...(params.entityType ? { entityType: params.entityType } : {}),
        ...(params.entityId ? { entityId: params.entityId } : {}),
        ...(params.actorUserId ? { actorUserId: params.actorUserId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(params.take ?? 50, 200),
      skip: params.skip ?? 0,
    });
  }
}
