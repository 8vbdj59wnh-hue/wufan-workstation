import { getDatabase } from "./db.js";
import { listConnectionGrowthAnalyses } from "./connectionGrowthService.js";
import { FORMAL_SALES_OBJECT_RESOLVER_SCOPES, resolveLinkSkuRelationsForRead } from "./capabilities/resolveLinkSkuRelationRead.js";
import { buildLinkOperatingScope } from "./linkOperatingSetService.js";

function text(value) { return String(value ?? "").trim(); }
function ratio(current, previous) { return previous ? (current - previous) / previous : null; }
function periodType(start, end) { const days = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1; return days <= 1 ? "day" : days <= 7 ? "week" : "month"; }

function dateShift(date, days) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function latestSalesWindow(database) {
  const batch = database.prepare(`
    SELECT id,periodStart,periodEnd,completedAt
    FROM connection_import_batches b
    WHERE b.sourceType='erp_sales_daily_preview'
      AND b.status IN ('completed','completed_with_exceptions')
      AND b.periodStart IS NOT NULL AND b.periodEnd IS NOT NULL
      AND EXISTS (SELECT 1 FROM connection_sku_sales_daily_facts f WHERE f.sourceBatchId=b.id)
    ORDER BY COALESCE(b.completedAt,b.updatedAt,b.createdAt) DESC,b.id DESC LIMIT 1
  `).get();
  if (batch) {
    const periodEnd = batch.periodEnd;
    const periodStart = dateShift(periodEnd, -29);
    const previousEnd = dateShift(periodStart, -1);
    const previousStart = dateShift(periodEnd, -59);
    const currentDateCount = Number(database.prepare("SELECT COUNT(DISTINCT saleDate) count FROM connection_sku_sales_daily_facts WHERE saleDate BETWEEN ? AND ?").get(periodStart, periodEnd)?.count || 0);
    const previousDateCount = Number(database.prepare("SELECT COUNT(DISTINCT saleDate) count FROM connection_sku_sales_daily_facts WHERE saleDate BETWEEN ? AND ?").get(previousStart, previousEnd)?.count || 0);
    return { batchId: null, periodStart, periodEnd, previousStart, previousEnd, completedAt: batch.completedAt,
      windowDays: 30, currentDateCount, previousDateCount, previousPeriodComplete: previousDateCount === 30 };
  }
  const latest = database.prepare("SELECT MAX(saleDate) periodEnd FROM connection_sku_sales_daily_facts").get()?.periodEnd;
  if (!latest) return null;
  const periodStart = dateShift(latest, -29);
  const previousEnd = dateShift(periodStart, -1);
  const previousStart = dateShift(latest, -59);
  const currentDateCount = Number(database.prepare("SELECT COUNT(DISTINCT saleDate) count FROM connection_sku_sales_daily_facts WHERE saleDate BETWEEN ? AND ?").get(periodStart, latest)?.count || 0);
  const previousDateCount = Number(database.prepare("SELECT COUNT(DISTINCT saleDate) count FROM connection_sku_sales_daily_facts WHERE saleDate BETWEEN ? AND ?").get(previousStart, previousEnd)?.count || 0);
  return { batchId: null, periodStart, periodEnd: latest, previousStart, previousEnd, completedAt: null,
    windowDays: 30, currentDateCount, previousDateCount, previousPeriodComplete: previousDateCount === 30 };
}

