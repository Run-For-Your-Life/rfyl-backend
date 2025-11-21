# Running integration tests with Cloud SQL

The auth integration test will read your `.env` automatically (tries `../../.env`, then `../.env`, then local `.env`). If your `.env` has the DB settings, you don’t need to export them manually.

## Prereqs
- `cloud-sql-proxy` binary on PATH (v2).
- Service account JSON with `cloudsql.client` at a readable path (not committed).
- `.env` containing at least: `DB_USER`, `DB_PASSWORD`, `DB_NAME`, and either `DB_SOCKET_PATH` or `DB_HOST`/`DB_PORT`. If you want the test to auto-start the proxy, you’ll also set a few proxy-specific envs (see below).

## Quick run (proxy already running)
1. Start the proxy yourself (socket or TCP) and point your `.env` at it (`DB_SOCKET_PATH` or `DB_HOST`/`DB_PORT`).
2. From `rfyl-backend/rfyl-backend`:
   ```bash
   npm run build
   node tests/auth.integration.test.js
   ```

## Auto-start the proxy inside the test (Unix socket)
Set these in your shell (or add to a local env file that’s loaded):
```bash
export CLOUDSQL_AUTOSTART_PROXY=true
export CLOUDSQL_CONNECTION_NAME="ceremonial-tea-477623-h6:us-west1:run-for-your-life-2025"
export CLOUDSQL_CREDENTIALS="/absolute/path/to/service-account.json"
export CLOUDSQL_SOCKET_DIR="/tmp/cloudsql"   
```
Ensure your `.env` has `DB_USER`, `DB_PASSWORD`, `DB_NAME` (the test loads it automatically). Then run:
```bash
npm run build
node tests/auth.integration.test.js
```

The test will:
- Load `.env`.
- Build the app.
- Start the Cloud SQL proxy (if `CLOUDSQL_AUTOSTART_PROXY=true`), set `DB_SOCKET_PATH`, and clear `DB_HOST`/`DB_PORT`.
- Exercise register/login against the real DB.
- Clean up the inserted user and close the pool/proxy.

If the proxy fails to start because the socket already exists, remove the stale socket (e.g., `rm /tmp/cloudsql/<connection-name>`) or stop the prior proxy process before rerunning.
