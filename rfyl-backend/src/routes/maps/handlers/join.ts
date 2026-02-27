import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';

import { getMapSnapshot, hasPlayer, isMapAtCapacity, joinPlayer } from '../../../services/realtimeEngine';
import { appendRealtimeWal } from '../../../services/realtimePersistence';
import { broadcastEvents } from '../../../services/realtimeStream';
import type { AuthenticatedRequest } from '../auth';
import { toTrimmedOptionalString } from '../auth';

export function createJoinRouter(): Router {
  const router = createRouter();
  router.post('/:mapId/players/join', (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const { mapId } = req.params;
    if (!mapId) {
      res.status(400).json({ error: 'mapId is required' });
      return;
    }

    const userIdInput = toTrimmedOptionalString((req.body as { userId?: unknown })?.userId);
    const usernameInput = toTrimmedOptionalString((req.body as { username?: unknown })?.username);
    if (userIdInput && userIdInput !== authReq.auth.userId) {
      res.status(403).json({ error: 'identity_mismatch' });
      return;
    }
    const userId = authReq.auth.userId;
    const username = usernameInput ?? authReq.auth.username;

    const existed = hasPlayer(mapId, userId);
    if (!existed && isMapAtCapacity(mapId)) {
      res.status(409).json({ error: 'map_full', maxPlayers: 10 });
      return;
    }
    const events = joinPlayer(mapId, userId, username);
    const snapshot = getMapSnapshot(mapId);
    if (snapshot && events.length > 0) {
      appendRealtimeWal(mapId, events, snapshot);
      broadcastEvents(mapId, events);
    }
    res.status(existed ? 200 : 201).json({ ok: true, mapId, userId, created: !existed });
  });
  return router;
}
