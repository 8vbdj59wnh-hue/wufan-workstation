import { getDatabase } from "./db.js";
import { performance } from "node:perf_hooks";
import { FORMAL_SALES_OBJECT_RESOLVER_SCOPES, resolveLinkSkuRelationsForRead } from "./capabilities/resolveLinkSkuRelationRead.js";
import { buildLinkOperatingScope } from "./linkOperatingSetService.js";
import { resolveConnectionCockpitDateWindow } from "./connectionCockpitDateRange.js";
import { LINK_ASSET_SELECT_SQL } from "./linkAssetSql.js";

function text(value) { return String(value ?? "").trim(); }
function ratio(current, previous) { return previous ? (current - previous) / previous : null; }
function periodType(start, end) { const days = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1; return days <= 1 ? "day" : days <= 7 ? "week" : "month"; }
function serializeRange(window) { return window ? { preset: window.preset, startDate: window.periodStart, endDate: window.periodEnd,
  previousStartDate: window.previousStart, previousEndDate: window.previousEnd, windowDays: window.windowDays } : null; }

function elapsed(startedAt) { return Number((performance.now() - startedAt).toFixed(1)); }
function withTimings(payload, timings, totalStartedAt) {
  Object.defineProperty(payload, "_timings", {
    value: { ...timings, total: elapsed(totalStartedAt) }, enumerable: false,
  });
  return payload;
}

function readCockpitMetricsMap(database, salesLinkIds, window, { includePlatform = true } = {}) {
  if (!salesLinkIds.length) return new Map();
  const placeholders = salesLinkIds.map(() => "?").join(",");
  const currentWhere = window.batchId ? "sourceBatchId=?" : "saleDate BETWEEN ? AND ?";
  const currentParams = window.batchId ? [window.batchId] : [window.periodStart, window.periodEnd];
  const currentRows = database.prepare(`
    SELECT salesLinkId,MAX(updatedAt) updatedAt,SUM(COALESCE(quantity,0)) shippedQuantity,
      SUM(COALESCE(salesAmount,0)) salesAmount,SUM(COALESCE(costAmount,0)) costAmount,SUM(COALESCE(profitAmount,0)) profitAmount
    FROM connection_sku_sales_daily_facts WHERE ${currentWhere} AND salesLinkId IN (${placeholders}) GROUP BY salesLinkId
  `).all(...currentParams, ...salesLinkIds);
  const previousRows = window.previousPeriodComplete ? database.prepare(`
    SELECT salesLinkId,MAX(updatedAt) updatedAt,SUM(COALESCE(quantity,0)) shippedQuantity,
      SUM(COALESCE(salesAmount,0)) salesAmount,SUM(COALESCE(costAmount,0)) costAmount,SUM(COALESCE(profitAmount,0)) profitAmount
    FROM connection_sku_sales_daily_facts WHERE saleDate BETWEEN ? AND ? AND salesLinkId IN (${placeholders}) GROUP BY salesLinkId
  `).all(window.previousStart, window.previousEnd, ...salesLinkIds) : [];
  const currentByLink = new Map(currentRows.map((row) => [row.salesLinkId, { ...row, periodStart: window.periodStart, periodEnd: window.periodEnd,
    profitMargin: Number(row.salesAmount) ? Number(row.profitAmount || 0) / Number(row.salesAmount) : null }]));
  const previousByLink = new Map(previousRows.map((row) => [row.salesLinkId, { ...row, periodStart: window.previousStart, periodEnd: window.previousEnd,
    profitMargin: Number(row.salesAmount) ? Number(row.profitAmount || 0) / Number(row.salesAmount) : null }]));
  const platformRows = includePlatform
    ? database.prepare(`SELECT * FROM connection_period_snapshots WHERE salesLinkId IN (${placeholders}) ORDER BY salesLinkId,periodEnd DESC,periodStart DESC,createdAt DESC`).all(...salesLinkIds)
    : [];
  const platformByLink = new Map(); for (const row of platformRows) if (!platformByLink.has(row.salesLinkId)) platformByLink.set(row.salesLinkId, row);
  const empty = { periodStart: null, periodEnd: null, shippedQuantity: null, salesAmount: null, costAmount: null, profitAmount: null, profitMargin: null };
  return new Map(salesLinkIds.map((id) => { const current = currentByLink.get(id) ?? empty; const previous = previousByLink.get(id) ?? null; return [id, {
    current, previous, salesGrowth: ratio(Number(current.salesAmount || 0), Number(previous?.salesAmount || 0)),
    profitGrowth: ratio(Number(current.profitAmount || 0), Number(previous?.profitAmount || 0)), platform: platformByLink.get(id) ?? null,
  }]; }));
}

