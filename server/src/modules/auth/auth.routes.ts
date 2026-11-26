import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/authenticate.js';
import { loginLimiter, refreshLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './auth.controller.js';
import { changePasswordSchema, loginSchema, registerSchema } from './auth.validation.js';

export const authRouter = Router();

authRouter.post('/login', loginLimiter, validate({ body: loginSchema }), controller.login);
authRouter.post('/refresh', refreshLimiter, controller.refresh);
authRouter.post('/logout', controller.logout);
authRouter.post('/register', authenticate, authorize('staff.manage'), validate({ body: registerSchema }), controller.register);
authRouter.get('/me', authenticate, controller.me);
authRouter.post('/change-password', loginLimiter, authenticate, validate({ body: changePasswordSchema }), controller.changePassword);
