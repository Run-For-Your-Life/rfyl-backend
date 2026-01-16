export type Position = [number, number];

export type AnyPolygonGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

const EPS = 1e-9;

export function pointInPolygon(point: Position, polygon: AnyPolygonGeometry): boolean {
  const rings =
    (polygon.type === 'Polygon' ? polygon.coordinates : polygon.coordinates.flat()) as Position[][];
  if (rings.length === 0) {
    return false;
  }
  const [outer, ...holes] = rings;
  if (!outer || !rayCast(point, outer)) {
    return false;
  }
  for (const hole of holes) {
    if (hole && rayCast(point, hole)) {
      return false;
    }
  }
  return true;
}

export function snapPointToPolygonBoundary(
  point: Position,
  polygon: AnyPolygonGeometry
): { point: Position; distanceSq: number } {
  const rings =
    (polygon.type === 'Polygon' ? polygon.coordinates : polygon.coordinates.flat()) as Position[][];
  let bestPoint: Position | null = null;
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  for (const ring of rings) {
    const cleanRing = normalizeRing(ring);
    const len = cleanRing.length;
    if (len < 2) {
      continue;
    }
    for (let i = 0; i < len; i += 1) {
      const a = cleanRing[i];
      const b = cleanRing[(i + 1) % len];
      if (!a || !b) {
        continue;
      }
      const candidate = closestPointOnSegment(point, a, b);
      const distSq = distanceSq(point, candidate);
      if (distSq < bestDistanceSq) {
        bestDistanceSq = distSq;
        bestPoint = candidate;
      }
    }
  }
  return {
    point: bestPoint ?? point,
    distanceSq: bestDistanceSq,
  };
}

export function lineSegmentsIntersect(a1: Position, a2: Position, b1: Position, b2: Position): boolean {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);

  if (o1 !== o2 && o3 !== o4) {
    return true;
  }

  if (o1 === 0 && onSegment(a1, b1, a2)) return true;
  if (o2 === 0 && onSegment(a1, b2, a2)) return true;
  if (o3 === 0 && onSegment(b1, a1, b2)) return true;
  if (o4 === 0 && onSegment(b1, a2, b2)) return true;

  return false;
}

export function lineStringIntersects(line: number[][], segmentStart: Position, segmentEnd: Position): boolean {
  const positions = toPositions(line);
  if (positions.length < 2) {
    return false;
  }
  for (let i = 0; i < positions.length - 1; i += 1) {
    const a = positions[i];
    const b = positions[i + 1];
    if (!a || !b) {
      continue;
    }
    if (lineSegmentsIntersect(a, b, segmentStart, segmentEnd)) {
      return true;
    }
  }
  return false;
}

export function splitRingAtPoints(
  ring: number[][],
  pointA: Position,
  pointB: Position
): { forward: Position[]; backward: Position[] } {
  const cleaned = normalizeRing(toPositions(ring));
  if (cleaned.length < 2) {
    return { forward: [pointA, pointB], backward: [pointA, pointB] };
  }

  const withA = insertPointIntoRing(cleaned, pointA);
  const withB = insertPointIntoRing(withA, pointB);

  const idxA = indexOfPoint(withB, pointA);
  const idxB = indexOfPoint(withB, pointB);
  if (idxA === -1 || idxB === -1 || idxA === idxB) {
    return { forward: [pointA, pointB], backward: [pointA, pointB] };
  }

  const forward = walkRing(withB, idxA, idxB, 1);
  const backward = walkRing(withB, idxA, idxB, -1);

  return { forward, backward };
}

export function buildClosedRing(path: number[][], boundary: number[][]): Position[] {
  const pathPositions = toPositions(path);
  const boundaryPositions = toPositions(boundary);
  if (pathPositions.length === 0) {
    return [];
  }
  const ring = [...pathPositions];
  for (let i = 1; i < boundaryPositions.length; i += 1) {
    const point = boundaryPositions[i];
    if (point) {
      ring.push(point);
    }
  }
  return closeRing(ring);
}

