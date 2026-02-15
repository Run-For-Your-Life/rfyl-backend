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
} = require("../src/services/realtimeEngine.ts");
const { createGeometryOps } = require("../src/services/realtimeOps.ts");
const {
  pointInPolygon,
  segmentPolygonBoundaryIntersection,
} = require("../src/services/realtimeGeometry.ts");

console.log("Running realtime snapping tests...");

const ops = createGeometryOps();

const approxEqual = (a, b, eps = 1e-10) => Math.abs(a - b) <= eps;

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

  console.log("Realtime snapping tests passed.");
} catch (err) {
  clearMapState("snap-north");
  clearMapState("snap-south");
  clearMapState("snap-east");
  clearMapState("snap-west");
  console.error("Realtime snapping tests failed:");
  console.error(err);
  process.exit(1);
}
