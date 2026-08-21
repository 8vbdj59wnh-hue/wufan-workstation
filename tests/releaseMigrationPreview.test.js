import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import Database from "better-sqlite3";

const projectRoot = path.resolve(import.meta.dirname, "..");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

test("release migration preview uses only the explicit isolated database and is idempotent", () => {
  const root = fs.mkdtempSync(path.join("/private/tmp", "release-migration-preview-"));
  const fakeProject = path.join(root, "project");
  const releaseDirectory = path.join(root, "release-preview");
  const backupPath = path.join(root, "production-backup.db");
  fs.mkdirSync(path.join(fakeProject, "server"), { recursive: true });
  fs.mkdirSync(path.join(fakeProject, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(releaseDirectory, "checks"), { recursive: true });
  fs.mkdirSync(path.join(releaseDirectory, "logs"), { recursive: true });
  fs.symlinkSync(path.join(projectRoot, "node_modules"), path.join(fakeProject, "node_modules"));

  fs.writeFileSync(path.join(fakeProject, "server/db.js"), `
    import path from "node:path";
    const configured = String(process.env.WUFAN_DB_PATH || "");
    const root = String(process.env.WUFAN_ISOLATION_DATABASE_ROOT || "");
    if (process.env.WUFAN_ENV !== "migration-preview") throw new Error("wrong environment");
    if (!path.isAbsolute(configured) || path.relative(root, configured).startsWith("..")) throw new Error("unsafe path");
    export const databasePath = path.resolve(configured);
  `);
  fs.writeFileSync(path.join(fakeProject, "scripts/release-migration-runner.mjs"), `
    import Database from "better-sqlite3";
    import { databasePath } from "../server/db.js";
    if (process.env.WUFAN_MIGRATION_PREVIEW !== "1") throw new Error("preview flag missing");
    const database = new Database(databasePath);
    database.exec("CREATE TABLE IF NOT EXISTS preview_marker(id TEXT PRIMARY KEY)");
    database.close();
  `);

  const backup = new Database(backupPath);
  backup.exec("CREATE TABLE business_fact(id TEXT PRIMARY KEY, amount REAL); INSERT INTO business_fact VALUES ('fact-1', 100)");
  backup.close();
  const sourceBefore = { sha256: sha256(backupPath), size: fs.statSync(backupPath).size, inode: fs.statSync(backupPath).ino };

  try {
    run("git", ["init", "-q"], { cwd: fakeProject });
    run("git", ["config", "user.name", "Release Test"], { cwd: fakeProject });
    run("git", ["config", "user.email", "release-test@example.invalid"], { cwd: fakeProject });
    run("git", ["add", "server/db.js", "scripts/release-migration-runner.mjs"], { cwd: fakeProject });
    run("git", ["commit", "-q", "-m", "preview fixture"], { cwd: fakeProject });
    const commit = run("git", ["rev-parse", "HEAD"], { cwd: fakeProject }).stdout.trim();
    fs.writeFileSync(path.join(releaseDirectory, "release-manifest.json"), `${JSON.stringify({
      targetCommit: commit,
      status: "prepared",
      requiresMigrationPreview: true,
      databaseBackupPath: backupPath,
    }, null, 2)}\n`);

    const result = run("bash", [path.join(projectRoot, "scripts/release-migration-preview.sh"), "--commit", commit, "--release-dir", releaseDirectory], {
      cwd: projectRoot,
      env: {
        ...process.env,
        RELEASE_TEST_MODE: "1",
        RELEASE_TEST_PROJECT_DIR: fakeProject,
        RELEASE_TEST_NODE_COMMAND: process.execPath,
      },
    });
    assert.match(result.stdout, /MIGRATION_PREVIEW_RESULT=/u);
    const preview = JSON.parse(fs.readFileSync(path.join(releaseDirectory, "checks/migration-preview.json"), "utf8"));
    assert.equal(preview.success, true);
    assert.equal(preview.idempotent, true);
    assert.equal(preview.sourceDatabaseOpened, false);
    assert.equal(preview.sourceDatabaseUnchanged, true);
    assert.equal(preview.resolvedDatabasePath, path.join(releaseDirectory, "checks/migration-preview.db"));
    const sourceAfter = { sha256: sha256(backupPath), size: fs.statSync(backupPath).size, inode: fs.statSync(backupPath).ino };
    assert.deepEqual(sourceAfter, sourceBefore);
    const isolated = new Database(preview.previewDatabasePath, { readonly: true });
    assert.equal(isolated.prepare("SELECT COUNT(*) total FROM preview_marker").get().total, 0);
    assert.equal(isolated.prepare("SELECT amount FROM business_fact WHERE id='fact-1'").get().amount, 100);
    isolated.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
