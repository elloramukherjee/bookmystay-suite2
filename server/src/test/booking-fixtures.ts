import { randomUUID } from 'node:crypto';
import type { Types } from 'mongoose';
import { Room } from '../modules/rooms/room.model.js';
import { RatePlan } from '../modules/rooms/ratePlan.model.js';
import { RoomType } from '../modules/rooms/roomType.model.js';
import { addDays, todayInTimeZone } from '../utils/dates.js';
import { api } from './helpers.js';

export const today = () => todayInTimeZone('Asia/Kolkata');
export const dayFromNow = (n: number) => addDays(today(), n);

export async function createRoomTypeWithUnits(
  hotelId: Types.ObjectId,
  units = 1,
  overrides: Partial<{ baseRatePaise: number; otaRatePaise: number; maxAdults: number; maxOccupancy: number }> = {},
) {
  const slug = `deluxe-${randomUUID().slice(0, 6)}`;
  const rt = await RoomType.create({
    hotelId,
    name: 'Deluxe Courtyard Suite',
    slug,
    maxAdults: overrides.maxAdults ?? 2,
    maxChildren: 1,
    maxOccupancy: overrides.maxOccupancy ?? 3,
    baseRatePaise: overrides.baseRatePaise ?? 480_000,
    otaRatePaise: overrides.otaRatePaise ?? 590_000,
    totalRooms: units,
  });
  const prefix = Math.floor(Math.random() * 900 + 100);
  await Room.insertMany(Array.from({ length: units }, (_, i) => ({ hotelId, roomTypeId: rt._id, number: `${prefix}${i}` })));
  await RatePlan.create({ hotelId, roomTypeId: rt._id, name: 'Room only', code: 'EP', mealPlan: 'EP', isDefault: true });
  return rt;
}

export function bookingPayload(hotelId: Types.ObjectId, roomTypeId: Types.ObjectId, overrides: Record<string, unknown> = {}) {
  return {
    hotelId: String(hotelId),
    roomTypeId: String(roomTypeId),
    checkIn: dayFromNow(10),
    checkOut: dayFromNow(12),
    adults: 2,
    children: 0,
    rooms: 1,
    guest: { name: 'Rajesh Kumar', phone: '98112 34567', email: 'rajesh@test.example' },
    consent: { transactional: true, marketing: false },
    ...overrides,
  };
}

export async function createBookingViaApi(hotelId: Types.ObjectId, roomTypeId: Types.ObjectId, overrides: Record<string, unknown> = {}) {
  const res = await api()
    .post('/api/v1/bookings')
    .send(bookingPayload(hotelId, roomTypeId, overrides));
  if (res.status !== 201) throw new Error(`booking failed ${res.status} ${JSON.stringify(res.body)}`);
  return { booking: res.body.data.booking, guestToken: res.body.data.guestToken as string };
}
