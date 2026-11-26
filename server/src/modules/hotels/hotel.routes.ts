import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './hotel.controller.js';
import { hotelIdParams, policyBody, policyParams, slugParams, updateHotelSchema } from './hotel.validation.js';

export const hotelsRouter = Router();

hotelsRouter.get('/', controller.listPublic);
hotelsRouter.get('/:id/rooms', validate({ params: hotelIdParams }), controller.publicRooms);
hotelsRouter.get('/:id/policies/all', authenticate, authorize('hotel.read'), validate({ params: hotelIdParams }), controller.staffPolicies);
hotelsRouter.put('/:id/policies/:type', authenticate, authorize('policies.manage'), validate({ params: policyParams, body: policyBody }), controller.putPolicy);
hotelsRouter.get('/:slug/policies', validate({ params: slugParams }), controller.publicPolicies);

hotelsRouter.get('/:id/settings', authenticate, authorize('hotel.read'), validate({ params: hotelIdParams }), controller.getSettings);
hotelsRouter.put('/:id', authenticate, authorize('hotel.update'), validate({ params: hotelIdParams, body: updateHotelSchema }), controller.update);
hotelsRouter.get('/:slug', validate({ params: slugParams }), controller.getBySlug);
