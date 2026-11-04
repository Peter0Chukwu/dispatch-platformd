import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
/**
 * Marks a route as reachable without an access token.
 * Everything NOT marked @Public() requires authentication — that default is
 * deliberate: forgetting to protect a route is a bug you cannot make.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
