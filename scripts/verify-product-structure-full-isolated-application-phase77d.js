import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { previewProductStructures } from "../server/productStructureMasterDataService.js";

const [sourceDatabasePath, currentAnalysisPath, phase77cAnalysisPath, salesFilePath, outputDir] = process.argv.slice(2).map((value) => value ? path.resolve(value) : value);
if (![sourceDatabasePath, currentAnalysisPath, phase77cAnalysisPath, salesFilePath, outputDir].every(Boolean)) throw new Error("参数不足：生产快照、当前分析、7-7C分析、销售文件、输出目录均为必填。");
const beforeCopyPath = "/tmp/business001-phase77d-isolated-before.db";
const workingDatabasePath = "/tmp/business001-phase77d-isolated-working.db";
const sha256 = (filePath) => crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
const stableId = (...parts) => crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const count = (database, table, where = "") => Number(database.prepare(`SELECT COUNT(*) total FROM ${table} ${where}`).get().total || 0);
const money = (value) => Number(Number(value || 0).toFixed(4));
const canonical = (rows) => [...rows].map((row) => ({ erpSkuId: row.erpSkuId, quantity: Number(row.quantity) })).sort((a, b) => a.erpSkuId.localeCompare(b.erpSkuId));

fs.copyFileSync(sourceDatabasePath, beforeCopyPath);
fs.copyFileSync(sourceDatabasePath, workingDatabasePath);
const sourceSha = sha256(sourceDatabasePath);
assert(sourceSha === sha256(beforeCopyPath), "应用前保留副本SHA与生产快照不一致。");
process.env.WUFAN_DB_PATH = workingDatabasePath;

const { closeDatabase, getDatabase, initializeDatabase } = await import("../server/db.js");
const { createProductStructureApplicationBatch, simulateApprovedProductStructureApplication } = await import("../server/productStructureApplicationApprovalService.js");
const { resolveLinkSkuErpRelations } = await import("../server/capabilities/resolveLinkSkuErpRelation.js");
const { evaluateSalesDailyFactCoverage, previewSalesDailyFacts } = await import("../server/salesDailyFactPreviewService.js");

function baseline(database) {
  const tableExists = (table) => Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
  return {
    productStructures: tableExists("sales_link_sku_product_structures") ? count(database, "sales_link_sku_product_structures") : 0,
    activeProductStructures: tableExists("sales_link_sku_product_structures") ? count(database, "sales_link_sku_product_structures", "WHERE status='active'") : 0,
    productStructureComponents: tableExists("sales_link_sku_product_structure_components") ? count(database, "sales_link_sku_product_structure_components") : 0,
    activeMappings: count(database, "sales_link_sku_erp_mappings", "WHERE currentState='active'"),
    mappedSalesLinkSkus: Number(database.prepare("SELECT COUNT(DISTINCT salesLinkSkuId) total FROM sales_link_sku_erp_mappings WHERE currentState='active'").get().total || 0),
    dailyFacts: count(database, "connection_sku_sales_daily_facts"),
    erpUsages: count(database, "erp_sku_business_usages"),
    productMappings: count(database, "product_erp_mappings"),
    erpSkus: count(database, "erp_skus"),
    products: count(database, "products"),
    comboGroups: count(database, "sales_link_sku_combo_groups"),
    comboComponents: count(database, "sales_link_sku_combo_group_components"),
  };
}

function aggregateCoverage(evaluation) {
  const byCategory = {};
  for (const row of evaluation.rows) {
    const category = row.category;
    const bucket = byCategory[category] || { rows: 0, salesAmount: 0, profitAmount: 0 };
    bucket.rows += 1; bucket.salesAmount += Number(row.normalized.salesAmount || 0); bucket.profitAmount += Number(row.normalized.profitAmount || 0);
    byCategory[category] = bucket;
  }
  for (const bucket of Object.values(byCategory)) { bucket.salesAmount = money(bucket.salesAmount); bucket.profitAmount = money(bucket.profitAmount); }
  return byCategory;
}

function locateOrCreateEvaluation(database) {
  const sourceHash = sha256(salesFilePath);
  const batches = database.prepare("SELECT id,previewSummaryJson FROM connection_import_batches WHERE importType='sales_daily_fact_preview' ORDER BY createdAt DESC").all();
  const existing = batches.find((batch) => { try { return JSON.parse(batch.previewSummaryJson || "{}").sourceFileHash === sourceHash; } catch { return false; } });
  if (existing) return evaluateSalesDailyFactCoverage(existing.id, { ignoreExistingDailyFacts: true });
  const preview = previewSalesDailyFacts({ buffer: fs.readFileSync(salesFilePath), fileName: path.basename(salesFilePath) });
  return evaluateSalesDailyFactCoverage(preview.batch.id, { ignoreExistingDailyFacts: true });
}

