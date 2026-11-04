import type { NavItem } from '../../layouts/PortalShell';

/** The customer portal navigation, shared by every customer screen. */
export const CUSTOMER_NAV: NavItem[] = [
  { to: '/app', label: 'Overview' },
  { to: '/app/book', label: 'Book a rider' },
  { to: '/app/deliveries', label: 'Deliveries' },
  { to: '/app/wallet', label: 'Wallet', soon: true },
];
