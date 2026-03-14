import { Router, Request, Response, NextFunction } from 'express';

import { persistRunDistanceSample } from '../../db/runDistanceStore.js';
import { createGeometryOps } from '../../services/realtimeOps';
import { getUsernameByFirebaseUid } from '../../services/authIdentityCache.js';

import {
  defaultVerifyIdToken,
  extractIdToken,
  type VerifiedIdentityToken,
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
export type ResolveUsernameFn = (decoded: VerifiedIdentityToken) => Promise<string | null>;
type MapsRouterOptions = {
  verifyIdToken?: VerifyIdTokenFn;
  recordRunDistance?: RecordRunDistanceFn;
  resolveUsername?: ResolveUsernameFn;
};

export function createMapsRouter(options: MapsRouterOptions = {}) {
  const router = Router();
  const geometryOps = createGeometryOps();
  const verifyIdToken = options.verifyIdToken ?? defaultVerifyIdToken;
  const recordRunDistance = options.recordRunDistance;
  const resolveUsername = options.resolveUsername ?? (async (decoded: VerifiedIdentityToken) =>
    getUsernameByFirebaseUid(decoded.uid)
  );

  router.use(async (req: Request, res: Response, next: NextFunction) => {
    try {
      const idToken = extractIdToken(req);
      if (!idToken) {
        res.status(401).json({ error: 'missing_auth_token' });
        return;
      }
      const decoded = await verifyIdToken(idToken);
      const username = await resolveUsername(decoded);
      if (!username) {
        res.status(403).json({ error: 'user_not_registered' });
        return;
      }
      (req as AuthenticatedRequest).auth = {
        userUid: decoded.uid,
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
