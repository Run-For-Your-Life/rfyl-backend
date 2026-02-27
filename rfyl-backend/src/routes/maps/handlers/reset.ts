import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';

import { getEnv } from '../../../config/env';
import { clearMapState, getMapSnapshot, type MapSnapshot, type RealtimeEvent } from '../../../services/realtimeEngine';
import { appendRealtimeWal } from '../../../services/realtimePersistence';
import { broadcastEvents } from '../../../services/realtimeStream';
import { matchesPassword } from '../auth';

export function createResetRouter(): Router {
  const router = createRouter();
  router.post('/:mapId/reset', (req: Request, res: Response) => {
    const { mapId } = req.params;
    if (!mapId) {
      res.status(400).json({ error: 'mapId is required' });
      return;
    }

    const expectedPassword = getEnv('MAP_RESET_PASSWORD');
    if (!expectedPassword) {
      res.status(503).json({ error: 'map reset endpoint is disabled' });
      return;
    }

    const bodyPassword =
      typeof (req.body as { password?: unknown })?.password === 'string'
        ? ((req.body as { password?: string }).password ?? '')
        : '';
    const headerValue = req.header('x-map-reset-password');
    const providedPassword = bodyPassword || (headerValue ?? '');

    if (!providedPassword || !matchesPassword(providedPassword, expectedPassword)) {
      res.status(403).json({ error: 'invalid reset password' });
      return;
    }

    const existing = getMapSnapshot(mapId);
    clearMapState(mapId);

    const resetEvent: RealtimeEvent = {
      type: 'reset',
      mapId,
      userId: 'system',
      username: 'system',
      reason: 'manual',
    };
    const resetSnapshot: MapSnapshot = {
      mapId,
      players: [],
    };
    appendRealtimeWal(mapId, [resetEvent], resetSnapshot);
    broadcastEvents(mapId, [resetEvent]);

    res.status(200).json({ ok: true, mapId, cleared: Boolean(existing) });
  });
  return router;
}
