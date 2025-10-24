import { Router, Request, Response, NextFunction } from 'express';

const router = Router();

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
  } catch (err: any) {
    err.status = 401;
    next(err); 
  }
});

export default router;
