import crypto from "node:crypto";
import { getDatabase } from "./db.js";
import { classifySalesDailyPreviewRows } from "./salesDailyFactPreviewService.js";
import { resolveLinkSkuErpRelations } from "./capabilities/resolveLinkSkuErpRelation.js";

const clean = (value) => String(value ?? "").trim();
const json = (value, fallback = {}) => { try { return JSON.parse(value || ""); } catch { return fallback; } };
const amount = (value) => Number(Number(value || 0).toFixed(4));
const allowedTypes = new Set(["identity_error", "missing_relation", "relation_conflict", "incomplete_structure"]);
const allowedActions = new Set(["add", "replace", "ignore"]);

function commitAudit(summary) {
  return [summary.factCommit, summary.phase710bFactCommit].filter((item) => item?.confirmedAt)
    .sort((a, b) => String(b.confirmedAt).localeCompare(String(a.confirmedAt)))[0] || null;
}
function latestCommittedBatch(database) {
  return database.prepare("SELECT * FROM connection_import_batches WHERE importType='erp_sales_daily_preview' ORDER BY createdAt DESC").all()
    .find((row) => commitAudit(json(row.previewSummaryJson))) || null;
}

function anomalyType(item) {
  if (["unknown", "error"].includes(item.result?.category)) return "identity_error";
  if (item.result?.category === "relation_conflict" && ["product_structure_incomplete", "combo_group_incomplete"].includes(item.result?.errorType)) return "incomplete_structure";
  return item.result?.category;
}

function identityReason(errorType) {
  if (["missing_shop", "ambiguous_shop"].includes(errorType)) return { code: "shop_match_failed", stage: "shop", label: "店铺无法识别" };
  if (["missing_link", "ambiguous_link"].includes(errorType)) return { code: "link_match_failed", stage: "link", label: "链接无法识别" };
  if (["missing_platform_sku", "ambiguous_platform_sku"].includes(errorType)) return { code: "sku_match_failed", stage: "salesLinkSku", label: "链接SKU无法识别" };
  if (["missing_erp_sku", "ambiguous_erp_sku"].includes(errorType)) return { code: "erp_match_failed", stage: "erpSku", label: "ERP SKU无法识别" };
  return { code: "source_data_invalid", stage: "source", label: "源明细字段异常" };
}

function loadContext(database, salesLinkSkuIds) {
  if (!salesLinkSkuIds.length) return { structures: new Map(), mappings: new Map(), resolutions: {} };
  const marks = salesLinkSkuIds.map(() => "?").join(",");
  const structures = new Map();
  for (const row of database.prepare(`SELECT s.id,s.salesLinkSkuId,s.status,s.sourceType,c.erpSkuId,c.quantity
    FROM sales_link_sku_product_structures s LEFT JOIN sales_link_sku_product_structure_components c ON c.productStructureId=s.id
    WHERE s.salesLinkSkuId IN (${marks}) ORDER BY CASE s.status WHEN 'active' THEN 0 ELSE 1 END,s.updatedAt DESC,c.sortOrder,c.id`).all(...salesLinkSkuIds)) {
    const list = structures.get(row.salesLinkSkuId) || [];
    let structure = list.find((item) => item.id === row.id);
    if (!structure) { structure = { id: row.id, status: row.status, sourceType: row.sourceType, components: [] }; list.push(structure); }
    if (row.erpSkuId) structure.components.push({ erpSkuId: row.erpSkuId, quantity: row.quantity });
    structures.set(row.salesLinkSkuId, list);
  }
  const mappings = new Map();
  for (const row of database.prepare(`SELECT id,salesLinkSkuId,erpSkuId,quantity,mappingType,sourceType,productStructureId
    FROM sales_link_sku_erp_mappings WHERE currentState='active' AND salesLinkSkuId IN (${marks}) ORDER BY salesLinkSkuId,erpSkuId,id`).all(...salesLinkSkuIds)) {
    const list = mappings.get(row.salesLinkSkuId) || []; list.push(row); mappings.set(row.salesLinkSkuId, list);
  }
  return { structures, mappings, resolutions: resolveLinkSkuErpRelations({ salesLinkSkuIds }, { database }).results };
}

