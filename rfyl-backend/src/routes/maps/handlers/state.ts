import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';

import { getMapSnapshot } from '../../../services/realtimeEngine';
import { getResolvedMapId } from '../auth';

export function createStateRouter(): Router {
  const router = createRouter();
  router.get('/:mapId/state', (req: Request, res: Response) => {
    const mapId = getResolvedMapId(req);
    if (!mapId) {
      res.status(404).json({ error: 'map not found' });
      return;
    }
    const snapshot = getMapSnapshot(mapId);
    if (!snapshot) {
      res.status(404).json({ error: 'map not found' });
      return;
    }
    res.status(200).json(snapshot);
  });
  return router;
}
