import crypto from "node:crypto";
import { getDatabase } from "./db.js";
import { listConnectionGrowthAnalyses } from "./connectionGrowthService.js";
import { readConnectionV3MetricsMap } from "./connectionV3MetricsService.js";
import { FORMAL_SALES_OBJECT_RESOLVER_SCOPES, resolveLinkSkuRelationsForRead } from "./capabilities/resolveLinkSkuRelationRead.js";
import { buildLinkOperatingScope } from "./linkOperatingSetService.js";
import { LINK_ASSET_SELECT_SQL } from "./linkAssetSql.js";

const profileStatuses = new Set(["active", "paused", "archived"]);
const profileLevels = new Set(["new", "growing", "mature", "priority"]);
const actionStatuses = new Set(["pending", "in_progress", "completed", "canceled"]);
const mappingSourceTypes = new Set(["business_advisor", "wangdian", "taobao", "xiaohongshu", "douyin"]);
const mappingStatuses = new Set(["matched", "pending", "ignored", "rejected"]);
const mappingMethods = new Set(["goods_id", "sku", "manual"]);
const businessAdvisorSource = "business_advisor";

function value(raw) {
  return String(raw ?? "").trim();
}

function placeholders(values) {
  return values.map(() => "?").join(",");
}

export function readConnectionProductsBySalesLinkIds(database, salesLinkIds) {
  if (salesLinkIds.length === 0) return new Map();
  const linkSkus = database.prepare(`
    SELECT s.id salesLinkSkuId,s.salesLinkId
    FROM sales_link_skus s
    WHERE s.salesLinkId IN (${placeholders(salesLinkIds)})
      AND COALESCE(s.currentState,'active')='active'
    ORDER BY s.salesLinkId,s.createdAt,s.id
  `).all(...salesLinkIds);
  const relations = {};
  for (let offset = 0; offset < linkSkus.length; offset += 500) {
    Object.assign(relations, resolveLinkSkuRelationsForRead({ salesLinkSkuIds: linkSkus.slice(offset, offset + 500).map((row) => row.salesLinkSkuId) }, {
      database, scope: "linkDetail", salesObjectResolverEnabled: true,
      enabledScopes: FORMAL_SALES_OBJECT_RESOLVER_SCOPES, logDifference: () => {},
    }).results);
  }
  const productRows = database.prepare(`
    SELECT m.erpSkuId,p.id,p.skuCode,p.name,p.mainImage
    FROM product_erp_mappings m JOIN products p ON p.id=m.productId
    WHERE m.currentState='active' AND m.erpSkuId IS NOT NULL
    ORDER BY m.updatedAt,m.id
  `).all();
  const productsByErpSku = new Map();
  for (const row of productRows) {
    if (!productsByErpSku.has(row.erpSkuId)) productsByErpSku.set(row.erpSkuId, []);
    productsByErpSku.get(row.erpSkuId).push(row);
  }
  const byLink = new Map(salesLinkIds.map((id) => [id, []]));
  for (const linkSku of linkSkus) {
    const relation = relations[linkSku.salesLinkSkuId];
    if (!relation?.isUsable) continue;
    const products = byLink.get(linkSku.salesLinkId);
    for (const mapping of relation.mappings) {
      for (const product of productsByErpSku.get(mapping.erpSkuId) ?? []) {
        if (!products.some((item) => item.id === product.id)) products.push({ id: product.id, skuCode: product.skuCode, name: product.name, mainImage: product.mainImage });
      }
    }
  }
  for (const products of byLink.values()) products.sort((left, right) => value(left.skuCode).localeCompare(value(right.skuCode), "zh-CN") || left.id.localeCompare(right.id));
  return byLink;
}

function enrichConnectionRows(rows) {
  const productsByLink = readConnectionProductsBySalesLinkIds(getDatabase(), [...new Set(rows.map((row) => row.salesLinkId))]);
  return rows.map((row) => ({
    ...row,
    products: productsByLink.get(row.salesLinkId) ?? [],
  }));
}

