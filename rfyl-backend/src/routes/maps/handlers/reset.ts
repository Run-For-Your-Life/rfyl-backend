import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';

import { getEnv } from '../../../config/env';
import { resetMap } from '../../../services/mapResetService.js';
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

    const cleared = resetMap(mapId, 'manual');

    res.status(200).json({ ok: true, mapId, cleared });
  });
  return router;
}
