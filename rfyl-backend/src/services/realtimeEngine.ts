import {
  buildClosedRing,
  chooseBoundarySegment,
  closeRing,
  lineStringIntersects,
  pointInPolygon,
  snapPointToPolygonBoundary,
  splitRingAtPoints,
} from './realtimeGeometry';
import type {
  GeoPoint,
  GhostState,
  MapState,
  PathFeature,
  PlayerState,
  TerritoryFeature,
} from './realtimeTypes';

type Position = [number, number];

type KnockoutReason = 'self-cross' | 'path-cross';

export type RealtimeEvent =
  | {
      type: 'path';
      mapId: string;
      userId: string;
      username: string;
      path: PathFeature;
    }
  | {
      type: 'territory';
      mapId: string;
      userId: string;
      username: string;
      territory: TerritoryFeature;
    }
  | {
      type: 'state';
      mapId: string;
      userId: string;
      username: string;
      ghostState: GhostState;
      ghostEligible: boolean;
      pathLengthMeters: number;
      territoryAreaSqMeters: number;
    }
  | {
      type: 'knockout';
      mapId: string;
      userId: string;
      username: string;
      byUserId: string;
      byUsername: string;
      reason: KnockoutReason;
    }
  | {
      type: 'reset';
      mapId: string;
      userId: string;
      username: string;
      reason: 'manual';
    };

export type GeometryOps = {
  union: (territory: TerritoryFeature, captured: TerritoryFeature) => TerritoryFeature;
  difference: (territory: TerritoryFeature, captured: TerritoryFeature) => TerritoryFeature | null;
};

export type MapSnapshot = {
  mapId: string;
  players: Array<{
    userId: string;
    username: string;
    isOutside: boolean;
    territory: TerritoryFeature | null;
    path: PathFeature | null;
    ghostState: GhostState;
    ghostEligible: boolean;
    pathLengthMeters: number;
    territoryAreaSqMeters: number;
    lastPoint?: GeoPoint;
    lastInsidePoint?: GeoPoint;
  }>;
};

const METERS_PER_DEG_LAT = 111_320;
const GHOST_SPAWN_SIZE_METERS = 3;
const GHOST_VULNERABLE_PATH_METERS = 400;
const GHOST_RESPAWN_AREA_SQ_METERS = 750;
const IDLE_FORGIVENESS_SEGMENT_METERS = 1.5;

const mapStates = new Map<string, MapState>();

export function getMapSnapshot(mapId: string): MapSnapshot | null {
  const state = mapStates.get(mapId);
  if (!state) {
    return null;
  }
  return {
    mapId,
    players: Array.from(state.players.values()).map((player) => ({
      userId: player.userId,
      username: player.username,
      isOutside: player.isOutside,
      territory: player.territory,
      path: player.path.length >= 2 ? toPathFeature(player) : null,
      ghostState: player.ghostState,
      ghostEligible: player.ghostEligible,
      pathLengthMeters: player.pathLengthMeters,
      territoryAreaSqMeters: player.territoryAreaSqMeters,
      ...(player.lastPoint ? { lastPoint: player.lastPoint } : {}),
      ...(player.lastInsidePoint ? { lastInsidePoint: player.lastInsidePoint } : {}),
    })),
  };
}

export function clearMapState(mapId: string): void {
  mapStates.delete(mapId);
}

export function respawnPlayer(mapId: string, userId: string): RealtimeEvent[] {
  const state = mapStates.get(mapId);
  if (!state) {
    return [];
  }
  const player = state.players.get(userId);
  if (!player) {
    return [];
  }

  // Explicit respawn after death: recreate a small spawn territory, remain ghost.
  if (!player.territory) {
    const spawnPoint = player.lastPoint ?? player.lastInsidePoint;
    if (!spawnPoint) {
      return [];
    }
    player.territory = createInitialTerritory(player.userId, spawnPoint);
    player.lastInsidePoint = spawnPoint;
    player.path = [];
    player.isOutside = false;
    player.pathLengthMeters = 0;
    player.ghostState = 'ghost_invulnerable';
    player.ghostEligible = false;
    player.territoryAreaSqMeters = estimateTerritoryAreaSqMeters(player.territory);
    return [
      {
        type: 'territory',
        mapId,
        userId: player.userId,
        username: player.username,
        territory: player.territory,
      },
      buildStateEvent(mapId, player),
    ];
  }

  if (player.ghostState === 'player' || !player.ghostEligible) {
    return [];
  }
  player.ghostState = 'player';
  player.ghostEligible = false;
  return [buildStateEvent(mapId, player)];
}

