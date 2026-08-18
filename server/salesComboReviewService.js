import crypto from "node:crypto";
import { getDatabase } from "./db.js";

const text = (value) => String(value ?? "").trim();
const json = (value, fallback = {}) => { try { return JSON.parse(value || ""); } catch { return fallback; } };
const numberOrNull = (value) => value === null || value === undefined || value === "" ? null : Number(value);
const stableId = (prefix, ...parts) => `${prefix}-${crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24)}`;
const now = () => new Date().toISOString();
const statusLabels = { pending: "待审核", approved: "已确认", rejected: "已拒绝", inactive: "已停用", conflict: "冲突" };

function productStructureOnlyError() {
  return Object.assign(new Error("独立组合审核已停用，请通过商品结构治理创建或审核 Product Structure。"), {
    code: "product_structure_only",
  });
}

function sourceRows(database, batchId, salesLinkSkuId) {
  return database.prepare(`SELECT rowNumber,rawDataJson,normalizedDataJson FROM connection_import_rows
    WHERE batchId=? AND status IN ('pending_relation','missing_relation') ORDER BY rowNumber`).all(batchId).map((row) => ({
      rowNumber: row.rowNumber, raw: json(row.rawDataJson), normalized: json(row.normalizedDataJson),
    })).filter((row) => row.normalized.salesLinkSkuId === salesLinkSkuId);
}

function sourceRowsBySku(database, batchId) {
  const result = new Map();
  for (const row of database.prepare(`SELECT rowNumber,rawDataJson,normalizedDataJson FROM connection_import_rows
    WHERE batchId=? AND status IN ('pending_relation','missing_relation') ORDER BY rowNumber`).all(batchId)) {
    const normalized = json(row.normalizedDataJson); const salesLinkSkuId = normalized.salesLinkSkuId;
    if (!salesLinkSkuId) continue;
    const items = result.get(salesLinkSkuId) || [];
    items.push({ rowNumber: row.rowNumber, raw: json(row.rawDataJson), normalized }); result.set(salesLinkSkuId, items);
  }
  return result;
}

function analyzeRows(rows) {
  const byDate = new Map();
  for (const row of rows) {
    const date = text(row.normalized.saleDate); if (!date) continue;
    const entries = byDate.get(date) || []; entries.push(row); byDate.set(date, entries);
  }
  const dates = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, dateRows]) => {
    const erpIds = [...new Set(dateRows.map((row) => row.normalized.erpSkuId).filter(Boolean))].sort();
    return { date, rows: dateRows, erpIds, signature: erpIds.join("|"), componentCount: erpIds.length };
  });
  const signatureCounts = new Map();
  for (const item of dates.filter((entry) => entry.componentCount > 1)) signatureCounts.set(item.signature, (signatureCounts.get(item.signature) || 0) + 1);
  const canonical = [...signatureCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || null;
  const singleDates = dates.filter((item) => item.componentCount === 1);
  const changedDates = dates.filter((item) => item.componentCount > 1 && canonical && item.signature !== canonical);
  const signatureCount = new Set(dates.map((item) => item.signature)).size;
  return {
    stability: dates.length < 2 ? "insufficient" : signatureCount === 1 && !singleDates.length ? "stable" : "changing",
    totalSalesDates: dates.length,
    multiComponentDates: dates.filter((item) => item.componentCount > 1).length,
    singleComponentDates: singleDates.length,
    componentSetChangeDates: changedDates.length,
    canonicalConsistentDates: canonical ? dates.filter((item) => item.signature === canonical).length : 0,
    anomalousDates: dates.filter((item) => item.componentCount === 1 || (canonical && item.componentCount > 1 && item.signature !== canonical)),
  };
}

