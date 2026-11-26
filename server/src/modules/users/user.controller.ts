import type { Request, Response } from 'express';
import { requireScopedHotelId } from '../../middleware/authenticate.js';
import * as userService from './user.service.js';
import type { ListUsersQuery, UpdateUserInput } from './user.validation.js';

export async function list(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListUsersQuery;
  const hotelId = requireScopedHotelId(req, query.hotelId);
  const { items, meta } = await userService.listStaff(hotelId, query);
  res.json({ data: items, meta });
}

export async function update(req: Request, res: Response): Promise<void> {
  const user = await userService.updateStaff(req.auth!, String(req.params.id), req.body as UpdateUserInput, req);
  res.json({ data: { user } });
}