export function ingestLocation(
  mapId: string,
  userId: string,
  point: GeoPoint,
  ops: GeometryOps,
  username?: string
): RealtimeEvent[] {
  const state = getOrCreateMapState(mapId);
  const player = getOrCreatePlayer(state, userId, point, username);
  const events: RealtimeEvent[] = [];

  player.lastPoint = point;

  if (!player.territory) {
    return events;
  }

  const position: Position = [point.lng, point.lat];
  const inside = pointInPolygon(position, player.territory.geometry);
  if (inside) {
    player.lastInsidePoint = point;
    if (player.isOutside) {
      const captureEvents = closePath(state, player, position, ops);
      events.push(...captureEvents);
    }
    if (player.ghostState !== 'player' && player.territory) {
      updateTerritoryMetrics(player);
      events.push(buildStateEvent(state.mapId, player));
    }
    return events;
  }

  const pathEvents = extendPath(state, player, point);
  events.push(...pathEvents);
  return events;
}

function getOrCreateMapState(mapId: string): MapState {
  let state = mapStates.get(mapId);
  if (!state) {
    state = { mapId, players: new Map() };
    mapStates.set(mapId, state);
  }
  return state;
}

function getOrCreatePlayer(state: MapState, userId: string, point: GeoPoint, username?: string): PlayerState {
  const existing = state.players.get(userId);
  if (existing) {
    if (username && username !== existing.username) {
      existing.username = username;
    }
    return existing;
  }
  const territory = createInitialTerritory(userId, point);
  const player: PlayerState = {
    userId,
    username: username ?? userId,
    territory,
    path: [],
    isOutside: false,
    ghostState: 'ghost_invulnerable',
    ghostEligible: false,
    pathLengthMeters: 0,
    territoryAreaSqMeters: estimateTerritoryAreaSqMeters(territory),
    lastPoint: point,
    lastInsidePoint: point,
  };
  state.players.set(userId, player);
  return player;
}

function createInitialTerritory(userId: string, point: GeoPoint): TerritoryFeature {
  const halfMeters = GHOST_SPAWN_SIZE_METERS / 2;
  const latRad = (point.lat * Math.PI) / 180;
  const dLat = halfMeters / METERS_PER_DEG_LAT;
  const dLng = halfMeters / (METERS_PER_DEG_LAT * Math.cos(latRad));
  const ring: Position[] = closeRing([
    [point.lng - dLng, point.lat - dLat],
    [point.lng + dLng, point.lat - dLat],
    [point.lng + dLng, point.lat + dLat],
    [point.lng - dLng, point.lat + dLat],
  ]);
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [ring],
    },
    properties: {
      userId,
      updatedAt: Date.now(),
    },
  };
}

