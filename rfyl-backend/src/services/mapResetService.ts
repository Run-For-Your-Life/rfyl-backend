import { clearMapState, getMapSnapshot, type MapSnapshot, type RealtimeEvent } from './realtimeEngine.js';
import { appendRealtimeWal } from './realtimePersistence.js';
import { broadcastEvents } from './realtimeStream.js';

export type ResetReason = 'manual' | 'scheduled';

export function resetMap(mapId: string, reason: ResetReason): boolean {
  const existing = getMapSnapshot(mapId);
  clearMapState(mapId);

  const resetEvent: RealtimeEvent = {
    type: 'reset',
    mapId,
    userId: 'system',
    username: 'system',
    reason,
  };
  const resetSnapshot: MapSnapshot = {
    mapId,
    players: [],
  };

  appendRealtimeWal(mapId, [resetEvent], resetSnapshot);
  broadcastEvents(mapId, [resetEvent]);
  return Boolean(existing);
}
