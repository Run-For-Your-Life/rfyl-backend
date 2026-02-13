# RFYL Backend Test Architecture

## Test suites

- `npm test`
  - Fast default suite.
  - Includes smoke+build+structure+auth integration, realtime logic tests, and map reset route tests.
  - Does NOT spin up Docker services

- `npm run test:integration:db`
  - Starts local MySQL with Docker Compose.
  - Runs DB-backed realtime persistence integration test
  - Stops local MySQL at the end.

- `npm run test:all`
  - Runs `npm test`
  - Then runs `npm run test:integration:db`

## Local DB-backed testing

From `rfyl-backend/rfyl-backend`:
```bash
npm run test:integration:db
```

Manual local DB flow:
```bash
npm run db:local:up
//do tests
npm run db:local:down
```

Notes:
- Local DB config comes from `.env.local`
- You need the MySQL compose file: `rfyl-backend/docker-compose.local-db.yml`

## Cloud SQL auth integration test

`tests/auth.integration.test.js` can run against Cloud SQL and optionally autostart `cloud-sql-proxy`.

Prereqs:
- `cloud-sql-proxy` available on PATH.
- Service account with `cloudsql.client`.
- Repo-root `.env` configured with DB credentials.

Optional envs for proxy autostart:
```bash
export CLOUDSQL_AUTOSTART_PROXY=true
export CLOUDSQL_CONNECTION_NAME="ceremonial-tea-477623-h6:us-west1:run-for-your-life-2025"
export CLOUDSQL_CREDENTIALS="/absolute/path/to/service-account.json"
export CLOUDSQL_SOCKET_DIR="/tmp/cloudsql"
```

Run:
```bash
npm run build
node tests/auth.integration.test.js
```