const groupSelect = `SELECT g.*,sku.salesLinkId,sku.platformSkuId,sku.specificationName platformSpecificationName,
  l.shopId,l.platformGoodsId,l.title linkTitle,sh.platform,sh.shopName,sh.displayName shopDisplayName,b.fileName,
  COUNT(c.id) componentCount,COALESCE(SUM(rc.affectedRowCount),0) affectedRowCount,
  MIN(rc.affectedDateStart) affectedDateStart,MAX(rc.affectedDateEnd) affectedDateEnd,
  SUM(rc.salesAmount) salesAmount,SUM(rc.profitAmount) profitAmount
  FROM sales_link_sku_combo_groups g
  JOIN sales_link_skus sku ON sku.id=g.salesLinkSkuId JOIN sales_links l ON l.id=sku.salesLinkId
  JOIN sales_shops sh ON sh.id=l.shopId LEFT JOIN connection_import_batches b ON b.id=g.sourceBatchId
  LEFT JOIN sales_link_sku_combo_group_components c ON c.comboGroupId=g.id AND c.status='included'
  LEFT JOIN sales_link_sku_erp_mapping_candidates rc ON rc.id=c.sourceCandidateId`;

function viewGroup(database, row, prefetchedRows = null, componentIds = null) {
  const candidateRows = prefetchedRows || sourceRows(database, row.sourceBatchId, row.salesLinkSkuId);
  const relevantRows = componentIds ? candidateRows.filter((item) => componentIds.has(item.normalized.erpSkuId)) : candidateRows;
  const evidence = analyzeRows(relevantRows);
  return {
    id: row.id, status: row.status, statusLabel: statusLabels[row.status] || row.status,
    reviewNote: row.reviewNote || "",
    shop: { id: row.shopId, name: row.shopDisplayName || row.shopName, platform: row.platform },
    link: { id: row.salesLinkId, title: row.linkTitle, platformGoodsId: row.platformGoodsId },
    platformSku: { id: row.salesLinkSkuId, platformSkuId: row.platformSkuId, specificationName: row.platformSpecificationName },
    componentCount: Number(row.componentCount || 0), affectedRowCount: Number(row.affectedRowCount || 0),
    affectedDateStart: row.affectedDateStart, affectedDateEnd: row.affectedDateEnd,
    salesAmount: numberOrNull(row.salesAmount), profitAmount: numberOrNull(row.profitAmount),
    stability: evidence.stability, stabilityEvidence: evidence, source: { batchId: row.sourceBatchId, fileName: row.fileName },
  };
}

// Legacy implementation is retained for historical compatibility and audit only.
// Runtime callers are blocked by the exported wrapper below.
function legacyGeneratePendingComboGroups(sourceBatchId, { createdBy } = {}) {
  const batchId = text(sourceBatchId); if (!batchId) throw new Error("请选择销售日报预览批次。");
  const database = getDatabase(); const batch = database.prepare("SELECT id,fileHash FROM connection_import_batches WHERE id=?").get(batchId);
  if (!batch) throw new Error("销售日报预览批次不存在。");
  const candidates = database.prepare(`SELECT * FROM sales_link_sku_erp_mapping_candidates
    WHERE sourceBatchId=? AND candidateType='combo' AND status='pending' ORDER BY salesLinkSkuId,sourceRowNumber,erpSkuId`).all(batchId);
  const groups = new Map();
  for (const candidate of candidates) { const items = groups.get(candidate.salesLinkSkuId) || []; items.push(candidate); groups.set(candidate.salesLinkSkuId, items); }
  const stamp = now(); let createdGroups = 0; let createdComponents = 0;
  database.transaction(() => {
    const insertGroup = database.prepare(`INSERT OR IGNORE INTO sales_link_sku_combo_groups
      (id,salesLinkSkuId,groupCode,status,sourceType,sourceBatchId,sourceFileHash,sourceCandidateIdsJson,createdBy,createdAt,updatedAt)
      VALUES (?,?,?,'pending','sales_daily_relation_review',?,?,?,?,?,?)`);
    const insertComponent = database.prepare(`INSERT OR IGNORE INTO sales_link_sku_combo_group_components
      (id,comboGroupId,erpSkuId,quantity,quantitySource,sortOrder,status,sourceType,sourceCandidateId,createdAt,updatedAt)
      VALUES (?,?,?,NULL,NULL,?,'included',?,?,?,?)`);
    for (const [salesLinkSkuId, items] of groups) {
      const groupId = stableId("combo-group", batchId, salesLinkSkuId);
      const groupCode = `CG-${crypto.createHash("sha256").update(`${batchId}|${salesLinkSkuId}`).digest("hex").slice(0, 16).toUpperCase()}`;
      createdGroups += insertGroup.run(groupId, salesLinkSkuId, groupCode, batchId, batch.fileHash || items[0].sourceFileHash, JSON.stringify(items.map((item) => item.id)), text(createdBy) || null, stamp, stamp).changes;
      items.forEach((candidate, index) => { createdComponents += insertComponent.run(stableId("combo-component", groupId, candidate.erpSkuId), groupId, candidate.erpSkuId, index + 1, candidate.sourceType || "sales_daily_preview", candidate.id, stamp, stamp).changes; });
    }
  })();
  return { sourceBatchId: batchId, candidateCount: candidates.length, platformSkuCount: groups.size, createdGroups, existingGroups: groups.size - createdGroups, createdComponents };
}

