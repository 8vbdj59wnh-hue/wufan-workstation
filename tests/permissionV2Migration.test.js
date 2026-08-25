import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

function runMigration(databasePath, reportPath, apply = false) {
  const result = spawnSync(process.execPath, [
    "scripts/migrate-permissions-v2.mjs",
    "--db", databasePath,
    "--report", reportPath,
    ...(apply ? ["--apply"] : []),
  ], { cwd: projectRoot, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(fs.readFileSync(reportPath, "utf8"));
}

test("V2 迁移先预览后应用，并且只改写人员与权限模板权限列", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "permission-v2-migration-"));
  const databasePath = path.join(directory, "workstation.db");
  process.env.WUFAN_DB_PATH = databasePath;
  process.env.WUFAN_ENV = "test";
  process.env.WUFAN_ALLOW_DB_RESET = "1";
  const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");
  try {
    initializeDatabase({ reset: true });
    const database = getDatabase();
    database.exec("CREATE TABLE permission_v2_business_guard (id TEXT PRIMARY KEY, payload TEXT NOT NULL)");
    database.prepare("INSERT INTO permission_v2_business_guard VALUES ('guard', 'unchanged')").run();
    closeDatabase();

    const preview = runMigration(databasePath, path.join(directory, "preview.json"));
    assert.equal(preview.mode, "preview");
    assert.equal(preview.permissionCatalog.formalPermissionCount, 56);
    assert.equal(preview.counts.migratedPeople, 0);
    assert.equal(preview.counts.privilegeIncreaseBlockers, 0);

    const applied = runMigration(databasePath, path.join(directory, "applied.json"), true);
    assert.equal(applied.mode, "isolated-copy-apply");
    assert.equal(applied.counts.migratedPeople, applied.counts.people);
    assert.equal(applied.validation.after.integrity, "ok");
    assert.equal(applied.validation.after.foreignKeyViolationCount, 0);

    const migrated = new Database(databasePath, { readonly: true });
    assert.equal(migrated.prepare("SELECT payload FROM permission_v2_business_guard WHERE id = 'guard'").get().payload, "unchanged");
    for (const row of migrated.prepare("SELECT permissions,permissionOverrides FROM persons").all()) {
      assert.equal(JSON.parse(row.permissions).permissionVersion, 2);
      assert.equal(JSON.parse(row.permissionOverrides).permissionVersion, 2);
    }
    for (const row of migrated.prepare("SELECT permissions FROM permission_templates").all()) {
      assert.equal(JSON.parse(row.permissions).permissionVersion, 2);
    }
    migrated.close();

    const second = runMigration(databasePath, path.join(directory, "second.json"), true);
    assert.equal(second.validation.after.integrity, "ok");
    assert.equal(second.counts.privilegeIncreaseBlockers, 0);
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
