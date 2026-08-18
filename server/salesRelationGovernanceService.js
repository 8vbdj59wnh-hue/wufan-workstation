import { getDatabase } from "./db.js";

const text = (value) => String(value ?? "").trim();
const parseJson = (value, fallback = {}) => { try { return JSON.parse(value || ""); } catch { return fallback; } };
const money = (value) => Number(Number(value || 0).toFixed(4));
const allowedTypes = new Set(["single", "single_quantity", "combo"]);
const allowedStatuses = new Set(["pending", "approved", "rejected", "superseded", "conflict"]);

function loadQuantityEvidence(database, rows) {
  const batchIds = [...new Set(rows.map((row) => row.sourceBatchId).filter(Boolean))];
  if (!batchIds.length) return new Map();
  const placeholders = batchIds.map(() => "?").join(",");
  const evidence = new Map();
  for (const row of database.prepare(`SELECT batchId,normalizedDataJson FROM connection_import_rows WHERE batchId IN (${placeholders}) AND status IN ('pending_relation','missing_relation')`).all(...batchIds)) {
    const normalized = parseJson(row.normalizedDataJson);
    const salesLinkSkuId = text(normalized.salesLinkSkuId);
    if (!salesLinkSkuId) continue;
    const key = `${row.batchId}|${salesLinkSkuId}`;
    const current = evidence.get(key) || { quantities: new Set(), rowCount: 0 };
    const quantity = Number(normalized.quantity);
    if (Number.isFinite(quantity)) current.quantities.add(quantity);
    current.rowCount += 1;
    evidence.set(key, current);
  }
  return evidence;
}

