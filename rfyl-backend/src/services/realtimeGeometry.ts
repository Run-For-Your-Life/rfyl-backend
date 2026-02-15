export type Position = [number, number];

export type AnyPolygonGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

const EPS = 1e-9;
const BOUNDARY_EPS = 1e-12;

export function pointInPolygon(point: Position, polygon: AnyPolygonGeometry): boolean {
  if (polygon.type === 'Polygon') {
    return pointInPolygonRings(point, polygon.coordinates);
  }
  for (const polygonRings of polygon.coordinates) {
    if (pointInPolygonRings(point, polygonRings)) {
      return true;
    }
  }
  return false;
}

function pointInPolygonRings(point: Position, rings: number[][][]): boolean {
  if (rings.length === 0) {
    return false;
  }
  const [outerRaw, ...holeRaws] = rings;
  if (!outerRaw) {
    return false;
  }
  const outer = toPositions(outerRaw);
  if (pointOnRingBoundary(point, outer)) {
    return true;
  }
  if (!rayCast(point, outer)) {
    return false;
  }
  for (const holeRaw of holeRaws) {
    if (!holeRaw) {
      continue;
    }
    const hole = toPositions(holeRaw);
    if (pointOnRingBoundary(point, hole)) {
      return false;
    }
    if (hole.length > 0 && rayCast(point, hole)) {
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

export function segmentPolygonBoundaryIntersection(
  segmentStart: Position,
  segmentEnd: Position,
  polygon: AnyPolygonGeometry
): Position | null {
  const rings =
    (polygon.type === 'Polygon' ? polygon.coordinates : polygon.coordinates.flat()) as Position[][];
  let bestPoint: Position | null = null;
  let bestT = Number.POSITIVE_INFINITY;

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

      const intersection = segmentIntersectionPoint(segmentStart, segmentEnd, a, b);
      if (intersection) {
        const t = segmentParameter(segmentStart, segmentEnd, intersection);
        if (t >= -EPS && t <= 1 + EPS && t < bestT) {
          bestT = t;
          bestPoint = intersection;
        }
        continue;
      }

      const colinear =
        isColinearWithSegment(segmentStart, segmentEnd, a) &&
        isColinearWithSegment(segmentStart, segmentEnd, b);
      if (!colinear) {
        continue;
      }

      // Colinear overlap fallback: use the earliest point on the overlap interval.
      const tA = segmentParameter(segmentStart, segmentEnd, a);
      const tB = segmentParameter(segmentStart, segmentEnd, b);
      const overlapStart = Math.max(0, Math.min(tA, tB));
      const overlapEnd = Math.min(1, Math.max(tA, tB));
      if (overlapStart <= overlapEnd + EPS) {
        const t = Math.max(0, Math.min(1, overlapStart));
        if (t < bestT) {
          bestT = t;
          bestPoint = interpolatePoint(segmentStart, segmentEnd, t);
        }
      }
    }
  }

  return bestPoint;
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
  const dx1 = b[0] - a[0];
  const dy1 = b[1] - a[1];
  const dx2 = c[0] - b[0];
  const dy2 = c[1] - b[1];
  const value = dy1 * dx2 - dx1 * dy2;
  const tolerance = EPS * (Math.abs(dx1) + Math.abs(dy1)) * (Math.abs(dx2) + Math.abs(dy2));
  if (Math.abs(value) <= tolerance) {
    return 0;
  }
  return value > 0 ? 1 : 2;
}

function segmentIntersectionPoint(a1: Position, a2: Position, b1: Position, b2: Position): Position | null {
  const [x1, y1] = a1;
  const [x2, y2] = a2;
  const [x3, y3] = b1;
  const [x4, y4] = b2;

  const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  const denomScale =
    (Math.abs(x1 - x2) + Math.abs(y1 - y2)) *
    (Math.abs(x3 - x4) + Math.abs(y3 - y4));
  if (Math.abs(denominator) <= EPS * denomScale) {
    return null;
  }

  const det1 = x1 * y2 - y1 * x2;
  const det2 = x3 * y4 - y3 * x4;
  const px = (det1 * (x3 - x4) - (x1 - x2) * det2) / denominator;
  const py = (det1 * (y3 - y4) - (y1 - y2) * det2) / denominator;
  const intersection: Position = [px, py];

  if (!onSegment(a1, intersection, a2) || !onSegment(b1, intersection, b2)) {
    return null;
  }

  return intersection;
}

function segmentParameter(start: Position, end: Position, point: Position): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (Math.abs(dx) >= Math.abs(dy) && Math.abs(dx) > EPS) {
    return (point[0] - start[0]) / dx;
  }
  if (Math.abs(dy) > EPS) {
    return (point[1] - start[1]) / dy;
  }
  return 0;
}

function interpolatePoint(start: Position, end: Position, t: number): Position {
  return [
    start[0] + (end[0] - start[0]) * t,
    start[1] + (end[1] - start[1]) * t,
  ];
}

function isColinearWithSegment(start: Position, end: Position, point: Position): boolean {
  const dx1 = end[0] - start[0];
  const dy1 = end[1] - start[1];
  const dx2 = point[0] - start[0];
  const dy2 = point[1] - start[1];
  const cross = dx1 * dy2 - dy1 * dx2;
  const tolerance = EPS * (Math.abs(dx1) + Math.abs(dy1)) * (Math.abs(dx2) + Math.abs(dy2));
  return Math.abs(cross) <= tolerance;
}

function onSegment(a: Position, b: Position, c: Position): boolean {
  return (
    b[0] <= Math.max(a[0], c[0]) + EPS &&
    b[0] + EPS >= Math.min(a[0], c[0]) &&
    b[1] <= Math.max(a[1], c[1]) + EPS &&
    b[1] + EPS >= Math.min(a[1], c[1])
  );
}

function pointOnRingBoundary(point: Position, ring: Position[]): boolean {
  if (ring.length < 2) {
    return false;
  }
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (!a || !b) {
      continue;
    }
    const closest = closestPointOnSegment(point, a, b);
    if (distanceSq(point, closest) <= BOUNDARY_EPS * BOUNDARY_EPS) {
      return true;
    }
  }
  return false;
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
