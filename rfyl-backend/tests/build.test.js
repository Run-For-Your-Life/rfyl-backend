// tests/build.test.js
const { execSync } = require("child_process");

console.log("Running TypeScript build test...");

try {
  execSync("npx tsc --noEmit", { stdio: "inherit" });
  console.log("TypeScript build test passed (backend compiles).");
} catch (err) {
  console.error("TypeScript build test failed:");
  console.error(err);
  process.exit(1); 
}