const connectionSelect = `
  SELECT c.id, c.salesLinkId, c.name, c.mainImage, c.imageSource, c.ownerId, c.status, c.level, c.notes,
         c.originSource, c.originImportBatchId, c.identifiedAt, c.createdBy, c.createdAt, c.updatedAt,
         (SELECT name FROM persons WHERE id=c.ownerId) AS ownerName,
         l.title AS salesLinkTitle, l.canonicalUrl, l.platformGoodsId, l.platformGoodsCode, l.currentState AS salesLinkState,
         s.id AS shopId, s.platform, s.displayName AS shopDisplayName, s.shopName,
         (SELECT periodEnd FROM connection_period_snapshots ps WHERE ps.salesLinkId=c.salesLinkId
          ORDER BY periodEnd DESC,periodStart DESC,createdAt DESC LIMIT 1) AS latestPeriodEnd,
         (SELECT SUM(f.salesAmount) FROM connection_sku_sales_daily_facts f WHERE f.salesLinkId=c.salesLinkId
          AND f.saleDate=(SELECT MAX(f2.saleDate) FROM connection_sku_sales_daily_facts f2 WHERE f2.salesLinkId=c.salesLinkId)) AS latestPayAmount
         ,(SELECT COUNT(*) FROM connection_benchmark_targets b WHERE b.connectionId=c.id) AS benchmarkCount
         ,(SELECT b.title FROM connection_benchmark_targets b WHERE b.connectionId=c.id ORDER BY b.createdAt,b.id LIMIT 1) AS firstBenchmarkName
  FROM ${LINK_ASSET_SELECT_SQL} c
  JOIN sales_links l ON l.id=c.salesLinkId
  JOIN sales_shops s ON s.id=l.shopId
`;

export function listConnectionProfiles() {
  const database = getDatabase();
  const operatingScope = buildLinkOperatingScope(database, { alias: "l", prefix: "connectionProfilesOperating" });
  const rows = database.prepare(`${connectionSelect} WHERE ${operatingScope.predicate} ORDER BY c.updatedAt DESC, c.id DESC`).all(operatingScope.params);
  return enrichConnectionRows(rows);
}

export function resolveConnectionGrowthDirection(analysis) {
  const changes = [analysis.salesGrowth, analysis.visitorGrowth, analysis.conversionChange, analysis.profitGrowth]
    .filter((item) => item !== null && item !== undefined).map(Number);
  const severeDecline = Number(analysis.salesGrowth) <= -0.2 || Number(analysis.visitorGrowth) <= -0.2
    || Number(analysis.conversionChange) <= -0.01 || Number(analysis.profitGrowth) <= -0.2;
  const decliningCount = changes.filter((item) => item < 0).length;
  const growingCount = changes.filter((item) => item > 0).length;
  if (severeDecline || decliningCount >= 2) return "worse";
  if (growingCount > decliningCount) return "better";
  return "stable";
}

