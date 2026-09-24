import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import test from "node:test";
import Database from "better-sqlite3";

const require = createRequire(import.meta.url);
const { resolveProductionPaths } = require("../server/productionPaths.cjs");
const repository = path.resolve(import.meta.dirname, "..");

function profile(username) {
  const home = `/Users/${username}`;
  const dataRoot = `${home}/WufanWorkstationData/production`;
  return {
    WUFAN_PROJECT_DIR: `${home}/Projects/goal-execution-system`,
    WUFAN_DATA_ROOT: dataRoot,
    WUFAN_DB_PATH: `${dataRoot}/workstation.db`,
    WUFAN_DB_BASELINE_PATH: `${dataRoot}/business-baseline.json`,
    WUFAN_UPLOADS_PATH: `${dataRoot}/uploads`,
    WUFAN_AUTH_SECRET_PATH: `${dataRoot}/auth.secret`,
    WUFAN_RELEASE_ROOT: `${home}/WufanWorkstationReleases`,
    WUFAN_BACKUP_ROOT: `${home}/WufanWorkstationBackups`,
    WUFAN_PM2_LOG_ROOT: `${home}/.pm2/logs`,
  };
}

test("old and new server profiles resolve under identical safety rules", () => {
  for (const username of ["meiyounaichatouyuna", "wufan001"]) {
    const paths = resolveProductionPaths(profile(username), { requireBackupRoot: true });
    assert.equal(paths.databasePath, `/Users/${username}/WufanWorkstationData/production/workstation.db`);
    assert.equal(paths.projectDir, `/Users/${username}/Projects/goal-execution-system`);
  }
});

test("production paths reject missing, relative, repository, temporary and outside-root databases", () => {
  const valid = profile("wufan001");
  assert.throws(() => resolveProductionPaths({ ...valid, WUFAN_DB_PATH: "" }), /wufan_db_path_required/u);
  assert.throws(() => resolveProductionPaths({ ...valid, WUFAN_DB_PATH: "data/workstation.db" }), /wufan_db_path_must_be_absolute/u);
  assert.throws(() => resolveProductionPaths({ ...valid, WUFAN_DB_PATH: `${valid.WUFAN_PROJECT_DIR}/data/workstation.db` }), /production_database_path_inside_repository|production_database_path_outside_data_root/u);
  assert.throws(() => resolveProductionPaths({ ...valid, WUFAN_DATA_ROOT: "/private/tmp/wufan", WUFAN_DB_PATH: "/private/tmp/wufan/workstation.db", WUFAN_DB_BASELINE_PATH: "/private/tmp/wufan/business-baseline.json", WUFAN_UPLOADS_PATH: "/private/tmp/wufan/uploads", WUFAN_AUTH_SECRET_PATH: "/private/tmp/wufan/auth.secret" }), /temporary_path_forbidden/u);
  assert.throws(() => resolveProductionPaths({ ...valid, WUFAN_DB_PATH: "/Users/wufan001/elsewhere/workstation.db" }), /production_database_path_outside_data_root/u);
  assert.throws(() => resolveProductionPaths({ ...valid, WUFAN_DATA_ROOT: "/Volumes/company/production", WUFAN_DB_PATH: "/Volumes/company/production/workstation.db", WUFAN_DB_BASELINE_PATH: "/Volumes/company/production/business-baseline.json", WUFAN_UPLOADS_PATH: "/Volumes/company/production/uploads", WUFAN_AUTH_SECRET_PATH: "/Volumes/company/production/auth.secret" }), /network_path_forbidden/u);
});

test("uploads and auth secret must be absolute and remain under the persistent data root", () => {
  const valid = profile("wufan001");
  assert.throws(() => resolveProductionPaths({ ...valid, WUFAN_UPLOADS_PATH: "uploads" }), /wufan_uploads_path_must_be_absolute/u);
  assert.throws(() => resolveProductionPaths({ ...valid, WUFAN_AUTH_SECRET_PATH: "auth.secret" }), /wufan_auth_secret_path_must_be_absolute/u);
  assert.throws(() => resolveProductionPaths({ ...valid, WUFAN_UPLOADS_PATH: "/Users/wufan001/uploads" }), /production_uploads_path_outside_data_root/u);
});

