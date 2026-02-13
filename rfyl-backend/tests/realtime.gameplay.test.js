// tests/realtime.gameplay.test.js
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
const { createGeometryOps } = require("../src/services/realtimeOps.ts");
const booleanPointInPolygon = require("@turf/boolean-point-in-polygon").default;
const { point: turfPoint } = require("@turf/helpers");

const ops = createGeometryOps();

console.log("Running realtime gameplay tests...");

const createSender = (mapId, userId) => {
  let ts = 1;
  return (lat, lng) =>
    ingestLocation(mapId, userId, { lat, lng, ts: ts++ }, ops);
};

const getPlayer = (mapId, userId) => {
  const snapshot = getMapSnapshot(mapId);
  assert.ok(snapshot, "expected snapshot for map");
  const player = snapshot.players.find((p) => p.userId === userId);
  assert.ok(player, "expected player state");
  return player;
};

const getRing = (territory) =>
  territory.geometry.type === "Polygon"
    ? territory.geometry.coordinates[0]
    : territory.geometry.coordinates[0][0];

const getBounds = (territory) => {
  const ring = getRing(territory);
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

const captureLargeArea = (mapId, userId, bounds, send) => {
  send(bounds.minLat + bounds.dLat * 0.1, bounds.centerLng);
  send(bounds.minLat - 0.005, bounds.centerLng);
  send(bounds.minLat - 0.005, bounds.maxLng + 0.005);
  send(bounds.maxLat - bounds.dLat * 0.1, bounds.centerLng);
};

const makePlayer = (mapId, userId, send, seedLat = 0, seedLng = 0) => {
  send(seedLat, seedLng);
  const player = getPlayer(mapId, userId);
  const bounds = getBounds(player.territory);
  captureLargeArea(mapId, userId, bounds, send);
  const respawnEvents = respawnPlayer(mapId, userId);
  assert.ok(respawnEvents.length > 0, "expected respawn to succeed");
};

const makeGhostPath = (bounds, send, distanceDeg) => {
  send(bounds.minLat + bounds.dLat * 0.1, bounds.centerLng);
  send(bounds.minLat - distanceDeg, bounds.centerLng);
};

try {
  // Ghost becomes vulnerable after path length exceeds 400m.
  {
    const mapId = "ghost-vulnerable";
    const userId = "ghost-1";
    const send = createSender(mapId, userId);
    send(0, 0);
    const player = getPlayer(mapId, userId);
    const bounds = getBounds(player.territory);
    makeGhostPath(bounds, send, 0.004);
    const updated = getPlayer(mapId, userId);
    assert.strictEqual(updated.ghostState, "ghost_vulnerable");
    clearMapState(mapId);
  }

  // Respawn does nothing when ghost is not eligible.
  {
    const mapId = "ghost-respawn-ineligible";
    const userId = "ghost-0";
    const send = createSender(mapId, userId);
    send(0, 0);

    const before = getPlayer(mapId, userId);
    assert.strictEqual(before.ghostEligible, false);
    assert.strictEqual(before.ghostState, "ghost_invulnerable");

    const respawnEvents = respawnPlayer(mapId, userId);
    assert.strictEqual(respawnEvents.length, 0, "expected no respawn events");

    const after = getPlayer(mapId, userId);
    assert.strictEqual(after.ghostEligible, false);
    assert.strictEqual(after.ghostState, "ghost_invulnerable");
    clearMapState(mapId);
  }

  // Ghost becomes eligible after enough territory, respawn transitions to player.
  {
    const mapId = "ghost-respawn";
    const userId = "ghost-2";
    const send = createSender(mapId, userId);
    send(0, 0);
    const player = getPlayer(mapId, userId);
    const bounds = getBounds(player.territory);
    captureLargeArea(mapId, userId, bounds, send);
    const afterCapture = getPlayer(mapId, userId);
    assert.strictEqual(afterCapture.ghostEligible, true);
    const respawnEvents = respawnPlayer(mapId, userId);
    assert.ok(respawnEvents.length > 0, "expected respawn to succeed");
    const afterRespawn = getPlayer(mapId, userId);
    assert.strictEqual(afterRespawn.ghostState, "player");
    assert.strictEqual(afterRespawn.ghostEligible, false);
    clearMapState(mapId);
  }

  // Invulnerable ghosts still knock themselves out on self-cross.
  {
    const mapId = "self-cross-invulnerable-ghost";
    const userId = "ghost-self";
    const send = createSender(mapId, userId);
    send(0, 0);

    const a = 0.0004;
    const b = 0.0008;
    send(-a, 0);
    send(a, b);
    send(-a, b);
    const events = send(a, 0);

    const knocked = events.find(
      (event) => event.type === "knockout" && event.userId === userId
    );
    assert.ok(knocked, "expected self-cross to knock out invulnerable ghost");
    const after = getPlayer(mapId, userId);
    assert.strictEqual(after.isOutside, false, "expected ghost to be inside after knockout");
    assert.strictEqual(after.path, null, "expected path cleared after knockout");
    assert.strictEqual(after.ghostState, "ghost_invulnerable");
    clearMapState(mapId);
  }

  // Self-cross triggers knockout (player).
  {
    const mapId = "self-cross";
    const userId = "player-self";
    const send = createSender(mapId, userId);
    makePlayer(mapId, userId, send, 0, 0);
    const player = getPlayer(mapId, userId);
    const bounds = getBounds(player.territory);

    send(bounds.minLat + bounds.dLat * 0.1, bounds.centerLng);
    send(bounds.minLat - bounds.dLat * 4, bounds.centerLng - bounds.dLng * 2);
    send(bounds.minLat - bounds.dLat * 6, bounds.centerLng + bounds.dLng * 2);
    const events = send(bounds.minLat - bounds.dLat * 4, bounds.centerLng - bounds.dLng * 2);

    const knocked = events.find(
      (event) => event.type === "knockout" && event.userId === userId
    );
    assert.ok(knocked, "expected self-cross to knock out player");
    const after = getPlayer(mapId, userId);
    assert.strictEqual(after.isOutside, false, "expected player to be inside after knockout");
    assert.strictEqual(after.path, null, "expected path cleared after knockout");
    clearMapState(mapId);
  }

  // Player cannot knock an invulnerable ghost.
  {
    const mapId = "knock-invulnerable";
    const ghostId = "ghost-3";
    const playerId = "player-1";
    const sendGhost = createSender(mapId, ghostId);
    const sendPlayer = createSender(mapId, playerId);

    sendGhost(0, 0);
    const ghost = getPlayer(mapId, ghostId);
    const ghostBounds = getBounds(ghost.territory);
    makeGhostPath(ghostBounds, sendGhost, 0.001);
    const ghostAfter = getPlayer(mapId, ghostId);
    const ghostPath = ghostAfter.path?.geometry.coordinates;
    assert.ok(ghostPath && ghostPath.length >= 2, "expected ghost path for crossing");
    const [gStart, gEnd] = ghostPath;
    const [gStartLng, gStartLat] = gStart;
    const [gEndLng, gEndLat] = gEnd;

    makePlayer(mapId, playerId, sendPlayer, 0.02, 0.02);
    const player = getPlayer(mapId, playerId);
    const playerBounds = getBounds(player.territory);

    const start = sendPlayer(playerBounds.minLat + playerBounds.dLat * 0.1, playerBounds.centerLng);
    const mid = sendPlayer(gStartLat, gStartLng);
    const end = sendPlayer(gEndLat, gEndLng);
    const events = [...start, ...mid, ...end];

    const knockedGhost = events.find(
      (event) => event.type === "knockout" && event.userId === ghostId
    );
    assert.ok(!knockedGhost, "ghost should remain invulnerable to knockouts");
    clearMapState(mapId);
  }

  // Player can knock a vulnerable ghost.
  {
    const mapId = "knock-vulnerable";
    const ghostId = "ghost-4";
    const playerId = "player-2";
    const sendGhost = createSender(mapId, ghostId);
    const sendPlayer = createSender(mapId, playerId);

    sendGhost(0, 0);
    const ghost = getPlayer(mapId, ghostId);
    const ghostBounds = getBounds(ghost.territory);
    makeGhostPath(ghostBounds, sendGhost, 0.01);
    const ghostAfter = getPlayer(mapId, ghostId);
    const ghostPath = ghostAfter.path?.geometry.coordinates;
    assert.ok(ghostPath && ghostPath.length >= 2, "expected ghost path for crossing");
    const [gStart, gEnd] = ghostPath;
    const [gStartLng, gStartLat] = gStart;
    const [gEndLng, gEndLat] = gEnd;

    makePlayer(mapId, playerId, sendPlayer, 0.02, 0.02);
    const player = getPlayer(mapId, playerId);
    const playerBounds = getBounds(player.territory);

    const start = sendPlayer(playerBounds.minLat + playerBounds.dLat * 0.1, playerBounds.centerLng);
    const mid = sendPlayer(gStartLat, gStartLng);
    const end = sendPlayer(gEndLat, gEndLng);
    const events = [...start, ...mid, ...end];

    const knockedGhost = events.find(
      (event) => event.type === "knockout" && event.userId === ghostId
    );
    assert.ok(knockedGhost, "expected vulnerable ghost to be knocked");
    clearMapState(mapId);
  }

  // Boundary selection chooses smaller-area capture.
  {
    const mapId = "boundary-selection";
    const userId = "player-boundary";
    const send = createSender(mapId, userId);
    send(0, 0);
    const player = getPlayer(mapId, userId);
    const bounds = getBounds(player.territory);
    const initialArea = player.territoryAreaSqMeters;

    send(bounds.minLat + bounds.dLat * 0.1, bounds.centerLng);
    send(bounds.minLat - bounds.dLat * 4, bounds.centerLng + bounds.dLng * 0.5);
    send(bounds.minLat - bounds.dLat * 6, bounds.maxLng + bounds.dLng * 2);
    send(bounds.centerLat, bounds.maxLng - bounds.dLng * 0.1);

    const after = getPlayer(mapId, userId);
    const delta = after.territoryAreaSqMeters - initialArea;
    assert.ok(delta > 0, "expected capture to increase area");
    assert.ok(delta < initialArea, "expected smaller boundary segment to be chosen");
    clearMapState(mapId);
  }

  // Capturing territory subtracts from another player.
  {
    const mapId = "capture-subtract-player";
    const captorId = "player-4";
    const defenderId = "player-5";
    const sendCaptor = createSender(mapId, captorId);
    const sendDefender = createSender(mapId, defenderId);

    makePlayer(mapId, captorId, sendCaptor, 0, 0);
    const captor = getPlayer(mapId, captorId);
    const captorBounds = getBounds(captor.territory);
    const defenderSeedLat = captorBounds.centerLat + captorBounds.dLat * 2;
    const defenderSeedLng = captorBounds.centerLng + captorBounds.dLng * 2;
    makePlayer(mapId, defenderId, sendDefender, defenderSeedLat, defenderSeedLng);

    const defenderBefore = getPlayer(mapId, defenderId);
    const defenderAreaBefore = defenderBefore.territoryAreaSqMeters;
    const defenderBounds = getBounds(defenderBefore.territory);

    const marginLat = defenderBounds.dLat * 1.5;
    const marginLng = defenderBounds.dLng * 1.5;
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const reentryLat = captorBounds.centerLat;
    const reentryLng = captorBounds.centerLng;

    // Start inside, exit, loop around defender, re-enter at center to close.
    const events = [];
    events.push(...sendCaptor(captorBounds.centerLat, captorBounds.centerLng));
    events.push(...sendCaptor(defenderBounds.minLat - marginLat, defenderBounds.minLng - marginLng));
    events.push(...sendCaptor(defenderBounds.minLat - marginLat, defenderBounds.maxLng + marginLng));
    events.push(...sendCaptor(defenderBounds.maxLat + marginLat, defenderBounds.maxLng + marginLng));
    events.push(...sendCaptor(defenderBounds.maxLat + marginLat, defenderBounds.minLng - marginLng));
    events.push(...sendCaptor(reentryLat, reentryLng));

    const defenderAfter = getPlayer(mapId, defenderId);
    if (!(defenderAfter.territoryAreaSqMeters < defenderAreaBefore)) {
      const captorAfter = getPlayer(mapId, captorId);
      const defenderCenter = turfPoint([defenderBounds.centerLng, defenderBounds.centerLat]);
      const captorContains = booleanPointInPolygon(
        defenderCenter,
        captorAfter.territory
      );
      const territoryEvents = events.filter((event) => event.type === "territory");
      console.error("Defender area unchanged", {
        before: defenderAreaBefore,
        after: defenderAfter.territoryAreaSqMeters,
        captorBounds,
        defenderBounds,
        reentryLat,
        reentryLng,
        captorContainsDefender: captorContains,
        territoryEvents: territoryEvents.map((event) => event.userId),
      });
    }
    assert.ok(
      defenderAfter.territoryAreaSqMeters < defenderAreaBefore,
      "expected defender territory to decrease after capture"
    );
    clearMapState(mapId);
  }

  // MultiPolygon result when a capture splits a territory.
  {
    const mapId = "multipolygon-split";
    const captorId = "player-6";
    const defenderId = "player-7";
    const sendCaptor = createSender(mapId, captorId);
    const sendDefender = createSender(mapId, defenderId);

    makePlayer(mapId, defenderId, sendDefender, 0, 0);
    makePlayer(mapId, captorId, sendCaptor, 0.01, 0);

    const defender = getPlayer(mapId, defenderId);
    const bounds = getBounds(defender.territory);

    sendCaptor(bounds.centerLat, bounds.minLng - bounds.dLng * 6);
    sendCaptor(bounds.minLat - bounds.dLat * 6, bounds.centerLng);
    sendCaptor(bounds.maxLat + bounds.dLat * 6, bounds.centerLng);
    sendCaptor(bounds.centerLat, bounds.maxLng + bounds.dLng * 6);

    const defenderAfter = getPlayer(mapId, defenderId);
    assert.ok(defenderAfter.territory, "expected defender territory to remain");
    assert.strictEqual(
      defenderAfter.territory.geometry.type,
      "MultiPolygon",
      "expected defender territory to split into MultiPolygon"
    );
    clearMapState(mapId);
  }

  // Capturing territory subtracts from vulnerable ghosts.
  {
    const mapId = "capture-subtract";
    const captorId = "player-8";
    const ghostId = "ghost-5";
    const sendCaptor = createSender(mapId, captorId);
    const sendGhost = createSender(mapId, ghostId);

    sendGhost(0, 0);
    const ghost = getPlayer(mapId, ghostId);
    const ghostBounds = getBounds(ghost.territory);
    makeGhostPath(ghostBounds, sendGhost, 0.01);
    const ghostBefore = getPlayer(mapId, ghostId);
    const ghostAreaBefore = ghostBefore.territoryAreaSqMeters;

    makePlayer(mapId, captorId, sendCaptor, 0, 0);
    const captor = getPlayer(mapId, captorId);
    const captorBounds = getBounds(captor.territory);
    captureLargeArea(mapId, captorId, captorBounds, sendCaptor);

    const ghostAfter = getPlayer(mapId, ghostId);
    assert.ok(
      ghostAfter.territoryAreaSqMeters < ghostAreaBefore,
      "expected ghost territory to decrease after capture"
    );
    clearMapState(mapId);
  }

  console.log("Realtime gameplay tests passed.");
} catch (err) {
  console.error("Realtime gameplay tests failed:");
  console.error(err);
  process.exit(1);
}
