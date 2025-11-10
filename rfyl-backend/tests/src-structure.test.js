// tests/src-structure.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

console.log("Running src structure test...");

try {
  const srcDir = path.join(__dirname, "..", "src");
  const srcExists = fs.existsSync(srcDir);
  assert.ok(srcExists, "src folder should exist for the backend");

  const files = fs
    .readdirSync(srcDir)
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));

  assert.ok(files.length > 0, "src should contain at least one TypeScript file");

  const hasEntry =
    fs.existsSync(path.join(srcDir, "index.ts")) ||
    fs.existsSync(path.join(srcDir, "server.ts"));

  assert.ok(
    hasEntry,
    "Expected an entry file like src/index.ts or src/server.ts (update this test if your entry file has a different name)"
  );

  console.log("Src structure test passed.");
} catch (err) {
  console.error("Src structure test failed:");
  console.error(err);
  process.exit(1);
}
