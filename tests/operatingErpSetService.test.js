import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  calculateOperatingErpSet,
  deriveSalesActivePolicy,
  materializeOperatingErpSet,
  queryOperatingErpSet,
} from "../server/operatingErpSetService.js";

function fixture() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys=ON");
  db.exec(`
    CREATE TABLE erp_import_batches (
      id TEXT PRIMARY KEY,importType TEXT,status TEXT,businessDate TEXT,completedAt TEXT,createdAt TEXT,
      originalFilename TEXT,importMode TEXT
    );
    CREATE TABLE erp_skus (
      id TEXT PRIMARY KEY,merchantSkuCode TEXT NOT NULL,currentState TEXT,createdAt TEXT,updatedAt TEXT
    );
    CREATE TABLE sales_objects (
      id TEXT PRIMARY KEY,objectCode TEXT,normalizedObjectCode TEXT,objectType TEXT,status TEXT,firstSeenAt TEXT,lastSeenAt TEXT
    );
    CREATE TABLE sales_link_skus (
      id TEXT PRIMARY KEY,salesLinkId TEXT,platformSkuCode TEXT,normalizedPlatformSkuCode TEXT,erpSkuId TEXT,
      lastSeenBatchId TEXT,createdAt TEXT,updatedAt TEXT
    );
    CREATE TABLE sales_link_sku_sales_object_relations (
      id TEXT PRIMARY KEY,linkSkuId TEXT,salesObjectId TEXT,effectiveFrom TEXT,effectiveTo TEXT,status TEXT,sourceBatchId TEXT
    );
    CREATE TABLE sales_object_structures (
      id TEXT PRIMARY KEY,salesObjectId TEXT,version INTEGER,status TEXT,sourceType TEXT,sourceState TEXT
    );
    CREATE TABLE sales_object_structure_components (
      id TEXT PRIMARY KEY,structureId TEXT,salesObjectId TEXT,erpSkuId TEXT,quantity REAL,status TEXT
    );
    CREATE TABLE connection_sku_sales_daily_facts (
      id TEXT PRIMARY KEY,salesLinkSkuId TEXT,erpSkuId TEXT,saleDate TEXT,sourceBatchId TEXT
    );
    CREATE TABLE product_erp_mappings (
      id TEXT PRIMARY KEY,erpSkuId TEXT,productId TEXT,currentState TEXT
    );
    CREATE TABLE erp_sku_inventory_daily_summaries (
      id TEXT PRIMARY KEY,businessDate TEXT,erpSkuId TEXT,stockNum REAL,availableSendStock REAL,inventoryCostAmount REAL
    );
    CREATE TABLE operating_erp_set_members (
      normalizedCode TEXT PRIMARY KEY COLLATE NOCASE,merchantSkuCode TEXT NOT NULL,erpSkuId TEXT,salesObjectId TEXT,
      lifecycleStatus TEXT NOT NULL,sourceCount INTEGER NOT NULL DEFAULT 0,firstSeenAt TEXT NOT NULL,lastSeenAt TEXT NOT NULL,
      calculatedAt TEXT NOT NULL,updatedAt TEXT NOT NULL
    );
    CREATE TABLE operating_erp_set_evidence (
      id TEXT PRIMARY KEY,normalizedCode TEXT NOT NULL COLLATE NOCASE,sourceType TEXT NOT NULL,sourceObjectType TEXT NOT NULL,
      sourceObjectId TEXT NOT NULL,sourceBatchId TEXT,firstSeenAt TEXT NOT NULL,lastSeenAt TEXT NOT NULL,active INTEGER NOT NULL,
      calculatedAt TEXT NOT NULL,metadataJson TEXT NOT NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,
      UNIQUE(normalizedCode,sourceType,sourceObjectType,sourceObjectId)
    );
    CREATE TABLE operating_erp_lifecycle_events (
      id TEXT PRIMARY KEY,normalizedCode TEXT NOT NULL COLLATE NOCASE,erpSkuId TEXT,fromStatus TEXT,toStatus TEXT NOT NULL,
      sourceTypesJson TEXT NOT NULL,reason TEXT NOT NULL,calculatedAt TEXT NOT NULL,createdAt TEXT NOT NULL
    );
  `);
  const now = "2026-08-21T00:00:00.000Z";
  db.prepare("INSERT INTO erp_import_batches VALUES (?,?,?,?,?,?,?,?)")
    .run("batch-current", "platform_goods", "completed", "2026-08-19", now, now, "8.19平台货品.xlsx", "full");
  const insertErp = db.prepare("INSERT INTO erp_skus VALUES (?,?,?,?,?)");
  for (const code of ["A", "B", "C", "D", "E", "F", "G", "H"]) insertErp.run(`erp-${code}`, code, "active", "2026-01-01", now);
  const insertObject = db.prepare("INSERT INTO sales_objects VALUES (?,?,?,?,?,?,?)");
  for (const code of ["A", "C", "F", "G", "H"]) insertObject.run(`so-${code}`, code, code.toLowerCase(), "single", "active", "2026-01-01", now);
  insertObject.run("so-bundle", "BUNDLE-1", "bundle-1", "bundle", "active", "2026-01-01", now);
  const insertStructure = db.prepare("INSERT INTO sales_object_structures VALUES (?,?,?,?,?,?)");
  const insertComponent = db.prepare("INSERT INTO sales_object_structure_components VALUES (?,?,?,?,?,?)");
  for (const code of ["A", "C", "F", "G", "H"]) {
    insertStructure.run(`st-${code}`, `so-${code}`, 1, "active", "v3_auto_projection", "active");
    insertComponent.run(`sc-${code}`, `st-${code}`, `so-${code}`, `erp-${code}`, 1, "active");
  }
  insertStructure.run("st-bundle", "so-bundle", 1, "active", "wangdian_suite_api", "active");
  insertComponent.run("sc-bundle-b", "st-bundle", "so-bundle", "erp-B", 2, "active");
  insertComponent.run("sc-bundle-h", "st-bundle", "so-bundle", "erp-H", 1, "active");
  const insertSku = db.prepare("INSERT INTO sales_link_skus VALUES (?,?,?,?,?,?,?,?)");
  insertSku.run("ls-A", "link-A", "A", "a", "erp-A", "batch-current", "2026-01-01", now);
  insertSku.run("ls-H", "link-H", "H", "h", "erp-H", "batch-current", "2026-01-01", now);
  insertSku.run("ls-bundle", "link-bundle", "BUNDLE-1", "bundle-1", null, "batch-current", "2026-01-01", now);
  insertSku.run("ls-C", "link-C", "C", "c", "erp-C", "batch-old", "2026-01-01", now);
  insertSku.run("ls-F", "link-F", "F", "f", "erp-F", "batch-old", "2026-01-01", now);
  insertSku.run("ls-G", "link-G", "G", "g", "erp-G", "batch-old", "2026-01-01", now);
  insertSku.run("ls-D", "link-D", "D", "d", "erp-D", "batch-old", "2026-01-01", now);
  const insertRelation = db.prepare("INSERT INTO sales_link_sku_sales_object_relations VALUES (?,?,?,?,?,?,?)");
  for (const code of ["A", "H", "C", "F", "G"]) insertRelation.run(`rel-${code}`, `ls-${code}`, `so-${code}`, "2026-01-01", null, "active", "batch-current");
  insertRelation.run("rel-bundle", "ls-bundle", "so-bundle", "2026-01-01", null, "active", "batch-current");
  const insertFact = db.prepare("INSERT INTO connection_sku_sales_daily_facts VALUES (?,?,?,?,?)");
  insertFact.run("fact-start", "ls-A", "erp-A", "2026-07-09", "sales-current");
  insertFact.run("fact-A", "ls-A", "erp-A", "2026-08-09", "sales-current");
  insertFact.run("fact-H", "ls-H", "erp-H", "2026-08-09", "sales-current");
  insertFact.run("fact-C", "ls-C", "erp-C", "2026-08-09", "sales-current");
  insertFact.run("fact-F", "ls-F", "erp-F", "2026-08-09", "sales-current");
  insertFact.run("fact-bundle", "ls-bundle", "erp-B", "2026-08-09", "sales-current");
  insertFact.run("fact-D-old", "ls-D", "erp-D", "2026-01-01", "sales-old");
  return db;
}