function relationCoverage(database, evaluation) {
  const skuIds = [...new Set(evaluation.rows.map((row) => row.identity?.salesLinkSkuId).filter(Boolean))];
  const resolved = resolveLinkSkuErpRelations({ salesLinkSkuIds: skuIds }, { database }).results;
  const nonProductCategories = new Set(["accounting_auxiliary", "shipping_adjustment", "other_adjustment", "excluded"]);
  const totals = { sourceRows: 0, sourceSalesAmount: 0, sourceProfitAmount: 0, productUniverseRows: 0, productUniverseSalesAmount: 0, productUniverseProfitAmount: 0, coveredRows: 0, coveredSalesAmount: 0, coveredProfitAmount: 0 };
  for (const row of evaluation.rows) {
    const sales = Number(row.normalized.salesAmount || 0); const profit = Number(row.normalized.profitAmount || 0);
    if (row.category === "excluded") continue;
    totals.sourceRows += 1; totals.sourceSalesAmount += sales; totals.sourceProfitAmount += profit;
    if (nonProductCategories.has(row.category)) continue;
    totals.productUniverseRows += 1; totals.productUniverseSalesAmount += sales; totals.productUniverseProfitAmount += profit;
    const relation = resolved[row.identity?.salesLinkSkuId];
    if (relation?.relationStatus === "active_complete" && relation.isUsable && relation.mappings.some((mapping) => mapping.erpSkuId === row.identity?.erpSkuId)) {
      totals.coveredRows += 1; totals.coveredSalesAmount += sales; totals.coveredProfitAmount += profit;
    }
  }
  for (const key of Object.keys(totals)) if (key.includes("Amount")) totals[key] = money(totals[key]);
  totals.uncoveredSalesAmount = money(totals.productUniverseSalesAmount - totals.coveredSalesAmount);
  totals.uncoveredProfitAmount = money(totals.productUniverseProfitAmount - totals.coveredProfitAmount);
  totals.salesCoverage = totals.productUniverseSalesAmount ? totals.coveredSalesAmount / totals.productUniverseSalesAmount : null;
  totals.rowCoverage = totals.productUniverseRows ? totals.coveredRows / totals.productUniverseRows : null;
  return { totals, resolved };
}

function detailedClassification(evaluation) {
  const result = {};
  const add = (key, row) => {
    const bucket = result[key] || { rows: 0, salesAmount: 0, profitAmount: 0 };
    bucket.rows += 1; bucket.salesAmount += Number(row.normalized.salesAmount || 0); bucket.profitAmount += Number(row.normalized.profitAmount || 0); result[key] = bucket;
  };
  for (const row of evaluation.rows) {
    if (row.category === "unknown") {
      const usageUnknown = row.errorType === "ERP_USAGE_NOT_CLASSIFIED";
      add(usageUnknown ? "erp_usage_unconfirmed" : "identity_error", row);
    } else add(row.category, row);
  }
  for (const bucket of Object.values(result)) { bucket.salesAmount = money(bucket.salesAmount); bucket.profitAmount = money(bucket.profitAmount); }
  return result;
}

