import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sourceDatabase = process.env.WUFAN_SOURCE_DB || "/private/tmp/wufan-combo-design-analysis.db";
if (!fs.existsSync(sourceDatabase)) throw new Error(`隔离验证源数据库不存在：${sourceDatabase}`);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "resolve-link-sku-erp-relations-batch-"));
const databasePath = path.join(root, "isolated.db");
fs.copyFileSync(sourceDatabase, databasePath);
process.env.WUFAN_DB_PATH = databasePath;

const { initializeDatabase, getDatabase } = await import("../server/db.js");
const { resolveLinkSkuErpRelation, resolveLinkSkuErpRelations } = await import("../server/capabilities/resolveLinkSkuErpRelation.js");
initializeDatabase();
const database = getDatabase();

function count(table) {
  return Number(database.prepare(`SELECT COUNT(*) total FROM ${table}`).get().total);
}

function protectedCounts() {
  return {
    mappings: count("sales_link_sku_erp_mappings"),
    comboGroups: count("sales_link_sku_combo_groups"),
    dailyFacts: count("connection_sku_sales_daily_facts"),
    periodFacts: count("connection_sku_sales_facts"),
  };
}

function timed(run) {
  const started = process.hrtime.bigint();
  const value = run();
  return { value, milliseconds: Number(process.hrtime.bigint() - started) / 1e6 };
}

const ids = database.prepare(`
  SELECT DISTINCT salesLinkSkuId id
  FROM sales_link_sku_erp_mappings
  WHERE currentState='active'
  ORDER BY RANDOM()
  LIMIT 500
`).all().map((row) => row.id);
assert.ok(ids.length >= 500, `真实active关系样本不足500，实际${ids.length}`);

const compareFields = ["relationStatus", "relationshipShape", "isComplete", "isUsable", "mappings", "combo", "conflicts", "warnings"];
const before = protectedCounts();
const totalChangesBefore = database.prepare("SELECT total_changes() value").get().value;
const scenarios = [];

for (const size of [100, 500]) {
  const sample = ids.slice(0, size);
  let singleSqlCount = 0;
  const single = timed(() => Object.fromEntries(sample.map((id) => [id, resolveLinkSkuErpRelation(
    { salesLinkSkuId: id },
    { database, onQuery: () => { singleSqlCount += 1; } },
  )])));
  let batchSqlCount = 0;
  const batch = timed(() => resolveLinkSkuErpRelations(
    { salesLinkSkuIds: sample },
    { database, onQuery: () => { batchSqlCount += 1; } },
  ));
  for (const id of sample) {
    for (const field of compareFields) assert.deepEqual(
      batch.value.results[id][field],
      single.value[id][field],
      `${size}样本 ${id}.${field} 单条与批量不一致`,
    );
  }
  scenarios.push({
    size,
    single: { sqlCount: singleSqlCount, milliseconds: Number(single.milliseconds.toFixed(3)) },
    batch: { sqlCount: batchSqlCount, milliseconds: Number(batch.milliseconds.toFixed(3)) },
    sqlReductionPercent: Number(((1 - batchSqlCount / singleSqlCount) * 100).toFixed(2)),
    timeReductionPercent: Number(((1 - batch.milliseconds / single.milliseconds) * 100).toFixed(2)),
    comparedFields: compareFields,
  });
}

const duplicateInput = [ids[0], ids[1], ids[0], "not-found-link-sku"];
const duplicateResult = resolveLinkSkuErpRelations({ salesLinkSkuIds: duplicateInput }, { database });
assert.deepEqual(Object.keys(duplicateResult.results), [ids[0], ids[1], "not-found-link-sku"]);
assert.equal(duplicateResult.results["not-found-link-sku"].relationStatus, "not_found");
assert.deepEqual(resolveLinkSkuErpRelations({ salesLinkSkuIds: [] }, { database }).results, {});

const after = protectedCounts();
const totalChangesAfter = database.prepare("SELECT total_changes() value").get().value;
assert.deepEqual(after, before);
assert.equal(totalChangesAfter, totalChangesBefore);
const integrity = database.pragma("integrity_check", { simple: true });
const foreignKeyErrors = database.pragma("foreign_key_check");
assert.equal(integrity, "ok");
assert.deepEqual(foreignKeyErrors, []);

const report = {
  success: true,
  sourceDatabase,
  isolatedDatabase: databasePath,
  sourceDatabaseSha256: crypto.createHash("sha256").update(fs.readFileSync(sourceDatabase)).digest("hex"),
  scenarios,
  boundaries: {
    emptyArray: "empty_results",
    duplicateIds: "resolved_once",
    mixedExistingAndMissing: "independent_results",
    resultOrder: Object.keys(duplicateResult.results),
  },
  protectedBefore: before,
  protectedAfter: after,
  resolverDatabaseChanges: Number(totalChangesAfter) - Number(totalChangesBefore),
  integrityCheck: integrity,
  foreignKeyCheckErrors: foreignKeyErrors.length,
};
console.log(JSON.stringify(report, null, 2));
database.close();
