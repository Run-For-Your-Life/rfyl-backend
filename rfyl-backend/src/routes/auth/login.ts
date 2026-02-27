import { Router, Request, Response, NextFunction } from 'express';

import { authenticateUser } from '../../services/authService.js';
import { HttpError, toHttpError } from './shared.js';

export const createLoginRouter = (authenticateFn: typeof authenticateUser = authenticateUser) => {
  const router = Router();

  router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { username, password } = req.body;
      if (typeof username !== 'string' || typeof password !== 'string') {
          const validationError = new Error('Username and password are required') as HttpError;
          validationError.status = 400;
          throw validationError;
      }

      const user = await authenticateFn(username, password);
      res.status(200).json({ user });
    } catch (err: unknown) {
      const error = toHttpError(err, 'Login failed');
      error.status = error.status ?? 401;
      next(error); 
    }
  });

  return router;
};

const router = createLoginRouter();

export default router;