const calculate = (db) => calculateOperatingErpSet({ database: db, calculatedAt: "2026-08-21T01:00:00.000Z" });
const member = (result, code) => result.members.find((item) => item.normalizedCode === code.toLowerCase());

test("Platform Active来自最新完整平台批次", () => {
  const db = fixture();
  const result = calculate(db);
  assert.equal(member(result, "A").lifecycleStatus, "active");
  assert.equal(member(result, "A").sourceCount, 2);
  db.close();
});

test("Bundle Dependency只展开当前经营Bundle组件", () => {
  const db = fixture();
  const result = calculate(db);
  assert.equal(member(result, "B").lifecycleStatus, "active_dependency");
  const evidence = result.evidence.find((item) => item.normalizedCode === "b" && item.sourceType === "bundle_dependency");
  assert.equal(JSON.parse(evidence.metadataJson).structureSourceType,"wangdian_suite_api");
  db.close();
});

test("历史Excel结构不能定义当前Dependency", () => {
  const db = fixture();
  db.prepare("UPDATE sales_object_structures SET sourceType='combo_master_excel' WHERE id='st-bundle'").run();
  const result = calculate(db);
  assert.equal(member(result,"B").lifecycleStatus,"archived");
  assert.ok(!result.evidence.some((item)=>item.normalizedCode==="b"&&item.sourceType==="bundle_dependency"));
  assert.ok(result.exceptions.some((item)=>item.type==="bundle_authoritative_bom_missing"&&item.code==="BUNDLE-1"));
  db.close();
});

