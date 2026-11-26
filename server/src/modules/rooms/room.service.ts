import type { Request } from 'express';
import type { Types } from 'mongoose';
import { audit } from '../../shared/audit/audit.service.js';
import { AppError, conflict, notFound } from '../../shared/errors.js';
import type { AuthContext } from '../../types/express.js';
import { todayInTimeZone } from '../../utils/dates.js';
import { Availability } from '../availability/availability.model.js';
import { toPublicRoomType } from '../availability/inventory.service.js';
import { Hotel } from '../hotels/hotel.model.js';
import { RatePlan } from './ratePlan.model.js';
import { Room } from './room.model.js';
import type { CreateRoomTypeInput, UpdateRoomTypeInput, UpdateUnitInput } from './room.validation.js';
import { RoomType, type RoomTypeLean } from './roomType.model.js';

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70) || 'room';

export async function listPublicRoomTypes(hotelId: string) {
  const hotel = await Hotel.findOne({ _id: hotelId, status: 'active' }).select('_id').lean();
  if (!hotel) throw notFound('Hotel');
  const types = await RoomType.find({ hotelId: hotel._id, isActive: true }).sort({ sortOrder: 1, name: 1 }).lean();
  return types.map(toPublicRoomType);
}

export async function listRoomTypesForStaff(hotelId: Types.ObjectId) {
  const [types, units, plans] = await Promise.all([
    RoomType.find({ hotelId }).sort({ isActive: -1, sortOrder: 1, name: 1 }).lean(),
    Room.find({ hotelId }).sort({ number: 1 }).lean(),
    RatePlan.find({ hotelId, isActive: true }).lean(),
  ]);
  return types.map((t) => ({
    ...toPublicRoomType(t),
    isActive: t.isActive,
    sortOrder: t.sortOrder,
    totalRooms: t.totalRooms,
    units: units
      .filter((u) => u.roomTypeId.equals(t._id))
      .map((u) => ({ id: String(u._id), number: u.number, floor: u.floor, status: u.status, isActive: u.isActive })),
    ratePlans: plans
      .filter((p) => p.roomTypeId.equals(t._id))
      .map((p) => ({ id: String(p._id), name: p.name, code: p.code, mealPlan: p.mealPlan, adjustmentPaise: p.adjustmentPaise })),
  }));
}

/**
 * Keeps RoomType.totalRooms, future Availability.totalRooms and Hotel.totalRooms in step with the active
 * physical rooms. Refuses a reduction that would leave any future night with more rooms sold/held/blocked
 * than physically exist.
 */
async function syncInventory(hotelId: Types.ObjectId, roomTypeId: Types.ObjectId, delta: number): Promise<void> {
  const hotel = await Hotel.findById(hotelId).select('timezone').lean();
  const today = todayInTimeZone(hotel?.timezone ?? 'Asia/Kolkata');
  const count = await Room.countDocuments({ hotelId, roomTypeId, isActive: true });

  if (delta < 0) {
    const clash = await Availability.findOne({
      hotelId,
      roomTypeId,
      date: { $gte: today },
      $expr: { $gt: [{ $add: ['$sold', '$held', '$blocked'] }, count] },
    }).lean();
    if (clash) throw conflict(`Can't remove this room: ${clash.date} already has ${clash.sold + clash.held} bookings for this room type.`);
  }

  await RoomType.updateOne({ _id: roomTypeId }, { $set: { totalRooms: count } });
  await Availability.updateMany({ hotelId, roomTypeId, date: { $gte: today } }, { $set: { totalRooms: count } });
  const totalActive = await Room.countDocuments({ hotelId, isActive: true });
  if (totalActive > 0) await Hotel.updateOne({ _id: hotelId }, { $set: { totalRooms: totalActive } });
}