export function generatePendingComboGroups() {
  throw productStructureOnlyError();
}

export function queryComboReviewGroups(options = {}) {
  const database = getDatabase(); const where = []; const params = [];
  if (text(options.sourceBatchId)) { where.push("g.sourceBatchId=?"); params.push(text(options.sourceBatchId)); }
  if (text(options.shopId)) { where.push("l.shopId=?"); params.push(text(options.shopId)); }
  if (text(options.platform)) { where.push("LOWER(sh.platform)=LOWER(?)"); params.push(text(options.platform)); }
  if (text(options.status)) { where.push("g.status=?"); params.push(text(options.status)); }
  if (Number(options.componentCount) > 0) { where.push("(SELECT COUNT(*) FROM sales_link_sku_combo_group_components x WHERE x.comboGroupId=g.id AND x.status='included')=?"); params.push(Number(options.componentCount)); }
  const sql = `${groupSelect} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} GROUP BY g.id`;
  const rows = database.prepare(sql).all(...params);
  const page = Math.max(1, Number(options.page || 1)); const pageSize = Math.min(100, Math.max(1, Number(options.pageSize || 20)));
  const stability = text(options.stability); const batchCache = new Map();
  const componentIds = new Map();
  if (rows.length) {
    const placeholders = rows.map(() => "?").join(",");
    for (const component of database.prepare(`SELECT comboGroupId,erpSkuId FROM sales_link_sku_combo_group_components WHERE comboGroupId IN (${placeholders}) AND status='included'`).all(...rows.map((row) => row.id))) {
      const ids = componentIds.get(component.comboGroupId) || new Set(); ids.add(component.erpSkuId); componentIds.set(component.comboGroupId, ids);
    }
  }
  const analyze = (selectedRows) => {
    for (const row of selectedRows) if (!batchCache.has(row.sourceBatchId)) batchCache.set(row.sourceBatchId, sourceRowsBySku(database, row.sourceBatchId));
    return selectedRows.map((row) => viewGroup(database, row, batchCache.get(row.sourceBatchId)?.get(row.salesLinkSkuId) || [], componentIds.get(row.id)));
  };
  const analyzed = stability ? analyze(rows).filter((item) => item.stability === stability) : null;
  const total = analyzed ? analyzed.length : rows.length;
  const items = analyzed ? analyzed.slice((page - 1) * pageSize, page * pageSize) : analyze(rows.slice((page - 1) * pageSize, page * pageSize));
  const summaryRows = analyzed || rows;
  const summary = summaryRows.reduce((sum, item) => ({ pendingGroups: sum.pendingGroups + (item.status === "pending" ? 1 : 0), platformSkuCount: sum.platformSkuCount + 1, affectedRowCount: sum.affectedRowCount + Number(item.affectedRowCount || 0), salesAmount: sum.salesAmount + Number(item.salesAmount || 0), profitAmount: sum.profitAmount + Number(item.profitAmount || 0) }), { pendingGroups: 0, platformSkuCount: 0, affectedRowCount: 0, salesAmount: 0, profitAmount: 0 });
  return {
    items, summary, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    filterOptions: {
      shops: [...new Map(rows.map((item) => [item.shopId, { id: item.shopId, name: item.shopDisplayName || item.shopName, platform: item.platform }])).values()].sort((a, b) => a.name.localeCompare(b.name, "zh-CN")),
      platforms: [...new Set(rows.map((item) => item.platform).filter(Boolean))].sort(),
      componentCounts: [...new Set(rows.map((item) => Number(item.componentCount || 0)))].sort((a, b) => a - b),
      sourceBatches: database.prepare(`SELECT DISTINCT g.sourceBatchId id,b.fileName FROM sales_link_sku_combo_groups g LEFT JOIN connection_import_batches b ON b.id=g.sourceBatchId WHERE g.sourceBatchId IS NOT NULL ORDER BY g.createdAt DESC`).all(),
    },
  };
}

