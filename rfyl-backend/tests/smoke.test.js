// tests/smoke.test.js
const assert = require("assert");
const pkg = require("../package.json");

console.log("Running backend smoke test...");

try {
  
  assert.ok(pkg.name, "package.json should have a name");
  assert.ok(pkg.version, "package.json should have a version");

  console.log("✅ Smoke test passed: package.json looks valid.");
} catch (err) {
  console.error("❌ Smoke test failed:");
  console.error(err);
  process.exit(1); 
}
