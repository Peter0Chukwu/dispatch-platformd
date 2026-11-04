import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthPrincipal } from '../auth.types';

/** @CurrentUser() user — the authenticated principal, resolved by JwtAuthGuard. */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthPrincipal | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<{ user?: AuthPrincipal }>();
    const user = request.user;
    if (!user) return undefined;
    return field ? user[field] : user;
  },
);
