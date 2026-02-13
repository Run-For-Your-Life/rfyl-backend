const assert = require("assert");
const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

console.log("Running realtime persistence tests...");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rfyl-realtime-persist-"));
const walPath = path.join(tempDir, "realtime-events.jsonl");
const cursorPath = path.join(tempDir, "realtime-events.cursor");

process.env.REALTIME_WAL_PATH = walPath;
process.env.REALTIME_WAL_CURSOR_PATH = cursorPath;
process.env.REALTIME_WAL_MAX_BATCHES = "1";

execSync("npm run build --silent", { stdio: "inherit" });

const {
  appendRealtimeWal,
  flushRealtimeWalNow,
  __setRealtimePersistenceWritersForTest,
} = require("../dist/services/realtimePersistence.js");

const persistedEventsBatches = [];
const persistedSnapshotsBatches = [];

const fakeWriters = {
  insertRealtimeEvents: async (events) => {
    persistedEventsBatches.push(events);
  },
  upsertMapSnapshots: async (snapshots) => {
    persistedSnapshotsBatches.push(snapshots);
  },
};

const makeSnapshot = (mapId, userId) => ({
  mapId,
  players: [
    {
      userId,
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

(async () => {
  try {
    __setRealtimePersistenceWritersForTest(fakeWriters);

    const mapId = "persist-map";
    const event = {
      type: "state",
      mapId,
      userId: "player-1",
      ghostState: "player",
      ghostEligible: false,
      pathLengthMeters: 12,
      territoryAreaSqMeters: 34,
    };

    appendRealtimeWal(mapId, [event], makeSnapshot(mapId, "player-1"));

    await flushRealtimeWalNow();
    assert.ok(fs.existsSync(walPath), "expected WAL file to be created");
    const walLines = fs
      .readFileSync(walPath, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0);
    assert.strictEqual(walLines.length, 1, "expected one WAL batch line");

    assert.strictEqual(persistedEventsBatches.length, 1, "expected one flushed event batch");
    assert.strictEqual(persistedSnapshotsBatches.length, 1, "expected one flushed snapshot batch");
    assert.strictEqual(persistedEventsBatches[0].length, 1, "expected one persisted event");
    assert.strictEqual(
      persistedEventsBatches[0][0].eventType,
      "state",
      "expected persisted event type"
    );
    assert.strictEqual(
      persistedSnapshotsBatches[0][0].mapId,
      mapId,
      "expected snapshot map id"
    );
    assert.strictEqual(
      fs.readFileSync(cursorPath, "utf8").trim(),
      "1",
      "expected cursor to advance to 1"
    );

    await flushRealtimeWalNow();
    assert.strictEqual(
      persistedEventsBatches.length,
      1,
      "expected second flush to no-op when cursor is at end"
    );

    const secondEvent = {
      type: "path",
      mapId,
      userId: "player-2",
      path: {
        type: "Feature",
        geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
        properties: { userId: "player-2", updatedAt: Date.now() },
      },
    };

    appendRealtimeWal(mapId, [secondEvent], makeSnapshot(mapId, "player-2"));

    await flushRealtimeWalNow();
    assert.strictEqual(persistedEventsBatches.length, 2, "expected second WAL batch to flush");
    assert.strictEqual(
      persistedEventsBatches[1][0].eventType,
      "path",
      "expected second persisted event type"
    );
    assert.strictEqual(
      fs.readFileSync(cursorPath, "utf8").trim(),
      "2",
      "expected cursor to advance to 2"
    );

    __setRealtimePersistenceWritersForTest(null);
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log("Realtime persistence tests passed.");
  } catch (err) {
    __setRealtimePersistenceWritersForTest(null);
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.error("Realtime persistence tests failed:");
    console.error(err);
    process.exit(1);
  }
})();
