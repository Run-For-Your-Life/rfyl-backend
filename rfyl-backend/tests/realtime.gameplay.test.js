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
