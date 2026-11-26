import type { ClientSession, Types } from 'mongoose';
import { supportsTransactions } from '../../config/db.js';
import { AppError } from '../../shared/errors.js';
import { stayNights } from '../../utils/dates.js';
import type { RoomTypeLean } from '../rooms/roomType.model.js';
import { Availability, type AvailabilityLean } from './availability.model.js';

export const roomUnavailable = (details?: unknown) =>
  new AppError(409, 'ROOM_UNAVAILABLE', 'Sorry, this room type is no longer available for your dates.', details);

/**
 * Lazily materialises per-night inventory documents. Upserts with $setOnInsert are idempotent and safe
 * under concurrency (the unique index turns a racing insert into a no-op update).
 */
export async function ensureNights(
  hotelId: Types.ObjectId,
  roomType: Pick<RoomTypeLean, '_id' | 'totalRooms'>,
  dates: string[],
  session?: ClientSession,
): Promise<void> {
  if (!dates.length) return;
  await Availability.bulkWrite(
    dates.map((date) => ({
      updateOne: {
        filter: { hotelId, roomTypeId: roomType._id, date },
        update: {
          $setOnInsert: {
            hotelId,
            roomTypeId: roomType._id,
            date,
            totalRooms: roomType.totalRooms,
            sold: 0,
            held: 0,
            blocked: 0,
            ratePaise: null,
            stopSell: false,
            minStay: 1,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false, session },
  );
}

export async function loadNights(hotelId: Types.ObjectId, roomTypeId: Types.ObjectId, dates: string[], session?: ClientSession): Promise<AvailabilityLean[]> {
  const docs = await Availability.find({ hotelId, roomTypeId, date: { $in: dates } }, null, { session }).lean();
  const byDate = new Map(docs.map((d) => [d.date, d]));
  return dates.map((d) => {
    const doc = byDate.get(d);
    if (!doc) throw new AppError(500, 'INTERNAL', `Inventory missing for ${d}`);
    return doc;
  });
}

export const freeRooms = (n: Pick<AvailabilityLean, 'totalRooms' | 'sold' | 'held' | 'blocked' | 'stopSell'>) =>
  n.stopSell ? 0 : Math.max(0, n.totalRooms - n.sold - n.held - n.blocked);

export const nightlyRate = (n: Pick<AvailabilityLean, 'ratePaise'>, roomType: Pick<RoomTypeLean, 'baseRatePaise'>) => n.ratePaise ?? roomType.baseRatePaise;

type Counter = 'held' | 'sold';

/**
 * Atomically reserves `qty` rooms for every night, or none. Each night is a single guarded update:
 *   matched only if stopSell = false AND sold + held + blocked + qty <= totalRooms
 * so two concurrent bookings for the last room cannot both succeed — with or without transactions.
 * Without a transaction, nights already taken are compensated (released) before failing.
 */
export async function reserve(
  hotelId: Types.ObjectId,
  roomTypeId: Types.ObjectId,
  dates: string[],
  qty: number,
  counter: Counter,
  session?: ClientSession,
): Promise<void> {
  const taken: string[] = [];
  for (const date of dates) {
    const res = await Availability.updateOne(
      {
        hotelId,
        roomTypeId,
        date,
        stopSell: false,
        $expr: { $lte: [{ $add: ['$sold', '$held', '$blocked', qty] }, '$totalRooms'] },
      },
      { $inc: { [counter]: qty } },
      { session },
    );
    if (res.matchedCount === 0) {
      if (!session || !supportsTransactions()) {
        await adjust(hotelId, roomTypeId, taken, { [counter]: -qty });
      }
      throw roomUnavailable({ date });
    }
    taken.push(date);
  }
}

/** Unguarded counter moves for inventory that this booking already owns (release, held → sold). */
export async function adjust(
  hotelId: Types.ObjectId,
  roomTypeId: Types.ObjectId,
  dates: string[],
  inc: Partial<Record<'held' | 'sold', number>>,
  session?: ClientSession,
): Promise<void> {
  if (!dates.length) return;
  await Availability.updateMany({ hotelId, roomTypeId, date: { $in: dates } }, { $inc: inc }, { session });
  // Defensive floor: counters must never go negative even if a release is replayed.
  await Availability.updateMany(
    { hotelId, roomTypeId, date: { $in: dates }, $or: [{ held: { $lt: 0 } }, { sold: { $lt: 0 } }] },
    [{ $set: { held: { $max: ['$held', 0] }, sold: { $max: ['$sold', 0] } } }],
    { session },
  );
}

export function nightsFor(checkIn: string, checkOut: string): string[] {
  return stayNights(checkIn, checkOut);
}
