import { Router, Request, Response, NextFunction } from 'express';

import { firebaseAuth } from '../../config/firebaseAdmin.js';
import { ensureUserByFirebaseUid, USERNAME_REQUIRED_FOR_NEW_USER } from '../../services/authService.js';
import { HttpError, parseBearerToken, toHttpError } from './shared.js';

export const createLoginRouter = () => {
  const router = Router();

  // Firebase already authenticates credentials. Backend login is a token-backed user sync endpoint.
  router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const idToken = parseBearerToken(req) ?? req.body?.idToken;
      if (typeof idToken !== 'string' || idToken.length === 0) {
        const validationError = new Error('ID token is required') as HttpError;
        validationError.status = 400;
        throw validationError;
      }

      const decodedToken = await firebaseAuth.verifyIdToken(idToken);
      const email = typeof decodedToken.email === 'string' ? decodedToken.email : '';
      const bodyUsername = String(req.body?.username ?? '').trim();
      const tokenName = typeof decodedToken.name === 'string' ? decodedToken.name.trim() : '';
      const bodyEmail = String(req.body?.email ?? '').trim();
      const effectiveEmail = email || bodyEmail;
      const emailLocalPart = effectiveEmail.includes('@')
        ? effectiveEmail.split('@')[0]?.trim() ?? ''
        : effectiveEmail.trim();
      const preferredUsername = bodyUsername || tokenName || emailLocalPart;

      let synced;
      try {
        synced = await ensureUserByFirebaseUid(decodedToken.uid, preferredUsername);
      } catch (err: unknown) {
        const typedError = err as { code?: string };
        if (typedError.code === USERNAME_REQUIRED_FOR_NEW_USER) {
          const missingUserError = new Error('username is required for first-time sync') as HttpError;
          missingUserError.status = 409;
          throw missingUserError;
        }
        throw err;
      }

      res.status(200).json({
        user: {
          uid: decodedToken.uid,
          username: synced.username,
          email: email || null,
          created: synced.created,
        },
      });
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
