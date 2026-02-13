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

process.env.REALTIME_WAL_PATH = walPath;
process.env.REALTIME_WAL_CURSOR_PATH = cursorPath;
process.env.REALTIME_WAL_MAX_BATCHES = "200";

require("../dist/config/env.js");
const poolModule = require("../dist/db/dbclient.js");
const pool = poolModule.default || poolModule;
const { appendRealtimeWal, flushRealtimeWalNow } = require("../dist/services/realtimePersistence.js");

const makeSnapshot = () => ({
  mapId,
  players: [
    {
      userId: "player-int",
      isOutside: false,
      territory: null,
      path: null,
      ghostState: "player",
      ghostEligible: false,
      pathLengthMeters: 0,
      territoryAreaSqMeters: 0,
    },
  ],
});

const stateEvent = {
  type: "state",
  mapId,
  userId: "player-int",
  ghostState: "player",
  ghostEligible: false,
  pathLengthMeters: 12,
  territoryAreaSqMeters: 34,
};

const run = async () => {
  try {
    appendRealtimeWal(mapId, [stateEvent], makeSnapshot());
    await flushRealtimeWalNow();

    const [eventRows] = await pool.query(
      "SELECT event_id, map_id, event_type FROM realtime_events WHERE map_id = ?",
      [mapId]
    );
    const [snapshotRows] = await pool.query(
      "SELECT map_id, last_event_id FROM realtime_map_snapshots WHERE map_id = ?",
      [mapId]
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

    console.log("Realtime persistence integration test passed.");
  } catch (err) {
    console.error("Realtime persistence integration test failed:");
    console.error(err);
    process.exitCode = 1;
  } finally {
    try {
      await pool.execute("DELETE FROM realtime_events WHERE map_id = ?", [mapId]);
      await pool.execute("DELETE FROM realtime_map_snapshots WHERE map_id = ?", [mapId]);
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
