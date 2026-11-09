import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { PrismaService } from '../infra/prisma/prisma.service';
import { MessagingService } from '../messaging/messaging.service';
import { AppError } from '../common/errors/app-error';
import { PasswordService } from './password.service';
import type { Env } from '../config/env.config';

const TTL = {
  EMAIL_VERIFY: 24 * 60 * 60 * 1000, // 24 hours
  PHONE_OTP: 10 * 60 * 1000, // 10 minutes
  PASSWORD_RESET: 60 * 60 * 1000, // 1 hour
} as const;

const MAX_ATTEMPTS = 5;

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * EMAIL VERIFICATION, PHONE OTP AND PASSWORD RESET
 *
 * Rules that make this safe:
 *  · codes/tokens are stored only as SHA-256 hashes (a database leak cannot be replayed)
 *  · they expire, are single-use, and are invalidated when superseded
 *  · attempts are limited, so a 6-digit OTP cannot be brute-forced
 *  · the response never reveals whether an account exists (password reset)
 */
@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly passwords: PasswordService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** In development we return the code to the caller so the flow is testable without SMS. */
  private get exposeCodes(): boolean {
    return this.config.get('NODE_ENV', { infer: true }) !== 'production';
  }

  private async issue(userId: string, purpose: 'EMAIL_VERIFY' | 'PHONE_OTP' | 'PASSWORD_RESET', value: string, destination: string, ttlMs: number) {
    // Supersede any earlier outstanding code for the same purpose.
    await this.prisma.verificationToken.updateMany({
      where: { userId, purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const record = await this.prisma.verificationToken.create({
      data: {
        userId,
        tokenHash: hash(value),
        purpose,
        destination,
        expiresAt: new Date(Date.now() + ttlMs),
      },
    });
    return record;
  }

  async sendEmailVerification(user: { id: string; email: string | null; firstName: string }): Promise<{ devToken?: string }> {
    if (!user.email) throw AppError.validation([{ field: 'email', message: 'No email address on this account' }]);
    const token = randomBytes(32).toString('base64url');
    await this.issue(user.id, 'EMAIL_VERIFY', token, user.email, TTL.EMAIL_VERIFY);
    const link = `${this.config.get('CORS_ORIGINS', { infer: true }).split(',')[0]}/verify-email?token=${token}`;
    await this.messaging.sendEmail({
      to: user.email,
      kind: 'EMAIL_VERIFICATION',
      subject: 'Verify your email address',
      body: `Hello ${user.firstName}, confirm your email address to activate your account: ${link}`,
    });
    return this.exposeCodes ? { devToken: token } : {};
  }

  async verifyEmail(token: string): Promise<{ userId: string }> {
    const record = await this.prisma.verificationToken.findUnique({ where: { tokenHash: hash(token) } });
    if (!record || record.purpose !== 'EMAIL_VERIFY') {
      throw new AppError('VALIDATION_FAILED', 'This verification link is not valid', 400);
    }
    if (record.consumedAt) {
      throw new AppError('VALIDATION_FAILED', 'This verification link has already been used', 400);
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new AppError('VALIDATION_FAILED', 'This verification link has expired. Request a new one.', 400);
    }

    await this.prisma.$transaction([
      this.prisma.verificationToken.update({ where: { id: record.id }, data: { consumedAt: new Date() } }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: new Date(), status: 'ACTIVE' },
      }),
    ]);
    return { userId: record.userId };
  }

  async sendPhoneOtp(user: { id: string; phone: string | null; firstName: string }): Promise<{ devCode?: string; expiresInSeconds: number }> {
    if (!user.phone) throw AppError.validation([{ field: 'phone', message: 'No phone number on this account' }]);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.issue(user.id, 'PHONE_OTP', `${user.id}:${code}`, user.phone, TTL.PHONE_OTP);
    await this.messaging.sendSms({
      to: user.phone,
      kind: 'PHONE_OTP',
      body: `Your TWL verification code is ${code}. It expires in 10 minutes. Never share it.`,
    });
    return {
      ...(this.exposeCodes ? { devCode: code } : {}),
      expiresInSeconds: TTL.PHONE_OTP / 1000,
    };
  }

  async verifyPhone(userId: string, code: string): Promise<void> {
    const record = await this.prisma.verificationToken.findFirst({
      where: { userId, purpose: 'PHONE_OTP', consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) {
      throw new AppError('VALIDATION_FAILED', 'Request a new verification code', 400);
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new AppError('VALIDATION_FAILED', 'This code has expired. Request a new one.', 400);
    }
    if (record.attempts >= MAX_ATTEMPTS) {
      throw new AppError('RATE_LIMITED', 'Too many incorrect attempts. Request a new code.', 429);
    }
    if (record.tokenHash !== hash(`${userId}:${code}`)) {
      await this.prisma.verificationToken.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
      throw new AppError('VALIDATION_FAILED', 'That code is not correct', 400);
    }

    await this.prisma.$transaction([
      this.prisma.verificationToken.update({ where: { id: record.id }, data: { consumedAt: new Date() } }),
      this.prisma.user.update({
        where: { id: userId },
        data: { phoneVerifiedAt: new Date(), status: 'ACTIVE' },
      }),
    ]);
  }

  /**
   * Always returns success, whether or not the account exists — an enumeration
   * attack must not learn which emails/phones are registered.
   */
  async sendPasswordReset(identifier: string): Promise<{ devToken?: string }> {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: identifier.trim().toLowerCase() },
          { phone: identifier.trim() },
        ],
        deletedAt: null,
      },
      select: { id: true, email: true, firstName: true },
    });
    if (!user || !user.email) {
      this.logger.log('Password reset requested for an unknown identifier — no message sent');
      return {};
    }

    const token = randomBytes(32).toString('base64url');
    await this.issue(user.id, 'PASSWORD_RESET', token, user.email, TTL.PASSWORD_RESET);
    const link = `${this.config.get('CORS_ORIGINS', { infer: true }).split(',')[0]}/reset-password?token=${token}`;
    await this.messaging.sendEmail({
      to: user.email,
      kind: 'PASSWORD_RESET',
      subject: 'Reset your password',
      body: `Hello ${user.firstName}, use this link to choose a new password (valid for 1 hour): ${link}. If you did not ask for this, ignore this message.`,
    });
    return this.exposeCodes ? { devToken: token } : {};
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const record = await this.prisma.verificationToken.findUnique({ where: { tokenHash: hash(token) } });
    if (!record || record.purpose !== 'PASSWORD_RESET' || record.consumedAt || record.expiresAt.getTime() < Date.now()) {
      throw new AppError('VALIDATION_FAILED', 'This reset link is invalid or has expired. Request a new one.', 400);
    }

    const passwordHash = await this.passwords.hash(newPassword);
    await this.prisma.$transaction([
      this.prisma.verificationToken.update({ where: { id: record.id }, data: { consumedAt: new Date() } }),
      this.prisma.user.update({
        where: { id: record.userId },
        // Resetting a password revokes every existing session — a stolen device must not stay signed in.
        data: {
          passwordHash,
          mustChangePassword: false,
          failedLogins: 0,
          lockedUntil: null,
          refreshTokens: { updateMany: { where: { revokedAt: null }, data: { revokedAt: new Date() } } },
        },
      }),
    ]);
  }
}
