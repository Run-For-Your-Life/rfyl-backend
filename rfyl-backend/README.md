# RFYL Backend
## Handoff
- Start here for onboarding and operational context: `HANDOFF.md`

## Documentation
API info is held within Swagger UI. Invoke `npx tsc` to build the distribution app, then `npm run dev` to host it locally. You can find the page at localhost:{your env port}/api-docs and test the endpoints from there!  

## Local DB 
From `rfyl-backend/`:

- Start local MySQL:
  `npm run db:local:up`
- Stop local MySQL:
  `npm run db:local:down`
- Reset local MySQL volume and recreate schema from scratch:
  `npm run db:local:reset`
- Start backend with local env profile:
  `npm run dev:local`

If you hit local `Unknown column ...` errors after pulling backend changes, run:

```bash
npm run db:local:reset
npm run dev:local
```

Local profile reads `../.env.local`
Cloud profile reads `../.env`.

## Test commands
- `npm test`: fast default suite.
- `npm run test:integration:db`: starts local MySQL, runs DB-backed realtime persistence integration test, then stops MySQL.
- `npm run test:all`: runs `npm test` and then `npm run test:integration:db`.

## Manual map reset endpoint
Set `MAP_RESET_PASSWORD` in your env profile, then call:

```bash
curl -X POST "http://localhost:2000/api/maps/<mapId>/reset" \
  -H "Content-Type: application/json" \
  -d '{"password":"<MAP_RESET_PASSWORD>"}'
```

You can also pass the password via header: `x-map-reset-password`.

## Weekly territory reset
To wipe claimed territory every Monday, set these env vars in your backend env profile:

```bash
WEEKLY_TERRITORY_RESET_ENABLED=true
WEEKLY_TERRITORY_RESET_DAY=monday
WEEKLY_TERRITORY_RESET_HOUR=0
WEEKLY_TERRITORY_RESET_MINUTE=0
WEEKLY_TERRITORY_RESET_TZ=America/Los_Angeles
```

What this does:
- Deletes all rows from `territories`.
- Resets any currently active in-memory maps so live players lose claimed territory immediately.
- Broadcasts reset events for active maps using the existing realtime reset flow.

This only runs while the backend process is up.

## CloudSQL proxy command
cloud-sql-proxy \
  --credentials-file /absolute/path/to/ceremonial-tea-477623-h6-45d4b7b2d842.json \
  --unix-socket /tmp/cloudsql \
  ceremonial-tea-477623-h6:us-west1:run-for-your-life-2025
  
