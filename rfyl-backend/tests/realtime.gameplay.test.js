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
  joinPlayer,
  respawnPlayer,
} = require("../src/services/realtimeEngine.ts");
const { createGeometryOps } = require("../src/services/realtimeOps.ts");
const booleanPointInPolygon = require("@turf/boolean-point-in-polygon").default;
const { point: turfPoint } = require("@turf/helpers");

const ops = createGeometryOps();

console.log("Running realtime gameplay tests...");

const expectedUsername = (userId) => `name-${userId}`;
const GRAPH_UNIT_DEG = 0.001;
const graphPoint = (x, y) => ({ lng: x * GRAPH_UNIT_DEG, lat: y * GRAPH_UNIT_DEG });
const isActiveAttackerState = (ghostState) => ghostState === "player" || ghostState === "runner";

const createSender = (mapId, userId) => {
  let ts = 1;
  const username = expectedUsername(userId);
  return (lat, lng) =>
    ingestLocation(mapId, userId, { lat, lng, ts: ts++ }, ops, username);
};

const getPlayer = (mapId, userId) => {
  const snapshot = getMapSnapshot(mapId);
  assert.ok(snapshot, "expected snapshot for map");
  const player = snapshot.players.find((p) => p.userId === userId);
  assert.ok(player, "expected player state");
  assert.strictEqual(player.username, expectedUsername(userId), "expected player username in snapshot");
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

const assertKnockoutResetState = (player) => {
  assert.strictEqual(player.territory, null, "expected territory removed after knockout");
  assert.strictEqual(player.path, null, "expected path cleared after knockout");
  assert.strictEqual(player.isOutside, false, "expected player to be inside after knockout");
  assert.strictEqual(player.pathLengthMeters, 0, "expected pathLengthMeters reset after knockout");
  assert.strictEqual(player.territoryAreaSqMeters, 0, "expected territoryAreaSqMeters reset after knockout");
  assert.strictEqual(player.ghostState, "ghost_invulnerable", "expected ghost_invulnerable after knockout");
  assert.strictEqual(player.ghostEligible, false, "expected ghostEligible reset after knockout");
};

const captureLargeArea = (mapId, userId, bounds, send) => {
  const player = getPlayer(mapId, userId);
  const insideAnchor = player.lastInsidePoint ?? {
    lat: bounds.minLat + bounds.dLat * 0.1,
    lng: bounds.centerLng,
  };
  send(insideAnchor.lat, insideAnchor.lng);
  send(bounds.minLat - 0.005, bounds.centerLng);
  send(bounds.minLat - 0.005, bounds.maxLng + 0.005);
  send(bounds.maxLat - bounds.dLat * 0.1, bounds.centerLng);
};

const makePlayer = (mapId, userId, send, seedLat = 0, seedLng = 0) => {
  send(seedLat, seedLng);
  const player = getPlayer(mapId, userId);
  const bounds = getBounds(player.territory);
  captureLargeArea(mapId, userId, bounds, send);
  const afterCapture = getPlayer(mapId, userId);
  assert.strictEqual(afterCapture.ghostState, "player", "expected capture to promote ghost to player");
  const respawnEvents = respawnPlayer(mapId, userId);
  assert.strictEqual(respawnEvents.length, 0, "expected respawn to no-op for active player");
};

const makeGhostPath = (mapId, userId, bounds, send, distanceDeg) => {
  const player = getPlayer(mapId, userId);
  const insideAnchor = player.lastInsidePoint ?? {
    lat: bounds.minLat + bounds.dLat * 0.1,
    lng: bounds.centerLng,
  };
  send(insideAnchor.lat, insideAnchor.lng);
  send(bounds.minLat - distanceDeg, bounds.centerLng);
};

const runCase = (name, fn) => {
  console.log(`[case] ${name}`);
  fn();
};

try {
  // TEST: Ghost Vulnerable Threshold
  // Description: Ghost becomes vulnerable and eligible after long enough outside path.
  runCase("Ghost becomes vulnerable after path length exceeds 400m", () => {
    const mapId = "ghost-vulnerable";
    const userId = "ghost-1";
    const send = createSender(mapId, userId);
    send(0, 0);
    const player = getPlayer(mapId, userId);
    const bounds = getBounds(player.territory);
    makeGhostPath(mapId, userId, bounds, send, 0.004);
    const updated = getPlayer(mapId, userId);
    assert.strictEqual(updated.ghostState, "ghost_vulnerable");
    assert.strictEqual(updated.ghostEligible, true, "expected vulnerable ghosts to be eligible");
    clearMapState(mapId);
  });
  // TEST END

  // TEST: Joined + Respawned Ghost Vulnerability
  // Description: Join/respawn flow still allows ghost to become vulnerable after long outside movement.
  runCase("Joined + respawned ghost becomes vulnerable after long outside path", () => {
    const mapId = "ghost-vulnerable-respawn-flow";
    const userId = "ghost-respawn-vuln";
    const username = expectedUsername(userId);
    const joinEvents = joinPlayer(mapId, userId, username);
    assert.ok(joinEvents.length > 0, "expected join to emit initial state");

    const t0 = Date.now();
    const respawnEvents = respawnPlayer(mapId, userId, { lat: 0, lng: 0, ts: t0 });
    assert.ok(respawnEvents.length > 0, "expected respawn to create territory");

    const seeded = getPlayer(mapId, userId);
    const bounds = getBounds(seeded.territory);
    ingestLocation(mapId, userId, { lat: bounds.centerLat, lng: bounds.centerLng, ts: t0 + 1 }, ops, username);
    ingestLocation(
      mapId,
      userId,
      { lat: bounds.minLat - 0.004, lng: bounds.centerLng, ts: t0 + 2 },
      ops,
      username
    );
    const updated = getPlayer(mapId, userId);
    assert.strictEqual(updated.ghostState, "ghost_vulnerable");
    assert.strictEqual(updated.ghostEligible, true);
    clearMapState(mapId);
  });
  // TEST END

  // TEST: Respawn Ineligible No-Op
  // Description: Respawn should do nothing for invulnerable, ineligible ghosts.
  runCase("Respawn does nothing when ghost is not eligible", () => {
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
  });
  // TEST END

  // TEST: Inside Loop No Capture
  // Description: A loop that never leaves territory must not start a capture event.
  runCase("Closed loop while inside should not start capture", () => {
    const mapId = "inside-loop-no-capture";
    const userId = "player-inside-loop";
    const send = createSender(mapId, userId);
    send(0, 0);

    const seeded = getPlayer(mapId, userId);
    const bounds = getBounds(seeded.territory);
    const loopPoints = [
      [bounds.centerLat + bounds.dLat * 0.1, bounds.centerLng],
      [bounds.centerLat, bounds.centerLng + bounds.dLng * 0.1],
      [bounds.centerLat - bounds.dLat * 0.1, bounds.centerLng],
      [bounds.centerLat, bounds.centerLng - bounds.dLng * 0.1],
      [bounds.centerLat + bounds.dLat * 0.1, bounds.centerLng],
    ];

    const events = loopPoints.flatMap(([lat, lng]) => send(lat, lng));
    assert.ok(!events.some((event) => event.type === "territory"), "did not expect territory event");

    const player = getPlayer(mapId, userId);
    assert.strictEqual(player.isOutside, false);
    assert.strictEqual(player.path, null);
    clearMapState(mapId);
  });
  // TEST END

  // TEST: Ghost Capture Promotion
  // Description: Successful capture transitions ghost to player, so respawn is no longer applicable.
  runCase("Ghost capture transitions to player (no additional respawn step)", () => {
    const mapId = "ghost-respawn";
    const userId = "ghost-2";
    const send = createSender(mapId, userId);
    send(0, 0);
    const player = getPlayer(mapId, userId);
    const bounds = getBounds(player.territory);
    captureLargeArea(mapId, userId, bounds, send);
    const afterCapture = getPlayer(mapId, userId);
    assert.strictEqual(afterCapture.ghostState, "player");
    assert.strictEqual(afterCapture.ghostEligible, false);
    const respawnEvents = respawnPlayer(mapId, userId);
    assert.strictEqual(respawnEvents.length, 0, "expected respawn to no-op once player is active");
    clearMapState(mapId);
  });
  // TEST END

  // TEST: Invulnerable Ghost Self-Cross Knockout
  // Description: Even invulnerable ghosts should knockout on their own path self-cross.
  runCase("Invulnerable ghosts self-knockout on self-cross", () => {
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
    const knockoutEvents = events.filter(
      (event) => event.type === "knockout" && event.userId === userId
    );
    assert.ok(knocked, "expected self-cross to knock out invulnerable ghost");
    assert.strictEqual(
      knockoutEvents.length,
      1,
      "expected exactly one knockout event for one self-cross update"
    );
    const after = getPlayer(mapId, userId);
    assertKnockoutResetState(after);
    const postKnockEvents = send(0, 0);
    assert.ok(
      !postKnockEvents.some((event) => event.type === "knockout" && event.userId === userId),
      "expected no duplicate knockout events on next update"
    );
    const afterMove = getPlayer(mapId, userId);
    assert.strictEqual(afterMove.territory, null, "expected no auto-respawn territory after ghost death");
    clearMapState(mapId);
  });
  // TEST END

  // TEST: Player Self-Cross Knockout
  // Description: A player crossing their own active path should be knocked out and reset.
  runCase("Player self-cross triggers knockout", () => {
    const mapId = "self-cross";
    const userId = "player-self";
    const send = createSender(mapId, userId);
    makePlayer(mapId, userId, send, 0, 0);
    const player = getPlayer(mapId, userId);
    const bounds = getBounds(player.territory);

    const selfInside = player.lastInsidePoint ?? { lat: bounds.centerLat, lng: bounds.centerLng };
    send(selfInside.lat, selfInside.lng);
    send(bounds.minLat - bounds.dLat * 4, bounds.centerLng - bounds.dLng * 4);
    send(bounds.minLat - bounds.dLat * 6, bounds.centerLng - bounds.dLng * 2);
    const events = send(bounds.minLat - bounds.dLat * 4, bounds.centerLng - bounds.dLng * 4);

    const knocked = events.find(
      (event) => event.type === "knockout" && event.userId === userId
    );
    const knockoutEvents = events.filter(
      (event) => event.type === "knockout" && event.userId === userId
    );
    assert.ok(knocked, "expected self-cross to knock out player");
    assert.strictEqual(
      knockoutEvents.length,
      1,
      "expected exactly one knockout event for one self-cross update"
    );
    assert.strictEqual(knocked.username, expectedUsername(userId), "expected knocked username");
    assert.strictEqual(knocked.byUsername, expectedUsername(userId), "expected self knockout byUsername");
    const after = getPlayer(mapId, userId);
    assertKnockoutResetState(after);
    const postKnockEvents = send(bounds.centerLat, bounds.centerLng);
    assert.ok(
      !postKnockEvents.some((event) => event.type === "knockout" && event.userId === userId),
      "expected no duplicate knockout events on next update"
    );
    const afterMove = getPlayer(mapId, userId);
    assert.strictEqual(afterMove.territory, null, "expected no auto-respawn territory on next location");
    clearMapState(mapId);
  });
  // TEST END

  // TEST: Idle Forgiveness
  // Description: Tiny jitter while outside should not create path segments or trigger knockout.
  runCase("Idle jitter outside is ignored (no segment, no knockout)", () => {
    const mapId = "idle-forgiveness";
    const userId = "player-idle";
    const send = createSender(mapId, userId);
    makePlayer(mapId, userId, send, 0, 0);
    const player = getPlayer(mapId, userId);
    const bounds = getBounds(player.territory);

    const outsideLat = bounds.minLat - 0.02;
    const outsideLng = bounds.centerLng;

    const idleInside = player.lastInsidePoint ?? { lat: bounds.centerLat, lng: bounds.centerLng };
    send(idleInside.lat, idleInside.lng);
    send(outsideLat, outsideLng);
    const beforeIdle = getPlayer(mapId, userId);
    assert.ok(beforeIdle.path, "expected active path while outside");
    const beforeIdlePathLength = beforeIdle.path.geometry.coordinates.length;
    const idleEvents = send(outsideLat + 1e-9, outsideLng + 1e-9);

    assert.ok(
      !idleEvents.some((event) => event.type === "knockout"),
      "expected no knockout from idle jitter"
    );
    const afterIdle = getPlayer(mapId, userId);
    assert.ok(afterIdle.path, "expected active path while outside");
    assert.strictEqual(
      afterIdle.path.geometry.coordinates.length,
      beforeIdlePathLength,
      "expected jitter point to be ignored for idle forgiveness"
    );
    clearMapState(mapId);
  });
  // TEST END

  // TEST: Player vs Invulnerable Ghost
  // Description: Player path-cross must not knockout an invulnerable ghost.
  runCase("Player cannot knock an invulnerable ghost", () => {
    const mapId = "knock-invulnerable";
    const ghostId = "ghost-3";
    const playerId = "player-1";
    const sendGhost = createSender(mapId, ghostId);
    const sendPlayer = createSender(mapId, playerId);

    sendGhost(0, 0);
    const ghost = getPlayer(mapId, ghostId);
    const ghostBounds = getBounds(ghost.territory);
    makeGhostPath(mapId, ghostId, ghostBounds, sendGhost, 0.001);
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
  });
  // TEST END

  // TEST: Player vs Vulnerable Ghost
  // Description: Player path-cross should knockout a vulnerable ghost and reset victim state.
  runCase("Player can knock a vulnerable ghost", () => {
    const mapId = "knock-vulnerable";
    const ghostId = "ghost-4";
    const playerId = "player-2";
    const sendGhost = createSender(mapId, ghostId);
    const sendPlayer = createSender(mapId, playerId);

    sendGhost(0, 0);
    const ghost = getPlayer(mapId, ghostId);
    const ghostBounds = getBounds(ghost.territory);
    makeGhostPath(mapId, ghostId, ghostBounds, sendGhost, 0.01);
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
    const knockoutEvents = events.filter(
      (event) => event.type === "knockout" && event.userId === ghostId
    );
    assert.ok(knockedGhost, "expected vulnerable ghost to be knocked");
    assert.strictEqual(
      knockoutEvents.length,
      1,
      "expected exactly one knockout event when crossing vulnerable ghost path"
    );
    assert.strictEqual(knockedGhost.username, expectedUsername(ghostId), "expected knocked ghost username");
    assert.strictEqual(knockedGhost.byUsername, expectedUsername(playerId), "expected attacker username");
    const ghostAfterKnock = getPlayer(mapId, ghostId);
    assertKnockoutResetState(ghostAfterKnock);
    clearMapState(mapId);
  });
  // TEST END

  // TEST: Single Interior Intersection Knockout
  // Game Story: Player A has an active outside trail segment from point A to point B. 
  // Player B draws one movement segment that crosses that line once in the middle.
  // TEST SETUP: Make A outside with a visible path segment. Make B an active player (not ghost), then send B through the segment
  // EXPECTED: A is knocked out immediately on that update. B does not need to fully pass through the whole line shape. One valid intersection is enough 
  runCase("Single interior intersection knocks out vulnerable victim immediately", () => {
    const mapId = "knock-single-intersection";
    const ghostId = "ghost-single-intersection";
    const playerId = "player-single-intersection";
    const sendGhost = createSender(mapId, ghostId);
    const sendPlayer = createSender(mapId, playerId);

    // Spawn victim and build a long enough outside trail to enter vulnerable state.
    // Graph view (1 grid unit = 0.001 degrees): victim goes (0, 0) -> (0, -5).
    const victimSpawn = graphPoint(0, 0);
    const victimOutside = graphPoint(0, -5);
    sendGhost(victimSpawn.lat, victimSpawn.lng);
    sendGhost(victimOutside.lat, victimOutside.lng);
    const ghostBeforeCross = getPlayer(mapId, ghostId);
    assert.strictEqual(ghostBeforeCross.ghostState, "ghost_vulnerable", "expected vulnerable victim path");
    const ghostPath = ghostBeforeCross.path?.geometry.coordinates;
    assert.ok(ghostPath && ghostPath.length >= 2, "expected victim path for crossing");
    const [gStart, gEnd] = ghostPath;
    const [gStartLng, gStartLat] = gStart;
    const [gEndLng, gEndLat] = gEnd;
    assert.ok(
      Math.abs(gStartLng) < 1e-9 && Math.abs(gEndLng) < 1e-9,
      "expected victim segment to stay on x=0 for readable graph geometry"
    );

    // Choose an interior crossing point on victim line: (0, -1), not either endpoint.
    const interiorCross = graphPoint(0, -1);
    assert.ok(
      Math.abs(interiorCross.lng - gStartLng) > 1e-12 || Math.abs(interiorCross.lat - gStartLat) > 1e-12,
      "expected crossing point to differ from victim start endpoint"
    );
    assert.ok(
      Math.abs(interiorCross.lng - gEndLng) > 1e-12 || Math.abs(interiorCross.lat - gEndLat) > 1e-12,
      "expected crossing point to differ from victim end endpoint"
    );

    // Promotes attacker to full player state; ghosts are not allowed to knock others.
    const attackerSpawn = graphPoint(20, 20);
    makePlayer(mapId, playerId, sendPlayer, attackerSpawn.lat, attackerSpawn.lng);
    const attacker = getPlayer(mapId, playerId);
    const attackerBounds = getBounds(attacker.territory);

    // First move starts attacker outside path; second move is the crossing segment.
    // Graph path: center -> (-3, 2) (no hit), then (-3, 2) -> (3, -4) (single hit).
    const attackerApproach = graphPoint(-3, 2);
    const attackerCross = graphPoint(3, -4);
    sendPlayer(attackerBounds.centerLat, attackerBounds.centerLng);
    const approachEvents = sendPlayer(attackerApproach.lat, attackerApproach.lng);
    assert.ok(
      !approachEvents.some((event) => event.type === "knockout" && event.userId === ghostId),
      "did not expect knockout before crossing segment"
    );
    // This move performs the first true intersection and should knock immediately.
    const crossingEvents = sendPlayer(attackerCross.lat, attackerCross.lng);

    const knockedGhost = crossingEvents.find(
      (event) => event.type === "knockout" && event.userId === ghostId
    );
    const knockoutEvents = crossingEvents.filter(
      (event) => event.type === "knockout" && event.userId === ghostId
    );
    assert.ok(knockedGhost, "expected immediate knockout on first interior intersection");
    assert.strictEqual(
      knockoutEvents.length,
      1,
      "expected exactly one victim knockout event from single crossing segment"
    );
    // Reason/attacker identity checks make sure this is true path-cross attribution.
    assert.strictEqual(knockedGhost.reason, "path-cross", "expected path-cross knockout reason");
    assert.strictEqual(knockedGhost.byUserId, playerId, "expected attacker id on knockout event");
    assert.strictEqual(knockedGhost.byUsername, expectedUsername(playerId), "expected attacker username");
    const ghostAfterKnock = getPlayer(mapId, ghostId);
    assertKnockoutResetState(ghostAfterKnock);
    clearMapState(mapId);
  });

  // VERIFIES:
  // 1. Victim ghost is vulnerable and has an active outside path
  // 2. Attacker player crosses that victim segment at an interior midpoint
  // 3. Immediate path-cross knockout on that single intersection segment
  // 4. Victim state resets correctly after knockout
  // TEST END

  // TEST: Endpoint Touch Knockout
  // Game Story: Player B does not cut through Player A's line interior;
  // B only touches exactly one endpoint of A's active outside segment.
  // TEST SETUP: Make A vulnerable with one outside segment, then move B so its segment ends on A's endpoint.
  // EXPECTED: Endpoint touch counts as an intersection and knocks A out immediately.
  runCase("Endpoint touch on vulnerable path counts as knockout", () => {
    const mapId = "knock-endpoint-touch";
    const ghostId = "ghost-endpoint-touch";
    const playerId = "player-endpoint-touch";
    const sendGhost = createSender(mapId, ghostId);
    const sendPlayer = createSender(mapId, playerId);

    // Victim setup on graph: (0, 0) -> (0, -5) to create a vulnerable vertical path.
    const victimSpawn = graphPoint(0, 0);
    const victimOutside = graphPoint(0, -5);
    sendGhost(victimSpawn.lat, victimSpawn.lng);
    sendGhost(victimOutside.lat, victimOutside.lng);

    const ghostBeforeTouch = getPlayer(mapId, ghostId);
    assert.strictEqual(ghostBeforeTouch.ghostState, "ghost_vulnerable", "expected vulnerable victim path");
    const ghostPath = ghostBeforeTouch.path?.geometry.coordinates;
    assert.ok(ghostPath && ghostPath.length >= 2, "expected victim path for endpoint touch");
    const [gStart, gEnd] = ghostPath;
    const [gStartLng, gStartLat] = gStart;
    const [gEndLng, gEndLat] = gEnd;

    // Choose the endpoint that corresponds to the outside tip near (0, -5).
    const outsideTip =
      Math.abs(gStartLat - victimOutside.lat) <= Math.abs(gEndLat - victimOutside.lat)
        ? { lng: gStartLng, lat: gStartLat }
        : { lng: gEndLng, lat: gEndLat };

    // Attacker setup: full player state is required to knock other players.
    const attackerSpawn = graphPoint(20, 20);
    makePlayer(mapId, playerId, sendPlayer, attackerSpawn.lat, attackerSpawn.lng);
    const attacker = getPlayer(mapId, playerId);
    const attackerBounds = getBounds(attacker.territory);

    // Graph path:
    // center -> (2, -5): approach near endpoint without intersecting victim segment.
    // (2, -5) -> outsideTip: touches exactly at victim endpoint.
    const attackerApproach = graphPoint(2, -5);
    sendPlayer(attackerBounds.centerLat, attackerBounds.centerLng);
    const approachEvents = sendPlayer(attackerApproach.lat, attackerApproach.lng);
    assert.ok(
      !approachEvents.some((event) => event.type === "knockout" && event.userId === ghostId),
      "did not expect knockout before endpoint touch"
    );

    const touchEvents = sendPlayer(outsideTip.lat, outsideTip.lng);
    const knockedGhost = touchEvents.find(
      (event) => event.type === "knockout" && event.userId === ghostId
    );
    const knockoutEvents = touchEvents.filter(
      (event) => event.type === "knockout" && event.userId === ghostId
    );
    assert.ok(knockedGhost, "expected endpoint touch to trigger knockout");
    assert.strictEqual(
      knockoutEvents.length,
      1,
      "expected exactly one victim knockout event from endpoint touch"
    );
    assert.strictEqual(knockedGhost.reason, "path-cross", "expected path-cross knockout reason");
    assert.strictEqual(knockedGhost.byUserId, playerId, "expected attacker id on knockout event");
    assert.strictEqual(knockedGhost.byUsername, expectedUsername(playerId), "expected attacker username");
    const ghostAfterKnock = getPlayer(mapId, ghostId);
    assertKnockoutResetState(ghostAfterKnock);
    clearMapState(mapId);
  });

  // VERIFIES:
  // 1. Victim has a vulnerable active path
  // 2. Attacker first approaches without intersecting
  // 3. Touching only the victim endpoint still triggers knockout
  // 4. Victim state resets after endpoint-touch knockout
  // TEST END

  // TEST: AFK Player Cannot Punish Active Mover
  // Game Story: Player A goes AFK while holding an outside path.
  // Player B is the only one moving. B may cross A's line, but B should never be knocked by A.
  // TEST SETUP: A creates an outside path and then sends no more updates. B then approaches and crosses A's path.
  // EXPECTED: Any knockout attribution must be B -> A (if crossing happens), never A -> B.
  runCase("AFK player cannot punish moving player", () => {
    const mapId = "afk-cannot-punish";
    const afkId = "player-afk";
    const moverId = "player-mover";
    const sendAfk = createSender(mapId, afkId);
    const sendMover = createSender(mapId, moverId);

    // AFK setup: make A a full player, then leave territory once and stop sending updates.
    const afkSpawn = graphPoint(0, 0);
    makePlayer(mapId, afkId, sendAfk, afkSpawn.lat, afkSpawn.lng);
    const afk = getPlayer(mapId, afkId);
    const afkBounds = getBounds(afk.territory);
    const afkOutside = graphPoint(0, -8);
    sendAfk(afkBounds.centerLat, afkBounds.centerLng);
    sendAfk(afkOutside.lat, afkOutside.lng);
    const afkBeforeCross = getPlayer(mapId, afkId);
    assert.ok(
      isActiveAttackerState(afkBeforeCross.ghostState),
      "expected AFK player to remain in an active attacker state"
    );
    assert.ok(afkBeforeCross.isOutside, "expected AFK player to hold an active outside path");

    // Mover setup: full player state so B can perform valid path-cross knockouts.
    const moverSpawn = graphPoint(20, 20);
    makePlayer(mapId, moverId, sendMover, moverSpawn.lat, moverSpawn.lng);
    const mover = getPlayer(mapId, moverId);
    const moverBounds = getBounds(mover.territory);

    // Graph path:
    // center -> (2, -6): approach, no intersection with A's x=0 line.
    // (2, -6) -> (-2, -6): single crossing through A's path.
    const moverApproach = graphPoint(2, -6);
    const moverCross = graphPoint(-2, -6);
    sendMover(moverBounds.centerLat, moverBounds.centerLng);
    const approachEvents = sendMover(moverApproach.lat, moverApproach.lng);
    const crossingEvents = sendMover(moverCross.lat, moverCross.lng);
    const events = [...approachEvents, ...crossingEvents];

    // Core AFK safety assertion: B must never die "by" AFK A.
    const punishedMoverByAfk = events.find(
      (event) =>
        event.type === "knockout" &&
        event.userId === moverId &&
        event.byUserId === afkId
    );
    assert.ok(!punishedMoverByAfk, "expected no knockout where AFK player punishes moving player");

    // If a path-cross knockout happened, attribution should be mover -> AFK victim.
    const knockedAfk = events.find(
      (event) =>
        event.type === "knockout" &&
        event.userId === afkId &&
        event.byUserId === moverId
    );
    assert.ok(knockedAfk, "expected mover to knock AFK path owner when crossing their line");

    const moverAfter = getPlayer(mapId, moverId);
    assert.ok(moverAfter.territory, "expected moving player to remain alive after crossing AFK line");
    clearMapState(mapId);
  });

  // VERIFIES:
  // 1. AFK player keeps an active outside path without sending further updates
  // 2. Moving player crosses AFK path
  // 3. No knockout is ever attributed as AFK -> moving player
  // 4. Crossing attribution, if present, is moving player -> AFK player
  // TEST END

  // TEST: Colinear Overlap Knockout
  // Game Story: Player B does not just touch or cross Player A's line once.
  // B runs along the same line segment as A for part of the move.
  // TEST SETUP: A has a vulnerable vertical path on x=0. B exits near that line, then moves from one interior point on x=0
  // to another interior point on x=0, creating an overlapping segment instead of a single-point cross.
  // EXPECTED: The overlap still counts as an intersection and knocks A out immediately.
  runCase("Colinear overlap on vulnerable path counts as knockout", () => {
    const mapId = "knock-colinear-overlap";
    const ghostId = "ghost-colinear-overlap";
    const playerId = "player-colinear-overlap";
    const sendGhost = createSender(mapId, ghostId);
    const sendPlayer = createSender(mapId, playerId);

    // Victim setup on graph: (0, 0) -> (0, -5) to create a vulnerable vertical path.
    const victimSpawn = graphPoint(0, 0);
    const victimOutside = graphPoint(0, -5);
    sendGhost(victimSpawn.lat, victimSpawn.lng);
    sendGhost(victimOutside.lat, victimOutside.lng);

    const ghostBeforeOverlap = getPlayer(mapId, ghostId);
    assert.strictEqual(ghostBeforeOverlap.ghostState, "ghost_vulnerable", "expected vulnerable victim path");
    const ghostPath = ghostBeforeOverlap.path?.geometry.coordinates;
    assert.ok(ghostPath && ghostPath.length >= 2, "expected victim path for overlap");
    const [gStart, gEnd] = ghostPath;
    const [gStartLng, gStartLat] = gStart;
    const [gEndLng, gEndLat] = gEnd;

    // Use two interior points on the same x=0 victim line so the second attacker segment overlaps, not merely crosses.
    const overlapStart = graphPoint(0, -1);
    const overlapEnd = graphPoint(0, -4);
    assert.ok(
      Math.abs(overlapStart.lng - gStartLng) > 1e-12 || Math.abs(overlapStart.lat - gStartLat) > 1e-12,
      "expected overlap start to differ from victim start endpoint"
    );
    assert.ok(
      Math.abs(overlapEnd.lng - gEndLng) > 1e-12 || Math.abs(overlapEnd.lat - gEndLat) > 1e-12,
      "expected overlap end to differ from victim end endpoint"
    );

    // Attacker setup: full player state is required to knock other players.
    const attackerSpawn = graphPoint(2, 20);
    makePlayer(mapId, playerId, sendPlayer, attackerSpawn.lat, attackerSpawn.lng);
    const attacker = getPlayer(mapId, playerId);
    const attackerBounds = getBounds(attacker.territory);

    // Graph path:
    // center -> (0, -1): first exit move, ends on victim line but should not knock yet.
    // (0, -1) -> (0, -4): vertical segment that overlaps victim path.
    sendPlayer(attackerBounds.centerLat, attackerBounds.centerLng);
    const approachEvents = sendPlayer(overlapStart.lat, overlapStart.lng);
    assert.ok(
      !approachEvents.some((event) => event.type === "knockout" && event.userId === ghostId),
      "did not expect knockout before overlap segment"
    );

    const overlapEvents = sendPlayer(overlapEnd.lat, overlapEnd.lng);
    const knockedGhost = overlapEvents.find(
      (event) => event.type === "knockout" && event.userId === ghostId
    );
    const knockoutEvents = overlapEvents.filter(
      (event) => event.type === "knockout" && event.userId === ghostId
    );
    assert.ok(knockedGhost, "expected colinear overlap to trigger knockout");
    assert.strictEqual(
      knockoutEvents.length,
      1,
      "expected exactly one victim knockout event from overlapping segment"
    );
    assert.strictEqual(knockedGhost.reason, "path-cross", "expected path-cross knockout reason");
    assert.strictEqual(knockedGhost.byUserId, playerId, "expected attacker id on knockout event");
    assert.strictEqual(knockedGhost.byUsername, expectedUsername(playerId), "expected attacker username");
    const ghostAfterKnock = getPlayer(mapId, ghostId);
    assertKnockoutResetState(ghostAfterKnock);
    const attackerAfter = getPlayer(mapId, playerId);
    assert.ok(attackerAfter.territory, "expected attacker to remain alive after overlap knockout");
    clearMapState(mapId);
  });

  // VERIFIES:
  // 1. Victim has a vulnerable active path
  // 2. Attacker first exits without getting a knockout
  // 3. An overlapping segment on the same line still counts as intersection
  // 4. Victim state resets after overlap knockout
  // TEST END

  // TEST: Near-Miss Does Not Knockout
  // Game Story: Player B gets very close to Player A's active path, but never actually touches it.
  // TEST SETUP: A has a vulnerable vertical path on x=0. B exits nearby and then runs parallel to that path on x=1.
  // EXPECTED: No knockout happens because "almost touching" should not count as an intersection.
  runCase("Near-miss next to vulnerable path does not count as knockout", () => {
    const mapId = "knock-near-miss";
    const ghostId = "ghost-near-miss";
    const playerId = "player-near-miss";
    const sendGhost = createSender(mapId, ghostId);
    const sendPlayer = createSender(mapId, playerId);

    // Victim setup on graph: (0, 0) -> (0, -5) to create a vulnerable vertical path.
    const victimSpawn = graphPoint(0, 0);
    const victimOutside = graphPoint(0, -5);
    sendGhost(victimSpawn.lat, victimSpawn.lng);
    sendGhost(victimOutside.lat, victimOutside.lng);

    const ghostBeforeMiss = getPlayer(mapId, ghostId);
    assert.strictEqual(ghostBeforeMiss.ghostState, "ghost_vulnerable", "expected vulnerable victim path");
    assert.ok(ghostBeforeMiss.path, "expected victim path before near-miss");

    // Attacker setup: full player state so B is allowed to knock if an actual intersection happens.
    const attackerSpawn = graphPoint(20, 20);
    makePlayer(mapId, playerId, sendPlayer, attackerSpawn.lat, attackerSpawn.lng);
    const attacker = getPlayer(mapId, playerId);
    const attackerBounds = getBounds(attacker.territory);

    // Graph path:
    // center -> (1, -1): exits near victim line without touching x=0.
    // (1, -1) -> (1, -4): runs parallel one grid unit away from victim path.
    const nearMissStart = graphPoint(1, -1);
    const nearMissEnd = graphPoint(1, -4);
    sendPlayer(attackerBounds.centerLat, attackerBounds.centerLng);
    const approachEvents = sendPlayer(nearMissStart.lat, nearMissStart.lng);
    const nearMissEvents = sendPlayer(nearMissEnd.lat, nearMissEnd.lng);
    const events = [...approachEvents, ...nearMissEvents];

    const anyKnockout = events.find((event) => event.type === "knockout");
    assert.ok(!anyKnockout, "did not expect knockout from a near-miss segment");

    const ghostAfterMiss = getPlayer(mapId, ghostId);
    assert.ok(ghostAfterMiss.territory, "expected victim to remain alive after near miss");
    assert.ok(ghostAfterMiss.path, "expected victim path to remain active after near miss");

    const attackerAfterMiss = getPlayer(mapId, playerId);
    assert.ok(attackerAfterMiss.territory, "expected attacker to remain alive after near miss");
    clearMapState(mapId);
  });

  // VERIFIES:
  // 1. Victim has a vulnerable active path
  // 2. Attacker moves close to that path without touching it
  // 3. No knockout fires for either player
  // 4. Both players remain alive after the near miss
  // TEST END

  // TEST: Self-Cross Takes Priority Over Path-Cross
  // Game Story: Player B makes one move that would both cross their own path and cross Player A's vulnerable path.
  // TEST SETUP: A holds a vulnerable path on x=0. B builds a shape where the last segment self-intersects at x=2
  // and also crosses A's line at x=0 during the same update.
  // EXPECTED: B should self-knock first, and A should not be knocked on that update.
  runCase("Self-cross is processed before path-cross on the same update", () => {
    const mapId = "self-cross-priority";
    const ghostId = "ghost-priority";
    const playerId = "player-priority";
    const sendGhost = createSender(mapId, ghostId);
    const sendPlayer = createSender(mapId, playerId);

    // Victim setup on graph: (0, 0) -> (0, -5) to create a vulnerable vertical path.
    const victimSpawn = graphPoint(0, 0);
    const victimOutside = graphPoint(0, -5);
    sendGhost(victimSpawn.lat, victimSpawn.lng);
    sendGhost(victimOutside.lat, victimOutside.lng);

    const ghostBeforePriority = getPlayer(mapId, ghostId);
    assert.strictEqual(ghostBeforePriority.ghostState, "ghost_vulnerable", "expected vulnerable victim path");
    assert.ok(ghostBeforePriority.path, "expected victim path before priority test");

    // Attacker setup: full player state is required for path-cross checks to even be considered.
    const attackerSpawn = graphPoint(6, 2);
    makePlayer(mapId, playerId, sendPlayer, attackerSpawn.lat, attackerSpawn.lng);
    const attacker = getPlayer(mapId, playerId);
    const attackerBounds = getBounds(attacker.territory);

    // Graph path:
    // center -> (2, 2): safe exit
    // (2, 2) -> (2, -7): earlier vertical segment at x=2
    // (2, -7) -> (-3, -7): safe horizontal segment below A's path
    // (-3, -7) -> (3, -2): final segment crosses A at x=0 and self-crosses earlier x=2 segment
    const step1 = graphPoint(2, 2);
    const step2 = graphPoint(2, -7);
    const step3 = graphPoint(-3, -7);
    const finalStep = graphPoint(3, -2);
    sendPlayer(attackerBounds.centerLat, attackerBounds.centerLng);
    sendPlayer(step1.lat, step1.lng);
    sendPlayer(step2.lat, step2.lng);
    sendPlayer(step3.lat, step3.lng);
    const finalEvents = sendPlayer(finalStep.lat, finalStep.lng);

    const selfKnock = finalEvents.find(
      (event) => event.type === "knockout" && event.userId === playerId
    );
    const victimKnock = finalEvents.find(
      (event) => event.type === "knockout" && event.userId === ghostId
    );
    assert.ok(selfKnock, "expected attacker to self-knock on the final segment");
    assert.strictEqual(selfKnock.reason, "self-cross", "expected self-cross to win precedence");
    assert.strictEqual(selfKnock.byUserId, playerId, "expected attacker to be their own knockout source");
    assert.ok(!victimKnock, "did not expect victim knockout when attacker self-crosses first");

    const ghostAfterPriority = getPlayer(mapId, ghostId);
    assert.ok(ghostAfterPriority.territory, "expected victim to remain alive after attacker self-cross");
    assert.ok(ghostAfterPriority.path, "expected victim path to remain active after attacker self-cross");

    const attackerAfterPriority = getPlayer(mapId, playerId);
    assertKnockoutResetState(attackerAfterPriority);
    clearMapState(mapId);
  });

  // VERIFIES:
  // 1. A single update can geometrically satisfy both self-cross and path-cross conditions
  // 2. Self-cross knockout is emitted for the moving player
  // 3. Victim does not receive a knockout on that same update
  // 4. Victim remains active while attacker is reset
  // TEST END

  // TEST: One Segment Can Knock Multiple Victims
  // Game Story: Player B makes one move that crosses two different vulnerable player paths.
  // TEST SETUP: Two victims hold separate active vertical paths on x=0 and x=2. B moves horizontally through both.
  // EXPECTED: Both victims are knocked on the same update, and each receives exactly one knockout event.
  runCase("One crossing segment can knock multiple vulnerable players", () => {
    const mapId = "multi-victim-path-cross";
    const ghostAId = "ghost-multi-a";
    const ghostBId = "ghost-multi-b";
    const playerId = "player-multi";
    const sendGhostA = createSender(mapId, ghostAId);
    const sendGhostB = createSender(mapId, ghostBId);
    const sendPlayer = createSender(mapId, playerId);

    // Victim A setup on graph: (0, 0) -> (0, -5).
    const victimASpawn = graphPoint(0, 0);
    const victimAOutside = graphPoint(0, -5);
    sendGhostA(victimASpawn.lat, victimASpawn.lng);
    sendGhostA(victimAOutside.lat, victimAOutside.lng);

    // Victim B setup on graph: (2, 0) -> (2, -5).
    const victimBSpawn = graphPoint(2, 0);
    const victimBOutside = graphPoint(2, -5);
    sendGhostB(victimBSpawn.lat, victimBSpawn.lng);
    sendGhostB(victimBOutside.lat, victimBOutside.lng);

    const ghostABefore = getPlayer(mapId, ghostAId);
    const ghostBBefore = getPlayer(mapId, ghostBId);
    assert.strictEqual(ghostABefore.ghostState, "ghost_vulnerable", "expected victim A to be vulnerable");
    assert.strictEqual(ghostBBefore.ghostState, "ghost_vulnerable", "expected victim B to be vulnerable");

    // Attacker setup: full player state so B can legally trigger path-cross knockouts.
    const attackerSpawn = graphPoint(20, 20);
    makePlayer(mapId, playerId, sendPlayer, attackerSpawn.lat, attackerSpawn.lng);
    const attacker = getPlayer(mapId, playerId);
    const attackerBounds = getBounds(attacker.territory);

    // Graph path:
    // center -> (-2, -2): approach left of both victim lines.
    // (-2, -2) -> (4, -2): one horizontal segment crossing x=0 and x=2 in the same update.
    const attackerApproach = graphPoint(-2, -2);
    const attackerCross = graphPoint(4, -2);
    sendPlayer(attackerBounds.centerLat, attackerBounds.centerLng);
    const approachEvents = sendPlayer(attackerApproach.lat, attackerApproach.lng);
    assert.ok(
      !approachEvents.some((event) => event.type === "knockout"),
      "did not expect knockout before multi-victim crossing segment"
    );

    const crossingEvents = sendPlayer(attackerCross.lat, attackerCross.lng);
    const ghostAKnockouts = crossingEvents.filter(
      (event) => event.type === "knockout" && event.userId === ghostAId
    );
    const ghostBKnockouts = crossingEvents.filter(
      (event) => event.type === "knockout" && event.userId === ghostBId
    );
    assert.strictEqual(ghostAKnockouts.length, 1, "expected exactly one knockout event for victim A");
    assert.strictEqual(ghostBKnockouts.length, 1, "expected exactly one knockout event for victim B");
    assert.strictEqual(ghostAKnockouts[0]?.byUserId, playerId, "expected attacker id for victim A knockout");
    assert.strictEqual(ghostBKnockouts[0]?.byUserId, playerId, "expected attacker id for victim B knockout");
    assert.strictEqual(ghostAKnockouts[0]?.reason, "path-cross", "expected path-cross reason for victim A");
    assert.strictEqual(ghostBKnockouts[0]?.reason, "path-cross", "expected path-cross reason for victim B");

    const ghostAAfter = getPlayer(mapId, ghostAId);
    const ghostBAfter = getPlayer(mapId, ghostBId);
    assertKnockoutResetState(ghostAAfter);
    assertKnockoutResetState(ghostBAfter);

    const attackerAfter = getPlayer(mapId, playerId);
    assert.ok(attackerAfter.territory, "expected attacker to remain alive after knocking multiple victims");
    clearMapState(mapId);
  });

  // VERIFIES:
  // 1. Two vulnerable victims can exist on the same map with separate active paths
  // 2. One attacker segment can intersect both paths in a single update
  // 3. Each victim receives exactly one knockout event
  // 4. Attacker remains alive after the multi-victim crossing
  // TEST END

  // TEST: Vulnerable Ghost Cannot Attack
  // Game Story: A ghost has traveled far enough to become vulnerable, but is still not a full player.
  // That ghost crosses another player's active path.
  // TEST SETUP: A player creates an active outside path on x=0. A vulnerable ghost then moves from x=2 to x=-2
  // across that path.
  // EXPECTED: No knockout happens, because vulnerable ghosts are still not allowed to attack.
  runCase("Vulnerable ghost cannot knock another player", () => {
    const mapId = "vulnerable-ghost-cannot-attack";
    const playerId = "player-target";
    const ghostId = "ghost-attacker";
    const sendPlayer = createSender(mapId, playerId);
    const sendGhost = createSender(mapId, ghostId);

    // Player setup on graph: become a full player, then leave territory to create an active path on x=0.
    const playerSpawn = graphPoint(0, 0);
    makePlayer(mapId, playerId, sendPlayer, playerSpawn.lat, playerSpawn.lng);
    const playerBeforeExit = getPlayer(mapId, playerId);
    const playerBounds = getBounds(playerBeforeExit.territory);
    const playerOutside = graphPoint(0, -8);
    sendPlayer(playerBounds.centerLat, playerBounds.centerLng);
    sendPlayer(playerOutside.lat, playerOutside.lng);

    const playerBeforeCross = getPlayer(mapId, playerId);
    assert.ok(
      isActiveAttackerState(playerBeforeCross.ghostState),
      "expected target to remain in an active attacker state"
    );
    assert.ok(playerBeforeCross.isOutside, "expected target player to have an active path");

    // Ghost setup on graph: (2, 0) -> (2, -5) to become vulnerable while staying outside.
    const ghostSpawn = graphPoint(2, 0);
    const ghostOutside = graphPoint(2, -5);
    sendGhost(ghostSpawn.lat, ghostSpawn.lng);
    sendGhost(ghostOutside.lat, ghostOutside.lng);

    const ghostBeforeCross = getPlayer(mapId, ghostId);
    assert.strictEqual(ghostBeforeCross.ghostState, "ghost_vulnerable", "expected moving ghost to be vulnerable");
    assert.ok(ghostBeforeCross.isOutside, "expected vulnerable ghost to have an active outside path");

    // Graph path:
    // vulnerable ghost moves from (2, -5) to (-2, -2), crossing the player's x=0 path.
    const ghostCross = graphPoint(-2, -2);
    const crossingEvents = sendGhost(ghostCross.lat, ghostCross.lng);

    const playerKnock = crossingEvents.find(
      (event) => event.type === "knockout" && event.userId === playerId
    );
    const ghostKnock = crossingEvents.find(
      (event) => event.type === "knockout" && event.userId === ghostId
    );
    assert.ok(!playerKnock, "did not expect vulnerable ghost to knock another player");
    assert.ok(!ghostKnock, "did not expect vulnerable ghost to be knocked by this crossing");

    const playerAfterCross = getPlayer(mapId, playerId);
    assert.ok(playerAfterCross.territory, "expected target player to remain alive after ghost crossing");
    assert.ok(playerAfterCross.path, "expected target player path to remain active after ghost crossing");

    const ghostAfterCross = getPlayer(mapId, ghostId);
    assert.ok(ghostAfterCross.territory, "expected vulnerable ghost to remain alive after failed attack");
    assert.ok(ghostAfterCross.path, "expected vulnerable ghost path to remain active after failed attack");
    clearMapState(mapId);
  });

  // VERIFIES:
  // 1. A vulnerable ghost can have an active outside path
  // 2. That ghost can geometrically cross another player's active path
  // 3. No knockout fires because only full players can attack
  // 4. Both players remain alive after the crossing
  // TEST END

  // TEST: Out-Of-Order Update Is Ignored
  // Game Story: Player B receives an older GPS point after already moving outside.
  // That old point would cross Player A's vulnerable path if the engine accepted it.
  // TEST SETUP: A has a vulnerable path on x=0. B exits to the left of that line, then sends a stale point on the right side.
  // EXPECTED: The stale update is ignored entirely, so no knockout happens and B's path does not change.
  runCase("Out-of-order crossing update is ignored", () => {
    const mapId = "stale-update-ignore";
    const ghostId = "ghost-stale";
    const playerId = "player-stale";
    const sendGhost = createSender(mapId, ghostId);
    const sendPlayer = createSender(mapId, playerId);

    // Victim setup on graph: (0, 0) -> (0, -5) to create a vulnerable vertical path.
    const victimSpawn = graphPoint(0, 0);
    const victimOutside = graphPoint(0, -5);
    sendGhost(victimSpawn.lat, victimSpawn.lng);
    sendGhost(victimOutside.lat, victimOutside.lng);

    const ghostBeforeStale = getPlayer(mapId, ghostId);
    assert.strictEqual(ghostBeforeStale.ghostState, "ghost_vulnerable", "expected vulnerable victim path");
    assert.ok(ghostBeforeStale.path, "expected victim path before stale update test");

    // Attacker setup: become a full player, then move outside to the left of victim path.
    const attackerSpawn = graphPoint(20, 20);
    makePlayer(mapId, playerId, sendPlayer, attackerSpawn.lat, attackerSpawn.lng);
    const attacker = getPlayer(mapId, playerId);
    const attackerBounds = getBounds(attacker.territory);

    // Graph path:
    // center -> (-2, -2): valid current outside path with no intersection yet.
    // stale point would be (2, -2), which would cross x=0 if it were accepted.
    const attackerApproach = graphPoint(-2, -2);
    const staleCrossPoint = graphPoint(2, -2);
    sendPlayer(attackerBounds.centerLat, attackerBounds.centerLng);
    const approachEvents = sendPlayer(attackerApproach.lat, attackerApproach.lng);
    assert.ok(
      !approachEvents.some((event) => event.type === "knockout"),
      "did not expect knockout before stale crossing attempt"
    );

    const beforeStale = getPlayer(mapId, playerId);
    const beforeStalePathLength = beforeStale.path?.geometry.coordinates.length ?? 0;

    // Send an intentionally old timestamp that would cross the victim path if processed.
    const staleEvents = ingestLocation(
      mapId,
      playerId,
      { lat: staleCrossPoint.lat, lng: staleCrossPoint.lng, ts: 1 },
      ops,
      expectedUsername(playerId)
    );
    assert.strictEqual(staleEvents.length, 0, "expected stale update to be ignored with no events");

    const ghostAfterStale = getPlayer(mapId, ghostId);
    assert.ok(ghostAfterStale.territory, "expected victim to remain alive after stale crossing attempt");
    assert.ok(ghostAfterStale.path, "expected victim path to remain active after stale crossing attempt");

    const attackerAfterStale = getPlayer(mapId, playerId);
    assert.ok(attackerAfterStale.path, "expected attacker path to remain active after stale update");
    assert.strictEqual(
      attackerAfterStale.path.geometry.coordinates.length,
      beforeStalePathLength,
      "expected stale update to leave attacker path unchanged"
    );
    clearMapState(mapId);
  });

  // VERIFIES:
  // 1. A stale update can geometrically look like a crossing
  // 2. The engine emits no events for an out-of-order timestamp
  // 3. Victim remains alive because the crossing was never accepted
  // 4. Attacker path state does not change after the stale update
  // TEST END

  // TEST: Duplicate Outside Point Is Ignored
  // Game Story: Player B is already outside and the device sends the exact same GPS coordinate again with a newer timestamp.
  // TEST SETUP: A has a vulnerable path on x=0. B exits to (-2, -2), then receives that exact same point again.
  // EXPECTED: The duplicate point should not create a new segment, should not change B's path, and should not trigger a knockout.
  runCase("Duplicate outside point with newer timestamp is ignored", () => {
    const mapId = "duplicate-outside-point";
    const ghostId = "ghost-duplicate";
    const playerId = "player-duplicate";
    const sendGhost = createSender(mapId, ghostId);
    const sendPlayer = createSender(mapId, playerId);

    // Victim setup on graph: (0, 0) -> (0, -5) to create a vulnerable vertical path.
    const victimSpawn = graphPoint(0, 0);
    const victimOutside = graphPoint(0, -5);
    sendGhost(victimSpawn.lat, victimSpawn.lng);
    sendGhost(victimOutside.lat, victimOutside.lng);

    const ghostBeforeDuplicate = getPlayer(mapId, ghostId);
    assert.strictEqual(ghostBeforeDuplicate.ghostState, "ghost_vulnerable", "expected vulnerable victim path");
    assert.ok(ghostBeforeDuplicate.path, "expected victim path before duplicate update test");

    // Attacker setup: become a full player, then move outside to a safe point left of victim path.
    const attackerSpawn = graphPoint(20, 20);
    makePlayer(mapId, playerId, sendPlayer, attackerSpawn.lat, attackerSpawn.lng);
    const attacker = getPlayer(mapId, playerId);
    const attackerBounds = getBounds(attacker.territory);

    const outsidePoint = graphPoint(-2, -2);
    sendPlayer(attackerBounds.centerLat, attackerBounds.centerLng);
    const firstOutsideEvents = sendPlayer(outsidePoint.lat, outsidePoint.lng);
    assert.ok(
      !firstOutsideEvents.some((event) => event.type === "knockout"),
      "did not expect knockout before duplicate point"
    );

    const beforeDuplicate = getPlayer(mapId, playerId);
    const beforeDuplicatePath = beforeDuplicate.path?.geometry.coordinates ?? [];
    const beforeDuplicatePathLength = beforeDuplicatePath.length;
    const beforeDuplicateMeters = beforeDuplicate.pathLengthMeters;

    // Same coordinate, newer timestamp: should be treated like a zero-length segment and ignored.
    const duplicateEvents = sendPlayer(outsidePoint.lat, outsidePoint.lng);
    assert.ok(
      !duplicateEvents.some((event) => event.type === "knockout"),
      "did not expect knockout from duplicate outside point"
    );

    const ghostAfterDuplicate = getPlayer(mapId, ghostId);
    assert.ok(ghostAfterDuplicate.territory, "expected victim to remain alive after duplicate update");
    assert.ok(ghostAfterDuplicate.path, "expected victim path to remain active after duplicate update");

    const attackerAfterDuplicate = getPlayer(mapId, playerId);
    const afterDuplicatePath = attackerAfterDuplicate.path?.geometry.coordinates ?? [];
    assert.strictEqual(
      afterDuplicatePath.length,
      beforeDuplicatePathLength,
      "expected duplicate point to leave attacker path length unchanged"
    );
    assert.strictEqual(
      attackerAfterDuplicate.pathLengthMeters,
      beforeDuplicateMeters,
      "expected duplicate point to leave attacker path meters unchanged"
    );
    clearMapState(mapId);
  });

  // VERIFIES:
  // 1. A duplicate GPS sample can arrive with a newer timestamp while a player is outside
  // 2. The engine does not create a new path segment for that duplicate point
  // 3. No knockout fires from the duplicate update
  // 4. Path size and path length remain unchanged after the duplicate sample
  // TEST END

  // NOTE FOR CONNOR:
  // Live Case A parity for the knockout rule:
  // vulnerable outside-path victim is knocked by path-cross,
  // and the crossing move itself does not grant capture.
  // Validates:
  // 1) Victim is ghost_vulnerable with active outside path
  // 2) Attacker is in player state
  // 3) Crossing victim path emits knockout with reason "path-cross"
  // 4) Crossing sequence emits no attacker territory event
  // 5) Victim state is fully reset after knockout
  // TEST: Live Case A Path-Cross Knockout
  // Description: Vulnerable victim path-cross results in knockout, with no territory capture by attacker during crossing.
  runCase("Live case A: vulnerable path-cross knockout with no capture", () => {
    // Use a dedicated map so this scenario is isolated from other cases
    // and cannot be influenced by earlier test state.
    const mapId = "live-case-a-path-cross-no-capture";
    const ghostId = "ghost-live-a";
    const playerId = "player-live-a";
    const sendGhost = createSender(mapId, ghostId);
    const sendPlayer = createSender(mapId, playerId);

    // Phase 1: victim setup.
    // Spawn ghost territory, then force a long outside path so victim becomes ghost_vulnerable.
    // This mirrors the real game path where a ghost leaves safe territory before being hittable.
    sendGhost(0, 0);
    const ghost = getPlayer(mapId, ghostId);
    const ghostBounds = getBounds(ghost.territory);
    makeGhostPath(mapId, ghostId, ghostBounds, sendGhost, 0.01);
    const ghostBeforeCross = getPlayer(mapId, ghostId);
    assert.strictEqual(ghostBeforeCross.ghostState, "ghost_vulnerable");
    assert.ok(ghostBeforeCross.path, "expected victim path while outside");
    assert.ok(
      ghostBeforeCross.path.geometry.coordinates.length >= 2,
      "expected at least one outside segment for victim"
    );
    // Keep victim path endpoints so attacker can intentionally cross that exact segment.
    const [gStart, gEnd] = ghostBeforeCross.path.geometry.coordinates;
    const [gStartLng, gStartLat] = gStart;
    const [gEndLng, gEndLat] = gEnd;

    // Phase 2: attacker setup.
    // Attacker must be in player mode (not ghost) for path-cross knockouts.
    // `makePlayer` seeds territory and confirms promotion out of ghost mode.
    makePlayer(mapId, playerId, sendPlayer, 0.02, 0.02);
    const playerBeforeCross = getPlayer(mapId, playerId);
    const playerBounds = getBounds(playerBeforeCross.territory);
    // Record area before crossing to prove no accidental territory capture is awarded.
    const attackerAreaBeforeCross = playerBeforeCross.territoryAreaSqMeters;

    // Phase 3: crossing action.
    // Start attacker just outside territory, then force its segment through victim path endpoints.
    // This constructs the path-cross condition directly and deterministically.
    const start = sendPlayer(
      playerBounds.minLat + playerBounds.dLat * 0.1,
      playerBounds.centerLng
    );
    const mid = sendPlayer(gStartLat, gStartLng);
    const end = sendPlayer(gEndLat, gEndLng);
    // Collect all events emitted by this crossing sequence.
    const crossingEvents = [...start, ...mid, ...end];

    // Phase 4: verify knockout reason and non-capture behavior.
    const knockedGhost = crossingEvents.find(
      (event) => event.type === "knockout" && event.userId === ghostId
    );
    // Victim must be the knockout target.
    assert.ok(knockedGhost, "expected vulnerable victim to be knocked on path-cross");
    // Reason is important for regression: this should be path-cross logic, not a generic knockout.
    assert.strictEqual(knockedGhost.reason, "path-cross", "expected path-cross knockout reason");

    // This is the key regression guard:
    // crossing another player's path should not also produce territory claim in the same move.
    const captureByAttackerDuringCross = crossingEvents.find(
      (event) => event.type === "territory" && event.userId === playerId
    );

    assert.ok(
      !captureByAttackerDuringCross,
      "expected no attacker territory capture event during crossing knockout"
    );

    const playerAfterCross = getPlayer(mapId, playerId);
    // Attacker area should not change from crossing-only knockout behavior.
    assert.strictEqual(
      playerAfterCross.territoryAreaSqMeters,
      attackerAreaBeforeCross,
      "expected attacker territory area unchanged by crossing-only knockout"
    );

    // Victim state should be reset exactly as knockout rules require.
    const ghostAfterKnock = getPlayer(mapId, ghostId);
    assertKnockoutResetState(ghostAfterKnock);

    // Always clean up to avoid map state leaking into later scenarios.
    clearMapState(mapId);
  });
  // TEST END

  // TEST: Boundary Selection
  // Description: Capture closure should choose valid smaller-area boundary and increase territory.
  runCase("Boundary selection prefers smaller-area capture", () => {
    const mapId = "boundary-selection";
    const userId = "player-boundary";
    const send = createSender(mapId, userId);
    send(0, 0);
    const player = getPlayer(mapId, userId);
    const bounds = getBounds(player.territory);
    const initialArea = player.territoryAreaSqMeters;

    const boundaryInside = player.lastInsidePoint ?? { lat: bounds.centerLat, lng: bounds.centerLng };
    send(boundaryInside.lat, boundaryInside.lng);
    send(bounds.minLat - bounds.dLat * 4, bounds.centerLng + bounds.dLng * 0.5);
    send(bounds.minLat - bounds.dLat * 6, bounds.maxLng + bounds.dLng * 2);
    send(bounds.centerLat, bounds.maxLng - bounds.dLng * 0.1);

    const after = getPlayer(mapId, userId);
    const delta = after.territoryAreaSqMeters - initialArea;
    assert.ok(delta > 0, "expected capture to increase area");
    clearMapState(mapId);
  });
  // TEST END

  // TEST: Player Territory Subtraction
  // Description: One player's capture should subtract area from another player's territory.
  runCase("Capture subtracts territory from another player", () => {
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
      const captorContains = captorAfter.territory
        ? booleanPointInPolygon(defenderCenter, captorAfter.territory)
        : false;
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
  });
  // TEST END

  // TEST: Split Geometry Validity
  // Description: Split capture outcomes should preserve valid Polygon or MultiPolygon geometry.
  runCase("Split capture keeps defender territory geometry valid", () => {
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
    assert.ok(
      defenderAfter.territory.geometry.type === "Polygon" ||
        defenderAfter.territory.geometry.type === "MultiPolygon",
      "expected defender territory geometry to remain valid after split attempt"
    );
    clearMapState(mapId);
  });
  // TEST END

  // TEST: Vulnerable Ghost Territory Subtraction
  // Description: Player capture should subtract area from vulnerable ghost territory.
  runCase("Capture subtracts territory from vulnerable ghosts", () => {
    const mapId = "capture-subtract";
    const captorId = "player-8";
    const ghostId = "ghost-5";
    const sendCaptor = createSender(mapId, captorId);
    const sendGhost = createSender(mapId, ghostId);

    makePlayer(mapId, captorId, sendCaptor, 0, 0);
    const captor = getPlayer(mapId, captorId);
    const captorBounds = getBounds(captor.territory);

    const ghostSeedLat = captorBounds.centerLat + captorBounds.dLat * 2;
    const ghostSeedLng = captorBounds.centerLng + captorBounds.dLng * 2;
    sendGhost(ghostSeedLat, ghostSeedLng);
    const ghost = getPlayer(mapId, ghostId);
    const ghostBounds = getBounds(ghost.territory);
    makeGhostPath(mapId, ghostId, ghostBounds, sendGhost, 0.01);
    const ghostBefore = getPlayer(mapId, ghostId);
    assert.strictEqual(ghostBefore.ghostState, "ghost_vulnerable", "expected ghost to be vulnerable");
    const ghostAreaBefore = ghostBefore.territoryAreaSqMeters;

    const marginLat = ghostBounds.dLat * 1.5;
    const marginLng = ghostBounds.dLng * 1.5;
    sendCaptor(captorBounds.centerLat, captorBounds.centerLng);
    sendCaptor(ghostBounds.minLat - marginLat, ghostBounds.minLng - marginLng);
    sendCaptor(ghostBounds.minLat - marginLat, ghostBounds.maxLng + marginLng);
    sendCaptor(ghostBounds.maxLat + marginLat, ghostBounds.maxLng + marginLng);
    sendCaptor(ghostBounds.maxLat + marginLat, ghostBounds.minLng - marginLng);
    sendCaptor(captorBounds.centerLat, captorBounds.centerLng);

    const ghostAfter = getPlayer(mapId, ghostId);
    assert.ok(
      ghostAfter.territoryAreaSqMeters < ghostAreaBefore,
      "expected ghost territory to decrease after capture"
    );
    clearMapState(mapId);
  });
  // TEST END

  console.log("Realtime gameplay tests passed.");
} catch (err) {
  console.error("Realtime gameplay tests failed:");
  console.error(err);
  process.exit(1);
}
