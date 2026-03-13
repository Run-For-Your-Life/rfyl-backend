import { Router, Request, Response, NextFunction } from 'express';

import { firebaseAuth } from '../../config/firebaseAdmin.js';
import { findUserByFirebaseUid } from '../../services/authService.js';
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
      const synced = await findUserByFirebaseUid(decodedToken.uid);
      if (!synced) {
        const missingUserError = new Error('user is not registered') as HttpError;
        missingUserError.status = 404;
        throw missingUserError;
      }
      const email = typeof decodedToken.email === 'string' ? decodedToken.email : '';

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
