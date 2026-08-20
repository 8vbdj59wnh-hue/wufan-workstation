import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

if (process.argv.length < 3) {
  console.error("Usage: node scripts/run-isolated-node.mjs <node arguments...>");
  process.exit(2);
}

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wufan-test-"));
const databasePath = path.join(directory, "workstation.db");
const result = spawnSync(process.execPath, process.argv.slice(2), {
  cwd: process.cwd(),
  env: {
    ...process.env,
    WUFAN_ENV: "test",
    WUFAN_DB_PATH: databasePath,
    WUFAN_TEST_DATABASE_ROOT: directory,
    WUFAN_ALLOW_DB_RESET: "1",
  },
  stdio: "inherit",
});

if (process.env.WUFAN_KEEP_TEST_DATABASE === "1") {
  console.log(`Isolated test database retained at ${databasePath}`);
} else {
  fs.rmSync(directory, { recursive: true, force: true });
}

if (result.error) throw result.error;
process.exit(result.status ?? 1);
