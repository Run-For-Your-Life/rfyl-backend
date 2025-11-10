import { Router, Request, Response, NextFunction } from 'express';

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

function registerUser(email: string, password: string){
    console.log(`Registering user with email: ${email}`);
    // Mock implementation of user registeration
    // Add to db here
    return ({user: email, password});
}

router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;
    const { user } = await registerUser(email, password);

    res.status(200).json({ user });
  } catch (err: unknown) {
    const error = toHttpError(err, 'Registration failed');
    error.status = 401;
    next(error); 
  }
});

export default router;
