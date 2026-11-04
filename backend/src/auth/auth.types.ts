import type { UserType } from '@dispatch/shared';

/** Portals a token may be issued for. A token is only valid in its own portal. */
export type Audience = 'CUSTOMER' | 'RIDER' | 'ADMIN';

/** What a verified access token resolves to on every request. */
export interface AuthPrincipal {
  userId: string;
  type: UserType;
  audience: Audience;
  /** Refresh-token family id = the session. Used for logout-all and reuse detection. */
  sessionId: string;
  customerId?: string;
  riderId?: string;
  staffId?: string;
  roles: string[];
  permissions: string[];
}

export interface AccessTokenPayload {
  sub: string;
  typ: UserType;
  aud: Audience;
  sid: string;
  jti: string;
  iat?: number;
  exp?: number;
}

/** Shape returned to every portal after login/refresh. */
export interface AuthSession {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenMaxAgeMs: number;
  user: {
    id: string;
    type: UserType;
    email: string | null;
    phone: string | null;
    firstName: string;
    lastName: string;
    status: string;
    emailVerified: boolean;
    phoneVerified: boolean;
    avatarUrl: string | null;
    mustChangePassword: boolean;
  };
  profile: {
    customerId?: string;
    riderId?: string;
    riderApprovalStatus?: string;
    staffId?: string;
    roles?: string[];
    permissions?: string[];
    isSuperAdmin?: boolean;
  };
}
