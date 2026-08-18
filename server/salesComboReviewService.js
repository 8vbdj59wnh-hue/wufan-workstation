import { getDatabase } from "./db.js";

const text = (value) => String(value ?? "").trim();
const json = (value, fallback = {}) => { try { return JSON.parse(value || ""); } catch { return fallback; } };
const numberOrNull = (value) => value === null || value === undefined || value === "" ? null : Number(value);
const statusLabels = { pending: "待审核", approved: "已确认", rejected: "已拒绝", inactive: "已停用", conflict: "冲突" };

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
