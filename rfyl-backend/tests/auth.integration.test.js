// tests/auth.integration.test.js
const { execSync } = require('child_process');
const assert = require('assert');
const path = require('path');
const dotenv = require('dotenv');
const { startCloudSqlProxy } = require('./helpers/cloudsqlProxy');

console.log('Running auth integration tests (real DB)...');

const envCandidates = [
  process.env.ENV_FILE ? path.resolve(process.cwd(), process.env.ENV_FILE) : null,
  path.resolve(__dirname, '../../.env.local'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../.env.local'),
  path.resolve(__dirname, '../.env'),
  path.resolve(process.cwd(), '.env'),
].filter(Boolean);
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

  process.env.DB_SOCKET_PATH = socketPath;
  delete process.env.DB_HOST;
  delete process.env.DB_PORT;

  return stop;
};

const run = async () => {
  const firebaseUid = `integration-firebase-uid-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let stopProxy;
  let pool;
  let schemaReady = false;

  try {
    stopProxy = await maybeStartProxy();

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
          'Set them (or a .env) so the DB client can connect.'
      );
      process.exit(1);
    }

    require('../dist/config/env.js'); // eslint-disable-line @typescript-eslint/no-var-requires
    const { ensureUserByFirebaseUid } = require('../dist/services/authService.js');
    const poolModule = require('../dist/db/dbclient.js');
    pool = poolModule.default || poolModule;

    await assertUsersSchema(pool);
    schemaReady = true;

    const first = await ensureUserByFirebaseUid(firebaseUid);
    assert.strictEqual(first.firebaseUid, firebaseUid, 'expected synced UID to match');
    assert.strictEqual(first.created, true, 'expected first ensure call to create user');

    const second = await ensureUserByFirebaseUid(firebaseUid);
    assert.strictEqual(second.firebaseUid, firebaseUid, 'expected same UID on re-sync');
    assert.strictEqual(second.created, false, 'expected second ensure call to be idempotent');

    const [[row]] = await pool.query(
      'SELECT firebase_uid, username FROM users WHERE firebase_uid = ? LIMIT 1',
      [firebaseUid]
    );
    assert.ok(row, 'expected synced user row to exist');
    assert.strictEqual(row.firebase_uid, firebaseUid, 'expected DB row UID to match');
    assert.ok(typeof row.username === 'string' && row.username.length > 0, 'expected username to be persisted');

    console.log('Auth integration tests passed (Firebase UID sync verified).');
  } catch (err) {
    console.error('Auth integration tests failed:', err);
    process.exitCode = 1;
  } finally {
    if (pool && schemaReady) {
      await cleanup(pool, firebaseUid);
    }
    if (pool) {
      if (typeof pool.end === 'function') {
        await pool.end();
      }
    }
    if (stopProxy) {
      stopProxy();
    }
  }
};

const cleanup = async (pool, firebaseUid) => {
  try {
    await pool.execute('DELETE FROM users WHERE firebase_uid = ?', [firebaseUid]);
  } catch (cleanupErr) {
    console.warn('Cleanup skipped/failed:', cleanupErr?.message ?? cleanupErr);
  }
};

const assertUsersSchema = async (pool) => {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'users'`
  );
  const columns = new Set(rows.map((row) => row.COLUMN_NAME));
  const missing = ['firebase_uid', 'username'].filter((name) => !columns.has(name));
  if (missing.length > 0) {
    throw new Error(
      `users table schema is outdated; missing columns: ${missing.join(', ')}. ` +
        'Apply the firebase_uid schema/migration before running auth integration tests.'
    );
  }
};

run().catch((err) => {
  console.error('Auth integration tests failed (unhandled):', err);
  process.exitCode = 1;
});