function extendPath(
  state: MapState,
  player: PlayerState,
  point: GeoPoint
): RealtimeEvent[] {
  const events: RealtimeEvent[] = [];
  if (!player.territory) {
    return events;
  }
  const position: Position = [point.lng, point.lat];

  if (!player.isOutside) {
    const lastInside = player.lastInsidePoint ?? point;
    const snapped = snapPointToPolygonBoundary([lastInside.lng, lastInside.lat], player.territory.geometry);
    player.path = [
      { lat: snapped.point[1], lng: snapped.point[0], ts: lastInside.ts },
      { lat: point.lat, lng: point.lng, ts: point.ts },
    ];
    player.isOutside = true;
    player.pathLengthMeters = pathLengthMeters(player.path);
    updateGhostVulnerability(player);
    events.push(buildPathEvent(state.mapId, player));
    if (player.ghostState !== 'player') {
      events.push(buildStateEvent(state.mapId, player));
    }
    return events;
  }

  const lastPathPoint = player.path[player.path.length - 1];
  if (!lastPathPoint) {
    return events;
  }

  const segmentMeters = segmentDistanceMeters(lastPathPoint, point);
  if (segmentMeters < IDLE_FORGIVENESS_SEGMENT_METERS) {
    // Ignore jitter-sized movement so idling GPS noise does not create illegal/self-cross segments.
    return events;
  }

  player.path.push(point);
  if (lastPathPoint) {
    const segmentStart: Position = [lastPathPoint.lng, lastPathPoint.lat];
    const segmentEnd: Position = position;
    player.pathLengthMeters += segmentMeters;
    updateGhostVulnerability(player);

    const selfKnockout = lineStringIntersects(
      player.path.slice(0, -2).map((p) => [p.lng, p.lat]),
      segmentStart,
      segmentEnd
    );
    if (selfKnockout) {
      events.push(knockoutPlayer(state.mapId, player, player, 'self-cross'));
      events.push(buildStateEvent(state.mapId, player));
      return events;
    }

    if (canKnock(player)) {
      for (const [otherId, otherPlayer] of state.players.entries()) {
        if (otherId === player.userId || !otherPlayer.isOutside) {
          continue;
        }
        if (!canBeKnocked(otherPlayer)) {
          continue;
        }
        const otherLine = otherPlayer.path.map((p) => [p.lng, p.lat]);
        if (lineStringIntersects(otherLine, segmentStart, segmentEnd)) {
          events.push(knockoutPlayer(state.mapId, otherPlayer, player, 'path-cross'));
          if (otherPlayer.ghostState !== 'player') {
            events.push(buildStateEvent(state.mapId, otherPlayer));
          }
        }
      }
    }
  }

  events.push(buildPathEvent(state.mapId, player));
  if (player.ghostState !== 'player') {
    events.push(buildStateEvent(state.mapId, player));
  }
  return events;
}

function closePath(
  state: MapState,
  player: PlayerState,
  reentry: Position,
  ops: GeometryOps
): RealtimeEvent[] {
  const events: RealtimeEvent[] = [];
  if (!player.territory || player.path.length < 2) {
    player.path = [];
    player.isOutside = false;
    return events;
  }
  const pathPositions = player.path.map((p) => [p.lng, p.lat]) as Position[];
  const exitPoint = pathPositions[0];
  if (!exitPoint) {
    player.path = [];
    player.isOutside = false;
    return events;
  }

  if (process.env.DEBUG_CAPTURE === '1') {
    console.warn('[capture] closing path', {
      mapId: state.mapId,
      userId: player.userId,
      pathPoints: pathPositions.length,
    });
  }

  const ring = getOuterRing(player.territory);
  const split = splitRingAtPoints(ring, exitPoint, reentry);
  const boundary = chooseBoundarySegment(pathPositions, split.forward, split.backward);
  const ringClosed = buildClosedRing(pathPositions, boundary);
  if (process.env.DEBUG_CAPTURE === '1') {
    console.warn('[capture] ring sizes', {
      boundaryPoints: boundary.length,
      ringClosedPoints: ringClosed.length,
    });
  }
  const captured: TerritoryFeature = {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [ringClosed],
    },
    properties: {
      userId: player.userId,
      updatedAt: Date.now(),
    },
  };

  player.territory = ops.union(player.territory, captured);
  player.territory.properties.updatedAt = Date.now();
  updateTerritoryMetrics(player);
  events.push({
    type: 'territory',
    mapId: state.mapId,
    userId: player.userId,
    username: player.username,
    territory: player.territory,
  });
  events.push(buildStateEvent(state.mapId, player));

  for (const [otherId, otherPlayer] of state.players.entries()) {
    if (otherId === player.userId || !otherPlayer.territory) {
      continue;
    }
    if (otherPlayer.ghostState === 'ghost_invulnerable') {
      continue;
    }
    const updated = ops.difference(otherPlayer.territory, captured);
    otherPlayer.territory = updated;
    if (updated) {
      updated.properties.updatedAt = Date.now();
      updateTerritoryMetrics(otherPlayer);
      events.push({
        type: 'territory',
        mapId: state.mapId,
        userId: otherId,
        username: otherPlayer.username,
        territory: updated,
      });
      events.push(buildStateEvent(state.mapId, otherPlayer));
    }
  }

  player.path = [];
  player.isOutside = false;
  player.pathLengthMeters = 0;
  return events;
}

function buildPathEvent(mapId: string, player: PlayerState): RealtimeEvent {
  const path = toPathFeature(player);
  return { type: 'path', mapId, userId: player.userId, username: player.username, path };
}

