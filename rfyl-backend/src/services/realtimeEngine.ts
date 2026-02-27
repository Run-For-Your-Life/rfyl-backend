import {
  buildClosedRing,
  chooseBoundarySegment,
  closeRing,
  lineStringIntersects,
  pointInPolygon,
  segmentPolygonBoundaryIntersection,
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
      colornum: number;
      path: PathFeature;
    }
  | {
      type: 'territory';
      mapId: string;
      userId: string;
      username: string;
      colornum: number;
      territory: TerritoryFeature;
    }
  | {
      type: 'state';
      mapId: string;
      userId: string;
      username: string;
      colornum: number;
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
    colornum: number;
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
const IDLE_FORGIVENESS_SEGMENT_METERS = 1.5;
const MAX_PLAYERS_PER_MAP = 10;

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
      colornum: player.colornum,
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

export function hasPlayer(mapId: string, userId: string): boolean {
  const state = mapStates.get(mapId);
  return Boolean(state?.players.get(userId));
}

export function isMapAtCapacity(mapId: string): boolean {
  const state = mapStates.get(mapId);
  return Boolean(state && state.players.size >= MAX_PLAYERS_PER_MAP);
}

export function joinPlayer(mapId: string, userId: string, username?: string): RealtimeEvent[] {
  const state = getOrCreateMapState(mapId);
  const existing = state.players.get(userId);
  if (existing) {
    if (
      !Number.isInteger(existing.colornum) ||
      existing.colornum < 0 ||
      existing.colornum >= MAX_PLAYERS_PER_MAP
    ) {
      existing.colornum = selectColor(state);
    }
    if (username && username !== existing.username) {
      existing.username = username;
      return [buildStateEvent(mapId, existing)];
    }
    return [];
  }
  if (state.players.size >= MAX_PLAYERS_PER_MAP) {
    return [];
  }

  const player: PlayerState = {
    userId,
    username: username ?? userId,
    colornum: selectColor(state),
    territory: null,
    path: [],
    isOutside: false,
    ghostState: 'ghost_invulnerable',
    ghostEligible: false,
    pathLengthMeters: 0,
    territoryAreaSqMeters: 0,
  };
  state.players.set(userId, player);
  return [buildStateEvent(mapId, player)];
}

// Assign a random unused color index (0-9) for this map session.
function selectColor(state: MapState): number {
  const used = new Set<number>();
  for (const player of state.players.values()) {
    // Track colors already assigned to active players on this map.
    if (
      Number.isInteger(player.colornum) &&
      player.colornum >= 0 &&
      player.colornum < MAX_PLAYERS_PER_MAP
    ) {
      used.add(player.colornum);
    }
  }
  const available: number[] = [];
  for (let color = 0; color < MAX_PLAYERS_PER_MAP; color += 1) {
    // Build the pool of colors that are still free.
    if (!used.has(color)) {
      available.push(color);
    }
  }
  if (available.length > 0) {
    // Randomly pick one free color to avoid deterministic assignment order.
    const randomIndex = Math.floor(Math.random() * available.length);
    return available[randomIndex] ?? 0;
  }
  // Fallback: should only happen when map is full or state is inconsistent.
  return 0;
}

export function respawnPlayer(mapId: string, userId: string, spawnPoint?: GeoPoint): RealtimeEvent[] {
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
    const point = spawnPoint ?? player.lastPoint ?? player.lastInsidePoint;
    if (!point) {
      return [];
    }
    player.territory = createInitialTerritory(player.userId, point);
    player.lastPoint = point;
    player.lastInsidePoint = point;
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
        colornum: player.colornum,
        territory: player.territory,
      },
      buildStateEvent(mapId, player),
    ];
  }

  return [];
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
  if (!player) {
    return events;
  }

  const prevPoint = player.lastPoint;
  if (prevPoint && point.ts <= prevPoint.ts) {
    return events;
  }
  const prevInside = Boolean(
    player.territory &&
      prevPoint &&
      pointInPolygon([prevPoint.lng, prevPoint.lat], player.territory.geometry)
  );
  player.lastPoint = point;

  if (!player.territory) {
    return events;
  }

  const position: Position = [point.lng, point.lat];
  const inside = pointInPolygon(position, player.territory.geometry);
  if (inside) {
    player.lastInsidePoint = point;
    if (player.isOutside) {
      const lastOutside = player.path[player.path.length - 1];
      const lastOutsidePosition: Position = lastOutside
        ? [lastOutside.lng, lastOutside.lat]
        : position;
      const reentryBoundary =
        segmentPolygonBoundaryIntersection(lastOutsidePosition, position, player.territory.geometry) ??
        snapPointToPolygonBoundary(position, player.territory.geometry).point;
      const fallbackReentryBoundary = snapPointToPolygonBoundary(position, player.territory.geometry).point;
      const captureEvents = closePath(state, player, reentryBoundary, ops, fallbackReentryBoundary);
      events.push(...captureEvents);
    }
    if (player.ghostState !== 'player' && player.territory) {
      updateTerritoryMetrics(player);
      events.push(buildStateEvent(state.mapId, player));
    }
    return events;
  }

  const pathEvents = extendPath(state, player, point, prevInside);
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

