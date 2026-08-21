import { getDatabase } from "./db.js";
import { resolveLinkSkuSalesObjects } from "./capabilities/resolveLinkSkuSalesObject.js";

const clean = (value) => String(value ?? "").trim();
const number = (value) => Number(value || 0);
const enabled = (value) => value === true || clean(value).toLowerCase() === "true" || clean(value) === "1";

function operatingLifecycleReady(database) {
  return Number(database.prepare("SELECT COUNT(*) total FROM operating_erp_set_members WHERE salesObjectId IS NOT NULL").get()?.total || 0) > 0;
}

function objectNameSql(alias = "o") {
  return `COALESCE((SELECT NULLIF(json_extract(s.sourceReferenceJson,'$.suiteName'),'') FROM sales_object_structures s
      WHERE s.salesObjectId=${alias}.id AND s.status='active' LIMIT 1),
    (SELECT NULLIF(g.goodsName,'') FROM erp_skus e JOIN erp_goods g ON g.id=e.erpGoodsId
    WHERE lower(trim(e.merchantSkuCode))=${alias}.normalizedObjectCode LIMIT 1),${alias}.objectCode)`;
}

function loadBundleCardData(database, rows) {
  if (!rows.length) return new Map();
  const ids = rows.map((row) => row.salesObjectId);
  const placeholders = ids.map(() => "?").join(",");
  const products = database.prepare(`SELECT o.id salesObjectId,c.sortOrder,c.erpSkuId,
      p.id productId,p.name productName,p.mainImage
    FROM sales_objects o
    JOIN sales_object_structures s ON s.salesObjectId=o.id AND s.status='active'
    JOIN sales_object_structure_components c ON c.structureId=s.id AND c.status='active'
    LEFT JOIN product_erp_mappings pm ON pm.erpSkuId=c.erpSkuId AND pm.currentState='active'
    LEFT JOIN products p ON p.id=pm.productId
    WHERE o.id IN (${placeholders})
    ORDER BY o.id,c.sortOrder,c.id`).all(...ids);
  const sales = database.prepare(`WITH source_facts AS (
      SELECT r.salesObjectId,f.salesAmount,ROW_NUMBER() OVER (
        PARTITION BY r.salesObjectId,f.salesLinkSkuId,f.saleDate,
          COALESCE(NULLIF(f.sourceBatchId,''),f.id),COALESCE(f.sourceRowNumber,f.id)
        ORDER BY f.id) sourceRank
      FROM sales_link_sku_sales_object_relations r
      JOIN connection_sku_sales_daily_facts f ON f.salesLinkSkuId=r.linkSkuId
      WHERE r.status='active' AND r.salesObjectId IN (${placeholders})
    ) SELECT salesObjectId,COALESCE(SUM(salesAmount),0) salesAmount
      FROM source_facts WHERE sourceRank=1 GROUP BY salesObjectId`).all(...ids);
  const cards = new Map(ids.map((id) => [id, { componentProducts: [], salesAmount: 0 }]));
  for (const row of products) {
    const card = cards.get(row.salesObjectId);
    if (card && card.componentProducts.length < 9) card.componentProducts.push({
      erpSkuId: row.erpSkuId,
      productId: row.productId || null,
      productName: row.productName || "",
      mainImage: row.mainImage || "",
    });
  }
  for (const row of sales) cards.get(row.salesObjectId).salesAmount = number(row.salesAmount);
  return cards;
}

