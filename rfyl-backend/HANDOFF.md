# RFYL Backend Handoff

This document is the fast operational handoff for this backend.
Use this first, then go deeper into `REALTIME_DESIGN.md`, `FRONTEND_REALTIME_INTEGRATION.md`, and `TEST_README.md`.

## 1) Repo orientation

There are two levels in this repository:

- Root: `RFYL_Capstone/rfyl-backend` (contains top-level docs and env files).
- Service app: `RFYL_Capstone/rfyl-backend/rfyl-backend` (actual Node/TypeScript backend).

Most commands in this guide run from `rfyl-backend/rfyl-backend` unless noted.

## 2) First-day checklist

1. Install prerequisites:
- Node.js 20+
- npm
- Docker Desktop (for local MySQL and DB-backed tests)

2. Install deps:
```bash
cd rfyl-backend
npm install
```

3. Confirm env profile exists at repo root:
- `../.env.local` for local DB flow
- `../.env` for cloud profile

4. Start local DB + backend:
```bash
npm run db:local:up
npm run dev:local
```

5. Smoke test:
- Open Swagger at `http://localhost:2000/api-docs`
- Run fast tests: `npm test`

## 3) Env loading behavior

Env loading is implemented in `src/config/env.ts`.

Lookup precedence:
1. `ENV_FILE` (if set)
2. `ENV_PROFILE` variants
3. `.env.local`, `../.env.local`, `.env`, `../.env`
4. Default dotenv behavior

Critical required vars for boot:
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`

Important optional vars:
- `DB_HOST` / `DB_PORT` (TCP)
- `DB_SOCKET_PATH` (Cloud SQL socket mode)
- `ALLOWED_ORIGINS` (CORS allowlist)
- `MAP_RESET_PASSWORD` (enables manual map reset route)
- `REALTIME_WAL_*` (WAL persistence tuning)
- `MATCHMAKING_*` (queue scheduling tuning)
- `WEEKLY_TERRITORY_RESET_*` (scheduled reset)

Firebase auth vars:
- Preferred: `FIREBASE_CREDENTIALS` (JSON string or path)
- Fallback triplet: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`

## 4) Runtime architecture map

### HTTP entrypoint
- `src/index.ts`
- Mounts routers for auth, profile, leaderboard, matchmaking, maps
- Starts background services on boot:
  - realtime WAL flusher
  - matchmaking maintenance sweeper
  - weekly territory reset scheduler

### Core gameplay flow
- `src/routes/maps/handlers/locations.ts`
- `src/services/realtimeEngine.ts`
- `src/services/realtimeGeometry.ts`
- `src/services/realtimeStream.ts`

Lifecycle:
1. Player joins map: `POST /api/maps/:mapId/players/join`
2. Player spawns/respawns: `POST /api/maps/:mapId/players/:userId/respawn`
3. Client pushes locations: `POST /api/maps/:mapId/locations`
4. Server emits SSE events on `/stream`
5. Snapshot fetch via `/state`

Important constraints:
- All map routes require Firebase bearer token or session cookie.
- `userId` in request body must match authenticated Firebase UID.
- Location/respawn points are rejected if outside `MAP_BOUNDS` (`422 out_of_bounds`).
- Map capacity is 10 users (`map_full`).

### Auth + identity mapping
- `src/routes/auth/*`
- `src/services/authService.ts`
- `src/services/authIdentityCache.ts`

Firebase does authentication. Backend maintains app user rows in `users` table by `firebase_uid`.
If token is valid but user row is missing, protected map routes return `403 user_not_registered`.

### Matchmaking
- `src/routes/matchmaking/index.ts`
- `src/services/mapMatchmaking.ts`

`POST /api/matchmaking/me` either:
- returns `202 queued`, or
- returns `200 assigned` with map id

Default policy:
- Preferred map size: 5
- Hard cap: 10
- Queue flush timeout: 45s
- Stale queue eviction: 15m