function buildStateEvent(mapId: string, player: PlayerState): RealtimeEvent {
  return {
    type: 'state',
    mapId,
    userId: player.userId,
    username: player.username,
    ghostState: player.ghostState,
    ghostEligible: player.ghostEligible,
    pathLengthMeters: player.pathLengthMeters,
    territoryAreaSqMeters: player.territoryAreaSqMeters,
  };
}

function knockoutPlayer(
  mapId: string,
  player: PlayerState,
  byPlayer: PlayerState,
  reason: KnockoutReason
): RealtimeEvent {
  player.territory = null;
  player.path = [];
  player.isOutside = false;
  player.pathLengthMeters = 0;
  player.territoryAreaSqMeters = 0;
  player.ghostState = 'ghost_invulnerable';
  player.ghostEligible = false;
  return {
    type: 'knockout',
    mapId,
    userId: player.userId,
    username: player.username,
    byUserId: byPlayer.userId,
    byUsername: byPlayer.username,
    reason,
  };
}

function getOuterRing(territory: TerritoryFeature): number[][] {
  if (territory.geometry.type === 'Polygon') {
    return territory.geometry.coordinates[0] ?? [];
  }
  const multi = territory.geometry.coordinates[0];
  return multi ? multi[0] ?? [] : [];
}

function toPathFeature(player: PlayerState): PathFeature {
  const coordinates = player.path.map((p) => [p.lng, p.lat]);
  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates,
    },
    properties: {
      userId: player.userId,
      updatedAt: Date.now(),
    },
  };
}

function canKnock(player: PlayerState): boolean {
  return player.ghostState === 'player';
}

function canBeKnocked(player: PlayerState): boolean {
  return player.ghostState !== 'ghost_invulnerable';
}

function updateGhostVulnerability(player: PlayerState): void {
  if (player.ghostState !== 'ghost_invulnerable') {
    return;
  }
  if (player.pathLengthMeters >= GHOST_VULNERABLE_PATH_METERS) {
    player.ghostState = 'ghost_vulnerable';
  }
}

function updateTerritoryMetrics(player: PlayerState): void {
  if (!player.territory) {
    return;
  }
  player.territoryAreaSqMeters = estimateTerritoryAreaSqMeters(player.territory);
  if (player.ghostState !== 'player' && player.territoryAreaSqMeters >= GHOST_RESPAWN_AREA_SQ_METERS) {
    player.ghostEligible = true;
  }
}

function pathLengthMeters(path: GeoPoint[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    const prev = path[i - 1];
    const next = path[i];
    if (!prev || !next) {
      continue;
    }
    total += segmentDistanceMeters(prev, next);
  }
  return total;
}

function segmentDistanceMeters(a: GeoPoint, b: GeoPoint): number {
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

function estimateTerritoryAreaSqMeters(territory: TerritoryFeature): number {
  if (territory.geometry.type === 'Polygon') {
    return polygonAreaSqMeters(territory.geometry.coordinates);
  }
  return territory.geometry.coordinates.reduce((sum, polygon) => sum + polygonAreaSqMeters(polygon), 0);
}

function polygonAreaSqMeters(rings: number[][][]): number {
  if (rings.length === 0) {
    return 0;
  }
  const outer = rings[0] ?? [];
  let total = ringAreaSqMeters(outer);
  for (let i = 1; i < rings.length; i += 1) {
    total -= ringAreaSqMeters(rings[i] ?? []);
  }
  return Math.max(0, total);
}

function ringAreaSqMeters(ring: number[][]): number {
  if (ring.length < 3) {
    return 0;
  }
  const avgLat = ring.reduce((sum, point) => sum + (point?.[1] ?? 0), 0) / ring.length;
  const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos((avgLat * Math.PI) / 180);
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const curr = ring[i];
    const next = ring[(i + 1) % ring.length];
    if (!curr || !next) {
      continue;
    }
    const [lng1, lat1] = curr;
    const [lng2, lat2] = next;
    if (lng1 === undefined || lat1 === undefined || lng2 === undefined || lat2 === undefined) {
      continue;
    }
    const x1 = lng1 * metersPerDegLng;
    const y1 = lat1 * METERS_PER_DEG_LAT;
    const x2 = lng2 * metersPerDegLng;
    const y2 = lat2 * METERS_PER_DEG_LAT;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}
