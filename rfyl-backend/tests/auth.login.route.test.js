const assert = require("assert");
const { execSync } = require("child_process");
const express = require("express");

console.log("Running auth login route tests...");

execSync("npm run build --silent", { stdio: "inherit" });

const firebaseAdminModule = require("../dist/config/firebaseAdmin.js");
const authServiceModule = require("../dist/services/authService.js");
const { createAuthRouter } = require("../dist/routes/auth/index.js");

const originalVerifyIdToken = firebaseAdminModule.firebaseAuth.verifyIdToken.bind(
  firebaseAdminModule.firebaseAuth
);
const originalEnsureUserByFirebaseUid = authServiceModule.ensureUserByFirebaseUid;

const token_map = {
  "token-email-only": { uid: "uid-email-only", email: "suncon@oregonstate.edu" },
  "token-name": { uid: "uid-name", email: "name@example.com", name: "TokenName" },
  "token-no-fallback": { uid: "uid-no-fallback" },
};

firebaseAdminModule.firebaseAuth.verifyIdToken = async (idToken) => {
  const decoded = token_map[idToken];
  if (!decoded) {
    throw new Error("invalid token");
  }
  return decoded;
};

const ensure_calls = [];
authServiceModule.ensureUserByFirebaseUid = async (firebaseUid, preferredUsername) => {
  ensure_calls.push({ firebaseUid, preferredUsername });
  if (firebaseUid === "uid-no-fallback") {
    const error = new Error("username is required for new user sync");
    error.code = authServiceModule.USERNAME_REQUIRED_FOR_NEW_USER;
    throw error;
  }
  return {
    firebaseUid,
    username: preferredUsername || "fallback",
    createdAt: null,
    created: true,
  };
};

function startServer() {
  return new Promise((resolve, reject) => {
    const app = express();
    app.use(express.json());
    app.use("/api/auth", createAuthRouter());
    const server = app.listen(0, "127.0.0.1");
    server.once("error", (err) => reject(err));
    server.once("listening", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to obtain TCP address for auth test server"));
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
  try {
    const started = await startServer();
    server = started.server;
    const baseUrl = started.baseUrl;

    const missingToken = await postJson(baseUrl, "/api/auth/login", {});
    assert.strictEqual(missingToken.response.status, 400, "expected 400 without ID token");

    const emailFallback = await postJson(
      baseUrl,
      "/api/auth/login",
      {},
      authHeader("token-email-only")
    );
    assert.strictEqual(emailFallback.response.status, 200, "expected login success");
    assert.strictEqual(
      ensure_calls[0]?.preferredUsername,
      "suncon",
      "expected email local-part fallback for first-time sync"
    );

    const bodyUsernameWins = await postJson(
      baseUrl,
      "/api/auth/login",
      { username: "BodyName" },
      authHeader("token-name")
    );
    assert.strictEqual(bodyUsernameWins.response.status, 200, "expected login success with body username");
    assert.strictEqual(
      ensure_calls[1]?.preferredUsername,
      "BodyName",
      "expected body username to take precedence"
    );

    const noFallback = await postJson(
      baseUrl,
      "/api/auth/login",
      {},
      authHeader("token-no-fallback")
    );
    assert.strictEqual(
      noFallback.response.status,
      409,
      "expected 409 when no username source is available"
    );

    console.log("Auth login route tests passed.");
  } catch (error) {
    console.error("Auth login route tests failed:");
    console.error(error);
    process.exitCode = 1;
  } finally {
    firebaseAdminModule.firebaseAuth.verifyIdToken = originalVerifyIdToken;
    authServiceModule.ensureUserByFirebaseUid = originalEnsureUserByFirebaseUid;
    if (server) {
      await stopServer(server);
    }
  }
})();
