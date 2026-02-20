import { Router, Request, Response, NextFunction } from 'express';

import { createGeometryOps } from '../../services/realtimeOps';
import {
  defaultVerifyIdToken,
  deriveUsername,
  extractIdToken,
  type AuthenticatedRequest,
  type VerifyIdTokenFn,
} from './auth';
import { joinRoute } from './handlers/join';
import { locationsRoute } from './handlers/locations';
import { resetRoute } from './handlers/reset';
import { respawnRoute } from './handlers/respawn';
import { stateRoute } from './handlers/state';
import { streamRoute } from './handlers/stream';

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

  joinRoute(router);
  locationsRoute(router, geometryOps);
  streamRoute(router);
  stateRoute(router);
  respawnRoute(router);
  resetRoute(router);

  return router;
}

const router = createMapsRouter();
export default router;
