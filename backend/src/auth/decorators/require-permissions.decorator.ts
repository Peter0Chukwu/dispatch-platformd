import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@dispatch/shared';

export const PERMISSIONS_KEY = 'requiredPermissions';

/**
 * @RequirePermissions('withdrawal:approve')
 * The route is denied unless the authenticated staff member holds EVERY listed
 * permission. Enforced server-side by PermissionsGuard — a hidden button in the
 * UI is not security.
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
