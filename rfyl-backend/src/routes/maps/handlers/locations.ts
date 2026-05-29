import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';

import {
  getMapSnapshot,
  getPlayerAnticheatStatus,
  hasPlayer,
  ingestLocation,
  type RealtimeEvent,
} from '../../../services/realtimeEngine';
import { isManagedMatchmadeMapId, recordMatchmakingActivity } from '../../../services/mapMatchmaking.js';
import { createGeometryOps } from '../../../services/realtimeOps';
import { appendRealtimeWal } from '../../../services/realtimePersistence';
import { broadcastEvents } from '../../../services/realtimeStream';
import type { AuthenticatedRequest } from '../auth';
import { getResolvedMapId, toTrimmedOptionalString } from '../auth';
import { isWithinMapBounds } from '../bounds';

type GeometryOps = ReturnType<typeof createGeometryOps>;

type DistancePoint = {
  lat: number;
  lng: number;
  ts: number;
};

export type RunDistanceSample = {
  userUid: string;
  username: string;
  mapId: string;
  startedAtMs: number;
  endedAtMs: number;
  distanceMeters: number;
  pathCoordinates: number[][];
};

export type RecordRunDistanceFn = (sample: RunDistanceSample) => Promise<void>;

type LocationsRouterOptions = {
  recordRunDistance?: RecordRunDistanceFn;
};

const noopRecordRunDistance: RecordRunDistanceFn = async () => {};

