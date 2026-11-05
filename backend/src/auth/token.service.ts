import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../infra/prisma/prisma.service';
import { AppError } from '../common/errors/app-error';
import type { Env } from '../config/env.config';
import type { AccessTokenPayload, Audience } from './auth.types';
import type { UserType } from '@dispatch/shared';

export interface IssuedRefreshToken {
  token: string;
  familyId: string;
  expiresAt: Date;
}

/**
 * SESSION MODEL
 * ─────────────────────────────────────────────────────────────────────────────
 * Access token  : JWT, 15 minutes, sent in the Authorization header. Stateless and
 *                 short-lived, so a leaked token has a small blast radius.
 * Refresh token : 32 random bytes, stored ONLY as a SHA-256 hash in the database,
 *                 delivered in an HttpOnly cookie so JavaScript cannot read it.
 *
 * ROTATION: every refresh issues a new refresh token and revokes the old one, in
 * the same family. If a token that was already rotated is presented again, that
 * means someone has a stolen copy — we revoke the ENTIRE family (all devices on
 * that session chain) and audit it as suspicious activity.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {}

  private get accessSecret(): string {
    return this.config.get('JWT_ACCESS_SECRET', { infer: true });
  }

  get accessTtlSeconds(): number {
    return this.config.get('JWT_ACCESS_TTL', { infer: true });
  }

  get refreshTtlSeconds(): number {
    return this.config.get('JWT_REFRESH_TTL', { infer: true });
  }

  get refreshMaxAgeMs(): number {
    return this.refreshTtlSeconds * 1000;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async signAccessToken(input: {
    userId: string;
    type: UserType;
    audience: Audience;
    familyId: string;
  }): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: input.userId,
      typ: input.type,
      aud: input.audience,
      sid: input.familyId,
      jti: randomUUID(),
    };
    return this.jwt.signAsync(payload, {
      secret: this.accessSecret,
      expiresIn: this.accessTtlSeconds,
    });
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    try {
      return await this.jwt.verifyAsync<AccessTokenPayload>(token, { secret: this.accessSecret });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'invalid token';
      throw new AppError('UNAUTHORIZED', reason.includes('expired') ? 'Your session has expired. Please sign in again.' : 'Invalid authentication token', 401);
    }
  }

  /** Creates a brand-new refresh chain (i.e. a new login session). */
  async createRefreshToken(input: {
    userId: string;
    audience: Audience;
    ip?: string;
    userAgent?: string;
    familyId?: string;
  }): Promise<IssuedRefreshToken> {
    const token = randomBytes(32).toString('base64url');
    const familyId = input.familyId ?? randomUUID();
    const expiresAt = new Date(Date.now() + this.refreshMaxAgeMs);

    await this.prisma.refreshToken.create({
      data: {
        userId: input.userId,
        tokenHash: this.hashToken(token),
        familyId,
        audience: input.audience,
        ip: input.ip?.slice(0, 64),
        userAgent: input.userAgent?.slice(0, 255),
        expiresAt,
      },
    });

    return { token, familyId, expiresAt };
  }

  /** How long a just-rotated token may be replayed by the same browser. */
  private static readonly REPLAY_GRACE_MS = 30_000;

  /**
   * Validates a refresh token and rotates it.
   * Throws 401 for unknown/expired/revoked tokens. A replay inside the grace
   * window is served a sibling token; a replay after it revokes the family.
   */
  async rotateRefreshToken(input: {
    token: string;
    ip?: string;
    userAgent?: string;
  }): Promise<{ userId: string; audience: Audience; familyId: string; refresh: IssuedRefreshToken }> {
    const tokenHash = this.hashToken(input.token);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, type: true, status: true } } },
    });

    if (!existing) {
      throw new AppError('UNAUTHORIZED', 'Your session is no longer valid. Please sign in again.', 401);
    }

    // ── Reuse detection, with a short grace window ───────────────────────────
    //
    // A rotated token must not be reusable — that is how a stolen token is caught.
    // But a *browser* legitimately presents an already-rotated token in one ordinary
    // situation: two refreshes leave the app at the same moment (two tabs waking, a
    // socket re-authenticating while a request 401s, a navigation that tears the page
    // down before the Set-Cookie lands). The first response rotated the token; the
    // second request was already built with the old one and arrives milliseconds
    // later. Treating that as theft logs a paying customer out for no reason.
    //
    // So: within TokenService.REPLAY_GRACE_MS of the rotation, and only while the successor is
    // still alive, the replay is served a sibling token in the same family and logged
    // as suspicious. Outside that window — or if the successor has itself been
    // revoked, which is what a real replay attack looks like — the whole family dies,
    // exactly as before.
    if (existing.revokedAt) {
      if (existing.replacedByTokenId && Date.now() - existing.revokedAt.getTime() <= TokenService.REPLAY_GRACE_MS) {
        const successor = await this.prisma.refreshToken.findUnique({
          where: { id: existing.replacedByTokenId },
          select: { revokedAt: true, expiresAt: true },
        });
        if (successor && !successor.revokedAt && successor.expiresAt.getTime() > Date.now()) {
          const sibling = await this.createRefreshToken({
            userId: existing.userId,
            audience: existing.audience as Audience,
            ip: input.ip,
            userAgent: input.userAgent,
            familyId: existing.familyId,
          });
          this.logger.warn(
            `Refresh token replayed within ${TokenService.REPLAY_GRACE_MS / 1000}s for user ${existing.userId} — ` +
              `served a sibling token in family ${existing.familyId} (rotation race, not treated as theft).`,
          );
          return {
            userId: existing.userId,
            audience: existing.audience as Audience,
            familyId: existing.familyId,
            refresh: sibling,
          };
        }
      }

      await this.revokeFamily(existing.familyId);
      this.logger.warn(
        `SECURITY: refresh token reuse detected for user ${existing.userId}. Family ${existing.familyId} revoked.`,
      );
      throw new AppError(
        'UNAUTHORIZED',
        'This session was ended for security reasons. Please sign in again.',
        401,
      );
    }

    if (existing.expiresAt.getTime() < Date.now()) {
      throw new AppError('UNAUTHORIZED', 'Your session has expired. Please sign in again.', 401);
    }

    if (existing.user.status !== 'ACTIVE' && existing.user.status !== 'PENDING') {
      throw new AppError('FORBIDDEN', 'This account is not active', 403);
    }

    const rotated = await this.prisma.$transaction(async (tx) => {
      const next = await this.createRefreshToken({
        userId: existing.userId,
        audience: existing.audience as Audience,
        ip: input.ip,
        userAgent: input.userAgent,
        familyId: existing.familyId,
      });
      const created = await tx.refreshToken.findFirstOrThrow({
        where: { familyId: existing.familyId, revokedAt: null, tokenHash: { not: tokenHash } },
        orderBy: { createdAt: 'desc' },
      });
      await tx.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date(), replacedByTokenId: created.id },
      });
      return next;
    });

    return {
      userId: existing.userId,
      audience: existing.audience as Audience,
      familyId: existing.familyId,
      refresh: rotated,
    };
  }

  async revokeToken(token: string): Promise<void> {
    const tokenHash = this.hashToken(token);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  async listSessions(userId: string) {
    return this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, familyId: true, audience: true, ip: true, userAgent: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Housekeeping, called by a worker cron in a later phase. */
  async purgeExpired(): Promise<number> {
    const result = await this.prisma.refreshToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: new Date(Date.now() - 7 * 86_400_000) } }] },
    });
    return result.count;
  }
}
