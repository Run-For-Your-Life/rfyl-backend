import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const repoRoot = process.cwd();
const sqlPath = path.join(repoRoot, "src/db/runforyourlife_db.sql");
const hashPath = path.join(repoRoot, "src/db/runforyourlife_db.sql.sha256");

const sql = fs.readFileSync(sqlPath);
const hash = createHash("sha256").update(sql).digest("hex");
fs.writeFileSync(hashPath, `${hash}\n`, "utf8");
console.log(`Updated ${path.relative(repoRoot, hashPath)} -> ${hash}`);
