// tests/auth.integration.test.js
const { execSync } = require('child_process');
const assert = require('assert');
const path = require('path');
const dotenv = require('dotenv');
const { startCloudSqlProxy } = require('./helpers/cloudsqlProxy');

console.log('Running auth integration tests (real DB)...');

// Load environment variables from a nearby .env (prefers repo root ../../.env).
const envCandidates = [
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../.env'),
  path.resolve(process.cwd(), '.env'),
];
for (const candidate of envCandidates) {
  const result = dotenv.config({ path: candidate });
  if (!result.error) {
    break;
  }
}

const maybeStartProxy = async () => {
  if (process.env.CLOUDSQL_AUTOSTART_PROXY !== 'true') {
    return null;
  }

  const connectionName = process.env.CLOUDSQL_CONNECTION_NAME;
  const credentialsFile = process.env.CLOUDSQL_CREDENTIALS;
  const socketDir = process.env.CLOUDSQL_SOCKET_DIR || '/tmp/cloudsql';

  if (!connectionName || !credentialsFile) {
    throw new Error('CLOUDSQL_CONNECTION_NAME and CLOUDSQL_CREDENTIALS are required to autostart proxy');
  }

  const absoluteCreds = path.isAbsolute(credentialsFile)
    ? credentialsFile
    : path.join(process.cwd(), credentialsFile);

  const { stop, socketPath } = await startCloudSqlProxy({
    connectionName,
    credentialsFile: absoluteCreds,
    socketDir,
  });

  // Force the app to use the proxy socket for this run.
  process.env.DB_SOCKET_PATH = socketPath;
  delete process.env.DB_HOST;
  delete process.env.DB_PORT;

  return stop;
};

const run = async () => {
  const email = `integration-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const username = 'test-runner';
  let createdUserId;
  let stopProxy;
  let pool;

  try {
    stopProxy = await maybeStartProxy();

    // Ensure dist output is current so imports use the latest code.
    try {
      execSync('npm run build --silent', { stdio: 'inherit' });
    } catch (err) {
      console.error('Failed to build backend before integration tests:', err);
      process.exit(1);
    }

    const requiredEnv = ['DB_USER', 'DB_PASSWORD', 'DB_NAME'];
    const missingEnv = requiredEnv.filter((key) => !process.env[key]);
    if (missingEnv.length > 0) {
      console.error(
        `Missing required DB env vars: ${missingEnv.join(', ')}. ` +
        'Set them (or a .env) so the DB client can connect.',
      );
      process.exit(1);
    }

    // Load env (side effect) before importing dbclient/authService compiled output.
    require('../dist/config/env.js'); // eslint-disable-line @typescript-eslint/no-var-requires
    const { registerUser, authenticateUser } = require('../dist/services/authService.js');
    const { findUserByEmail } = require('../dist/db/queries.js');
    const poolModule = require('../dist/db/dbclient.js');
    pool = poolModule.default || poolModule;

    const registered = await registerUser(username, email);
    createdUserId = registered.id;
    assert.strictEqual(registered.email, email, 'Registered user should echo email');
    assert.ok(Number.isFinite(createdUserId), 'New user should have an id');

    const fetched = await findUserByEmail(email);
    assert.ok(fetched, 'User should persist in DB');
    assert.strictEqual(fetched.id, createdUserId, 'Fetched user should match created id');

    const loggedIn = await authenticateUser(email, username);
    assert.strictEqual(loggedIn.id, createdUserId, 'Auth should return the same user');

    let duplicateError;
    try {
      await registerUser(username, email);
    } catch (err) {
      duplicateError = err;
    }
    assert.ok(duplicateError, 'Duplicate registration should throw');
    assert.strictEqual(duplicateError.status, 409, 'Duplicate registration should set 409 status');

    console.log('Auth integration tests passed (DB connection verified).');

  } catch (err) {
    console.error('Auth integration tests failed:', err);
    process.exitCode = 1;
  } finally {
    if (pool) {
      await cleanup(pool, email);
      if (typeof pool.end === 'function') {
        await pool.end();
      }
    }
    if (stopProxy) {
      stopProxy();
    }
  }
};

const cleanup = async (pool, email) => {
  try {
    await pool.execute('DELETE FROM users WHERE email = ?', [email]);
  } catch (cleanupErr) {
    console.warn('Cleanup skipped/failed:', cleanupErr?.message ?? cleanupErr);
  }
};

run().catch((err) => {
  console.error('Auth integration tests failed (unhandled):', err);
  process.exitCode = 1;
});
