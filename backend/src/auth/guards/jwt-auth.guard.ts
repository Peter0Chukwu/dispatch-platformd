import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError } from '../../common/errors/app-error';
import { TokenService } from '../token.service';
import { PrincipalService } from '../principal.service';
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
 * Every request resolves the account from the database (one indexed lookup), so
 * a suspension or a permission change takes effect on the very next call rather
 * than whenever a cache happens to expire. That is a deliberate trade: this is a
 * dispatch platform, where "suspended" must mean suspended immediately.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService,
    private readonly principals: PrincipalService,
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

    // One resolver, shared with the WebSocket gateway: the socket and the API can
    // never disagree about who a token belongs to.
    const principal = await this.principals.fromPayload(payload);

    const allowedTypes = this.reflector.getAllAndOverride<UserType[] | undefined>(TYPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowedTypes && !allowedTypes.includes(principal.type as UserType)) {
      throw new AppError('FORBIDDEN', 'You do not have access to this resource', 403);
    }

    request.user = principal;
    return true;
  }
}
