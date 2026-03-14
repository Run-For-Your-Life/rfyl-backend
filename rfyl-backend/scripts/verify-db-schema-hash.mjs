import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const repoRoot = process.cwd();
const sqlPath = path.join(repoRoot, "src/db/runforyourlife_db.sql");
const hashPath = path.join(repoRoot, "src/db/runforyourlife_db.sql.sha256");

const sql = fs.readFileSync(sqlPath);
const actualHash = createHash("sha256").update(sql).digest("hex");
const expectedHash = fs.readFileSync(hashPath, "utf8").trim();

if (!expectedHash) {
  console.error("Schema hash file is empty.");
  process.exit(1);
}

if (actualHash !== expectedHash) {
  console.error("DB schema hash mismatch.");
  console.error(`expected: ${expectedHash}`);
  console.error(`actual:   ${actualHash}`);
  console.error(
    "If this SQL change is intentional, update tests/migrations and refresh src/db/runforyourlife_db.sql.sha256."
  );
  process.exit(1);
}

console.log("DB schema hash verified.");
