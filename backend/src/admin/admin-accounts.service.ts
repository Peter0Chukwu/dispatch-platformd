import { Injectable, Logger } from "@nestjs/common";
import { formatNaira } from "@dispatch/shared";
import { PrismaService } from "../infra/prisma/prisma.service";
import { AppError } from "../common/errors/app-error";
import { AuditService } from "../audit/audit.service";
import { TokenService } from "../auth/token.service";
import { PasswordService } from "../auth/password.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";

/**
 * CUSTOMERS AND STAFF — the two account directories staff work with.
 *
 * Suspension is the interesting part: it must do more than flip a flag on a
 * screen. Setting `users.status = SUSPENDED` makes the next login fail, and
 * revoking the refresh tokens makes the *current* session die immediately —
 * otherwise a suspended account keeps working until its cookie expires.
 */
@Injectable()
export class AdminAccountsService {
  private readonly logger = new Logger(AdminAccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
    private readonly passwords: PasswordService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /* ───────────────────────────── customers ───────────────────────────── */

  async listCustomers(params: {
    q?: string;
    status?: string;
    page: number;
    perPage: number;
  }) {
    const where = {
      ...(params.status === "SUSPENDED" || params.status === "ACTIVE"
        ? { user: { status: params.status as never } }
        : {}),
      ...(params.q
        ? {
            OR: [
              {
                user: {
                  firstName: {
                    contains: params.q,
                    mode: "insensitive" as const,
                  },
                },
              },
              {
                user: {
                  lastName: {
                    contains: params.q,
                    mode: "insensitive" as const,
                  },
                },
              },
              {
                user: {
                  email: { contains: params.q, mode: "insensitive" as const },
                },
              },
              { user: { phone: { contains: params.q } } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (params.page - 1) * params.perPage,
        take: params.perPage,
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              status: true,
              createdAt: true,
            },
          },
          _count: { select: { deliveries: true } },
        },
      }),
      this.prisma.customer.count({ where }),
    ]);

    // Spend per customer, summed in the database rather than in the page.
    const ids = rows.map((row) => row.id);
    const spend = await this.prisma.delivery.groupBy({
      by: ["customerId"],
      where: { customerId: { in: ids }, status: "DELIVERED" },
      _sum: { chargeKobo: true },
      _count: { _all: true },
    });
    const spendById = new Map(spend.map((row) => [row.customerId, row]));

