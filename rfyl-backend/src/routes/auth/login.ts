import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

import { authenticateUser } from '../../services/authService.js';

interface HttpError extends Error {
  status?: number;
}

const toHttpError = (error: unknown, fallbackMessage: string): HttpError => {
  if (error instanceof Error) return error as HttpError;
  return new Error(fallbackMessage);
};

export const createLoginRouter = (
  authenticateFn: typeof authenticateUser = authenticateUser
) => {
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

      const secret = process.env.JWT_SECRET;
      if (!secret) {
        const e = new Error('JWT_SECRET not configured') as HttpError;
        e.status = 500;
        throw e;
      }

      // Payload shape MUST match requireAuth's validator:
      // { id: number, email?: string }
      const token = jwt.sign(
        { id: user.id, email: user.email },
        secret,
        { expiresIn: '1h' }
      );

      res.status(200).json({ user, token });
    } catch (err: unknown) {
      const error = toHttpError(err, 'Login failed');
      // preserve thrown status if present; otherwise default to 401
      error.status = error.status ?? 401;
      next(error);
    }
  });

  return router;
};

const router = createLoginRouter();
export default router;