export function readComboReviewGroup(groupId) {
  const database = getDatabase(); const row = database.prepare(`${groupSelect} WHERE g.id=? GROUP BY g.id`).get(text(groupId));
  if (!row) throw new Error("Combo审核组不存在。");
  const componentIdSet = new Set(database.prepare("SELECT erpSkuId FROM sales_link_sku_combo_group_components WHERE comboGroupId=? AND status='included'").all(row.id).map((item) => item.erpSkuId));
  const rows = sourceRows(database, row.sourceBatchId, row.salesLinkSkuId).filter((item) => componentIdSet.has(item.normalized.erpSkuId));
  const item = viewGroup(database, row, rows, componentIdSet);
  const components = database.prepare(`SELECT c.*,e.merchantSkuCode,e.specificationName,e.currentState
    FROM sales_link_sku_combo_group_components c JOIN erp_skus e ON e.id=c.erpSkuId
    WHERE c.comboGroupId=? ORDER BY c.sortOrder,c.id`).all(row.id).map((component) => {
      const evidenceRows = rows.filter((sourceRow) => sourceRow.normalized.erpSkuId === component.erpSkuId);
      const quantities = evidenceRows.map((sourceRow) => numberOrNull(sourceRow.normalized.quantity)).filter((value) => value !== null);
      return {
        id: component.id,
        erpSku: { id: component.erpSkuId, merchantSkuCode: component.merchantSkuCode, specificationName: component.specificationName, currentState: component.currentState },
        status: component.status, statusLabel: component.status === "included" ? "候选组件" : "排除组件",
        sourceType: component.sourceType || "sales_daily_preview",
        quantity: component.quantity, quantityLabel: component.quantity === null ? "待人工确认" : component.quantity,
        evidence: { occurrenceDays: new Set(evidenceRows.map((sourceRow) => sourceRow.normalized.saleDate)).size, occurrenceCount: evidenceRows.length, dailyQuantityMin: quantities.length ? Math.min(...quantities) : null, dailyQuantityMax: quantities.length ? Math.max(...quantities) : null },
      };
    });
  return { item, components, notice: "销售日报组件数量仅供审核参考，不等于正式组合数量。" };
}

export function searchComboReviewErpSkus(keyword, options = {}) {
  const database = getDatabase(); const search = text(keyword); if (!search) return [];
  const limit = Math.min(50, Math.max(1, Number(options.limit || 20)));
  return database.prepare(`SELECT id,merchantSkuCode,specificationName,currentState FROM erp_skus
    WHERE currentState='active' AND (merchantSkuCode LIKE ? OR specificationName LIKE ?)
    ORDER BY CASE WHEN merchantSkuCode=? THEN 0 ELSE 1 END,merchantSkuCode LIMIT ?`).all(`%${search}%`, `%${search}%`, search, limit);
}