    return {
      data: rows.map((row) => {
        const sums = spendById.get(row.id);
        return {
          id: row.id,
          userId: row.userId,
          name: `${row.user.firstName} ${row.user.lastName}`,
          email: row.user.email,
          phone: row.user.phone,
          accountStatus: row.user.status,
          deliveries: row._count.deliveries,
          delivered: sums?._count._all ?? 0,
          spendKobo: (sums?._sum.chargeKobo ?? 0n).toString(),
          spendFormatted: formatNaira(sums?._sum.chargeKobo ?? 0n),
          joinedAt: row.user.createdAt,
        };
      }),
      meta: {
        page: params.page,
        pageSize: params.perPage,
        total,
        totalPages: Math.max(1, Math.ceil(total / params.perPage)),
      },
    };
  }

  async setCustomerStatus(params: {
    customerId: string;
    status: "ACTIVE" | "SUSPENDED";
    reason?: string;
    staffId: string;
    actorUserId?: string | null;
  }) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: params.customerId },
      include: { user: { select: { id: true, status: true, email: true } } },
    });
    if (!customer) throw AppError.notFound("Customer not found");
    if (customer.user.status === params.status) {
      throw AppError.conflict(
        params.status === "SUSPENDED"
          ? "That customer is already suspended."
          : "That customer is already active.",
        "DUPLICATE_REQUEST",
      );
    }

    const updated = await this.prisma.user.update({
      where: { id: customer.userId },
      data: { status: params.status },
      select: { id: true, status: true },
    });

    // A suspension that leaves the current session alive is not a suspension.
    let sessionsRevoked = 0;
    if (params.status === "SUSPENDED") {
      sessionsRevoked = await this.tokens.revokeAllForUser(customer.userId);
      // Live sockets die with the session, so a suspended customer stops seeing
      // updates immediately instead of until their tab happens to reconnect.
      this.realtime.revokeUser(customer.userId, "Your account has been suspended. Contact support.");
    }

    await this.audit.record({
      actorUserId: params.actorUserId ?? null,
      actorRole: "STAFF",
      action:
        params.status === "SUSPENDED"
          ? "customer.suspend"
          : "customer.reactivate",
      entityType: "Customer",
      entityId: customer.id,
      before: { status: customer.user.status },
      after: {
        status: updated.status,
        reason: params.reason ?? null,
        staffId: params.staffId,
        sessionsRevoked,
      },
    });

    this.logger.log(
      `Customer ${customer.id} → ${params.status} (${sessionsRevoked} sessions revoked)`,
    );
    return { id: customer.id, accountStatus: updated.status, sessionsRevoked };
  }

  /* ─────────────────────────────── staff ─────────────────────────────── */

  async listStaff(params: { q?: string; page: number; perPage: number }) {
    const where = params.q
      ? {
          OR: [
            {
              user: {
                firstName: { contains: params.q, mode: "insensitive" as const },
              },
            },
            {
              user: {
                lastName: { contains: params.q, mode: "insensitive" as const },
              },
            },
            {
              user: {
                email: { contains: params.q, mode: "insensitive" as const },
              },
            },
            { staffCode: { contains: params.q, mode: "insensitive" as const } },
          ],
        }
      : {};

    const [rows, total] = await Promise.all([
      this.prisma.staff.findMany({
        where,
        orderBy: { createdAt: "asc" },
        skip: (params.page - 1) * params.perPage,
        take: params.perPage,
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              status: true,
              lastLoginAt: true,
            },
          },
          branch: { select: { name: true } },
          roles: { include: { role: { select: { key: true, name: true } } } },
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
        accountStatus: row.user.status,
        isSuperAdmin: row.isSuperAdmin,
        branch: row.branch.name,
        roles: row.roles.map((entry) => ({
          key: entry.role.key,
          name: entry.role.name,
        })),
        lastLoginAt: row.user.lastLoginAt,
        createdAt: row.createdAt,
      })),
      meta: {
        page: params.page,
        pageSize: params.perPage,
        total,
        totalPages: Math.max(1, Math.ceil(total / params.perPage)),
      },
    };
  }

  /** Every role with its permission list — the source for the role editor in Phase 9. */
  async listRoles() {
    const roles = await this.prisma.role.findMany({
      orderBy: { key: "asc" },
      include: {
        permissions: { include: { permission: { select: { key: true } } } },
        _count: { select: { staff: true } },
      },
    });
    return roles.map((role) => ({
      key: role.key,
      name: role.name,
      description: role.description,
      staffCount: role._count.staff,
      permissions: role.permissions.map((entry) => entry.permission.key).sort(),
    }));
  }

  /** Creates a staff account. The password is set by the admin who creates it. */
  async createStaff(params: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    password: string;
    roleKeys: string[];
    branchId?: string;
    jobTitle?: string;
    staffId: string;
    actorUserId?: string | null;
  }) {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: params.email }, { phone: params.phone }] },
      select: { id: true },
    });
    if (existing) {
      throw AppError.conflict(
        "An account with that email or phone already exists.",
        "EMAIL_ALREADY_EXISTS",
      );
    }

    const roles = await this.prisma.role.findMany({
      where: { key: { in: params.roleKeys } },
      select: { id: true, key: true },
    });
    if (roles.length !== params.roleKeys.length) {
      const found = new Set(roles.map((role) => role.key));
      throw AppError.validation([
        {
          field: "roleKeys",
          message: `Unknown role(s): ${params.roleKeys.filter((key) => !found.has(key)).join(", ")}`,
        },
      ]);
    }

    const branch = params.branchId
      ? await this.prisma.branch.findUnique({
          where: { id: params.branchId },
          select: { id: true },
        })
      : await this.prisma.branch.findFirst({ select: { id: true } });
    if (!branch)
      throw AppError.validation([
        { field: "branchId", message: "No branch exists yet" },
      ]);

    const staffCount = await this.prisma.staff.count();

    const user = await this.prisma.user.create({
      data: {
        email: params.email,
        phone: params.phone,
        passwordHash: await this.passwords.hash(params.password),
        type: "STAFF",
        status: "ACTIVE",
        firstName: params.firstName,
        lastName: params.lastName,
        emailVerifiedAt: new Date(),
        staff: {
          create: {
            staffCode: `STF-${String(staffCount + 1).padStart(4, "0")}`,
            branchId: branch.id,
            jobTitle: params.jobTitle ?? null,
            isSuperAdmin: false,
            roles: {
              create: roles.map((role) => ({
                role: { connect: { id: role.id } },
              })),
            },
          },
        },
        wallet: {
          create: { type: "COMPANY", balanceKobo: 0n, currency: "NGN" },
        },
      },
      select: {
        id: true,
        email: true,
        staff: { select: { id: true, staffCode: true } },
      },
    });

    await this.audit.record({
      actorUserId: params.actorUserId ?? null,
      actorRole: "STAFF",
      action: "staff.create",
      entityType: "Staff",
      entityId: user.staff?.id ?? null,
      after: {
        email: user.email,
        roles: params.roleKeys,
        createdBy: params.staffId,
      },
    });

    return {
      id: user.staff?.id ?? null,
      staffCode: user.staff?.staffCode ?? null,
      email: user.email,
      roles: params.roleKeys,
    };
  }

  /**
   * Suspend or reactivate a staff account.
   *
   * Guard rails that matter: nobody may lock themselves out, and the last active
   * super admin cannot be suspended — that would leave the platform unmanageable.
   */
  async setStaffStatus(params: {
    staffId: string;
    status: "ACTIVE" | "SUSPENDED";
    actingStaffId: string;
    reason?: string;
    actorUserId?: string | null;
  }) {
    if (
      params.staffId === params.actingStaffId &&
      params.status === "SUSPENDED"
    ) {
      throw AppError.conflict(
        "You cannot suspend your own account.",
        "SELF_ACTION_FORBIDDEN",
      );
    }

    const staff = await this.prisma.staff.findUnique({
      where: { id: params.staffId },
      include: { user: { select: { id: true, status: true, email: true } } },
    });
    if (!staff) throw AppError.notFound("Staff member not found");
    if (staff.user.status === params.status) {
      throw AppError.conflict(
        params.status === "SUSPENDED"
          ? "That account is already suspended."
          : "That account is already active.",
        "DUPLICATE_REQUEST",
      );
    }

    if (params.status === "SUSPENDED" && staff.isSuperAdmin) {
      const activeSuperAdmins = await this.prisma.staff.count({
        where: { isSuperAdmin: true, user: { status: "ACTIVE" } },
      });
      if (activeSuperAdmins <= 1) {
        throw AppError.conflict(
          "This is the last active super admin. Create another one before suspending this account.",
          "LAST_SUPER_ADMIN",
        );
      }
    }

    const updated = await this.prisma.user.update({
      where: { id: staff.userId },
      data: { status: params.status },
      select: { status: true },
    });

    const sessionsRevoked =
      params.status === "SUSPENDED"
        ? await this.tokens.revokeAllForUser(staff.userId)
        : 0;
    if (params.status === "SUSPENDED") {
      this.realtime.revokeUser(staff.userId, "Your account has been suspended.");
    }

    await this.audit.record({
      actorUserId: params.actorUserId ?? null,
      actorRole: "STAFF",
      action:
        params.status === "SUSPENDED" ? "staff.suspend" : "staff.reactivate",
      entityType: "Staff",
      entityId: staff.id,
      before: { status: staff.user.status },
      after: {
        status: updated.status,
        reason: params.reason ?? null,
        sessionsRevoked,
        by: params.actingStaffId,
      },
    });

    return { id: staff.id, accountStatus: updated.status, sessionsRevoked };
  }
}
