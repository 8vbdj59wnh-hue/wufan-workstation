import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { previewProductStructures } from "../server/productStructureMasterDataService.js";

const sourceDatabasePath = path.resolve(process.argv[2]);
const analysisPath = path.resolve(process.argv[3]);
const isolatedDatabasePath = path.join(os.tmpdir(), `business001-product-structure-approval-${process.pid}-${Date.now()}.db`);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sha256 = (filePath) => crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
const count = (database, table) => database.prepare(`SELECT COUNT(*) total FROM ${table}`).get().total;

const sourceHashBefore = sha256(sourceDatabasePath);
const source = new Database(sourceDatabasePath, { readonly: true });
const protectedTables = ["sales_link_sku_erp_mappings", "connection_sku_sales_daily_facts", "erp_sku_business_usages", "erp_skus", "products", "product_erp_mappings", "sales_link_sku_combo_groups", "sales_link_sku_combo_group_components"];
const protectedBefore = Object.fromEntries(protectedTables.map((table) => [table, count(source, table)]));
source.close();
fs.copyFileSync(sourceDatabasePath, isolatedDatabasePath);
process.env.WUFAN_DB_PATH = isolatedDatabasePath;

const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");
const {
  buildComponentDiff, classifyStructureApplication, createProductStructureApplicationBatch,
  queryProductStructureApplicationQueue, readProductStructureApplicationPreview,
  reviewProductStructureApplicationItem, simulateApprovedProductStructureApplication,
} = await import("../server/productStructureApplicationApprovalService.js");

