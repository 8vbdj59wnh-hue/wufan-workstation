import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { previewProductStructures } from "../server/productStructureMasterDataService.js";

const sourceDatabasePath = path.resolve(process.argv[2]);
const analysisPath = path.resolve(process.argv[3]);
const isolatedDatabasePath = path.join(os.tmpdir(), `business001-product-structure-${process.pid}-${Date.now()}.db`);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sha256 = (filePath) => crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
const count = (database, table) => database.prepare(`SELECT COUNT(*) total FROM ${table}`).get().total;
const expectConstraint = (operation, message) => {
  try { operation(); } catch (error) {
    assert(/constraint|product structure/i.test(String(error.message)), `${message}: ${error.message}`);
    return;
  }
  throw new Error(message);
};

if (!sourceDatabasePath || !analysisPath) throw new Error("需要隔离源数据库和Phase 7-7A分析JSON路径。");
const sourceHashBefore = sha256(sourceDatabasePath);
const source = new Database(sourceDatabasePath, { readonly: true });
const protectedTables = [
  "sales_link_sku_erp_mappings", "connection_sku_sales_daily_facts", "erp_sku_business_usages",
  "erp_skus", "products", "product_erp_mappings", "sales_link_sku_combo_groups", "sales_link_sku_combo_group_components",
];
const protectedBefore = Object.fromEntries(protectedTables.map((table) => [table, count(source, table)]));
source.close();
fs.copyFileSync(sourceDatabasePath, isolatedDatabasePath);
process.env.WUFAN_DB_PATH = isolatedDatabasePath;

