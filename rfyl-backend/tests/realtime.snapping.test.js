const assert = require("assert");
const tsNode = require("ts-node");

tsNode.register({
  transpileOnly: true,
  compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext" },
});

const {
  clearMapState,
  getMapSnapshot,
  ingestLocation,
  joinPlayer,
  respawnPlayer,
} = require("../src/services/realtimeEngine.ts");
const { createGeometryOps } = require("../src/services/realtimeOps.ts");
const {
  pointInPolygon,
  segmentPolygonBoundaryIntersection,
} = require("../src/services/realtimeGeometry.ts");

console.log("Running realtime snapping tests...");

const ops = createGeometryOps();

const approxEqual = (a, b, eps = 1e-10) => Math.abs(a - b) <= eps;

const distanceSq = (a, b) => {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
};

const closestPointOnSegment = (p, a, b) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (approxEqual(dx, 0) && approxEqual(dy, 0)) {
    return [a[0], a[1]];
  }
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  const clamped = Math.max(0, Math.min(1, t));
  return [a[0] + clamped * dx, a[1] + clamped * dy];
};

const nearestBoundaryPoint = (point, ring) => {
  let best = null;
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const a = ring[i];
    const b = ring[i + 1];
    if (!a || !b) {
      continue;
    }
    const candidate = closestPointOnSegment(point, a, b);
    const dSq = distanceSq(point, candidate);
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      best = candidate;
    }
  }
  return best;
};

const getPlayer = (mapId, userId) => {
  const snapshot = getMapSnapshot(mapId);
  assert.ok(snapshot, "expected snapshot");
  const player = snapshot.players.find((p) => p.userId === userId);
  assert.ok(player, "expected player");
  return player;
};

const getBounds = (territory) => {
  const ring =
    territory.geometry.type === "Polygon"
      ? territory.geometry.coordinates[0]
      : territory.geometry.coordinates[0][0];
  const lngs = ring.map((p) => p[0]).filter((v) => v !== undefined);
  const lats = ring.map((p) => p[1]).filter((v) => v !== undefined);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  return {
    minLng,
    maxLng,
    minLat,
    maxLat,
    dLng: (maxLng - minLng) / 2,
    dLat: (maxLat - minLat) / 2,
    centerLng: (minLng + maxLng) / 2,
    centerLat: (minLat + maxLat) / 2,
  };
};

const createSender = (mapId, userId) => {
  let ts = 1;
  const username = `name-${userId}`;
  return (lat, lng) => ingestLocation(mapId, userId, { lat, lng, ts: ts++ }, ops, username);
};

const assertExitSnap = ({ mapId, userId, outsideLat, outsideLng, expectedEdge, expectedValue, onAxisExpected }) => {
  const send = createSender(mapId, userId);

  send(0, 0);
  const seeded = getPlayer(mapId, userId);
  const bounds = getBounds(seeded.territory);

  // Set last-inside point to center before crossing outward.
  send(bounds.centerLat, bounds.centerLng);
  send(outsideLat(bounds), outsideLng(bounds));

  const after = getPlayer(mapId, userId);
  assert.ok(after.path, "expected active path after leaving territory");
  const [start] = after.path.geometry.coordinates;
  assert.ok(start, "expected first path coordinate");

  const [snapLng, snapLat] = start;

  if (expectedEdge === "north" || expectedEdge === "south") {
    assert.ok(
      approxEqual(snapLat, expectedValue(bounds)),
      `expected snapped lat on ${expectedEdge} edge`
    );
    assert.ok(
      approxEqual(snapLng, onAxisExpected(bounds)),
      `expected snapped lng to match crossing axis on ${expectedEdge}`
    );
  } else {
    assert.ok(
      approxEqual(snapLng, expectedValue(bounds)),
      `expected snapped lng on ${expectedEdge} edge`
    );
    assert.ok(
      approxEqual(snapLat, onAxisExpected(bounds)),
      `expected snapped lat to match crossing axis on ${expectedEdge}`
    );
  }
};

