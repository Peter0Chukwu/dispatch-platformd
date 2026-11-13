import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setAccessToken, ApiError } from '../lib/api';
import { connectLive, disconnectLive } from '../lib/live';

export type Audience = 'CUSTOMER' | 'RIDER' | 'ADMIN';

export interface SessionUser {
  id: string;
  type: 'CUSTOMER' | 'RIDER' | 'STAFF';
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string;
  status: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  avatarUrl: string | null;
  mustChangePassword: boolean;
}

export interface SessionProfile {
  customerId?: string;
  riderId?: string;
  riderApprovalStatus?: string;
  staffId?: string;
  roles?: string[];
  permissions?: string[];
  isSuperAdmin?: boolean;
}

interface SessionResponse {
  accessToken: string;
  accessTokenExpiresIn: number;
  user: SessionUser;
  profile: SessionProfile;
}

interface AuthContextValue {
  user: SessionUser | null;
  profile: SessionProfile | null;
  isAuthenticated: boolean;
  isBootstrapping: boolean;
  login: (input: { identifier: string; password: string; audience: Audience }) => Promise<SessionResponse>;
  logout: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
  hasRole: (role: string) => boolean;
  setSession: (session: SessionResponse) => void;
  /** Patch the cached user after they edit their own profile or picture. */
  updateUser: (patch: Partial<SessionUser>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * SESSION BOOTSTRAP
 * There is no access token in memory on first load, so we ask the server to
 * rotate the HttpOnly refresh cookie. A returning user stays signed in across
 * reloads without any credential ever being stored in localStorage.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [profile, setProfile] = useState<SessionProfile | null>(null);
  const [isBootstrapping, setBootstrapping] = useState(true);

  const updateUser = useCallback((patch: Partial<SessionUser>) => {
    setUser((previous) => (previous ? { ...previous, ...patch } : previous));
  }, []);

  const setSession = useCallback((session: SessionResponse) => {
    setAccessToken(session.accessToken);
    setUser(session.user);
    setProfile(session.profile);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await api.post<SessionResponse>('/auth/refresh', undefined, {
          skipAuthRefresh: true,
          retryOnUnauthorized: false,
        });
        if (!cancelled) setSession(session);
      } catch {
        if (!cancelled) setAccessToken(null);
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setSession]);

  const login = useCallback(
    async (input: { identifier: string; password: string; audience: Audience }) => {
      const session = await api.post<SessionResponse>('/auth/login', input, {
        skipAuthRefresh: true,
        retryOnUnauthorized: false,
      });
      setSession(session);
      return session;
    },
    [setSession],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', undefined, { skipAuthRefresh: true, retryOnUnauthorized: false });
    } catch {
      /* the cookie is cleared server-side; a network blip must not trap the user */
    }
    setAccessToken(null);
    setUser(null);
    setProfile(null);
  }, []);

  /**
   * The live channel follows the session: it opens when a user exists and closes on
   * sign-out, so no tab keeps a socket open for a user who has left. Suspension or a
   * global sign-out arrives as `session:revoked` and clears the session here.
   */
  useEffect(() => {
    if (!user) {
      disconnectLive();
      return;
    }
    connectLive();
  }, [user]);

  useEffect(() => {
    const onRevoked = () => {
      setAccessToken(null);
      setUser(null);
      setProfile(null);
    };
    window.addEventListener('live:session-revoked', onRevoked);
    return () => window.removeEventListener('live:session-revoked', onRevoked);
  }, []);

  const hasPermission = useCallback(
    (permission: string) => {
      const permissions = profile?.permissions ?? [];
      return permissions.includes('*') || permissions.includes(permission);
    },
    [profile],
  );

  const hasRole = useCallback((role: string) => (profile?.roles ?? []).includes(role), [profile]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      isAuthenticated: !!user,
      isBootstrapping,
      login,
      logout,
      hasPermission,
      hasRole,
      setSession,
      updateUser,
    }),
    [user, profile, isBootstrapping, login, logout, hasPermission, hasRole, setSession, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

export function useApiError(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof ApiError) return error.userMessage;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
