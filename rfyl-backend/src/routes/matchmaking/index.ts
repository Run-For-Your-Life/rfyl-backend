import { Router, type Request, type Response } from 'express';

import { getAssignedMatchmadeMapId, queueMatchmadePlayer } from '../../services/mapMatchmaking.js';
import {
  createAuthenticatedRequestMiddleware,
  type AuthenticatedRequest,
  type AuthenticatedRouteOptions,
  type ResolveUsernameFn,
  type VerifyIdTokenFn,
} from '../maps/auth.js';

export type { VerifyIdTokenFn, ResolveUsernameFn };

type MatchmakingRouterOptions = AuthenticatedRouteOptions;

export function createMatchmakingRouter(options: MatchmakingRouterOptions = {}) {
  const router = Router();

  router.use(createAuthenticatedRequestMiddleware(options));

  router.post('/me', (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const { userUid, username } = authReq.auth;
    const existingMapId = getAssignedMatchmadeMapId(userUid);
    const assignedMapId = existingMapId ?? queueMatchmadePlayer(userUid, username);

    if (!assignedMapId) {
      res.status(202).json({
        ok: true,
        status: 'queued',
        queued: true,
        userId: userUid,
      });
      return;
    }

    res.status(200).json({
      ok: true,
      status: 'assigned',
      queued: false,
      userId: userUid,
      mapId: assignedMapId,
    });
  });

  return router;
}

const router = createMatchmakingRouter();
export default router;
