import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { AcceptStaffInviteInput, CreateStaffInviteInput } from '@dispatch/shared';
import { PrismaService } from '../infra/prisma/prisma.service';
import { AppConfig } from '../config/app.config';
import { AppError } from '../common/errors/app-error';
import { AuditService } from '../audit/audit.service';
import { AdminAccountsService } from './admin-accounts.service';
import type { AuthPrincipal } from '../auth/auth.types';

/** 32 random bytes = 256 bits. Not guessable, and short enough to paste into a chat. */
const TOKEN_BYTES = 32;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * LETTING A NEW ADMIN IN WITHOUT EVER KNOWING THEIR PASSWORD.
 *
 * The old way was `POST /admin/staff` with a password typed by whoever was
 * already signed in — which meant one person knew another person's credential
 * from day one, and the new admin had no way to prove the account was theirs.
 *
 * An invitation replaces that with a link:
 *   · the super admin picks the email and the roles, never a password
 *   · the link carries 256 bits of randomness and is stored only as a SHA-256 hash
 *   · it works once. The claim is a conditional UPDATE (`usedAt: null`), so two
 *     tabs opening it at the same moment cannot both create an account
 *   · it expires, and it can be revoked before then
 *
 * What this does NOT buy: the link is a bearer credential. Whoever opens it first
 * becomes that admin. That is why it is short-lived by default, why the endpoint
 * that mints it is super-admin only, and why the list shows what has been used so
 * an unexpected acceptance is visible rather than silent.
 */
@Injectable()
export class AdminInvitesService {
  private readonly logger = new Logger(AdminInvitesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AdminAccountsService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  // ───────────────────────────── guard ───────────────────────────────────────

  /**
   * Super admin only, and checked here as well as on the route.
   *
   * `staff:write` is not enough: the operations manager can edit staff, but only
   * the owner of the platform may hand out new administrative keys to it.
   */
  private async assertSuperAdmin(principal: AuthPrincipal) {
    if (principal.permissions.includes('*')) return;
    const staff = await this.prisma.staff.findUnique({
      where: { id: principal.staffId ?? '' },
      select: { isSuperAdmin: true },
    });
    if (!staff?.isSuperAdmin) {
      throw AppError.forbidden('Only a super admin can invite administrators');
    }
  }

  private acceptUrl(token: string): string {
    return `${this.config.frontendUrl.replace(/\/$/, '')}/admin-invite/${token}`;
  }

  // ───────────────────────────── mint ────────────────────────────────────────

  async create(principal: AuthPrincipal, input: CreateStaffInviteInput) {
    await this.assertSuperAdmin(principal);

    const email = input.email.toLowerCase();

    // An invitation for an address that already has an account is a trap: it will
    // be accepted and then fail on the unique index. Say so now, plainly.
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      throw AppError.conflict(
        'An account already exists with that email address.',
        'EMAIL_ALREADY_EXISTS',
      );
    }

    const roles = await this.prisma.role.findMany({
      where: { key: { in: input.roleKeys } },
      select: { key: true },
    });
    const known = new Set(roles.map((role) => role.key));
    if (known.size !== input.roleKeys.length) {
      throw AppError.validation([
        {
          field: 'roleKeys',
          message: `Unknown role(s): ${input.roleKeys.filter((key) => !known.has(key)).join(', ')}`,
        },
      ]);
    }

    // Supersede any earlier live invitation for the same address. Two working
    // links for one person means nobody can tell which one was used.
    await this.prisma.staffInvite.updateMany({
      where: { email, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000);

    const invite = await this.prisma.staffInvite.create({
      data: {
        tokenHash: hash(token),
        email,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        roleKeys: input.roleKeys,
        jobTitle: input.jobTitle ?? null,
        branchId: input.branchId ?? null,
        invitedByUserId: principal.userId,
        expiresAt,
      },
      select: { id: true, email: true, roleKeys: true, expiresAt: true },
    });

    await this.audit.record({
      actorUserId: principal.userId,
      actorRole: 'STAFF',
      action: 'staff.invite',
      entityType: 'StaffInvite',
      entityId: invite.id,
      after: { email, roleKeys: input.roleKeys, expiresAt },
    });

    this.logger.log(`Invitation for ${email} expires ${expiresAt.toISOString()}`);

    // The token is returned exactly once, here. It is never stored in a readable
    // form and there is no endpoint that can produce it again — if the link is
    // lost, revoke it and mint another.
    return {
      id: invite.id,
      email: invite.email,
      roleKeys: invite.roleKeys,
      expiresAt: invite.expiresAt,
      acceptUrl: this.acceptUrl(token),
    };
  }

  // ───────────────────────────── list / revoke ───────────────────────────────

  async list(principal: AuthPrincipal) {
    await this.assertSuperAdmin(principal);

    const rows = await this.prisma.staffInvite.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        roleKeys: true,
        jobTitle: true,
        expiresAt: true,
        usedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });

    const now = Date.now();
    return rows.map((row) => ({
      ...row,
      // One word the UI can colour: nothing here is inferred from timestamps by
      // the browser, so the badge cannot disagree with the API's own rule.
      status: row.usedAt
        ? 'ACCEPTED'
        : row.revokedAt
          ? 'REVOKED'
          : row.expiresAt.getTime() <= now
            ? 'EXPIRED'
            : 'PENDING',
    }));
  }