function buildAnomalies(evaluation, currentAnalysis, relationResults) {
  const grouped = new Map();
  for (const row of evaluation.rows) {
    if (["ready", "accounting_auxiliary", "shipping_adjustment", "other_adjustment", "excluded"].includes(row.category)) continue;
    const key = row.identity?.salesLinkSkuId || `${row.normalized.shopName}|${row.normalized.platformGoodsId}|${row.normalized.platformSkuId}`;
    const item = grouped.get(key) || { salesLinkSkuId: row.identity?.salesLinkSkuId || null, platformGoodsId: row.normalized.platformGoodsId || null, platformSkuId: row.normalized.platformSkuId || null, categories: new Set(), errorTypes: new Set(), rows: 0, salesAmount: 0, profitAmount: 0 };
    item.categories.add(row.category); if (row.errorType) item.errorTypes.add(row.errorType); item.rows += 1; item.salesAmount += Number(row.normalized.salesAmount || 0); item.profitAmount += Number(row.normalized.profitAmount || 0); grouped.set(key, item);
  }
  const salesMismatch = new Map();
  for (const row of currentAnalysis.relations) {
    if (!["销售出现额外ERP SKU", "销售组件冲突"].includes(row.salesEvidenceStatus)) continue;
    if (!row.salesLinkSkuId || salesMismatch.has(row.salesLinkSkuId)) continue;
    salesMismatch.set(row.salesLinkSkuId, { type: "master_sales_evidence_mismatch", salesLinkSkuId: row.salesLinkSkuId, platformGoodsId: row.goodsId, platformSkuId: row.platformSkuId, rows: Number(row.salesRows || 0), salesAmount: Number(row.salesGroupSalesAmount || 0), profitAmount: Number(row.salesGroupProfitAmount || 0), evidence: row.salesEvidenceStatus, resolverStatus: relationResults[row.salesLinkSkuId]?.relationStatus || null });
  }
  const rows = [...grouped.values()].map((item) => ({ ...item, categories: [...item.categories], errorTypes: [...item.errorTypes], salesAmount: money(item.salesAmount), profitAmount: money(item.profitAmount) }));
  rows.push(...salesMismatch.values());
  return rows.sort((a, b) => Number(b.salesAmount || 0) - Number(a.salesAmount || 0));
}

