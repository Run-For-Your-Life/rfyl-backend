const assert = require("assert");
const { execSync } = require("child_process");

console.log("Running realtime state-store tests...");

process.env.DB_USER = process.env.DB_USER || "rfyl_user";
process.env.DB_PASSWORD = process.env.DB_PASSWORD || "rfyl_local_password";
process.env.DB_NAME = process.env.DB_NAME || "runforyourlife_db";
process.env.DB_HOST = process.env.DB_HOST || "127.0.0.1";
process.env.DB_PORT = process.env.DB_PORT || "3307";

execSync("npm run build --silent", { stdio: "inherit" });

const dbclient = require("../dist/db/dbclient.js").default;
const { syncMapTerritories } = require("../dist/db/realtimeStateStore.js");

const originalQuery = dbclient.query.bind(dbclient);
const originalGetConnection = dbclient.getConnection.bind(dbclient);

const execute_calls = [];
const query_calls = [];

const mock_connection = {
  beginTransaction: async () => {},
  execute: async (sql, params) => {
    execute_calls.push({ sql: String(sql), params: Array.isArray(params) ? params : [] });
    return [[], []];
  },
  commit: async () => {},
  rollback: async () => {},
  release: () => {},
};

dbclient.query = async (sql, params) => {
  query_calls.push({ sql: String(sql), params: Array.isArray(params) ? params : [] });
  const sql_text = String(sql);
  if (sql_text.includes("SELECT firebase_uid FROM users")) {
    return [[{ firebase_uid: "known-user" }], []];
  }
  return [[], []];
};

dbclient.getConnection = async () => mock_connection;

const territory_geometry = JSON.stringify({
  type: "Polygon",
  coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
});

(async () => {
  try {
    await syncMapTerritories([
      {
        mapId: "map-state-store-test",
        updatedAt: new Date(),
        replaceAll: false,
        territories: [
          {
            ownerUid: "known-user",
            territoryGeoJson: territory_geometry,
            areaM2: 10,
            clearOnSync: false,
          },
          {
            ownerUid: "player-a",
            territoryGeoJson: territory_geometry,
            areaM2: 11,
            clearOnSync: false,
          },
        ],
      },
    ]);

    const insert_calls = execute_calls.filter((call) =>
      call.sql.includes("INSERT INTO territories")
    );
    assert.strictEqual(insert_calls.length, 1, "expected only one territory insert");
    assert.strictEqual(
      insert_calls[0]?.params?.[0],
      "known-user",
      "expected unknown owner to be skipped"
    );
    assert.ok(
      query_calls.some((call) => call.sql.includes("SELECT firebase_uid FROM users")),
      "expected users lookup during territory sync"
    );

    dbclient.query = originalQuery;
    dbclient.getConnection = originalGetConnection;
    console.log("Realtime state-store tests passed.");
  } catch (error) {
    dbclient.query = originalQuery;
    dbclient.getConnection = originalGetConnection;
    console.error("Realtime state-store tests failed:");
    console.error(error);
    process.exit(1);
  }
})();