export function getMyConnectionWorkbench(userId, isAdmin = false, filter = "all") {
  const personId = value(userId);
  if (!personId) throw new Error("无法识别当前登录人员。");
  if (!["all", "better", "worse", "followed"].includes(filter)) throw new Error("我的链接筛选无效。");
  const profiles = listConnectionProfiles().filter((item) => isAdmin || item.ownerId === personId);
  const analyses = new Map(listConnectionGrowthAnalyses().map((item) => [item.connectionId, item]));
  const v3Metrics = readConnectionV3MetricsMap(profiles.map((item) => item.salesLinkId));
  const followedIds = new Set(getDatabase().prepare("SELECT connectionId FROM connection_follows WHERE userId=?").all(personId).map((item) => item.connectionId));
  const yesterday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(Date.now() - 86400000));
  const yesterdaySales = getDatabase().prepare(`SELECT SUM(COALESCE(f.salesAmount,0)) amount,COUNT(*) factCount
    FROM connection_sku_sales_daily_facts f JOIN ${LINK_ASSET_SELECT_SQL} c ON c.salesLinkId=f.salesLinkId
    WHERE f.saleDate BETWEEN ? AND ? ${isAdmin ? "" : "AND c.ownerId=?"}`)
    .get(...(isAdmin ? [yesterday, yesterday] : [yesterday, yesterday, personId]));
  const allItems = profiles.map((profile) => {
    const analysis = analyses.get(profile.id) ?? {};
    const v3 = v3Metrics.get(profile.salesLinkId);
    const combined = { ...analysis,
      salesGrowth: v3.salesGrowth ?? analysis.salesGrowth,
      profitGrowth: v3.profitGrowth ?? analysis.profitGrowth };
    const trend = resolveConnectionGrowthDirection(combined);
    const followed = followedIds.has(profile.id);
    const riskPriority = trend === "worse"
      ? (Number(combined.salesGrowth) <= -0.2 || Number(analysis.visitorGrowth) <= -0.2 || Number(combined.profitGrowth) <= -0.2 ? 0 : 1)
      : followed ? 2 : 3;
    return { ...profile, followed, trend, riskPriority, erpSales: v3.current,
      currentPayAmount: v3.current.salesAmount ?? analysis.currentPeriod?.payAmount ?? null,
      salesGrowth: combined.salesGrowth ?? null, visitorGrowth: analysis.visitorGrowth ?? null,
      conversionChange: analysis.conversionChange ?? null, profitGrowth: combined.profitGrowth ?? null };
  });
  const items = allItems.filter((item) => filter === "all" || (filter === "followed" ? item.followed : item.trend === filter))
    .sort((left, right) => left.riskPriority - right.riskPriority
      || Number(left.salesGrowth ?? 0) - Number(right.salesGrowth ?? 0));
  return { items, isAdmin: Boolean(isAdmin), summary: {
    total: profiles.length,
    better: allItems.reduce((count, item) => count + (item.trend === "better" ? 1 : 0), 0),
    risk: allItems.reduce((count, item) => count + (item.trend === "worse" ? 1 : 0), 0),
    followed: profiles.filter((item) => followedIds.has(item.id)).length,
    yesterdaySalesAmount: Number(yesterdaySales?.factCount || 0) ? Number(yesterdaySales.amount || 0) : null,
    yesterdayDataDate: yesterday,
    yesterdayCommissionAmount: null,
    commissionAvailable: false,
  } };
}

export function setConnectionFollow(connectionId, userId, followed, isAdmin = false) {
  const id = value(connectionId); const personId = value(userId); const database = getDatabase();
  const profile = database.prepare("SELECT ownerId FROM sales_links WHERE id=?").get(id);
  if (!profile) throw new Error("未找到连接档案。");
  if (!isAdmin && profile.ownerId !== personId) throw new Error("只能关注自己负责的链接。");
  if (!database.prepare("SELECT 1 FROM persons WHERE id=? AND status='active'").get(personId)) throw new Error("无法识别当前登录人员。");
  if (followed) database.prepare(`INSERT INTO connection_follows (id,userId,connectionId,createdAt) VALUES (?,?,?,?)
    ON CONFLICT(userId,connectionId) DO NOTHING`).run(`connection-follow-${crypto.randomUUID()}`, personId, id, new Date().toISOString());
  else database.prepare("DELETE FROM connection_follows WHERE userId=? AND connectionId=?").run(personId, id);
  return { connectionId: id, followed: Boolean(followed) };
}

export function listConnectionImportShops() {
  return getDatabase().prepare(`
    SELECT id,platform,shopName,displayName,status
    FROM sales_shops
    WHERE status='active'
    ORDER BY platform,COALESCE(displayName,shopName),id
  `).all();
}

export function readConnectionProfile(id) {
  const row = getDatabase().prepare(`${connectionSelect} WHERE c.id=?`).get(value(id));
  if (!row) throw new Error("未找到连接档案。");
  return enrichConnectionRows([row])[0];
}

export function assertConnectionVisible(id, userId = "", isAdmin = false) {
  const profile = readConnectionProfile(id);
  if (!isAdmin && (!value(userId) || profile.ownerId !== value(userId))) {
    const error = new Error("只能访问自己负责的链接。");
    error.statusCode = 403;
    throw error;
  }
  return profile;
}