test("canonical path checks prevent a symlink from moving persistent data into the repository", () => {
  const sandbox = fs.mkdtempSync(path.join(repository, ".production-path-symlink-"));
  try {
    const project = path.join(sandbox, "project");
    const embeddedData = path.join(project, "embedded-data");
    const logicalData = path.join(sandbox, "persistent-data");
    fs.mkdirSync(embeddedData, { recursive: true });
    fs.symlinkSync(embeddedData, logicalData);
    const environment = {
      WUFAN_PROJECT_DIR: project,
      WUFAN_DATA_ROOT: logicalData,
      WUFAN_DB_PATH: path.join(logicalData, "workstation.db"),
      WUFAN_DB_BASELINE_PATH: path.join(logicalData, "business-baseline.json"),
      WUFAN_UPLOADS_PATH: path.join(logicalData, "uploads"),
      WUFAN_AUTH_SECRET_PATH: path.join(logicalData, "auth.secret"),
      WUFAN_RELEASE_ROOT: path.join(sandbox, "releases"),
    };
    assert.throws(() => resolveProductionPaths(environment), /production_database_path_inside_repository|production_data_root_must_be_separate/u);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test("runtime scripts contain no fixed server username and backup uses persistent sources", () => {
  const scriptFiles = fs.readdirSync(path.join(repository, "scripts"), { recursive: true })
    .map((name) => `scripts/${name}`)
    .filter((name) => fs.statSync(path.join(repository, name)).isFile());
  const runtimeFiles = ["ecosystem.config.cjs", "server/databaseSafety.js", "server/runtimePaths.js", ...scriptFiles];
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(path.join(repository, file), "utf8");
    assert.doesNotMatch(source, /\/Users\/(?:meiyounaichatouyuna|mac)(?:\/|$)/u, file);
  }
  const backup = fs.readFileSync(path.join(repository, "scripts/backup-production.sh"), "utf8");
  assert.match(backup, /DB_SRC="\$\{WUFAN_DB_PATH/u);
  assert.match(backup, /UPLOADS_SRC="\$\{WUFAN_UPLOADS_PATH/u);
  assert.match(backup, /\.backup/u);
  assert.doesNotMatch(backup, /-delete|rm -rf/u);
});

test("example environment contains paths only and no embedded credentials", () => {
  const source = fs.readFileSync(path.join(repository, "config/production.env.example"), "utf8");
  assert.match(source, /\/Users\/wufan001\/Projects\/goal-execution-system/u);
  assert.match(source, /\/Users\/meiyounaichatouyuna\/Projects\/goal-execution-system/u);
  assert.doesNotMatch(source, /WDT_(KEY|SALT)=\S+/u);
  assert.doesNotMatch(source, /(password|token|jwt)=\S+/iu);
});

test("production backup works only against isolated configured sources in test mode", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wufan-backup-isolated-"));
  const project = path.join(sandbox, "project");
  const dataRoot = path.join(sandbox, "persistent");
  const backupRoot = path.join(sandbox, "backups");
  const databasePath = path.join(dataRoot, "workstation.db");
  const uploadsPath = path.join(dataRoot, "uploads");
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(uploadsPath, { recursive: true });
  fs.writeFileSync(path.join(project, "README.md"), "fixture\n");
  fs.writeFileSync(path.join(uploadsPath, "fixture.txt"), "fixture\n");
  const database = new Database(databasePath);
  database.exec("CREATE TABLE fixture(id INTEGER PRIMARY KEY); INSERT INTO fixture DEFAULT VALUES;");
  database.close();
  for (const args of [["init", "-b", "main"], ["config", "user.email", "fixture@example.invalid"], ["config", "user.name", "Fixture"], ["add", "README.md"], ["commit", "-m", "fixture"]]) {
    const result = spawnSync("git", args, { cwd: project, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  try {
    const result = spawnSync(path.join(repository, "scripts/backup-production.sh"), [], {
      cwd: repository,
      encoding: "utf8",
      env: {
        ...process.env,
        RELEASE_TEST_MODE: "1",
        RELEASE_TEST_PROJECT_DIR: project,
        RELEASE_TEST_DATA_ROOT: dataRoot,
        RELEASE_TEST_DATABASE_PATH: databasePath,
        RELEASE_TEST_UPLOADS_PATH: uploadsPath,
        RELEASE_TEST_BACKUP_ROOT: backupRoot,
      },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /BACKUP_OK/u);
    const databaseBackup = result.stdout.match(/^DB_DEST=(.+)$/mu)?.[1];
    const uploadsBackup = result.stdout.match(/^UPLOADS_DEST=(.+)$/mu)?.[1];
    const bundle = result.stdout.match(/^BUNDLE_DEST=(.+)$/mu)?.[1];
    assert.ok(databaseBackup && fs.existsSync(databaseBackup));
    assert.ok(uploadsBackup && fs.existsSync(uploadsBackup));
    assert.ok(bundle && fs.existsSync(bundle));
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});