function missingReason(item, context) {
  const skuId = item.result?.salesLinkSku?.id;
  const structures = context.structures.get(skuId) || [];
  if (!structures.length) {
    return item.result?.salesLinkSku?.systemGoodsType ? { code: "missing_structure", label: "缺少货品结构" } : { code: "missing_platform_goods", label: "缺少平台货品主数据" };
  }
  if (structures.some((structure) => !structure.components.length)) return { code: "missing_component", label: "货品结构缺少组件" };
  return { code: "structure_not_active", label: "货品结构尚未正式生效" };
}

function buildItems(database, batch) {
  const rows = database.prepare("SELECT rowNumber,rawDataJson FROM connection_import_rows WHERE batchId=? ORDER BY rowNumber").all(batch.id)
    .map((row) => ({ rowNumber: row.rowNumber, raw: json(row.rawDataJson) }));
  const classified = classifySalesDailyPreviewRows(database, rows, {
    cache: { shops: new Map(), links: new Map(), skus: new Map(), erpSkus: new Map(), dailyFactKeys: new Set() }, ignoreExistingDailyFacts: true,
  }).filter((item) => allowedTypes.has(anomalyType(item)));
  const skuIds = [...new Set(classified.map((item) => item.result?.salesLinkSku?.id).filter(Boolean))];
  const context = loadContext(database, skuIds);
  const decisions = new Map(database.prepare("SELECT * FROM sales_daily_anomaly_governance_decisions WHERE sourceBatchId=? ORDER BY createdAt DESC").all(batch.id)
    .map((row) => [`${row.sourceRowNumber}`, row]));
  return classified.map((item) => {
    const type = anomalyType(item); const data = item.normalized; const result = item.result || {};
    const skuId = result.salesLinkSku?.id || null; const currentMappings = context.mappings.get(skuId) || [];
    const targetErpSkuId = result.erpSku?.id || null; const relation = context.resolutions[skuId] || null;
    const reason = type === "identity_error" ? identityReason(result.errorType)
      : type === "missing_relation" ? missingReason(item, context)
        : { code: result.errorType || "relation_resolution_conflict", label: result.message || "正式关系与销售明细冲突" };
    const structures = context.structures.get(skuId) || [];
    return {
      id: `${batch.id}:${item.rowNumber}`, sourceBatchId: batch.id, sourceRowNumber: item.rowNumber, anomalyType: type,
      saleDate: data.saleDate || null,
      shop: { sourceName: data.shopName || null, id: result.shop?.id || null, name: result.shop?.displayName || result.shop?.shopName || null },
      link: { id: result.link?.id || null, name: result.link?.title || null, platformGoodsId: data.platformGoodsId || null },
      salesLinkSku: { id: skuId, platformSkuId: data.platformSkuId || null },
      erpSku: { id: targetErpSkuId, merchantSkuCode: data.merchantSkuCode || null },
      salesAmount: amount(data.salesAmount), profitAmount: amount(data.profitAmount), quantity: Number(data.quantity || 0),
      reason: { ...reason, sourceErrorType: result.errorType || null, message: result.message || reason.label },
      impact: { rowCount: 1, dateStart: data.saleDate || null, dateEnd: data.saleDate || null },
      currentRelation: { status: relation?.relationStatus || "unresolved", shape: relation?.relationshipShape || null, mappings: currentMappings },
      targetErpSkuId, componentDiff: { salesExtra: targetErpSkuId && !currentMappings.some((mapping) => mapping.erpSkuId === targetErpSkuId) ? [targetErpSkuId] : [], currentComponents: currentMappings.map((mapping) => mapping.erpSkuId) },
      productStructures: structures,
      decision: decisions.get(`${item.rowNumber}`) || null,
      availableActions: type === "relation_conflict" || type === "incomplete_structure" ? ["add", "replace", "ignore"] : type === "missing_relation" ? ["add", "ignore"] : ["ignore"],
    };
  });
}

