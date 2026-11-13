import type { NavItem } from '../../layouts/PortalShell';

/** The rider portal navigation, shared by every rider screen. */
export const RIDER_NAV: NavItem[] = [
  { to: '/rider', label: 'Overview' },
  { to: '/rider/offers', label: 'Offers' },
  { to: '/rider/active', label: 'Active job' },
  { to: '/rider/earnings', label: 'Earnings' },
  { to: '/rider/documents', label: 'Documents' },
  { to: '/rider/settings', label: 'Settings' },
];