export function listAvailableSalesLinks(filters = {}) {
  const normalizedFilters = typeof filters === "string" ? { search: filters } : filters;
  const query = value(normalizedFilters.search).toLowerCase();
  const platform = value(normalizedFilters.platform);
  const shopId = value(normalizedFilters.shopId);
  const productRelation = value(normalizedFilters.productRelation);
  const connectionStatus = value(normalizedFilters.connectionStatus) || "pending";
  if (productRelation && !["linked", "unlinked"].includes(productRelation)) throw new Error("产品关联筛选无效。");
  if (!["pending", "existing", "all"].includes(connectionStatus)) throw new Error("连接状态筛选无效。");
  const database = getDatabase();
  const operatingScope = buildLinkOperatingScope(database, { alias: "l", prefix: "availableLinksOperating" });
  const summary = database.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN c.id IS NOT NULL THEN 1 ELSE 0 END) AS existing,
           SUM(CASE WHEN c.id IS NULL THEN 1 ELSE 0 END) AS pending
    FROM sales_links l LEFT JOIN ${LINK_ASSET_SELECT_SQL} c ON c.salesLinkId=l.id
    WHERE ${operatingScope.predicate}
  `).get(operatingScope.params);
  const optionRows = database.prepare(`
    SELECT DISTINCT s.id AS shopId,s.platform,s.displayName AS shopDisplayName,s.shopName
    FROM sales_links l JOIN sales_shops s ON s.id=l.shopId
    WHERE ${operatingScope.predicate}
    ORDER BY s.platform,COALESCE(s.displayName,s.shopName),s.id
  `).all(operatingScope.params);
  const rowParams = { ...operatingScope.params, connectionStatus, platform, shopId, query,
    keyword: `%${query}%`, limit: productRelation ? 10000 : 500 };
  const rows = getDatabase().prepare(`
    SELECT l.id AS salesLinkId, l.title AS salesLinkTitle, l.canonicalUrl, l.platformGoodsId, l.platformGoodsCode,
           s.id AS shopId, s.platform, s.displayName AS shopDisplayName, s.shopName,
           c.id AS connectionId
    FROM sales_links l
    JOIN sales_shops s ON s.id=l.shopId
    LEFT JOIN ${LINK_ASSET_SELECT_SQL} c ON c.salesLinkId=l.id
    WHERE ${operatingScope.predicate}
      AND (@connectionStatus='all' OR (@connectionStatus='pending' AND c.id IS NULL) OR (@connectionStatus='existing' AND c.id IS NOT NULL))
      AND (@platform='' OR s.platform=@platform)
      AND (@shopId='' OR s.id=@shopId)
      AND (@query='' OR LOWER(COALESCE(l.title,'')) LIKE @keyword OR LOWER(COALESCE(l.platformGoodsId,'')) LIKE @keyword
        OR LOWER(COALESCE(l.platformGoodsCode,'')) LIKE @keyword OR LOWER(COALESCE(s.displayName,s.shopName,'')) LIKE @keyword)
    ORDER BY l.updatedAt DESC, l.id DESC
    LIMIT @limit
  `).all(rowParams);
  const items = enrichConnectionRows(rows).map((item) => ({ ...item, hasLinkedProduct: item.products.length ? 1 : 0 }))
    .filter((item) => !productRelation || (productRelation === "linked" ? item.hasLinkedProduct : !item.hasLinkedProduct)).slice(0, 500);
  return {
    items,
    summary: { total: Number(summary.total || 0), existing: Number(summary.existing || 0), pending: Number(summary.pending || 0) },
    options: {
      platforms: [...new Set(optionRows.map((item) => item.platform).filter(Boolean))].sort(),
      shops: optionRows.map((item) => ({ id: item.shopId, name: item.shopDisplayName || item.shopName, platform: item.platform })),
    },
  };
}

function connectionImageForSalesLink(database, salesLinkId) {
  const product = readConnectionProductsBySalesLinkIds(database, [salesLinkId]).get(salesLinkId)?.find((item) => value(item.mainImage));
  return product?.mainImage ? { mainImage: product.mainImage, imageSource: "product" } : { mainImage: null, imageSource: null };
}

export function createConnectionProfile(input, userId) {
  void input;
  void userId;
  throw new Error("新链接资产请通过平台链接经营导入创建。");
}

export function createConnectionProfilesBatch(input, userId) {
  void input;
  void userId;
  throw new Error("已停用从ERP销售链接批量建立连接档案，请通过平台链接经营导入创建链接资产。");
}

export function ensureBusinessAdvisorConnection(input, userId) {
  const importBatchId = value(input?.importBatchId);
  const shopId = value(input?.shopId);
  const platformGoodsId = value(input?.platformGoodsId);
  const title = value(input?.title) || `经营链接 ${platformGoodsId}`;
  if (!importBatchId || !shopId || !platformGoodsId) throw new Error("生意参谋建档缺少来源批次、店铺或商品ID。");
  const database = getDatabase();
  const ensure = database.transaction(() => {
    const batch = database.prepare("SELECT id,sourceType,status FROM connection_import_batches WHERE id=?").get(importBatchId);
    if (!batch || batch.sourceType !== businessAdvisorSource) throw new Error("连接档案来源批次不是生意参谋导入。");
    if (!["validated", "completed"].includes(batch.status)) throw new Error("生意参谋导入批次尚未通过校验。");
    const shop = database.prepare("SELECT id,platform,shopName,displayName,status FROM sales_shops WHERE id=?").get(shopId);
    if (!shop || shop.status !== "active") throw new Error("请选择有效的平台店铺。");
    const link = database.prepare("SELECT * FROM sales_links WHERE shopId=? AND platformGoodsId=?").get(shopId, platformGoodsId);
    if (!link) throw Object.assign(new Error("生意参谋经营数据未匹配到已有链接，请先通过平台货品导入建立链接身份。"), { type: "missing_link" });
    const salesLinkCreated = false;
    const now = new Date().toISOString();
    const image = connectionImageForSalesLink(database, link.id);
    database.prepare(`UPDATE sales_links SET
      displayName=COALESCE(NULLIF(displayName,''),?),
      mainImage=COALESCE(NULLIF(mainImage,''),?),imageSource=COALESCE(NULLIF(imageSource,''),?),
      managementOriginSource=CASE WHEN managementOriginSource='asset_native' THEN ? ELSE managementOriginSource END,
      managementOriginImportBatchId=COALESCE(managementOriginImportBatchId,?),
      managementIdentifiedAt=COALESCE(managementIdentifiedAt,?),
      managementCreatedBy=COALESCE(managementCreatedBy,?),updatedAt=? WHERE id=?`)
      .run(title, image.mainImage, image.imageSource, businessAdvisorSource, importBatchId, now, value(userId) || null, now, link.id);
    return { connectionId: link.id, salesLinkId: link.id, profileCreated: false, salesLinkCreated };
  });
  return ensure();
}

export function listConnectionMappingRepairCandidates() {
  return getDatabase().prepare(`
    SELECT m.id AS mappingId,m.externalId,m.externalShopId,m.salesLinkId,m.createdAt,
           l.shopId,s.platform,s.displayName AS shopDisplayName,s.shopName,
           c.id AS candidateConnectionId
    FROM connection_data_mappings m
    JOIN sales_links l ON l.id=m.salesLinkId
    JOIN sales_shops s ON s.id=l.shopId
    LEFT JOIN ${LINK_ASSET_SELECT_SQL} c ON c.salesLinkId=m.salesLinkId
    WHERE m.sourceType='business_advisor' AND m.matchStatus='matched'
      AND m.connectionId IS NULL AND m.deletedAt IS NULL
    ORDER BY m.createdAt,m.id
  `).all();
}

export function updateConnectionProfile(id, input) {
  const current = readConnectionProfile(id);
  const ownerId = input?.ownerId === undefined ? current.ownerId : value(input.ownerId) || null;
  const name = input?.name === undefined ? current.name : value(input.name);
  const status = input?.status === undefined ? current.status : value(input.status);
  const level = input?.level === undefined ? current.level : value(input.level);
  if (!name) throw new Error("请填写连接名称。");
  if (!profileStatuses.has(status)) throw new Error("连接状态无效。");
  if (!profileLevels.has(level)) throw new Error("连接等级无效。");
  const database = getDatabase();
  if (ownerId && !database.prepare("SELECT 1 FROM persons WHERE id=? AND status='active'").get(ownerId)) throw new Error("负责人不存在或已停用。");
  database.prepare(`UPDATE sales_links SET displayName=?,ownerId=?,managementStatus=?,managementLevel=?,updatedAt=? WHERE id=?`)
    .run(name, ownerId, status, level, new Date().toISOString(), current.id);
  return readConnectionProfile(current.id);
}

export function listConnectionActions(connectionProfileId) {
  readConnectionProfile(connectionProfileId);
  return getDatabase().prepare(`
    SELECT id, connectionProfileId, title, description, ownerId, status, dueDate, createdBy, createdAt, updatedAt
    FROM connection_actions WHERE connectionProfileId=? ORDER BY createdAt DESC, id DESC
  `).all(value(connectionProfileId));
}

export function createConnectionAction(connectionProfileId, input, userId) {
  const profileId = value(connectionProfileId);
  const title = value(input?.title);
  const ownerId = value(input?.ownerId) || null;
  const status = value(input?.status) || "pending";
  if (!title) throw new Error("请填写经营动作名称。");
  if (!actionStatuses.has(status)) throw new Error("经营动作状态无效。");
  const database = getDatabase();
  const create = database.transaction(() => {
    if (!database.prepare("SELECT 1 FROM sales_links WHERE id=?").get(profileId)) throw new Error("未找到链接资产。");
    if (ownerId && !database.prepare("SELECT 1 FROM persons WHERE id=? AND status='active'").get(ownerId)) throw new Error("负责人不存在或已停用。");
    const now = new Date().toISOString();
    const id = `connection-action-${crypto.randomUUID()}`;
    database.prepare(`
      INSERT INTO connection_actions (id,connectionProfileId,title,description,ownerId,status,dueDate,createdBy,createdAt,updatedAt)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(id, profileId, title, value(input?.description), ownerId, status, value(input?.dueDate) || null, value(userId) || null, now, now);
    return id;
  });
  const id = create();
  return database.prepare("SELECT * FROM connection_actions WHERE id=?").get(id);
}

