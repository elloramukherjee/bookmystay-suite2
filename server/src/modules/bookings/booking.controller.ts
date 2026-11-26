import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { requireScopedHotelId } from '../../middleware/authenticate.js';
import { AppError, unauthenticated } from '../../shared/errors.js';
import * as bookingService from './booking.service.js';
import { idempotencyKeySchema, type CreateBookingInput, type ListBookingsQuery, type ManualBookingInput } from './booking.validation.js';

export async function create(req: Request, res: Response): Promise<void> {
  const key = idempotencyKeySchema.parse(req.header('idempotency-key') ?? undefined);
  const result = await bookingService.createDirectBooking(req.body as CreateBookingInput, key, req);
  res
    .status(result.replayed ? 200 : 201)
    .json({ data: { booking: result.booking, guestToken: result.guestToken.token, guestTokenExpiresIn: result.guestToken.expiresIn } });
}

export async function createManual(req: Request, res: Response): Promise<void> {
  const hotelId = requireScopedHotelId(req, req.query.hotelId as string | undefined);
  res.status(201).json({ data: await bookingService.createManualBooking(req.auth!, hotelId, req.body as ManualBookingInput, req) });
}

export async function list(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListBookingsQuery & { hotelId?: string };
  const hotelId = requireScopedHotelId(req, query.hotelId);
  const { items, meta } = await bookingService.listBookings(hotelId, query);
  res.json({ data: items, meta });
}

/** Staff (scoped to their hotel) or the guest holding a token for exactly this booking. */
export async function get(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  if (req.auth) {
    const hotelId = requireScopedHotelId(req, req.query.hotelId as string | undefined);
    res.json({ data: await bookingService.getBookingForStaff(hotelId, id) });
    return;
  }
  if (req.guest?.bid === id) {
    res.json({ data: await bookingService.getBookingForGuest(id) });
    return;
  }
  // Same response whether the booking exists or not.
  if (req.guest) throw new AppError(404, 'NOT_FOUND', 'Booking not found');
  throw unauthenticated();
}

export async function noShow(req: Request, res: Response): Promise<void> {
  const hotelId = requireScopedHotelId(req, req.query.hotelId as string | undefined);
  const updated = await bookingService.markNoShow(req.auth!, hotelId, String(req.params.id), req);
  res.json({ data: await bookingService.toStaffView(updated) });
}

export async function cancel(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  const reason = (req.body as { reason?: string }).reason;
  if (req.auth) {
    if (!req.auth.permissions.has('bookings.manage')) throw new AppError(403, 'FORBIDDEN', 'You do not have permission to cancel bookings');
    const hotelId = requireScopedHotelId(req, req.query.hotelId as string | undefined);
    const b = await bookingService.getBookingLean(id);
    if (!b.hotelId.equals(hotelId)) throw new AppError(404, 'NOT_FOUND', 'Booking not found');
    const updated = await bookingService.cancelBooking(b._id, { type: 'staff', userId: req.auth.userId, role: req.auth.role }, reason, req);
    res.json({ data: await bookingService.toStaffView(updated) });
    return;
  }
  if (req.guest?.bid === id) {
    const updated = await bookingService.cancelBooking(new Types.ObjectId(id), { type: 'guest' }, reason, req);
    res.json({ data: await bookingService.toGuestView(updated) });
    return;
  }
  throw unauthenticated();
}

export async function confirm(req: Request, res: Response): Promise<void> {
  const hotelId = requireScopedHotelId(req, req.query.hotelId as string | undefined);
  res.json({ data: await bookingService.staffConfirm(req.auth!, hotelId, String(req.params.id)) });
}

export async function lookup(req: Request, res: Response): Promise<void> {
  const { reference, phone } = req.body as { reference: string; phone: string };
  const result = await bookingService.lookupBooking(reference, phone);
  res.json({ data: { booking: result.booking, guestToken: result.guestToken.token, guestTokenExpiresIn: result.guestToken.expiresIn } });
}
