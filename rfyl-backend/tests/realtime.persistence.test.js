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
const persistedTerritoryBatches = [];
const persistedKnockoutBatches = [];

const fakeWriters = {
  insertRealtimeEvents: async (events) => {
    persistedEventsBatches.push(events);
  },
  upsertMapSnapshots: async (snapshots) => {
    persistedSnapshotsBatches.push(snapshots);
  },
  syncMapTerritories: async (snapshots) => {
    persistedTerritoryBatches.push(snapshots);
  },
  syncKnockouts: async (knockouts) => {
    if (knockouts.length > 0) {
      persistedKnockoutBatches.push(knockouts);
    }
  },
};

const makeSnapshot = (mapId, userId, territory = null, territoryAreaSqMeters = 0) => ({
  mapId,
  players: [
    {
      userId,
      isOutside: false,
      territory,
      path: null,
      ghostState: "runner",
      ghostEligible: false,
      pathLengthMeters: 0,
      territoryAreaSqMeters,
    },
  ],
});

(async () => {
  try {
    __setRealtimePersistenceWritersForTest(fakeWriters);

    const mapId = "persist-map";
    const territory = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
      },
      properties: { userId: "player-1", updatedAt: Date.now() },
    };
    const event = {
      type: "state",
      mapId,
      userId: "player-1",
      ghostState: "runner",
      ghostEligible: false,
      pathLengthMeters: 12,
      territoryAreaSqMeters: 34,
    };

    appendRealtimeWal(mapId, [event], makeSnapshot(mapId, "player-1", territory, 34));

    await flushRealtimeWalNow();
    assert.ok(fs.existsSync(walPath), "expected WAL file to be created");
    const walLines = fs
      .readFileSync(walPath, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0);
    assert.strictEqual(walLines.length, 1, "expected one WAL batch line");

    assert.strictEqual(persistedEventsBatches.length, 1, "expected one flushed event batch");
    assert.strictEqual(persistedSnapshotsBatches.length, 1, "expected one flushed snapshot batch");
    assert.strictEqual(persistedTerritoryBatches.length, 1, "expected one flushed territory batch");
    assert.strictEqual(persistedKnockoutBatches.length, 0, "expected no knockout batch for state event");
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
      persistedTerritoryBatches[0][0].mapId,
      mapId,
      "expected territory snapshot map id"
    );
    assert.strictEqual(
      persistedTerritoryBatches[0][0].replaceAll,
      false,
      "expected normal territory sync to be incremental"
    );
    assert.strictEqual(
      persistedTerritoryBatches[0][0].territories[0].ownerUid,
      "player-1",
      "expected territory owner uid"
    );
    assert.strictEqual(
      persistedTerritoryBatches[0][0].territories[0].areaM2,
      34,
      "expected territory area to match snapshot"
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
    assert.strictEqual(
      persistedTerritoryBatches.length,
      1,
      "expected territory sync to no-op when cursor is at end"
    );
    assert.strictEqual(
      persistedKnockoutBatches.length,
      0,
      "expected knockout sync to no-op when cursor is at end"
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
    assert.strictEqual(persistedTerritoryBatches.length, 2, "expected second territory batch to flush");
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

    const knockoutEvent = {
      type: "knockout",
      mapId,
      userId: "victim-1",
      username: "victim-1",
      byUserId: "attacker-1",
      byUsername: "attacker-1",
      reason: "path-cross",
    };

    appendRealtimeWal(mapId, [knockoutEvent], makeSnapshot(mapId, "victim-1"));

    await flushRealtimeWalNow();
    assert.strictEqual(persistedEventsBatches.length, 3, "expected knockout event batch to flush");
    assert.strictEqual(persistedKnockoutBatches.length, 1, "expected one knockout batch");
    assert.strictEqual(
      persistedKnockoutBatches[0][0].victimUid,
      "victim-1",
      "expected persisted victim uid"
    );
    assert.strictEqual(
      persistedKnockoutBatches[0][0].attackerUid,
      "attacker-1",
      "expected persisted attacker uid"
    );
    assert.strictEqual(
      persistedKnockoutBatches[0][0].reason,
      "path-cross",
      "expected persisted knockout reason"
    );
    assert.ok(
      typeof persistedKnockoutBatches[0][0].sourceEventId === "string" &&
        persistedKnockoutBatches[0][0].sourceEventId.length > 0,
      "expected persisted source event id"
    );

    const resetEvent = {
      type: "reset",
      mapId,
      userId: "system",
      username: "system",
      reason: "manual",
    };

    appendRealtimeWal(mapId, [resetEvent], { mapId, players: [] });
    await flushRealtimeWalNow();
    assert.strictEqual(persistedTerritoryBatches.length, 4, "expected reset territory batch");
    assert.strictEqual(
      persistedTerritoryBatches[3][0].replaceAll,
      true,
      "expected reset to request full territory replacement"
    );
    assert.strictEqual(
      persistedTerritoryBatches[3][0].territories.length,
      0,
      "expected reset snapshot to clear map territories"
    );
    assert.strictEqual(
      fs.readFileSync(cursorPath, "utf8").trim(),
      "4",
      "expected cursor to advance to 4"
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