export function deleteConnectionAction(connectionProfileId, actionId) {
  const result = getDatabase().prepare("DELETE FROM connection_actions WHERE id=? AND connectionProfileId=?").run(value(actionId), value(connectionProfileId));
  if (result.changes === 0) throw new Error("未找到经营动作。");
  return { success: true, id: value(actionId) };
}

function normalizeExternalData(raw) {
  if (raw === null || raw === undefined || raw === "") return "{}";
  if (typeof raw === "object") return JSON.stringify(raw);
  try {
    const parsed = JSON.parse(String(raw));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return JSON.stringify(parsed);
  } catch {
    throw new Error("外部身份数据必须是有效JSON对象。");
  }
}

function readConnectionRelation(connectionId) {
  if (!connectionId) return null;
  const row = getDatabase().prepare("SELECT id,id salesLinkId FROM sales_links WHERE id=?").get(connectionId);
  if (!row) throw new Error("所选连接档案不存在。");
  return row;
}

function readSalesLinkRelation(salesLinkId) {
  if (!salesLinkId) return null;
  const row = getDatabase().prepare(`
    SELECT l.id AS salesLinkId, c.id AS connectionId
    FROM sales_links l LEFT JOIN ${LINK_ASSET_SELECT_SQL} c ON c.salesLinkId=l.id WHERE l.id=?
  `).get(salesLinkId);
  if (!row) throw new Error("所选销售连接不存在。");
  return row;
}

