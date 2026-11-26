import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * Opaque refresh tokens. Only the SHA-256 hash is stored; the raw value lives solely in the guest's
 * httpOnly cookie. Tokens rotate on every use and share a `familyId` — presenting an already-rotated
 * token is treated as theft and revokes the whole family.
 */
const refreshTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', default: null },
    tokenHash: { type: String, required: true },
    familyId: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    replacedByHash: { type: String, default: null },
    userAgent: { type: String, default: null, maxlength: 300 },
    ipHash: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);

refreshTokenSchema.index({ tokenHash: 1 }, { unique: true });
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type RefreshTokenAttrs = InferSchemaType<typeof refreshTokenSchema>;
export const RefreshToken = model('RefreshToken', refreshTokenSchema);
