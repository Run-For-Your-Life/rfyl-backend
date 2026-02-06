# Frontend Realtime Integration

This doc explains how the frontend should connect to the realtime map API and render
territory/path updates in MapTiler.

## Endpoints

### 1) Send location updates
`POST /api/maps/:mapId/locations`

Body (single or array):
```json
{
  "userId": "player-123",
  "lat": 37.7749,
  "lng": -122.4194,
  "ts": 1700000000000,
  "accuracy": 6
}
```

Response:
```json
{ "received": 1, "accepted": 1 }
```

Notes:
- Send one update per second.
- `ts` is milliseconds since epoch.
- `accuracy` is optional; server ignores noisy points.

### 2) Subscribe to realtime events (SSE)
`GET /api/maps/:mapId/stream`

SSE event types:
- `path` – active path LineString for a player
- `territory` – player territory Polygon/MultiPolygon
- `state` – ghost state/metrics updates
- `knockout` – knockout event

### 3) Snapshot (initial load)
`GET /api/maps/:mapId/state`

Returns current state for all players, so a new client can render immediately before
listening to SSE events.

### 4) Respawn (ghost -> player)
`POST /api/maps/:mapId/players/:userId/respawn`

Returns `{ ok: true }` when the player is eligible to respawn.

## Recommended frontend flow

1) **Initial load**
   - Call `GET /api/maps/:mapId/state`.
   - Render all `territory` polygons and any active `path` lines.

2) **Subscribe to SSE**
   - Open an `EventSource` to `/api/maps/:mapId/stream`.
   - For each event:
     - `path`: update or create a LineString feature for `userId`.
     - `territory`: update or create Polygon/MultiPolygon feature for `userId`.
     - `state`: update UI badges (ghost/vulnerable/player).
     - `knockout`: clear that player's path, show UI feedback.

3) **Send location updates**
   - POST the user's location every second.
   - If user goes offline, pause updates and reconnect SSE.

4) **Respawn**
   - When ghost becomes eligible, show a respawn button.
   - On click, call the respawn endpoint and wait for a `state` event confirming player status.

## MapTiler rendering approach

Use two GeoJSON sources:
- `territories` (Polygon/MultiPolygon)
- `paths` (LineString)

Each feature has:
```json
{
  "type": "Feature",
  "geometry": { ... },
  "properties": { "userId": "...", "updatedAt": 1700000000000 }
}
```

Update logic:
- Use `userId` as a stable feature ID.
- On `territory` event: replace that user's feature.
- On `path` event: replace that user's path feature.
- On `knockout`: remove that user's path feature.

Suggested styling:
- Territory fill: Hash the userID for unique color.
- Territory outline: same color, higher opacity.
- Path line: bright, thicker line (higher z-index).

## Example SSE handling (frontend)
```js
const es = new EventSource(`/api/maps/${mapId}/stream`);

es.addEventListener("path", (event) => {
  const payload = JSON.parse(event.data);
  updatePathFeature(payload.userId, payload.path);
});

es.addEventListener("territory", (event) => {
  const payload = JSON.parse(event.data);
  updateTerritoryFeature(payload.userId, payload.territory);
});

es.addEventListener("state", (event) => {
  const payload = JSON.parse(event.data);
  updateGhostStateUI(payload.userId, payload.ghostState);
});

es.addEventListener("knockout", (event) => {
  const payload = JSON.parse(event.data);
  clearPathFeature(payload.userId);
});
```

## Error handling & reconnect
- Reconnect on SSE errors (e.g. exponential backoff).
- If SSE reconnects, re-fetch `/state` to avoid missed updates.
- If location POST fails, queue a small backlog (last 5–10 points) and retry.

## Payload examples

### `territory`
```json
{
  "type": "territory",
  "mapId": "week-2025-10-05",
  "userId": "player-123",
  "territory": {
    "type": "Feature",
    "geometry": {
      "type": "MultiPolygon",
      "coordinates": [[[[-122.42,37.77], ... ]]]
    },
    "properties": { "userId": "player-123", "updatedAt": 1700000000000 }
  }
}
```

### `path`
```json
{
  "type": "path",
  "mapId": "week-2025-10-05",
  "userId": "player-123",
  "path": {
    "type": "Feature",
    "geometry": { "type": "LineString", "coordinates": [[-122.42,37.77], ...] },
    "properties": { "userId": "player-123", "updatedAt": 1700000000000 }
  }
}
```

### `state`
```json
{
  "type": "state",
  "mapId": "week-2025-10-05",
  "userId": "player-123",
  "ghostState": "ghost_vulnerable",
  "ghostEligible": true,
  "pathLengthMeters": 522.1,
  "territoryAreaSqMeters": 825.0
}
```

### `knockout`
```json
{
  "type": "knockout",
  "mapId": "week-2025-10-05",
  "userId": "player-456",
  "byUserId": "player-123",
  "reason": "path-cross"
}
```
