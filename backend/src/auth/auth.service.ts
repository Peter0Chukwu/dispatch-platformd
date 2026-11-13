import { Injectable, Logger } from '@nestjs/common';
import type { LoginInput, RegisterCustomerInput, RegisterRiderInput } from '@dispatch/shared';
import { PrismaService } from '../infra/prisma/prisma.service';
import { AppError } from '../common/errors/app-error';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { VerificationService } from './verification.service';
import type { Audience, AuthPrincipal, AuthSession } from './auth.types';
import type { UserType } from '@dispatch/shared';

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

export interface RequestContext {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly verification: VerificationService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
    private readonly storage: StorageService,
  ) {}

  // ───────────────────────────── REGISTRATION ──────────────────────────────

  async registerCustomer(input: RegisterCustomerInput, ctx: RequestContext) {
    const email = input.email.toLowerCase();

    // Explicit existence checks give a clear message; the unique index is the
    // real guarantee and still protects against concurrent double-submits.
    if (await this.prisma.user.count({ where: { email } })) {
      throw AppError.conflict('An account already exists with this email address');
    }
    if (await this.prisma.user.count({ where: { phone: input.phone } })) {
      throw AppError.conflict('An account already exists with this phone number');
    }

    const passwordHash = await this.passwords.hash(input.password);
    const branch = await this.prisma.branch.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    const user = await this.prisma.user.create({
      data: {
        email,
        phone: input.phone,
        passwordHash,
        type: 'CUSTOMER',
        status: 'PENDING',
        firstName: input.firstName,
        lastName: input.lastName,
        customer: {
          create: { defaultBranchId: branch?.id ?? null },
        },
        wallet: { create: { type: 'CUSTOMER', balanceKobo: 0n } },
      },
      select: { id: true, email: true, phone: true, firstName: true },
    });

    const emailResult = await this.verification.sendEmailVerification({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
    });
    const otpResult = await this.verification.sendPhoneOtp({
      id: user.id,
      phone: user.phone,
      firstName: user.firstName,
    });

    await this.audit.record({
      actorUserId: user.id,
      action: 'CUSTOMER_REGISTERED',
      entityType: 'User',
      entityId: user.id,
      after: { email: user.email, phone: user.phone },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return {
      message: 'Account created. Check your email for the verification link and your phone for the code.',
      userId: user.id,
      verification: { ...emailResult, ...otpResult },
    };
  }

  async registerRider(input: RegisterRiderInput, ctx: RequestContext) {
    const email = input.email.toLowerCase();
    if (await this.prisma.user.count({ where: { email } })) {
      throw AppError.conflict('An account already exists with this email address');
    }
    if (await this.prisma.user.count({ where: { phone: input.phone } })) {
      throw AppError.conflict('An account already exists with this phone number');
    }
    const plateTaken = await this.prisma.vehicle.count({
      where: { registrationNumber: input.vehicleRegistrationNumber },
    });
    if (plateTaken) {
      throw AppError.conflict('This vehicle registration number is already registered');
    }

    const branch = await this.prisma.branch.findFirstOrThrow({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    const passwordHash = await this.passwords.hash(input.password);
    const riderCount = await this.prisma.rider.count();

    const user = await this.prisma.user.create({
      data: {
        email,
        phone: input.phone,
        passwordHash,
        type: 'RIDER',
        status: 'PENDING',
        firstName: input.firstName,
        lastName: input.lastName,
        rider: {
          create: {
            riderCode: `RDR-${String(riderCount + 1).padStart(5, '0')}`,
            branchId: branch.id,
            approvalStatus: 'PENDING',
            availability: 'OFFLINE',
            emergencyContactName: input.emergencyContactName,
            emergencyContactPhone: input.emergencyContactPhone,
            vehicles: {
              create: {
                type: input.vehicleType,
                registrationNumber: input.vehicleRegistrationNumber,
              },
            },
          },
        },
        wallet: { create: { type: 'RIDER', balanceKobo: 0n } },
      },
      select: { id: true, email: true, phone: true, firstName: true, rider: { select: { id: true, riderCode: true } } },
    });

    const emailResult = await this.verification.sendEmailVerification({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
    });
    await this.verification.sendPhoneOtp({ id: user.id, phone: user.phone, firstName: user.firstName });

    await this.audit.record({
      actorUserId: user.id,
      action: 'RIDER_APPLIED',
      entityType: 'Rider',
      entityId: user.rider?.id,
      after: { riderCode: user.rider?.riderCode, vehicleType: input.vehicleType },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return {
      message:
        'Application received. Verify your email and phone, then upload your documents — an administrator will review your application.',
      userId: user.id,
      riderCode: user.rider?.riderCode,
      verification: emailResult,
    };
  }

  // ──────────────────────────────── LOGIN ──────────────────────────────────

  async login(input: LoginInput, ctx: RequestContext): Promise<AuthSession> {
    const normalisedIdentifier = input.identifier.trim();
    const phone = toE164(normalisedIdentifier);

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: normalisedIdentifier.toLowerCase() },
          ...(phone ? [{ phone }] : []),
        ],
        deletedAt: null,
      },
      include: {
        customer: { select: { id: true } },
        rider: { select: { id: true, approvalStatus: true } },
        staff: {
          select: {
            id: true,
            isSuperAdmin: true,
            roles: { select: { role: { select: { key: true, permissions: { select: { permission: { select: { key: true } } } } } } } },
          },
        },
      },
    });

    // Deliberately identical error for "no such user" and "wrong password":
    // never confirm to an attacker which email addresses exist.
    const invalid = new AppError('UNAUTHORIZED', 'Email/phone or password is incorrect', 401);

    if (!user) {
      await this.audit.record({
        action: 'LOGIN_FAILED',
        entityType: 'User',
        after: { identifier: normalisedIdentifier, reason: 'unknown_account' },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      throw invalid;
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new AppError(
        'RATE_LIMITED',
        `Too many failed attempts. This account is locked for ${minutes} more minute(s).`,
        429,
      );
    }

    const passwordOk = await this.passwords.verify(user.passwordHash, input.password);
    if (!passwordOk) {
      const failedLogins = user.failedLogins + 1;
      const shouldLock = failedLogins >= MAX_FAILED_LOGINS;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLogins: shouldLock ? 0 : failedLogins,
          lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
        },
      });
      await this.audit.record({
        actorUserId: user.id,
        action: shouldLock ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED',
        entityType: 'User',
        entityId: user.id,
        after: { reason: 'bad_password', failedLogins },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      throw invalid;
    }

    if (user.status === 'SUSPENDED' || user.status === 'DELETED') {
      throw new AppError('FORBIDDEN', 'This account has been suspended. Please contact support.', 403);
    }

    // The portal must match the account type. A staff token for the customer
    // portal (or vice versa) is refused with the same generic message.
    const expectedType: Record<Audience, UserType> = { CUSTOMER: 'CUSTOMER', RIDER: 'RIDER', ADMIN: 'STAFF' };
    if (expectedType[input.audience] !== user.type) {
      await this.audit.record({
        actorUserId: user.id,
        action: 'LOGIN_WRONG_PORTAL',
        entityType: 'User',
        entityId: user.id,
        after: { audience: input.audience, type: user.type },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      throw new AppError('FORBIDDEN', `This account cannot sign in to the ${input.audience.toLowerCase()} portal`, 403);
    }

    // Transparent re-hash if Argon2 parameters have been strengthened.
    if (await this.passwords.needsRehash(user.passwordHash)) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await this.passwords.hash(input.password) },
      });
    }

    const refresh = await this.tokens.createRefreshToken({
      userId: user.id,
      audience: input.audience,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    const accessToken = await this.tokens.signAccessToken({
      userId: user.id,
      type: user.type as UserType,
      audience: input.audience,
      familyId: refresh.familyId,
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null },
    });

    const roles = user.staff?.roles.map((r) => r.role.key) ?? [];
    const permissions = [
      ...new Set(
        (user.staff?.roles ?? []).flatMap((r) => r.role.permissions.map((p) => p.permission.key)),
      ),
    ];
    if (user.staff?.isSuperAdmin) permissions.push('*');

    await this.audit.record({
      actorUserId: user.id,
      actorRole: roles[0] ?? user.type,
      action: 'LOGIN_SUCCESS',
      entityType: 'User',
      entityId: user.id,
      after: { audience: input.audience },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return {
      accessToken,
      accessTokenExpiresIn: this.tokens.accessTtlSeconds,
      refreshToken: refresh.token,
      refreshTokenMaxAgeMs: this.tokens.refreshMaxAgeMs,
      user: {
        id: user.id,
        type: user.type as UserType,
        email: user.email,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
        status: user.status,
        emailVerified: !!user.emailVerifiedAt,
        phoneVerified: !!user.phoneVerifiedAt,
        avatarUrl: user.avatarKey ? `/api/v1/files/${user.avatarKey}` : null,
        mustChangePassword: user.mustChangePassword,
      },
      profile: {
        customerId: user.customer?.id,
        riderId: user.rider?.id,
        riderApprovalStatus: user.rider?.approvalStatus,
        staffId: user.staff?.id,
        roles,
        permissions,
        isSuperAdmin: user.staff?.isSuperAdmin ?? false,
      },
    };
  }

  // ───────────────────────── VERIFICATION PASSTHROUGHS ─────────────────────

  async verifyEmailToken(token: string) {
    const result = await this.verification.verifyEmail(token);
    await this.audit.record({
      actorUserId: result.userId,
      action: 'EMAIL_VERIFIED',
      entityType: 'User',
      entityId: result.userId,
    });
    return { message: 'Email address verified.' };
  }

  async forgotPassword(identifier: string) {
    const result = await this.verification.sendPasswordReset(identifier);
    return {
      message: 'If an account matches those details, a reset link has been sent.',
      ...result,
    };
  }

  async resetPasswordWithToken(token: string, newPassword: string) {
    await this.verification.resetPassword(token, newPassword);
    await this.audit.record({
      action: 'PASSWORD_RESET_COMPLETED',
      entityType: 'User',
      after: { method: 'email_token' },
    });
    return { message: 'Password updated. You can now sign in.' };
  }

  // ─────────────────────── PUBLIC OTP (BY PHONE) ───────────────────────────

  /**
   * Used before the user has a session (e.g. straight after registration).
   * Keyed on the phone number and rate-limited by the controller, so it cannot be
   * used to spam a number with codes.
   */
  async requestOtpForPhone(phoneInput: string) {
    const phone = toE164(phoneInput);
    if (!phone) throw AppError.validation([{ field: 'phone', message: 'Enter a valid Nigerian mobile number' }]);
    const user = await this.prisma.user.findFirst({
      where: { phone, deletedAt: null },
      select: { id: true, phone: true, firstName: true },
    });
    if (!user) return { message: 'If this number is registered, a code has been sent.', expiresInSeconds: 600 };
    const result = await this.verification.sendPhoneOtp(user);
    return { message: 'A 6-digit code has been sent to your phone.', ...result };
  }

  async verifyOtpForPhone(phoneInput: string, code: string) {
    const phone = toE164(phoneInput);
    if (!phone) throw AppError.validation([{ field: 'phone', message: 'Enter a valid Nigerian mobile number' }]);
    const user = await this.prisma.user.findFirst({ where: { phone, deletedAt: null }, select: { id: true } });
    if (!user) throw new AppError('VALIDATION_FAILED', 'That code is not correct', 400);
    await this.verification.verifyPhone(user.id, code);
    await this.audit.record({
      actorUserId: user.id,
      action: 'PHONE_VERIFIED',
      entityType: 'User',
      entityId: user.id,
    });
    return { message: 'Phone number verified.' };
  }

  async resendEmailVerification(principal: AuthPrincipal) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: principal.userId },
      select: { id: true, email: true, firstName: true, emailVerifiedAt: true },
    });
    if (user.emailVerifiedAt) return { message: 'Your email is already verified.' };
    return this.verification.sendEmailVerification(user);
  }

  // ─────────────────────────────── SESSIONS ────────────────────────────────

  async refresh(refreshToken: string, ctx: RequestContext): Promise<AuthSession> {
    const rotated = await this.tokens.rotateRefreshToken({ token: refreshToken, ip: ctx.ip, userAgent: ctx.userAgent });

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: rotated.userId },
      include: {
        customer: { select: { id: true } },
        rider: { select: { id: true, approvalStatus: true } },
        staff: {
          select: {
            id: true,
            isSuperAdmin: true,
            roles: { select: { role: { select: { key: true, permissions: { select: { permission: { select: { key: true } } } } } } } },
          },
        },
      },
    });

    const accessToken = await this.tokens.signAccessToken({
      userId: user.id,
      type: user.type as UserType,
      audience: rotated.audience,
      familyId: rotated.familyId,
    });

    const roles = user.staff?.roles.map((r) => r.role.key) ?? [];
    const permissions = [
      ...new Set((user.staff?.roles ?? []).flatMap((r) => r.role.permissions.map((p) => p.permission.key))),
    ];
    if (user.staff?.isSuperAdmin) permissions.push('*');

    return {
      accessToken,
      accessTokenExpiresIn: this.tokens.accessTtlSeconds,
      refreshToken: rotated.refresh.token,
      refreshTokenMaxAgeMs: this.tokens.refreshMaxAgeMs,
      user: {
        id: user.id,
        type: user.type as UserType,
        email: user.email,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
        status: user.status,
        emailVerified: !!user.emailVerifiedAt,
        phoneVerified: !!user.phoneVerifiedAt,
        avatarUrl: user.avatarKey ? `/api/v1/files/${user.avatarKey}` : null,
        mustChangePassword: user.mustChangePassword,
      },
      profile: {
        customerId: user.customer?.id,
        riderId: user.rider?.id,
        riderApprovalStatus: user.rider?.approvalStatus,
        staffId: user.staff?.id,
        roles,
        permissions,
        isSuperAdmin: user.staff?.isSuperAdmin ?? false,
      },
    };
  }

  async logout(refreshToken: string | undefined, principal?: AuthPrincipal): Promise<void> {
    if (refreshToken) await this.tokens.revokeToken(refreshToken);
    if (principal) {
      await this.audit.record({
        actorUserId: principal.userId,
        action: 'LOGOUT',
        entityType: 'User',
        entityId: principal.userId,
      });
    }
  }

  async logoutAll(principal: AuthPrincipal): Promise<{ revokedSessions: number }> {
    const revokedSessions = await this.tokens.revokeAllForUser(principal.userId);
    // Signing out of every device must close the live channels too.
    this.realtime.revokeUser(principal.userId, 'You signed out of all devices.');
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'LOGOUT_ALL_DEVICES',
      entityType: 'User',
      entityId: principal.userId,
      after: { revokedSessions },
    });
    return { revokedSessions };
  }

  async getProfile(principal: AuthPrincipal) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: principal.userId },
      select: {
        id: true, type: true, status: true, email: true, phone: true, firstName: true, lastName: true,
        avatarKey: true, emailVerifiedAt: true, phoneVerifiedAt: true, mustChangePassword: true,
        createdAt: true, lastLoginAt: true,
        customer: { select: { id: true, referralCode: true, defaultBranchId: true } },
        rider: {
          select: {
            id: true, riderCode: true, approvalStatus: true, availability: true, ratingAvg: true,
            ratingCount: true, completedCount: true, branchId: true, serviceZoneId: true,
            vehicles: { select: { id: true, type: true, registrationNumber: true, isVerified: true } },
          },
        },
        staff: {
          select: {
            id: true, staffCode: true, isSuperAdmin: true, jobTitle: true, branchId: true,
            roles: { select: { role: { select: { key: true, name: true } } } },
          },
        },
      },
    });

    const permissions = principal.permissions.filter((p) => p !== '*');
    return {
      user: {
        id: user.id,
        type: user.type,
        status: user.status,
        email: user.email,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: user.avatarKey ? `/api/v1/files/${user.avatarKey}` : null,
        emailVerified: !!user.emailVerifiedAt,
        phoneVerified: !!user.phoneVerifiedAt,
        mustChangePassword: user.mustChangePassword,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
      },
      customer: user.customer,
      rider: user.rider,
      staff: user.staff
        ? {
            ...user.staff,
            roles: user.staff.roles.map((r) => r.role),
            permissions,
            isSuperAdmin: user.staff.isSuperAdmin || principal.permissions.includes('*'),
          }
        : null,
      session: { id: principal.sessionId, audience: principal.audience },
    };
  }

  /**
   * SET A DISPLAY PICTURE.
   *
   * The bytes go through the same private storage the parcel photos use, and the
   * database holds only the key. The previous picture is deleted after the new one
   * is safely written — in that order, so a failed upload never leaves a user with
   * no avatar at all.
   */
  async setAvatar(principal: AuthPrincipal, input: { mimeType: string; base64: string }) {
    const previous = await this.prisma.user.findUniqueOrThrow({
      where: { id: principal.userId },
      select: { avatarKey: true },
    });

    const stored = await this.storage.saveBase64({
      keyPrefix: 'avatars',
      fileName: 'avatar',
      mimeType: input.mimeType,
      base64: input.base64,
    });

    await this.prisma.user.update({
      where: { id: principal.userId },
      data: { avatarKey: stored.key },
    });

    if (previous.avatarKey && previous.avatarKey !== stored.key) {
      await this.storage.remove(previous.avatarKey);
    }

    await this.audit.record({
      actorUserId: principal.userId,
      action: 'AVATAR_UPDATED',
      entityType: 'User',
      entityId: principal.userId,
      after: { bytes: stored.sizeBytes },
    });

    return { avatarUrl: `/api/v1/files/${stored.key}` };
  }

  /** Remove a display picture. The UI falls back to initials, which is a valid avatar. */
  async removeAvatar(principal: AuthPrincipal) {
    const previous = await this.prisma.user.findUniqueOrThrow({
      where: { id: principal.userId },
      select: { avatarKey: true },
    });
    if (!previous.avatarKey) return { avatarUrl: null };

    await this.prisma.user.update({
      where: { id: principal.userId },
      data: { avatarKey: null },
    });
    await this.storage.remove(previous.avatarKey);
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'AVATAR_REMOVED',
      entityType: 'User',
      entityId: principal.userId,
    });
    return { avatarUrl: null };
  }

  async updateProfile(principal: AuthPrincipal, input: { firstName?: string; lastName?: string }) {
    if (input.firstName === undefined && input.lastName === undefined) {
      throw AppError.validation([{ message: 'Nothing to update' }]);
    }
    const before = await this.prisma.user.findUniqueOrThrow({
      where: { id: principal.userId },
      select: { firstName: true, lastName: true },
    });
    const after = await this.prisma.user.update({
      where: { id: principal.userId },
      data: {
        ...(input.firstName ? { firstName: input.firstName } : {}),
        ...(input.lastName ? { lastName: input.lastName } : {}),
      },
      select: { firstName: true, lastName: true },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'PROFILE_UPDATED',
      entityType: 'User',
      entityId: principal.userId,
      before,
      after,
    });
    return { user: { ...after } };
  }

  async listSessions(principal: AuthPrincipal) {
    const sessions = await this.tokens.listSessions(principal.userId);
    return sessions.map((session) => ({
      ...session,
      current: session.familyId === principal.sessionId,
    }));
  }

  async revokeOtherSessions(principal: AuthPrincipal) {
    const result = await this.prisma.refreshToken.updateMany({
      where: { userId: principal.userId, revokedAt: null, familyId: { not: principal.sessionId } },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'SESSIONS_REVOKED',
      entityType: 'User',
      entityId: principal.userId,
      after: { count: result.count },
    });
    return { revokedSessions: result.count };
  }

  async changePassword(principal: AuthPrincipal, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: principal.userId } });
    if (!(await this.passwords.verify(user.passwordHash, currentPassword))) {
      throw new AppError('VALIDATION_FAILED', 'Your current password is not correct', 400, [
        { field: 'currentPassword', message: 'Incorrect password' },
      ]);
    }
    if (currentPassword === newPassword) {
      throw new AppError('VALIDATION_FAILED', 'Choose a password you have not used before', 400, [
        { field: 'newPassword', message: 'New password must differ' },
      ]);
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await this.passwords.hash(newPassword), mustChangePassword: false },
    });
    // Keep the current session, drop every other one.
    await this.prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null, familyId: { not: principal.sessionId } },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      actorUserId: user.id,
      action: 'PASSWORD_CHANGED',
      entityType: 'User',
      entityId: user.id,
    });
    return { message: 'Password updated. Other devices have been signed out.' };
  }
}

function toE164(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '');
  let national: string;
  if (digits.startsWith('+234')) national = digits.slice(4);
  else if (digits.startsWith('234')) national = digits.slice(3);
  else if (digits.startsWith('0')) national = digits.slice(1);
  else national = digits;
  if (national.length !== 10) return null;
  const e164 = `+234${national}`;
  return /^\+234(70|71|80|81|90|91)\d{8}$/.test(e164) ? e164 : null;
}
