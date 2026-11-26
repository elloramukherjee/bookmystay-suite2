import { Schema, model, type HydratedDocument, type InferSchemaType, type Types } from 'mongoose';
import { STAFF_ROLES } from '../auth/permissions.js';

const userSchema = new Schema(
  {
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', default: null },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    phone: { type: String, default: null },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: STAFF_ROLES, required: true },
    isActive: { type: Boolean, default: true },
    /** Incremented on deactivation / role change / password change to invalidate outstanding access tokens. */
    tokenVersion: { type: Number, default: 0 },
    lastLoginAt: { type: Date, default: null },
    failedLoginCount: { type: Number, default: 0, select: false },
    lockedUntil: { type: Date, default: null, select: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = String(ret._id);
        delete ret._id;
        delete ret.__v;
        delete ret.passwordHash;
        delete ret.failedLoginCount;
        delete ret.lockedUntil;
        delete ret.tokenVersion;
        return ret;
      },
    },
  },
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ hotelId: 1, role: 1 });

userSchema.pre('validate', function enforceHotelBinding(next) {
  if (this.role !== 'super_admin' && !this.hotelId) {
    next(new Error('Non-super-admin users must belong to a hotel'));
    return;
  }
  next();
});

export type UserAttrs = InferSchemaType<typeof userSchema>;
export type UserDocument = HydratedDocument<UserAttrs>;
export type UserId = Types.ObjectId;
export const User = model('User', userSchema);
