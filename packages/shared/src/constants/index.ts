export const CURRENCY = 'NGN' as const;
export const TIMEZONE = 'Africa/Lagos' as const;

/** Package categories — administrators can extend this list via pricing settings. */
export const PACKAGE_CATEGORIES = [
  { value: 'DOCUMENTS', label: 'Documents' },
  { value: 'FOOD', label: 'Food & drinks' },
  { value: 'ELECTRONICS', label: 'Electronics' },
  { value: 'CLOTHING', label: 'Clothing & fashion' },
  { value: 'PHARMACEUTICALS', label: 'Pharmaceuticals' },
  { value: 'COSMETICS', label: 'Cosmetics' },
  { value: 'GROCERIES', label: 'Groceries' },
  { value: 'FRAGILE', label: 'Fragile item' },
  { value: 'BULKY', label: 'Bulky / large item' },
  { value: 'OTHER', label: 'Other' },
] as const;

export type PackageCategory = (typeof PACKAGE_CATEGORIES)[number]['value'];

/** States used in address forms (36 + FCT). */
export const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT - Abuja', 'Gombe',
  'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos',
  'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto',
  'Taraba', 'Yobe', 'Zamfara',
] as const;

/**
 * PERMISSIONS — the atomic capabilities the API checks.
 * Seeded into the `permissions` table; granted to roles via `role_permissions`.
 * Format: "resource:action".
 */
export const PERMISSIONS = [
  // dashboard / read
  'dashboard:read',
  'delivery:read',
  'delivery:assign',
  'delivery:cancel',
  'delivery:override',
  'delivery:export',
  'rider:read',
  'rider:approve',
  'rider:suspend',
  'rider:document:read',
  'rider:commission:write',
  'rider:adjustment:write',
  'customer:read',
  'customer:suspend',
  'finance:read',
  'finance:refund:write',
  'withdrawal:read',
  'withdrawal:approve',
  'withdrawal:payout',
  'expense:write',
  'ledger:read',
  'pricing:read',
  'pricing:write',
  'promotion:write',
  'zone:write',
  'report:generate',
  'notification:read',
  'notification:broadcast',
  'support:read',
  'support:write',
  'staff:read',
  'staff:write',
  'role:write',
  'settings:read',
  'settings:write',
  'audit:read',
  'tracking:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_KEYS = [
  'SUPER_ADMIN',
  'OPERATIONS_MANAGER',
  'FINANCE_MANAGER',
  'RIDER_MANAGER',
  'SUPPORT_AGENT',
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

/**
 * DEFAULT ROLE MATRIX — the starting grants, seedable and editable later
 * from the admin Staff & Permissions screen.
 *
 * Read carefully: support agents deliberately have NO financial write access,
 * and only SUPER_ADMIN + FINANCE_MANAGER can approve withdrawals or change pricing.
 */
export const ROLE_PERMISSIONS: Record<RoleKey, readonly Permission[]> = {
  SUPER_ADMIN: PERMISSIONS,
  OPERATIONS_MANAGER: [
    'dashboard:read', 'delivery:read', 'delivery:assign', 'delivery:cancel', 'delivery:override',
    'delivery:export', 'rider:read', 'rider:approve', 'rider:suspend', 'rider:document:read',
    'rider:commission:write', 'customer:read', 'pricing:read', 'zone:write', 'report:generate',
    'notification:read', 'support:read', 'support:write', 'staff:read', 'tracking:read',
    'withdrawal:read', 'finance:read',
  ],
  FINANCE_MANAGER: [
    'dashboard:read', 'delivery:read', 'delivery:export', 'finance:read', 'finance:refund:write',
    'withdrawal:read', 'withdrawal:approve', 'withdrawal:payout', 'expense:write', 'ledger:read',
    'pricing:read', 'pricing:write', 'promotion:write', 'report:generate', 'rider:read',
    'customer:read', 'notification:read', 'audit:read',
  ],
  RIDER_MANAGER: [
    'dashboard:read', 'delivery:read', 'delivery:assign', 'rider:read', 'rider:approve',
    'rider:suspend', 'rider:document:read', 'rider:adjustment:write', 'rider:commission:write',
    'customer:read', 'support:read', 'support:write', 'notification:read', 'tracking:read',
    'report:generate', 'delivery:export',
  ],
  SUPPORT_AGENT: [
    'dashboard:read', 'delivery:read', 'customer:read', 'rider:read', 'support:read',
    'support:write', 'notification:read', 'delivery:export',
  ],
};

export const STAFF_PERMISSION_DENYLIST_NOTE =
  'Support agents cannot modify financial records, approve withdrawals, change pricing or suspend accounts.';