export function polygonArea(ring: number[][]): number {
  const clean = closeRing(toPositions(ring));
  if (clean.length < 4) {
    return 0;
  }
  let sum = 0;
  for (let i = 0; i < clean.length - 1; i += 1) {
    const [x1, y1] = clean[i] ?? [];
    const [x2, y2] = clean[i + 1] ?? [];
    if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
      continue;
    }
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

export function chooseBoundarySegment(
  path: number[][],
  optionA: number[][],
  optionB: number[][]
): number[][] {
  const areaA = polygonArea(buildClosedRing(path, optionA));
  const areaB = polygonArea(buildClosedRing(path, optionB));
  if (areaA === 0 && areaB === 0) {
    return optionA;
  }
  if (areaA === areaB) {
    return optionA;
  }
  return areaA < areaB ? optionA : optionB;
}

export function closeRing(points: number[][]): Position[] {
  const positions = toPositions(points);
  if (positions.length === 0) {
    return positions;
  }
  const first = positions[0];
  if (!first) {
    return positions;
  }
  const last = positions[positions.length - 1];
  if (!last) {
    return positions;
  }
  if (first[0] !== last[0] || first[1] !== last[1]) {
    positions.push([first[0], first[1]]);
  }
  return positions;
}

function toPositions(points: number[][]): Position[] {
  if (points.length === 0) {
    return [];
  }
  const output: Position[] = [];
  for (const point of points) {
    if (point && point.length >= 2) {
      const [x, y] = point;
      if (x === undefined || y === undefined) {
        continue;
      }
      output.push([x, y]);
    }
  }
  return output;
}

function normalizeRing(ring: Position[]): Position[] {
  if (ring.length === 0) {
    return ring;
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && first[0] === last[0] && first[1] === last[1]) {
    return ring.slice(0, -1);
  }
  return ring.slice();
}

function insertPointIntoRing(ring: Position[], point: Position): Position[] {
  const idx = indexOfPoint(ring, point);
  if (idx !== -1) {
    return ring.slice();
  }
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (!a || !b) {
      continue;
    }
    const candidate = closestPointOnSegment(point, a, b);
    const distSq = distanceSq(point, candidate);
    if (distSq < bestDistance) {
      bestDistance = distSq;
      bestIndex = i;
    }
  }
  const output = ring.slice();
  output.splice(bestIndex + 1, 0, point);
  return output;
}

function walkRing(ring: Position[], from: number, to: number, step: 1 | -1): Position[] {
  const output: Position[] = [];
  let idx = from;
  while (true) {
    const point = ring[idx];
    if (point) {
      output.push(point);
    }
    if (idx === to) {
      break;
    }
    idx = (idx + step + ring.length) % ring.length;
  }
  return output;
}

function indexOfPoint(ring: Position[], point: Position): number {
  for (let i = 0; i < ring.length; i += 1) {
    const candidate = ring[i];
    if (!candidate) {
      continue;
    }
    if (Math.abs(candidate[0] - point[0]) < EPS && Math.abs(candidate[1] - point[1]) < EPS) {
      return i;
    }
  }
  return -1;
}

function distanceSq(a: Position, b: Position): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function closestPointOnSegment(p: Position, a: Position, b: Position): Position {
  const [x, y] = p;
  const [x1, y1] = a;
  const [x2, y2] = b;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (Math.abs(dx) < EPS && Math.abs(dy) < EPS) {
    return [x1, y1];
  }
  const t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
  const clamped = Math.max(0, Math.min(1, t));
  return [x1 + clamped * dx, y1 + clamped * dy];
}

function orientation(a: Position, b: Position, c: Position): number {
  const value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
  if (Math.abs(value) < EPS) {
    return 0;
  }
  return value > 0 ? 1 : 2;
}

function onSegment(a: Position, b: Position, c: Position): boolean {
  return (
    b[0] <= Math.max(a[0], c[0]) + EPS &&
    b[0] + EPS >= Math.min(a[0], c[0]) &&
    b[1] <= Math.max(a[1], c[1]) + EPS &&
    b[1] + EPS >= Math.min(a[1], c[1])
  );
}

function rayCast(point: Position, ring: Position[]): boolean {
  let inside = false;
  const [x, y] = point;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i]?.[0];
    const yi = ring[i]?.[1];
    const xj = ring[j]?.[0];
    const yj = ring[j]?.[1];
    if (xi === undefined || yi === undefined || xj === undefined || yj === undefined) {
      continue;
    }
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + EPS) + xi;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
}
