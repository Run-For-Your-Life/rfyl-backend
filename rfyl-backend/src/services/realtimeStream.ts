import type { Response } from 'express';

import type { RealtimeEvent } from './realtimeEngine';

type ClientPool = Map<string, Set<Response>>;

const clientsByMap: ClientPool = new Map();

export function registerRealtimeClient(mapId: string, res: Response): void {
  let pool = clientsByMap.get(mapId);
  if (!pool) {
    pool = new Set();
    clientsByMap.set(mapId, pool);
  }
  pool.add(res);
}

export function removeRealtimeClient(mapId: string, res: Response): void {
  const pool = clientsByMap.get(mapId);
  if (!pool) {
    return;
  }
  pool.delete(res);
  if (pool.size === 0) {
    clientsByMap.delete(mapId);
  }
}

export function broadcastEvents(mapId: string, events: RealtimeEvent[]): void {
  if (events.length === 0) {
    return;
  }
  const pool = clientsByMap.get(mapId);
  if (!pool || pool.size === 0) {
    return;
  }
  for (const event of events) {
    const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of pool) {
      client.write(payload);
    }
  }
}