function validateBusinessAdvisorIdentity(sourceType, externalId, relation, matchStatus, matchMethod) {
  if (sourceType !== "business_advisor" || matchStatus !== "matched") return;
  if (!relation?.connectionId) throw new Error("生意参谋数据需要先为销售连接建立连接档案。");
  const link = getDatabase().prepare("SELECT platformGoodsId FROM sales_links WHERE id=?").get(relation.salesLinkId);
  if (value(link?.platformGoodsId) !== externalId) throw new Error("生意参谋商品ID与销售连接商品ID不一致。");
  if (matchMethod !== "goods_id") throw new Error("生意参谋数据只允许按商品ID精确匹配。");
}

const mappingSelect = `
  SELECT m.id, m.sourceType, m.connectionId, m.salesLinkId, m.externalType, m.externalId,
         m.externalShopId, m.externalDataJson, m.matchStatus, m.matchMethod,
         m.confirmedBy, m.confirmedAt, m.createdAt, m.updatedAt,
         c.name AS connectionName, c.status AS connectionStatus,
         l.title AS salesLinkTitle, s.platform, s.displayName AS shopDisplayName, s.shopName
  FROM connection_data_mappings m
  LEFT JOIN ${LINK_ASSET_SELECT_SQL} c ON c.id=m.connectionId
  LEFT JOIN sales_links l ON l.id=m.salesLinkId
  LEFT JOIN sales_shops s ON s.id=l.shopId
`;

