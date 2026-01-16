Realtime rules

Week Start/Respawn:
    If player has no territory -> they are a ghost that can be seen but cannot knock or be knocked. They are given a respawn button which immediately establishes a 3x3m square that cannot be captured until the ghost becomes a player.
As a Ghost:
    Ghosts must establish 750m^2 of territory before respawning as players.
    If Ghost path exceeds 400m -> become vulnerable to knockouts by other players.
    The 3x3m square becomes capturable when the ghost respawns as a player or exceeds 400m in path.

Player states
- Ghost (invulnerable): can be seen; cannot knock or be knocked; 3x3m square is protected.
- Ghost (vulnerable): path length > 400m; can be knocked; 3x3m square is capturable.
- Player: once ghost has >= 750m^2 territory and respawns; normal rules apply.

If point is inside territory:
    If isOutside is false -> just update lastPoint.
    If isOutside is true && path != null -> path closed. Build a polygon from path + boundary segment, then union(territory, newPoly). Reset path, set isOutside = false.
If point is outside territory:
    If isOutside is false -> they just started a run. Snap the last inside point to the closest point on the territory perimeter, then start the path with snapped point + current point, set isOutside = true.
    If isOutside is true -> append point to path.
On every new segment, check for line intersections:
    If it intersects any other player’s active path -> knock out that player; clear their path, keep territory.
    If it intersects your own path (self-cross) -> knock out self; clear your path, keep territory.
    If it crosses a territory boundary? (optional depending on your rules)
    Polygon construction when loop closes

Turf calls
- union: turf.union(existingTerritory, capturedPolygon)
- difference: turf.difference(otherTerritory, capturedPolygon)
- Be ready for MultiPolygon results; normalize back to Polygon or keep as MultiPolygon for rendering.

Need boundary segment from the exit point to the re-entry point along the territory perimeter.
Build polygon: pathLine + boundarySegmentLine -> close ring -> polygonize.
union(territory, newPolygon) -> new territory for the capturing player.
For other players, subtract the new polygon from their territories (difference) so you can eat into or fully encompass them. Crossing into another player's territory has no immediate effect; subtraction happens only when a path closes.

Boundary selection rule:
    Prefer the perimeter segment that yields the smaller area when combined with the path.
    If tie or ambiguity -> fall back to the segment that does not intersect the path line.
    Rationale: the other segment mostly re-captures your existing territory, but can over-capture and incorrectly subtract from opponents.

Geometry ops:
    booleanPointInPolygon (inside check)
    lineIntersect (path collisions)
    lineSplit or manual boundary segment extraction
    polygonize or manual ring building
    union (merge territories)
    A stable coordinate system: use lat/lng but be aware distances in feet won’t be linear.

Snapping:
    When a player first leaves territory, snap the last inside point to the closest point on the territory perimeter.
    - Convert territory polygon to a LineString (boundary).
    - Find the nearest point on that boundary to the last inside point.
    - Start the path from that snapped point so the loop closes cleanly.

API endpoint(s)
    POST /api/maps/:mapId/locations continues to accept point updates.
    POST /api/maps/:mapId/players/:userId/respawn marks an eligible ghost as a player.

SSE stream should send:
    path updates while outside
    territory update only when loop closes
    knockout events
