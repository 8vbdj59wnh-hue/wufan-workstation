import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("数据库启动不再隐式改写 Legacy 权限，迁移只能由显式脚本执行", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "permission-v2-explicit-migration-"));
  process.env.WUFAN_DB_PATH = path.join(directory, "workstation.db");
  process.env.WUFAN_ENV = "test";
  process.env.WUFAN_ALLOW_DB_RESET = "1";
  const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");
  try {
    initializeDatabase({ reset: true });
    const database = getDatabase();
    const legacy = { modules: { templateCenter: true }, settings: { viewStandardWorks: true } };
    database.prepare("UPDATE persons SET permissions = ? WHERE id = 'person-004'").run(JSON.stringify(legacy));
    initializeDatabase();
    assert.deepEqual(JSON.parse(database.prepare("SELECT permissions FROM persons WHERE id = 'person-004'").get().permissions), legacy);
    const databaseSource = fs.readFileSync(new URL("../server/db.js", import.meta.url), "utf8");
    assert.doesNotMatch(databaseSource, /backfillExplicitTemplateCenterPermissions/);
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
