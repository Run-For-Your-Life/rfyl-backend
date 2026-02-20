import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';

import { getMapSnapshot, hasPlayer, ingestLocation, type RealtimeEvent } from '../../../services/realtimeEngine';
import { createGeometryOps } from '../../../services/realtimeOps';
import { appendRealtimeWal } from '../../../services/realtimePersistence';
import { broadcastEvents } from '../../../services/realtimeStream';
import type { AuthenticatedRequest } from '../auth';
import { toTrimmedOptionalString } from '../auth';

type GeometryOps = ReturnType<typeof createGeometryOps>;

export function createLocationsRouter(geometryOps: GeometryOps): Router {
  const router = createRouter();
  router.post('/:mapId/locations', (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const { mapId } = req.params;
    if (!mapId) {
      res.status(400).json({ error: 'mapId is required' });
      return;
    }
    const rawUpdates = Array.isArray(req.body) ? req.body : [req.body];
    let accepted = 0;
    let rejectedNotJoined = 0;
    const events: RealtimeEvent[] = [];

    for (const raw of rawUpdates) {
      if (!raw || typeof raw !== 'object') {
        continue;
      }
      const userIdInput = toTrimmedOptionalString((raw as { userId?: unknown }).userId);
      const usernameInput = toTrimmedOptionalString((raw as { username?: unknown }).username);
      if (
        (userIdInput && userIdInput !== authReq.auth.userId) ||
        (usernameInput && usernameInput !== authReq.auth.username)
      ) {
        res.status(403).json({ error: 'identity_mismatch' });
        return;
      }
    }

    for (const raw of rawUpdates) {
      if (!raw || typeof raw !== 'object') {
        continue;
      }
      const lat = Number((raw as { lat?: number }).lat);
      const lng = Number((raw as { lng?: number }).lng);
      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        continue;
      }
      const userId = authReq.auth.userId;
      const username = authReq.auth.username;
      if (!hasPlayer(mapId, userId)) {
        rejectedNotJoined += 1;
        continue;
      }
      const ts = Number.isFinite((raw as { ts?: number }).ts)
        ? Number((raw as { ts?: number }).ts)
        : Date.now();
      const accuracyValue = (raw as { accuracy?: number }).accuracy;
      const update = {
        userId,
        lat,
        lng,
        ts,
        ...(accuracyValue === undefined ? {} : { accuracy: Number(accuracyValue) }),
      };
      const updateEvents = ingestLocation(mapId, userId, update, geometryOps, username);
      events.push(...updateEvents);
      accepted += 1;
    }

    const snapshot = getMapSnapshot(mapId);
    if (snapshot) {
      appendRealtimeWal(mapId, events, snapshot);
    }

    broadcastEvents(mapId, events);

    if (accepted === 0 && rejectedNotJoined > 0) {
      res.status(409).json({
        error: 'player_not_joined',
        received: rawUpdates.length,
        accepted,
        rejectedNotJoined,
      });
      return;
    }

    res.status(202).json({
      received: rawUpdates.length,
      accepted,
      rejectedNotJoined,
    });
  });
  return router;
}
