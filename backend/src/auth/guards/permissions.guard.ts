import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@dispatch/shared';
import { AppError } from '../../common/errors/app-error';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import type { AuthPrincipal } from '../auth.types';

/**
 * GRANULAR AUTHORISATION
 *
 * Runs after JwtAuthGuard. Denies the request unless the principal holds every
 * permission declared with @RequirePermissions(...). A staff member with the
 * SUPPORT_AGENT role therefore cannot approve withdrawals or change pricing even
 * if they hand-craft the HTTP request.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ user?: AuthPrincipal }>();
    const permissions = request.user?.permissions ?? [];
    if (permissions.includes('*')) return true; // super administrator

    const missing = required.filter((permission) => !permissions.includes(permission));
    if (missing.length > 0) {
      throw new AppError(
        'FORBIDDEN',
        'Your role does not allow this action. Ask an administrator if you need access.',
        403,
        missing.map((permission) => ({ message: `Missing permission: ${permission}` })),
      );
    }
    return true;
  }
}
