import type { Request, Response } from 'express';
import { assertHotelAccess } from '../../middleware/authenticate.js';
import * as hotelService from './hotel.service.js';
import type { PolicyType } from './hotelPolicy.model.js';
import type { UpdateHotelInput } from './hotel.validation.js';
import { listPublicRoomTypes } from '../rooms/room.service.js';

export async function getBySlug(req: Request, res: Response): Promise<void> {
  // Public profile changes rarely; let browsers/CDNs cache briefly to help guests on slow networks.
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  res.json({ data: await hotelService.getPublicHotelBySlug(String(req.params.slug)) });
}

export async function getSettings(req: Request, res: Response): Promise<void> {
  const hotelId = assertHotelAccess(req, String(req.params.id));
  res.json({ data: await hotelService.getHotelSettings(hotelId) });
}

export async function update(req: Request, res: Response): Promise<void> {
  const hotelId = assertHotelAccess(req, String(req.params.id));
  res.json({ data: await hotelService.updateHotel(req.auth!, hotelId, req.body as UpdateHotelInput, req) });
}

export async function listPublic(_req: Request, res: Response): Promise<void> {
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  res.json({ data: await hotelService.listPublicHotels() });
}

export async function publicRooms(req: Request, res: Response): Promise<void> {
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  res.json({ data: await listPublicRoomTypes(String(req.params.id)) });
}

export async function publicPolicies(req: Request, res: Response): Promise<void> {
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  res.json({ data: await hotelService.getPublicPolicies(String(req.params.slug)) });
}

export async function staffPolicies(req: Request, res: Response): Promise<void> {
  const hotelId = assertHotelAccess(req, String(req.params.id));
  res.json({ data: await hotelService.listPolicies(hotelId, true) });
}

export async function putPolicy(req: Request, res: Response): Promise<void> {
  const hotelId = assertHotelAccess(req, String(req.params.id));
  res.json({
    data: await hotelService.upsertPolicy(
      req.auth!,
      hotelId,
      req.params.type as PolicyType,
      req.body as { title: string; body: string; published: boolean },
      req,
    ),
  });
}
