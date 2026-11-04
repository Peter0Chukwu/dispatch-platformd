import { SetMetadata } from '@nestjs/common';
import type { UserType } from '@dispatch/shared';

export const TYPES_KEY = 'allowedUserTypes';

/**
 * @RequireType('STAFF') — restricts a route to specific account types.
 * Portal separation is enforced here, not by the URL the user typed.
 */
export const RequireType = (...types: UserType[]) => SetMetadata(TYPES_KEY, types);
