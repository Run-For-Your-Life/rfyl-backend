# Frontend Realtime Integration (Behavior Change)

This document describes the updated backend lifecycle for realtime map gameplay.

## Summary Of The Change

Old behavior:
- First `POST /locations` implicitly created the player and initial territory.

New behavior:
- Player must be explicitly registered with `POST /players/join`.
- Initial spawn territory is created only via `POST /players/:userId/respawn` with `{lat,lng}`.
- `POST /locations` now rejects non-joined players.

This change is required so frontend can support an explicit "Start Run" button.

## Required Frontend Sequence

1. Connect SSE stream.
2. Fetch current map snapshot.
3. Join player.
4. On Start Run button tap, get current GPS and call respawn with `{lat,lng}`.
5. Start sending periodic location updates.

You can do steps 1 and 2 in either order. If doing SSE first, keep events buffered until snapshot load completes.

## Endpoints

### 1) Join player
`POST /api/maps/:mapId/players/join`

Request:
```json
{
  "userId": "player-123",
  "username": "Connor"
}
```

Responses:
- `201` created:
```json
{ "ok": true, "mapId": "week-2026-02-15", "userId": "player-123", "created": true }
```
- `200` already existed:
```json
{ "ok": true, "mapId": "week-2026-02-15", "userId": "player-123", "created": false }
```

### 2) Respawn / Start Run spawn
`POST /api/maps/:mapId/players/:userId/respawn`

For initial spawn (required when player has no territory), include:
```json
{
  "lat": 37.7749,
  "lng": -122.4194
}
```

Responses:
- `200` success:
```json
{ "ok": true }
```
- `404` if player is not joined:
```json
{ "error": "player_not_joined" }
```
- `409` if not eligible or missing spawn point for initial spawn:
```json
{ "error": "player not eligible to respawn or missing spawn point" }
```
- `400` validation errors:
```json
{ "error": "lat and lng must be provided together" }
```

### 3) Send location updates
`POST /api/maps/:mapId/locations`

Request (single update or array):
```json
{
  "userId": "player-123",
  "username": "Connor",
  "lat": 37.7749,
  "lng": -122.4194,
  "ts": 1700000000000
}
```

Responses:
- `202` accepted:
```json
{ "received": 1, "accepted": 1, "rejectedNotJoined": 0 }
```
- `409` if all updates were from non-joined players:
```json
{
  "error": "player_not_joined",
  "received": 1,
  "accepted": 0,
  "rejectedNotJoined": 1
}
```

### 4) Snapshot
`GET /api/maps/:mapId/state`

Returns:
```json
{
  "mapId": "week-2026-02-15",
  "players": [
    {
      "userId": "player-123",
      "username": "Connor",
      "isOutside": false,
      "territory": null,
      "path": null,
      "ghostState": "ghost_invulnerable",
      "ghostEligible": false,
      "pathLengthMeters": 0,
      "territoryAreaSqMeters": 0
    }
  ]
}
```

### 5) Realtime stream
`GET /api/maps/:mapId/stream`

SSE event types:
- `ready`
- `path`
- `territory`
- `state`
- `knockout`
- `reset`

All gameplay events now include `username`.

## Frontend State Machine

Use this per-player local state:
- `not_joined`
- `joined_unspawned`
- `spawned_ghost`
- `active_player`

Transitions:
- `not_joined -> joined_unspawned`: successful `POST /players/join`
- `joined_unspawned -> spawned_ghost`: successful respawn with spawn `{lat,lng}`
- `spawned_ghost -> active_player`: server `state` event with `ghostState: "player"`
- `active_player -> joined_unspawned`: knockout then territory removed (via SSE updates)

## Rendering Rules

- Render territory from `territory` events and snapshot `players[].territory`.
- Render active path from `path` events and snapshot `players[].path`.
- Clear player path on:
  - `knockout` event for that user
  - `territory` update where loop closes and path disappears in subsequent state
- Keep color keyed by `userId`; label with `username`.

## Migration Checklist For Frontend

1. Add `joinPlayer(mapId, userId, username)` call on map entry.
2. Gate location posting until join succeeds.
3. Wire Start Run button to:
   - fetch current GPS
   - call respawn with `{lat,lng}`
   - only then start 1 Hz location updates
4. Handle `409 player_not_joined` from `/locations` by re-joining and retrying.
5. Update event handlers to read `username` from SSE payloads.

## Minimal Curl Flow

Join:
```bash
curl -X POST "http://localhost:2000/api/maps/dev-map/players/join" \
  -H "Content-Type: application/json" \
  -d '{"userId":"player-a","username":"Player A"}'
```

Start run spawn:
```bash
curl -X POST "http://localhost:2000/api/maps/dev-map/players/player-a/respawn" \
  -H "Content-Type: application/json" \
  -d '{"lat":37.7749,"lng":-122.4194}'
```

Send location:
```bash
curl -X POST "http://localhost:2000/api/maps/dev-map/locations" \
  -H "Content-Type: application/json" \
  -d '{"userId":"player-a","username":"Player A","lat":37.7750,"lng":-122.4195,"ts":1700000000000}'
```