try {
  const sourceReadOnly = new Database(sourceDatabasePath, { readonly: true }); const sourceBaseline = baseline(sourceReadOnly); sourceReadOnly.close();
  initializeDatabase({ reset: false });
  const database = getDatabase(); database.pragma("foreign_keys = ON"); database.pragma("journal_mode = WAL"); database.pragma("synchronous = NORMAL");
  const migratedBaseline = baseline(database);
  const currentAnalysis = JSON.parse(fs.readFileSync(currentAnalysisPath, "utf8"));
  const phase77cAnalysis = JSON.parse(fs.readFileSync(phase77cAnalysisPath, "utf8"));
  const currentMappings = database.prepare("SELECT salesLinkSkuId,erpSkuId,quantity,currentState,sourceType FROM sales_link_sku_erp_mappings WHERE currentState='active'").all();
  const currentPreview = previewProductStructures({ relationshipRows: currentAnalysis.relations, activeMappings: currentMappings });
  const phase77cScope = new Set(phase77cAnalysis.relations.filter((row) => row.status === "缺失关系" && row.salesLinkSkuId).map((row) => row.salesLinkSkuId));
  assert(phase77cScope.size === 10949, `Phase 7-7C ready范围不是10949：${phase77cScope.size}`);
  const currentBySku = new Map(currentPreview.items.map((item) => [item.salesLinkSkuId, item]));
  const evidenceBySku = new Map();
  for (const row of currentAnalysis.relations) if (row.salesLinkSkuId && !evidenceBySku.has(row.salesLinkSkuId)) evidenceBySku.set(row.salesLinkSkuId, { salesAmount: Number(row.salesGroupSalesAmount || 0), profitAmount: Number(row.salesGroupProfitAmount || 0), salesEvidenceStatus: row.salesEvidenceStatus, salesComponentCount: Number(row.salesComponentCount || 0) });
  const scopeItems = [...phase77cScope].map((salesLinkSkuId) => {
    const item = currentBySku.get(salesLinkSkuId); assert(item, `最新生产预览缺少7-7C范围SKU：${salesLinkSkuId}`);
    const evidence = evidenceBySku.get(salesLinkSkuId) || {};
    const missingSalesComponent = evidence.salesComponentCount > 1 && evidence.salesEvidenceStatus === "销售出现额外ERP SKU";
    return { ...item, previewStatus: missingSalesComponent ? "incomplete" : item.previewStatus, impactSalesAmount: evidence.salesAmount || 0, impactProfitAmount: evidence.profitAmount || 0, reclassificationReason: missingSalesComponent ? "master_structure_missing_sales_component" : null };
  });
  const reclassified = scopeItems.reduce((result, item) => { result[item.previewStatus] = (result[item.previewStatus] || 0) + 1; return result; }, {});
  const newProductionReadyOutsideScope = currentPreview.items.filter((item) => item.previewStatus === "new_structure" && !phase77cScope.has(item.salesLinkSkuId)).map((item) => item.salesLinkSkuId);
  const beforeEvaluation = locateOrCreateEvaluation(database); const beforeCategories = aggregateCoverage(beforeEvaluation); const beforeDetailedClassification = detailedClassification(beforeEvaluation); const beforeRelationCoverage = relationCoverage(database, beforeEvaluation).totals;
  const reviewer = database.prepare("SELECT id FROM persons WHERE status='active' ORDER BY CASE WHEN authRole='admin' THEN 0 ELSE 1 END,id LIMIT 1").get() || database.prepare("SELECT id FROM persons LIMIT 1").get();
  assert(reviewer, "生产副本缺少隔离审批人。");
  const batch = createProductStructureApplicationBatch({ batchCode: "PHASE-7-7D-FULL-ISOLATED", sourceType: "product_master_data_integration", sourceFileHashes: currentAnalysis.summary.files, previewItems: scopeItems, createdBy: reviewer.id }, { database });
  const approvedAt = new Date().toISOString();
  database.prepare(`UPDATE product_structure_application_items SET approvalStatus='approved',reviewedBy=?,reviewedAt=?,reviewNote='Phase 7-7D全量隔离验收',updatedAt=?
    WHERE applicationBatchId=? AND classification='ready_to_apply' AND approvalStatus='pending'`).run(reviewer.id, approvedAt, approvedAt, batch.batchId);
  const applicationItems = database.prepare("SELECT * FROM product_structure_application_items WHERE applicationBatchId=? ORDER BY id").all(batch.batchId);
  const outcomes = { applied: 0, idempotent: 0, structure_upgrade: 0, conflict: 0, incomplete: 0, failed: 0, rolled_back: 0 };
  let addedMappings = 0; let deactivatedMappings = 0;
  for (let index = 0; index < applicationItems.length; index += 1) {
    const item = applicationItems[index];
    if (item.classification === "incomplete") { outcomes.incomplete += 1; continue; }
    if (item.classification === "conflict") { outcomes.conflict += 1; continue; }
    if (item.classification === "structure_upgrade") { outcomes.structure_upgrade += 1; continue; }
    if (item.classification === "already_consistent") { outcomes.idempotent += 1; continue; }
    try {
      const beforeActive = count(database, "sales_link_sku_erp_mappings", `WHERE salesLinkSkuId='${item.salesLinkSkuId.replaceAll("'", "''")}' AND currentState='active'`);
      const result = simulateApprovedProductStructureApplication(item.id, { appliedBy: reviewer.id }, { database });
      outcomes[result.outcome] = (outcomes[result.outcome] || 0) + 1;
      if (result.outcome === "applied") { addedMappings += result.generatedMappingCount; deactivatedMappings += beforeActive; }
    } catch (error) {
      outcomes.failed += 1;
      database.prepare("UPDATE product_structure_application_items SET approvalStatus='blocked',reviewNote=?,updatedAt=? WHERE id=?").run(`运行时重新分类：${error.message}`, new Date().toISOString(), item.id);
    }
    if ((index + 1) % 1000 === 0) console.log(JSON.stringify({ progress: index + 1, total: applicationItems.length, outcomes }));
  }

  const appliedSkuIds = database.prepare(`SELECT salesLinkSkuId FROM product_structure_application_items WHERE applicationBatchId=? AND classification='ready_to_apply' AND productStructureId IN (SELECT id FROM sales_link_sku_product_structures WHERE status='active')`).all(batch.batchId).map((row) => row.salesLinkSkuId);
  const resolvedApplied = resolveLinkSkuErpRelations({ salesLinkSkuIds: appliedSkuIds }, { database }).results;
  const resolverFailures = appliedSkuIds.filter((id) => resolvedApplied[id]?.relationStatus !== "active_complete" || !resolvedApplied[id]?.isUsable || !resolvedApplied[id]?.productStructure?.isConsistent);
  const setMismatches = database.prepare(`SELECT s.id,s.salesLinkSkuId FROM sales_link_sku_product_structures s
    WHERE s.status='active' AND (
      (SELECT COUNT(*) FROM sales_link_sku_product_structure_components c WHERE c.productStructureId=s.id) <>
      (SELECT COUNT(*) FROM sales_link_sku_erp_mappings m WHERE m.productStructureId=s.id AND m.currentState='active')
      OR EXISTS (SELECT 1 FROM sales_link_sku_product_structure_components c WHERE c.productStructureId=s.id AND NOT EXISTS (
        SELECT 1 FROM sales_link_sku_erp_mappings m WHERE m.productStructureId=s.id AND m.currentState='active' AND m.erpSkuId=c.erpSkuId AND m.quantity=c.quantity
      ))
    )`).all();
  assert(resolverFailures.length === 0, `Resolver失败结构数：${resolverFailures.length}`);
  assert(setMismatches.length === 0, `结构与mapping集合不一致：${setMismatches.length}`);

  const secondPass = appliedSkuIds.reduce((result, id) => {
    const relation = resolvedApplied[id];
    if (relation.relationStatus === "active_complete" && relation.productStructure?.isConsistent) result.idempotent += 1; else result.blocked += 1;
    return result;
  }, { idempotent: 0, blocked: 0 });
  const comboExactIds = [...new Set(currentAnalysis.relations.filter((row) => row.status === "缺失关系" && row.salesComponentCount > 1 && row.salesEvidenceStatus === "销售组件一致").map((row) => row.salesLinkSkuId))];
  assert(comboExactIds.length === 444, `历史Combo完整解释对象不是444：${comboExactIds.length}`);
  const comboResults = resolveLinkSkuErpRelations({ salesLinkSkuIds: comboExactIds }, { database }).results;
  const comboFailures = comboExactIds.filter((id) => comboResults[id]?.relationStatus !== "active_complete" || comboResults[id]?.relationshipShape !== "multi_component" || !comboResults[id]?.productStructure?.isConsistent);
  const blockedEleven = scopeItems.filter((item) => item.reclassificationReason === "master_structure_missing_sales_component");
  assert(blockedEleven.length === 11, `缺组件阻断对象不是11：${blockedEleven.length}`);
  assert(comboFailures.length === 0, `444个历史Combo中Resolver失败${comboFailures.length}个。`);

  const afterEvaluation = locateOrCreateEvaluation(database); const afterCategories = aggregateCoverage(afterEvaluation); const afterDetailedClassification = detailedClassification(afterEvaluation); const relationAfter = relationCoverage(database, afterEvaluation);
  const anomalies = buildAnomalies(afterEvaluation, currentAnalysis, relationAfter.resolved);
  const afterBaseline = baseline(database);
  const integrity = database.pragma("integrity_check", { simple: true }); const foreignKeyErrors = database.pragma("foreign_key_check");
  assert(integrity === "ok" && foreignKeyErrors.length === 0, "隔离应用后数据库完整性失败。");
  assert(sha256(sourceDatabasePath) === sourceSha && sha256(beforeCopyPath) === sourceSha, "生产快照或应用前副本发生变化。");
  assert(afterBaseline.dailyFacts === migratedBaseline.dailyFacts && afterBaseline.erpUsages === migratedBaseline.erpUsages && afterBaseline.erpSkus === migratedBaseline.erpSkus && afterBaseline.products === migratedBaseline.products && afterBaseline.productMappings === migratedBaseline.productMappings && afterBaseline.comboGroups === migratedBaseline.comboGroups && afterBaseline.comboComponents === migratedBaseline.comboComponents, "受保护业务数据发生变化。");

  const result = {
    success: true, sourceDatabasePath, sourceDatabaseSha256: sourceSha, beforeCopyPath, beforeCopySha256: sha256(beforeCopyPath), workingDatabasePath,
    sourceBaseline, migratedBaseline, phase77cScopeCount: phase77cScope.size, latestProductionPreview: currentPreview.summary,
    newProductionReadyOutsideScope, reclassified, applicationBatch: batch, outcomes, addedMappings, deactivatedMappings,
    final: afterBaseline, secondPass, resolverFailures: resolverFailures.length, setMismatches: setMismatches.length,
    comboValidation: { expected: 444, passed: 444 - comboFailures.length, failed: comboFailures.length, blockedMissingComponents: blockedEleven.length },
    sales: { sourceAtomic: currentAnalysis.summary.salesSource, beforeCategories, afterCategories, beforeDetailedClassification, afterDetailedClassification, beforeRelationCoverage, afterRelationCoverage: relationAfter.totals },
    anomalyCount: anomalies.length, integrityCheck: integrity, foreignKeyCheckErrors: foreignKeyErrors.length,
    protection: { sourceSnapshotUnchanged: true, beforeCopyPreserved: true, dailyFactsUnchanged: true, erpUsagesUnchanged: true, erpSkusUnchanged: true, productsUnchanged: true, productMappingsUnchanged: true, comboAssetsUnchanged: true },
  };
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "result.json"), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(outputDir, "anomalies.json"), JSON.stringify(anomalies, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  closeDatabase();
}
