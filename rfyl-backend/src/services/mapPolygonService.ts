import type { Response } from 'express';

type Point = {
  lat: number;
  lng: number;
  ts: number;
  accuracy?: number;
};

type LocationUpdate = Point & {
  userId: string;
};

type PolygonFeature = {
  type: 'Feature';
  geometry: {
    type: 'Polygon';
    coordinates: number[][][];
  };
  properties: {
    userId: string;
    updatedAt: number;
    pointCount: number;
  };
};

type MapState = {
  pointsByUser: Map<string, Point[]>;
  clients: Set<Response>;
};

const WINDOW_MS = 6 * 60 * 60 * 1_000;
const UPDATE_MS = 1_000;
const MAX_ACCURACY_METERS = 25;
const MIN_MOVEMENT_METERS = 2;

const mapStates = new Map<string, MapState>();
let loopStarted = false;

function getMapState(mapId: string): MapState {
  let state = mapStates.get(mapId);
  if (!state) {
    state = { pointsByUser: new Map(), clients: new Set() };
    mapStates.set(mapId, state);
  }
  return state;
}

export function registerClient(mapId: string, res: Response): void {
  const state = getMapState(mapId);
  state.clients.add(res);
}

export function removeClient(mapId: string, res: Response): void {
  const state = mapStates.get(mapId);
  if (!state) {
    return;
  }
  state.clients.delete(res);
  if (state.clients.size === 0 && state.pointsByUser.size === 0) {
    mapStates.delete(mapId);
  }
}

export function ingestLocations(mapId: string, updates: LocationUpdate[]): number {
  const state = getMapState(mapId);
  const now = Date.now();
  let accepted = 0;

  for (const update of updates) {
    const ts = Number.isFinite(update.ts) ? update.ts : now;
    if (!Number.isFinite(update.lat) || !Number.isFinite(update.lng)) {
      continue;
    }
    if (update.accuracy !== undefined && Number.isFinite(update.accuracy) && update.accuracy > MAX_ACCURACY_METERS) {
      continue;
    }

    if (!update.userId || typeof update.userId !== 'string') {
      continue;
    }

    const points = state.pointsByUser.get(update.userId) ?? [];
    const last = points.length > 0 ? points[points.length - 1] : undefined;
    if (last && haversineMeters(last, update) < MIN_MOVEMENT_METERS) {
      continue;
    }

    points.push({
      lat: update.lat,
      lng: update.lng,
      ts,
      ...(update.accuracy !== undefined ? { accuracy: update.accuracy } : {}),
    });
    const cutoff = now - WINDOW_MS;
    while (points.length > 0) {
      const firstPoint = points[0];
      if (!firstPoint || firstPoint.ts >= cutoff) {
        break;
      }
      points.shift();
    }
    state.pointsByUser.set(update.userId, points);
    accepted += 1;
  }

  startLoop();
  return accepted;
}

export function startLoop(): void {
  if (loopStarted) {
    return;
  }
  loopStarted = true;
  setInterval(() => {
    const now = Date.now();
    for (const [mapId, state] of mapStates.entries()) {
      if (state.clients.size === 0) {
        continue;
      }
      const polygons: PolygonFeature[] = [];
      for (const [userId, points] of state.pointsByUser.entries()) {
        const cutoff = now - WINDOW_MS;
        const recentPoints = points.filter((point) => point.ts >= cutoff);
        if (recentPoints.length === 0) {
          state.pointsByUser.delete(userId);
          continue;
        }
        state.pointsByUser.set(userId, recentPoints);
        if (recentPoints.length < 3) {
          continue;
        }
        const hull = convexHull(recentPoints);
        if (hull.length < 3) {
          continue;
        }
        polygons.push({
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [closeRing(hull.map((p) => [p.lng, p.lat]))],
          },
          properties: {
            userId,
            updatedAt: now,
            pointCount: recentPoints.length,
          },
        });
      }
      if (polygons.length === 0) {
        continue;
      }
      broadcast(state.clients, {
        mapId,
        updatedAt: now,
        polygons,
      });
    }
  }, UPDATE_MS);
}

function broadcast(clients: Set<Response>, payload: unknown): void {
  const data = `event: polygons\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    client.write(data);
  }
}

function closeRing(points: number[][]): number[][] {
  if (points.length === 0) {
    return points;
  }
  const first = points[0];
  if (!first) {
    return points;
  }
  const last = points[points.length - 1];
  if (!last) {
    return points;
  }
  const [firstLng, firstLat] = first;
  const [lastLng, lastLat] = last;
  if (
    firstLng === undefined ||
    firstLat === undefined ||
    lastLng === undefined ||
    lastLat === undefined
  ) {
    return points;
  }
  if (firstLng !== lastLng || firstLat !== lastLat) {
    points.push([firstLng, firstLat]);
  }
  return points;
}

function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) =>
    a.lng === b.lng ? a.lat - b.lat : a.lng - b.lng
  );
  if (sorted.length <= 1) {
    return sorted;
  }

  const lower: Point[] = [];
  for (const point of sorted) {
    while (lower.length >= 2) {
      const secondLast = lower[lower.length - 2];
      const last = lower[lower.length - 1];
      if (!secondLast || !last) {
        break;
      }
      if (cross(secondLast, last, point) <= 0) {
        lower.pop();
        continue;
      }
      break;
    }
    lower.push(point);
  }

  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const point = sorted[i];
    if (!point) {
      continue;
    }
    while (upper.length >= 2) {
      const secondLast = upper[upper.length - 2];
      const last = upper[upper.length - 1];
      if (!secondLast || !last) {
        break;
      }
      if (cross(secondLast, last, point) <= 0) {
        upper.pop();
        continue;
      }
      break;
    }
    upper.push(point);
  }

  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
}

function haversineMeters(a: Point, b: Point): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const r = 6_371_000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}