function groupCandidates(rows, quantityEvidence) {
  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.sourceBatchId}|${row.salesLinkSkuId}`;
    const group = grouped.get(key) || {
      id: key, sourceBatchId: row.sourceBatchId, sourceFileName: row.fileName,
      salesLinkSkuId: row.salesLinkSkuId, platformSkuId: row.platformSkuId,
      platformSkuName: row.platformSkuName, salesLinkId: row.salesLinkId,
      linkName: row.linkName, platformGoodsId: row.platformGoodsId,
      shop: { id: row.shopId, name: row.shopDisplayName || row.shopName, platform: row.platform },
      candidateIds: [], erpSkus: [], statuses: new Set(), candidateTypes: new Set(),
      affectedRows: 0, salesAmount: 0, profitAmount: 0,
      dateStart: null, dateEnd: null,
    };
    group.candidateIds.push(row.candidateId);
    group.erpSkus.push({ id: row.erpSkuId, merchantSkuCode: row.merchantSkuCode, specificationName: row.erpSpecificationName });
    group.statuses.add(row.candidateStatus); group.candidateTypes.add(row.candidateType);
    group.affectedRows += Number(row.affectedRowCount || 0);
    group.salesAmount += Number(row.salesAmount || 0); group.profitAmount += Number(row.profitAmount || 0);
    if (row.affectedDateStart && (!group.dateStart || row.affectedDateStart < group.dateStart)) group.dateStart = row.affectedDateStart;
    if (row.affectedDateEnd && (!group.dateEnd || row.affectedDateEnd > group.dateEnd)) group.dateEnd = row.affectedDateEnd;
    grouped.set(key, group);
  }
  return [...grouped.values()].map((group) => {
    const evidence = quantityEvidence.get(group.id) || { quantities: new Set(), rowCount: 0 };
    const quantities = [...evidence.quantities].sort((a, b) => a - b);
    const isCombo = group.erpSkus.length > 1 || group.candidateTypes.has("combo");
    const governanceType = isCombo ? "combo" : quantities.some((value) => value > 1) ? "single_quantity" : "single";
    const statuses = [...group.statuses];
    const status = statuses.length === 1 ? statuses[0] : statuses.includes("conflict") ? "conflict" : "pending";
    const reviewTarget = governanceType === "combo"
      ? { kind: "product_structure_governance", salesLinkSkuId: group.salesLinkSkuId, sourceBatchId: group.sourceBatchId }
      : { kind: governanceType === "single" ? "single_confirmation" : "single_quantity_confirmation", id: group.candidateIds[0], sourceBatchId: group.sourceBatchId };
    return {
      ...group, candidateIds: [...new Set(group.candidateIds)], erpSkus: [...new Map(group.erpSkus.map((item) => [item.id, item])).values()],
      governanceType, status, salesAmount: money(group.salesAmount), profitAmount: money(group.profitAmount),
      salesEvidence: { affectedRows: group.affectedRows, dateStart: group.dateStart, dateEnd: group.dateEnd, observedQuantities: quantities, quantityNotice: "销售日报数量仅作为审核证据，不等于正式关系quantity。" },
      reviewTarget, statuses: undefined, candidateTypes: undefined,
    };
  });
}

export function querySalesRelationGovernance(options = {}) {
  const database = getDatabase();
  const where = []; const params = [];
  const status = text(options.status) || "pending";
  if (allowedStatuses.has(status)) { where.push("c.status=?"); params.push(status); }
  if (text(options.shopId)) { where.push("l.shopId=?"); params.push(text(options.shopId)); }
  if (text(options.keyword)) {
    const keyword = `%${text(options.keyword)}%`;
    where.push("(l.title LIKE ? OR l.platformGoodsId LIKE ? OR sku.platformSkuId LIKE ? OR sku.specificationName LIKE ?)");
    params.push(keyword, keyword, keyword, keyword);
  }
  const rows = database.prepare(`SELECT c.id candidateId,c.salesLinkSkuId,c.erpSkuId,c.candidateType,c.status candidateStatus,
    c.sourceBatchId,c.affectedRowCount,c.affectedDateStart,c.affectedDateEnd,c.salesAmount,c.profitAmount,
    sku.salesLinkId,sku.platformSkuId,sku.specificationName platformSkuName,
    l.title linkName,l.platformGoodsId,l.shopId,sh.platform,sh.shopName,sh.displayName shopDisplayName,
    e.merchantSkuCode,e.specificationName erpSpecificationName,b.fileName
    FROM sales_link_sku_erp_mapping_candidates c
    JOIN sales_link_skus sku ON sku.id=c.salesLinkSkuId
    JOIN sales_links l ON l.id=sku.salesLinkId JOIN sales_shops sh ON sh.id=l.shopId
    JOIN erp_skus e ON e.id=c.erpSkuId LEFT JOIN connection_import_batches b ON b.id=c.sourceBatchId
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY c.createdAt DESC,c.sourceRowNumber,c.id`).all(...params);
  const quantityEvidence = loadQuantityEvidence(database, rows);
  const allItems = groupCandidates(rows, quantityEvidence);
  const summary = allItems.reduce((result, item) => {
    result.pendingLinkSkuCount += item.status === "pending" ? 1 : 0;
    result.salesAmount += Number(item.salesAmount || 0); result.profitAmount += Number(item.profitAmount || 0);
    result.byType[item.governanceType].count += 1;
    result.byType[item.governanceType].salesAmount += Number(item.salesAmount || 0);
    result.byType[item.governanceType].profitAmount += Number(item.profitAmount || 0);
    return result;
  }, { pendingLinkSkuCount: 0, salesAmount: 0, profitAmount: 0, byType: { single: { count: 0, salesAmount: 0, profitAmount: 0 }, single_quantity: { count: 0, salesAmount: 0, profitAmount: 0 }, combo: { count: 0, salesAmount: 0, profitAmount: 0 } } });
  summary.salesAmount = money(summary.salesAmount); summary.profitAmount = money(summary.profitAmount);
  for (const value of Object.values(summary.byType)) { value.salesAmount = money(value.salesAmount); value.profitAmount = money(value.profitAmount); }
  const governanceType = text(options.governanceType);
  const minSales = options.minSales === undefined || text(options.minSales) === "" ? null : Number(options.minSales);
  const maxSales = options.maxSales === undefined || text(options.maxSales) === "" ? null : Number(options.maxSales);
  const filtered = allItems.filter((item) => (!allowedTypes.has(governanceType) || item.governanceType === governanceType)
    && (minSales === null || item.salesAmount >= minSales) && (maxSales === null || item.salesAmount <= maxSales));
  filtered.sort((a, b) => b.salesAmount - a.salesAmount || b.profitAmount - a.profitAmount || a.salesLinkSkuId.localeCompare(b.salesLinkSkuId));
  const page = Math.max(1, Number(options.page || 1)); const pageSize = Math.min(100, Math.max(1, Number(options.pageSize || 30)));
  const items = filtered.slice((page - 1) * pageSize, page * pageSize);
  return {
    capability: "QuerySalesRelationGovernance", contractVersion: "1.0",
    summary, items, pagination: { page, pageSize, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)) },
    filterOptions: {
      shops: [...new Map(rows.map((row) => [row.shopId, { id: row.shopId, name: row.shopDisplayName || row.shopName, platform: row.platform }])).values()].sort((a, b) => a.name.localeCompare(b.name, "zh-CN")),
      statuses: [...allowedStatuses], types: [...allowedTypes],
    },
    safeguards: { createsMapping: false, writesDailyFacts: false, modifiesErpUsage: false },
  };
}