export function readShopOperations(database, window, operatingScope, personId, isAdmin) {
  const currentPredicate = window ? "f.saleDate BETWEEN @shopCurrentStart AND @shopCurrentEnd" : "0";
  const previousPredicate = window ? "f.saleDate BETWEEN @shopPreviousStart AND @shopPreviousEnd" : "0";
  const ownerPredicate = isAdmin ? "" : "AND c.ownerId=@shopOwnerId";
  const visibleShopPredicate = isAdmin ? "" : `AND EXISTS (
    SELECT 1 FROM operating_links visible_link WHERE visible_link.shopId=s.id
  )`;
  const params = {
    ...operatingScope.params,
    shopEvaluationEnd: window?.periodEnd || "9999-12-31",
    ...(window ? {
      shopCurrentStart: window.periodStart,
      shopCurrentEnd: window.periodEnd,
      shopPreviousStart: window.previousStart,
      shopPreviousEnd: window.previousEnd,
    } : {}),
    ...(isAdmin ? {} : { shopOwnerId: personId }),
  };
  const rows = database.prepare(`
    WITH operating_links AS (
      SELECT l.id salesLinkId,l.shopId,c.id connectionId
      FROM sales_links l
      JOIN sales_shops link_shop ON link_shop.id=l.shopId AND link_shop.status='active'
      LEFT JOIN ${LINK_ASSET_SELECT_SQL} c ON c.salesLinkId=l.id
      WHERE ${operatingScope.predicate} ${ownerPredicate}
    ), current_metrics AS (
      SELECT ol.shopId,SUM(COALESCE(f.salesAmount,0)) salesAmount,
        SUM(COALESCE(f.profitAmount,0)) profitAmount
      FROM operating_links ol
      JOIN connection_sku_sales_daily_facts f ON f.salesLinkId=ol.salesLinkId
      WHERE ${currentPredicate}
      GROUP BY ol.shopId
    ), previous_metrics AS (
      SELECT ol.shopId,SUM(COALESCE(f.salesAmount,0)) salesAmount
      FROM operating_links ol
      JOIN connection_sku_sales_daily_facts f ON f.salesLinkId=ol.salesLinkId
      WHERE ${previousPredicate}
      GROUP BY ol.shopId
    ), current_evaluations AS (
      SELECT salesLinkId,grade,CASE WHEN grade IS NULL THEN 'error' ELSE 'evaluated' END evaluationStatus
      FROM link_contribution_results WHERE runId=(SELECT id FROM link_contribution_runs ORDER BY ratingDate DESC LIMIT 1)
    ), link_summary AS (
      SELECT ol.shopId,COUNT(*) totalLinks,
        SUM(CASE WHEN e.grade='S' THEN 1 ELSE 0 END) excellentLinks,
        SUM(CASE WHEN e.grade='A' THEN 1 ELSE 0 END) goodLinks,
        SUM(CASE WHEN e.grade IN ('B','C') THEN 1 ELSE 0 END) onTargetLinks,
        SUM(CASE WHEN e.grade='D' THEN 1 ELSE 0 END) underperformingLinks,
        SUM(CASE WHEN e.grade='B' THEN 1 ELSE 0 END) bLinks,
        SUM(CASE WHEN e.grade='C' THEN 1 ELSE 0 END) cLinks,
        SUM(CASE WHEN e.grade='N' THEN 1 ELSE 0 END) nLinks
      FROM operating_links ol
      LEFT JOIN current_evaluations e ON e.salesLinkId=ol.salesLinkId
      GROUP BY ol.shopId
    )
    SELECT s.id shopId,s.platform,COALESCE(NULLIF(s.displayName,''),s.shopName) shopName,
      COALESCE(cm.salesAmount,0) salesAmount,COALESCE(cm.profitAmount,0) profitAmount,
      COALESCE(pm.salesAmount,0) previousSalesAmount,COALESCE(ls.totalLinks,0) totalLinks,
      COALESCE(ls.excellentLinks,0) excellentLinks,COALESCE(ls.goodLinks,0) goodLinks,
      COALESCE(ls.onTargetLinks,0) onTargetLinks,COALESCE(ls.underperformingLinks,0) underperformingLinks
    FROM sales_shops s
    LEFT JOIN current_metrics cm ON cm.shopId=s.id
    LEFT JOIN previous_metrics pm ON pm.shopId=s.id
    LEFT JOIN link_summary ls ON ls.shopId=s.id
    WHERE s.status='active' ${visibleShopPredicate}
    ORDER BY COALESCE(cm.salesAmount,0) DESC,s.platform,COALESCE(NULLIF(s.displayName,''),s.shopName),s.id
  `).all(params);
  return rows.map((row) => {
    const excellentLinks = Number(row.excellentLinks || 0);
    const goodLinks = Number(row.goodLinks || 0);
    const onTargetLinks = Number(row.onTargetLinks || 0);
    const underperformingLinks = Number(row.underperformingLinks || 0);
    return {
      ...row,
      salesAmount: Number(row.salesAmount || 0),
      profitAmount: Number(row.profitAmount || 0),
      profitMargin: Number(row.salesAmount || 0) ? Number(row.profitAmount || 0) / Number(row.salesAmount) : null,
      previousSalesAmount: Number(row.previousSalesAmount || 0),
      totalLinks: Number(row.totalLinks || 0),
      excellentLinks,
      goodLinks,
      onTargetLinks,
      underperformingLinks,
      evaluatedLinks: excellentLinks + goodLinks + onTargetLinks + underperformingLinks + Number(row.nLinks||0),
      salesTrend: window?.previousPeriodComplete
        ? ratio(Number(row.salesAmount || 0), Number(row.previousSalesAmount || 0))
        : null,
    };
  });
}

