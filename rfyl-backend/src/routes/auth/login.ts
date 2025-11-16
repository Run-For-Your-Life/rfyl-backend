import { Router, Request, Response, NextFunction } from 'express';
import { authenticateUser } from '../../services/authService.js';

const router = Router();

interface HttpError extends Error {
  status?: number;
}

const toHttpError = (error: unknown, fallbackMessage: string): HttpError => {
  if (error instanceof Error) {
    return error as HttpError;
  }

  return new Error(fallbackMessage);
};

router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, username } = req.body;
    if (typeof email !== 'string') {
        const validationError = new Error('Email is required') as HttpError;
        validationError.status = 400;
        throw validationError;
    }

    const user = await authenticateUser(email, typeof username === 'string' ? username : undefined);
    res.status(200).json({ user });
  } catch (err: unknown) {
    const error = toHttpError(err, 'Login failed');
    error.status = error.status ?? 401;
    next(error); 
  }
});

export default router;