function parseMapping(row) {
  if (!row) return row;
  try {
    return { ...row, externalData: JSON.parse(row.externalDataJson || "{}") };
  } catch {
    return { ...row, externalData: {} };
  }
}

export function listConnectionDataMappings(filters = {}) {
  const clauses = ["m.deletedAt IS NULL"];
  const parameters = [];
  const sourceType = value(filters.sourceType);
  const matchStatus = value(filters.matchStatus);
  const search = value(filters.search).toLowerCase();
  if (sourceType) {
    if (!mappingSourceTypes.has(sourceType)) throw new Error("外部数据来源无效。");
    clauses.push("m.sourceType=?");
    parameters.push(sourceType);
  }
  if (matchStatus) {
    if (!mappingStatuses.has(matchStatus)) throw new Error("映射状态无效。");
    clauses.push("m.matchStatus=?");
    parameters.push(matchStatus);
  }
  if (search) {
    clauses.push("(LOWER(m.externalId) LIKE ? OR LOWER(m.externalDataJson) LIKE ?)");
    parameters.push(`%${search}%`, `%${search}%`);
  }
  return getDatabase().prepare(`${mappingSelect} WHERE ${clauses.join(" AND ")} ORDER BY m.updatedAt DESC, m.id DESC LIMIT 500`)
    .all(...parameters).map(parseMapping);
}

export function readConnectionDataMapping(id) {
  const row = getDatabase().prepare(`${mappingSelect} WHERE m.id=? AND m.deletedAt IS NULL`).get(value(id));
  if (!row) throw new Error("外部数据映射不存在。");
  return parseMapping(row);
}

