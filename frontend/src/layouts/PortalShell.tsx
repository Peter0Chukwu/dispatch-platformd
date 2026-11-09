import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Avatar, Badge, Button, ConfirmDialog } from '../components/ui';
import { LiveIndicator } from '../components/LiveIndicator';
import { cn } from '../lib/cn';

export interface NavItem {
  to: string;
  label: string;
  icon?: React.ReactNode;
  soon?: boolean;
}

export function PortalShell({
  portal,
  nav,
  children,
}: {
  portal: 'Customer' | 'Rider' | 'Admin';
  nav: NavItem[];
  children: React.ReactNode;
}) {
  const { user, profile, logout } = useAuth();
  const navigate = useNavigate();
  const [confirmLogout, setConfirmLogout] = useState(false);

  const needsVerification = user && (!user.emailVerified || !user.phoneVerified);

  return (
    <div className="min-h-screen bg-ink-50 lg:flex">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-64 shrink-0 border-r border-ink-200 bg-white lg:flex lg:flex-col">
        <div className="flex items-center gap-2.5 border-b border-ink-200 px-5 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-900 text-accent-400">
            <svg width="18" height="18" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 23h20M10 23v-9h8l5 5v4" />
            </svg>
          </span>
          <div>
            <p className="text-sm font-bold text-ink-900">Traders Welfare</p>
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-400">Logistics . {portal}</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive }) =>
                cn(
                  'flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive ? 'bg-brand-50 text-brand-900' : 'text-ink-600 hover:bg-ink-100',
                )
              }
            >
              <span>{item.label}</span>
              {item.soon && <span className="text-[10px] font-semibold uppercase text-ink-400">soon</span>}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-ink-200 p-3">
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
            <Avatar name={`${user?.firstName ?? ''} ${user?.lastName ?? ''}`} src={user?.avatarUrl} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink-900">
                {user?.firstName} {user?.lastName}
              </p>
              <p className="truncate text-[11px] text-ink-500">{user?.email ?? user?.phone}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" fullWidth className="mt-1 justify-start" onClick={() => setConfirmLogout(true)}>
            Sign out
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-ink-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-ink-900 lg:hidden">Traders Welfare Logistics · {portal}</span>
            {profile?.isSuperAdmin && <Badge tone="brand">Super admin</Badge>}
            {profile?.roles
              ?.filter((role) => !(role === 'SUPER_ADMIN' && profile?.isSuperAdmin))
              .slice(0, 2)
              .map((role) => (
                <Badge key={role} tone="neutral">
                  {role.replace(/_/g, ' ').toLowerCase()}
                </Badge>
              ))}
          </div>
          <div className="flex items-center gap-2">
            <Link to="/styleguide" className="hidden text-xs font-medium text-ink-500 hover:text-ink-800 sm:block">
              Design system
            </Link>
            <LiveIndicator />
            <Button variant="secondary" size="sm" onClick={() => setConfirmLogout(true)}>
              Sign out
            </Button>
          </div>
        </header>

        {needsVerification && (
          <div className="border-b border-warning-200 bg-warning-50 px-4 py-2.5 text-center text-[13px] font-medium text-warning-800 sm:px-6">
            {!user?.emailVerified && 'Your email address is not verified. '}
            {!user?.phoneVerified && 'Your phone number is not verified. '}
            <Link to="/verify" className="font-semibold underline">
              Verify now
            </Link>
          </div>
        )}

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>

        {/* Mobile bottom nav */}
        <nav className="sticky bottom-0 flex border-t border-ink-200 bg-white lg:hidden">
          {nav.slice(0, 4).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive }) =>
                cn(
                  'flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium',
                  isActive ? 'text-brand-900' : 'text-ink-500',
                )
              }
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', 'bg-current opacity-40')} />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <ConfirmDialog
        open={confirmLogout}
        onClose={() => setConfirmLogout(false)}
        onConfirm={async () => {
          setConfirmLogout(false);
          await logout();
          navigate('/login');
        }}
        title="Sign out?"
        message="Your session on this device will end. Any unsaved changes will be lost."
        confirmLabel="Sign out"
      />
    </div>
  );
}