function legacySaveComboReviewDraft(groupId, payload = {}, { reviewedBy } = {}) {
  const database = getDatabase(); const id = text(groupId);
  const group = database.prepare("SELECT * FROM sales_link_sku_combo_groups WHERE id=?").get(id);
  if (!group) throw new Error("Combo审核组不存在。");
  if (group.status !== "pending") throw new Error("只有待审核Combo组可以编辑草稿。");
  if (!Array.isArray(payload.components) || !payload.components.length) throw new Error("Combo草稿至少需要一个组件。");
  const desired = payload.components.map((item, index) => {
    const erpSkuId = text(item.erpSkuId); if (!erpSkuId) throw new Error("ERP SKU不能为空。");
    const status = text(item.status) || "included"; if (!["included", "excluded"].includes(status)) throw new Error("组件状态无效。");
    const quantity = item.quantity === null || item.quantity === undefined || text(item.quantity) === "" ? null : Number(item.quantity);
    if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0)) throw new Error("组件数量必须为空或大于0。");
    return { erpSkuId, quantity, quantitySource: quantity === null ? null : "manual_confirmation", status, sortOrder: index + 1, decisionNote: text(item.decisionNote) || null };
  });
  if (new Set(desired.map((item) => item.erpSkuId)).size !== desired.length) throw new Error("同一ERP SKU不能重复添加。");
  const existing = database.prepare("SELECT * FROM sales_link_sku_combo_group_components WHERE comboGroupId=? ORDER BY sortOrder,id").all(id);
  const existingIds = new Set(existing.map((item) => item.erpSkuId)); const desiredIds = new Set(desired.map((item) => item.erpSkuId));
  if (existing.some((item) => !desiredIds.has(item.erpSkuId))) throw new Error("已有组件不能从草稿中删除，请将其标记为排除。");
  const placeholders = desired.map(() => "?").join(",");
  const validIds = new Set(database.prepare(`SELECT id FROM erp_skus WHERE currentState='active' AND id IN (${placeholders})`).all(...desired.map((item) => item.erpSkuId)).map((item) => item.id));
  if (desired.some((item) => !validIds.has(item.erpSkuId))) throw new Error("存在无效或已停用的ERP SKU。");
  const reviewNote = text(payload.reviewNote) || null;
  const same = reviewNote === (group.reviewNote || null) && desired.length === existing.length && desired.every((item, index) => {
    const current = existing[index]; return current?.erpSkuId === item.erpSkuId && numberOrNull(current.quantity) === item.quantity && (current.quantitySource || null) === item.quantitySource && current.status === item.status && Number(current.sortOrder) === item.sortOrder && (current.decisionNote || null) === item.decisionNote;
  });
  if (same) return { groupId: id, status: "pending", changed: false, idempotent: true, addedComponents: 0 };
  const stamp = now(); let addedComponents = 0;
  database.transaction(() => {
    const update = database.prepare(`UPDATE sales_link_sku_combo_group_components SET quantity=?,quantitySource=?,sortOrder=?,status=?,decisionNote=?,updatedAt=? WHERE comboGroupId=? AND erpSkuId=?`);
    const insert = database.prepare(`INSERT INTO sales_link_sku_combo_group_components
      (id,comboGroupId,erpSkuId,quantity,quantitySource,sortOrder,status,sourceType,sourceCandidateId,decisionNote,createdAt,updatedAt)
      VALUES (?,?,?,?,?,?,?,'manual_added',NULL,?,?,?)`);
    for (const item of desired) {
      if (existingIds.has(item.erpSkuId)) update.run(item.quantity, item.quantitySource, item.sortOrder, item.status, item.decisionNote, stamp, id, item.erpSkuId);
      else { insert.run(stableId("combo-component-manual", id, item.erpSkuId), id, item.erpSkuId, item.quantity, item.quantitySource, item.sortOrder, item.status, item.decisionNote, stamp, stamp); addedComponents += 1; }
    }
    database.prepare(`UPDATE sales_link_sku_combo_groups SET reviewNote=?,reviewedBy=?,reviewedAt=?,updatedAt=? WHERE id=? AND status='pending'`).run(reviewNote, text(reviewedBy) || null, stamp, stamp, id);
  })();
  return { groupId: id, status: "pending", changed: true, idempotent: false, addedComponents };
}

