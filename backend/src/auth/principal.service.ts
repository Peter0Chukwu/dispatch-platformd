import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service';
import { TokenService } from './token.service';
import { AppError } from '../common/errors/app-error';
import type { AuthPrincipal, Audience, AccessTokenPayload } from './auth.types';
import type { UserType } from '@dispatch/shared';

/**
 * ONE PLACE THAT TURNS A TOKEN INTO A PRINCIPAL
 *
 * The HTTP guard and the WebSocket gateway must agree, exactly, on who a token
 * belongs to and what that person may do. When they disagree the result is a
 * hole: an API that refuses a suspended account while a live socket keeps
 * receiving offers.
 *
 * So the resolution lives here once, with the same status checks and the same
 * role/permission expansion, and both entry points call it.
 */
@Injectable()
export class PrincipalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  /** Verify the token, then resolve the account behind it. */
  async fromAccessToken(token: string): Promise<AuthPrincipal> {
    const payload = await this.tokens.verifyAccessToken(token);
    return this.fromPayload(payload);
  }

  async fromPayload(payload: AccessTokenPayload): Promise<AuthPrincipal> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        type: true,
        status: true,
        deletedAt: true,
        customer: { select: { id: true } },
        rider: { select: { id: true, approvalStatus: true } },
        staff: {
          select: {
            id: true,
            isSuperAdmin: true,
            roles: {
              select: {
                role: {
                  select: {
                    key: true,
                    permissions: { select: { permission: { select: { key: true } } } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user || user.deletedAt) {
      throw new AppError('UNAUTHORIZED', 'This account no longer exists', 401);
    }
    if (user.status === 'SUSPENDED' || user.status === 'DELETED') {
      throw new AppError('FORBIDDEN', 'This account has been suspended. Please contact support.', 403);
    }
    if (user.status === 'PENDING' && user.type === 'STAFF') {
      throw new AppError('FORBIDDEN', 'This staff account is not active', 403);
    }

    const roles: string[] = [];
    const permissions = new Set<string>();
    if (user.staff) {
      for (const staffRole of user.staff.roles) {
        roles.push(staffRole.role.key);
        for (const rp of staffRole.role.permissions) permissions.add(rp.permission.key);
      }
      if (user.staff.isSuperAdmin) permissions.add('*');
    }

    // Account type must match the portal the token was issued for.
    const expectedType: Record<Audience, UserType> = { CUSTOMER: 'CUSTOMER', RIDER: 'RIDER', ADMIN: 'STAFF' };
    if (expectedType[payload.aud] !== user.type) {
      throw new AppError('FORBIDDEN', 'This session cannot access this portal', 403);
    }

    return {
      userId: user.id,
      type: user.type as UserType,
      audience: payload.aud,
      sessionId: payload.sid,
      customerId: user.customer?.id,
      riderId: user.rider?.id,
      staffId: user.staff?.id,
      roles,
      permissions: [...permissions],
    };
  }

  /** `*` is the super-admin wildcard. */
  static has(principal: AuthPrincipal, permission: string): boolean {
    return principal.permissions.includes('*') || principal.permissions.includes(permission);
  }
}
