import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export type AuthedUser = {
  id: number;
  email?: string;
};

export interface AuthedRequest extends Request {
  user?: AuthedUser;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization: Bearer <token>' });
  }

  const token = header.slice('Bearer '.length).trim();

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'JWT_SECRET not configured' });
  }

  try {
    const payload = jwt.verify(token, secret) as AuthedUser;
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
