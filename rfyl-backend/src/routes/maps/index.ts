import { timingSafeEqual } from 'node:crypto';

import { Router, Request, Response } from 'express';

import { getEnv } from '../../config/env';
import {
  clearMapState,
  getMapSnapshot,
  hasPlayer,
  ingestLocation,
  isMapAtCapacity,
  joinPlayer,
  respawnPlayer,
  type MapSnapshot,
  type RealtimeEvent,
} from '../../services/realtimeEngine';
import { createGeometryOps } from '../../services/realtimeOps';
import { appendRealtimeWal } from '../../services/realtimePersistence';
import { broadcastEvents, registerRealtimeClient, removeRealtimeClient } from '../../services/realtimeStream';

const router = Router();
const geometryOps = createGeometryOps();

router.post('/:mapId/players/join', (req: Request, res: Response) => {
  const { mapId } = req.params;
  if (!mapId) {
    res.status(400).json({ error: 'mapId is required' });
    return;
  }
  const userIdValue = (req.body as { userId?: unknown })?.userId;
  const usernameValue = (req.body as { username?: unknown })?.username;
  const userId = typeof userIdValue === 'string' ? userIdValue.trim() : '';
  const username =
    typeof usernameValue === 'string' && usernameValue.trim().length > 0
      ? usernameValue.trim()
      : undefined;
  if (!userId) {
    res.status(400).json({ error: 'userId is required' });
    return;
  }

  const existed = hasPlayer(mapId, userId);
  if (!existed && isMapAtCapacity(mapId)) {
    res.status(409).json({ error: 'map_full', maxPlayers: 10 });
    return;
  }
  const events = joinPlayer(mapId, userId, username);
  const snapshot = getMapSnapshot(mapId);
  if (snapshot && events.length > 0) {
    appendRealtimeWal(mapId, events, snapshot);
    broadcastEvents(mapId, events);
  }
  res.status(existed ? 200 : 201).json({ ok: true, mapId, userId, created: !existed });
});

router.post('/:mapId/locations', (req: Request, res: Response) => {
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
    const userId = (raw as { userId?: string }).userId ?? '';
    const usernameValue = (raw as { username?: unknown }).username;
    const username =
      typeof usernameValue === 'string' && usernameValue.trim().length > 0
        ? usernameValue.trim()
        : undefined;
    const lat = Number((raw as { lat?: number }).lat);
    const lng = Number((raw as { lng?: number }).lng);
    if (!userId || Number.isNaN(lat) || Number.isNaN(lng)) {
      continue;
    }
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

router.post('/:mapId/players/:userId/respawn', (req: Request, res: Response) => {
  const { mapId, userId } = req.params;
  if (!mapId || !userId) {
    res.status(400).json({ error: 'mapId and userId are required' });
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

function matchesPassword(providedPassword: string, expectedPassword: string): boolean {
  const provided = Buffer.from(providedPassword);
  const expected = Buffer.from(expectedPassword);
  if (provided.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(provided, expected);
}

export default router;
