const assert = require("assert");
const { execSync } = require("child_process");
const http = require("http");
const express = require("express");

console.log("Running map reset route tests...");

const resetWalBase = `/tmp/rfyl-map-reset-${Date.now()}`;
process.env.REALTIME_WAL_PATH = `${resetWalBase}.jsonl`;
process.env.REALTIME_WAL_CURSOR_PATH = `${resetWalBase}.cursor`;

execSync("npm run build --silent", { stdio: "inherit" });

const { createMapsRouter } = require("../dist/routes/maps/index.js");
const { clearMapState } = require("../dist/services/realtimeEngine.js");

const TOKENS = {
  playerA: "token-player-a",
  unspawned: "token-player-unspawned",
  joined: "token-player-joined",
  victim: "token-victim-user",
  attacker: "token-attacker-user",
  missingJoin: "token-player-never-joined",
  observer: "token-observer",
};

const tokenIdentity = {
  [TOKENS.playerA]: { uid: "player-a", name: "player-a" },
  [TOKENS.unspawned]: { uid: "player-unspawned", name: "player-unspawned" },
  [TOKENS.joined]: { uid: "player-joined", name: "player-joined" },
  [TOKENS.victim]: { uid: "victim-user", name: "victim-user" },
  [TOKENS.attacker]: { uid: "attacker-user", name: "attacker-user" },
  [TOKENS.missingJoin]: { uid: "player-never-joined", name: "player-never-joined" },
  [TOKENS.observer]: { uid: "observer-user", name: "observer-user" },
};

const mapsRouter = createMapsRouter({
  verifyIdToken: async (token) => {
    const decoded = tokenIdentity[token];
    if (!decoded) {
      throw new Error("invalid test token");
    }
    return decoded;
  },
});

function startServer() {
  return new Promise((resolve, reject) => {
    const app = express();
    app.use(express.json());
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

async function postJson(baseUrl, path, body, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
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

async function getJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: authHeaders(),
  });
  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { response, json };
}

function waitForResetSse(baseUrl, mapId, token, timeoutMs = 3500) {
  return new Promise((resolve, reject) => {
    const url = new URL(`/api/maps/${mapId}/stream`, baseUrl);
    const req = http.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "GET",
        headers: {
          Accept: "text/event-stream",
          Authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");

        res.on("data", (chunk) => {
          text += chunk;
          if (text.includes("event: reset")) {
            cleanup();
            resolve(text);
          }
        });

        res.on("error", (err) => {
          cleanup();
          reject(err);
        });
      }
    );

    req.on("error", (err) => {
      cleanup();
      reject(err);
    });

    req.end();

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for reset SSE event"));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      req.destroy();
    }
  });
}