const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");
try {
  initializeDatabase({ reset: false });
  const database = getDatabase();
  database.pragma("foreign_keys = ON");
  const analysis = JSON.parse(fs.readFileSync(analysisPath, "utf8"));
  for (const [filePath, metadata] of Object.entries(analysis.summary.files)) {
    assert(fs.existsSync(filePath), `验证源文件不存在：${filePath}`);
    assert(sha256(filePath) === metadata.sha256, `验证源文件已变化：${filePath}`);
  }

  const activeMappings = database.prepare(`SELECT salesLinkSkuId,erpSkuId,quantity,currentState
    FROM sales_link_sku_erp_mappings WHERE currentState='active'`).all();
  const preview = previewProductStructures({ relationshipRows: analysis.relations, activeMappings });
  preview.summary.unmatched = Number(analysis.summary.platform.shop_unmatched || 0)
    + Number(analysis.summary.platform.link_unmatched || 0)
    + Number(analysis.summary.platform.sku_unmatched || 0);

  assert(preview.summary.already_consistent === 20820, "已有一致结构数量不符合基线。");
  assert(preview.summary.new_structure === 10949, "新结构数量不符合基线。");
  assert(preview.summary.structure_upgrade === 0, "主数据不应产生静默升级项。");
  assert(preview.summary.conflict === 0, "主数据与正式关系不应出现未解释冲突。");
  assert(preview.summary.componentRows === 43323, "结构组件总数不符合基线。");
  assert(preview.summary.unmatched === 1341, "未匹配平台货品数量不符合基线。");

  const tableNames = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
  assert(tableNames.has("sales_link_sku_product_structures"), "缺少统一货品结构表。");
  assert(tableNames.has("sales_link_sku_product_structure_components"), "缺少统一货品结构组件表。");
  const mappingColumns = database.prepare("PRAGMA table_info(sales_link_sku_erp_mappings)").all();
  assert(mappingColumns.some((column) => column.name === "productStructureId" && column.notnull === 0), "mapping缺少可空结构追溯字段。");

  const sku = database.prepare("SELECT id FROM sales_link_skus LIMIT 1").get();
  const erps = database.prepare("SELECT id FROM erp_skus LIMIT 2").all();
  const reviewer = database.prepare("SELECT id FROM persons LIMIT 1").get();
  assert(sku && erps.length === 2 && reviewer, "隔离库缺少Schema验证基础数据。");
  const stamp = new Date().toISOString();
  database.prepare(`INSERT INTO sales_link_sku_product_structures
    (id,salesLinkSkuId,structureCode,structureHash,status,sourceType,sourceReferenceJson,createdAt,updatedAt)
    VALUES ('structure-test-1',?,?,?,'draft','schema_isolation','{}',?,?)`)
    .run(sku.id, "PS-TEST-1", "hash-test-1", stamp, stamp);
  const insertComponent = database.prepare(`INSERT INTO sales_link_sku_product_structure_components
    (id,productStructureId,erpSkuId,quantity,sortOrder,sourceType,sourceReferenceJson,createdAt,updatedAt)
    VALUES (?,?,?,?,?,'schema_isolation','{}',?,?)`);
  insertComponent.run("structure-component-1", "structure-test-1", erps[0].id, 1, 1, stamp, stamp);
  insertComponent.run("structure-component-2", "structure-test-1", erps[1].id, 5, 2, stamp, stamp);
  expectConstraint(() => insertComponent.run("structure-component-duplicate", "structure-test-1", erps[0].id, 2, 3, stamp, stamp), "同结构重复ERP组件未阻断。");
  expectConstraint(() => insertComponent.run("structure-component-zero", "structure-test-1", erps[0].id, 0, 3, stamp, stamp), "非正quantity未阻断。");
  database.prepare(`UPDATE sales_link_sku_product_structures SET status='active',reviewedBy=?,reviewedAt=?,activatedAt=?,updatedAt=? WHERE id='structure-test-1'`)
    .run(reviewer.id, stamp, stamp, stamp);
  expectConstraint(() => database.prepare(`INSERT INTO sales_link_sku_product_structures
    (id,salesLinkSkuId,structureCode,structureHash,status,sourceType,sourceReferenceJson,reviewedBy,reviewedAt,activatedAt,createdAt,updatedAt)
    VALUES ('structure-test-2',?,?,?,'active','schema_isolation','{}',?,?,?,?,?)`)
    .run(sku.id, "PS-TEST-2", "hash-test-2", reviewer.id, stamp, stamp, stamp, stamp), "同一链接SKU多个active结构未阻断。");

  const schemaBeforeRepeat = database.prepare("SELECT name,type,sql FROM sqlite_master WHERE name LIKE 'sales_link_sku_product_structure%' ORDER BY type,name").all();
  initializeDatabase({ reset: false });
  const schemaAfterRepeat = database.prepare("SELECT name,type,sql FROM sqlite_master WHERE name LIKE 'sales_link_sku_product_structure%' ORDER BY type,name").all();
  assert(JSON.stringify(schemaBeforeRepeat) === JSON.stringify(schemaAfterRepeat), "重复迁移改变了货品结构Schema。");
  const integrity = database.pragma("integrity_check", { simple: true });
  const foreignKeyErrors = database.pragma("foreign_key_check");
  assert(integrity === "ok", `integrity_check失败：${integrity}`);
  assert(foreignKeyErrors.length === 0, `foreign_key_check发现${foreignKeyErrors.length}项。`);

  const sourceAfter = new Database(sourceDatabasePath, { readonly: true });
  const protectedAfter = Object.fromEntries(protectedTables.map((table) => [table, count(sourceAfter, table)]));
  sourceAfter.close();
  assert(sourceHashBefore === sha256(sourceDatabasePath), "源数据库文件发生变化。");
  assert(JSON.stringify(protectedBefore) === JSON.stringify(protectedAfter), "源数据库受保护数据发生变化。");

  console.log(JSON.stringify({
    success: true,
    sourceDatabasePath,
    sourceDatabaseSha256: sourceHashBefore,
    isolatedDatabasePath,
    schema: { authority: "product_structure", legacyComboRole: "governance_only", mappingTraceColumn: "productStructureId" },
    preview: preview.summary,
    salesValidation: analysis.summary.salesImpact,
    comboValidation: analysis.summary.comboSales,
    sourceFiles: analysis.summary.files,
    protectedBefore,
    protectedAfter,
    migrationIdempotent: true,
    integrityCheck: integrity,
    foreignKeyCheckErrors: foreignKeyErrors.length,
  }, null, 2));
} finally {
  closeDatabase();
  if (fs.existsSync(isolatedDatabasePath)) fs.unlinkSync(isolatedDatabasePath);
}
