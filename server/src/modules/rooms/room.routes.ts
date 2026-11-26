import { Router } from 'express';
import { authenticate, authorize, requireScopedHotelId } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import * as roomService from './room.service.js';
import {
  createRoomTypeSchema,
  roomTypeIdParams,
  unitBody,
  unitIdParams,
  updateRoomTypeSchema,
  updateUnitSchema,
  type CreateRoomTypeInput,
  type UpdateRoomTypeInput,
  type UpdateUnitInput,
} from './room.validation.js';

/**
 * `/rooms` manages room *types* (the sellable categories guests see); `/rooms/:id/units` manages the
 * numbered physical rooms that make up a type's inventory.
 */
export const roomsRouter = Router();
roomsRouter.use(authenticate);

roomsRouter.get('/', authorize('rooms.read'), async (req, res) => {
  const hotelId = requireScopedHotelId(req, req.query.hotelId as string | undefined);
  res.json({ data: await roomService.listRoomTypesForStaff(hotelId) });
});

roomsRouter.post('/', authorize('rooms.manage'), validate({ body: createRoomTypeSchema }), async (req, res) => {
  const hotelId = requireScopedHotelId(req, req.query.hotelId as string | undefined);
  res.status(201).json({ data: await roomService.createRoomType(req.auth!, hotelId, req.body as CreateRoomTypeInput, req) });
});

roomsRouter.put('/:id', authorize('rooms.manage'), validate({ params: roomTypeIdParams, body: updateRoomTypeSchema }), async (req, res) => {
  const hotelId = requireScopedHotelId(req, req.query.hotelId as string | undefined);
  res.json({ data: await roomService.updateRoomType(req.auth!, hotelId, String(req.params.id), req.body as UpdateRoomTypeInput, req) });
});

roomsRouter.delete('/:id', authorize('rooms.manage'), validate({ params: roomTypeIdParams }), async (req, res) => {
  const hotelId = requireScopedHotelId(req, req.query.hotelId as string | undefined);
  await roomService.deactivateRoomType(req.auth!, hotelId, String(req.params.id), req);
  res.status(204).end();
});

roomsRouter.post('/:id/units', authorize('rooms.manage'), validate({ params: roomTypeIdParams, body: unitBody }), async (req, res) => {
  const hotelId = requireScopedHotelId(req, req.query.hotelId as string | undefined);
  res.status(201).json({ data: await roomService.addUnit(req.auth!, hotelId, String(req.params.id), req.body as { number: string; floor: string }, req) });
});

roomsRouter.patch('/units/:unitId', authorize('rooms.manage'), validate({ params: unitIdParams, body: updateUnitSchema }), async (req, res) => {
  const hotelId = requireScopedHotelId(req, req.query.hotelId as string | undefined);
  res.json({ data: await roomService.updateUnit(req.auth!, hotelId, String(req.params.unitId), req.body as UpdateUnitInput, req) });
});
