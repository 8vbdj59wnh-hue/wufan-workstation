import { getDatabase } from "./db.js";
import { ensureSingleLinkSkuErpMapping } from "./linkSkuErpMappingService.js";

const text = (value) => String(value ?? "").trim();
const json = (value, fallback = {}) => { try { return JSON.parse(value || ""); } catch { return fallback; } };
const allowedStatuses = new Set(["pending", "approved", "rejected", "superseded", "conflict"]);
const allowedTypes = new Set(["single", "combo"]);
const now = () => new Date().toISOString();

function candidateView(row) {
  const evidence = json(row.evidenceJson);
  return {
    id: row.id,
    candidateType: row.candidateType,
    suggestedQuantity: row.suggestedQuantity,
    status: row.status,
    affectedRowCount: row.affectedRowCount,
    affectedDateStart: row.affectedDateStart,
    affectedDateEnd: row.affectedDateEnd,
    salesAmount: row.salesAmount,
    profitAmount: row.profitAmount,
    shop: { id: row.shopId, name: row.shopDisplayName || row.shopName, platform: row.platform },
    link: { id: row.salesLinkId, title: row.linkTitle, platformGoodsId: row.platformGoodsId },
    platformSku: { id: row.salesLinkSkuId, platformSkuId: row.platformSkuId, specificationName: row.platformSpecificationName },
    erpSku: { id: row.erpSkuId, merchantSkuCode: row.merchantSkuCode, specificationName: row.erpSpecificationName, currentState: row.erpSkuState },
    source: { batchId: row.sourceBatchId, fileName: row.fileName, fileHash: row.sourceFileHash, firstRowNumber: row.sourceRowNumber },
    evidenceSummary: {
      shop: evidence.shop || null,
      link: evidence.link || null,
      platformSku: evidence.platformSku || null,
      erpSku: evidence.erpSku || null,
      source: evidence.source ? { fileName: evidence.source.fileName, rowNumber: evidence.source.rowNumber, rowCount: evidence.source.rowNumbers?.length || row.affectedRowCount } : null,
    },
  };
}

const selectSql = `SELECT c.*,sku.salesLinkId,sku.platformSkuId,sku.specificationName platformSpecificationName,
  l.shopId,l.platformGoodsId,l.title linkTitle,sh.platform,sh.shopName,sh.displayName shopDisplayName,
  e.merchantSkuCode,e.specificationName erpSpecificationName,e.currentState erpSkuState,b.fileName
  FROM sales_link_sku_erp_mapping_candidates c
  JOIN sales_link_skus sku ON sku.id=c.salesLinkSkuId
  JOIN sales_links l ON l.id=sku.salesLinkId
  JOIN sales_shops sh ON sh.id=l.shopId
  JOIN erp_skus e ON e.id=c.erpSkuId
  JOIN connection_import_batches b ON b.id=c.sourceBatchId`;