function resolveRelationMap(database, salesLinkSkuIds) {
  const results = {};
  for (let offset = 0; offset < salesLinkSkuIds.length; offset += 500) {
    Object.assign(results, resolveLinkSkuRelationsForRead({ salesLinkSkuIds: salesLinkSkuIds.slice(offset, offset + 500) }, { database, scope: "productWorkspace", salesObjectResolverEnabled: true, enabledScopes: FORMAL_SALES_OBJECT_RESOLVER_SCOPES }).results);
  }
  return results;
}

function readProductMappingsForErpSkus(database, erpSkuIds) {
  const rows = [];
  for (let offset = 0; offset < erpSkuIds.length; offset += 500) {
    const chunk = erpSkuIds.slice(offset, offset + 500);
    if (!chunk.length) continue;
    rows.push(...database.prepare(`
      SELECT m.erpSkuId,p.id productId,p.skuCode,p.name,p.mainImage
      FROM product_erp_mappings m
      JOIN products p ON p.id=m.productId
      WHERE m.currentState='active' AND m.erpSkuId IN (${chunk.map(() => "?").join(",")})
    `).all(...chunk));
  }
  return rows;
}

export function readProductAttributionContext(database, salesLinkIds) {
  const placeholders = salesLinkIds.map(() => "?").join(",");
  const linkSkus = database.prepare(`
    SELECT s.id salesLinkSkuId,s.salesLinkId
    FROM sales_link_skus s
    WHERE s.salesLinkId IN (${placeholders}) AND COALESCE(s.currentState,'active')='active'
  `).all(...salesLinkIds);
  const relations = resolveRelationMap(database, linkSkus.map((row) => row.salesLinkSkuId));
  const relatedErpSkuIds = [...new Set(Object.values(relations)
    .filter((relation) => relation?.isUsable)
    .flatMap((relation) => relation.mappings ?? [])
    .map((mapping) => mapping.erpSkuId)
    .filter(Boolean))];
  const productMappings = readProductMappingsForErpSkus(database, relatedErpSkuIds);
  const productByErpSku = new Map(productMappings.map((row) => [row.erpSkuId, row]));
  const productMeta = new Map(productMappings.map((row) => [row.productId, {
    skuCode: row.skuCode,
    name: row.name,
    mainImage: row.mainImage,
  }]));
  const attributionsBySku = new Map();
  const productsByConnection = new Map();

  for (const sku of linkSkus) {
    const relation = relations[sku.salesLinkSkuId];
    if (!relation?.isUsable) continue;
    const totalQuantity = relation.mappings.reduce((sum, mapping) => sum + Number(mapping.quantity || 0), 0);
    if (!(totalQuantity > 0)) continue;
    const quantityByProduct = new Map();
    for (const mapping of relation.mappings) {
      const product = productByErpSku.get(mapping.erpSkuId);
      if (!product) continue;
      quantityByProduct.set(product.productId, (quantityByProduct.get(product.productId) || 0) + Number(mapping.quantity || 0));
    }
    const attributions = [...quantityByProduct].map(([productId, quantity]) => ({ productId, quantity,
      salesObjectId: relation.salesObject?.id ?? null, salesObjectType: relation.salesObject?.objectType ?? null }));
    if (!attributions.length) continue;
    attributionsBySku.set(sku.salesLinkSkuId, attributions);
    const connectionProducts = productsByConnection.get(sku.salesLinkId) ?? new Map();
    for (const attribution of attributions) connectionProducts.set(attribution.productId, { id: attribution.productId, ...productMeta.get(attribution.productId) });
    productsByConnection.set(sku.salesLinkId, connectionProducts);
  }

  return {
    attributionsBySku,
    productMeta,
    productsByConnection: new Map([...productsByConnection].map(([connectionId, products]) => [
      connectionId,
      [...products.values()].sort((a, b) => text(a.skuCode).localeCompare(text(b.skuCode), "zh-CN")),
    ])),
  };
}

