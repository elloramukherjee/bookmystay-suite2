import { z } from 'zod';
import { addDays, diffDays, isIsoDay, todayInTimeZone } from '../../utils/dates.js';
import { AppError } from '../../shared/errors.js';

export const MAX_NIGHTS = 30;
export const MAX_DAYS_AHEAD = 365;
export const MAX_ROOMS_PER_BOOKING = 5;

export const isoDay = z.string().refine(isIsoDay, 'Use a valid date (YYYY-MM-DD)');

export const stayQuery = {
  checkIn: isoDay,
  checkOut: isoDay,
  adults: z.coerce.number().int().min(1).max(20).default(2),
  children: z.coerce.number().int().min(0).max(10).default(0),
  rooms: z.coerce.number().int().min(1).max(MAX_ROOMS_PER_BOOKING).default(1),
};

/** Business-rule checks that depend on the hotel's local "today". */
export function assertBookableStay(checkIn: string, checkOut: string, timeZone: string, now = new Date()): number {
  const today = todayInTimeZone(timeZone, now);
  const nights = diffDays(checkIn, checkOut);
  const issues: { path: string; message: string }[] = [];
  if (checkIn < today) issues.push({ path: 'checkIn', message: 'Check-in cannot be in the past' });
  if (checkIn > addDays(today, MAX_DAYS_AHEAD)) issues.push({ path: 'checkIn', message: `Bookings open up to ${MAX_DAYS_AHEAD} days ahead` });
  if (nights < 1) issues.push({ path: 'checkOut', message: 'Check-out must be after check-in' });
  if (nights > MAX_NIGHTS) issues.push({ path: 'checkOut', message: `Stays are limited to ${MAX_NIGHTS} nights online. Please contact the hotel.` });
  if (issues.length) throw new AppError(400, 'VALIDATION_ERROR', issues[0]!.message, issues);
  return nights;
}

export function fitsOccupancy(
  roomType: { maxAdults: number; maxChildren: number; maxOccupancy: number },
  adults: number,
  children: number,
  rooms: number,
): boolean {
  return (
    adults <= roomType.maxAdults * rooms && children <= roomType.maxChildren * rooms && adults + children <= roomType.maxOccupancy * rooms && adults >= rooms
  );
}