export function querySalesRelationCandidates(options = {}) {
  const database = getDatabase(); const where = []; const params = [];
  const status = text(options.status); const candidateType = text(options.candidateType);
  if (status && allowedStatuses.has(status)) { where.push("c.status=?"); params.push(status); }
  if (candidateType && allowedTypes.has(candidateType)) { where.push("c.candidateType=?"); params.push(candidateType); }
  if (text(options.shopId)) { where.push("l.shopId=?"); params.push(text(options.shopId)); }
  if (text(options.platform)) { where.push("LOWER(sh.platform)=LOWER(?)"); params.push(text(options.platform)); }
  if (text(options.erpSku)) { where.push("(c.erpSkuId=? OR LOWER(e.merchantSkuCode) LIKE LOWER(?))"); params.push(text(options.erpSku), `%${text(options.erpSku)}%`); }
  if (text(options.sourceBatchId)) { where.push("c.sourceBatchId=?"); params.push(text(options.sourceBatchId)); }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const page = Math.max(1, Number(options.page || 1)); const pageSize = Math.min(200, Math.max(1, Number(options.pageSize || 50)));
  const total = Number(database.prepare(`SELECT COUNT(*) total FROM (${selectSql} ${clause})`).get(...params).total || 0);
  const rows = database.prepare(`${selectSql} ${clause} ORDER BY c.createdAt DESC,c.sourceRowNumber,c.id LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize).map(candidateView);
  const counts = database.prepare(`SELECT COUNT(*) total,
    SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending,
    SUM(CASE WHEN candidateType='single' THEN 1 ELSE 0 END) single,
    SUM(CASE WHEN candidateType='combo' THEN 1 ELSE 0 END) combo,
    SUM(affectedRowCount) affectedRows,SUM(salesAmount) salesAmount,SUM(profitAmount) profitAmount
    FROM sales_link_sku_erp_mapping_candidates ${text(options.sourceBatchId) ? "WHERE sourceBatchId=?" : ""}`).get(...(text(options.sourceBatchId) ? [text(options.sourceBatchId)] : []));
  const filterOptions = {
    shops: database.prepare(`${selectSql} ${text(options.sourceBatchId) ? "WHERE c.sourceBatchId=?" : ""} GROUP BY l.shopId ORDER BY sh.displayName`).all(...(text(options.sourceBatchId) ? [text(options.sourceBatchId)] : [])).map((row) => ({ id: row.shopId, name: row.shopDisplayName || row.shopName, platform: row.platform })),
    platforms: database.prepare(`${selectSql} ${text(options.sourceBatchId) ? "WHERE c.sourceBatchId=?" : ""} GROUP BY sh.platform ORDER BY sh.platform`).all(...(text(options.sourceBatchId) ? [text(options.sourceBatchId)] : [])).map((row) => row.platform),
  };
  return { items: rows, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }, summary: { total: Number(counts.total || 0), pending: Number(counts.pending || 0), single: Number(counts.single || 0), combo: Number(counts.combo || 0), affectedRows: Number(counts.affectedRows || 0), salesAmount: counts.salesAmount, profitAmount: counts.profitAmount }, filterOptions };
}

export function readSalesRelationCandidate(candidateId) {
  const database = getDatabase();
  const row = database.prepare(`${selectSql} WHERE c.id=?`).get(text(candidateId));
  if (!row) throw new Error("销售关系候选不存在。");
  const item = candidateView(row); const evidence = json(row.evidenceJson);
  const rows = database.prepare("SELECT rowNumber,rawDataJson,normalizedDataJson FROM connection_import_rows WHERE batchId=? AND status IN ('pending_relation','missing_relation') ORDER BY rowNumber").all(row.sourceBatchId).map((sourceRow) => ({ rowNumber: sourceRow.rowNumber, raw: json(sourceRow.rawDataJson), normalized: json(sourceRow.normalizedDataJson) })).filter((sourceRow) => sourceRow.normalized.salesLinkSkuId === row.salesLinkSkuId && sourceRow.normalized.erpSkuId === row.erpSkuId);
  return { item: { ...item, evidence }, sourceRows: rows };
}

function markPreviewForRecalculation(database, sourceBatchIds, confirmedAt) {
  for (const batchId of new Set(sourceBatchIds)) {
    const batch = database.prepare("SELECT previewSummaryJson FROM connection_import_batches WHERE id=?").get(batchId);
    if (!batch) continue;
    const summary = json(batch.previewSummaryJson);
    summary.relationRecalculationRequired = true;
    summary.relationLastConfirmedAt = confirmedAt;
    summary.relationConfirmationCount = Number(summary.relationConfirmationCount || 0) + 1;
    database.prepare("UPDATE connection_import_batches SET previewSummaryJson=?,updatedAt=? WHERE id=?").run(JSON.stringify(summary), confirmedAt, batchId);
  }
}

function confirmCandidateInTransaction(database, candidate, reviewedBy, confirmedAt) {
  if (candidate.candidateType !== "single") throw Object.assign(new Error("组合候选不能通过单品关系确认。"), { code: "combo_not_allowed" });
  if (candidate.status === "approved") return { candidateId: candidate.id, mappingId: null, outcome: "idempotent", sourceBatchId: candidate.sourceBatchId };
  if (candidate.status !== "pending") throw Object.assign(new Error(`候选当前状态为${candidate.status}，不能确认。`), { code: "candidate_not_pending" });
  const salesLinkSku = database.prepare("SELECT id FROM sales_link_skus WHERE id=?").get(candidate.salesLinkSkuId);
  const erpSku = database.prepare("SELECT id FROM erp_skus WHERE id=?").get(candidate.erpSkuId);
  if (!salesLinkSku || !erpSku) {
    const reason = !salesLinkSku ? "平台SKU已不存在。" : "ERP SKU已不存在。";
    database.prepare("UPDATE sales_link_sku_erp_mapping_candidates SET status='conflict',reviewedBy=?,reviewedAt=?,decisionNote=?,updatedAt=? WHERE id=?").run(reviewedBy, confirmedAt, reason, confirmedAt, candidate.id);
    return { candidateId: candidate.id, mappingId: null, outcome: "conflict", message: reason, sourceBatchId: candidate.sourceBatchId };
  }
  const relation = ensureSingleLinkSkuErpMapping(database, {
    salesLinkSkuId: candidate.salesLinkSkuId,
    erpSkuId: candidate.erpSkuId,
    sourceType: "sales_relation_confirmation",
    sourceBatchId: candidate.sourceBatchId,
    timestamp: confirmedAt,
  });
  if (relation.outcome === "idempotent") {
    database.prepare("UPDATE sales_link_sku_erp_mapping_candidates SET status='approved',reviewedBy=?,reviewedAt=?,decisionNote='与已审核Sales Object结构一致',mappingId=NULL,updatedAt=? WHERE id=?")
      .run(reviewedBy, confirmedAt, confirmedAt, candidate.id);
    return { candidateId: candidate.id, mappingId: null, outcome: "idempotent", sourceBatchId: candidate.sourceBatchId };
  }
  database.prepare("UPDATE sales_link_sku_erp_mapping_candidates SET decisionNote=?,reviewedBy=?,reviewedAt=?,updatedAt=? WHERE id=?")
    .run(relation.reason, reviewedBy, confirmedAt, confirmedAt, candidate.id);
  return { candidateId: candidate.id, mappingId: null, outcome: "governance_pending", applicationBatchId: relation.applicationBatchId || null, sourceBatchId: candidate.sourceBatchId };
}

export function confirmSalesRelationCandidates(candidateIds, { reviewedBy } = {}) {
  const ids = [...new Set((Array.isArray(candidateIds) ? candidateIds : [candidateIds]).map(text).filter(Boolean))];
  if (!ids.length) throw new Error("请选择待确认的单品关系候选。");
  if (ids.length > 500) throw new Error("单次最多确认500条候选。");
  if (!text(reviewedBy)) throw Object.assign(new Error("无法识别当前审核人。"), { code: "reviewer_required" });
  const database = getDatabase(); const confirmedAt = now();
  const placeholders = ids.map(() => "?").join(",");
  const candidates = database.prepare(`SELECT * FROM sales_link_sku_erp_mapping_candidates WHERE id IN (${placeholders})`).all(...ids);
  if (candidates.length !== ids.length) throw new Error("部分销售关系候选不存在。");
  if (candidates.some((candidate) => candidate.candidateType !== "single")) throw Object.assign(new Error("批量确认不能包含组合候选，只能处理single候选。"), { code: "combo_not_allowed" });
  const results = database.transaction(() => {
    const items = candidates.map((candidate) => confirmCandidateInTransaction(database, candidate, text(reviewedBy), confirmedAt));
    const changedBatchIds = items.filter((item) => item.outcome === "created").map((item) => item.sourceBatchId);
    if (changedBatchIds.length) markPreviewForRecalculation(database, changedBatchIds, confirmedAt);
    return items;
  })();
  return {
    results,
    summary: {
      requested: ids.length,
      created: results.filter((item) => item.outcome === "created").length,
      idempotent: results.filter((item) => item.outcome === "idempotent").length,
      governancePending: results.filter((item) => item.outcome === "governance_pending").length,
      conflicts: results.filter((item) => item.outcome === "conflict").length,
    },
    confirmedAt,
  };
}

export function confirmSalesRelationCandidate(candidateId, options = {}) {
  const result = confirmSalesRelationCandidates([candidateId], options);
  return { ...result, result: result.results[0] };
}
