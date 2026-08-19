import { getDatabase } from "../db.js";

const CAPABILITY = "QueryErpSkuUsageCandidates";
const CONTRACT_VERSION = "1.0";
const clean = (value) => String(value ?? "").trim();
const parseJson = (value, fallback = {}) => { try { return JSON.parse(value || ""); } catch { return fallback; } };

function placeholders(values) { return values.map(() => "?").join(","); }

function priorityFor(item) {
  if (Math.abs(item.salesAmount) >= 10000 || Math.abs(item.profitAmount) >= 5000 || item.salesRowCount >= 30) return "P0";
  if (item.hasActiveRelation && item.hasProductMapping) return "P1";
  return "P2";
}

export function queryErpSkuUsageCandidates(input = {}, options = {}) {
  const database = options.database || getDatabase();
  const batch = database.prepare(`SELECT id,fileName,periodStart,periodEnd,createdAt FROM connection_import_batches
    WHERE importType='erp_sales_daily_preview' ORDER BY createdAt DESC LIMIT 1`).get() || null;
  const response = { capability: CAPABILITY, contractVersion: CONTRACT_VERSION, batch, summary: {}, items: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 } };
  if (!batch) return response;

  const impactByErpSku = new Map();
  const rows = database.prepare(`SELECT normalizedDataJson FROM connection_import_rows WHERE batchId=? AND status='ready'`).all(batch.id);
  for (const row of rows) {
    const data = parseJson(row.normalizedDataJson);
    const erpSkuId = clean(data.erpSkuId);
    if (!erpSkuId) continue;
    const item = impactByErpSku.get(erpSkuId) || { salesRowCount: 0, salesLinkSkuIds: new Set(), salesAmount: 0, profitAmount: 0 };
    item.salesRowCount += 1;
    if (data.salesLinkSkuId) item.salesLinkSkuIds.add(data.salesLinkSkuId);
    item.salesAmount += Number(data.salesAmount || 0);
    item.profitAmount += Number(data.profitAmount || 0);
    impactByErpSku.set(erpSkuId, item);
  }
  const erpSkuIds = [...impactByErpSku.keys()];
  if (!erpSkuIds.length) return response;
  const idsSql = placeholders(erpSkuIds);
  const skuRows = database.prepare(`SELECT s.id,s.merchantSkuCode,s.specificationName,s.currentState,g.goodsName
    FROM erp_skus s LEFT JOIN erp_goods g ON g.id=s.erpGoodsId WHERE s.id IN (${idsSql})`).all(...erpSkuIds);
  const activeRelations = new Set(database.prepare(`SELECT DISTINCT c.erpSkuId
    FROM sales_link_sku_sales_object_relations r
    JOIN sales_objects o ON o.id=r.salesObjectId AND o.status='active'
    JOIN sales_object_structures s ON s.salesObjectId=o.id AND s.status='active'
    JOIN sales_object_structure_components c ON c.structureId=s.id AND c.status='active'
    WHERE r.status='active' AND c.erpSkuId IN (${idsSql})`).all(...erpSkuIds).map((row) => row.erpSkuId));
  const productMappings = new Set(database.prepare(`SELECT DISTINCT erpSkuId FROM product_erp_mappings
    WHERE currentState='active' AND erpSkuId IN (${idsSql})`).all(...erpSkuIds).map((row) => row.erpSkuId));
  const salesFacts = new Set(database.prepare(`SELECT DISTINCT erpSkuId FROM connection_sku_sales_daily_facts
    WHERE erpSkuId IN (${idsSql})`).all(...erpSkuIds).map((row) => row.erpSkuId));
  const usageRows = database.prepare(`SELECT * FROM erp_sku_business_usages WHERE erpSkuId IN (${idsSql}) ORDER BY erpSkuId,updatedAt DESC,id`).all(...erpSkuIds);
  const usageByErpSku = new Map();
  for (const row of usageRows) {
    if (!usageByErpSku.has(row.erpSkuId)) usageByErpSku.set(row.erpSkuId, []);
    usageByErpSku.get(row.erpSkuId).push(row);
  }

  let items = skuRows.map((sku) => {
    const impact = impactByErpSku.get(sku.id);
    const historyUsage = usageByErpSku.get(sku.id) || [];
    const activeUsage = historyUsage.find((row) => row.status === "active") || null;
    const hasActiveRelation = activeRelations.has(sku.id);
    const hasProductMapping = productMappings.has(sku.id);
    const hasSalesFact = salesFacts.has(sku.id);
    const reasonCodes = ["READY_PREVIEW_EVIDENCE"];
    if (hasActiveRelation) reasonCodes.push("ACTIVE_LINK_SKU_RELATION");
    if (hasProductMapping) reasonCodes.push("ACTIVE_PRODUCT_MAPPING");
    if (hasSalesFact) reasonCodes.push("HISTORICAL_SALES_FACT");
    const item = {
      erpSkuId: sku.id,
      merchantSkuCode: sku.merchantSkuCode,
      name: sku.goodsName || sku.specificationName || sku.merchantSkuCode,
      specification: sku.specificationName || "",
      impact: { salesRowCount: impact.salesRowCount, salesLinkSkuCount: impact.salesLinkSkuIds.size, salesAmount: impact.salesAmount, profitAmount: impact.profitAmount },
      evidence: { hasActiveRelation, hasProductMapping, hasSalesFact, historyUsage },
      suggestedUsage: "product",
      reasonCodes,
      currentUsage: activeUsage?.usageType || null,
      usageStatus: activeUsage ? "confirmed" : "unconfirmed",
    };
    item.priority = priorityFor({ ...item.impact, hasActiveRelation, hasProductMapping });
    return item;
  });

  const keyword = clean(input.keyword).toLowerCase();
  const priority = clean(input.priority);
  const evidence = clean(input.evidence);
  const status = clean(input.status || "unconfirmed");
  if (keyword) items = items.filter((item) => [item.merchantSkuCode, item.name, item.specification].some((value) => clean(value).toLowerCase().includes(keyword)));
  if (["P0", "P1", "P2"].includes(priority)) items = items.filter((item) => item.priority === priority);
  if (status === "unconfirmed") items = items.filter((item) => item.usageStatus === "unconfirmed");
  if (status === "confirmed") items = items.filter((item) => item.usageStatus === "confirmed");
  if (evidence === "relation_and_product") items = items.filter((item) => item.evidence.hasActiveRelation && item.evidence.hasProductMapping);
  const priorityOrder = { P0: 0, P1: 1, P2: 2 };
  items.sort((a, b) => (priorityOrder[a.priority] - priorityOrder[b.priority])
    || Math.abs(b.impact.salesAmount) - Math.abs(a.impact.salesAmount)
    || Math.abs(b.impact.profitAmount) - Math.abs(a.impact.profitAmount)
    || a.merchantSkuCode.localeCompare(b.merchantSkuCode));
  const page = Math.max(1, Number(input.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(input.pageSize || 50)));
  response.summary = {
    candidateCount: items.length,
    p0Count: items.filter((item) => item.priority === "P0").length,
    p1Count: items.filter((item) => item.priority === "P1").length,
    p2Count: items.filter((item) => item.priority === "P2").length,
    relationAndProductCount: items.filter((item) => item.evidence.hasActiveRelation && item.evidence.hasProductMapping).length,
    salesAmount: items.reduce((sum, item) => sum + item.impact.salesAmount, 0),
    profitAmount: items.reduce((sum, item) => sum + item.impact.profitAmount, 0),
  };
  response.items = items.slice((page - 1) * pageSize, page * pageSize);
  response.pagination = { page, pageSize, total: items.length, totalPages: Math.max(1, Math.ceil(items.length / pageSize)) };
  return response;
}

export default queryErpSkuUsageCandidates;