export function querySalesDataQualityAnomalies(options = {}) {
  const database = options.database || getDatabase(); const batch = latestCommittedBatch(database);
  if (!batch) return { capability: "QuerySalesDataQualityAnomalies", contractVersion: "1.0", hasData: false, items: [], summary: { total: 0 } };
  const all = buildItems(database, batch); const type = clean(options.anomalyType); const keyword = clean(options.keyword).toLowerCase();
  const filtered = all.filter((item) => (!allowedTypes.has(type) || item.anomalyType === type) && (!keyword || [item.shop.sourceName, item.link.name, item.link.platformGoodsId, item.salesLinkSku.platformSkuId, item.erpSku.merchantSkuCode].some((value) => clean(value).toLowerCase().includes(keyword))));
  const page = Math.max(1, Number(options.page || 1)); const pageSize = Math.min(100, Math.max(1, Number(options.pageSize || 30)));
  const byType = Object.fromEntries([...allowedTypes].map((key) => [key, { count: 0, salesAmount: 0, profitAmount: 0 }]));
  for (const item of all) { const metric = byType[item.anomalyType]; metric.count += 1; metric.salesAmount += item.salesAmount; metric.profitAmount += item.profitAmount; }
  for (const metric of Object.values(byType)) { metric.salesAmount = amount(metric.salesAmount); metric.profitAmount = amount(metric.profitAmount); }
  return { capability: "QuerySalesDataQualityAnomalies", contractVersion: "1.0", hasData: true,
    batch: { id: batch.id, fileName: batch.fileName, dateStart: batch.periodStart, dateEnd: batch.periodEnd },
    summary: { total: all.length, salesAmount: amount(all.reduce((sum, item) => sum + item.salesAmount, 0)), profitAmount: amount(all.reduce((sum, item) => sum + item.profitAmount, 0)), byType },
    items: filtered.slice((page - 1) * pageSize, page * pageSize), pagination: { page, pageSize, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)) },
    safeguards: { changesFacts: false, createsMapping: false, bypassesApproval: false } };
}

export function submitSalesDataQualityAnomalyDecision(anomalyId, input = {}, context = {}) {
  const database = context.database || getDatabase(); const reviewedBy = clean(context.reviewedBy); const action = clean(input.action); const note = clean(input.decisionNote);
  if (!reviewedBy || !note) throw new Error("审核人和处理说明不能为空。");
  if (!allowedActions.has(action)) throw new Error("处理动作无效。");
  const [batchId, rowText] = clean(anomalyId).split(":"); const rowNumber = Number(rowText);
  const queue = querySalesDataQualityAnomalies({ database, pageSize: 100 });
  const item = buildItems(database, { ...queue.batch, id: batchId }).find((row) => row.sourceRowNumber === rowNumber);
  if (!item) throw new Error("销售异常已不存在，请先重新计算预览。");
  if (!item.availableActions.includes(action)) throw new Error("当前异常不允许该处理动作。");
  const existing = database.prepare("SELECT * FROM sales_daily_anomaly_governance_decisions WHERE sourceBatchId=? AND sourceRowNumber=?").get(batchId, rowNumber);
  if (existing && existing.action === action && existing.decisionNote === note) return { decisionId: existing.id, idempotent: true, status: existing.status, route: json(existing.routeJson) };
  const timestamp = new Date().toISOString(); const id = existing?.id || `sales-daily-anomaly-decision-${crypto.randomUUID()}`;
  const route = action === "ignore" ? { kind: "anomaly_audit", requiresApproval: true } : { kind: "product_structure_application", requiresApproval: true, salesLinkSkuId: item.salesLinkSku.id, proposedAction: action };
  const status = action === "ignore" ? "reviewed_ignore" : "pending_formal_approval";
  const snapshot = JSON.stringify(item);
  database.prepare(`INSERT INTO sales_daily_anomaly_governance_decisions
    (id,sourceBatchId,sourceRowNumber,anomalyType,action,status,salesLinkSkuId,erpSkuId,decisionNote,snapshotJson,routeJson,reviewedBy,reviewedAt,createdAt,updatedAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(sourceBatchId,sourceRowNumber) DO UPDATE SET
    anomalyType=excluded.anomalyType,action=excluded.action,status=excluded.status,salesLinkSkuId=excluded.salesLinkSkuId,erpSkuId=excluded.erpSkuId,
    decisionNote=excluded.decisionNote,snapshotJson=excluded.snapshotJson,routeJson=excluded.routeJson,reviewedBy=excluded.reviewedBy,reviewedAt=excluded.reviewedAt,updatedAt=excluded.updatedAt`)
    .run(id, batchId, rowNumber, item.anomalyType, action, status, item.salesLinkSku.id, item.erpSku.id, note, snapshot, JSON.stringify(route), reviewedBy, timestamp, timestamp, timestamp);
  return { decisionId: id, idempotent: false, status, route, safeguards: { mappingChanged: false, productStructureChanged: false, factChanged: false } };
}
