const assert = require("assert");
const { execSync } = require("child_process");
const express = require("express");

console.log("Running map matchmaking tests...");

const matchmakingWalBase = `/tmp/rfyl-map-matchmaking-${Date.now()}`;
process.env.REALTIME_WAL_PATH = `${matchmakingWalBase}.jsonl`;
process.env.REALTIME_WAL_CURSOR_PATH = `${matchmakingWalBase}.cursor`;
process.env.MATCHMAKING_QUEUE_TIMEOUT_MS = "50";
process.env.MATCHMAKING_STALE_QUEUE_MS = "5000";
process.env.MATCHMAKING_CLEANUP_INTERVAL_MS = "1000";

execSync("npm run build --silent", { stdio: "inherit" });

const { createMapsRouter } = require("../dist/routes/maps/index.js");
const { createMatchmakingRouter } = require("../dist/routes/matchmaking/index.js");
const {
  resetWeeklyMatchmaking,
  rolloverWeeklyMatchmaking,
  stopMatchmakingMaintenance,
} = require("../dist/services/mapMatchmaking.js");
const { clearMapState } = require("../dist/services/realtimeEngine.js");

const players = Array.from({ length: 15 }, (_, index) => ({
  token: `token-player-${index + 1}`,
  uid: `player-${index + 1}`,
  name: `player-${index + 1}`,
}));

const tokenIdentity = Object.fromEntries(
  players.map((player) => [player.token, { uid: player.uid, name: player.name }])
);

const routerOptions = {
  verifyIdToken: async (token) => {
    const decoded = tokenIdentity[token];
    if (!decoded) {
      throw new Error("invalid test token");
    }
    return decoded;
  },
  resolveUsername: async (decoded) => decoded.name ?? decoded.uid,
};

const mapsRouter = createMapsRouter(routerOptions);
const matchmakingRouter = createMatchmakingRouter(routerOptions);

