import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  ERP_OPERATING_LIFECYCLE,
  getErpLifecycleSyncPolicy,
  listNonOperatingInventoryRisk,
  queryErpOperatingLifecycle,
  readErpOperatingLifecycleSummary,
  simulateErpOperatingLifecycleViews,
} from "../server/erpOperatingLifecycleService.js";

function fixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE erp_goods(id TEXT PRIMARY KEY,goodsName TEXT);
    CREATE TABLE erp_skus(id TEXT PRIMARY KEY,erpGoodsId TEXT,merchantSkuCode TEXT,specificationName TEXT,erpStatus TEXT,currentState TEXT);
    CREATE TABLE products(id TEXT PRIMARY KEY,name TEXT,status TEXT);
    CREATE TABLE product_erp_mappings(id TEXT PRIMARY KEY,erpSkuId TEXT,productId TEXT,currentState TEXT);
    CREATE TABLE erp_sku_inventory_daily_summaries(id TEXT PRIMARY KEY,erpSkuId TEXT,businessDate TEXT,stockNum REAL,availableSendStock REAL,inventoryCostAmount REAL,updatedAt TEXT);
    CREATE TABLE operating_erp_set_members(normalizedCode TEXT PRIMARY KEY,merchantSkuCode TEXT,erpSkuId TEXT,salesObjectId TEXT,lifecycleStatus TEXT,sourceCount INTEGER,firstSeenAt TEXT,lastSeenAt TEXT,calculatedAt TEXT,updatedAt TEXT);
    CREATE TABLE operating_erp_set_evidence(id TEXT PRIMARY KEY,normalizedCode TEXT,sourceType TEXT,sourceObjectType TEXT,sourceObjectId TEXT,sourceBatchId TEXT,firstSeenAt TEXT,lastSeenAt TEXT,active INTEGER,calculatedAt TEXT,metadataJson TEXT,createdAt TEXT,updatedAt TEXT);
    CREATE TABLE sales_objects(id TEXT PRIMARY KEY,objectType TEXT,status TEXT);
    CREATE TABLE connection_sku_sales_daily_facts(id TEXT PRIMARY KEY,erpSkuId TEXT,salesAmount REAL,profitAmount REAL);
  `);
  const now = "2026-08-21T08:00:00Z";
  const statusByCode = { A: "active", B: "active_dependency", C: "sales_active", D: "archived", E: "external_unused", F: "archived" };
  for (const [code, lifecycleStatus] of Object.entries(statusByCode)) {
    db.prepare("INSERT INTO erp_goods VALUES (?,?)").run(`goods-${code}`, `Goods ${code}`);
    db.prepare("INSERT INTO erp_skus VALUES (?,?,?,?,?,?)").run(`erp-${code}`, `goods-${code}`, code, `Spec ${code}`, "normal", "active");
    db.prepare("INSERT INTO operating_erp_set_members VALUES (?,?,?,?,?,?,?,?,?,?)").run(code.toLowerCase(), code, `erp-${code}`, null, lifecycleStatus, ["active", "active_dependency", "sales_active"].includes(lifecycleStatus) ? 1 : 0, "2026-01-01", now, now, now);
  }
  db.prepare("INSERT INTO products VALUES ('product-1','Product 1','在售')").run();
  db.prepare("INSERT INTO products VALUES ('product-2','Product 2','在售')").run();
  db.prepare("INSERT INTO products VALUES ('product-3','Product 3','归档')").run();
  db.prepare("INSERT INTO product_erp_mappings VALUES ('map-a','erp-A','product-1','active')").run();
  db.prepare("INSERT INTO product_erp_mappings VALUES ('map-d','erp-D','product-1','active')").run();
  db.prepare("INSERT INTO product_erp_mappings VALUES ('map-b','erp-B','product-2','active')").run();
  db.prepare("INSERT INTO product_erp_mappings VALUES ('map-e','erp-E','product-3','active')").run();
  db.prepare("INSERT INTO operating_erp_set_evidence VALUES ('ev-a','a','platform_active','link_sku','ls-a','batch-1','2026-01-01',?,1,?,'{}',?,?)").run(now, now, now, now);
  db.prepare("INSERT INTO operating_erp_set_evidence VALUES ('ev-b','b','bundle_dependency','structure','st-b',NULL,'2026-01-01',?,1,?,'{}',?,?)").run(now, now, now, now);
  db.prepare("INSERT INTO operating_erp_set_evidence VALUES ('ev-c','c','sales_active','daily_fact','fact-c',NULL,'2026-01-01',?,1,?,'{}',?,?)").run(now, now, now, now);
  db.prepare("INSERT INTO erp_sku_inventory_daily_summaries VALUES ('inv-d-old','erp-D','2026-08-19',99,99,999,'2026-08-19')").run();
  db.prepare("INSERT INTO erp_sku_inventory_daily_summaries VALUES ('inv-d','erp-D','2026-08-20',10,8,500,'2026-08-20')").run();
  db.prepare("INSERT INTO erp_sku_inventory_daily_summaries VALUES ('inv-e','erp-E','2026-08-20',20,20,300,'2026-08-20')").run();
  db.prepare("INSERT INTO erp_sku_inventory_daily_summaries VALUES ('inv-a','erp-A','2026-08-20',5,5,100,'2026-08-20')").run();
  db.prepare("INSERT INTO sales_objects VALUES ('bundle-current','bundle','active')").run();
  db.prepare("INSERT INTO sales_objects VALUES ('bundle-history','bundle','active')").run();
  db.prepare("INSERT INTO operating_erp_set_members VALUES ('bundle-current','BUNDLE-CURRENT',NULL,'bundle-current','active',1,'2026-01-01',?,?,?)").run(now, now, now);
  db.prepare("INSERT INTO operating_erp_set_members VALUES ('bundle-history','BUNDLE-HISTORY',NULL,'bundle-history','archived',0,'2026-01-01',?,?,?)").run(now, now, now);
  db.prepare("INSERT INTO connection_sku_sales_daily_facts VALUES ('fact-1','erp-D',10,3)").run();
  return db;
}

test("Active由经营证据进入默认生命周期", () => { const db = fixture(); assert.equal(queryErpOperatingLifecycle({}, { database: db }).items[0].lifecycleStatus, "active"); db.close(); });
test("Active Dependency进入默认经营集合", () => { const db = fixture(); assert.equal(queryErpOperatingLifecycle({ lifecycleStatus: "active_dependency" }, { database: db }).total, 1); db.close(); });
test("Sales Active进入默认经营集合", () => { const db = fixture(); assert.equal(queryErpOperatingLifecycle({ lifecycleStatus: "sales_active" }, { database: db }).total, 1); db.close(); });
test("Archived默认隐藏但历史筛选可见", () => { const db = fixture(); assert.equal(queryErpOperatingLifecycle({ lifecycleStatus: "archived" }, { database: db }).total, 0); assert.equal(queryErpOperatingLifecycle({ includeHistorical: true, lifecycleStatus: "archived" }, { database: db }).total, 2); db.close(); });
test("External Unused与Archived可靠分开", () => { const db = fixture(); const summary = readErpOperatingLifecycleSummary({ database: db }); assert.equal(summary.items.find((item) => item.lifecycleStatus === "archived").erpSkuCount, 2); assert.equal(summary.items.find((item) => item.lifecycleStatus === "external_unused").erpSkuCount, 1); db.close(); });
test("多来源证据不被压成生命周期异常", () => { const db = fixture(); db.prepare("INSERT INTO operating_erp_set_evidence VALUES ('ev-a-sales','a','sales_active','daily_fact','fact-a',NULL,'2026-01-01','2026-08-21',1,'2026-08-21','{}','2026-08-21','2026-08-21')").run(); const row = queryErpOperatingLifecycle({ keyword: "A" }, { database: db }).items[0]; assert.deepEqual(row.sourceTypes, ["platform_active", "sales_active"]); assert.equal(row.lifecycleStatus, "active"); db.close(); });
test("非经营有库存独立进入风险清单", () => { const db = fixture(); const risk = listNonOperatingInventoryRisk({}, { database: db }); assert.equal(risk.total, 2); assert.equal(risk.items[0].erpSkuId, "erp-D"); db.close(); });
test("库存只读取每个ERP SKU最新记录", () => { const db = fixture(); const risk = listNonOperatingInventoryRisk({}, { database: db }); assert.equal(risk.items.find((item) => item.erpSkuId === "erp-D").inventoryQuantity, 10); db.close(); });
test("Product多ERP SKU只要一个Active就属于经营Product", () => { const db = fixture(); const impact = simulateErpOperatingLifecycleViews({ database: db }); assert.equal(impact.products.operating, 2); assert.equal(impact.products.historical, 1); db.close(); });
test("Bundle默认经营数量不包含历史Bundle", () => { const db = fixture(); const impact = simulateErpOperatingLifecycleViews({ database: db }); assert.equal(impact.bundles.current, 2); assert.equal(impact.bundles.operating, 1); db.close(); });
test("历史销售事实保留且生命周期读取不修改事实", () => { const db = fixture(); const before = db.prepare("SELECT COUNT(*) count,SUM(salesAmount) sales,SUM(profitAmount) profit FROM connection_sku_sales_daily_facts").get(); readErpOperatingLifecycleSummary({ database: db }); assert.deepEqual(db.prepare("SELECT COUNT(*) count,SUM(salesAmount) sales,SUM(profitAmount) profit FROM connection_sku_sales_daily_facts").get(), before); db.close(); });
test("默认ERP视图只显示三类经营状态", () => { const db = fixture(); const result = queryErpOperatingLifecycle({}, { database: db }); assert.equal(result.total, 3); assert(result.items.every((item) => ["active", "active_dependency", "sales_active"].includes(item.lifecycleStatus))); db.close(); });
test("显示历史筛选恢复完整ERP资产", () => { const db = fixture(); assert.equal(queryErpOperatingLifecycle({ includeHistorical: true }, { database: db }).total, 6); db.close(); });
test("生命周期与Product战略状态保持独立", () => { const db = fixture(); const row = queryErpOperatingLifecycle({ includeHistorical: true, lifecycleStatus: "external_unused" }, { database: db }).items[0]; assert.equal(row.lifecycleStatus, "external_unused"); assert.equal(row.productLifecycleStatus, "归档"); assert.notEqual(row.lifecycleStatus, row.productLifecycleStatus); db.close(); });
test("重复读取完全幂等且同步策略尚未应用生产", () => { const db = fixture(); assert.deepEqual(readErpOperatingLifecycleSummary({ database: db }), readErpOperatingLifecycleSummary({ database: db })); assert.equal(getErpLifecycleSyncPolicy().appliedToProductionSync, false); assert.deepEqual(Object.keys(ERP_OPERATING_LIFECYCLE), ["active", "active_dependency", "sales_active", "archived", "external_unused"]); db.close(); });