function readCockpitMetricsMap(database, salesLinkIds, window) {
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
  const platformRows = database.prepare(`SELECT * FROM connection_period_snapshots WHERE salesLinkId IN (${placeholders}) ORDER BY salesLinkId,periodEnd DESC,periodStart DESC,createdAt DESC`).all(...salesLinkIds);
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
      LEFT JOIN connection_profiles c ON c.salesLinkId=l.id
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
    ), link_summary AS (
      SELECT ol.shopId,COUNT(*) totalLinks,
        SUM(CASE WHEN e.evaluationStatus='evaluated' AND e.grade='excellent' THEN 1 ELSE 0 END) excellentLinks,
        SUM(CASE WHEN e.evaluationStatus='evaluated' AND e.grade='good' THEN 1 ELSE 0 END) goodLinks,
        SUM(CASE WHEN e.evaluationStatus='evaluated' AND e.grade='on_target' THEN 1 ELSE 0 END) onTargetLinks,
        SUM(CASE WHEN e.evaluationStatus='evaluated' AND e.grade='underperforming' THEN 1 ELSE 0 END) underperformingLinks
      FROM operating_links ol
      LEFT JOIN connection_goal_plans p ON p.connectionId=ol.connectionId AND p.status='active'
      LEFT JOIN connection_goal_evaluations e ON e.goalPlanId=p.id
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
      evaluatedLinks: excellentLinks + goodLinks + onTargetLinks + underperformingLinks,
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

function readProductAttributionContext(database, salesLinkIds) {
  const placeholders = salesLinkIds.map(() => "?").join(",");
  const linkSkus = database.prepare(`
    SELECT s.id salesLinkSkuId,s.salesLinkId
    FROM sales_link_skus s
    WHERE s.salesLinkId IN (${placeholders}) AND COALESCE(s.currentState,'active')='active'
  `).all(...salesLinkIds);
  const relations = resolveRelationMap(database, linkSkus.map((row) => row.salesLinkSkuId));
  const productMappings = database.prepare(`
    SELECT m.erpSkuId,p.id productId,p.skuCode,p.name,p.mainImage
    FROM product_erp_mappings m
    JOIN products p ON p.id=m.productId
    WHERE m.currentState='active' AND m.erpSkuId IS NOT NULL
  `).all();
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

export function getConnectionBusinessCockpit(userId = "", isAdmin = false) {
  const database = getDatabase(); const personId = text(userId);
  const operatingScope = buildLinkOperatingScope(database, { alias: "l", prefix: "connectionCockpitOperating" });
  const salesWindow = latestSalesWindow(database);
  const shopOperations = readShopOperations(database, salesWindow, operatingScope, personId, isAdmin);
  const profiles = database.prepare(`
    SELECT COALESCE(c.id,l.id) id,c.id connectionProfileId,l.id salesLinkId,
      COALESCE(NULLIF(c.name,''),NULLIF(l.title,''),l.platformGoodsId) name,c.mainImage,c.ownerId,
      COALESCE(c.status,l.currentState,'active') status,COALESCE(c.createdAt,l.createdAt) createdAt,
      l.platformGoodsId,s.platform,s.id shopId,COALESCE(s.displayName,s.shopName) shopName
    FROM sales_links l JOIN sales_shops s ON s.id=l.shopId
    LEFT JOIN connection_profiles c ON c.salesLinkId=l.id
    WHERE ${operatingScope.predicate} ${isAdmin ? "" : "AND c.ownerId=@scopeOwnerId"}
    ORDER BY COALESCE(c.updatedAt,l.updatedAt) DESC,l.id DESC
  `).all({ ...operatingScope.params, ...(isAdmin ? {} : { scopeOwnerId: personId }) });
  const connectionIds = profiles.map((item) => item.connectionProfileId).filter(Boolean); const salesLinkIds = profiles.map((item) => item.salesLinkId);
  if (!profiles.length) return emptyCockpit(shopOperations);
  const placeholders = connectionIds.map(() => "?").join(","); const linkPlaceholders = salesLinkIds.map(() => "?").join(",");
  const metrics = salesWindow ? readCockpitMetricsMap(database, salesLinkIds, salesWindow) : new Map(salesLinkIds.map((id) => [id, { current: {}, previous: null, salesGrowth: null, profitGrowth: null, platform: null }]));
  const connectionIdSet = new Set(connectionIds);
  const analyses = new Map(listConnectionGrowthAnalyses().filter((item) => connectionIdSet.has(item.connectionId)).map((item) => [item.connectionId, item]));
  const productAttribution = readProductAttributionContext(database, salesLinkIds);
  const diagnosis = new Set(connectionIds.length ? database.prepare(`SELECT connectionId FROM connection_diagnosis_entries WHERE connectionId IN (${placeholders}) AND status='active'`).all(...connectionIds).map((row) => row.connectionId) : []);
  const improvements = connectionIds.length ? database.prepare(`SELECT connectionId,status FROM connection_improvements WHERE connectionId IN (${placeholders}) ORDER BY updatedAt DESC,createdAt DESC`).all(...connectionIds) : [];
  const improvementByConnection = new Map(); for (const row of improvements) if (!improvementByConnection.has(row.connectionId) && !["effective","closed"].includes(row.status)) improvementByConnection.set(row.connectionId, row.status);
  const items = profiles.map((profile) => { const v3 = metrics.get(profile.salesLinkId); const analysis = profile.connectionProfileId ? analyses.get(profile.connectionProfileId) ?? {} : {}; const salesGrowth = salesWindow ? v3.salesGrowth : analysis.salesGrowth ?? null; const profitGrowth = salesWindow ? v3.profitGrowth : analysis.profitGrowth ?? null; const improvement = profile.connectionProfileId ? improvementByConnection.get(profile.connectionProfileId) : null; const operationStage = improvement === "executing" ? "treatment" : improvement === "observing" ? "observation" : profile.connectionProfileId && (diagnosis.has(profile.connectionProfileId) || ["planned","failed"].includes(improvement)) ? "diagnosis" : "normal"; const healthStatus = analysis.healthStatus ?? "no_data"; const risk = healthStatus === "risk" || healthStatus === "attention" || Number(salesGrowth) < -0.2 || Number(profitGrowth) < -0.2 || Number(analysis.visitorGrowth) < -0.2 || Number(analysis.conversionChange) < -0.01; return { ...profile, products: productAttribution.productsByConnection.get(profile.salesLinkId) ?? [], erpSales: v3.current, previousErpSales: v3.previous, platformPerformance: v3.platform, salesGrowth, profitGrowth, visitorGrowth: analysis.visitorGrowth ?? null, conversionChange: analysis.conversionChange ?? null, healthScore: analysis.healthScore ?? null, healthStatus, operationStage, risk }; });
  const totalSales = items.reduce((sum, item) => sum + Number(item.erpSales.salesAmount || 0), 0); const totalProfit = items.reduce((sum, item) => sum + Number(item.erpSales.profitAmount || 0), 0); const previousSales = items.reduce((sum, item) => sum + Number(item.previousErpSales?.salesAmount || 0), 0); const quantity = items.reduce((sum, item) => sum + Number(item.erpSales.shippedQuantity ?? item.erpSales.quantity ?? 0), 0);
  const salesPeriodStart = salesWindow?.periodStart ?? null;
  const salesPeriodEnd = salesWindow?.periodEnd ?? null;
  const salesUpdatedAt = salesWindow?.completedAt ?? items.map((item) => item.erpSales.updatedAt).filter(Boolean).sort().at(-1) ?? null;
  const health = { healthy: 0, attention: 0, risk: 0, noData: 0 };
  for (const item of items) {
    if (["no_data","insufficient_data"].includes(item.healthStatus)) health.noData += 1;
    else if (item.healthStatus === "risk" || Number(item.salesGrowth) < -0.2 || Number(item.profitGrowth) < -0.2 || Number(item.visitorGrowth) < -0.2 || Number(item.conversionChange) < -0.01) health.risk += 1;
    else if (item.healthStatus === "attention") health.attention += 1;
    else health.healthy += 1;
  }
  const coreLinks = items.filter((item) => item.erpSales.periodEnd).sort((a,b) => Number(b.erpSales.salesAmount||0)-Number(a.erpSales.salesAmount||0) || Number(b.erpSales.profitAmount||0)-Number(a.erpSales.profitAmount||0) || Number(b.erpSales.quantity||0)-Number(a.erpSales.quantity||0)).slice(0,10);
  const riskLinks = items.filter((item) => item.risk).sort((a,b) => Number(a.healthScore??101)-Number(b.healthScore??101) || Number(a.salesGrowth??0)-Number(b.salesGrowth??0)).slice(0,10).map((item) => ({ ...item, anomalyTypes: [Number(item.salesGrowth)<-0.2?"销售下降":"",Number(item.profitGrowth)<-0.2?"利润下降":"",Number(item.visitorGrowth)<-0.2?"流量下降":"",Number(item.conversionChange)<-0.01?"转化下降":""].filter(Boolean) }));
  const growthLinks = items.map((item) => ({ ...item, growthMetric: Math.max(...[item.salesGrowth,item.profitGrowth,item.visitorGrowth,item.conversionChange].filter((value) => value !== null).map(Number), -Infinity) })).filter((item) => Number.isFinite(item.growthMetric) && item.growthMetric > 0).sort((a,b) => b.growthMetric-a.growthMetric).slice(0,10);
  const platformMap = new Map(); for (const item of items) { const row=platformMap.get(item.platform)??{platform:item.platform,connectionCount:0,salesAmount:0,profitAmount:0,riskCount:0,healthyCount:0}; row.connectionCount++; row.salesAmount+=Number(item.erpSales.salesAmount||0); row.profitAmount+=Number(item.erpSales.profitAmount||0); if(item.risk)row.riskCount++; if(["growing","stable"].includes(item.healthStatus)&&!item.risk)row.healthyCount++; platformMap.set(item.platform,row); }
  const platforms=[...platformMap.values()].map((row)=>({...row,profitMargin:row.salesAmount?row.profitAmount/row.salesAmount:null,healthyRate:row.connectionCount?row.healthyCount/row.connectionCount:0})).sort((a,b)=>b.salesAmount-a.salesAmount);
  const factRows=salesWindow?database.prepare(`SELECT f.salesLinkId,f.salesLinkSkuId,f.saleDate periodStart,f.saleDate periodEnd,f.salesAmount,f.profitAmount,sh.platform FROM connection_sku_sales_daily_facts f JOIN sales_links l ON l.id=f.salesLinkId JOIN sales_shops sh ON sh.id=l.shopId WHERE ${salesWindow.batchId ? "f.sourceBatchId=?" : "f.saleDate BETWEEN ? AND ?"} AND f.salesLinkId IN (${linkPlaceholders})`).all(...(salesWindow.batchId?[salesWindow.batchId]:[salesWindow.periodStart,salesWindow.periodEnd]),...salesLinkIds):[];
  const productChannelMap=new Map(); for(const row of factRows){const attributions=(productAttribution.attributionsBySku.get(row.salesLinkSkuId)??[]).filter((item)=>item.salesObjectType==="single");if(attributions.length!==1)continue;const attribution=attributions[0];const key=`${attribution.productId}|${row.platform}`;const current=productChannelMap.get(key)??{productId:attribution.productId,platform:row.platform,directSalesAmount:0,directProfitAmount:0,linkIds:new Set()};current.directSalesAmount+=Number(row.salesAmount||0);current.directProfitAmount+=Number(row.profitAmount||0);current.linkIds.add(row.salesLinkId);productChannelMap.set(key,current);} const totalsByProduct=new Map(); for(const row of productChannelMap.values())totalsByProduct.set(row.productId,(totalsByProduct.get(row.productId)||0)+row.directSalesAmount); const productChannels=[...productChannelMap.values()].map((row)=>({productId:row.productId,...productAttribution.productMeta.get(row.productId),platform:row.platform,directSalesAmount:row.directSalesAmount,directProfitAmount:row.directProfitAmount,salesAmount:row.directSalesAmount,profitAmount:row.directProfitAmount,linkCount:row.linkIds.size,contribution:totalsByProduct.get(row.productId)?row.directSalesAmount/totalsByProduct.get(row.productId):0,metricContract:"single_direct_only",bundleAllocation:"none"})).sort((a,b)=>b.directSalesAmount-a.directSalesAmount).slice(0,30);
  const erpTrend=database.prepare(`SELECT saleDate periodStart,saleDate periodEnd,SUM(COALESCE(quantity,0)) quantity,SUM(COALESCE(salesAmount,0)) salesAmount,SUM(COALESCE(profitAmount,0)) profitAmount FROM connection_sku_sales_daily_facts WHERE salesLinkId IN (${linkPlaceholders}) GROUP BY saleDate ORDER BY saleDate`).all(...salesLinkIds).map((row)=>({...row,periodType:periodType(row.periodStart,row.periodEnd)}));
  const platformTrend=database.prepare(`SELECT periodStart,periodEnd,SUM(COALESCE(visitorCount,0)) visitorCount,SUM(COALESCE(viewCount,0)) viewCount FROM connection_period_snapshots WHERE salesLinkId IN (${linkPlaceholders}) GROUP BY periodStart,periodEnd ORDER BY periodEnd,periodStart`).all(...salesLinkIds).map((row)=>({...row,periodType:periodType(row.periodStart,row.periodEnd)}));
  return { summary:{connectionCount:items.length,managedConnectionCount:items.filter((item)=>item.connectionProfileId).length,unmanagedConnectionCount:items.filter((item)=>!item.connectionProfileId).length,normalCount:items.filter((item)=>!item.risk&&item.operationStage==="normal").length,riskCount:items.filter((item)=>item.risk).length,diagnosisCount:items.filter((item)=>item.operationStage==="diagnosis").length,treatmentCount:items.filter((item)=>item.operationStage==="treatment").length,observationCount:items.filter((item)=>item.operationStage==="observation").length,quantity,salesAmount:totalSales,salesGrowth:salesWindow?.previousPeriodComplete?ratio(totalSales,previousSales):null,salesPeriodStart,salesPeriodEnd,salesPeriodAligned:true,salesPeriodCount:salesWindow?.currentDateCount||0,salesWindowDays:salesWindow?.windowDays||30,currentPeriodDateCount:salesWindow?.currentDateCount||0,previousPeriodDateCount:salesWindow?.previousDateCount||0,previousPeriodComplete:Boolean(salesWindow?.previousPeriodComplete),salesUpdatedAt,profitAmount:totalProfit,profitMargin:totalSales?totalProfit/totalSales:null,highProfitCount:items.filter((item)=>Number(item.erpSales.profitMargin)>=0.2).length,profitRiskCount:items.filter((item)=>Number(item.erpSales.profitAmount)<0||Number(item.profitGrowth)<-0.2).length},health,shopOperations,coreLinks,riskLinks,growthLinks,platforms,productChannels,trends:{erp:erpTrend,platform:platformTrend},scope:{isAdmin:Boolean(isAdmin),ownerId:isAdmin?null:personId}};
}

function emptyCockpit(shopOperations=[]){return{summary:{},health:{healthy:0,attention:0,risk:0,noData:0},shopOperations,coreLinks:[],riskLinks:[],growthLinks:[],platforms:[],productChannels:[],trends:{erp:[],platform:[]},scope:{}};}