export function createConnectionDataMapping(input, userId) {
  const sourceType = value(input?.sourceType) || "business_advisor";
  const externalType = value(input?.externalType) || "product";
  const externalId = value(input?.externalId);
  const externalShopId = value(input?.externalShopId);
  const connectionId = value(input?.connectionId) || null;
  const requestedSalesLinkId = value(input?.salesLinkId) || null;
  const matchStatus = value(input?.matchStatus) || (connectionId ? "matched" : "pending");
  let matchMethod = value(input?.matchMethod) || null;
  if (!mappingSourceTypes.has(sourceType)) throw new Error("外部数据来源无效。");
  if (!externalId) throw new Error("请填写外部商品ID。");
  if (!mappingStatuses.has(matchStatus)) throw new Error("映射状态无效。");
  if (matchMethod && !mappingMethods.has(matchMethod)) throw new Error("匹配方式无效。");
  const profileRelation = readConnectionRelation(connectionId);
  const salesRelation = readSalesLinkRelation(requestedSalesLinkId);
  if (profileRelation && salesRelation && profileRelation.salesLinkId !== salesRelation.salesLinkId) throw new Error("连接档案与销售连接不一致。");
  const relation = profileRelation
    ? { connectionId: profileRelation.id, salesLinkId: profileRelation.salesLinkId }
    : salesRelation;
  if (matchStatus === "matched" && !relation) throw new Error("确认匹配时必须选择连接档案或销售连接。");
  if (matchStatus === "matched" && !matchMethod) matchMethod = sourceType === "business_advisor" ? "goods_id" : "manual";
  validateBusinessAdvisorIdentity(sourceType, externalId, relation, matchStatus, matchMethod);
  const database = getDatabase();
  const create = database.transaction(() => {
    const now = new Date().toISOString();
    const id = `connection-mapping-${crypto.randomUUID()}`;
    database.prepare(`
      INSERT INTO connection_data_mappings (
        id,sourceType,connectionId,salesLinkId,externalType,externalId,externalShopId,externalDataJson,
        matchStatus,matchMethod,confirmedBy,confirmedAt,createdAt,updatedAt
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, sourceType, relation?.connectionId ?? null, relation?.salesLinkId ?? null, externalType, externalId,
      externalShopId, normalizeExternalData(input?.externalDataJson ?? input?.externalData), matchStatus, matchMethod,
      matchStatus === "matched" ? value(userId) || null : null, matchStatus === "matched" ? now : null, now, now);
    return id;
  });
  try {
    return readConnectionDataMapping(create());
  } catch (error) {
    if (String(error?.code) === "SQLITE_CONSTRAINT_UNIQUE") throw new Error("该外部商品已存在有效映射。");
    throw error;
  }
}

export function updateConnectionDataMapping(id, input, userId) {
  const current = readConnectionDataMapping(id);
  const hasConnection = Object.prototype.hasOwnProperty.call(input ?? {}, "connectionId");
  const hasSalesLink = Object.prototype.hasOwnProperty.call(input ?? {}, "salesLinkId");
  const connectionId = hasConnection ? value(input.connectionId) || null : current.connectionId;
  const salesLinkId = hasSalesLink ? value(input.salesLinkId) || null : current.salesLinkId;
  const matchStatus = value(input?.matchStatus) || current.matchStatus;
  let matchMethod = Object.prototype.hasOwnProperty.call(input ?? {}, "matchMethod") ? value(input.matchMethod) || null : current.matchMethod;
  if (!mappingStatuses.has(matchStatus)) throw new Error("映射状态无效。");
  if (matchMethod && !mappingMethods.has(matchMethod)) throw new Error("匹配方式无效。");
  const profileRelation = readConnectionRelation(connectionId);
  const salesRelation = readSalesLinkRelation(salesLinkId);
  if (profileRelation && salesRelation && profileRelation.salesLinkId !== salesRelation.salesLinkId) throw new Error("连接档案与销售连接不一致。");
  const relation = profileRelation
    ? { connectionId: profileRelation.id, salesLinkId: profileRelation.salesLinkId }
    : salesRelation;
  if (matchStatus === "matched" && !relation) throw new Error("确认匹配时必须选择连接档案或销售连接。");
  if (matchStatus === "matched" && !matchMethod) matchMethod = current.sourceType === "business_advisor" ? "goods_id" : "manual";
  validateBusinessAdvisorIdentity(current.sourceType, current.externalId, relation, matchStatus, matchMethod);
  const now = new Date().toISOString();
  const confirmedBy = matchStatus === "matched" ? value(userId) || current.confirmedBy || null : null;
  const confirmedAt = matchStatus === "matched" ? current.confirmedAt || now : null;
  getDatabase().prepare(`
    UPDATE connection_data_mappings
    SET connectionId=?,salesLinkId=?,matchStatus=?,matchMethod=?,confirmedBy=?,confirmedAt=?,updatedAt=?
    WHERE id=? AND deletedAt IS NULL
  `).run(relation?.connectionId ?? null, relation?.salesLinkId ?? null, matchStatus, matchMethod, confirmedBy, confirmedAt, now, current.id);
  return readConnectionDataMapping(current.id);
}

export function deleteConnectionDataMapping(id, userId) {
  const now = new Date().toISOString();
  const result = getDatabase().prepare(`
    UPDATE connection_data_mappings SET deletedAt=?,deletedBy=?,updatedAt=? WHERE id=? AND deletedAt IS NULL
  `).run(now, value(userId) || null, now, value(id));
  if (result.changes === 0) throw new Error("外部数据映射不存在。");
  return { success: true, id: value(id) };
}