export function saveComboReviewDraft() {
  throw productStructureOnlyError();
}

function markComboPreviewForRecalculation(database, batchId, confirmedAt) {
  if (!batchId) return;
  const batch = database.prepare("SELECT previewSummaryJson FROM connection_import_batches WHERE id=?").get(batchId); if (!batch) return;
  const summary = json(batch.previewSummaryJson);
  summary.relationRecalculationRequired = true;
  summary.relationLastConfirmedAt = confirmedAt;
  summary.relationConfirmationCount = Number(summary.relationConfirmationCount || 0) + 1;
  summary.comboRelationConfirmationCount = Number(summary.comboRelationConfirmationCount || 0) + 1;
  database.prepare("UPDATE connection_import_batches SET previewSummaryJson=?,updatedAt=? WHERE id=?").run(JSON.stringify(summary), confirmedAt, batchId);
}

function legacyConfirmComboReviewGroup(groupId, { reviewedBy, reviewNote } = {}) {
  const database = getDatabase(); const id = text(groupId); const reviewer = text(reviewedBy);
  if (!reviewer) throw Object.assign(new Error("无法识别当前审核人。"), { code: "reviewer_required" });
  const group = database.prepare("SELECT * FROM sales_link_sku_combo_groups WHERE id=?").get(id);
  if (!group) throw Object.assign(new Error("Combo审核组不存在。"), { code: "group_not_found" });
  if (group.status === "approved") {
    const mappings = database.prepare("SELECT * FROM sales_link_sku_erp_mappings WHERE comboGroupId=? AND mappingType='combo' AND currentState='active' ORDER BY erpSkuId").all(id);
    const components = database.prepare("SELECT * FROM sales_link_sku_combo_group_components WHERE comboGroupId=? AND status='included' ORDER BY erpSkuId").all(id);
    const valid = mappings.length === components.length && components.every((component) => mappings.some((mapping) => mapping.erpSkuId === component.erpSkuId && Number(mapping.quantity) === Number(component.quantity)));
    if (valid) return { groupId: id, status: "approved", outcome: "idempotent", mappingIds: mappings.map((item) => item.id) };
    throw Object.assign(new Error("已确认Combo组与正式映射不一致，请先处理冲突。"), { code: "approved_mapping_conflict" });
  }
  if (group.status !== "pending") throw Object.assign(new Error(`Combo审核组当前状态为${group.status}，不能确认。`), { code: "group_not_pending" });
  const components = database.prepare(`SELECT c.*,e.currentState erpState FROM sales_link_sku_combo_group_components c
    LEFT JOIN erp_skus e ON e.id=c.erpSkuId WHERE c.comboGroupId=? ORDER BY c.sortOrder,c.id`).all(id);
  const included = components.filter((item) => item.status === "included");
  if (included.length < 2) throw Object.assign(new Error("Combo关系至少需要两个纳入的ERP组件。"), { code: "components_incomplete" });
  if (included.some((item) => item.erpState !== "active")) throw Object.assign(new Error("存在无效或已停用的ERP SKU。"), { code: "erp_sku_invalid" });
  if (included.some((item) => item.quantity === null || item.quantitySource !== "manual_confirmation" || Number(item.quantity) <= 0)) throw Object.assign(new Error("所有纳入组件都必须由人工确认正数组件数量。"), { code: "quantity_unconfirmed" });
  const candidateIds = components.map((item) => item.sourceCandidateId).filter(Boolean);
  if (candidateIds.length) {
    const placeholders = candidateIds.map(() => "?").join(",");
    const candidates = database.prepare(`SELECT * FROM sales_link_sku_erp_mapping_candidates WHERE id IN (${placeholders})`).all(...candidateIds);
    if (candidates.length !== candidateIds.length || candidates.some((item) => item.status !== "pending" || item.candidateType !== "combo")) throw Object.assign(new Error("来源候选状态已变化，不能确认当前Combo草稿。"), { code: "candidate_conflict" });
  }
  const otherApproved = database.prepare("SELECT id FROM sales_link_sku_combo_groups WHERE salesLinkSkuId=? AND status='approved' AND id<>?").get(group.salesLinkSkuId, id);
  if (otherApproved) throw Object.assign(new Error("该平台SKU已存在其他已确认Combo组。"), { code: "approved_combo_conflict" });
  const activeMappings = database.prepare("SELECT * FROM sales_link_sku_erp_mappings WHERE salesLinkSkuId=? AND currentState='active'").all(group.salesLinkSkuId);
  if (activeMappings.some((item) => item.mappingType === "single")) throw Object.assign(new Error("该平台SKU已存在active single关系，不能确认Combo。"), { code: "single_conflict" });
  if (activeMappings.length) throw Object.assign(new Error("该平台SKU已存在active combo关系，不能重复确认另一组Combo。"), { code: "active_combo_conflict" });
  const exactHistorical = database.prepare(`SELECT m.id FROM sales_link_sku_erp_mappings m WHERE m.salesLinkSkuId=? AND m.erpSkuId IN (${included.map(() => "?").join(",")})`).all(group.salesLinkSkuId, ...included.map((item) => item.erpSkuId));
  if (exactHistorical.length) throw Object.assign(new Error("部分组件存在历史映射，禁止静默覆盖或恢复。"), { code: "historical_mapping_conflict" });
  const confirmedAt = now(); const mappingIds = [];
  database.transaction(() => {
    const insertMapping = database.prepare(`INSERT INTO sales_link_sku_erp_mappings
      (id,salesLinkSkuId,erpSkuId,mappingType,quantity,currentState,sourceType,sourceBatchId,comboGroupId,createdAt,updatedAt)
      VALUES (?,?,?,'combo',?,'active','sales_relation_confirmation',?,?,?,?)`);
    const candidateApprove = database.prepare("UPDATE sales_link_sku_erp_mapping_candidates SET status='approved',reviewedBy=?,reviewedAt=?,decisionNote='人工确认Combo关系',mappingId=?,updatedAt=? WHERE id=? AND status='pending'");
    const candidateReject = database.prepare("UPDATE sales_link_sku_erp_mapping_candidates SET status='rejected',reviewedBy=?,reviewedAt=?,decisionNote='Combo整组确认时人工排除组件',mappingId=NULL,updatedAt=? WHERE id=? AND status='pending'");
    for (const component of included) {
      const mappingId = stableId("sales-link-sku-erp-map-combo", id, component.erpSkuId); mappingIds.push(mappingId);
      insertMapping.run(mappingId, group.salesLinkSkuId, component.erpSkuId, component.quantity, group.sourceBatchId, id, confirmedAt, confirmedAt);
      if (component.sourceCandidateId && candidateApprove.run(reviewer, confirmedAt, mappingId, confirmedAt, component.sourceCandidateId).changes !== 1) throw new Error("候选状态更新失败，已回滚整组确认。");
    }
    for (const component of components.filter((item) => item.status === "excluded" && item.sourceCandidateId)) if (candidateReject.run(reviewer, confirmedAt, confirmedAt, component.sourceCandidateId).changes !== 1) throw new Error("排除候选状态更新失败，已回滚整组确认。");
    const finalNote = text(reviewNote) || group.reviewNote || "人工确认Combo关系";
    const changed = database.prepare(`UPDATE sales_link_sku_combo_groups SET status='approved',reviewedBy=?,reviewedAt=?,reviewNote=?,approvedAt=?,updatedAt=? WHERE id=? AND status='pending'`).run(reviewer, confirmedAt, finalNote, confirmedAt, confirmedAt, id).changes;
    if (changed !== 1) throw new Error("Combo审核组状态已变化，已回滚整组确认。");
    markComboPreviewForRecalculation(database, group.sourceBatchId, confirmedAt);
  })();
  return { groupId: id, status: "approved", outcome: "created", mappingIds, confirmedAt, sourceBatchId: group.sourceBatchId };
}

