import { z } from 'zod';
import { objectIdSchema } from '../auth/auth.validation.js';
import { ROOM_STATUSES } from './room.model.js';

const httpsUrl = z.url({ protocol: /^https$/ }).max(2048);
const rupeesInPaise = z.number().int().min(10_000, 'Minimum ₹100').max(100_000_000);

export const roomTypeBody = z.strictObject({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(1000).default(''),
  sizeSqft: z.number().int().min(50).max(10_000).nullable().optional(),
  maxAdults: z.number().int().min(1).max(10),
  maxChildren: z.number().int().min(0).max(10).default(0),
  maxOccupancy: z.number().int().min(1).max(12),
  bedType: z.string().trim().max(60).default(''),
  view: z.string().trim().max(80).default(''),
  amenities: z.array(z.string().trim().min(2).max(40)).max(20).default([]),
  photos: z
    .array(z.strictObject({ url: httpsUrl, alt: z.string().trim().min(3).max(240) }))
    .max(12)
    .default([]),
  tags: z.array(z.string().trim().min(2).max(40)).max(6).default([]),
  directPrivilege: z.string().trim().max(160).default(''),
  baseRatePaise: rupeesInPaise,
  otaRatePaise: z.number().int().min(0).max(100_000_000).nullable().optional(),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});

export const createRoomTypeSchema = roomTypeBody
  .extend({ unitNumbers: z.array(z.string().trim().min(1).max(10)).max(100).default([]) })
  .refine((v) => v.maxOccupancy >= v.maxAdults, { message: 'Max occupancy must be at least max adults', path: ['maxOccupancy'] });

export const updateRoomTypeSchema = roomTypeBody
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const unitBody = z.strictObject({
  number: z.string().trim().min(1).max(10),
  floor: z.string().trim().max(20).default(''),
});

export const updateUnitSchema = z
  .strictObject({
    number: z.string().trim().min(1).max(10).optional(),
    floor: z.string().trim().max(20).optional(),
    status: z.enum(ROOM_STATUSES).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const roomTypeIdParams = z.object({ id: objectIdSchema });
export const unitIdParams = z.object({ unitId: objectIdSchema });
export const hotelIdParams = z.object({ id: objectIdSchema });

export type CreateRoomTypeInput = z.infer<typeof createRoomTypeSchema>;
export type UpdateRoomTypeInput = z.infer<typeof updateRoomTypeSchema>;
export type UpdateUnitInput = z.infer<typeof updateUnitSchema>;