function getOrCreatePlayer(state: MapState, userId: string, point: GeoPoint, username?: string): PlayerState | null {
  const existing = state.players.get(userId);
  if (existing) {
    if (username && username !== existing.username) {
      existing.username = username;
    }
    return existing;
  }
  if (state.players.size >= MAX_PLAYERS_PER_MAP) {
    return null;
  }
  const territory = createInitialTerritory(userId, point);
  const player: PlayerState = {
    userId,
    username: username ?? userId,
    colornum: selectColor(state),
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
  point: GeoPoint,
  prevInside: boolean
): RealtimeEvent[] {
  const events: RealtimeEvent[] = [];
  if (!player.territory) {
    return events;
  }
  const position: Position = [point.lng, point.lat];

  if (!player.isOutside) {
    // Only start a path when we actually transition from inside -> outside.
    // If we begin with an outside sample (no trusted inside predecessor), ignore it.
    if (!prevInside) {
      return events;
    }
    const lastInside = player.lastInsidePoint ?? point;
    const lastInsidePosition: Position = [lastInside.lng, lastInside.lat];
    const boundaryIntersection = segmentPolygonBoundaryIntersection(
      lastInsidePosition,
      position,
      player.territory.geometry
    );
    const snapped =
      boundaryIntersection ??
      snapPointToPolygonBoundary(lastInsidePosition, player.territory.geometry).point;
    player.path = [
      { lat: snapped[1], lng: snapped[0], ts: lastInside.ts },
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
          events.push(buildStateEvent(state.mapId, otherPlayer));
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
  reentryBoundary: Position,
  ops: GeometryOps,
  fallbackReentryBoundary?: Position
): RealtimeEvent[] {
  const events: RealtimeEvent[] = [];
  if (!player.territory || player.path.length < 2) {
    player.path = [];
    player.isOutside = false;
    return events;
  }
  const basePathPositions = player.path.map((p) => [p.lng, p.lat]) as Position[];
  const exitPoint = basePathPositions[0];
  if (!exitPoint) {
    player.path = [];
    player.isOutside = false;
    return events;
  }

  if (process.env.DEBUG_CAPTURE === '1') {
    console.warn('[capture] closing path', {
      mapId: state.mapId,
      userId: player.userId,
      pathPoints: basePathPositions.length,
    });
  }

  const reentryCandidates: Position[] = [reentryBoundary];
  if (
    fallbackReentryBoundary &&
    !samePosition(fallbackReentryBoundary, reentryBoundary)
  ) {
    reentryCandidates.push(fallbackReentryBoundary);
  }

  let captured: TerritoryFeature | null = null;
  for (const candidate of reentryCandidates) {
    const pathPositions = basePathPositions.slice();
    const lastPathPoint = pathPositions[pathPositions.length - 1];
    if (!lastPathPoint || !samePosition(lastPathPoint, candidate)) {
      pathPositions.push(candidate);
    }

    const ring = chooseTerritoryBoundaryRing(player.territory, exitPoint, candidate);
    const split = splitRingAtPoints(ring, exitPoint, candidate);
    const boundary = chooseBoundarySegment(pathPositions, split.forward, split.backward);
    const ringClosed = buildClosedRing(pathPositions, boundary);
    if (process.env.DEBUG_CAPTURE === '1') {
      console.warn('[capture] ring sizes', {
        boundaryPoints: boundary.length,
        ringClosedPoints: ringClosed.length,
      });
    }

    const attemptCaptured: TerritoryFeature = {
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

    try {
      player.territory = ops.union(player.territory, attemptCaptured);
      captured = attemptCaptured;
      break;
    } catch (error) {
      if (process.env.DEBUG_CAPTURE === '1') {
        console.warn('[capture] union failed, trying fallback', { error });
      }
    }
  }

  if (!captured) {
    player.path = [];
    player.isOutside = false;
    player.pathLengthMeters = 0;
    return events;
  }

  player.territory.properties.updatedAt = Date.now();
  updateTerritoryMetrics(player);
  if (player.ghostState !== 'player') {
    player.ghostState = 'player';
    player.ghostEligible = false;
  }
  events.push({
    type: 'territory',
    mapId: state.mapId,
    userId: player.userId,
    username: player.username,
    colornum: player.colornum,
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
        colornum: otherPlayer.colornum,
        territory: updated,
      });
      events.push(buildStateEvent(state.mapId, otherPlayer));
    } else {
      otherPlayer.territoryAreaSqMeters = 0;
      otherPlayer.path = [];
      otherPlayer.isOutside = false;
      otherPlayer.pathLengthMeters = 0;
      otherPlayer.ghostState = 'ghost_invulnerable';
      otherPlayer.ghostEligible = false;
      delete otherPlayer.lastInsidePoint;
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
  return {
    type: 'path',
    mapId,
    userId: player.userId,
    username: player.username,
    colornum: player.colornum,
    path,
  };
}

function buildStateEvent(mapId: string, player: PlayerState): RealtimeEvent {
  return {
    type: 'state',
    mapId,
    userId: player.userId,
    username: player.username,
    colornum: player.colornum,
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
  resetPlayerAfterKnockout(player);
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

function resetPlayerAfterKnockout(player: PlayerState): void {
  player.territory = null;
  player.path = [];
  player.isOutside = false;
  player.pathLengthMeters = 0;
  player.territoryAreaSqMeters = 0;
  player.ghostState = 'ghost_invulnerable';
  player.ghostEligible = false;
  delete player.lastInsidePoint;
}

function chooseTerritoryBoundaryRing(territory: TerritoryFeature, pointA: Position, pointB: Position): number[][] {
  const rings = getBoundaryRings(territory);
  if (rings.length === 0) {
    return [];
  }

  for (const ring of rings) {
    if (isPointOnRingBoundary(pointA, ring) && isPointOnRingBoundary(pointB, ring)) {
      return ring;
    }
  }

  let bestRing = rings[0] ?? [];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const ring of rings) {
    const score = distancePointToRingSq(pointA, ring) + distancePointToRingSq(pointB, ring);
    if (score < bestScore) {
      bestScore = score;
      bestRing = ring;
    }
  }

  return bestRing;
}

function getBoundaryRings(territory: TerritoryFeature): number[][][] {
  if (territory.geometry.type === 'Polygon') {
    return territory.geometry.coordinates[0] ? [territory.geometry.coordinates[0]] : [];
  }
  const rings: number[][][] = [];
  for (const polygon of territory.geometry.coordinates) {
    const outer = polygon?.[0];
    if (outer) {
      rings.push(outer);
    }
  }
  return rings;
}

function isPointOnRingBoundary(point: Position, ring: number[][]): boolean {
  return distancePointToRingSq(point, ring) <= 1e-20;
}

function distancePointToRingSq(point: Position, ring: number[][]): number {
  if (ring.length < 2) {
    return Number.POSITIVE_INFINITY;
  }
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (!a || !b) {
      continue;
    }
    const [ax, ay] = a;
    const [bx, by] = b;
    if (ax === undefined || ay === undefined || bx === undefined || by === undefined) {
      continue;
    }
    const d = pointToSegmentDistanceSq(point[0], point[1], ax, ay, bx, by);
    if (d < best) {
      best = d;
    }
  }
  return best;
}

function pointToSegmentDistanceSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) {
    const ex = px - ax;
    const ey = py - ay;
    return ex * ex + ey * ey;
  }
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  const clamped = Math.max(0, Math.min(1, t));
  const cx = ax + clamped * dx;
  const cy = ay + clamped * dy;
  const ex = px - cx;
  const ey = py - cy;
  return ex * ex + ey * ey;
}

function samePosition(a: Position, b: Position): boolean {
  return Math.abs(a[0] - b[0]) <= 1e-12 && Math.abs(a[1] - b[1]) <= 1e-12;
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
