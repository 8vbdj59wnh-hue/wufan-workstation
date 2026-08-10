import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sourcePath = process.argv[2] ? path.resolve(process.argv[2]) : null;
const databasePath = path.join(os.tmpdir(), `wufan-combo-group-schema-${process.pid}-${Date.now()}.db`);
if (sourcePath) fs.copyFileSync(sourcePath, databasePath);
process.env.WUFAN_DB_PATH = databasePath;

const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const count = (database, table) => database.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total;
const expectConstraint = (operation, message) => {
  try { operation(); } catch (error) {
    assert(/constraint failed/i.test(String(error.message)), `${message}：${error.message}`);
    return;
  }
  throw new Error(message);
};
const sha256 = (filePath) => crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");

try {
  initializeDatabase({ reset: !sourcePath });
  const database = getDatabase();
  database.pragma("foreign_keys = ON");
  const now = new Date().toISOString();
  const before = {
    mappings: count(database, "sales_link_sku_erp_mappings"),
    dailyFacts: count(database, "connection_sku_sales_daily_facts"),
    periodFacts: count(database, "connection_sku_sales_facts"),
  };

  const groupColumns = database.prepare("PRAGMA table_info(sales_link_sku_combo_groups)").all();
  const componentColumns = database.prepare("PRAGMA table_info(sales_link_sku_combo_group_components)").all();
  const mappingColumns = database.prepare("PRAGMA table_info(sales_link_sku_erp_mappings)").all();
  const expectedGroupColumns = ["id", "salesLinkSkuId", "groupCode", "status", "sourceType", "sourceBatchId", "sourceFileHash", "sourceCandidateIdsJson", "reviewedBy", "reviewedAt", "reviewNote", "approvedAt", "invalidatedAt", "replacedGroupId", "createdBy", "createdAt", "updatedAt"];
  const expectedComponentColumns = ["id", "comboGroupId", "erpSkuId", "quantity", "sortOrder", "status", "sourceCandidateId", "decisionNote", "createdAt", "updatedAt"];
  assert(groupColumns.map(({ name }) => name).join("|") === expectedGroupColumns.join("|"), "Combo Group字段定义不完整。");
  assert(componentColumns.map(({ name }) => name).join("|") === expectedComponentColumns.join("|"), "Combo组件字段定义不完整。");
  assert(mappingColumns.some(({ name }) => name === "comboGroupId"), "Mapping缺少可空comboGroupId追溯字段。");
  assert(mappingColumns.find(({ name }) => name === "comboGroupId").notnull === 0, "Mapping comboGroupId必须可空。");

  const foreignKeyMap = (table) => new Map(database.prepare(`PRAGMA foreign_key_list(${table})`).all().map((item) => [item.from, `${item.table}.${item.to}`]));
  const groupForeignKeys = foreignKeyMap("sales_link_sku_combo_groups");
  const componentForeignKeys = foreignKeyMap("sales_link_sku_combo_group_components");
  const mappingForeignKeys = foreignKeyMap("sales_link_sku_erp_mappings");
  assert(groupForeignKeys.get("salesLinkSkuId") === "sales_link_skus.id", "Combo Group平台SKU外键错误。");
  assert(componentForeignKeys.get("comboGroupId") === "sales_link_sku_combo_groups.id", "组件Group外键错误。");
  assert(componentForeignKeys.get("erpSkuId") === "erp_skus.id", "组件ERP SKU外键错误。");
  assert(mappingForeignKeys.get("comboGroupId") === "sales_link_sku_combo_groups.id", "Mapping追溯外键错误。");

  let salesLinkSku = database.prepare("SELECT id FROM sales_link_skus LIMIT 1").get();
  let erpSkus = database.prepare("SELECT id FROM erp_skus LIMIT 2").all();
  let reviewer = database.prepare("SELECT id FROM persons LIMIT 1").get();
  if (!salesLinkSku || erpSkus.length < 2 || !reviewer) throw new Error("隔离库缺少关系测试所需基础数据。");

  const insertGroup = database.prepare(`INSERT INTO sales_link_sku_combo_groups
    (id,salesLinkSkuId,groupCode,status,sourceType,sourceCandidateIdsJson,reviewedBy,reviewedAt,approvedAt,createdBy,createdAt,updatedAt)
    VALUES (@id,@salesLinkSkuId,@groupCode,@status,'schema_isolation','[]',@reviewedBy,@reviewedAt,@approvedAt,@createdBy,@createdAt,@updatedAt)`);
  const groupBase = { salesLinkSkuId: salesLinkSku.id, reviewedBy: reviewer.id, reviewedAt: now, approvedAt: now, createdBy: reviewer.id, createdAt: now, updatedAt: now };
  insertGroup.run({ ...groupBase, id: "combo-group-approved", groupCode: "CG-SCHEMA-001", status: "approved" });
  insertGroup.run({ ...groupBase, id: "combo-group-pending-1", groupCode: "CG-SCHEMA-002", status: "pending", reviewedBy: null, reviewedAt: null, approvedAt: null });
  insertGroup.run({ ...groupBase, id: "combo-group-pending-2", groupCode: "CG-SCHEMA-003", status: "pending", reviewedBy: null, reviewedAt: null, approvedAt: null });

  expectConstraint(() => insertGroup.run({ ...groupBase, id: "combo-group-duplicate-code", groupCode: "CG-SCHEMA-001", status: "pending", reviewedBy: null, reviewedAt: null, approvedAt: null }), "groupCode唯一约束未生效。");
  expectConstraint(() => insertGroup.run({ ...groupBase, id: "combo-group-second-approved", groupCode: "CG-SCHEMA-004", status: "approved" }), "同一平台SKU多个approved组未被阻止。");
  expectConstraint(() => insertGroup.run({ ...groupBase, id: "combo-group-invalid-status", groupCode: "CG-SCHEMA-005", status: "invalid", reviewedBy: null, reviewedAt: null, approvedAt: null }), "Group非法状态未被阻止。");
  expectConstraint(() => insertGroup.run({ ...groupBase, id: "combo-group-invalid-approval", groupCode: "CG-SCHEMA-006", status: "approved", reviewedBy: null, reviewedAt: null, approvedAt: null }), "approved审核字段约束未生效。");
  expectConstraint(() => insertGroup.run({ ...groupBase, id: "combo-group-invalid-sku", groupCode: "CG-SCHEMA-007", status: "pending", salesLinkSkuId: "missing-sales-link-sku", reviewedBy: null, reviewedAt: null, approvedAt: null }), "非法平台SKU外键未被阻止。");

  const insertComponent = database.prepare(`INSERT INTO sales_link_sku_combo_group_components
    (id,comboGroupId,erpSkuId,quantity,sortOrder,status,createdAt,updatedAt)
    VALUES (?,?,?,?,?,?,?,?)`);
  insertComponent.run("combo-component-1", "combo-group-approved", erpSkus[0].id, 1, 1, "included", now, now);
  insertComponent.run("combo-component-2", "combo-group-approved", erpSkus[1].id, 5, 2, "included", now, now);
  expectConstraint(() => insertComponent.run("combo-component-duplicate", "combo-group-approved", erpSkus[0].id, 2, 3, "included", now, now), "同组重复ERP SKU未被阻止。");
  expectConstraint(() => insertComponent.run("combo-component-zero", "combo-group-pending-1", erpSkus[0].id, 0, 1, "included", now, now), "quantity=0未被阻止。");
  expectConstraint(() => insertComponent.run("combo-component-negative", "combo-group-pending-1", erpSkus[0].id, -1, 1, "included", now, now), "负quantity未被阻止。");
  expectConstraint(() => insertComponent.run("combo-component-status", "combo-group-pending-1", erpSkus[0].id, 1, 1, "invalid", now, now), "组件非法状态未被阻止。");
  expectConstraint(() => insertComponent.run("combo-component-erp-fk", "combo-group-pending-1", "missing-erp-sku", 1, 1, "included", now, now), "非法ERP SKU未被阻止。");
  expectConstraint(() => insertComponent.run("combo-component-group-fk", "missing-combo-group", erpSkus[0].id, 1, 1, "included", now, now), "非法Combo Group未被阻止。");
  expectConstraint(() => database.prepare("DELETE FROM erp_skus WHERE id=?").run(erpSkus[0].id), "被组件引用的ERP SKU允许删除。");
  expectConstraint(() => database.prepare("DELETE FROM sales_link_skus WHERE id=?").run(salesLinkSku.id), "被Group引用的平台SKU允许删除。");
  expectConstraint(() => database.prepare("DELETE FROM sales_link_sku_combo_groups WHERE id='combo-group-approved'").run(), "被组件引用的Group允许删除。");

  const components = database.prepare(`SELECT erpSkuId,quantity FROM sales_link_sku_combo_group_components
    WHERE comboGroupId='combo-group-approved' AND status='included' ORDER BY sortOrder,id`).all();
  const simulatedMappings = [{ erpSkuId: erpSkus[0].id, quantity: 1 }, { erpSkuId: erpSkus[1].id, quantity: 5 }];
  assert(JSON.stringify(components) === JSON.stringify(simulatedMappings), "Group组件集合与模拟mapping集合不一致。");
  assert(count(database, "sales_link_sku_erp_mappings") === before.mappings, "关系一致性模拟不应写入正式mapping。");
  assert(database.prepare("SELECT COUNT(*) AS total FROM sales_link_sku_erp_mappings WHERE comboGroupId IS NOT NULL").get().total === 0, "已有mapping被错误关联到Combo Group。");

  const schemaBeforeRepeat = {
    groups: database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='sales_link_sku_combo_groups'").get().sql,
    components: database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='sales_link_sku_combo_group_components'").get().sql,
    groupIndexes: database.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name='sales_link_sku_combo_groups' ORDER BY name").all(),
    componentIndexes: database.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name='sales_link_sku_combo_group_components' ORDER BY name").all(),
    mappingColumns: database.prepare("PRAGMA table_info(sales_link_sku_erp_mappings)").all().length,
  };
  initializeDatabase({ reset: false });
  const schemaAfterRepeat = {
    groups: database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='sales_link_sku_combo_groups'").get().sql,
    components: database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='sales_link_sku_combo_group_components'").get().sql,
    groupIndexes: database.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name='sales_link_sku_combo_groups' ORDER BY name").all(),
    componentIndexes: database.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name='sales_link_sku_combo_group_components' ORDER BY name").all(),
    mappingColumns: database.prepare("PRAGMA table_info(sales_link_sku_erp_mappings)").all().length,
  };
  assert(JSON.stringify(schemaAfterRepeat) === JSON.stringify(schemaBeforeRepeat), "第二次迁移改变了Schema或重复创建结构。");

  const after = {
    mappings: count(database, "sales_link_sku_erp_mappings"),
    dailyFacts: count(database, "connection_sku_sales_daily_facts"),
    periodFacts: count(database, "connection_sku_sales_facts"),
  };
  assert(JSON.stringify(after) === JSON.stringify(before), "迁移或验证改变了受保护事实/正式mapping数量。");
  const integrity = database.pragma("integrity_check", { simple: true });
  const foreignKeyErrors = database.pragma("foreign_key_check");
  assert(integrity === "ok", `integrity_check失败：${integrity}`);
  assert(foreignKeyErrors.length === 0, `foreign_key_check发现${foreignKeyErrors.length}条异常。`);

  console.log(JSON.stringify({
    success: true,
    sourcePath,
    sourceSha256: sourcePath ? sha256(sourcePath) : null,
    isolatedDatabasePath: databasePath,
    fields: { groups: groupColumns.length, components: componentColumns.length, mappingComboGroupNullable: true },
    constraints: { duplicateErpBlocked: true, nonPositiveQuantityBlocked: true, invalidStatusBlocked: true, oneApprovedPerSalesLinkSku: true, multiplePendingAllowed: true, approvedAuditRequired: true },
    foreignKeys: { groupToSalesLinkSku: true, componentToGroup: true, componentToErpSku: true, mappingToGroup: true, referencedDeletesBlocked: true },
    relationSimulation: { components, mappingRowsWritten: 0, setsEqual: true },
    migrationIdempotent: true,
    protected: after,
    integrityCheck: integrity,
    foreignKeyCheckErrors: foreignKeyErrors.length,
  }, null, 2));
} finally {
  closeDatabase();
  if (fs.existsSync(databasePath)) fs.unlinkSync(databasePath);
}
