import { getDatabase } from "./db.js";
import { FORMAL_SALES_OBJECT_RESOLVER_SCOPES, resolveLinkSkuRelationsForRead } from "./capabilities/resolveLinkSkuRelationRead.js";

const BATCH_SIZE = 500;

function text(value) {
  return String(value ?? "").trim();
}

function placeholders(values) {
  return values.map(() => "?").join(",");
}

function resolveRelations(database, salesLinkSkuIds) {
  const ids = [...new Set(salesLinkSkuIds.map(text).filter(Boolean))];
  const results = {};
  for (let offset = 0; offset < ids.length; offset += BATCH_SIZE) {
    Object.assign(results, resolveLinkSkuRelationsForRead(
      { salesLinkSkuIds: ids.slice(offset, offset + BATCH_SIZE) },
      {
        database,
        scope: "productAssociations",
        salesObjectResolverEnabled: true,
        enabledScopes: FORMAL_SALES_OBJECT_RESOLVER_SCOPES,
        logDifference: () => {},
      },
    ).results);
  }
  return results;
}

function readProductsByErpSku(database) {
  const rows = database.prepare(`
    SELECT m.erpSkuId,p.id productId
    FROM product_erp_mappings m
    JOIN products p ON p.id=m.productId
    WHERE m.currentState='active' AND m.erpSkuId IS NOT NULL AND m.productId IS NOT NULL
    ORDER BY m.updatedAt,m.id
  `).all();
  const result = new Map();
  for (const row of rows) {
    if (!result.has(row.erpSkuId)) result.set(row.erpSkuId, []);
    if (!result.get(row.erpSkuId).includes(row.productId)) result.get(row.erpSkuId).push(row.productId);
  }
  return result;
}

function productIdsForRelation(relation, productsByErpSku) {
  if (!relation?.isUsable) return [];
  return [...new Set(relation.mappings.flatMap((mapping) => productsByErpSku.get(mapping.erpSkuId) ?? []))];
}

function readLinkSkuRows(database, salesLinkSkuIds) {
  const ids = [...new Set(salesLinkSkuIds.map(text).filter(Boolean))];
  const rows = [];
  for (let offset = 0; offset < ids.length; offset += BATCH_SIZE) {
    const batch = ids.slice(offset, offset + BATCH_SIZE);
    rows.push(...database.prepare(`
      SELECT
        x.id,x.salesLinkId,x.platformSkuId,x.platformSkuCode,x.normalizedPlatformSkuCode,
        x.specificationName,x.normalizedSpecificationName,x.price,x.platformStock,x.occupiedStock,
        x.systemGoodsType,x.syncEnabled,x.lastSyncedStock,x.lastSyncedAt,x.stopSyncReason,
        x.matchStatus,x.matchMethod,x.matchReason,x.lastSeenBatchId,x.createdAt,x.updatedAt,
        x.currentState,x.missingAt,
        l.shopId,l.platformGoodsId,l.platformGoodsCode,l.title,l.rawUrl,l.canonicalUrl,
        l.status linkStatus,l.activityStatus,l.category,l.identityStrength,
        s.platform,s.shopName,s.displayName,c.id connectionProfileId
      FROM sales_link_skus x
      JOIN sales_links l ON l.id=x.salesLinkId
      JOIN sales_shops s ON s.id=l.shopId
      LEFT JOIN connection_profiles c ON c.salesLinkId=l.id
      WHERE x.id IN (${placeholders(batch)})
        AND COALESCE(x.currentState,'active')='active'
        AND COALESCE(l.currentState,'active')='active'
      ORDER BY s.platform,s.displayName,l.title,x.platformSkuCode,x.id
    `).all(...batch));
  }
  return rows;
}

