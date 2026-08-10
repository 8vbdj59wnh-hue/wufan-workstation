import { getDatabase } from "./db.js";
import { confirmErpSkuBusinessUsage } from "./capabilities/resolveErpSkuBusinessUsage.js";
import { queryErpSkuUsageCandidates } from "./capabilities/queryErpSkuUsageCandidates.js";

const clean = (value) => String(value ?? "").trim();
const parseJson = (value, fallback = {}) => { try { return JSON.parse(value || ""); } catch { return fallback; } };
const usageTypes = new Set(["product", "accounting_auxiliary", "shipping_adjustment", "other_adjustment"]);

function latestPreviewBatch(database) {
  return database.prepare(`SELECT id,fileName,periodStart,periodEnd,createdAt FROM connection_import_batches
    WHERE importType='erp_sales_daily_preview' ORDER BY createdAt DESC LIMIT 1`).get() || null;
}

function loadImpactRows(database, batchId, statuses = null) {
  if (!batchId) return [];
  const selected = Array.isArray(statuses) ? statuses.filter(Boolean) : [];
  const where = selected.length ? ` AND status IN (${selected.map(() => "?").join(",")})` : "";
  const erpSkuByCode = new Map(database.prepare("SELECT id,LOWER(merchantSkuCode) code FROM erp_skus").all().map((row) => [row.code, row.id]));
  return database.prepare(`SELECT rowNumber,normalizedDataJson,status FROM connection_import_rows
    WHERE batchId=?${where} ORDER BY rowNumber`).all(batchId, ...selected).map((row) => ({
      rowNumber: row.rowNumber,
      previewStatus: row.status,
      data: parseJson(row.normalizedDataJson),
    })).map((row) => {
      if (!row.data.erpSkuId && clean(row.data.merchantSkuCode)) row.data.erpSkuId = erpSkuByCode.get(clean(row.data.merchantSkuCode).toLowerCase()) || null;
      return row;
    }).filter((row) => row.data.erpSkuId);
}

function aggregateImpacts(rows) {
  const result = new Map();
  for (const row of rows) {
    const key = row.data.erpSkuId;
    const item = result.get(key) || { rowCount: 0, salesLinkSkuIds: new Set(), salesAmount: 0, profitAmount: 0, quantity: 0, dateStart: null, dateEnd: null, rows: [] };
    item.rowCount += 1;
    if (row.data.salesLinkSkuId) item.salesLinkSkuIds.add(row.data.salesLinkSkuId);
    item.salesAmount += Number(row.data.salesAmount || 0);
    item.profitAmount += Number(row.data.profitAmount || 0);
    item.quantity += Number(row.data.quantity || 0);
    const date = clean(row.data.saleDate);
    if (date && (!item.dateStart || date < item.dateStart)) item.dateStart = date;
    if (date && (!item.dateEnd || date > item.dateEnd)) item.dateEnd = date;
    item.rows.push(row);
    result.set(key, item);
  }
  return result;
}

function loadUsageRows(database) {
  const rows = database.prepare(`SELECT u.*,p.name reviewedByName FROM erp_sku_business_usages u
    LEFT JOIN persons p ON p.id=u.reviewedBy ORDER BY u.erpSkuId,u.updatedAt DESC,u.id`).all();
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.erpSkuId)) grouped.set(row.erpSkuId, []);
    grouped.get(row.erpSkuId).push(row);
  }
  return grouped;
}

function usageState(records = []) {
  const active = records.filter((row) => row.status === "active");
  const conflict = records.find((row) => row.status === "conflict") || (active.length > 1 ? active[0] : null);
  const proposed = records.find((row) => row.status === "proposed") || null;
  return {
    status: conflict ? "conflict" : active.length === 1 ? "active" : proposed ? "proposed" : "proposed",
    active: active.length === 1 ? active[0] : null,
    proposed,
    records,
  };
}

function priority(impact) {
  const amount = Math.abs(Number(impact?.salesAmount || 0));
  if (amount >= 5000 || Number(impact?.rowCount || 0) >= 30) return "P0";
  if (amount >= 1000 || Number(impact?.rowCount || 0) >= 10) return "P1";
  return "P2";
}

