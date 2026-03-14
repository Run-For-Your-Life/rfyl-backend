const assert = require("assert");
const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const dotenv = require("dotenv");

console.log("Running realtime persistence integration test (local DB)...");

const envCandidates = [
  path.resolve(__dirname, "../../.env.local"),
  path.resolve(__dirname, "../../.env"),
];

for (const candidate of envCandidates) {
  const result = dotenv.config({ path: candidate });
  if (!result.error) {
    break;
  }
}

const required = ["DB_USER", "DB_PASSWORD", "DB_NAME"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing DB env vars for integration test: ${missing.join(", ")}`);
  process.exit(1);
}

execSync("npm run build --silent", { stdio: "inherit" });

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rfyl-persist-int-"));
const walPath = path.join(tempDir, "realtime-events.jsonl");
const cursorPath = path.join(tempDir, "realtime-events.cursor");
const mapId = `persist-int-${Date.now()}`;
const ownerUid = `player-int-${Date.now()}`;
const attackerUid = `attacker-int-${Date.now()}`;

process.env.REALTIME_WAL_PATH = walPath;
process.env.REALTIME_WAL_CURSOR_PATH = cursorPath;
process.env.REALTIME_WAL_MAX_BATCHES = "200";

require("../dist/config/env.js");
const poolModule = require("../dist/db/dbclient.js");
const pool = poolModule.default || poolModule;
const { appendRealtimeWal, flushRealtimeWalNow } = require("../dist/services/realtimePersistence.js");

const assertCurrentSchema = async () => {
  const [usernameRows] = await pool.query(
    "SELECT 1 AS present FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'username' LIMIT 1"
  );
  if (usernameRows.length === 0) {
    throw new Error("users.username is required by current schema");
  }

  const [ownerUidRows] = await pool.query(
    "SELECT 1 AS present FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'territories' AND column_name = 'owner_uid' LIMIT 1"
  );
  if (ownerUidRows.length === 0) {
    throw new Error("territories.owner_uid is required by current schema");
  }

  const [rows] = await pool.query(
    "SELECT 1 AS present FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'knockouts' LIMIT 1"
  );
  if (rows.length === 0) {
    throw new Error("knockouts table is required by current schema");
  }
};

const makeSnapshot = () => ({
  mapId,
  players: [
    {
      userId: ownerUid,
      isOutside: false,
      territory: {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
        },
        properties: {
          userId: ownerUid,
          updatedAt: Date.now(),
        },
      },
      path: null,
      ghostState: "player",
      ghostEligible: false,
      pathLengthMeters: 0,
      territoryAreaSqMeters: 34,
    },
  ],
});

const stateEvent = {
  type: "state",
  mapId,
  userId: ownerUid,
  ghostState: "player",
  ghostEligible: false,
  pathLengthMeters: 12,
  territoryAreaSqMeters: 34,
};

const knockoutEvent = {
  type: "knockout",
  mapId,
  userId: ownerUid,
  username: ownerUid,
  byUserId: attackerUid,
  byUsername: attackerUid,
  reason: "path-cross",
};

const run = async () => {
  try {
    await assertCurrentSchema();
    await pool.execute("INSERT INTO users (firebase_uid, username) VALUES (?, ?)", [ownerUid, ownerUid]);
    await pool.execute("INSERT INTO users (firebase_uid, username) VALUES (?, ?)", [attackerUid, attackerUid]);

    appendRealtimeWal(mapId, [stateEvent, knockoutEvent], makeSnapshot());
    await flushRealtimeWalNow();

    const [eventRows] = await pool.query(
      "SELECT event_id, map_id, event_type FROM realtime_events WHERE map_id = ?",
      [mapId]
    );
    const [snapshotRows] = await pool.query(
      "SELECT map_id, last_event_id FROM realtime_map_snapshots WHERE map_id = ?",
      [mapId]
    );
    const [territoryRows] = await pool.query(
      `SELECT owner_uid AS owner_uid, map_id, area_m2, ST_AsGeoJSON(polygon) AS polygon_json, ST_GeometryType(polygon) AS geometry_type
       FROM territories
       WHERE map_id = ? AND owner_uid = ?`,
      [mapId, ownerUid]
    );
    const [knockoutRows] = await pool.query(
      "SELECT source_event_id, map_id, victim_uid, attacker_uid, reason FROM knockouts WHERE map_id = ? AND victim_uid = ? AND attacker_uid = ?",
      [mapId, ownerUid, attackerUid]
    );

    assert.ok(eventRows.length >= 1, "expected persisted realtime event row");
    assert.strictEqual(eventRows[0].map_id, mapId, "expected event map_id match");
    assert.strictEqual(eventRows[0].event_type, "state", "expected event_type state");
    assert.strictEqual(snapshotRows.length, 1, "expected one snapshot row");
    assert.strictEqual(snapshotRows[0].map_id, mapId, "expected snapshot map_id match");
    assert.ok(
      typeof snapshotRows[0].last_event_id === "string" && snapshotRows[0].last_event_id.length > 0,
      "expected snapshot last_event_id"
    );
    assert.strictEqual(territoryRows.length, 1, "expected one materialized territory row");
    assert.strictEqual(territoryRows[0].owner_uid, ownerUid, "expected territory owner uid match");
    assert.strictEqual(territoryRows[0].map_id, mapId, "expected territory map_id match");
    assert.strictEqual(Number(territoryRows[0].area_m2), 34, "expected territory area from snapshot");
    const polygonJson = territoryRows[0].polygon_json;
    const geometryType = territoryRows[0].geometry_type;
    const hasPolygonViaGeoType =
      typeof geometryType === "string" &&
      (geometryType.toUpperCase().includes("POLYGON") || geometryType.toUpperCase().includes("ST_POLYGON"));
    const hasPolygonViaJsonString =
      typeof polygonJson === "string" && polygonJson.toLowerCase().includes("polygon");
    const hasPolygonViaJsonObject =
      polygonJson && typeof polygonJson === "object" && String(polygonJson.type || "").toLowerCase() === "polygon";
    assert.ok(
      hasPolygonViaGeoType || hasPolygonViaJsonString || hasPolygonViaJsonObject,
      "expected territory polygon geometry"
    );
    assert.strictEqual(knockoutRows.length, 1, "expected one materialized knockout row");
    assert.strictEqual(knockoutRows[0].map_id, mapId, "expected knockout map_id match");
    assert.strictEqual(knockoutRows[0].victim_uid, ownerUid, "expected knockout victim uid");
    assert.strictEqual(knockoutRows[0].attacker_uid, attackerUid, "expected knockout attacker uid");
    assert.strictEqual(knockoutRows[0].reason, "path-cross", "expected knockout reason");
    assert.ok(
      typeof knockoutRows[0].source_event_id === "string" && knockoutRows[0].source_event_id.length > 0,
      "expected knockout source_event_id for idempotency"
    );

    console.log("Realtime persistence integration test passed.");
  } catch (err) {
    console.error("Realtime persistence integration test failed:");
    console.error(err);
    process.exitCode = 1;
  } finally {
    try {
      await pool.execute("DELETE FROM knockouts WHERE map_id = ?", [mapId]);
      await pool.execute("DELETE FROM territories WHERE map_id = ?", [mapId]);
      await pool.execute("DELETE FROM realtime_events WHERE map_id = ?", [mapId]);
      await pool.execute("DELETE FROM realtime_map_snapshots WHERE map_id = ?", [mapId]);
      await pool.execute("DELETE FROM map_sessions WHERE id = ?", [mapId]);
      await pool.execute("DELETE FROM users WHERE firebase_uid = ?", [ownerUid]);
      await pool.execute("DELETE FROM users WHERE firebase_uid = ?", [attackerUid]);
      if (typeof pool.end === "function") {
        await pool.end();
      }
    } catch (cleanupErr) {
      console.warn("Cleanup skipped/failed:", cleanupErr?.message ?? cleanupErr);
    }

    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

void run();
