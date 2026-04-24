import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';

import { registerRealtimeClient, removeRealtimeClient } from '../../../services/realtimeStream';
import { getResolvedMapId } from '../auth';

export function createStreamRouter(): Router {
  const router = createRouter();
  router.get('/:mapId/stream', (req: Request, res: Response) => {
    const mapId = getResolvedMapId(req);
    if (!mapId) {
      res.status(404).json({ error: 'map not found' });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write(`event: ready\ndata: ${JSON.stringify({ mapId })}\n\n`);

    registerRealtimeClient(mapId, res);

    req.on('close', () => {
      removeRealtimeClient(mapId, res);
      res.end();
    });
  });
  return router;
}
