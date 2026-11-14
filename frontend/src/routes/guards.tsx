import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth, type Audience } from '../contexts/AuthContext';
import { FullPageLoader } from '../components/ui';

/**
 * ROUTE GUARDS
 *
 * These decide what a browser SHOWS. They are not security: every rule here is
 * enforced again by the API (a rider calling /admin/whoami gets a 403 even with a
 * perfectly forged React state).
 */
export function RequireAuth({ audience }: { audience: Audience }) {
  const { isAuthenticated, isBootstrapping, user } = useAuth();
  const location = useLocation();

  if (isBootstrapping) return <FullPageLoader label="Restoring your session…" />;
  if (!isAuthenticated) {
    // Staff sign in at their own unlisted page; customers and riders at /login.
    const destination = audience === 'ADMIN' ? '/staff' : `/login?portal=${audience.toLowerCase()}`;
    return <Navigate to={destination} replace state={{ from: location.pathname }} />;
  }

  const expectedType = audience === 'ADMIN' ? 'STAFF' : audience;
  if (user?.type !== expectedType) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}

export function RequirePermission({ permission }: { permission: string }) {
  const { hasPermission } = useAuth();
  if (!hasPermission(permission)) {
    return (
      <div className="card-surface mx-auto mt-10 max-w-md p-6 text-center">
        <p className="text-sm font-semibold text-ink-900">Access restricted</p>
        <p className="mt-1 text-sm text-ink-500">
          Your role does not include the <code className="rounded bg-ink-100 px-1">{permission}</code> permission.
          Ask an administrator if you need it.
        </p>
      </div>
    );
  }
  return <Outlet />;
}

/** Sends already-signed-in users away from the login/register screens. */
export function RedirectIfAuthenticated({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isBootstrapping, user } = useAuth();
  if (isBootstrapping) return <FullPageLoader />;
  if (isAuthenticated && user) {
    const home = user.type === 'STAFF' ? '/admin' : user.type === 'RIDER' ? '/rider' : '/app';
    return <Navigate to={home} replace />;
  }
  return <>{children}</>;
}
