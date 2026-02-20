import type { Request, Response, Router } from 'express';

import { registerRealtimeClient, removeRealtimeClient } from '../../../services/realtimeStream';

export function streamRoute(router: Router): void {
  router.get('/:mapId/stream', (req: Request, res: Response) => {
    const { mapId } = req.params;
    if (!mapId) {
      res.status(400).json({ error: 'mapId is required' });
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
}
