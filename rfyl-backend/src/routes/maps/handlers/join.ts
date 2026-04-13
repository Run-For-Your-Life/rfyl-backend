import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';

import { isManagedMatchmadeMapId, recordMatchmakingActivity } from '../../../services/mapMatchmaking.js';
import { getMapSnapshot, hasPlayer, isMapAtCapacity, joinPlayer } from '../../../services/realtimeEngine';
import { appendRealtimeWal } from '../../../services/realtimePersistence';
import { broadcastEvents } from '../../../services/realtimeStream';
import type { AuthenticatedRequest } from '../auth';
import { getRequestedMapId, getResolvedMapId, toTrimmedOptionalString } from '../auth';

export function createJoinRouter(): Router {
  const router = createRouter();
  router.post('/:mapId/players/join', (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const requested_map_id = getRequestedMapId(req);
    const userIdInput = toTrimmedOptionalString((req.body as { userId?: unknown })?.userId);
    if (userIdInput && userIdInput !== authReq.auth.userUid) {
      res.status(403).json({ error: 'identity_mismatch' });
      return;
    }

    const user_id = authReq.auth.userUid;
    const username = authReq.auth.username;
    const map_id = getResolvedMapId(req);

    if (!map_id) {
      res.status(400).json({ error: 'mapId is required' });
      return;
    }

    if (isManagedMatchmadeMapId(map_id)) {
      recordMatchmakingActivity(user_id);
    }

    const existed = hasPlayer(map_id, user_id);
    if (!existed && isMapAtCapacity(map_id)) {
      res.status(409).json({ error: 'map_full', maxPlayers: 10 });
      return;
    }
    const events = joinPlayer(map_id, user_id, username);
    const snapshot = getMapSnapshot(map_id);
    if (snapshot && events.length > 0) {
      appendRealtimeWal(map_id, events, snapshot);
      broadcastEvents(map_id, events);
    }
    res.status(existed ? 200 : 201).json({
      ok: true,
      mapId: map_id,
      requestedMapId: requested_map_id,
      userId: user_id,
      created: !existed,
    });
  });
  return router;
}
