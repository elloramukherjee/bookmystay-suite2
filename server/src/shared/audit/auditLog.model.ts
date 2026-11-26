import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

const auditLogSchema = new Schema(
  {
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', default: null, index: true },
    actor: {
      type: { type: String, enum: ['user', 'guest', 'system', 'ai'], required: true },
      id: { type: Schema.Types.ObjectId, default: null },
      role: { type: String, default: null },
    },
    action: { type: String, required: true, maxlength: 80 },
    entity: {
      type: { type: String, default: null },
      id: { type: Schema.Types.ObjectId, default: null },
    },
    metadata: { type: Schema.Types.Mixed, default: {} },
    ipHash: { type: String, default: null },
    requestId: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

auditLogSchema.index({ hotelId: 1, createdAt: -1 });
auditLogSchema.index({ hotelId: 1, 'entity.type': 1, 'entity.id': 1 });
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 400 });

export type AuditLogDoc = InferSchemaType<typeof auditLogSchema> & { _id: Types.ObjectId };
export const AuditLog = model('AuditLog', auditLogSchema);
