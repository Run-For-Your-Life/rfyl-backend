// tests/realtime.knockout.test.js
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

console.log("Running realtime knockout test...");

const noopOps = {
  union: (territory) => territory,
  difference: (territory) => territory,
};

const runSelfCrossScenario = (mapId, scale, expectKnockout) => {
  const userId = "player-self-cross";
  let ts = 1;
  const send = (lat, lng) => ingestLocation(mapId, userId, { lat, lng, ts: ts++ }, noopOps);

  send(0, 0);
  send(-scale, 0);
  send(-3 * scale, 0);
  send(-2 * scale, -2 * scale);
  const events = send(-2 * scale, 2 * scale);

  const snapshot = getMapSnapshot(mapId);
  const player = snapshot.players.find((p) => p.userId === userId);
  assert.ok(player, "expected player state after self-cross attempt");

  if (expectKnockout) {
    assert.ok(events.some((event) => event.type === "knockout"), "expected knockout event");
    assert.strictEqual(player.isOutside, false);
    assert.strictEqual(player.path, null);
    assert.strictEqual(player.pathLengthMeters, 0);
  } else {
    assert.ok(!events.some((event) => event.type === "knockout"), "did not expect knockout event");
    assert.strictEqual(player.isOutside, true);
    assert.ok(player.path, "expected path to remain after invulnerable self-cross");
    assert.ok(player.pathLengthMeters < 400, "expected path length to stay below vulnerability threshold");
    assert.strictEqual(player.ghostState, "ghost_invulnerable");
  }

  clearMapState(mapId);
};

try {
  runSelfCrossScenario("self-cross-invulnerable", 0.0003, false);
  runSelfCrossScenario("self-cross-vulnerable", 0.001, true);

  console.log("Realtime knockout test passed.");
} catch (err) {
  console.error("Realtime knockout test failed:");
  console.error(err);
  process.exit(1);
}
