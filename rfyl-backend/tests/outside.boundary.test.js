const assert = require("assert");
const { execSync } = require("child_process");
const express = require("express");

console.log("Running out-of-bounds locations test...");

execSync("npm run build --silent", { stdio: "inherit" });

const { createMapsRouter } = require("../dist/routes/maps/index.js");
const { MAP_BOUNDS } = require("../dist/routes/maps/bounds.js");
const { clearMapState } = require("../dist/services/realtimeEngine.js");

const TOKENS = {
  player: "token-player-a",
};

const tokenIdentity = {
  [TOKENS.player]: { uid: "player-a", name: "player-a" },
};

const mapsRouter = createMapsRouter({
  verifyIdToken: async (token) => {
    const decoded = tokenIdentity[token];
    if (!decoded) {
      throw new Error("invalid test token");
    }
    return decoded;
  },
  resolveUsername: async (decoded) => {
    if (typeof decoded.name === "string" && decoded.name.trim().length > 0) {
      return decoded.name.trim();
    }
    return decoded.uid;
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

function authHeaders(token = TOKENS.player) {
  return {
    Authorization: `Bearer ${token}`,
  };
}

(async () => {
  let server;
  const mapId = `bounds-${Date.now()}`;

  try {
    const started = await startServer();
    server = started.server;
    const baseUrl = started.baseUrl;

    const join = await postJson(
      baseUrl,
      `/api/maps/${mapId}/players/join`,
      { userId: "player-a" },
      authHeaders()
    );
    assert.ok(join.response.status === 200 || join.response.status === 201, "expected join to succeed");

    const midLat = (MAP_BOUNDS.north + MAP_BOUNDS.south) / 2;
    const midLng = (MAP_BOUNDS.east + MAP_BOUNDS.west) / 2;
    const respawn = await postJson(
      baseUrl,
      `/api/maps/${mapId}/players/player-a/respawn`,
      { lat: midLat, lng: midLng },
      authHeaders()
    );
    assert.strictEqual(respawn.response.status, 200, "expected in-bounds respawn to succeed");

    const before = await getJson(baseUrl, `/api/maps/${mapId}/state`);
    assert.strictEqual(before.response.status, 200, "expected map state before out-of-bounds");
    const beforePlayer = before.json?.players?.find((p) => p.userId === "player-a");
    assert.ok(beforePlayer, "expected player in state before out-of-bounds");
    const beforeLastPoint = beforePlayer.lastPoint;

    const outsideLat = MAP_BOUNDS.north + 0.01;
    const outOfBounds = await postJson(
      baseUrl,
      `/api/maps/${mapId}/locations`,
      { userId: "player-a", lat: outsideLat, lng: midLng, ts: Date.now() },
      authHeaders()
    );
    assert.strictEqual(outOfBounds.response.status, 422, "expected out-of-bounds location to be rejected");
    assert.strictEqual(outOfBounds.json?.error, "out_of_bounds", "expected out_of_bounds error");

    const after = await getJson(baseUrl, `/api/maps/${mapId}/state`);
    assert.strictEqual(after.response.status, 200, "expected map state after out-of-bounds");
    const afterPlayer = after.json?.players?.find((p) => p.userId === "player-a");
    assert.ok(afterPlayer, "expected player in state after out-of-bounds");
    assert.deepStrictEqual(afterPlayer.lastPoint, beforeLastPoint, "expected lastPoint unchanged");

    clearMapState(mapId);
    console.log("Out-of-bounds locations test passed.");
  } catch (err) {
    clearMapState(mapId);
    console.error("Out-of-bounds locations test failed:");
    console.error(err);
    process.exitCode = 1;
  } finally {
    if (server) {
      await stopServer(server);
    }
  }
})();
