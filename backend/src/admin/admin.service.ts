import { Injectable } from "@nestjs/common";
import type { PaginationQuery } from "@dispatch/shared";
import { PrismaService } from "../infra/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { AuthPrincipal } from "../auth/auth.types";

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async whoami(principal: AuthPrincipal) {
    const staff = await this.prisma.staff.findUniqueOrThrow({
      where: { id: principal.staffId },
      select: {
        id: true,
        staffCode: true,
        isSuperAdmin: true,
        jobTitle: true,
        branch: { select: { id: true, code: true, name: true, city: true } },
        roles: { select: { role: { select: { key: true, name: true } } } },
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            mustChangePassword: true,
          },
        },
      },
    });

    return {
      staff,
      roles: principal.roles,
      permissions: principal.permissions.filter((p) => p !== "*"),
      isSuperAdmin: principal.permissions.includes("*") || staff.isSuperAdmin,
    };
  }

  async listStaff(query: PaginationQuery) {
    const where = query.search
      ? {
          OR: [
            {
              staffCode: {
                contains: query.search,
                mode: "insensitive" as const,
              },
            },
            {
              user: {
                firstName: {
                  contains: query.search,
                  mode: "insensitive" as const,
                },
              },
            },
            {
              user: {
                lastName: {
                  contains: query.search,
                  mode: "insensitive" as const,
                },
              },
            },
            {
              user: {
                email: { contains: query.search, mode: "insensitive" as const },
              },
            },
          ],
        }
      : {};

    const [rows, total] = await Promise.all([
      this.prisma.staff.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          staffCode: true,
          isSuperAdmin: true,
          jobTitle: true,
          createdAt: true,
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              status: true,
              lastLoginAt: true,
            },
          },
          branch: { select: { code: true, name: true } },
          roles: { select: { role: { select: { key: true, name: true } } } },
        },
      }),
      this.prisma.staff.count({ where }),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        staffCode: row.staffCode,
        name: `${row.user.firstName} ${row.user.lastName}`,
        email: row.user.email,
        phone: row.user.phone,
        status: row.user.status,
        isSuperAdmin: row.isSuperAdmin,
        jobTitle: row.jobTitle,
        branch: row.branch,
        roles: row.roles.map((r) => r.role),
        lastLoginAt: row.user.lastLoginAt,
        createdAt: row.createdAt,
      })),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async listPermissions() {
    const permissions = await this.prisma.permission.findMany({
      orderBy: [{ group: "asc" }, { key: "asc" }],
    });
    const grouped: Record<
      string,
      Array<{ key: string; description: string | null }>
    > = {};
    for (const permission of permissions) {
      grouped[permission.group] ??= [];
      grouped[permission.group]!.push({
        key: permission.key,
        description: permission.description,
      });
    }
    return grouped;
  }

  /**
   * The audit screen needs a name next to each row, not a bare uuid, and the
   * ability to narrow to one kind of event. Both are done in SQL.
   */
  async listAuditLogs(
    query: PaginationQuery & { action?: string; entityType?: string },
  ) {
    const where = {
      ...(query.action
        ? { action: { contains: query.action, mode: "insensitive" as const } }
        : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.search
        ? {
            OR: [
              {
                action: {
                  contains: query.search,
                  mode: "insensitive" as const,
                },
              },
              {
                entityType: {
                  contains: query.search,
                  mode: "insensitive" as const,
                },
              },
              {
                entityId: {
                  contains: query.search,
                  mode: "insensitive" as const,
                },
              },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          actor: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              type: true,
            },
          },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        actorRole: row.actorRole,
        actor: row.actor
          ? `${row.actor.firstName} ${row.actor.lastName}`
          : (row.actorRole ?? "system"),
        actorEmail: row.actor?.email ?? null,
        ip: row.ip,
        before: row.before,
        after: row.after,
        createdAt: row.createdAt,
      })),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }
}
