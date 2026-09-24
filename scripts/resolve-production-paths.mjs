#!/usr/bin/env node
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolveProductionPaths } = require("../server/productionPaths.cjs");
const format = process.argv.includes("--shell") ? "shell" : "json";
const requireBackupRoot = process.argv.includes("--require-backup-root");
const paths = resolveProductionPaths(process.env, { requireBackupRoot });
const values = {
  WUFAN_PROJECT_DIR: paths.projectDir,
  WUFAN_DATA_ROOT: paths.dataRoot,
  WUFAN_DB_PATH: paths.databasePath,
  WUFAN_DB_BASELINE_PATH: paths.baselinePath,
  WUFAN_UPLOADS_PATH: paths.uploadsPath,
  WUFAN_AUTH_SECRET_PATH: paths.authSecretPath,
  WUFAN_RELEASE_ROOT: paths.releaseRoot,
  WUFAN_BACKUP_ROOT: paths.backupRoot,
  WUFAN_PM2_LOG_ROOT: paths.pm2LogRoot,
};

if (format === "json") {
  process.stdout.write(`${JSON.stringify(values, null, 2)}\n`);
} else {
  const quote = (value) => `'${String(value).replaceAll("'", `'"'"'`)}'`;
  for (const [key, value] of Object.entries(values)) process.stdout.write(`export ${key}=${quote(value)}\n`);
}
