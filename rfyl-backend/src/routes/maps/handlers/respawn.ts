import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';

import { getMapSnapshot, hasPlayer, respawnPlayer } from '../../../services/realtimeEngine';
import { appendRealtimeWal } from '../../../services/realtimePersistence';
import { broadcastEvents } from '../../../services/realtimeStream';
import type { AuthenticatedRequest } from '../auth';
import { isWithinMapBounds } from '../bounds';

export function createRespawnRouter(): Router {
  const router = createRouter();
  router.post('/:mapId/players/:userId/respawn', (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const { mapId, userId } = req.params;
    if (!mapId || !userId) {
      res.status(400).json({ error: 'mapId and userId are required' });
      return;
    }
    if (userId !== authReq.auth.userUid) {
      res.status(403).json({ error: 'identity_mismatch' });
      return;
    }
    if (!hasPlayer(mapId, userId)) {
      res.status(404).json({ error: 'player_not_joined' });
      return;
    }

    const latRaw = (req.body as { lat?: unknown })?.lat;
    const lngRaw = (req.body as { lng?: unknown })?.lng;
    const hasLat = latRaw !== undefined;
    const hasLng = lngRaw !== undefined;
    if (hasLat !== hasLng) {
      res.status(400).json({ error: 'lat and lng must be provided together' });
      return;
    }
    let spawnPoint: { lat: number; lng: number; ts: number } | undefined;
    if (hasLat && hasLng) {
      const lat = Number(latRaw);
      const lng = Number(lngRaw);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        res.status(400).json({ error: 'lat and lng must be finite numbers' });
        return;
      }
      if (!isWithinMapBounds(lat, lng)) {
        res.status(422).json({ error: 'out_of_bounds' });
        return;
      }
      spawnPoint = { lat, lng, ts: Date.now() };
    }

    const events = respawnPlayer(mapId, userId, spawnPoint);
    if (events.length === 0) {
      res.status(409).json({ error: 'player not eligible to respawn or missing spawn point' });
      return;
    }
    const snapshot = getMapSnapshot(mapId);
    if (snapshot) {
      appendRealtimeWal(mapId, events, snapshot);
    }
    broadcastEvents(mapId, events);
    res.status(200).json({ ok: true });
  });
  return router;
}
