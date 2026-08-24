import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ai-assistant-retirement-"));
const databasePath = path.join(directory, "workstation.db");
process.env.WUFAN_ENV = "test";
process.env.WUFAN_DB_PATH = databasePath;
process.env.WUFAN_ALLOW_DB_RESET = "1";
process.env.WUFAN_TEST_DATABASE_ROOT = directory;

const databaseModule = await import("../server/db.js");

function createLegacyAiAnalysisTable(database) {
  database.exec(`CREATE TABLE ai_analysis_records (
    id TEXT PRIMARY KEY, analysisType TEXT NOT NULL, objectType TEXT, objectId TEXT,
    title TEXT NOT NULL, question TEXT, providerMode TEXT NOT NULL, ruleVersion TEXT NOT NULL,
    sourceSnapshotJson TEXT NOT NULL, sourceReferencesJson TEXT NOT NULL,
    findingsJson TEXT NOT NULL, suggestionsJson TEXT NOT NULL, status TEXT NOT NULL,
    generatedBy TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
  )`);
}

test("退役迁移删除生产空表、保留非空历史并清除权限授权", () => {
  databaseModule.initializeDatabase({ reset: true });
  let database = databaseModule.getDatabase();
  const person = database.prepare("SELECT id FROM persons ORDER BY id LIMIT 1").get();
  assert.ok(person?.id);

  const permissions = {
    modules: { products: true, aiAssistant: true },
    products: { view: true },
    aiAssistant: { view: true, analyze: true, confirm: true, createAction: true },
  };
  database.prepare("UPDATE persons SET permissions=?,permissionOverrides=? WHERE id=?")
    .run(JSON.stringify(permissions), JSON.stringify(permissions), person.id);
  createLegacyAiAnalysisTable(database);
  const before = Object.fromEntries(["products", "erp_skus", "sales_links", "process_instances"]
    .map((table) => [table, database.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count]));
  databaseModule.closeDatabase();

  databaseModule.initializeDatabase();
  database = databaseModule.getDatabase();
  assert.equal(database.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name='ai_analysis_records'").get().count, 0);
  const migrated = database.prepare("SELECT permissions,permissionOverrides FROM persons WHERE id=?").get(person.id);
  for (const column of ["permissions", "permissionOverrides"]) {
    const value = JSON.parse(migrated[column]);
    assert.equal(value.aiAssistant, undefined);
    assert.equal(value.modules.aiAssistant, undefined);
    assert.equal(value.modules.products, true);
    assert.deepEqual(value.products, { view: true });
  }

  createLegacyAiAnalysisTable(database);
  database.prepare(`INSERT INTO ai_analysis_records(
    id,analysisType,objectType,objectId,title,question,providerMode,ruleVersion,
    sourceSnapshotJson,sourceReferencesJson,findingsJson,suggestionsJson,status,
    generatedBy,createdAt,updatedAt
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "legacy-ai-analysis", "product", "product", "product-legacy", "历史分析", "历史问题",
    "explainable_rules", "v1", "{}", "[]", "[]", "[]", "confirmed", person.id,
    "2026-08-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z",
  );
  databaseModule.closeDatabase();

  databaseModule.initializeDatabase();
  database = databaseModule.getDatabase();
  assert.deepEqual(
    database.prepare("SELECT id,status,title FROM ai_analysis_records WHERE id='legacy-ai-analysis'").get(),
    { id: "legacy-ai-analysis", status: "confirmed", title: "历史分析" },
  );
  const after = Object.fromEntries(Object.keys(before)
    .map((table) => [table, database.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count]));
  assert.deepEqual(after, before);
  assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
  assert.deepEqual(database.pragma("foreign_key_check"), []);
});

test.after(() => {
  databaseModule.closeDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
});