function startServer() {
  return new Promise((resolve, reject) => {
    const app = express();
    app.use(express.json());
    app.use("/api/matchmaking", matchmakingRouter);
    app.use("/api/maps", mapsRouter);
    const server = app.listen(0, "127.0.0.1");
    server.once("error", (err) => reject(err));
    server.once("listening", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to obtain TCP address for test server"));
        return;
      }
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

function stopServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

async function postJson(baseUrl, path, body, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }

  return { response, json };
}

async function getJson(baseUrl, path, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }

  return { response, json };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  let server;
  const resolvedMapIds = new Set();

  try {
    resetWeeklyMatchmaking("before-test");
    const started = await startServer();
    server = started.server;
    const baseUrl = started.baseUrl;

    for (const player of players.slice(0, 4)) {
      const assignment = await postJson(baseUrl, "/api/matchmaking/me", {}, player.token);
      assert.strictEqual(assignment.response.status, 202, `expected queued assignment for ${player.uid}`);
      assert.strictEqual(assignment.json?.queued, true, "expected queued assignment response");
      assert.strictEqual(assignment.json?.mapId, undefined, "expected no map assignment before full batch flush");
    }

    const repeatedQueuedPoll = await postJson(baseUrl, "/api/matchmaking/me", {}, players[0].token);
    assert.strictEqual(repeatedQueuedPoll.response.status, 202, "expected repeated queued poll to remain queued without changing state");

    const fifthAssignment = await postJson(baseUrl, "/api/matchmaking/me", {}, players[4].token);
    assert.strictEqual(fifthAssignment.response.status, 200, "expected fifth player to trigger immediate flush assignment");
    const firstMapId = fifthAssignment.json.mapId;
    resolvedMapIds.add(firstMapId);

    const firstPlayerState = await getJson(baseUrl, `/api/maps/${encodeURIComponent(firstMapId)}/state`, players[0].token);
    assert.strictEqual(firstPlayerState.response.status, 200, "expected first queued player to resolve after batch flush");
    assert.strictEqual(firstPlayerState.json?.players?.length, 5, "expected first flushed map to contain five players");

    const sixthAssignment = await postJson(baseUrl, "/api/matchmaking/me", {}, players[5].token);
    assert.strictEqual(sixthAssignment.response.status, 202, "expected sixth player to be queued for timeout flush");

    await sleep(80);

    const sixthResolvedAssignment = await postJson(baseUrl, "/api/matchmaking/me", {}, players[5].token);
    assert.strictEqual(sixthResolvedAssignment.response.status, 200, "expected timeout flush to eventually assign the sixth player");
    assert.strictEqual(sixthResolvedAssignment.json?.mapId, firstMapId, "expected timeout flush of one player to backfill the existing five-player map");

    const firstMapStateAfterTimeout = await getJson(baseUrl, `/api/maps/${encodeURIComponent(firstMapId)}/state`, players[0].token);
    assert.strictEqual(firstMapStateAfterTimeout.response.status, 200, "expected first map to remain available after timeout flush");
    assert.strictEqual(firstMapStateAfterTimeout.json?.players?.length, 6, "expected timeout flush of one player to create a six-player map");

    resetWeeklyMatchmaking("underfilled-full-batch");

    for (const player of players.slice(0, 3)) {
      const assignment = await postJson(baseUrl, "/api/matchmaking/me", {}, player.token);
      assert.strictEqual(assignment.response.status, 202, `expected queued assignment for ${player.uid}`);
    }
    await sleep(80);
    const seededMapAssignment = await postJson(baseUrl, "/api/matchmaking/me", {}, players[0].token);
    assert.strictEqual(seededMapAssignment.response.status, 200, "expected timeout flush to create the underfilled seeded map");
    const underfilledMapId = seededMapAssignment.json.mapId;
    resolvedMapIds.add(underfilledMapId);

    const underfilledState = await getJson(baseUrl, `/api/maps/${encodeURIComponent(underfilledMapId)}/state`, players[0].token);
    assert.strictEqual(underfilledState.response.status, 200, "expected underfilled seeded map to expose live state");
    assert.strictEqual(underfilledState.json?.players?.length, 3, "expected seeded map to start at three players");

    for (const player of players.slice(3, 7)) {
      const assignment = await postJson(baseUrl, "/api/matchmaking/me", {}, player.token);
      assert.strictEqual(assignment.response.status, 202, `expected queued assignment for ${player.uid}`);
    }

    const eighthAssignment = await postJson(baseUrl, "/api/matchmaking/me", {}, players[7].token);
    assert.strictEqual(eighthAssignment.response.status, 200, "expected fifth queued player to trigger a full five-player flush");
    assert.strictEqual(eighthAssignment.json.mapId, underfilledMapId, "expected the full flush to place the entire batch into the existing underfilled map");

    const healedUnderfilledState = await getJson(baseUrl, `/api/maps/${encodeURIComponent(underfilledMapId)}/state`, players[0].token);
    assert.strictEqual(healedUnderfilledState.response.status, 200, "expected healed underfilled map to remain available");
    assert.strictEqual(healedUnderfilledState.json?.players?.length, 8, "expected the entire full batch to be flushed into the same underfilled map");

    resetWeeklyMatchmaking("oversized-timeout");

    for (const player of players.slice(0, 4)) {
      const assignment = await postJson(baseUrl, "/api/matchmaking/me", {}, player.token);
      assert.strictEqual(assignment.response.status, 202, `expected queued assignment for ${player.uid}`);
    }
    const seededFiveMapAssignment = await postJson(baseUrl, "/api/matchmaking/me", {}, players[4].token);
    assert.strictEqual(seededFiveMapAssignment.response.status, 200, "expected fifth player to trigger immediate flush assignment for the seeded timeout target map");
    const eightPlayerMapId = seededFiveMapAssignment.json.mapId;
    resolvedMapIds.add(eightPlayerMapId);

    for (const player of players.slice(5, 9)) {
      const assignment = await postJson(baseUrl, "/api/matchmaking/me", {}, player.token);
      assert.strictEqual(assignment.response.status, 202, `expected queued assignment for ${player.uid}`);
    }

    await sleep(80);

    const seededNineMapAssignment = await postJson(baseUrl, "/api/matchmaking/me", {}, players[5].token);
    assert.strictEqual(seededNineMapAssignment.response.status, 200, "expected timeout backfill to grow the seeded map to nine players");
    assert.strictEqual(seededNineMapAssignment.json.mapId, eightPlayerMapId, "expected timeout backfill to reuse the existing five-player map");

    const eightPlayerMapState = await getJson(baseUrl, `/api/maps/${encodeURIComponent(eightPlayerMapId)}/state`, players[0].token);
    assert.strictEqual(eightPlayerMapState.response.status, 200, "expected seeded timeout target map to expose live state");
    assert.strictEqual(eightPlayerMapState.json?.players?.length, 9, "expected seeded timeout target map to contain nine players after timeout backfill");

    for (const player of players.slice(9, 12)) {
      const assignment = await postJson(baseUrl, "/api/matchmaking/me", {}, player.token);
      assert.strictEqual(assignment.response.status, 202, `expected queued assignment for ${player.uid}`);
    }

    await sleep(80);

    const oversizedTimeoutAssignment = await postJson(baseUrl, "/api/matchmaking/me", {}, players[9].token);
    assert.strictEqual(oversizedTimeoutAssignment.response.status, 200, "expected oversized timeout flush to assign the batch");
    const overflowMapId = oversizedTimeoutAssignment.json.mapId;
    resolvedMapIds.add(overflowMapId);
    assert.notStrictEqual(overflowMapId, eightPlayerMapId, "expected oversized timeout flush to create a new map instead of splitting into the nearly full map");

    const nearlyFullMapState = await getJson(baseUrl, `/api/maps/${encodeURIComponent(eightPlayerMapId)}/state`, players[0].token);
    assert.strictEqual(nearlyFullMapState.response.status, 200, "expected nearly full map to remain available after oversized timeout flush");
    assert.strictEqual(nearlyFullMapState.json?.players?.length, 9, "expected oversized timeout flush not to partially fill the nearly full map");

    const overflowMapState = await getJson(baseUrl, `/api/maps/${encodeURIComponent(overflowMapId)}/state`, players[9].token);
    assert.strictEqual(overflowMapState.response.status, 200, "expected overflow timeout map to expose live state");
    assert.strictEqual(overflowMapState.json?.players?.length, 3, "expected oversized timeout flush to keep the whole batch together on a new map");

    rolloverWeeklyMatchmaking("after-reset");

    const activeAssignments = [];
    for (const player of players.slice(0, 12)) {
      const assignment = await postJson(baseUrl, "/api/matchmaking/me", {}, player.token);
      assert.strictEqual(assignment.response.status, 200, `expected active player ${player.uid} to receive a weekly assignment after rollover`);
      activeAssignments.push(assignment.json?.mapId);
      resolvedMapIds.add(assignment.json?.mapId);
    }

    const weeklyAssignmentCounts = new Map();
    for (const mapId of activeAssignments) {
      weeklyAssignmentCounts.set(mapId, (weeklyAssignmentCounts.get(mapId) ?? 0) + 1);
    }
    const weeklyGroupSizes = Array.from(weeklyAssignmentCounts.values()).sort((a, b) => b - a);
    assert.deepStrictEqual(weeklyGroupSizes, [5, 5, 2], "expected weekly redistribution to continue targeting preferred groups of five with a smaller spill map");

    rolloverWeeklyMatchmaking("after-second-reset");

    const inactiveFormerActive = await postJson(baseUrl, "/api/matchmaking/me", {}, players[0].token);
    assert.strictEqual(inactiveFormerActive.response.status, 202, "expected previously assigned player without new-week activity to be re-queued on the next rollover");
    assert.strictEqual(inactiveFormerActive.json?.queued, true, "expected no automatic carry-over without current-week activity");

    console.log("Map matchmaking tests passed.");
  } catch (err) {
    console.error("Map matchmaking tests failed:");
    console.error(err);
    process.exitCode = 1;
  } finally {
    stopMatchmakingMaintenance();
    resetWeeklyMatchmaking("cleanup");
    for (const mapId of resolvedMapIds) {
      if (typeof mapId === "string") {
        clearMapState(mapId);
      }
    }
    if (server) {
      await stopServer(server);
    }
  }
})();
