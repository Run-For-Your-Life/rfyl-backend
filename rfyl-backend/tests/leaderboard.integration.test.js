const assert = require("assert");
const { execSync } = require("child_process");
const path = require("path");
const dotenv = require("dotenv");

console.log("Running leaderboard integration test (local DB)...");

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

require("../dist/config/env.js");
const poolModule = require("../dist/db/dbclient.js");
const pool = poolModule.default || poolModule;
const {
  getMapLeaderboard,
  getGlobalLeaderboard,
  getMapLeaderboardForUser,
  getGlobalLeaderboardForUser,
} = require("../dist/db/leaderboard.js");

const runId = Date.now();
const mapIdLocal = `lb-map-local-${runId}`;
const mapIdOther = `lb-map-other-${runId}`;
const seededUserIds = [];

async function insertUser(username, email) {
  const [result] = await pool.execute(
    "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)",
    [username, email, "test-password-hash"]
  );
  seededUserIds.push(result.insertId);
  return result.insertId;
}

async function insertTerritory(ownerId, mapId, area) {
  await pool.execute(
    `INSERT INTO territories (owner_id, map_id, polygon, area_m2)
     VALUES (?, ?, ST_GeomFromText('POLYGON((0 0, 0 1, 1 1, 1 0, 0 0))'), ?)`,
    [ownerId, mapId, area]
  );
}

async function run() {
  let userA;
  let userB;
  let userC;

  try {
    await pool.execute("INSERT INTO map_sessions (id, status) VALUES (?, 'active')", [mapIdLocal]);
    await pool.execute("INSERT INTO map_sessions (id, status) VALUES (?, 'active')", [mapIdOther]);

    userA = await insertUser(`lb-a-${runId}`, `lb-a-${runId}@example.com`);
    userB = await insertUser(`lb-b-${runId}`, `lb-b-${runId}@example.com`);
    userC = await insertUser(`lb-c-${runId}`, `lb-c-${runId}@example.com`);

    // Local map totals:
    // A: 300, C: 200, B: 100
    await insertTerritory(userA, mapIdLocal, 300);
    await insertTerritory(userB, mapIdLocal, 100);
    await insertTerritory(userC, mapIdLocal, 200);

    // Extra map adds to global totals:
    // A: +50 => 350
    // B: +500 => 600
    await insertTerritory(userA, mapIdOther, 50);
    await insertTerritory(userB, mapIdOther, 500);

    const localTop = await getMapLeaderboard(mapIdLocal, 10);
    assert.strictEqual(localTop.length, 3, "expected 3 local leaderboard rows");
    assert.strictEqual(localTop[0].userId, userA, "expected local rank 1 = userA");
    assert.strictEqual(localTop[0].totalAreaM2, 300, "expected local total for userA");
    assert.strictEqual(localTop[0].rank, 1, "expected local rank 1");
    assert.strictEqual(localTop[1].userId, userC, "expected local rank 2 = userC");
    assert.strictEqual(localTop[1].totalAreaM2, 200, "expected local total for userC");
    assert.strictEqual(localTop[1].rank, 2, "expected local rank 2");
    assert.strictEqual(localTop[2].userId, userB, "expected local rank 3 = userB");
    assert.strictEqual(localTop[2].totalAreaM2, 100, "expected local total for userB");
    assert.strictEqual(localTop[2].rank, 3, "expected local rank 3");

    const globalTop = await getGlobalLeaderboard(10);
    assert.ok(globalTop.length >= 3, "expected at least 3 global leaderboard rows");
    assert.strictEqual(globalTop[0].userId, userB, "expected global rank 1 = userB");
    assert.strictEqual(globalTop[0].totalAreaM2, 600, "expected global total for userB");
    assert.strictEqual(globalTop[1].userId, userA, "expected global rank 2 = userA");
    assert.strictEqual(globalTop[1].totalAreaM2, 350, "expected global total for userA");
    assert.strictEqual(globalTop[2].userId, userC, "expected global rank 3 = userC");
    assert.strictEqual(globalTop[2].totalAreaM2, 200, "expected global total for userC");

    const localUserB = await getMapLeaderboardForUser(mapIdLocal, userB);
    assert.ok(localUserB, "expected map-specific user rank row");
    assert.strictEqual(localUserB.rank, 3, "expected userB local rank to be 3");

    const globalUserC = await getGlobalLeaderboardForUser(userC);
    assert.ok(globalUserC, "expected global user rank row");
    assert.strictEqual(globalUserC.rank, 3, "expected userC global rank to be 3");

    console.log("Leaderboard integration test passed.");
  } catch (err) {
    console.error("Leaderboard integration test failed:");
    console.error(err);
    process.exitCode = 1;
  } finally {
    try {
      await pool.execute("DELETE FROM territories WHERE map_id IN (?, ?)", [mapIdLocal, mapIdOther]);
      await pool.execute("DELETE FROM map_sessions WHERE id IN (?, ?)", [mapIdLocal, mapIdOther]);
      if (seededUserIds.length > 0) {
        await pool.query(
          `DELETE FROM users WHERE id IN (${seededUserIds.map(() => "?").join(", ")})`,
          seededUserIds
        );
      }
      if (typeof pool.end === "function") {
        await pool.end();
      }
    } catch (cleanupErr) {
      console.warn("Cleanup skipped/failed:", cleanupErr?.message ?? cleanupErr);
    }
  }
}

void run();
