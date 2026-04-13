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

const players = Array.from({ length: 7 }, (_, index) => ({
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

    const fifthAssignment = await postJson(baseUrl, "/api/matchmaking/me", {}, players[4].token);
    assert.strictEqual(fifthAssignment.response.status, 200, "expected fifth player to trigger immediate flush assignment");
    assert.strictEqual(fifthAssignment.json?.queued, false, "expected immediate flush to assign the fifth player");
    assert.ok(typeof fifthAssignment.json?.mapId === "string", "expected assigned map id after full batch flush");
    const firstMapId = fifthAssignment.json.mapId;
    resolvedMapIds.add(firstMapId);

    const firstPlayerJoin = await postJson(
      baseUrl,
      `/api/maps/${encodeURIComponent(firstMapId)}/players/join`,
      { userId: players[0].uid },
      players[0].token
    );
    assert.ok(firstPlayerJoin.response.status === 200 || firstPlayerJoin.response.status === 201, "expected assigned player to join the resolved map");

    const firstPlayerState = await getJson(baseUrl, `/api/maps/${encodeURIComponent(firstMapId)}/state`, players[0].token);
    assert.strictEqual(firstPlayerState.response.status, 200, "expected first queued player to resolve after batch flush");
    assert.strictEqual(firstPlayerState.json?.mapId, firstMapId, "expected first player state to resolve to the flushed map");
    assert.strictEqual(firstPlayerState.json?.players?.length, 5, "expected flushed map to contain five players");

    const sixthAssignment = await postJson(baseUrl, "/api/matchmaking/me", {}, players[5].token);
    assert.strictEqual(sixthAssignment.response.status, 202, "expected sixth player to wait for timeout flush");
    assert.strictEqual(sixthAssignment.json?.queued, true, "expected sixth player to be queued initially");

    await sleep(80);

    const sixthResolvedAssignment = await postJson(baseUrl, "/api/matchmaking/me", {}, players[5].token);
    assert.strictEqual(sixthResolvedAssignment.response.status, 200, "expected timeout flush to eventually assign the sixth player");
    assert.strictEqual(sixthResolvedAssignment.json?.mapId, firstMapId, "expected timeout flush to place the sixth player into the least populated existing map");

    const sixthState = await getJson(baseUrl, `/api/maps/${encodeURIComponent(firstMapId)}/state`, players[5].token);
    assert.strictEqual(sixthState.response.status, 200, "expected timeout flush to expose live map state");
    assert.strictEqual(sixthState.json?.players?.length, 6, "expected timeout flush to backfill the existing map to six players");

    rolloverWeeklyMatchmaking("after-reset");

    const activeAssignments = [];
    for (const player of players.slice(0, 6)) {
      const assignment = await postJson(baseUrl, "/api/matchmaking/me", {}, player.token);
      assert.strictEqual(assignment.response.status, 200, `expected active player ${player.uid} to receive a weekly assignment after rollover`);
      activeAssignments.push(assignment.json?.mapId);
      resolvedMapIds.add(assignment.json?.mapId);
    }

    const resetFirstMapId = activeAssignments[0];
    const resetSecondMapId = activeAssignments[5];
    assert.ok(activeAssignments.slice(0, 5).every((mapId) => mapId === resetFirstMapId), "expected active players one through five to be redistributed into the first preferred-size map");
    assert.notStrictEqual(resetSecondMapId, resetFirstMapId, "expected the sixth active player to spill into a second map after weekly redistribution");

    const inactiveAssignment = await postJson(baseUrl, "/api/matchmaking/me", {}, players[6].token);
    assert.strictEqual(inactiveAssignment.response.status, 202, "expected inactive player to re-enter the queue after weekly rollover");
    assert.strictEqual(inactiveAssignment.json?.queued, true, "expected inactive player to be queued rather than pre-assigned");

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
