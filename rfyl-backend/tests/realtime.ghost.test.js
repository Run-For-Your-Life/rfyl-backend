// tests/realtime.ghost.test.js
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
  respawnPlayer,
} = require("../src/services/realtimeEngine.ts");

console.log("Running realtime ghost state test...");

const METERS_PER_DEG_LAT = 111_320;

const makeSquareTerritory = (userId, center, sizeMeters) => {
  const half = sizeMeters / 2;
  const latRad = (center.lat * Math.PI) / 180;
  const dLat = half / METERS_PER_DEG_LAT;
  const dLng = half / (METERS_PER_DEG_LAT * Math.cos(latRad));
  const ring = [
    [center.lng - dLng, center.lat - dLat],
    [center.lng + dLng, center.lat - dLat],
    [center.lng + dLng, center.lat + dLat],
    [center.lng - dLng, center.lat + dLat],
    [center.lng - dLng, center.lat - dLat],
  ];
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [ring],
    },
    properties: {
      userId,
      updatedAt: Date.now(),
    },
  };
};

const largeTerritoryOps = {
  union: (territory) => makeSquareTerritory(territory.properties.userId, { lat: 0, lng: 0 }, 40),
  difference: (territory) => territory,
};

try {
  const mapId = "ghost-state-test";
  const userId = "player-ghost";
  let ts = 1;
  const send = (lat, lng) => ingestLocation(mapId, userId, { lat, lng, ts: ts++ }, largeTerritoryOps);

  send(0, 0);

  const snapshot1 = getMapSnapshot(mapId);
  assert.ok(snapshot1, "expected snapshot after initial point");
  const player1 = snapshot1.players.find((p) => p.userId === userId);
  assert.ok(player1, "expected player state after spawn");
  assert.strictEqual(player1.ghostState, "ghost_invulnerable");
  assert.strictEqual(player1.ghostEligible, false);
  assert.strictEqual(player1.isOutside, false);

  send(-0.005, 0);

  const snapshot2 = getMapSnapshot(mapId);
  const player2 = snapshot2.players.find((p) => p.userId === userId);
  assert.ok(player2, "expected player state after leaving territory");
  assert.strictEqual(player2.isOutside, true);
  assert.strictEqual(player2.ghostState, "ghost_vulnerable");
  assert.ok(player2.pathLengthMeters >= 400, "expected path length to exceed vulnerability threshold");

  send(0, 0);

  const snapshot3 = getMapSnapshot(mapId);
  const player3 = snapshot3.players.find((p) => p.userId === userId);
  assert.ok(player3, "expected player state after capture");
  assert.strictEqual(player3.isOutside, false);
  assert.strictEqual(player3.ghostEligible, true, "expected ghost eligibility after territory gain");
  assert.ok(player3.territoryAreaSqMeters >= 750, "expected territory area to exceed respawn threshold");

  const respawnEvents = respawnPlayer(mapId, userId);
  assert.ok(respawnEvents.some((event) => event.type === "state"), "expected respawn state event");

  const snapshot4 = getMapSnapshot(mapId);
  const player4 = snapshot4.players.find((p) => p.userId === userId);
  assert.ok(player4, "expected player state after respawn");
  assert.strictEqual(player4.ghostState, "player");
  assert.strictEqual(player4.ghostEligible, false);

  clearMapState(mapId);
  console.log("Realtime ghost state test passed.");
} catch (err) {
  console.error("Realtime ghost state test failed:");
  console.error(err);
  process.exit(1);
}
