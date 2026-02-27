import { Router, Request, Response, NextFunction } from 'express';

import { registerUser } from '../../services/authService.js';
import { HttpError, toHttpError } from './shared.js';

export const createRegisterRouter = (registerFn: typeof registerUser = registerUser) => {
  const router = Router();

  router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, username, password } = req.body;
      if (typeof email !== 'string' || typeof username !== 'string' || typeof password !== 'string') {
          const validationError = new Error('Email, username, and password are required') as HttpError;
          validationError.status = 400;
          throw validationError;
      }

      const user = await registerFn(username, email, password);

      res.status(201).json({ user });
    } catch (err: unknown) {
      const error = toHttpError(err, 'Registration failed');
      error.status = error.status ?? 400;
      next(error); 
    }
  });

  return router;
};

const router = createRegisterRouter();

export default router;
