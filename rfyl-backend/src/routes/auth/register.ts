import { Router, Request, Response, NextFunction } from 'express';

import { firebaseAuth } from '../../config/firebaseAdmin.js';
import { ensureUserByFirebaseUid } from '../../services/authService.js';
import { HttpError, parseBearerToken, toHttpError } from './shared.js';

export const createRegisterRouter = () => {
  const router = Router();

  // Firebase handles credential registration. Backend register syncs Firebase UID into app DB.
  router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const idToken = parseBearerToken(req) ?? req.body?.idToken;
      if (typeof idToken !== 'string' || idToken.length === 0) {
        const validationError = new Error('ID token is required') as HttpError;
        validationError.status = 400;
        throw validationError;
      }

      const requestedUsername = String(req.body?.username ?? '').trim();
      const requestedEmail = String(req.body?.email ?? '').trim();
      if (requestedUsername.length === 0) {
        const validationError = new Error('username is required') as HttpError;
        validationError.status = 400;
        throw validationError;
      }
      const decodedToken = await firebaseAuth.verifyIdToken(idToken);
      const tokenEmail = typeof decodedToken.email === 'string' ? decodedToken.email : '';
      const email = tokenEmail || requestedEmail || '';
      const synced = await ensureUserByFirebaseUid(decodedToken.uid, requestedUsername, true);

      res.status(synced.created ? 201 : 200).json({
        user: {
          uid: decodedToken.uid,
          username: synced.username,
          email: email || null,
        },
      });
    } catch (err: unknown) {
      const error = toHttpError(err, 'Registration failed');
      error.status = error.status ?? 400;
      next(error);
    }
  });

  return router;
};

const router = createRegisterRouter();

export default router;