try {
  initializeDatabase({ reset: false });
  const database = getDatabase(); database.pragma("foreign_keys = ON");
  const reviewer = database.prepare("SELECT id FROM persons LIMIT 1").get(); assert(reviewer, "隔离库缺少审核人。");
  const analysis = JSON.parse(fs.readFileSync(analysisPath, "utf8"));
  const activeMappings = database.prepare("SELECT salesLinkSkuId,erpSkuId,quantity,currentState FROM sales_link_sku_erp_mappings WHERE currentState='active'").all();
  const preview = previewProductStructures({ relationshipRows: analysis.relations, activeMappings });
  const evidenceBySku = new Map();
  for (const row of analysis.relations) if (row.salesLinkSkuId && !evidenceBySku.has(row.salesLinkSkuId)) evidenceBySku.set(row.salesLinkSkuId, { salesAmount: Number(row.salesGroupSalesAmount || 0), profitAmount: Number(row.salesGroupProfitAmount || 0) });
  const previewItems = preview.items.map((item) => ({ ...item, impactSalesAmount: evidenceBySku.get(item.salesLinkSkuId)?.salesAmount || 0, impactProfitAmount: evidenceBySku.get(item.salesLinkSkuId)?.profitAmount || 0 }));
  const created = createProductStructureApplicationBatch({
    batchCode: "PHASE-7-7C-ISOLATED-001", sourceType: "product_master_data_integration",
    sourceFileHashes: analysis.summary.files, previewItems, createdBy: reviewer.id,
  }, { database });
  const repeated = createProductStructureApplicationBatch({ batchCode: "PHASE-7-7C-ISOLATED-001", sourceType: "product_master_data_integration", previewItems, createdBy: reviewer.id }, { database });
  assert(created.itemCount === 32998, "审批队列项目数量不符合结构预览。");
  assert(repeated.idempotent && repeated.itemCount === created.itemCount, "审批批次重复生成不幂等。");

  const classifications = Object.fromEntries(database.prepare("SELECT classification,COUNT(*) total FROM product_structure_application_items WHERE applicationBatchId=? GROUP BY classification").all(created.batchId).map((row) => [row.classification, row.total]));
  const approvals = Object.fromEntries(database.prepare("SELECT approvalStatus,COUNT(*) total FROM product_structure_application_items WHERE applicationBatchId=? GROUP BY approvalStatus").all(created.batchId).map((row) => [row.approvalStatus, row.total]));
  assert(classifications.already_consistent === 20820, "already_consistent分类错误。");
  assert(classifications.ready_to_apply === 10949, "ready_to_apply分类错误。");
  assert(classifications.incomplete === 1229, "incomplete分类错误。");
  assert((classifications.structure_upgrade || 0) === 0 && (classifications.conflict || 0) === 0, "真实主数据意外产生升级或冲突分类。");
  assert(approvals.not_required === 20820 && approvals.pending === 10949 && approvals.blocked === 1229, "默认审批状态错误。");
  assert(classifyStructureApplication("new_structure") === "ready_to_apply", "new_structure应用分类转换错误。");
  const diff = buildComponentDiff([{ erpSkuId: "A", quantity: 1 }], [{ erpSkuId: "A", quantity: 2 }, { erpSkuId: "B", quantity: 1 }]);
  assert(diff.added.length === 1 && diff.quantityChanged.length === 1 && diff.removed.length === 0, "组件差异计算错误。");

  const candidates = database.prepare(`SELECT i.* FROM product_structure_application_items i
    WHERE i.applicationBatchId=? AND i.classification='ready_to_apply' AND i.approvalStatus='pending'
      AND NOT EXISTS (SELECT 1 FROM sales_link_sku_erp_mappings m WHERE m.salesLinkSkuId=i.salesLinkSkuId)
    ORDER BY i.impactSalesAmount DESC LIMIT 2`).all(created.batchId);
  assert(candidates.length === 2, "缺少可安全模拟的ready_to_apply样本。");
  for (const item of candidates) reviewProductStructureApplicationItem(item.id, { decision: "approved", reviewedBy: reviewer.id, reviewNote: "Phase 7-7C隔离审批验证" }, { database });
  const approvalRepeat = reviewProductStructureApplicationItem(candidates[0].id, { decision: "approved", reviewedBy: reviewer.id, reviewNote: "Phase 7-7C隔离审批验证" }, { database });
  assert(approvalRepeat.idempotent, "重复审批未保持幂等。");

  const applicationPreview = readProductStructureApplicationPreview(candidates[0].id, { database });
  assert(applicationPreview.oldMappings.length === 0 && applicationPreview.generatedMappings.length > 0, "应用预览未正确展示旧关系和生成结果。");
  const mappingCountBeforeSuccess = count(database, "sales_link_sku_erp_mappings");
  const success = simulateApprovedProductStructureApplication(candidates[0].id, { appliedBy: reviewer.id }, { database });
  assert(success.outcome === "applied", "隔离应用事务未成功。");
  assert(count(database, "sales_link_sku_erp_mappings") === mappingCountBeforeSuccess + success.generatedMappingCount, "隔离应用mapping数量错误。");
  const activeStructure = database.prepare("SELECT status FROM sales_link_sku_product_structures WHERE id=?").get(candidates[0].productStructureId);
  assert(activeStructure.status === "active", "应用后结构未激活。");
  const generatedSet = database.prepare("SELECT erpSkuId,quantity FROM sales_link_sku_erp_mappings WHERE productStructureId=? AND currentState='active' ORDER BY erpSkuId").all(candidates[0].productStructureId);
  const structureSet = database.prepare("SELECT erpSkuId,quantity FROM sales_link_sku_product_structure_components WHERE productStructureId=? ORDER BY erpSkuId").all(candidates[0].productStructureId);
  assert(JSON.stringify(generatedSet) === JSON.stringify(structureSet), "结构组件集合与active mappings不一致。");

  const mappingCountBeforeFailure = count(database, "sales_link_sku_erp_mappings");
  const failure = simulateApprovedProductStructureApplication(candidates[1].id, { appliedBy: reviewer.id, failAfterDeactivate: true }, { database });
  assert(failure.outcome === "rolled_back", "模拟失败未返回回滚结果。");
  assert(count(database, "sales_link_sku_erp_mappings") === mappingCountBeforeFailure, "失败事务改变了mapping数量。");
  assert(database.prepare("SELECT status FROM sales_link_sku_product_structures WHERE id=?").get(candidates[1].productStructureId).status === "pending_review", "失败事务错误激活结构。");
  assert(database.prepare("SELECT outcome FROM product_structure_application_audits WHERE id=?").get(failure.auditId).outcome === "rolled_back", "失败回滚审计缺失。");

  const upgradeBase = database.prepare(`SELECT m.salesLinkSkuId,m.erpSkuId,m.quantity FROM sales_link_sku_erp_mappings m
    WHERE m.currentState='active' AND m.productStructureId IS NULL ORDER BY m.salesLinkSkuId LIMIT 1`).get();
  const upgradeExtra = database.prepare("SELECT id erpSkuId FROM erp_skus WHERE id<>? AND currentState='active' LIMIT 1").get(upgradeBase.erpSkuId);
  const upgradeComponents = [{ erpSkuId: upgradeBase.erpSkuId, quantity: Number(upgradeBase.quantity), sourceType: "combo_master_excel" }, { erpSkuId: upgradeExtra.erpSkuId, quantity: 2, sourceType: "combo_master_excel" }];
  const upgradeBatch = createProductStructureApplicationBatch({ batchCode: "PHASE-7-7C-UPGRADE-TEST", sourceType: "product_master_data_integration", createdBy: reviewer.id, previewItems: [{ salesLinkSkuId: upgradeBase.salesLinkSkuId, previewStatus: "structure_upgrade", relationshipShape: "multi_component", structureHash: crypto.createHash("sha256").update(JSON.stringify(upgradeComponents)).digest("hex"), components: upgradeComponents, currentMappings: [upgradeBase], sourceRows: [] }] }, { database });
  const upgradeItem = database.prepare("SELECT * FROM product_structure_application_items WHERE applicationBatchId=?").get(upgradeBatch.batchId);
  reviewProductStructureApplicationItem(upgradeItem.id, { decision: "approved", reviewedBy: reviewer.id, reviewNote: "验证共享组件的整组升级" }, { database });
  const upgradeResult = simulateApprovedProductStructureApplication(upgradeItem.id, { appliedBy: reviewer.id }, { database });
  assert(upgradeResult.outcome === "applied" && upgradeResult.generatedMappingCount === 2, "structure_upgrade模拟应用失败。");
  const upgradedMappings = database.prepare("SELECT erpSkuId,quantity,currentState,productStructureId FROM sales_link_sku_erp_mappings WHERE salesLinkSkuId=? AND currentState='active' ORDER BY erpSkuId").all(upgradeBase.salesLinkSkuId);
  assert(upgradedMappings.length === 2 && upgradedMappings.every((mapping) => mapping.productStructureId === upgradeItem.productStructureId), "structure_upgrade未形成完整active mapping集合。");

  const queue = queryProductStructureApplicationQueue(created.batchId, { classification: "ready_to_apply", page: 1, pageSize: 20 }, { database });
  assert(queue.pagination.total === 10949 && queue.items.length === 20, "审批队列分页或筛选错误。");
  const integrity = database.pragma("integrity_check", { simple: true }); const foreignKeyErrors = database.pragma("foreign_key_check");
  assert(integrity === "ok" && foreignKeyErrors.length === 0, "数据库完整性检查失败。");

  const sourceAfter = new Database(sourceDatabasePath, { readonly: true });
  const protectedAfter = Object.fromEntries(protectedTables.map((table) => [table, count(sourceAfter, table)])); sourceAfter.close();
  assert(sourceHashBefore === sha256(sourceDatabasePath) && JSON.stringify(protectedBefore) === JSON.stringify(protectedAfter), "源数据库发生变化。");
  console.log(JSON.stringify({ success: true, sourceDatabaseSha256: sourceHashBefore, isolatedDatabasePath, batch: created, classifications, approvals, queue: queue.pagination, applicationPreview, simulatedSuccess: success, simulatedUpgrade: upgradeResult, simulatedRollback: failure, auditCount: count(database, "product_structure_application_audits"), protectedBefore, protectedAfter, integrityCheck: integrity, foreignKeyCheckErrors: foreignKeyErrors.length }, null, 2));
} finally {
  closeDatabase();
  if (fs.existsSync(isolatedDatabasePath)) fs.unlinkSync(isolatedDatabasePath);
}