const assertIntersectionSnapCase = ({
  mapId,
  userId,
  insideFromBounds,
  outsideFromBounds,
  expectedFromBounds,
  assertDifferentFromNearest,
}) => {
  const send = createSender(mapId, userId);
  send(0, 0);
  const seeded = getPlayer(mapId, userId);
  const bounds = getBounds(seeded.territory);
  const inside = insideFromBounds(bounds);
  const outside = outsideFromBounds(bounds);

  send(inside[1], inside[0]);
  send(outside[1], outside[0]);

  const after = getPlayer(mapId, userId);
  assert.ok(after.path, "expected active path after crossing outside");
  const [snapped] = after.path.geometry.coordinates;
  assert.ok(snapped, "expected snapped path start");

  const expected = segmentPolygonBoundaryIntersection(inside, outside, seeded.territory.geometry);
  assert.ok(expected, "expected segment-boundary intersection");
  assert.ok(approxEqual(snapped[0], expected[0]), "expected snapped lng from intersection");
  assert.ok(approxEqual(snapped[1], expected[1]), "expected snapped lat from intersection");

  if (expectedFromBounds) {
    expectedFromBounds(bounds, snapped);
  }

  if (assertDifferentFromNearest) {
    const ring =
      seeded.territory.geometry.type === "Polygon"
        ? seeded.territory.geometry.coordinates[0]
        : seeded.territory.geometry.coordinates[0][0];
    const nearest = nearestBoundaryPoint(inside, ring);
    assert.ok(nearest, "expected nearest boundary point");
    const snappedDistToNearest = Math.sqrt(distanceSq(snapped, nearest));
    assert.ok(
      snappedDistToNearest > 1e-12,
      "expected snapped point to differ from nearest-point snap in this case"
    );
  }
};

