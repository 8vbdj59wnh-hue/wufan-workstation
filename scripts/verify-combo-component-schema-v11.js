import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sourcePath = path.resolve(process.argv[2] || "/private/tmp/wufan-sales-daily-preview-source.db");
const databasePath = path.join(os.tmpdir(), `wufan-combo-component-v11-${process.pid}-${Date.now()}.db`);
fs.copyFileSync(sourcePath, databasePath);
process.env.WUFAN_DB_PATH = databasePath;

const { closeDatabase, getDatabase, initializeDatabase, migrateSalesLinkSkuComboGroupsV1 } = await import("../server/db.js");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const count = (database, table) => database.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total;
const expectFailure = (operation, message) => {
  try { operation(); } catch (error) {
    assert(/constraint failed|cannot be approved|requires manually confirmed/i.test(String(error.message)), `${message}：${error.message}`);
    return;
  }
  throw new Error(message);
};
const sha256 = (filePath) => crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");

try {
  initializeDatabase({ reset: false });
  const database = getDatabase();
  database.pragma("foreign_keys = ON");
  const now = new Date().toISOString();
  const protectedBefore = {
    mappings: count(database, "sales_link_sku_erp_mappings"),
    dailyFacts: count(database, "connection_sku_sales_daily_facts"),
    periodFacts: count(database, "connection_sku_sales_facts"),
  };
  const salesLinkSku = database.prepare("SELECT id FROM sales_link_skus LIMIT 1").get();
  const erpSkus = database.prepare("SELECT id FROM erp_skus LIMIT 4").all();
  const reviewer = database.prepare("SELECT id FROM persons LIMIT 1").get();
  assert(salesLinkSku && erpSkus.length >= 4 && reviewer, "隔离库缺少V1.1测试所需基础数据。");

  database.prepare(`INSERT INTO sales_link_sku_combo_groups
    (id,salesLinkSkuId,groupCode,status,sourceType,sourceCandidateIdsJson,createdBy,createdAt,updatedAt)
    VALUES ('v11-legacy-group',?,'CG-V11-LEGACY','pending','schema_v11','[]',?,?,?)`).run(salesLinkSku.id, reviewer.id, now, now);

  database.pragma("foreign_keys = OFF");
  database.exec(`
    DROP TRIGGER IF EXISTS trg_combo_component_approved_insert;
    DROP TRIGGER IF EXISTS trg_combo_component_approved_update;
    DROP TRIGGER IF EXISTS trg_combo_group_approval_insert;
    DROP TRIGGER IF EXISTS trg_combo_group_approval_update;
    DROP TABLE sales_link_sku_combo_group_components;
    CREATE TABLE sales_link_sku_combo_group_components (
      id TEXT PRIMARY KEY,
      comboGroupId TEXT NOT NULL,
      erpSkuId TEXT NOT NULL,
      quantity REAL NOT NULL,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'included',
      sourceCandidateId TEXT,
      decisionNote TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY(comboGroupId) REFERENCES sales_link_sku_combo_groups(id),
      FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id),
      FOREIGN KEY(sourceCandidateId) REFERENCES sales_link_sku_erp_mapping_candidates(id),
      UNIQUE(comboGroupId,erpSkuId),
      CHECK(quantity > 0),
      CHECK(status IN ('included','excluded'))
    );
  `);
  database.prepare(`INSERT INTO sales_link_sku_combo_group_components
    (id,comboGroupId,erpSkuId,quantity,sortOrder,status,createdAt,updatedAt)
    VALUES ('v11-legacy-component','v11-legacy-group',?,2,1,'included',?,?)`).run(erpSkus[0].id, now, now);
  database.pragma("foreign_keys = ON");

  migrateSalesLinkSkuComboGroupsV1();
  const columns = database.prepare("PRAGMA table_info(sales_link_sku_combo_group_components)").all();
  const quantity = columns.find((column) => column.name === "quantity");
  const quantitySource = columns.find((column) => column.name === "quantitySource");
  assert(quantity?.notnull === 0, "quantity迁移后仍为NOT NULL。");
  assert(quantitySource?.notnull === 0, "quantitySource必须允许NULL。");
  const migratedLegacy = database.prepare("SELECT quantity,quantitySource FROM sales_link_sku_combo_group_components WHERE id='v11-legacy-component'").get();
  assert(migratedLegacy.quantity === 2 && migratedLegacy.quantitySource === null, "旧组件数量未安全保留为未确认来源。");

  const insertGroup = database.prepare(`INSERT INTO sales_link_sku_combo_groups
    (id,salesLinkSkuId,groupCode,status,sourceType,sourceCandidateIdsJson,createdBy,createdAt,updatedAt)
    VALUES (?,?,?,'pending','schema_v11','[]',?,?,?)`);
  insertGroup.run("v11-draft-group", salesLinkSku.id, "CG-V11-DRAFT", reviewer.id, now, now);
  insertGroup.run("v11-invalid-group", salesLinkSku.id, "CG-V11-INVALID", reviewer.id, now, now);
  const insertComponent = database.prepare(`INSERT INTO sales_link_sku_combo_group_components
    (id,comboGroupId,erpSkuId,quantity,quantitySource,sortOrder,status,createdAt,updatedAt)
    VALUES (?,?,?,?,?,?,?, ?,?)`);

  insertComponent.run("v11-null-component", "v11-draft-group", erpSkus[1].id, null, null, 1, "included", now, now);
  assert(database.prepare("SELECT quantity,quantitySource FROM sales_link_sku_combo_group_components WHERE id='v11-null-component'").get().quantity === null, "NULL quantity组件未保存。");
  expectFailure(() => insertComponent.run("v11-zero-component", "v11-invalid-group", erpSkus[1].id, 0, null, 1, "included", now, now), "quantity=0未被阻止。");
  expectFailure(() => insertComponent.run("v11-negative-component", "v11-invalid-group", erpSkus[2].id, -1, null, 1, "included", now, now), "负quantity未被阻止。");
  expectFailure(() => insertComponent.run("v11-source-component", "v11-invalid-group", erpSkus[3].id, 1, "daily_inference", 1, "included", now, now), "非法quantitySource未被阻止。");

  const approve = database.prepare(`UPDATE sales_link_sku_combo_groups SET status='approved',reviewedBy=?,reviewedAt=?,approvedAt=?,updatedAt=? WHERE id=?`);
  expectFailure(() => approve.run(reviewer.id, now, now, now, "v11-draft-group"), "含未确认quantity的Group被批准。");
  database.prepare(`UPDATE sales_link_sku_combo_group_components
    SET quantity=3,quantitySource='manual_confirmation',updatedAt=? WHERE id='v11-null-component'`).run(now);
  approve.run(reviewer.id, now, now, now, "v11-draft-group");
  assert(database.prepare("SELECT status FROM sales_link_sku_combo_groups WHERE id='v11-draft-group'").get().status === "approved", "全部数量人工确认后Group仍无法批准。");
  expectFailure(() => insertComponent.run("v11-approved-null", "v11-draft-group", erpSkus[2].id, null, null, 2, "included", now, now), "approved Group允许新增未确认quantity组件。");

  const schemaBeforeRepeat = {
    tableSql: database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='sales_link_sku_combo_group_components'").get().sql,
    triggers: database.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_combo_%' ORDER BY name").all(),
    indexes: database.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name='sales_link_sku_combo_group_components' ORDER BY name").all(),
    rows: count(database, "sales_link_sku_combo_group_components"),
  };
  migrateSalesLinkSkuComboGroupsV1();
  const schemaAfterRepeat = {
    tableSql: database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='sales_link_sku_combo_group_components'").get().sql,
    triggers: database.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_combo_%' ORDER BY name").all(),
    indexes: database.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name='sales_link_sku_combo_group_components' ORDER BY name").all(),
    rows: count(database, "sales_link_sku_combo_group_components"),
  };
  assert(JSON.stringify(schemaAfterRepeat) === JSON.stringify(schemaBeforeRepeat), "V1.1重复迁移不幂等。");

  const protectedAfter = {
    mappings: count(database, "sales_link_sku_erp_mappings"),
    dailyFacts: count(database, "connection_sku_sales_daily_facts"),
    periodFacts: count(database, "connection_sku_sales_facts"),
  };
  assert(JSON.stringify(protectedAfter) === JSON.stringify(protectedBefore), "V1.1验证改变了正式mapping或销售事实。");
  const integrity = database.pragma("integrity_check", { simple: true });
  const foreignKeyErrors = database.pragma("foreign_key_check");
  assert(integrity === "ok", `integrity_check失败：${integrity}`);
  assert(foreignKeyErrors.length === 0, `foreign_key_check发现${foreignKeyErrors.length}条异常。`);

  console.log(JSON.stringify({
    success: true,
    sourcePath,
    sourceSha256: sha256(sourcePath),
    isolatedDatabasePath: databasePath,
    migration: { v10ToV11: true, idempotent: true, legacyQuantityPreservedAsUnconfirmed: true },
    fields: { quantityNullable: true, quantitySourceNullable: true },
    constraints: { nullQuantitySaved: true, zeroBlocked: true, negativeBlocked: true, invalidSourceBlocked: true, unconfirmedApprovalBlocked: true, confirmedApprovalAllowed: true },
    protected: protectedAfter,
    integrityCheck: integrity,
    foreignKeyCheckErrors: foreignKeyErrors.length,
  }, null, 2));
} finally {
  closeDatabase();
  if (fs.existsSync(databasePath)) fs.unlinkSync(databasePath);
}
