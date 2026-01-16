// tests/realtime.capture.test.js
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

console.log("Running realtime capture test...");

try {
  const ops = createGeometryOps();
  const mapId = "capture-test";
  const userId = "player-1";
  let ts = 1;

  const send = (lat, lng) =>
    ingestLocation(mapId, userId, { lat, lng, ts: ts++ }, ops);

  send(0, 0);

  const snapshot1 = getMapSnapshot(mapId);
  assert.ok(snapshot1, "expected snapshot after initial point");

  const player1 = snapshot1.players.find((p) => p.userId === userId);
  assert.ok(player1, "expected player state");
  assert.ok(player1.territory, "expected initial territory");
  const initialArea = player1.territoryAreaSqMeters;

  const ring =
    player1.territory.geometry.type === "Polygon"
      ? player1.territory.geometry.coordinates[0]
      : player1.territory.geometry.coordinates[0][0];
  assert.ok(ring && ring.length >= 4, "expected territory ring coordinates");

  const lngs = ring.map((p) => p[0]).filter((v) => v !== undefined);
  const lats = ring.map((p) => p[1]).filter((v) => v !== undefined);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const dLng = (maxLng - minLng) / 2;
  const dLat = (maxLat - minLat) / 2;
  const centerLng = (minLng + maxLng) / 2;

  // Inside near bottom edge.
  send(minLat + dLat * 0.1, centerLng);
  // Outside south.
  send(minLat - dLat * 2, centerLng);
  // Outside east.
  send(minLat - dLat * 2, maxLng + dLng * 2);
  // Re-enter inside near top edge.
  const events = send(maxLat - dLat * 0.1, centerLng);

  const hasTerritoryEvent = events.some((event) => event.type === "territory");
  assert.ok(hasTerritoryEvent, "expected territory event on loop close");

  const snapshot2 = getMapSnapshot(mapId);
  assert.ok(snapshot2, "expected snapshot after capture");
  const player2 = snapshot2.players.find((p) => p.userId === userId);
  assert.ok(player2, "expected player state after capture");
  assert.strictEqual(player2.isOutside, false, "expected player to be inside after capture");
  assert.strictEqual(player2.path, null, "expected path to be cleared after capture");
  assert.ok(
    player2.territoryAreaSqMeters > initialArea,
    "expected territory area to increase after capture"
  );

  clearMapState(mapId);
  console.log("Realtime capture test passed.");
} catch (err) {
  console.error("Realtime capture test failed:");
  console.error(err);
  process.exit(1);
}
