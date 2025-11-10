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

function loginUser(email: string, password: string){
    console.log(`Logging in user with email: ${email}`);
    // Mock implementation of user login
    if (email === 'test@example.com' && password === 'password') {
        return Promise.resolve({
            _user: { id: 1, email },
            session: { token: 'abc123' }
        });
    }
}

router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;
    const result = await loginUser(email, password);
    if (!result) {
        throw new Error('Invalid email or password');
    }
    const { _user: user, session } = result;
    res.status(200).json({ user, session });
  } catch (err: unknown) {
    const error = toHttpError(err, 'Login failed');
    error.status = 401;
    next(error); 
  }
});

export default router;
