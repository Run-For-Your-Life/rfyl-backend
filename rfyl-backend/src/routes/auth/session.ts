import { Router, Request, Response, NextFunction } from 'express';

import { getEnv } from '../../config/env.js';
import { firebaseAuth } from '../../config/firebaseAdmin.js';

interface HttpError extends Error {
  status?: number;
}

const toHttpError = (error: unknown, fallbackMessage: string): HttpError => {
  if (error instanceof Error) {
    return error as HttpError;
  }

  return new Error(fallbackMessage);
};

const parseBearerToken = (req: Request): string | undefined => {
  const header = req.headers.authorization;
  if (!header) {
    return undefined;
  }

  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return undefined;
  }

  return token;
};

export const createSessionRouter = () => {
  const router = Router();

  router.post('/session', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const idToken = parseBearerToken(req) ?? req.body?.idToken;
      if (typeof idToken !== 'string' || idToken.length === 0) {
        const validationError = new Error('ID token is required') as HttpError;
        validationError.status = 400;
        throw validationError;
      }

      const decodedToken = await firebaseAuth.verifyIdToken(idToken);

      const cookieName = getEnv('SESSION_COOKIE_NAME', 'rfyl_session');
      const maxAgeMs = Number(getEnv('SESSION_COOKIE_MAX_AGE_MS', String(7 * 24 * 60 * 60 * 1000)));
      const isProduction = getEnv('NODE_ENV') === 'production';
      const sameSite = (getEnv('SESSION_COOKIE_SAMESITE', 'lax') as 'lax' | 'strict' | 'none');

      res.cookie(cookieName, idToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite,
        maxAge: maxAgeMs,
        path: '/',
      });

      res.status(200).json({
        uid: decodedToken.uid,
      });
    } catch (err: unknown) {
      const error = toHttpError(err, 'Session creation failed');
      error.status = error.status ?? 401;
      next(error);
    }
  });

  return router;
};

const router = createSessionRouter();

export default router;