export function queryUnmatchedPlatformSkus(options = {}, context = {}) {
  const database = context.database || getDatabase();
  const query = text(options.query);
  const limit = Math.min(200, Math.max(20, Number(options.limit) || 100));
  const offset = Math.max(0, Number(options.offset) || 0);
  const search = `%${query}%`;
  const candidates = database.prepare(`
    SELECT
      x.id,x.salesLinkId,x.platformSkuId,x.platformSkuCode,x.normalizedPlatformSkuCode,
      x.specificationName,x.normalizedSpecificationName,x.price,x.platformStock,x.occupiedStock,
      x.systemGoodsType,x.syncEnabled,x.lastSyncedStock,x.lastSyncedAt,x.stopSyncReason,
      x.matchStatus,x.matchMethod,x.matchReason,x.lastSeenBatchId,x.createdAt,x.updatedAt,
      x.currentState,x.missingAt,
      l.shopId,l.platformGoodsId,l.platformGoodsCode,l.title,l.rawUrl,l.canonicalUrl,
      s.platform,s.shopName,s.displayName,
      g.id possibleErpGoodsId,g.goodsCode possibleErpGoodsCode,g.goodsName possibleErpGoodsName
    FROM sales_link_skus x
    JOIN sales_links l ON l.id=x.salesLinkId
    JOIN sales_shops s ON s.id=l.shopId
    LEFT JOIN erp_goods g ON lower(g.goodsCode)=lower(l.platformGoodsCode)
    WHERE COALESCE(x.currentState,'active')='active'
      AND COALESCE(l.currentState,'active')='active'
      AND COALESCE(x.matchStatus,'pending') NOT IN ('ignored','combination')
      AND NOT EXISTS (
        SELECT 1
        FROM sales_link_sku_erp_mappings relation
        JOIN product_erp_mappings productMapping
          ON productMapping.erpSkuId=relation.erpSkuId AND productMapping.currentState='active'
        WHERE relation.salesLinkSkuId=x.id AND relation.currentState='active'
      )
      AND (?='' OR x.platformSkuCode LIKE ? OR x.platformSkuId LIKE ? OR x.specificationName LIKE ?
        OR l.title LIKE ? OR l.platformGoodsCode LIKE ? OR l.platformGoodsId LIKE ?)
    ORDER BY s.platform,s.displayName,l.title,x.platformSkuCode,x.id
  `).all(query, search, search, search, search, search, search);
  const relations = resolveRelations(database, candidates.map((row) => row.id));
  const productsByErpSku = readProductsByErpSku(database);
  const unmatched = candidates.filter((row) => productIdsForRelation(relations[row.id], productsByErpSku).length === 0);
  return {
    rows: unmatched.slice(offset, offset + limit).map((row) => ({
      ...row,
      productId: null,
      productIds: [],
      relationStatus: relations[row.id]?.relationStatus ?? "missing",
    })),
    pagination: { total: unmatched.length, limit, offset },
  };
}

export function queryProductSalesSummaries(context = {}) {
  const database = context.database || getDatabase();
  const factRows = database.prepare(`
    SELECT DISTINCT facts.salesLinkSkuId,x.salesLinkId,l.shopId,s.platform
    FROM (
      SELECT salesLinkSkuId FROM connection_sku_sales_facts WHERE salesLinkSkuId IS NOT NULL
      UNION
      SELECT salesLinkSkuId FROM connection_sku_sales_daily_facts WHERE salesLinkSkuId IS NOT NULL
    ) facts
    JOIN sales_link_skus x ON x.id=facts.salesLinkSkuId
    JOIN sales_links l ON l.id=x.salesLinkId
    JOIN sales_shops s ON s.id=l.shopId
    WHERE COALESCE(x.currentState,'active')='active' AND COALESCE(l.currentState,'active')='active'
    ORDER BY facts.salesLinkSkuId
  `).all();
  const relations = resolveRelations(database, factRows.map((row) => row.salesLinkSkuId));
  const productsByErpSku = readProductsByErpSku(database);
  const summaries = new Map();
  for (const row of factRows) {
    for (const productId of productIdsForRelation(relations[row.salesLinkSkuId], productsByErpSku)) {
      const summary = summaries.get(productId) ?? { productId, links: new Set(), shops: new Set(), platforms: new Set() };
      summary.links.add(row.salesLinkId);
      summary.shops.add(row.shopId);
      if (row.platform) summary.platforms.add(row.platform);
      summaries.set(productId, summary);
    }
  }
  return [...summaries.values()].map((summary) => ({
    productId: summary.productId,
    linkCount: summary.links.size,
    shopCount: summary.shops.size,
    platformCount: summary.platforms.size,
    platforms: [...summary.platforms].sort((left, right) => left.localeCompare(right, "zh-CN")),
  })).sort((left, right) => left.productId.localeCompare(right.productId));
}

export function queryProductSalesLinks(productIdValue, context = {}) {
  const database = context.database || getDatabase();
  const productId = text(productIdValue);
  const erpSkuIds = database.prepare(`
    SELECT DISTINCT erpSkuId
    FROM product_erp_mappings
    WHERE productId=? AND currentState='active' AND erpSkuId IS NOT NULL
    ORDER BY erpSkuId
  `).all(productId).map((row) => row.erpSkuId);
  if (!erpSkuIds.length) return [];
  const candidateIds = [];
  for (let offset = 0; offset < erpSkuIds.length; offset += BATCH_SIZE) {
    const batch = erpSkuIds.slice(offset, offset + BATCH_SIZE);
    candidateIds.push(...database.prepare(`
      SELECT DISTINCT salesLinkSkuId
      FROM sales_link_sku_erp_mappings
      WHERE currentState='active' AND erpSkuId IN (${placeholders(batch)})
      ORDER BY salesLinkSkuId
    `).all(...batch).map((row) => row.salesLinkSkuId));
  }
  const uniqueCandidateIds = [...new Set(candidateIds)];
  const relations = resolveRelations(database, uniqueCandidateIds);
  const targetErpSkuIds = new Set(erpSkuIds);
  const matchedIds = uniqueCandidateIds.filter((id) => relations[id]?.isUsable
    && relations[id].mappings.some((mapping) => targetErpSkuIds.has(mapping.erpSkuId)));
  return readLinkSkuRows(database, matchedIds).map((row) => ({
    ...row,
    productId,
    resolvedErpSkuIds: relations[row.id].mappings.map((mapping) => mapping.erpSkuId),
  }));
}
