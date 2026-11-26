import type { Types } from 'mongoose';
import type { Permission, StaffRole } from '../modules/auth/permissions.js';

export interface AuthContext {
  userId: Types.ObjectId;
  role: StaffRole;
  /** null only for super_admin, who is not bound to a property. */
  hotelId: Types.ObjectId | null;
  permissions: ReadonlySet<Permission>;
}

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthContext;
    }
  }
}

export {};