function authHeaders(token = TOKENS.observer) {
  return {
    Authorization: `Bearer ${token}`,
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  let server;
  const mapId = `reset-map-${Date.now()}`;
  const unspawnedMapId = `${mapId}-unspawned`;
  const mixedBatchMapId = `${mapId}-mixed`;
  const spoofMapId = `${mapId}-spoof`;
  const missingJoinMapId = `${mapId}-missing-join`;

  try {
    const started = await startServer();
    server = started.server;
    const baseUrl = started.baseUrl;

    delete process.env.MAP_RESET_PASSWORD;
    const disabled = await postJson(baseUrl, `/api/maps/${mapId}/reset`, { password: "x" }, authHeaders());
    assert.strictEqual(disabled.response.status, 503, "expected reset endpoint to be disabled when MAP_RESET_PASSWORD is missing");

    process.env.MAP_RESET_PASSWORD = "test-reset-password";

    const notJoinedLocation = await postJson(baseUrl, `/api/maps/${mapId}/locations`, {
      userId: "player-a",
      lat: 37.7749,
      lng: -122.4194,
      ts: Date.now(),
    }, authHeaders(TOKENS.playerA));
    assert.strictEqual(notJoinedLocation.response.status, 409, "expected locations to reject non-joined player");

    const join = await postJson(baseUrl, `/api/maps/${mapId}/players/join`, {
      userId: "player-a",
      username: "player-a",
    }, authHeaders(TOKENS.playerA));
    assert.ok(
      join.response.status === 200 || join.response.status === 201,
      "expected join to succeed"
    );

    // Case 1: joined but unspawned player can submit locations; accepted with no territory/path state.
    const unspawnedJoin = await postJson(baseUrl, `/api/maps/${unspawnedMapId}/players/join`, {
      userId: "player-unspawned",
      username: "player-unspawned",
    }, authHeaders(TOKENS.unspawned));
    assert.ok(
      unspawnedJoin.response.status === 200 || unspawnedJoin.response.status === 201,
      "expected join to succeed for unspawned-map case"
    );
    const unspawnedLocation = await postJson(baseUrl, `/api/maps/${unspawnedMapId}/locations`, {
      userId: "player-unspawned",
      lat: 37.776,
      lng: -122.418,
      ts: Date.now(),
    }, authHeaders(TOKENS.unspawned));
    assert.strictEqual(
      unspawnedLocation.response.status,
      202,
      "expected joined but unspawned location to be accepted"
    );
    assert.strictEqual(unspawnedLocation.json?.accepted, 1, "expected accepted=1 for unspawned location");
    const unspawnedState = await getJson(baseUrl, `/api/maps/${unspawnedMapId}/state`);
    assert.strictEqual(unspawnedState.response.status, 200, "expected joined map state to exist");
    const unspawnedPlayer = unspawnedState.json?.players?.find((p) => p.userId === "player-unspawned");
    assert.ok(unspawnedPlayer, "expected joined player in unspawned map state");
    assert.strictEqual(unspawnedPlayer.territory, null, "expected no territory before explicit respawn");
    assert.strictEqual(unspawnedPlayer.path, null, "expected no path before explicit respawn");

    // Case 2: respawn fails with 404 for non-joined player.
    const respawnNotJoined = await postJson(
      baseUrl,
      `/api/maps/${missingJoinMapId}/players/player-never-joined/respawn`,
      { lat: 37.7749, lng: -122.4194 },
      authHeaders(TOKENS.missingJoin)
    );
    assert.strictEqual(respawnNotJoined.response.status, 404, "expected respawn to fail for non-joined player");
    assert.strictEqual(respawnNotJoined.json?.error, "player_not_joined", "expected player_not_joined error");

    // Case 3: mixed-identity /locations batch is rejected under auth-bound identity rules.
    const mixedJoin = await postJson(baseUrl, `/api/maps/${mixedBatchMapId}/players/join`, {
      userId: "player-joined",
      username: "player-joined",
    }, authHeaders(TOKENS.joined));
    assert.ok(
      mixedJoin.response.status === 200 || mixedJoin.response.status === 201,
      "expected join to succeed for mixed-batch case"
    );
    const mixedBatch = await postJson(baseUrl, `/api/maps/${mixedBatchMapId}/locations`, [
      {
        userId: "player-joined",
        lat: 37.7,
        lng: -122.4,
        ts: Date.now(),
      },
      {
        userId: "different-user",
        lat: 37.71,
        lng: -122.41,
        ts: Date.now() + 1,
      },
    ], authHeaders(TOKENS.joined));
    assert.strictEqual(mixedBatch.response.status, 403, "expected mixed identity batch to be rejected");
    assert.strictEqual(mixedBatch.json?.error, "identity_mismatch", "expected identity_mismatch error");

    // Case 4: spoofed body identity is rejected and does not mutate victim identity.
    const spoofJoin = await postJson(baseUrl, `/api/maps/${spoofMapId}/players/join`, {
      userId: "victim-user",
      username: "victim-user",
    }, authHeaders(TOKENS.victim));
    assert.ok(
      spoofJoin.response.status === 200 || spoofJoin.response.status === 201,
      "expected spoof-map join to succeed"
    );
    const spoofedLocation = await postJson(baseUrl, `/api/maps/${spoofMapId}/locations`, {
      userId: "victim-user",
      username: "spoofed-name",
      lat: 37.78,
      lng: -122.42,
      ts: Date.now(),
    }, authHeaders(TOKENS.attacker));
    assert.strictEqual(
      spoofedLocation.response.status,
      403,
      "expected spoofed identity update to be rejected"
    );
    assert.strictEqual(spoofedLocation.json?.error, "identity_mismatch", "expected identity_mismatch error");
    const spoofState = await getJson(baseUrl, `/api/maps/${spoofMapId}/state`);
    assert.strictEqual(spoofState.response.status, 200, "expected spoof-map state to exist");
    const spoofedPlayer = spoofState.json?.players?.find((p) => p.userId === "victim-user");
    assert.ok(spoofedPlayer, "expected spoof target player in state");
    assert.strictEqual(
      spoofedPlayer.username,
      "victim-user",
      "expected spoof target username to remain unchanged after rejected spoof"
    );

    const respawnMissingSpawn = await postJson(baseUrl, `/api/maps/${mapId}/players/player-a/respawn`, {}, authHeaders(TOKENS.playerA));
    assert.strictEqual(respawnMissingSpawn.response.status, 409, "expected respawn to require spawn point for new ghost");

    const seed = await postJson(baseUrl, `/api/maps/${mapId}/players/player-a/respawn`, {
      lat: 37.7749,
      lng: -122.4194,
    }, authHeaders(TOKENS.playerA));
    assert.strictEqual(seed.response.status, 200, "expected map respawn seed to succeed");

    const wrongPassword = await postJson(baseUrl, `/api/maps/${mapId}/reset`, { password: "wrong" }, authHeaders());
    assert.strictEqual(wrongPassword.response.status, 403, "expected invalid reset password rejection");

    const stillExists = await getJson(baseUrl, `/api/maps/${mapId}/state`);
    assert.strictEqual(stillExists.response.status, 200, "expected map state to remain after failed reset");

    const ssePromise = waitForResetSse(baseUrl, mapId, TOKENS.observer);
    await sleep(100);

    const reset = await postJson(baseUrl, `/api/maps/${mapId}/reset`, { password: "test-reset-password" }, authHeaders());
    assert.strictEqual(reset.response.status, 200, "expected reset to succeed with correct password");
    assert.strictEqual(reset.json?.ok, true, "expected reset response ok=true");
    assert.strictEqual(reset.json?.cleared, true, "expected first reset to clear existing map");

    const sseText = await ssePromise;
    assert.ok(sseText.includes("event: reset"), "expected reset SSE event");
    assert.ok(sseText.includes(`\"mapId\":\"${mapId}\"`), "expected reset SSE payload to include mapId");

    const clearedState = await getJson(baseUrl, `/api/maps/${mapId}/state`);
    assert.strictEqual(clearedState.response.status, 404, "expected state endpoint to return not found after reset");

    const secondReset = await postJson(baseUrl, `/api/maps/${mapId}/reset`, { password: "test-reset-password" }, authHeaders());
    assert.strictEqual(secondReset.response.status, 200, "expected second reset to be idempotent");
    assert.strictEqual(secondReset.json?.cleared, false, "expected second reset cleared=false");

    clearMapState(mapId);
    clearMapState(unspawnedMapId);
    clearMapState(mixedBatchMapId);
    clearMapState(spoofMapId);
    clearMapState(missingJoinMapId);
    console.log("Map reset route tests passed.");
  } catch (err) {
    clearMapState(mapId);
    clearMapState(unspawnedMapId);
    clearMapState(mixedBatchMapId);
    clearMapState(spoofMapId);
    clearMapState(missingJoinMapId);
    console.error("Map reset route tests failed:");
    console.error(err);
    process.exitCode = 1;
  } finally {
    if (server) {
      await stopServer(server);
    }
  }
})();
