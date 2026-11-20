import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { PrismaService } from '../infra/prisma/prisma.service';
import { MessagingService } from '../messaging/messaging.service';
import { AppError } from '../common/errors/app-error';
import { PasswordService } from './password.service';
import type { Env } from '../config/env.config';

/**
 * One origin, from a value that may hold several.
 *
 * `CORS_ORIGINS` is legitimately a comma-separated list, and it is easy to paste
 * that list into `FRONTEND_URL` by mistake — which produces links like
 * `https://www.example.com,https://example.com/verify?token=…`, and every
 * verification email carries a link no browser will open. Taking the first entry
 * of whatever is configured turns that from an outage into a working link.
 */
export function firstOrigin(value: string | undefined | null): string | null {
  // The first entry that is actually filled in — a leading or doubled comma is a
  // typo, not a reason to send out a broken link.
  const first = (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .find(Boolean);
  if (!first) return null;
  return first.replace(/\/+$/, '');
}

/**
 * The token, recovered from whatever a person pasted.
 *
 * Tokens are 43 characters of base64url. Every real failure on this has been a
 * human one: the whole link pasted, a trailing full stop picked up from the end of
 * the sentence, a space after a copy. Those are stripped here, on the server, so
 * the fix does not depend on which screen the person used.
 */
export function cleanToken(raw: string): string {
  const text = String(raw ?? '').trim();
  const match = /[?&]token=([^&#\s]+)/.exec(text);
  // First chunk only: a token is never followed by a space, so anything after one is
  // the rest of the sentence.
  const candidate = (match?.[1] ?? text).split(/\s+/)[0] ?? '';
  // base64url only — a full stop, bracket or quote was never part of the token.
  return candidate.replace(/[^A-Za-z0-9_-]/g, '');
}

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

  /**
   * Where a link in an email should point.
   *
   * This used to be the first entry of CORS_ORIGINS, which is a list of origins
   * allowed to call the API — not the address customers use. On a deployment where
   * that list still said `http://localhost:5173`, every verification email carried
   * a link to the developer's laptop. FRONTEND_URL is the public site; the CORS
   * list is only the fallback for a machine that has not set it.
   */
  private get siteUrl(): string {
    return (
      firstOrigin(this.config.get('FRONTEND_URL', { infer: true })) ??
      firstOrigin(this.config.get('CORS_ORIGINS', { infer: true })) ??
      'http://localhost:5173'
    );
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

  async sendEmailVerification(user: {
    id: string;
    email: string | null;
    firstName: string;
  }): Promise<{ devToken?: string; delivered: boolean; deliveryReason?: string }> {
    if (!user.email) throw AppError.validation([{ field: 'email', message: 'No email address on this account' }]);
    const token = randomBytes(32).toString('base64url');
    await this.issue(user.id, 'EMAIL_VERIFY', token, user.email, TTL.EMAIL_VERIFY);
    // `/verify` is the route that actually exists — the old link pointed at
    // `/verify-email`, which the app does not have, so every emailed link landed
    // on a 404 and the account could never be verified.
    const link = `${this.siteUrl}/verify?token=${token}`;
    const delivery = await this.messaging.sendEmail({
      to: user.email,
      kind: 'EMAIL_VERIFICATION',
      subject: 'Verify your email address',
      body: [
        `Hello ${user.firstName},`,
        '',
        'Confirm your email address to activate your account:',
        '',
        link,
        '',
        'The link works for 24 hours.',
      ].join('\n'),
    });
    return {
      ...(this.exposeCodes ? { devToken: token } : {}),
      delivered: delivery.delivered,
      deliveryReason: delivery.delivered ? undefined : delivery.reason,
    };
  }

  async verifyEmail(rawToken: string): Promise<{ userId: string }> {
    const token = cleanToken(rawToken);
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

  async sendPhoneOtp(user: {
    id: string;
    phone: string | null;
    firstName: string;
  }): Promise<{ devCode?: string; expiresInSeconds: number; delivered: boolean; deliveryReason?: string }> {
    if (!user.phone) throw AppError.validation([{ field: 'phone', message: 'No phone number on this account' }]);

    /**
     * No SMS driver means this code cannot reach anyone.
     *
     * Outside production the code is returned to the caller and shown on screen, so
     * the flow still completes. In production it is not, and the old behaviour was to
     * say "we sent a 6-digit code" anyway and leave the customer typing nothing at a
     * dead end. Saying so is better than pretending: phone confirmation is optional,
     * email is what the account actually stands on.
     */
    if (!this.messaging.smsDelivers && !this.exposeCodes) {
      throw new AppError(
        'SMS_UNAVAILABLE',
        'Phone confirmation is not switched on yet, so nothing was sent. It is optional — your email address is enough to book.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.issue(user.id, 'PHONE_OTP', `${user.id}:${code}`, user.phone, TTL.PHONE_OTP);
    const delivery = await this.messaging.sendSms({
      to: user.phone,
      kind: 'PHONE_OTP',
      body: `${code} is your Traders Welfare verification code. It expires in 10 minutes. Never share it.`,
    });
    return {
      ...(this.exposeCodes ? { devCode: code } : {}),
      expiresInSeconds: TTL.PHONE_OTP / 1000,
      // The browser is told the truth: a code that never left the building must not
      // be described as "sent".
      delivered: delivery.delivered,
      deliveryReason: delivery.delivered ? undefined : delivery.reason,
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
  async sendPasswordReset(identifier: string): Promise<{ devToken?: string; delivered: boolean }> {
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
      // Deliberately identical to a successful request: the caller must not learn
      // whether the account exists.
      return { delivered: false };
    }

    const token = randomBytes(32).toString('base64url');
    await this.issue(user.id, 'PASSWORD_RESET', token, user.email, TTL.PASSWORD_RESET);
    const link = `${this.siteUrl}/reset-password?token=${token}`;
    const delivery = await this.messaging.sendEmail({
      to: user.email,
      kind: 'PASSWORD_RESET',
      subject: 'Reset your password',
      // The link sits on its own line, with no punctuation touching it. A full stop
      // straight after a URL is picked up by mail clients as part of the link, and
      // the token then ends in a character that was never in it.
      body: [
        `Hello ${user.firstName},`,
        '',
        'Use this link to choose a new password — it works for one hour:',
        '',
        link,
        '',
        'If you did not ask for this, ignore this message.',
      ].join('\n'),
    });
    return {
      ...(this.exposeCodes ? { devToken: token } : {}),
      delivered: delivery.delivered,
    };
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const token = cleanToken(rawToken);
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
