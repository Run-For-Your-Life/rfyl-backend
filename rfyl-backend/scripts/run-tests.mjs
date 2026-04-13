import { spawnSync } from "node:child_process";

const default_test_files = [
  "tests/smoke.test.js",
  "tests/build.test.js",
  "tests/src-structure.test.js",
  "tests/auth.login.route.test.js",
  "tests/realtime.capture.test.js",
  "tests/realtime.gameplay.test.js",
  "tests/realtime.snapping.test.js",
  "tests/realtime.edgecases.test.js",
  "tests/realtime.persistence.test.js",
  "tests/realtime.state-store.test.js",
  "tests/map.matchmaking.test.js",
  "tests/map.reset.test.js",
  "tests/outside.boundary.test.js",
];

function runTestFile(test_file, index, total_count) {
  console.log(`\n[${index}/${total_count}] ${test_file}`);
  const result = spawnSync(process.execPath, [test_file], {
    stdio: "inherit",
    env: process.env,
  });
  return (result.status ?? 1) === 0;
}

function main() {
  const cli_files = process.argv.slice(2);
  const test_files = cli_files.length > 0 ? cli_files : default_test_files;
  const failed_files = [];

  for (let i = 0; i < test_files.length; i += 1) {
    const test_file = test_files[i];
    const passed = runTestFile(test_file, i + 1, test_files.length);
    if (!passed) {
      failed_files.push(test_file);
    }
  }

  const passed_count = test_files.length - failed_files.length;
  console.log(`\nTest files passed: ${passed_count}/${test_files.length}`);

  if (failed_files.length > 0) {
    console.log("Failed test files:");
    for (const failed_file of failed_files) {
      console.log(`- ${failed_file}`);
    }
    process.exit(1);
  }
}

main();
