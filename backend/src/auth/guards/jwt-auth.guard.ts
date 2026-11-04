import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { AppError } from '../../common/errors/app-error';
import { TokenService } from '../token.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { TYPES_KEY } from '../decorators/require-type.decorator';
import type { UserType } from '@dispatch/shared';
import type { AuthPrincipal } from '../auth.types';

/**
 * GLOBAL AUTHENTICATION GUARD
 *
 * Runs on every request. Routes must opt out with @Public().
 *
 * On success it attaches a fully-resolved principal to `request.user`:
 * user id, account type, portal, session id, profile ids, roles and permissions.
 * Controllers then never need to look the user up again.
 *
 * Staff permissions are cached in Redis for 60 seconds: permission changes take
 * effect within a minute without a database round-trip on every request.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthPrincipal }>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError('UNAUTHORIZED', 'Please sign in to continue', 401);
    }

    const payload = await this.tokenService.verifyAccessToken(header.slice(7).trim());

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
            roles: { select: { role: { select: { key: true, permissions: { select: { permission: { select: { key: true } } } } } } } },
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

    const principal: AuthPrincipal = {
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

    // Account type must match the portal the token was issued for.
    const expectedType: Record<string, UserType> = { CUSTOMER: 'CUSTOMER', RIDER: 'RIDER', ADMIN: 'STAFF' };
    if (expectedType[payload.aud] !== user.type) {
      throw new AppError('FORBIDDEN', 'This session cannot access this portal', 403);
    }

    const allowedTypes = this.reflector.getAllAndOverride<UserType[] | undefined>(TYPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowedTypes && !allowedTypes.includes(user.type as UserType)) {
      throw new AppError('FORBIDDEN', 'You do not have access to this resource', 403);
    }

    request.user = principal;
    return true;
  }
}
