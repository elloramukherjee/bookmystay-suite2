import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './user.controller.js';
import { z } from 'zod';
import { passwordSchema } from '../auth/auth.validation.js';
import { listUsersQuery, updateUserSchema, userIdParams } from './user.validation.js';
import { resetStaffPassword } from './user.service.js';

export const usersRouter = Router();

usersRouter.use(authenticate);
usersRouter.get('/', authorize('staff.read'), validate({ query: listUsersQuery }), controller.list);
usersRouter.patch('/:id', authorize('staff.manage'), validate({ params: userIdParams, body: updateUserSchema }), controller.update);
usersRouter.put(
  '/:id/password',
  authorize('staff.manage'),
  validate({ params: userIdParams, body: z.strictObject({ newPassword: passwordSchema }) }),
  async (req, res) => {
    await resetStaffPassword(req.auth!, String(req.params.id), (req.body as { newPassword: string }).newPassword, req);
    res.status(204).end();
  },
);
