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
    const beforePathLength = beforePlayer.pathLengthMeters;
    const beforeLastInsideTs = beforePlayer.lastInsidePoint?.ts;

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
    assert.strictEqual(
      afterPlayer.pathLengthMeters,
      beforePathLength,
      "expected stale packet not to change path length"
    );
    assert.strictEqual(
      afterPlayer.lastInsidePoint?.ts,
      beforeLastInsideTs,
      "expected stale packet not to change lastInsidePoint"
    );
  } finally {
    clearMapState(mapId);
  }
});

runCase("ingestLocation should lock movement after impossible jump until return to last valid point", () => {
  const map_id = "edge-anticheat-lock";
  const user_id = "player-anticheat";
  const username = "name-player-anticheat";
  const base_ts = Date.now();
  try {
    ingestLocation(map_id, user_id, { lat: 0, lng: 0, ts: base_ts }, ops, username);

    const impossible_jump_events = ingestLocation(
      map_id,
      user_id,
      { lat: 0, lng: 0.06, ts: base_ts + 1000 },
      ops,
      username
    );
    assert.strictEqual(impossible_jump_events.length, 0, "expected impossible jump point to be denied");
    const after_jump = getMapSnapshot(map_id);
    assert.ok(after_jump, "expected snapshot after impossible jump");
    const after_jump_player = after_jump.players.find((p) => p.userId === user_id);
    assert.ok(after_jump_player, "expected player after impossible jump");
    assert.strictEqual(after_jump_player.anticheatLocked, true, "expected player to be anticheat locked");
    assert.strictEqual(
      after_jump_player.anticheatLockReason,
      "speed_violation",
      "expected speed violation lock reason"
    );
    assert.ok(after_jump_player.anticheatReturnTo, "expected return target for anticheat lock");
    assert.strictEqual(after_jump_player.lastPoint?.lng, 0, "expected denied jump not to update lastPoint");
    assert.strictEqual(
      after_jump_player.lastPoint?.ts,
      base_ts,
      "expected denied jump not to update lastPoint timestamp"
    );

    ingestLocation(map_id, user_id, { lat: 0, lng: 0.059, ts: base_ts + 2000 }, ops, username);
    const while_locked = getMapSnapshot(map_id);
    assert.ok(while_locked, "expected snapshot while locked");
    const while_locked_player = while_locked.players.find((p) => p.userId === user_id);
    assert.ok(while_locked_player, "expected player while locked");
    assert.strictEqual(while_locked_player.anticheatLocked, true, "expected lock to remain active");
    assert.strictEqual(while_locked_player.lastPoint?.lng, 0, "expected locked player to keep last valid point");
    assert.strictEqual(while_locked_player.lastPoint?.ts, base_ts, "expected lock to keep old timestamp");

    ingestLocation(map_id, user_id, { lat: 0, lng: 0, ts: base_ts + 3000 }, ops, username);
    ingestLocation(map_id, user_id, { lat: 0, lng: 0.00005, ts: base_ts + 4000 }, ops, username);
    const after_unlock = getMapSnapshot(map_id);
    assert.ok(after_unlock, "expected snapshot after unlock");
    const after_unlock_player = after_unlock.players.find((p) => p.userId === user_id);
    assert.ok(after_unlock_player, "expected player after unlock");
    assert.strictEqual(after_unlock_player.anticheatLocked, false, "expected lock to clear after return");
    assert.strictEqual(
      after_unlock_player.lastPoint?.ts,
      base_ts + 4000,
      "expected ingestion to resume after returning to last valid point"
    );
  } finally {
    clearMapState(map_id);
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