function readProductChannels(database, salesLinkIds, salesWindow, productAttribution) {
  if (!salesWindow || salesLinkIds.length === 0) return [];
  const linkPlaceholders = salesLinkIds.map(() => "?").join(",");
  const factRows = database.prepare(`
    SELECT f.salesLinkId,f.salesLinkSkuId,f.saleDate periodStart,f.saleDate periodEnd,
      f.salesAmount,f.profitAmount,sh.platform
    FROM connection_sku_sales_daily_facts f
    JOIN sales_links l ON l.id=f.salesLinkId
    JOIN sales_shops sh ON sh.id=l.shopId
    WHERE ${salesWindow.batchId ? "f.sourceBatchId=?" : "f.saleDate BETWEEN ? AND ?"}
      AND f.salesLinkId IN (${linkPlaceholders})
  `).all(...(salesWindow.batchId ? [salesWindow.batchId] : [salesWindow.periodStart, salesWindow.periodEnd]), ...salesLinkIds);
  const productChannelMap = new Map();
  for (const row of factRows) {
    const attributions = (productAttribution.attributionsBySku.get(row.salesLinkSkuId) ?? [])
      .filter((item) => item.salesObjectType === "single");
    if (attributions.length !== 1) continue;
    const attribution = attributions[0];
    const key = `${attribution.productId}|${row.platform}`;
    const current = productChannelMap.get(key) ?? {
      productId: attribution.productId, platform: row.platform,
      directSalesAmount: 0, directProfitAmount: 0, linkIds: new Set(),
    };
    current.directSalesAmount += Number(row.salesAmount || 0);
    current.directProfitAmount += Number(row.profitAmount || 0);
    current.linkIds.add(row.salesLinkId);
    productChannelMap.set(key, current);
  }
  const totalsByProduct = new Map();
  for (const row of productChannelMap.values()) {
    totalsByProduct.set(row.productId, (totalsByProduct.get(row.productId) || 0) + row.directSalesAmount);
  }
  return [...productChannelMap.values()].map((row) => ({
    productId: row.productId,
    ...productAttribution.productMeta.get(row.productId),
    platform: row.platform,
    directSalesAmount: row.directSalesAmount,
    directProfitAmount: row.directProfitAmount,
    salesAmount: row.directSalesAmount,
    profitAmount: row.directProfitAmount,
    linkCount: row.linkIds.size,
    contribution: totalsByProduct.get(row.productId)
      ? row.directSalesAmount / totalsByProduct.get(row.productId)
      : 0,
    metricContract: "single_direct_only",
    bundleAllocation: "none",
  })).sort((a, b) => b.directSalesAmount - a.directSalesAmount).slice(0, 30);
}

