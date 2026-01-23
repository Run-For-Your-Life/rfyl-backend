// tests/auth.jwt.test.js
const assert = require("assert");
const { execSync } = require("child_process");
const jwt = require("jsonwebtoken");

console.log("Running auth JWT middleware test...");

try {
  execSync("npm run build --silent", { stdio: "inherit" });
} catch (err) {
  console.error("Failed to build backend before JWT middleware test:", err);
  process.exit(1);
}

const { requireAuth } = require("../dist/middleware/auth/requireAuth.js");

const makeRes = () => {
  const res = {
    statusCode: undefined,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  return res;
};

const runMiddleware = (req) => {
  const res = makeRes();
  let nextCalled = false;

  requireAuth(req, res, () => {
    nextCalled = true;
  });

  return { res, nextCalled };
};

try {
  process.env.JWT_SECRET = "test-secret";

  let { res, nextCalled } = runMiddleware({ headers: {} });
  assert.strictEqual(nextCalled, false, "Missing auth header should not call next");
  assert.strictEqual(res.statusCode, 401);
  assert.deepStrictEqual(res.body, { error: "Missing Authorization: Bearer <token>" });

  ({ res, nextCalled } = runMiddleware({
    headers: { authorization: "Bearer not-a-token" },
  }));
  assert.strictEqual(nextCalled, false, "Invalid token should not call next");
  assert.strictEqual(res.statusCode, 401);
  assert.deepStrictEqual(res.body, { error: "Invalid or expired token" });

  const tokenMissingId = jwt.sign(
    { email: "runner@example.com" },
    process.env.JWT_SECRET
  );
  ({ res, nextCalled } = runMiddleware({
    headers: { authorization: `Bearer ${tokenMissingId}` },
  }));
  assert.strictEqual(nextCalled, false, "Token without id should not call next");
  assert.strictEqual(res.statusCode, 401);
  assert.deepStrictEqual(res.body, { error: "Invalid or expired token" });

  delete process.env.JWT_SECRET;
  ({ res, nextCalled } = runMiddleware({
    headers: { authorization: "Bearer token" },
  }));
  assert.strictEqual(nextCalled, false, "Missing secret should not call next");
  assert.strictEqual(res.statusCode, 500);
  assert.deepStrictEqual(res.body, { error: "JWT_SECRET not configured" });

  process.env.JWT_SECRET = "test-secret";
  const token = jwt.sign(
    { id: 123, email: "runner@example.com" },
    process.env.JWT_SECRET
  );
  const req = { headers: { authorization: `Bearer ${token}` } };
  ({ res, nextCalled } = runMiddleware(req));
  assert.strictEqual(nextCalled, true, "Valid token should call next");
  assert.ok(req.user, "Valid token should attach user to request");
  assert.strictEqual(req.user.id, 123);
  assert.strictEqual(req.user.email, "runner@example.com");

  console.log("Auth JWT middleware test passed.");
} catch (err) {
  console.error("Auth JWT middleware test failed:");
  console.error(err);
  process.exit(1);
}
