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
const { pointInPolygon } = require("../src/services/realtimeGeometry.ts");

console.log("Running realtime edge-case regression tests...");

const ops = createGeometryOps();
const failures = [];

const runCase = (name, fn) => {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.error(`FAIL ${name}`);
    console.error(err);
  }
};

runCase("pointInPolygon should treat any MultiPolygon island as inside", () => {
  const multi = {
    type: "MultiPolygon",
    coordinates: [
      [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
      [
        [
          [10, 10],
          [11, 10],
          [11, 11],
          [10, 11],
          [10, 10],
        ],
      ],
    ],
  };

  assert.strictEqual(
    pointInPolygon([10.5, 10.5], multi),
    true,
    "expected inside=true for point in second multipolygon island"
  );
});

runCase("ingestLocation should ignore stale/out-of-order timestamps", () => {
  const mapId = "edge-stale-ts";
  const userId = "player-stale";
  try {
    ingestLocation(mapId, userId, { lat: 0, lng: 0, ts: 100 }, ops, "name-player-stale");
    ingestLocation(mapId, userId, { lat: 0, lng: 0.000001, ts: 200 }, ops, "name-player-stale");

    const before = getMapSnapshot(mapId);
    assert.ok(before, "expected snapshot before stale packet");
    const beforePlayer = before.players.find((p) => p.userId === userId);
    assert.ok(beforePlayer, "expected player before stale packet");

    ingestLocation(mapId, userId, { lat: 0.01, lng: 0.01, ts: 150 }, ops, "name-player-stale");

    const after = getMapSnapshot(mapId);
    assert.ok(after, "expected snapshot after stale packet");
    const afterPlayer = after.players.find((p) => p.userId === userId);
    assert.ok(afterPlayer, "expected player after stale packet");

    assert.strictEqual(
      afterPlayer.lastPoint?.ts,
      beforePlayer.lastPoint?.ts,
      "expected stale packet not to update lastPoint"
    );
    assert.strictEqual(
      afterPlayer.isOutside,
      beforePlayer.isOutside,
      "expected stale packet not to change outside/inside state"
    );
  } finally {
    clearMapState(mapId);
  }
});

runCase("map should enforce max 10 players", () => {
  const mapId = "edge-player-cap";
  try {
    for (let i = 0; i < 11; i += 1) {
      ingestLocation(
        mapId,
        `user-${i}`,
        { lat: i * 0.000001, lng: 0, ts: i + 1 },
        ops,
        `name-user-${i}`
      );
    }

    const snapshot = getMapSnapshot(mapId);
    assert.ok(snapshot, "expected map snapshot");
    assert.ok(
      snapshot.players.length <= 10,
      `expected at most 10 players, got ${snapshot.players.length}`
    );
  } finally {
    clearMapState(mapId);
  }
});

if (failures.length > 0) {
  console.error(`Realtime edge-case regression tests failed: ${failures.length} case(s)`);
  process.exit(1);
}

console.log("Realtime edge-case regression tests passed.");