test("旺店通当前BOM移除Component后Dependency重新计算", () => {
  const db = fixture();
  db.prepare("DELETE FROM sales_object_structure_components WHERE id='sc-bundle-b'").run();
  const result = calculate(db);
  assert.equal(member(result,"B").lifecycleStatus,"archived");
  assert.equal(result.summary.operatingErpSet,4);
  db.close();
});

test("旺店通Suite已移除时进入source conflict而不回退Excel", () => {
  const db = fixture();
  db.prepare("UPDATE sales_object_structures SET status='inactive',sourceState='source_removed' WHERE id='st-bundle'").run();
  const result = calculate(db);
  assert.equal(member(result,"B").lifecycleStatus,"archived");
  assert.ok(result.exceptions.some((item)=>item.type==="bundle_source_conflict"&&item.sourceRemoved===true));
  db.close();
});

test("Sales Active使用正式事实且不把Bundle组件误标为Sales Active", () => {
  const db = fixture();
  const result = calculate(db);
  assert.equal(member(result, "C").lifecycleStatus, "sales_active");
  assert(!result.evidence.some((item) => item.normalizedCode === "b" && item.sourceType === "sales_active"));
  assert(result.evidence.some((item) => item.normalizedCode === "bundle-1" && item.sourceType === "sales_active"));
  db.close();
});

test("同一ERP SKU保留多来源证据", () => {
  const db = fixture();
  const result = calculate(db);
  const sources = new Set(result.evidence.filter((item) => item.normalizedCode === "h").map((item) => item.sourceType));
  assert.deepEqual(sources, new Set(["platform_active", "sales_active", "bundle_dependency"]));
  assert.equal(member(result, "H").sourceCount, 3);
  db.close();
});

test("平台批次消失后不再保留Platform Active", () => {
  const db = fixture();
  const result = calculate(db);
  assert.equal(member(result, "F").lifecycleStatus, "sales_active");
  assert(!result.evidence.some((item) => item.normalizedCode === "f" && item.sourceType === "platform_active"));
  db.close();
});

test("历史销售对象进入Archived而非External", () => {
  const db = fixture();
  const result = calculate(db);
  assert.equal(member(result, "D").lifecycleStatus, "archived");
  assert.equal(member(result, "G").lifecycleStatus, "archived");
  db.close();
});

test("无任何经营证据的ERP SKU进入External Unused", () => {
  const db = fixture();
  const result = calculate(db);
  assert.equal(member(result, "E").lifecycleStatus, "external_unused");
  db.close();
});

test("销售窗口从已提交事实覆盖周期推导而非固定常量", () => {
  const db = fixture();
  const policy = deriveSalesActivePolicy({ database: db });
  assert.equal(policy.windowDays, 32);
  assert.equal(policy.cutoffDate, "2026-07-09");
  assert.equal(policy.basis, "latest_committed_coverage");
  db.close();
});

test("重复计算与物化保持幂等", () => {
  const db = fixture();
  materializeOperatingErpSet({ database: db, calculatedAt: "2026-08-21T01:00:00.000Z" });
  const first = {
    members: db.prepare("SELECT COUNT(*) total FROM operating_erp_set_members").get().total,
    evidence: db.prepare("SELECT COUNT(*) total FROM operating_erp_set_evidence").get().total,
  };
  const repeated = materializeOperatingErpSet({ database: db, calculatedAt: "2026-08-21T02:00:00.000Z" });
  assert.deepEqual({
    members: db.prepare("SELECT COUNT(*) total FROM operating_erp_set_members").get().total,
    evidence: db.prepare("SELECT COUNT(*) total FROM operating_erp_set_evidence").get().total,
  }, first);
  assert.equal(repeated.materialization.membersChanged, 0);
  assert.equal(repeated.materialization.evidenceChanged, 0);
  assert.equal(repeated.materialization.evidenceDeactivated, 0);
  assert.equal(repeated.materialization.lifecycleEventsChanged, 0);
  assert.equal(db.prepare("SELECT COUNT(*) total FROM operating_erp_lifecycle_events").get().total, 8);
  assert.equal(queryOperatingErpSet({ sourceType: "bundle_dependency" }, { database: db }).total, 2);
  db.close();
});

test("物化只写Operating ERP资产，不修改正式业务数据", () => {
  const db = fixture();
  const tables = ["erp_skus", "sales_objects", "sales_link_skus", "sales_link_sku_sales_object_relations", "sales_object_structures", "sales_object_structure_components", "connection_sku_sales_daily_facts", "product_erp_mappings", "erp_sku_inventory_daily_summaries"];
  const before = Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT COUNT(*) total FROM ${table}`).get().total]));
  materializeOperatingErpSet({ database: db, calculatedAt: "2026-08-21T01:00:00.000Z" });
  const after = Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT COUNT(*) total FROM ${table}`).get().total]));
  assert.deepEqual(after, before);
  db.close();
});
