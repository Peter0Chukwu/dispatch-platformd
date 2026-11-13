import type { NavItem } from '../../layouts/PortalShell';

/** The customer portal navigation, shared by every customer screen. */
export const CUSTOMER_NAV: NavItem[] = [
  { to: '/app', label: 'Overview' },
  { to: '/app/book', label: 'Book a rider' },
  { to: '/app/deliveries', label: 'Deliveries' },
  { to: '/app/wallet', label: 'Wallet' },
  // Last on purpose: the bottom bar takes the first four, and settings is not a
  // thing anybody opens ten times a day.
  { to: '/app/settings', label: 'Settings' },
];