export function listSalesObjectComboSkus(input = {}, options = {}) {
  const database = options.database || getDatabase();
  const limit = Math.min(100, Math.max(1, Number(input.limit) || 20));
  const offset = Math.max(0, Number(input.offset) || 0);
  const keyword = clean(input.search || input.keyword);
  const params = { limit, offset, keyword: `%${keyword}%` };
  const lifecycleReady = operatingLifecycleReady(database);
  const lifecycleFilter = lifecycleReady && !enabled(input.includeHistorical)
    ? " AND EXISTS (SELECT 1 FROM operating_erp_set_members om WHERE om.salesObjectId=o.id AND om.lifecycleStatus IN ('active','sales_active'))"
    : "";
  const where = `o.objectType='bundle' AND o.status='active'${lifecycleFilter} AND (@keyword='%%' OR o.objectCode LIKE @keyword OR ${objectNameSql("o")} LIKE @keyword)`;
  const total = number(database.prepare(`SELECT COUNT(*) count FROM sales_objects o WHERE ${where}`).get(params)?.count);
  const rows = database.prepare(`SELECT o.id salesObjectId,o.objectCode,${objectNameSql("o")} name,o.objectType,o.status,o.updatedAt,
      ${lifecycleReady ? `(SELECT om.lifecycleStatus FROM operating_erp_set_members om
        WHERE om.salesObjectId=o.id
        ORDER BY CASE om.lifecycleStatus WHEN 'active' THEN 0 WHEN 'sales_active' THEN 1 ELSE 2 END LIMIT 1)` : "NULL"} operatingLifecycleStatus,
      s.id structureId,s.version,COUNT(DISTINCT c.erpSkuId) componentCount,
      COUNT(DISTINCT r.linkSkuId) linkedLinkSkuCount,COUNT(DISTINCT l.id) linkedSalesLinkCount,
      COUNT(DISTINCT pm.productId) linkedProductCount
    FROM sales_objects o
    LEFT JOIN sales_object_structures s ON s.salesObjectId=o.id AND s.status='active'
    LEFT JOIN sales_object_structure_components c ON c.structureId=s.id AND c.status='active'
    LEFT JOIN sales_link_sku_sales_object_relations r ON r.salesObjectId=o.id AND r.status='active'
    LEFT JOIN sales_link_skus ls ON ls.id=r.linkSkuId
    LEFT JOIN sales_links l ON l.id=ls.salesLinkId
    LEFT JOIN product_erp_mappings pm ON pm.erpSkuId=c.erpSkuId AND pm.currentState='active'
    WHERE ${where}
    GROUP BY o.id,s.id ORDER BY o.updatedAt DESC,o.objectCode LIMIT @limit OFFSET @offset`).all(params);
  const cardData = loadBundleCardData(database, rows);
  return {
    capability: "QuerySalesObjectBundles", contractVersion: "1.0", source: "sales_object_v1",
    pagination: { total, limit, offset },
    items: rows.map((row) => ({
      ...row,
      componentCount: number(row.componentCount),
      linkedLinkSkuCount: number(row.linkedLinkSkuCount),
      linkedSalesLinkCount: number(row.linkedSalesLinkCount),
      linkedProductCount: number(row.linkedProductCount),
      salesAmount: cardData.get(row.salesObjectId)?.salesAmount || 0,
      componentProducts: cardData.get(row.salesObjectId)?.componentProducts || [],
      operatingLifecycleStatus: row.operatingLifecycleStatus || null,
    })),
    lifecycle: { ready: lifecycleReady, includeHistorical: enabled(input.includeHistorical) },
  };
}

