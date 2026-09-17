import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import {
  ensurePerformanceIndex,
  ensureSalesDailyIdentityLookupIndexes,
  salesDailyIdentityIndexDefinitions,
} from "../server/performanceIndexes.js";

function fixture() {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE erp_skus (id TEXT PRIMARY KEY, merchantSkuCode TEXT NOT NULL COLLATE NOCASE UNIQUE);
    CREATE TABLE sales_links (id TEXT PRIMARY KEY, shopId TEXT NOT NULL, platformGoodsId TEXT);
    CREATE UNIQUE INDEX idx_sales_links_goods_identity
      ON sales_links(shopId,platformGoodsId)
      WHERE platformGoodsId IS NOT NULL AND platformGoodsId<>'';
  `);
  return database;
}

test("sales daily identity indexes are created idempotently and used by both lookups", () => {
  const database = fixture();
  const first = ensureSalesDailyIdentityLookupIndexes(database);
  const second = ensureSalesDailyIdentityLookupIndexes(database);
  assert.deepEqual(first.map((item) => item.status), ["created", "created"]);
  assert.deepEqual(second.map((item) => item.status), ["existing", "existing"]);

  const erpPlan = database.prepare("EXPLAIN QUERY PLAN SELECT id FROM erp_skus WHERE LOWER(merchantSkuCode)=LOWER(?)").all("SKU-1");
  const linkPlan = database.prepare("EXPLAIN QUERY PLAN SELECT id FROM sales_links WHERE shopId=? AND platformGoodsId=?").all("shop-1", "goods-1");
  assert.match(erpPlan.map((row) => row.detail).join(" "), /idx_erp_skus_merchant_sku_lower/);
  assert.match(linkPlan.map((row) => row.detail).join(" "), /idx_sales_links_shop_platform_goods/);

  for (const name of first.map((item) => item.name)) {
    const row = database.prepare("SELECT [unique] isUnique FROM pragma_index_list(?) WHERE name=?").get(name.includes("erp") ? "erp_skus" : "sales_links", name);
    assert.equal(row.isUnique, 0);
  }
  database.close();
});

test("an equivalent differently named index is reused without creating a duplicate", () => {
  const database = fixture();
  database.exec("CREATE INDEX custom_erp_lower ON erp_skus(LOWER(merchantSkuCode))");
  const result = ensurePerformanceIndex(database, salesDailyIdentityIndexDefinitions[0]);
  assert.deepEqual(result, {
    name: "idx_erp_skus_merchant_sku_lower",
    status: "equivalent",
    equivalentIndex: "custom_erp_lower",
  });
  assert.equal(database.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE name=?").get(result.name).count, 0);
  database.close();
});

test("a conflicting same-name index aborts instead of hiding a wrong definition", () => {
  const database = fixture();
  database.exec("CREATE INDEX idx_erp_skus_merchant_sku_lower ON erp_skus(merchantSkuCode)");
  assert.throws(
    () => ensureSalesDailyIdentityLookupIndexes(database),
    (error) => error.code === "performance_index_definition_conflict",
  );
  database.close();
});

test("runtime migration installs performance indexes after table-rebuilding link migrations", () => {
  const source = fs.readFileSync(path.resolve(import.meta.dirname, "../server/db.js"), "utf8");
  const migrationStart = source.indexOf("function runLightweightMigrations()");
  const migrationEnd = source.indexOf("function getPermissionTemplateById", migrationStart);
  const migration = source.slice(migrationStart, migrationEnd);
  assert.ok(migration.indexOf("ensureSalesDailyIdentityLookupIndexes") > migration.indexOf("archiveLinkCenterLegacyStructuresPhase4"));
});
