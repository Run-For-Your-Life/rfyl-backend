import { Router, Request, Response, NextFunction } from 'express';

import { createGeometryOps } from '../../services/realtimeOps';
import { findUserByFirebaseUid } from '../../services/authService.js';
import {
  defaultVerifyIdToken,
  extractIdToken,
  type AuthenticatedRequest,
  type VerifyIdTokenFn,
} from './auth';
import { createJoinRouter } from './handlers/join';
import { createLocationsRouter } from './handlers/locations';
import { createResetRouter } from './handlers/reset';
import { createRespawnRouter } from './handlers/respawn';
import { createStateRouter } from './handlers/state';
import { createStreamRouter } from './handlers/stream';

export type { VerifyIdTokenFn };
type MapsRouterOptions = {
  verifyIdToken?: VerifyIdTokenFn;
};

export function createMapsRouter(options: MapsRouterOptions = {}) {
  const router = Router();
  const geometryOps = createGeometryOps();
  const verifyIdToken = options.verifyIdToken ?? defaultVerifyIdToken;

  router.use(async (req: Request, res: Response, next: NextFunction) => {
    try {
      const idToken = extractIdToken(req);
      if (!idToken) {
        res.status(401).json({ error: 'missing_auth_token' });
        return;
      }
      const decoded = await verifyIdToken(idToken);
      const synced = await findUserByFirebaseUid(decoded.uid);
      if (!synced) {
        res.status(403).json({ error: 'user_not_registered' });
        return;
      }
      (req as AuthenticatedRequest).auth = {
        userId: decoded.uid,
        username: synced.username,
      };
      next();
    } catch {
      res.status(401).json({ error: 'invalid_auth_token' });
    }
  });

  router.use(createJoinRouter());
  router.use(createLocationsRouter(geometryOps));
  router.use(createStreamRouter());
  router.use(createStateRouter());
  router.use(createRespawnRouter());
  router.use(createResetRouter());

  return router;
}

const router = createMapsRouter();
export default router;