function loadSalesObjectPerformance(database, salesObjectId) {
  const sourceRows = `SELECT f.*,ROW_NUMBER() OVER (
      PARTITION BY f.salesLinkSkuId,f.saleDate,COALESCE(NULLIF(f.sourceBatchId,''),f.id),COALESCE(f.sourceRowNumber,f.id)
      ORDER BY f.id) sourceRank
    FROM connection_sku_sales_daily_facts f
    WHERE EXISTS (SELECT 1 FROM sales_link_sku_sales_object_relations r
      WHERE r.salesObjectId=@salesObjectId AND r.linkSkuId=f.salesLinkSkuId AND r.status='active')`;
  const summary = database.prepare(`WITH source_facts AS (${sourceRows})
    SELECT COUNT(*) dataCount,MIN(saleDate) dataStart,MAX(saleDate) dataEnd,
      COALESCE(SUM(quantity),0) quantity,COALESCE(SUM(salesAmount),0) salesAmount,
      COALESCE(SUM(costAmount),0) costAmount,COALESCE(SUM(profitAmount),0) profitAmount
    FROM source_facts WHERE sourceRank=1`).get({ salesObjectId });
  const trend = database.prepare(`WITH source_facts AS (${sourceRows})
    SELECT saleDate date,SUM(quantity) quantity,SUM(salesAmount) salesAmount,SUM(costAmount) costAmount,SUM(profitAmount) profitAmount
    FROM source_facts WHERE sourceRank=1 GROUP BY saleDate ORDER BY saleDate`).all({ salesObjectId });
  return { source: "daily_fact_v1_sales_object", allocation: "source_sales_line_once", summary: { ...summary, dataCount: number(summary.dataCount), quantity: number(summary.quantity), salesAmount: number(summary.salesAmount), costAmount: number(summary.costAmount), profitAmount: number(summary.profitAmount) }, trend };
}

export function getSalesObjectComboSkuDetail(salesObjectId, options = {}) {
  const database = options.database || getDatabase();
  const id = clean(salesObjectId);
  const object = database.prepare(`SELECT o.*,${objectNameSql("o")} name,s.id structureId,s.version,s.effectiveFrom,s.updatedAt structureUpdatedAt
    FROM sales_objects o JOIN sales_object_structures s ON s.salesObjectId=o.id AND s.status='active'
    WHERE o.id=? AND o.objectType='bundle' AND o.status='active'`).get(id);
  if (!object) { const error = new Error("组合销售对象不存在。"); error.code = "sales_object_bundle_not_found"; throw error; }
  const components = database.prepare(`SELECT c.erpSkuId,e.merchantSkuCode,e.specificationName,g.goodsName,c.quantity,c.sortOrder,
      p.id productId,p.name productName,p.status productStatus
    FROM sales_object_structure_components c JOIN erp_skus e ON e.id=c.erpSkuId JOIN erp_goods g ON g.id=e.erpGoodsId
    LEFT JOIN product_erp_mappings pm ON pm.erpSkuId=e.id AND pm.currentState='active'
    LEFT JOIN products p ON p.id=pm.productId
    WHERE c.structureId=? AND c.status='active' ORDER BY c.sortOrder,e.merchantSkuCode`).all(object.structureId);
  const links = database.prepare(`SELECT r.linkSkuId,ls.salesLinkId,ls.platformSkuId,ls.platformSkuCode,ls.specificationName,
      l.title linkName,l.platformGoodsId,l.canonicalUrl,sh.platform,sh.shopName
    FROM sales_link_sku_sales_object_relations r JOIN sales_link_skus ls ON ls.id=r.linkSkuId
    JOIN sales_links l ON l.id=ls.salesLinkId JOIN sales_shops sh ON sh.id=l.shopId
    WHERE r.salesObjectId=? AND r.status='active' ORDER BY sh.shopName,l.title,ls.id`).all(id);
  const resolved = resolveLinkSkuSalesObjects({ salesLinkSkuIds: links.map((row) => row.linkSkuId) }, { database }).results;
  return {
    capability: "QuerySalesObjectBundleDetail", contractVersion: "1.0", source: "sales_object_v1",
    salesObject: { id: object.id, objectCode: object.objectCode, name: object.name, objectType: object.objectType, status: object.status, source: object.source, updatedAt: object.updatedAt },
    structure: { id: object.structureId, version: number(object.version), effectiveFrom: object.effectiveFrom, updatedAt: object.structureUpdatedAt },
    components: components.map((row) => ({ ...row, quantity: number(row.quantity) })),
    links: links.map((row) => ({ ...row, relation: resolved[row.linkSkuId] })),
    salesPerformance: loadSalesObjectPerformance(database, id),
  };
}

export default listSalesObjectComboSkus;