export function getConnectionBusinessCockpit(userId = "", isAdmin = false, input = {}) {
  const totalStartedAt = performance.now();
  const timings = {};
  const requestedScope = ["core", "product-channels"].includes(text(input.scope)) ? text(input.scope) : "full";
  let stageStartedAt = performance.now();
  const database = getDatabase(); const personId = text(userId);
  const operatingScope = buildLinkOperatingScope(database, { alias: "l", prefix: "connectionCockpitOperating" });
  const salesWindow = resolveConnectionCockpitDateWindow(database, input);
  timings.range = elapsed(stageStartedAt);
  stageStartedAt = performance.now();
  const shopOperations = requestedScope === "product-channels"
    ? []
    : readShopOperations(database, salesWindow, operatingScope, personId, isAdmin);
  timings.shops = elapsed(stageStartedAt);
  stageStartedAt = performance.now();
  const profiles = database.prepare(`
    SELECT COALESCE(c.id,l.id) id,c.id connectionProfileId,l.id salesLinkId,
      COALESCE(NULLIF(c.name,''),NULLIF(l.title,''),l.platformGoodsId) name,c.mainImage,c.ownerId,
      COALESCE(c.status,l.currentState,'active') status,COALESCE(c.createdAt,l.createdAt) createdAt,
      l.platformGoodsId,s.platform,s.id shopId,COALESCE(s.displayName,s.shopName) shopName,
      COALESCE(p.name,'未分配') ownerName
    FROM sales_links l JOIN sales_shops s ON s.id=l.shopId
    LEFT JOIN ${LINK_ASSET_SELECT_SQL} c ON c.salesLinkId=l.id
    LEFT JOIN persons p ON p.id=c.ownerId
    WHERE ${operatingScope.predicate} ${isAdmin ? "" : "AND c.ownerId=@scopeOwnerId"}
    ORDER BY COALESCE(c.updatedAt,l.updatedAt) DESC,l.id DESC
  `).all({ ...operatingScope.params, ...(isAdmin ? {} : { scopeOwnerId: personId }) });
  timings.profiles = elapsed(stageStartedAt);
  const connectionIds = profiles.map((item) => item.connectionProfileId).filter(Boolean); const salesLinkIds = profiles.map((item) => item.salesLinkId);
  if (!profiles.length) {
    const empty = requestedScope === "product-channels"
      ? { range: serializeRange(salesWindow), productChannels: [], scope: { isAdmin: Boolean(isAdmin), ownerId: isAdmin ? null : personId } }
      : emptyCockpit(shopOperations, salesWindow);
    return withTimings(empty, timings, totalStartedAt);
  }
  if (requestedScope === "product-channels") {
    stageStartedAt = performance.now();
    const productAttribution = readProductAttributionContext(database, salesLinkIds);
    timings.productRelations = elapsed(stageStartedAt);
    stageStartedAt = performance.now();
    const productChannels = readProductChannels(database, salesLinkIds, salesWindow, productAttribution);
    timings.productChannels = elapsed(stageStartedAt);
    return withTimings({
      range: serializeRange(salesWindow), productChannels,
      scope: { isAdmin: Boolean(isAdmin), ownerId: isAdmin ? null : personId },
    }, timings, totalStartedAt);
  }
  const placeholders = connectionIds.map(() => "?").join(","); const linkPlaceholders = salesLinkIds.map(() => "?").join(",");
  stageStartedAt = performance.now();
  const metrics = salesWindow
    ? readCockpitMetricsMap(database, salesLinkIds, salesWindow, { includePlatform: requestedScope === "full" })
    : new Map(salesLinkIds.map((id) => [id, { current: {}, previous: null, salesGrowth: null, profitGrowth: null, platform: null }]));
  timings.salesAndProfit = elapsed(stageStartedAt);
  stageStartedAt = performance.now();
  const evaluationRows = database.prepare(`SELECT salesLinkId connectionId,grade FROM link_contribution_results
    WHERE runId=(SELECT id FROM link_contribution_runs ORDER BY ratingDate DESC LIMIT 1)`).all();
  const evaluationByConnection = new Map(evaluationRows.map((row) => [row.connectionId, row.grade]));
  timings.ratings = elapsed(stageStartedAt);
  stageStartedAt = performance.now();
  const productAttribution = requestedScope === "full"
    ? readProductAttributionContext(database, salesLinkIds)
    : { attributionsBySku: new Map(), productMeta: new Map(), productsByConnection: new Map() };
  timings.productRelations = elapsed(stageStartedAt);
  stageStartedAt = performance.now();
  const items = profiles.map((profile) => {
    const v3 = metrics.get(profile.salesLinkId);
    const salesGrowth = v3.salesGrowth; const profitGrowth = v3.profitGrowth;
    const grade = profile.connectionProfileId ? evaluationByConnection.get(profile.connectionProfileId) : null;
    const risk = grade === "D" || Number(salesGrowth) < -0.2 || Number(profitGrowth) < -0.2;
    return {
      ...profile,
      products: productAttribution.productsByConnection.get(profile.salesLinkId) ?? [],
      erpSales: v3.current, previousErpSales: v3.previous,
      platformPerformance: v3.platform, salesGrowth, profitGrowth,
      visitorGrowth: null, conversionChange: null,
      evaluationGrade: grade || null, operationStage: "normal", risk,
    };
  });
  const totalSales = items.reduce((sum, item) => sum + Number(item.erpSales.salesAmount || 0), 0); const totalProfit = items.reduce((sum, item) => sum + Number(item.erpSales.profitAmount || 0), 0); const previousSales = items.reduce((sum, item) => sum + Number(item.previousErpSales?.salesAmount || 0), 0); const quantity = items.reduce((sum, item) => sum + Number(item.erpSales.shippedQuantity ?? item.erpSales.quantity ?? 0), 0);
  const salesPeriodStart = salesWindow?.periodStart ?? null;
  const salesPeriodEnd = salesWindow?.periodEnd ?? null;
  const salesUpdatedAt = items.map((item) => item.erpSales.updatedAt).filter(Boolean).sort().at(-1) ?? null;
  const ratingSummary = { S:0,A:0,B:0,C:0,D:0,N:0,excellentOrGood: 0, onTarget: 0, underperforming: 0, notEvaluated: 0 };
  for (const item of items) {
    if (!item.evaluationGrade) ratingSummary.notEvaluated += 1;
    else { ratingSummary[item.evaluationGrade]+=1;
      if(item.evaluationGrade==='D')ratingSummary.underperforming++;
      else if(['B','C'].includes(item.evaluationGrade))ratingSummary.onTarget++;
      else if(['S','A'].includes(item.evaluationGrade))ratingSummary.excellentOrGood++;
    }
  }
  const coreLinks = items.filter((item) => item.erpSales.periodEnd).sort((a,b) => Number(b.erpSales.salesAmount||0)-Number(a.erpSales.salesAmount||0) || Number(b.erpSales.profitAmount||0)-Number(a.erpSales.profitAmount||0) || Number(b.erpSales.quantity||0)-Number(a.erpSales.quantity||0)).slice(0,10);
  const riskLinks = items.filter((item) => item.risk).sort((a,b) => Number(a.salesGrowth??0)-Number(b.salesGrowth??0)).slice(0,10).map((item) => ({ ...item, anomalyTypes: [item.evaluationGrade==="D"?"贡献级别D":"",Number(item.salesGrowth)<-0.2?"销售下降":"",Number(item.profitGrowth)<-0.2?"利润下降":""].filter(Boolean) }));
  const growthLinks = items.map((item) => ({ ...item, growthMetric: Math.max(...[item.salesGrowth,item.profitGrowth].filter((value) => value !== null).map(Number), -Infinity) })).filter((item) => Number.isFinite(item.growthMetric) && item.growthMetric > 0).sort((a,b) => b.growthMetric-a.growthMetric).slice(0,10);
  timings.riskAndGrowth = elapsed(stageStartedAt);
  stageStartedAt = performance.now();
  const platformMap = new Map(); for (const item of items) { const row=platformMap.get(item.platform)??{platform:item.platform,connectionCount:0,salesAmount:0,profitAmount:0,riskCount:0,excellentOrGoodCount:0}; row.connectionCount++; row.salesAmount+=Number(item.erpSales.salesAmount||0); row.profitAmount+=Number(item.erpSales.profitAmount||0); if(item.risk)row.riskCount++; if(["S","A"].includes(item.evaluationGrade)&&!item.risk)row.excellentOrGoodCount++; platformMap.set(item.platform,row); }
  const platforms=[...platformMap.values()].map((row)=>({...row,profitMargin:row.salesAmount?row.profitAmount/row.salesAmount:null,excellentOrGoodRate:row.connectionCount?row.excellentOrGoodCount/row.connectionCount:0})).sort((a,b)=>b.salesAmount-a.salesAmount);
  const ownerMap = new Map(); for (const item of items) { const ownerId=item.ownerId||"unassigned"; const row=ownerMap.get(ownerId)??{ownerId,ownerName:item.ownerName||"未分配",connectionCount:0,salesAmount:0,profitAmount:0,growthTotal:0,growthCount:0,riskCount:0}; row.connectionCount+=1; row.salesAmount+=Number(item.erpSales.salesAmount||0); row.profitAmount+=Number(item.erpSales.profitAmount||0); if(item.salesGrowth!==null){row.growthTotal+=Number(item.salesGrowth);row.growthCount+=1;} if(item.risk)row.riskCount+=1; ownerMap.set(ownerId,row); } const ownerOperations=[...ownerMap.values()].map((row)=>({...row,averageGrowth:row.growthCount?row.growthTotal/row.growthCount:null,profitMargin:row.salesAmount?row.profitAmount/row.salesAmount:null})).sort((a,b)=>b.salesAmount-a.salesAmount||b.profitAmount-a.profitAmount);
  timings.ownerAndPlatform = elapsed(stageStartedAt);
  stageStartedAt = performance.now();
  const productChannels = requestedScope === "full"
    ? readProductChannels(database, salesLinkIds, salesWindow, productAttribution)
    : [];
  timings.productChannels = elapsed(stageStartedAt);
  stageStartedAt = performance.now();
  const erpTrend=salesWindow?database.prepare(`SELECT saleDate periodStart,saleDate periodEnd,SUM(COALESCE(quantity,0)) quantity,SUM(COALESCE(salesAmount,0)) salesAmount,SUM(COALESCE(profitAmount,0)) profitAmount FROM connection_sku_sales_daily_facts WHERE saleDate BETWEEN ? AND ? AND salesLinkId IN (${linkPlaceholders}) GROUP BY saleDate ORDER BY saleDate`).all(salesWindow.periodStart,salesWindow.periodEnd,...salesLinkIds).map((row)=>({...row,periodType:periodType(row.periodStart,row.periodEnd)})):[];
  const platformTrend=salesWindow?database.prepare(`SELECT periodStart,periodEnd,SUM(COALESCE(visitorCount,0)) visitorCount,SUM(COALESCE(viewCount,0)) viewCount FROM connection_period_snapshots WHERE periodStart>=? AND periodEnd<=? AND salesLinkId IN (${linkPlaceholders}) GROUP BY periodStart,periodEnd ORDER BY periodEnd,periodStart`).all(salesWindow.periodStart,salesWindow.periodEnd,...salesLinkIds).map((row)=>({...row,periodType:periodType(row.periodStart,row.periodEnd)})):[];
  timings.trends = elapsed(stageStartedAt);
  return withTimings({ range:serializeRange(salesWindow),summary:{connectionCount:items.length,managedConnectionCount:items.filter((item)=>item.connectionProfileId).length,unmanagedConnectionCount:items.filter((item)=>!item.connectionProfileId).length,normalCount:items.filter((item)=>!item.risk).length,riskCount:items.filter((item)=>item.risk).length,quantity,salesAmount:totalSales,salesGrowth:salesWindow?.previousPeriodComplete?ratio(totalSales,previousSales):null,salesPeriodStart,salesPeriodEnd,salesPeriodAligned:true,salesPeriodCount:salesWindow?.currentDateCount||0,salesWindowDays:salesWindow?.windowDays||0,currentPeriodDateCount:salesWindow?.currentDateCount||0,previousPeriodDateCount:salesWindow?.previousDateCount||0,previousPeriodComplete:Boolean(salesWindow?.previousPeriodComplete),salesUpdatedAt,profitAmount:totalProfit,profitMargin:totalSales?totalProfit/totalSales:null,highProfitCount:items.filter((item)=>Number(item.erpSales.profitMargin)>=0.2).length,profitRiskCount:items.filter((item)=>Number(item.erpSales.profitAmount)<0||Number(item.profitGrowth)<-0.2).length},ratingSummary,shopOperations,ownerOperations,coreLinks,riskLinks,growthLinks,platforms,productChannels,trends:{erp:erpTrend,platform:platformTrend},scope:{isAdmin:Boolean(isAdmin),ownerId:isAdmin?null:personId}}, timings, totalStartedAt);
}

function emptyCockpit(shopOperations=[],salesWindow=null){return{range:serializeRange(salesWindow),summary:{salesPeriodStart:salesWindow?.periodStart||null,salesPeriodEnd:salesWindow?.periodEnd||null,salesWindowDays:salesWindow?.windowDays||0},ratingSummary:{excellentOrGood:0,onTarget:0,underperforming:0,notEvaluated:0},shopOperations,ownerOperations:[],coreLinks:[],riskLinks:[],growthLinks:[],platforms:[],productChannels:[],trends:{erp:[],platform:[]},scope:{}};}
