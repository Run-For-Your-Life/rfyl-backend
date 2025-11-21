// Lightweight helper to start/stop the Cloud SQL Auth Proxy for tests.
// Requires the `cloud-sql-proxy` binary on PATH.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const shouldLogProxy = process.env.CLOUDSQL_PROXY_DEBUG === 'true';

const waitForReady = (proc, timeoutMs = 10000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timed out waiting for Cloud SQL Proxy to start'));
    }, timeoutMs);

    let lastStderr = '';

    const onData = (data) => {
      const text = data.toString();
      if (shouldLogProxy) {
        process.stdout.write(`[cloud-sql-proxy] ${text}`);
      }
      if (text.toLowerCase().includes('ready for new connections')) {
        clearTimeout(timer);
        proc.stdout.off('data', onData);
        proc.stderr.off('data', onStderr);
        resolve();
      }
    };

    const onStderr = (data) => {
      const text = data.toString();
      lastStderr = text;
      if (shouldLogProxy) {
        process.stderr.write(`[cloud-sql-proxy] ${text}`);
      }
    };

    proc.stdout.on('data', onData);
    proc.stderr.on('data', onStderr);
    proc.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Cloud SQL Proxy exited early with code ${code}${lastStderr ? `: ${lastStderr.trim()}` : ''}`));
    });
    proc.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

/**
 * Start the Cloud SQL Proxy and return a stopper function.
 * @param {object} options
 * @param {string} options.connectionName Full instance connection name.
 * @param {string} options.credentialsFile Path to service account JSON.
 * @param {string} options.socketDir Directory to place the Unix socket.
 */
const startCloudSqlProxy = async ({ connectionName, credentialsFile, socketDir }) => {
  ensureDir(socketDir);

  const args = [
    '--credentials-file',
    credentialsFile,
    '--unix-socket',
    socketDir,
    connectionName,
  ];

  const proc = spawn('cloud-sql-proxy', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await waitForReady(proc);

  const socketPath = path.join(socketDir, connectionName);

  return {
    stop: () => proc.kill('SIGINT'),
    socketPath,
  };
};

module.exports = { startCloudSqlProxy };
