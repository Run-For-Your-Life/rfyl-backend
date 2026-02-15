const assert = require("assert");
const { execSync } = require("child_process");
const http = require("http");
const express = require("express");

console.log("Running map reset route tests...");

const resetWalBase = `/tmp/rfyl-map-reset-${Date.now()}`;
process.env.REALTIME_WAL_PATH = `${resetWalBase}.jsonl`;
process.env.REALTIME_WAL_CURSOR_PATH = `${resetWalBase}.cursor`;

execSync("npm run build --silent", { stdio: "inherit" });

const mapsRouter = require("../dist/routes/maps/index.js").default;
const { clearMapState } = require("../dist/services/realtimeEngine.js");

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
  const response = await fetch(`${baseUrl}${path}`);
  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { response, json };
}

function waitForResetSse(baseUrl, mapId, timeoutMs = 3500) {
  return new Promise((resolve, reject) => {
    const url = new URL(`/api/maps/${mapId}/stream`, baseUrl);
    const req = http.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "GET",
        headers: { Accept: "text/event-stream" },
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  let server;
  const mapId = `reset-map-${Date.now()}`;

  try {
    const started = await startServer();
    server = started.server;
    const baseUrl = started.baseUrl;

    delete process.env.MAP_RESET_PASSWORD;
    const disabled = await postJson(baseUrl, `/api/maps/${mapId}/reset`, { password: "x" });
    assert.strictEqual(disabled.response.status, 503, "expected reset endpoint to be disabled when MAP_RESET_PASSWORD is missing");

    process.env.MAP_RESET_PASSWORD = "test-reset-password";

    const notJoinedLocation = await postJson(baseUrl, `/api/maps/${mapId}/locations`, {
      userId: "player-a",
      lat: 37.7749,
      lng: -122.4194,
      ts: Date.now(),
    });
    assert.strictEqual(notJoinedLocation.response.status, 409, "expected locations to reject non-joined player");

    const join = await postJson(baseUrl, `/api/maps/${mapId}/players/join`, {
      userId: "player-a",
      username: "player-a",
    });
    assert.ok(
      join.response.status === 200 || join.response.status === 201,
      "expected join to succeed"
    );

    const respawnMissingSpawn = await postJson(baseUrl, `/api/maps/${mapId}/players/player-a/respawn`, {});
    assert.strictEqual(respawnMissingSpawn.response.status, 409, "expected respawn to require spawn point for new ghost");

    const seed = await postJson(baseUrl, `/api/maps/${mapId}/players/player-a/respawn`, {
      lat: 37.7749,
      lng: -122.4194,
    });
    assert.strictEqual(seed.response.status, 200, "expected map respawn seed to succeed");

    const wrongPassword = await postJson(baseUrl, `/api/maps/${mapId}/reset`, { password: "wrong" });
    assert.strictEqual(wrongPassword.response.status, 403, "expected invalid reset password rejection");

    const stillExists = await getJson(baseUrl, `/api/maps/${mapId}/state`);
    assert.strictEqual(stillExists.response.status, 200, "expected map state to remain after failed reset");

    const ssePromise = waitForResetSse(baseUrl, mapId);
    await sleep(100);

    const reset = await postJson(baseUrl, `/api/maps/${mapId}/reset`, { password: "test-reset-password" });
    assert.strictEqual(reset.response.status, 200, "expected reset to succeed with correct password");
    assert.strictEqual(reset.json?.ok, true, "expected reset response ok=true");
    assert.strictEqual(reset.json?.cleared, true, "expected first reset to clear existing map");

    const sseText = await ssePromise;
    assert.ok(sseText.includes("event: reset"), "expected reset SSE event");
    assert.ok(sseText.includes(`\"mapId\":\"${mapId}\"`), "expected reset SSE payload to include mapId");

    const clearedState = await getJson(baseUrl, `/api/maps/${mapId}/state`);
    assert.strictEqual(clearedState.response.status, 404, "expected state endpoint to return not found after reset");

    const secondReset = await postJson(baseUrl, `/api/maps/${mapId}/reset`, { password: "test-reset-password" });
    assert.strictEqual(secondReset.response.status, 200, "expected second reset to be idempotent");
    assert.strictEqual(secondReset.json?.cleared, false, "expected second reset cleared=false");

    clearMapState(mapId);
    console.log("Map reset route tests passed.");
  } catch (err) {
    clearMapState(mapId);
    console.error("Map reset route tests failed:");
    console.error(err);
    process.exitCode = 1;
  } finally {
    if (server) {
      await stopServer(server);
    }
  }
})();
