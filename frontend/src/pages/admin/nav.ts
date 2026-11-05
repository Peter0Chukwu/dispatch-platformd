import type { NavItem } from "../../layouts/PortalShell";

/**
 * ADMIN NAVIGATION
 *
 * Items are hidden when the signed-in role lacks the permission the destination
 * screen needs — hiding is courtesy, not security; the API refuses the request
 * anyway. Keeping the mapping in one place means a new screen cannot forget it.
 */
const ALL: Array<NavItem & { permission?: string }> = [
  { to: "/admin", label: "Overview", permission: "dashboard:read" },
  { to: "/admin/dispatch", label: "Dispatch board", permission: "delivery:read" },
  { to: "/admin/deliveries", label: "Deliveries", permission: "delivery:read" },
  { to: "/admin/riders", label: "Riders", permission: "rider:read" },
  { to: "/admin/customers", label: "Customers", permission: "customer:read" },
  { to: "/admin/finance", label: "Finance", permission: "finance:read" },
  { to: "/admin/pricing", label: "Pricing", permission: "pricing:read" },
  { to: "/admin/staff", label: "Staff & roles", permission: "staff:read" },
  { to: "/admin/audit", label: "Audit trail", permission: "audit:read" },
];

export function adminNav(
  hasPermission: (permission: string) => boolean,
): NavItem[] {
  return ALL.filter(
    (item) => !item.permission || hasPermission(item.permission),
  ).map(({ permission, ...item }) => item);
}