export function confirmComboReviewGroup() {
  throw productStructureOnlyError();
}

export function queryComboReviewAnomalyDates(groupId, options = {}) {
  const database = getDatabase(); const group = database.prepare("SELECT * FROM sales_link_sku_combo_groups WHERE id=?").get(text(groupId));
  if (!group) throw new Error("Combo审核组不存在。");
  const componentIds = new Set(database.prepare("SELECT erpSkuId FROM sales_link_sku_combo_group_components WHERE comboGroupId=? AND status='included'").all(group.id).map((item) => item.erpSkuId));
  const analysis = analyzeRows(sourceRows(database, group.sourceBatchId, group.salesLinkSkuId).filter((item) => componentIds.has(item.normalized.erpSkuId)));
  const all = analysis.anomalousDates.map((item) => ({
    date: item.date, componentCount: item.componentCount,
    components: item.rows.map((row) => ({ merchantSkuCode: row.normalized.merchantSkuCode, quantity: numberOrNull(row.normalized.quantity), salesAmount: numberOrNull(row.normalized.salesAmount), profitAmount: numberOrNull(row.normalized.profitAmount) })),
    salesAmount: item.rows.reduce((sum, row) => sum + Number(row.normalized.salesAmount || 0), 0), profitAmount: item.rows.reduce((sum, row) => sum + Number(row.normalized.profitAmount || 0), 0),
  }));
  const page = Math.max(1, Number(options.page || 1)); const pageSize = Math.min(50, Math.max(1, Number(options.pageSize || 10)));
  return { items: all.slice((page - 1) * pageSize, page * pageSize), pagination: { page, pageSize, total: all.length, totalPages: Math.max(1, Math.ceil(all.length / pageSize)) } };
}

