export const STAFF_ROLES = ['super_admin', 'owner', 'manager', 'front_desk'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const PERMISSIONS = [
  'hotel.read',
  'hotel.update',
  'integrations.manage',
  'policies.manage',
  'staff.read',
  'staff.manage',
  'rooms.read',
  'rooms.manage',
  'rates.manage',
  'availability.manage',
  'bookings.read',
  'bookings.manage',
  'stays.manage',
  'guests.read',
  'guests.read_all',
  'guests.write',
  'finance.read',
  'conversations.read',
  'conversations.reply',
  'conversations.escalations',
  'campaigns.manage',
  'audit.read',
  'hotels.manage_all',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const FRONT_DESK: Permission[] = [
  'hotel.read',
  'rooms.read',
  'bookings.read',
  'stays.manage',
  'guests.read',
  'guests.write',
  'conversations.read',
  'conversations.reply',
];

const MANAGER: Permission[] = [
  ...FRONT_DESK,
  'staff.read',
  'rooms.manage',
  'rates.manage',
  'availability.manage',
  'bookings.manage',
  'guests.read_all',
  'conversations.escalations',
];

const OWNER: Permission[] = [
  ...MANAGER,
  'hotel.update',
  'integrations.manage',
  'policies.manage',
  'staff.manage',
  'finance.read',
  'campaigns.manage',
  'audit.read',
];

export const ROLE_PERMISSIONS: Record<StaffRole, ReadonlySet<Permission>> = {
  front_desk: new Set(FRONT_DESK),
  manager: new Set(MANAGER),
  owner: new Set(OWNER),
  super_admin: new Set(PERMISSIONS),
};

export function hasPermission(role: StaffRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function permissionsFor(role: StaffRole): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

/** Which roles an actor may create or assign. Owners cannot mint other owners; only super admins can. */
export const ASSIGNABLE_ROLES: Record<StaffRole, readonly StaffRole[]> = {
  super_admin: ['owner', 'manager', 'front_desk'],
  owner: ['manager', 'front_desk'],
  manager: [],
  front_desk: [],
};
