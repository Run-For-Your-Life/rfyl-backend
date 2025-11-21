import { Router, Request, Response, NextFunction } from 'express';
import { registerUser } from '../../services/authService.js';

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

router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, username } = req.body;
    if (typeof email !== 'string' || typeof username !== 'string') {
        const validationError = new Error('Email and username are required') as HttpError;
        validationError.status = 400;
        throw validationError;
    }

    const user = await registerUser(username, email);

    res.status(201).json({ user });
  } catch (err: unknown) {
    const error = toHttpError(err, 'Registration failed');
    error.status = error.status ?? 400;
    next(error); 
  }
});

export default router;