export function queryComboReviewSourceRows(groupId, options = {}) {
  const database = getDatabase(); const group = database.prepare("SELECT * FROM sales_link_sku_combo_groups WHERE id=?").get(text(groupId));
  if (!group) throw new Error("Combo审核组不存在。");
  const componentIds = new Set(database.prepare("SELECT erpSkuId FROM sales_link_sku_combo_group_components WHERE comboGroupId=? AND status='included'").all(group.id).map((item) => item.erpSkuId));
  const rows = sourceRows(database, group.sourceBatchId, group.salesLinkSkuId).filter((item) => componentIds.has(item.normalized.erpSkuId));
  const page = Math.max(1, Number(options.page || 1)); const pageSize = Math.min(100, Math.max(1, Number(options.pageSize || 20)));
  const items = rows.slice((page - 1) * pageSize, page * pageSize).map((row) => ({ rowNumber: row.rowNumber, saleDate: row.normalized.saleDate, merchantSkuCode: row.normalized.merchantSkuCode, quantity: numberOrNull(row.normalized.quantity), salesAmount: numberOrNull(row.normalized.salesAmount), profitAmount: numberOrNull(row.normalized.profitAmount), raw: row.raw }));
  return { items, pagination: { page, pageSize, total: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / pageSize)) } };
}