Map IDs are generated as:
`<MATCHMADE_MAP_PREFIX>-<cycle-key>-NNN`.

### Persistence model (realtime)
- `src/services/realtimePersistence.ts`
- `src/db/realtimeStateStore.ts`

Pattern:
1. Events + snapshots append to JSONL WAL (`./var/realtime-events.jsonl` by default)
2. Background flusher batches WAL into MySQL:
- `realtime_events`
- `realtime_map_snapshots`
- `territories`
- `knockouts`

This is intentionally resilient: gameplay can continue briefly through DB outages, then flush later.

### Scheduled weekly reset
- `src/services/weeklyTerritoryReset.ts`

When enabled, scheduler:
1. Deletes all rows from `territories`
2. Resets all active in-memory maps (broadcasts reset events)
3. Rolls matchmaking into a new weekly cycle key

Runs only while backend process is alive.

## 5) Data model (practical subset)

Schema file: `src/db/runforyourlife_db.sql`

Most used tables:
- `users`: app identity keyed by Firebase UID
- `territories`: current map claims (geometry + area/perimeter)
- `runs`: distance samples derived from accepted location segments
- `knockouts`: knockout event log
- `realtime_events`: append-only persisted event stream
- `realtime_map_snapshots`: latest snapshot per map
- `bug_report`: user-submitted issue reports

Note: local Docker init loads schema automatically from `runforyourlife_db.sql`.

## 6) Test matrix

From `rfyl-backend/rfyl-backend`:

- `npm test`
  - Fast/default suite, no Docker spin-up.
- `npm run test:integration:db`
  - Starts local MySQL, runs DB-backed integration tests, tears down.
- `npm run test:all`
  - Full local reset + fast + integration path.

Main default test runner file list: `scripts/run-tests.mjs`.

## 7) Runbooks

### Local schema drift or unknown column errors
```bash
npm run db:local:reset
npm run dev:local
```

### Realtime persistence appears stale
1. Check backend logs for `Realtime WAL flush failed`.
2. Check WAL files in `rfyl-backend/var/`:
- `realtime-events.jsonl`
- `realtime-events.cursor`
3. Verify MySQL connectivity/env (`DB_*`).
4. Restart backend to trigger clean flush cycle.

### Players get `user_not_registered`
1. Verify Firebase token is valid.
2. Hit `POST /api/auth/login` (or `/register`) with the same token.
3. Confirm `users.firebase_uid` row exists.

### `player_not_joined` during gameplay
Confirm frontend sequence:
1. Join player (`/players/join`)
2. Respawn with initial `{lat,lng}`
3. Start location posting

### Manual map reset endpoint disabled
Set `MAP_RESET_PASSWORD` in active env profile.
Without it, `/api/maps/:mapId/reset` returns `503`.

## 8) Where to change what

- Realtime gameplay rules: `src/services/realtimeEngine.ts` + geometry helpers
- Map auth behavior: `src/routes/maps/auth.ts`
- Matchmaking policy: `src/services/mapMatchmaking.ts`
- Map reset semantics: `src/services/mapResetService.ts` and weekly scheduler
- Leaderboard query behavior: `src/db/leaderboard.ts`, `src/routes/leaderboard/list.ts`
- Profile stats calculations: `src/routes/profile/stats.ts`
- Run distance recording: `src/routes/maps/handlers/locations.ts` + `src/db/runDistanceStore.ts`

## 9) Known sharp edges

- In-memory map state is process-local. Horizontal scaling needs shared-state strategy for live gameplay.
- Weekly reset and matchmaking rollover are process-timer based, not external cron jobs.
- If WAL flush is down for long periods, WAL file growth can spike disk usage.
- Map bounds are hardcoded to Corvallis-area coordinates in `src/routes/maps/bounds.ts`.

## 10) Additional docs

- `README.md` (service quickstart + commands)
- `TEST_README.md` (test architecture)
- `REALTIME_DESIGN.md` (engine behavior details)
- `FRONTEND_REALTIME_INTEGRATION.md` (client integration contract)
