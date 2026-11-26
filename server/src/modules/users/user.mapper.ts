import type { StaffRole } from '../auth/permissions.js';

export interface PublicUser {
  id: string;
  hotelId: string | null;
  name: string;
  email: string;
  phone: string | null;
  role: StaffRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string | null;
}

interface UserLike {
  _id: unknown;
  hotelId?: unknown;
  name: string;
  email: string;
  phone?: string | null;
  role: string;
  isActive: boolean;
  lastLoginAt?: Date | null;
  createdAt?: Date | null;
}

/** Explicit allow-list of fields that may leave the API. Never spread a user document into a response. */
export function toPublicUser(u: UserLike): PublicUser {
  return {
    id: String(u._id),
    hotelId: u.hotelId ? String(u.hotelId) : null,
    name: u.name,
    email: u.email,
    phone: u.phone ?? null,
    role: u.role as StaffRole,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    createdAt: u.createdAt ? u.createdAt.toISOString() : null,
  };
}
