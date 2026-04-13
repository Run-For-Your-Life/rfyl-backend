import { Router } from 'express';

import { persistRunDistanceSample } from '../../db/runDistanceStore.js';
import { createGeometryOps } from '../../services/realtimeOps';

import {
  createAuthenticatedRequestMiddleware,
  type AuthenticatedRouteOptions,
  type ResolveUsernameFn,
  type VerifyIdTokenFn,
} from './auth';
import { createJoinRouter } from './handlers/join';
import { createLocationsRouter, type RecordRunDistanceFn } from './handlers/locations';
import { createResetRouter } from './handlers/reset';
import { createRespawnRouter } from './handlers/respawn';
import { createStateRouter } from './handlers/state';
import { createStreamRouter } from './handlers/stream';

export type { VerifyIdTokenFn, ResolveUsernameFn };

type MapsRouterOptions = AuthenticatedRouteOptions & {
  recordRunDistance?: RecordRunDistanceFn;
};

export function createMapsRouter(options: MapsRouterOptions = {}) {
  const router = Router();
  const geometryOps = createGeometryOps();
  const authOptions: AuthenticatedRouteOptions = {
    ...(options.verifyIdToken ? { verifyIdToken: options.verifyIdToken } : {}),
    ...(options.resolveUsername ? { resolveUsername: options.resolveUsername } : {}),
  };
  const recordRunDistance = options.recordRunDistance;

  router.use(createAuthenticatedRequestMiddleware(authOptions));
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

const router = createMapsRouter({ recordRunDistance: persistRunDistanceSample });
export default router;