function decorateSku(row, impact, state) {
  return {
    erpSkuId: row.id,
    merchantSkuCode: row.merchantSkuCode,
    name: row.goodsName || row.specificationName || row.merchantSkuCode,
    specification: row.specificationName || "",
    erpStatus: row.erpStatus || row.currentState,
    suggestedUsage: state.proposed?.usageType || null,
    suggestionEvidence: state.proposed?.decisionNote || null,
    currentUsage: state.active?.usageType || null,
    status: state.status,
    priority: priority(impact),
    impact: {
      rowCount: impact?.rowCount || 0,
      salesLinkSkuCount: impact?.salesLinkSkuIds?.size || 0,
      salesAmount: impact?.salesAmount || 0,
      profitAmount: impact?.profitAmount || 0,
      quantity: impact?.quantity || 0,
      dateStart: impact?.dateStart || null,
      dateEnd: impact?.dateEnd || null,
    },
    audit: state.active ? {
      sourceType: state.active.sourceType,
      reviewedBy: state.active.reviewedBy,
      reviewedByName: state.active.reviewedByName,
      reviewedAt: state.active.reviewedAt,
      decisionNote: state.active.decisionNote,
    } : null,
  };
}

function governanceRows(database) {
  const batch = latestPreviewBatch(database);
  // Older preview revisions stored pre-classification relation categories. These
  // three blocked categories are exactly the rows reclassified as unknown by the
  // current SalesDetail classification pipeline until an ERP usage is confirmed.
  const governanceStatuses = ["unknown", "error", "missing_relation", "relation_conflict"];
  const impacts = aggregateImpacts(loadImpactRows(database, batch?.id, governanceStatuses));
  const usages = loadUsageRows(database);
  const erpSkuIds = [...new Set([...impacts.keys(), ...usages.keys()])];
  const unresolvedCodes = new Set(database.prepare(`SELECT normalizedDataJson FROM connection_import_rows
    WHERE batchId=? AND status IN ('unknown','error','missing_relation','relation_conflict')`).all(batch?.id || "").map((row) => parseJson(row.normalizedDataJson)).filter((row) => !row.erpSkuId && clean(row.merchantSkuCode)).map((row) => clean(row.merchantSkuCode).toLowerCase()));
  const resolvedCodes = new Set(database.prepare("SELECT LOWER(merchantSkuCode) code FROM erp_skus").all().map((row) => row.code));
  const identityIssueCount = [...unresolvedCodes].filter((code) => !resolvedCodes.has(code)).length;
  if (!erpSkuIds.length) return { batch, items: [], identityIssueCount };
  const placeholders = erpSkuIds.map(() => "?").join(",");
  const skuRows = database.prepare(`SELECT s.*,g.goodsName FROM erp_skus s LEFT JOIN erp_goods g ON g.id=s.erpGoodsId WHERE s.id IN (${placeholders})`).all(...erpSkuIds);
  return { batch, items: skuRows.map((row) => decorateSku(row, impacts.get(row.id), usageState(usages.get(row.id)))), identityIssueCount };
}

export function queryErpSkuUsageGovernance(options = {}, context = {}) {
  const database = context.database || getDatabase();
  const { batch, items: source, identityIssueCount } = governanceRows(database);
  const keyword = clean(options.keyword).toLowerCase();
  const status = clean(options.status);
  const suggestedUsage = clean(options.suggestedUsage);
  const selectedPriority = clean(options.priority);
  let items = source.filter((item) => !keyword || [item.merchantSkuCode, item.name, item.specification].some((value) => clean(value).toLowerCase().includes(keyword)));
  if (status === "unconfirmed") items = items.filter((item) => item.status === "proposed");
  if (status === "confirmed") items = items.filter((item) => item.status === "active");
  if (status === "conflict") items = items.filter((item) => item.status === "conflict");
  if (usageTypes.has(suggestedUsage)) items = items.filter((item) => item.suggestedUsage === suggestedUsage);
  if (["P0", "P1", "P2"].includes(selectedPriority)) items = items.filter((item) => item.priority === selectedPriority);
  items.sort((a, b) => Math.abs(b.impact.salesAmount) - Math.abs(a.impact.salesAmount) || b.impact.rowCount - a.impact.rowCount || a.merchantSkuCode.localeCompare(b.merchantSkuCode));
  const page = Math.max(1, Number(options.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(options.pageSize || 30)));
  const all = source;
  return {
    batch,
    summary: {
      pendingCount: all.filter((item) => item.status === "proposed").length,
      pendingSalesAmount: all.filter((item) => item.status === "proposed").reduce((sum, item) => sum + item.impact.salesAmount, 0),
      pendingProfitAmount: all.filter((item) => item.status === "proposed").reduce((sum, item) => sum + item.impact.profitAmount, 0),
      confirmedCount: all.filter((item) => item.status === "active").length,
      conflictCount: all.filter((item) => item.status === "conflict").length,
      identityIssueCount,
    },
    items: items.slice((page - 1) * pageSize, page * pageSize),
    pagination: { page, pageSize, total: items.length, totalPages: Math.max(1, Math.ceil(items.length / pageSize)) },
  };
}

