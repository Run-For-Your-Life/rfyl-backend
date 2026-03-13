import { Router, Request, Response, NextFunction } from 'express';

import { persistRunDistanceSample } from '../../db/runDistanceStore.js';
import { createGeometryOps } from '../../services/realtimeOps';

import {
  defaultVerifyIdToken,
  deriveUsername,
  extractIdToken,
  type AuthenticatedRequest,
  type VerifyIdTokenFn,
} from './auth';
import { createJoinRouter } from './handlers/join';
import { createLocationsRouter, type RecordRunDistanceFn } from './handlers/locations';
import { createResetRouter } from './handlers/reset';
import { createRespawnRouter } from './handlers/respawn';
import { createStateRouter } from './handlers/state';
import { createStreamRouter } from './handlers/stream';

export type { VerifyIdTokenFn };
type MapsRouterOptions = {
  verifyIdToken?: VerifyIdTokenFn;
  recordRunDistance?: RecordRunDistanceFn;
};

export function createMapsRouter(options: MapsRouterOptions = {}) {
  const router = Router();
  const geometryOps = createGeometryOps();
  const verifyIdToken = options.verifyIdToken ?? defaultVerifyIdToken;
  const recordRunDistance = options.recordRunDistance;

  router.use(async (req: Request, res: Response, next: NextFunction) => {
    try {
      const idToken = extractIdToken(req);
      if (!idToken) {
        res.status(401).json({ error: 'missing_auth_token' });
        return;
      }
      const decoded = await verifyIdToken(idToken);
      const username = deriveUsername(decoded);
      (req as AuthenticatedRequest).auth = {
        userId: decoded.uid,
        username,
      };
      next();
    } catch {
      res.status(401).json({ error: 'invalid_auth_token' });
    }
  });

  router.use(createJoinRouter());
  router.use(
    createLocationsRouter(
      geometryOps,
      recordRunDistance ? { recordRunDistance } : {}
    )
  );
  router.use(createStreamRouter());
  router.use(createStateRouter());
  router.use(createRespawnRouter());
  router.use(createResetRouter());

  return router;
}

// Distance is saved to MySQL
const router = createMapsRouter({ recordRunDistance: persistRunDistanceSample });
export default router;