  async revoke(principal: AuthPrincipal, id: string) {
    await this.assertSuperAdmin(principal);

    const invite = await this.prisma.staffInvite.findUnique({
      where: { id },
      select: { id: true, email: true, usedAt: true, revokedAt: true },
    });
    if (!invite) throw AppError.notFound('Invitation');
    if (invite.usedAt) {
      throw AppError.conflict(
        'That invitation has already been accepted — suspend the account instead.',
        'INVITE_ALREADY_USED',
      );
    }
    if (invite.revokedAt) return { id: invite.id, status: 'REVOKED' };

    await this.prisma.staffInvite.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      actorRole: 'STAFF',
      action: 'staff.invite.revoke',
      entityType: 'StaffInvite',
      entityId: id,
      after: { email: invite.email },
    });
    return { id: invite.id, status: 'REVOKED' };
  }

  // ───────────────────────────── public side ─────────────────────────────────

  /**
   * What the invitation page is allowed to know before anybody signs anything.
   * Deliberately thin: the email is shown so the recipient can recognise it, and
   * the roles so they know what they are accepting. No names, no branch, nothing
   * that would be useful to someone who found the link in a screenshot.
   */
  async resolve(token: string) {
    const invite = await this.prisma.staffInvite.findUnique({
      where: { tokenHash: hash(token) },
      select: { email: true, roleKeys: true, expiresAt: true, usedAt: true, revokedAt: true },
    });

    if (!invite) {
      return { valid: false as const, reason: 'UNKNOWN' as const };
    }
    if (invite.usedAt) return { valid: false as const, reason: 'USED' as const };
    if (invite.revokedAt) return { valid: false as const, reason: 'REVOKED' as const };
    if (invite.expiresAt.getTime() <= Date.now()) {
      return { valid: false as const, reason: 'EXPIRED' as const };
    }

    return {
      valid: true as const,
      email: invite.email,
      roleKeys: invite.roleKeys,
      expiresAt: invite.expiresAt,
    };
  }

  /**
   * Accept: claim the invitation, then create the staff account.
   *
   * The claim is `updateMany` with `usedAt: null` in the WHERE clause — the only
   * form of "use it once" that survives two browser tabs. If account creation
   * then fails (a phone number already in use, say), the claim is released so the
   * invitee can correct the form instead of asking for a new link.
   */
  async accept(token: string, input: AcceptStaffInviteInput) {
    const invite = await this.prisma.staffInvite.findUnique({
      where: { tokenHash: hash(token) },
      select: {
        id: true,
        email: true,
        roleKeys: true,
        jobTitle: true,
        branchId: true,
        expiresAt: true,
        usedAt: true,
        revokedAt: true,
      },
    });

    if (!invite) throw AppError.notFound('This invitation link is not valid');
    if (invite.usedAt) {
      throw AppError.conflict(
        'This invitation has already been used. Ask a super admin for a new link.',
        'INVITE_ALREADY_USED',
      );
    }
    if (invite.revokedAt) {
      throw AppError.conflict(
        'This invitation was revoked. Ask a super admin for a new link.',
        'INVITE_REVOKED',
      );
    }
    if (invite.expiresAt.getTime() <= Date.now()) {
      throw AppError.conflict(
        'This invitation has expired. Ask a super admin for a new link.',
        'INVITE_EXPIRED',
      );
    }

    const claim = await this.prisma.staffInvite.updateMany({
      where: { id: invite.id, usedAt: null, revokedAt: null },
      data: { usedAt: new Date() },
    });
    if (claim.count !== 1) {
      throw AppError.conflict(
        'This invitation has already been used. Ask a super admin for a new link.',
        'INVITE_ALREADY_USED',
      );
    }

    try {
      const created = await this.accounts.createStaff({
        firstName: input.firstName,
        lastName: input.lastName,
        email: invite.email,
        phone: input.phone,
        password: input.password,
        roleKeys: invite.roleKeys,
        branchId: invite.branchId ?? undefined,
        jobTitle: invite.jobTitle ?? undefined,
        // No staff member is acting here — the invitation itself is the authority,
        // and the audit row records who minted it.
        actorUserId: null,
      });

      this.logger.log(`Invitation accepted for ${invite.email} (${created.staffCode ?? 'staff'})`);
      return {
        email: invite.email,
        staffCode: created.staffCode,
        roles: created.roles,
        message: 'Your account is ready. Sign in to continue.',
      };
    } catch (error) {
      // Release the claim: the account was NOT created, so the link must still work.
      await this.prisma.staffInvite.update({
        where: { id: invite.id },
        data: { usedAt: null },
      });
      throw error;
    }
  }
}
