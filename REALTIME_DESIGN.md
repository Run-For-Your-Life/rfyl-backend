Realtime design

Overview
The realtime engine ingests point updates, tracks player state, builds capture polygons when
players leave and re-enter their own territory, and broadcasts SSE events for path/territory
updates and knockouts. This document reflects the current backend implementation in
rfyl-backend/src/services/realtimeEngine.ts and related geometry helpers.

Constants (units)
- GHOST_SPAWN_SIZE_METERS = 3 (initial square size, 3m x 3m)
- GHOST_VULNERABLE_PATH_METERS = 400 (ghost becomes vulnerable after path length >= 400m)
- GHOST_RESPAWN_AREA_SQ_METERS = 750 (ghost eligible to respawn after territory area >= 750 m^2)

Player states
- ghost_invulnerable: can be seen; cannot knock; cannot be knocked; immune to territory subtraction.
- ghost_vulnerable: can be seen; cannot knock; can be knocked; territory can be subtracted.
- runner: can knock; can be knocked; territory can be subtracted.

State model (per player)
- territory: GeoJSON Polygon or MultiPolygon feature
- path: array of GeoPoints (lat/lng/ts); rendered as LineString when length >= 2
- isOutside: whether the last point was outside territory
- ghostState, ghostEligible, pathLengthMeters, territoryAreaSqMeters
- lastPoint, lastInsidePoint (used for snapping)

Ingest flow (per location update)
- Create map + player if missing.
- On first point, create 3x3m square territory around the point and set ghost_invulnerable.
- If point is inside territory:
- If isOutside is true, close the path and capture territory.
- Update ghost metrics (area, eligibility) and emit state event for non-runner or after capture.
- If point is outside territory, extend the active path.

Leaving territory (start path)
- When a player first exits, snap the last inside point to the closest point on the territory boundary.
- Initialize path with [snappedPoint, currentPoint], set isOutside = true.
- Compute pathLengthMeters and update ghost vulnerability.
- Emit a path event. If non-runner ghost, emit a state event.

Outside territory (extend path)
- Append the new point to the path and increment pathLengthMeters using Haversine distance.
- Self-cross detection: if the new segment intersects the existing path (excluding the last segment),
  trigger knockout for that player, clear path, set isOutside = false, emit knockout + state.
- Path-cross detection: runners (not ghosts) can knock others whose active path intersects the new
  segment. Only runners with isOutside = true and ghostState != ghost_invulnerable can be knocked.
- On successful knockout, clear the victim path, set isOutside = false, emit knockout event
  (plus state event for non-runners).
- Emit a path event for the mover. If ghost, emit a state event.

Closing a path (capture)
- Triggered when a player re-enters their own territory with an active path.
- Build a capture polygon by:
- Splitting the territory outer ring at the exit and re-entry points.
- Choosing the boundary segment that yields the smaller capture area.
- Building a closed ring from path + chosen boundary segment.
- Union the captured polygon with the player territory.
- Emit territory + state events for the capturing player.
- Subtract the captured polygon from other players unless they are ghost_invulnerable.
- For each affected player, update territory and emit territory + state events.
- If subtraction yields null, territory is cleared and no territory event is emitted.
- Clear the capturing player path, reset isOutside = false and pathLengthMeters = 0.

Knockouts
- Knockout clears the path, sets isOutside = false, leaves territory unchanged.
- Reasons: self-cross, path-cross.
- The SSE event includes { userId, byUserId, reason }.

Geometry notes
- Inside test uses ray-cast against all polygon rings (holes are supported).
- Snapping uses the closest point on any ring segment.
- Boundary choice is the smaller-area option (no tie-breaker beyond that).
- Union/difference use @turf/union and @turf/difference; results may be MultiPolygon.
- Area is approximated using a planar conversion with latitude-adjusted meters per degree.

Realtime endpoints and events
- POST /api/maps/:mapId/locations accepts single or array point updates and broadcasts events.
- GET /api/maps/:mapId/stream is SSE; initial event is `ready` with { mapId }.
- GET /api/maps/:mapId/state returns the current snapshot of all players.
- POST /api/maps/:mapId/players/:userId/respawn reseeds an eliminated ghost if eligible.

SSE event types (payloads align with realtimeEngine RealtimeEvent)
- path: { mapId, userId, path: LineString feature }
- territory: { mapId, userId, territory: Polygon/MultiPolygon feature }
- state: { mapId, userId, ghostState, ghostEligible, pathLengthMeters, territoryAreaSqMeters }
- knockout: { mapId, userId, byUserId, reason }

Client expectations
- Render path updates while outside; clear on knockout.
- Render territory only on territory events (captured or subtracted).
- Use state events to update ghost/vulnerability/eligibility UI.
