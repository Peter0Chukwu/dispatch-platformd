import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Avatar, Badge, Button, ConfirmDialog } from '../components/ui';
import { BrandMark } from '../components/BrandMark';
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
  const location = useLocation();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  const needsVerification = user && (!user.emailVerified || !user.phoneVerified);
  const fullName = `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim();

  /**
   * Navigating closes the drawer, because on a phone the drawer *is* how you
   * navigate: leaving it open over the new page would look like the tap failed.
   */
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  /**
   * While the drawer is open the page behind it must not scroll, Escape must
   * close it, and focus must land inside it — otherwise a keyboard or screen
   * reader user is left tabbing through a page they cannot see.
   */
  useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrawerOpen(false);
        openerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [drawerOpen]);

  const closeDrawer = () => {
    setDrawerOpen(false);
    openerRef.current?.focus();
  };

  /** The list of links, rendered identically in the desktop rail and the drawer. */
  const navLinks = (onNavigate?: () => void) => (
    <nav className="flex-1 space-y-1 overflow-y-auto p-3">
      {nav.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
              isActive ? 'bg-brand-50 text-brand-900' : 'text-ink-600 hover:bg-ink-100',
            )
          }
        >
          <span>{item.label}</span>
          {item.soon && <span className="text-[10px] font-semibold uppercase text-ink-400">soon</span>}
        </NavLink>
      ))}
    </nav>
  );

  /** Signed-in identity plus sign-out. Same in both places, minus the confirm dialog. */
  const accountBlock = (onSignOut: () => void) => (
    <div className="border-t border-ink-200 p-3">
      <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
        <Avatar name={fullName} src={user?.avatarUrl} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink-900">{fullName}</p>
          <p className="truncate text-[11px] text-ink-500">{user?.email ?? user?.phone}</p>
        </div>
      </div>
      <Link
        to={`/${portal === 'Admin' ? 'admin' : portal === 'Rider' ? 'rider' : 'app'}/settings`}
        className="mt-1 flex w-full items-center rounded-lg px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100"
      >
        Profile &amp; settings
      </Link>
      <Button variant="ghost" size="sm" fullWidth className="mt-1 justify-start" onClick={onSignOut}>
        Sign out
      </Button>
    </div>
  );

  return (
    <div className="min-h-screen bg-ink-50 lg:flex">
      {/* ── Desktop rail (lg and up, unchanged) ───────────────────────────── */}
      <aside className="hidden w-64 shrink-0 border-r border-ink-200 bg-white lg:flex lg:flex-col">
        <div className="flex items-center gap-2.5 border-b border-ink-200 px-5 py-4">
          <BrandMark size="md" />
          <div>
            <p className="text-sm font-bold text-ink-900">Traders Welfare Logistics</p>
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-400">{portal} portal</p>
          </div>
        </div>
        {navLinks()}
        {accountBlock(() => setConfirmLogout(true))}
      </aside>

      {/* ── Drawer (below lg): every screen, not just the first four ──────── */}
      <div
        className={cn(
          'fixed inset-0 z-50 lg:hidden',
          drawerOpen ? 'pointer-events-auto' : 'pointer-events-none',
        )}
        aria-hidden={!drawerOpen}
      >
        <div
          className={cn(
            'absolute inset-0 bg-ink-950/50 transition-opacity duration-200',
            drawerOpen ? 'opacity-100' : 'opacity-0',
          )}
          onClick={closeDrawer}
        />
        <div
          id="portal-drawer"
          role="dialog"
          aria-modal="true"
          aria-label={`${portal} navigation`}
          className={cn(
            'absolute inset-y-0 left-0 flex w-[82%] max-w-xs flex-col bg-white shadow-xl transition-transform duration-200 ease-out',
            drawerOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <div className="flex items-center justify-between gap-2 border-b border-ink-200 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <BrandMark size="sm" />
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-ink-900">Traders Welfare</p>
                <p className="text-[11px] font-medium uppercase tracking-wide text-ink-400">{portal} portal</p>
              </div>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={closeDrawer}
              aria-label="Close menu"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          {profile?.isSuperAdmin && (
            <div className="border-b border-ink-200 px-4 py-2">
              <Badge tone="brand">Super admin</Badge>
            </div>
          )}

          {navLinks(closeDrawer)}
          {accountBlock(() => {
            setDrawerOpen(false);
            setConfirmLogout(true);
          })}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ── Top bar ─────────────────────────────────────────────────────── */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-ink-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
          {/* Small screens: picture + first name opens the whole menu. */}
          <button
            ref={openerRef}
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label={`Open menu — ${fullName || portal}`}
            aria-expanded={drawerOpen}
            aria-controls="portal-drawer"
            className="flex min-w-0 items-center gap-2 rounded-full py-1 pl-1 pr-3 text-left transition-colors hover:bg-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 lg:hidden"
          >
            <Avatar name={fullName} src={user?.avatarUrl} size="sm" />
            <span className="truncate text-sm font-semibold text-ink-900">{user?.firstName ?? portal}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="shrink-0 text-ink-400">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          {/* Large screens: unchanged. */}
          <div className="hidden items-center gap-2 lg:flex">
            <span className="text-sm font-semibold text-ink-900">TWL · {portal}</span>
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

        {/* Quick access. The drawer holds everything; these four are the ones
            people open all day and deserve a single tap. */}
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