export function readErpSkuUsageGovernance(erpSkuId, options = {}, context = {}) {
  const database = context.database || getDatabase();
  const { batch, items } = governanceRows(database);
  const item = items.find((row) => row.erpSkuId === clean(erpSkuId));
  if (!item) throw new Error("ERP SKU用途治理对象不存在。");
  const impactRows = loadImpactRows(database, batch?.id, ["unknown", "error", "missing_relation", "relation_conflict"]).filter((row) => row.data.erpSkuId === item.erpSkuId);
  const page = Math.max(1, Number(options.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(options.pageSize || 30)));
  const pageRows = impactRows.slice((page - 1) * pageSize, page * pageSize);
  const linkIds = [...new Set(pageRows.map((row) => row.data.salesLinkId).filter(Boolean))];
  const links = linkIds.length ? database.prepare(`SELECT id,title FROM sales_links WHERE id IN (${linkIds.map(() => "?").join(",")})`).all(...linkIds) : [];
  const linkById = new Map(links.map((row) => [row.id, row]));
  return {
    batch,
    item,
    usageHistory: usageState(loadUsageRows(database).get(item.erpSkuId)).records,
    salesRows: pageRows.map((row) => ({
      rowNumber: row.rowNumber,
      saleDate: row.data.saleDate,
      linkName: linkById.get(row.data.salesLinkId)?.title || row.data.linkTitle || "—",
      salesLinkSkuId: row.data.salesLinkSkuId,
      quantity: row.data.quantity,
      salesAmount: row.data.salesAmount,
      profitAmount: row.data.profitAmount,
      previewStatus: row.previewStatus,
    })),
    pagination: { page, pageSize, total: impactRows.length, totalPages: Math.max(1, Math.ceil(impactRows.length / pageSize)) },
  };
}

export function confirmErpSkuUsageGovernance(erpSkuId, input = {}, context = {}) {
  return confirmErpSkuBusinessUsage({
    erpSkuId,
    usageType: input.usageType,
    decisionNote: input.decisionNote,
    reviewedBy: context.reviewedBy,
  }, { database: context.database || getDatabase() });
}

export function queryErpSkuProductUsageCandidates(options = {}, context = {}) {
  return queryErpSkuUsageCandidates(options, { database: context.database || getDatabase() });
}

export function confirmErpSkuProductUsages(input = {}, context = {}) {
  const database = context.database || getDatabase();
  const reviewedBy = clean(context.reviewedBy);
  const erpSkuIds = [...new Set((Array.isArray(input.erpSkuIds) ? input.erpSkuIds : []).map(clean).filter(Boolean))];
  if (!erpSkuIds.length) throw new Error("请选择需要确认的ERP SKU。");
  if (erpSkuIds.length > 100) throw new Error("单次最多确认100个ERP SKU。");
  const decisionNote = clean(input.decisionNote);
  if (!decisionNote) throw new Error("批量人工确认必须填写说明。");
  const results = [];
  for (const erpSkuId of erpSkuIds) {
    try {
      const result = confirmErpSkuBusinessUsage({ erpSkuId, usageType: "product", reviewedBy, decisionNote }, { database });
      results.push({ erpSkuId, success: true, idempotent: result.idempotent, usageId: result.usage.id });
    } catch (error) {
      results.push({ erpSkuId, success: false, reason: error.message || "确认失败" });
    }
  }
  return {
    requestedCount: erpSkuIds.length,
    successCount: results.filter((item) => item.success).length,
    failedCount: results.filter((item) => !item.success).length,
    results,
  };
}