export async function createRoomType(actor: AuthContext, hotelId: Types.ObjectId, input: CreateRoomTypeInput, req: Request) {
  const { unitNumbers, ...data } = input;
  let slug = slugify(data.name);
  if (await RoomType.exists({ hotelId, slug })) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  const duplicateUnits = await Room.find({ hotelId, number: { $in: unitNumbers } })
    .select('number')
    .lean();
  if (duplicateUnits.length) throw conflict(`Room number already in use: ${duplicateUnits.map((u) => u.number).join(', ')}`);

  const rt = await RoomType.create({ ...data, hotelId, slug, totalRooms: 0 });
  if (unitNumbers.length) await Room.insertMany(unitNumbers.map((number) => ({ hotelId, roomTypeId: rt._id, number })));
  await RatePlan.create({ hotelId, roomTypeId: rt._id, name: 'Room only', code: 'EP', mealPlan: 'EP', adjustmentPaise: 0, isDefault: true });
  await syncInventory(hotelId, rt._id, unitNumbers.length);

  await audit({
    hotelId,
    actor: { type: 'user', id: actor.userId, role: actor.role },
    action: 'room_type.created',
    entity: { type: 'RoomType', id: rt._id },
    req,
  });
  return (await listRoomTypesForStaff(hotelId)).find((t) => t.id === String(rt._id));
}

export async function updateRoomType(actor: AuthContext, hotelId: Types.ObjectId, id: string, input: UpdateRoomTypeInput, req: Request) {
  const rt = await RoomType.findOne({ _id: id, hotelId });
  if (!rt) throw notFound('Room type');
  const next = { ...rt.toObject(), ...input } as RoomTypeLean;
  if (next.maxOccupancy < next.maxAdults)
    throw new AppError(400, 'VALIDATION_ERROR', 'Max occupancy must be at least max adults', [{ path: 'maxOccupancy', message: 'Too low' }]);
  rt.set(input);
  await rt.save();
  await audit({
    hotelId,
    actor: { type: 'user', id: actor.userId, role: actor.role },
    action: 'room_type.updated',
    entity: { type: 'RoomType', id: rt._id },
    metadata: { fields: Object.keys(input) },
    req,
  });
  return (await listRoomTypesForStaff(hotelId)).find((t) => t.id === String(rt._id));
}

/** Soft delete: the room type stops selling; existing bookings are untouched. */
export async function deactivateRoomType(actor: AuthContext, hotelId: Types.ObjectId, id: string, req: Request) {
  const rt = await RoomType.findOneAndUpdate({ _id: id, hotelId }, { $set: { isActive: false } }, { new: true });
  if (!rt) throw notFound('Room type');
  await audit({
    hotelId,
    actor: { type: 'user', id: actor.userId, role: actor.role },
    action: 'room_type.deactivated',
    entity: { type: 'RoomType', id: rt._id },
    req,
  });
}

export async function addUnit(actor: AuthContext, hotelId: Types.ObjectId, roomTypeId: string, input: { number: string; floor: string }, req: Request) {
  const rt = await RoomType.findOne({ _id: roomTypeId, hotelId }).lean();
  if (!rt) throw notFound('Room type');
  if (await Room.exists({ hotelId, number: input.number })) throw conflict(`Room ${input.number} already exists`);
  const unit = await Room.create({ hotelId, roomTypeId: rt._id, number: input.number, floor: input.floor });
  await syncInventory(hotelId, rt._id, 1);
  await audit({ hotelId, actor: { type: 'user', id: actor.userId, role: actor.role }, action: 'room.created', entity: { type: 'Room', id: unit._id }, req });
  return { id: String(unit._id), number: unit.number, floor: unit.floor, status: unit.status, isActive: unit.isActive };
}

export async function updateUnit(actor: AuthContext, hotelId: Types.ObjectId, unitId: string, input: UpdateUnitInput, req: Request) {
  const unit = await Room.findOne({ _id: unitId, hotelId });
  if (!unit) throw notFound('Room');
  if (input.number && input.number !== unit.number && (await Room.exists({ hotelId, number: input.number })))
    throw conflict(`Room ${input.number} already exists`);
  const wasActive = unit.isActive;
  unit.set(input);
  if (input.isActive === false && wasActive) {
    // Validate before persisting: count as if already deactivated.
    unit.isActive = false;
    await unit.save();
    try {
      await syncInventory(hotelId, unit.roomTypeId, -1);
    } catch (err) {
      await Room.updateOne({ _id: unit._id }, { $set: { isActive: true } });
      throw err;
    }
  } else {
    await unit.save();
    if (input.isActive === true && !wasActive) await syncInventory(hotelId, unit.roomTypeId, 1);
  }
  await audit({
    hotelId,
    actor: { type: 'user', id: actor.userId, role: actor.role },
    action: 'room.updated',
    entity: { type: 'Room', id: unit._id },
    metadata: { fields: Object.keys(input) },
    req,
  });
  return { id: String(unit._id), number: unit.number, floor: unit.floor, status: unit.status, isActive: unit.isActive };
}
