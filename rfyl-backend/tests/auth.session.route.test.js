const assert = require("assert");
const { execSync } = require("child_process");
const express = require("express");

console.log("Running auth session route tests...");

execSync("npm run build --silent", { stdio: "inherit" });

const firebaseAdminPath = require.resolve("../dist/config/firebaseAdmin.js");
const tokenMap = {
  "token-valid": { uid: "uid-valid", email: "runner@example.com" },
};
const sessionCookieMap = {
  "session-cookie-valid": { uid: "uid-valid", email: "runner@example.com" },
};
const fakeFirebaseAuth = {
  verifyIdToken: async (idToken) => {
    const decoded = tokenMap[idToken];
    if (!decoded) {
      throw new Error("invalid token");
    }
    return decoded;
  },
  createSessionCookie: async (idToken) => {
    if (!tokenMap[idToken]) {
      throw new Error("invalid token");
    }
    return "session-cookie-valid";
  },
};

require.cache[firebaseAdminPath] = {
  id: firebaseAdminPath,
  filename: firebaseAdminPath,
  loaded: true,
  exports: {
    firebaseAuth: fakeFirebaseAuth,
    firebaseAdmin: { auth: () => fakeFirebaseAuth },
  },
};

const { createAuthRouter } = require("../dist/routes/auth/index.js");
const { createMapsRouter } = require("../dist/routes/maps/index.js");

function startServer() {
  return new Promise((resolve, reject) => {
    const app = express();
    app.use(express.json());
    app.use("/api/auth", createAuthRouter());
    app.use(
      "/api/maps",
      createMapsRouter({
        verifyIdToken: async (token) => {
          const decoded = tokenMap[token];
          if (!decoded) {
            throw new Error("invalid bearer token");
          }
          return decoded;
        },
        verifySessionCookie: async (sessionCookie) => {
          const decoded = sessionCookieMap[sessionCookie];
          if (!decoded) {
            throw new Error("invalid session cookie");
          }
          return decoded;
        },
        resolveUsername: async (decoded) => decoded.email.split("@")[0],
      })
    );

    const server = app.listen(0, "127.0.0.1");
    server.once("error", (err) => reject(err));
    server.once("listening", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to obtain TCP address for auth session test server"));
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

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

(async () => {
  let server;
  const mapId = `session-map-${Date.now()}`;

  try {
    const started = await startServer();
    server = started.server;
    const baseUrl = started.baseUrl;

    const sessionResponse = await postJson(
      baseUrl,
      "/api/auth/session",
      {},
      authHeader("token-valid")
    );
    assert.strictEqual(sessionResponse.response.status, 200, "expected session creation to succeed");

    const setCookie = sessionResponse.response.headers.get("set-cookie") || "";
    assert.ok(
      setCookie.includes("rfyl_session=session-cookie-valid"),
      "expected session cookie to contain the created session cookie"
    );
    assert.ok(
      !setCookie.includes("token-valid"),
      "expected raw ID token to stay out of the session cookie"
    );

    const joinWithCookie = await postJson(
      baseUrl,
      `/api/maps/${mapId}/players/join`,
      {},
      { Cookie: "rfyl_session=session-cookie-valid" }
    );
    assert.ok(
      joinWithCookie.response.status === 200 || joinWithCookie.response.status === 201,
      "expected map join to accept session cookie auth"
    );

    console.log("Auth session route tests passed.");
  } catch (error) {
    console.error("Auth session route tests failed:");
    console.error(error);
    process.exitCode = 1;
  } finally {
    delete require.cache[firebaseAdminPath];
    if (server) {
      await stopServer(server);
    }
  }
})();
