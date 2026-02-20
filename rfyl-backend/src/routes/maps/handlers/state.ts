import type { Request, Response, Router } from 'express';

import { getMapSnapshot } from '../../../services/realtimeEngine';

export function stateRoute(router: Router): void {
  router.get('/:mapId/state', (req: Request, res: Response) => {
    const { mapId } = req.params;
    if (!mapId) {
      res.status(400).json({ error: 'mapId is required' });
      return;
    }
    const snapshot = getMapSnapshot(mapId);
    if (!snapshot) {
      res.status(404).json({ error: 'map not found' });
      return;
    }
    res.status(200).json(snapshot);
  });
}