export function createLocationsRouter(geometryOps: GeometryOps, options: LocationsRouterOptions = {}): Router {
  const router = createRouter();
  const recordRunDistance = options.recordRunDistance ?? noopRecordRunDistance;

  router.post('/:mapId/locations', (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const map_id = getResolvedMapId(req);
    const rawUpdates = Array.isArray(req.body) ? req.body : [req.body];

    if (!map_id) {
      res.status(409).json({
        error: 'player_not_joined',
        received: rawUpdates.length,
        accepted: 0,
        rejectedNotJoined: true,
        rejectedOutOfBounds: false,
        rejectedAnticheat: 0,
        anticheatLocked: false,
        anticheatReason: null,
        returnTo: null,
        returnToleranceMeters: null,
      });
      return;
    }

    if (isManagedMatchmadeMapId(map_id)) {
      recordMatchmakingActivity(authReq.auth.userUid);
    }

    let accepted = 0;
    let rejectedNotJoined = false;
    let rejectedOutOfBounds = false;
    let rejectedAnticheat = 0;
    const events: RealtimeEvent[] = [];
    const userUid = authReq.auth.userUid;
    const snapshotBefore = getMapSnapshot(map_id);
    let previousPoint = getLastPointForUser(snapshotBefore, userUid);
    let distanceMeters = 0;
    let startedAtMs: number | null = null;
    let endedAtMs: number | null = null;
    const pathCoordinates: number[][] = [];

    for (const raw of rawUpdates) {
      if (!raw || typeof raw !== 'object') {
        continue;
      }
      const userIdInput = toTrimmedOptionalString((raw as { userId?: unknown }).userId);
      if (userIdInput && userIdInput !== userUid) {
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
      const username = authReq.auth.username;
      if (!hasPlayer(map_id, userUid)) {
        rejectedNotJoined = true;
        continue;
      }
      if (!isWithinMapBounds(lat, lng)) {
        rejectedOutOfBounds = true;
        continue;
      }
      const ts = Number.isFinite((raw as { ts?: number }).ts)
        ? Number((raw as { ts?: number }).ts)
        : Date.now();
      const accuracyValue = (raw as { accuracy?: number }).accuracy;
      const update = {
        userId: userUid,
        lat,
        lng,
        ts,
        ...(accuracyValue === undefined ? {} : { accuracy: Number(accuracyValue) }),
      };
      const before_anticheat_status = getPlayerAnticheatStatus(map_id, userUid);
      const updateEvents = ingestLocation(map_id, userUid, update, geometryOps, username);
      events.push(...updateEvents);

      const updated_point = getLastPointForUser(getMapSnapshot(map_id), userUid);
      const did_accept_point =
        Boolean(updated_point) &&
        updated_point?.ts === ts &&
        updated_point?.lat === lat &&
        updated_point?.lng === lng;
      const after_anticheat_status = getPlayerAnticheatStatus(map_id, userUid);
      if (did_accept_point) {
        accepted += 1;
      } else if (
        (!previousPoint || ts > previousPoint.ts) &&
        (before_anticheat_status?.locked || after_anticheat_status?.locked)
      ) {
        rejectedAnticheat += 1;
      }

      const currentPoint: DistancePoint = { lat, lng, ts };
      if (!previousPoint) {
        if (did_accept_point) {
          previousPoint = currentPoint;
        }
        continue;
      }
      if (ts <= previousPoint.ts) {
        continue;
      }
      if (!did_accept_point) {
        continue;
      }
      const priorPoint = previousPoint;
      const segmentMeters = segmentDistanceMeters(priorPoint, currentPoint);
      previousPoint = currentPoint;
      if (segmentMeters <= 0) {
        continue;
      }
      if (pathCoordinates.length === 0) {
        pathCoordinates.push([priorPoint.lng, priorPoint.lat]);
      }
      pathCoordinates.push([currentPoint.lng, currentPoint.lat]);
      if (startedAtMs === null) {
        startedAtMs = priorPoint.ts;
      }
      endedAtMs = currentPoint.ts;
      distanceMeters += segmentMeters;
    }

    const snapshot = getMapSnapshot(map_id);
    if (snapshot) {
      appendRealtimeWal(map_id, events, snapshot);
    }

    broadcastEvents(map_id, events);

    if (distanceMeters > 0 && startedAtMs !== null && endedAtMs !== null) {
      const sample: RunDistanceSample = {
        userUid,
        username: authReq.auth.username,
        mapId: map_id,
        startedAtMs,
        endedAtMs,
        distanceMeters,
        pathCoordinates,
      };
      void recordRunDistance(sample).catch((error) => {
        console.warn('Failed to persist run distance sample', error);
      });
    }

    if (accepted === 0 && rejectedNotJoined) {
      res.status(409).json({
        error: 'player_not_joined',
        received: rawUpdates.length,
        accepted,
        rejectedNotJoined,
        rejectedOutOfBounds,
        rejectedAnticheat,
        ...buildAnticheatResponse(getPlayerAnticheatStatus(map_id, userUid)),
      });
      return;
    }

    if (accepted === 0 && rejectedOutOfBounds) {
      res.status(422).json({
        error: 'out_of_bounds',
        received: rawUpdates.length,
        accepted,
        rejectedNotJoined,
        rejectedOutOfBounds,
        rejectedAnticheat,
        ...buildAnticheatResponse(getPlayerAnticheatStatus(map_id, userUid)),
      });
      return;
    }

    res.status(202).json({
      received: rawUpdates.length,
      accepted,
      rejectedNotJoined,
      rejectedOutOfBounds,
      rejectedAnticheat,
      ...buildAnticheatResponse(getPlayerAnticheatStatus(map_id, userUid)),
    });
  });
  return router;
}

function buildAnticheatResponse(status: ReturnType<typeof getPlayerAnticheatStatus>) {
  return {
    anticheatLocked: Boolean(status?.locked),
    anticheatReason: status?.reason ?? null,
    returnTo: status?.returnTo ?? null,
    returnToleranceMeters: status?.returnToleranceMeters ?? null,
  };
}

function getLastPointForUser(snapshot: ReturnType<typeof getMapSnapshot>, userId: string): DistancePoint | null {
  if (!snapshot) {
    return null;
  }
  const player = snapshot.players.find((entry) => entry.userId === userId);
  const lastPoint = player?.lastPoint;
  if (!lastPoint) {
    return null;
  }
  if (
    !Number.isFinite(lastPoint.lat) ||
    !Number.isFinite(lastPoint.lng) ||
    !Number.isFinite(lastPoint.ts)
  ) {
    return null;
  }
  return { lat: lastPoint.lat, lng: lastPoint.lng, ts: lastPoint.ts };
}

function segmentDistanceMeters(a: DistancePoint, b: DistancePoint): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusMeters = 6_371_000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * earthRadiusMeters * Math.asin(Math.min(1, Math.sqrt(h)));
}