try {
  assertExitSnap({
    mapId: "snap-north",
    userId: "player-north",
    outsideLat: (b) => b.maxLat + b.dLat * 3,
    outsideLng: (b) => b.centerLng,
    expectedEdge: "north",
    expectedValue: (b) => b.maxLat,
    onAxisExpected: (b) => b.centerLng,
  });
  clearMapState("snap-north");

  assertExitSnap({
    mapId: "snap-south",
    userId: "player-south",
    outsideLat: (b) => b.minLat - b.dLat * 3,
    outsideLng: (b) => b.centerLng,
    expectedEdge: "south",
    expectedValue: (b) => b.minLat,
    onAxisExpected: (b) => b.centerLng,
  });
  clearMapState("snap-south");

  assertExitSnap({
    mapId: "snap-east",
    userId: "player-east",
    outsideLat: (b) => b.centerLat,
    outsideLng: (b) => b.maxLng + b.dLng * 3,
    expectedEdge: "east",
    expectedValue: (b) => b.maxLng,
    onAxisExpected: (b) => b.centerLat,
  });
  clearMapState("snap-east");

  assertExitSnap({
    mapId: "snap-west",
    userId: "player-west",
    outsideLat: (b) => b.centerLat,
    outsideLng: (b) => b.minLng - b.dLng * 3,
    expectedEdge: "west",
    expectedValue: (b) => b.minLng,
    onAxisExpected: (b) => b.centerLat,
  });
  clearMapState("snap-west");

  // Boundary points should be consistently treated as inside.
  {
    const square = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ],
    };
    assert.strictEqual(pointInPolygon([0, 0], square), true, "expected SW corner inside");
    assert.strictEqual(pointInPolygon([10, 0], square), true, "expected SE corner inside");
    assert.strictEqual(pointInPolygon([10, 10], square), true, "expected NE corner inside");
    assert.strictEqual(pointInPolygon([0, 10], square), true, "expected NW corner inside");
  }

  // Colinear edge movement should snap to first overlap point, not jump to a corner.
  {
    const square = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ],
    };
    const snapped = segmentPolygonBoundaryIntersection([5, 0], [12, 0], square);
    assert.ok(snapped, "expected edge intersection");
    assert.ok(approxEqual(snapped[0], 5), "expected no corner-bias on x");
    assert.ok(approxEqual(snapped[1], 0), "expected no corner-bias on y");
  }

  // Center/origin inside -> straight south outside should hit bottom-middle boundary point.
  assertIntersectionSnapCase({
    mapId: "snap-origin-south",
    userId: "player-origin-south",
    insideFromBounds: (b) => [b.centerLng, b.centerLat],
    outsideFromBounds: (b) => [b.centerLng, b.minLat - b.dLat * 3],
    expectedFromBounds: (b, snapped) => {
      assert.ok(approxEqual(snapped[0], b.centerLng), "expected bottom-middle lng");
      assert.ok(approxEqual(snapped[1], b.minLat), "expected bottom-middle lat");
    },
    assertDifferentFromNearest: false,
  });
  clearMapState("snap-origin-south");

  // Regression guards: segment intersection should win over nearest-point projection.
  assertIntersectionSnapCase({
    mapId: "snap-origin-diagonal-se",
    userId: "player-origin-diagonal-se",
    insideFromBounds: (b) => [b.centerLng, b.centerLat],
    outsideFromBounds: (b) => [b.maxLng + b.dLng * 2, b.minLat - b.dLat * 2],
    assertDifferentFromNearest: true,
  });
  clearMapState("snap-origin-diagonal-se");

  assertIntersectionSnapCase({
    mapId: "snap-offcenter-diagonal-ne",
    userId: "player-offcenter-diagonal-ne",
    insideFromBounds: (b) => [b.centerLng - b.dLng * 0.2, b.centerLat + b.dLat * 0.1],
    outsideFromBounds: (b) => [b.maxLng + b.dLng * 2.5, b.maxLat + b.dLat * 2],
    assertDifferentFromNearest: true,
  });
  clearMapState("snap-offcenter-diagonal-ne");

  // Full lifecycle regression: join + respawn + center->outside should snap to crossed edge (not bottom middle).
  {
    const mapId = "snap-respawn-center-east";
    const userId = "player-respawn-east";
    joinPlayer(mapId, userId, `name-${userId}`);
    const respawnTs = Date.now();
    const spawnLat = 44.56;
    const spawnLng = -123.28;
    const respawnEvents = respawnPlayer(mapId, userId, { lat: spawnLat, lng: spawnLng, ts: respawnTs });
    assert.ok(respawnEvents.length > 0, "expected respawn to seed territory");

    const seeded = getPlayer(mapId, userId);
    const bounds = getBounds(seeded.territory);
    const center = [bounds.centerLng, bounds.centerLat];
    const outsideEast = [bounds.maxLng + bounds.dLng * 3, bounds.centerLat];

    ingestLocation(mapId, userId, { lat: center[1], lng: center[0], ts: respawnTs + 1000 }, ops, `name-${userId}`);
    ingestLocation(
      mapId,
      userId,
      { lat: outsideEast[1], lng: outsideEast[0], ts: respawnTs + 1001 },
      ops,
      `name-${userId}`
    );

    const after = getPlayer(mapId, userId);
    assert.ok(after.path, "expected active path after exiting from center");
    const [snapped] = after.path.geometry.coordinates;
    assert.ok(snapped, "expected snapped path start");
    assert.ok(approxEqual(snapped[0], bounds.maxLng), "expected east-edge intersection lng");
    assert.ok(approxEqual(snapped[1], bounds.centerLat), "expected center-lat intersection");
    assert.ok(!approxEqual(snapped[1], bounds.minLat), "did not expect bottom-middle snap");

    clearMapState(mapId);
  }

  console.log("Realtime snapping tests passed.");
} catch (err) {
  clearMapState("snap-north");
  clearMapState("snap-south");
  clearMapState("snap-east");
  clearMapState("snap-west");
  clearMapState("snap-origin-south");
  clearMapState("snap-origin-diagonal-se");
  clearMapState("snap-offcenter-diagonal-ne");
  clearMapState("snap-respawn-center-east");
  console.error("Realtime snapping tests failed:");
  console.error(err);
  process.exit(1);
}
