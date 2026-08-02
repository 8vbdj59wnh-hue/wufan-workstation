import crypto from "node:crypto";
import { getDatabase } from "./db.js";
import { listConnectionGrowthAnalyses } from "./connectionGrowthService.js";

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

function readProductsBySalesLinkIds(salesLinkIds) {
  if (salesLinkIds.length === 0) return new Map();
  const rows = getDatabase().prepare(`
    SELECT DISTINCT s.salesLinkId, p.id, p.skuCode, p.name, p.mainImage
    FROM sales_link_skus s
    JOIN products p ON p.id=s.productId
    WHERE s.salesLinkId IN (${placeholders(salesLinkIds)})
      AND s.productId IS NOT NULL
      AND COALESCE(s.currentState,'active')='active'
    ORDER BY s.salesLinkId, s.createdAt, s.id, p.id
  `).all(...salesLinkIds);
  const byLink = new Map();
  for (const row of rows) {
    const products = byLink.get(row.salesLinkId) ?? [];
    if (!products.some((item) => item.id === row.id)) products.push({ id: row.id, skuCode: row.skuCode, name: row.name, mainImage: row.mainImage });
    byLink.set(row.salesLinkId, products);
  }
  return byLink;
}

function enrichConnectionRows(rows) {
  const productsByLink = readProductsBySalesLinkIds([...new Set(rows.map((row) => row.salesLinkId))]);
  return rows.map((row) => ({
    ...row,
    products: productsByLink.get(row.salesLinkId) ?? [],
  }));
}

const connectionSelect = `
  SELECT c.id, c.salesLinkId, c.name, c.mainImage, c.imageSource, c.ownerId, c.status, c.level, c.notes,
         c.originSource, c.originImportBatchId, c.identifiedAt, c.createdBy, c.createdAt, c.updatedAt,
         (SELECT name FROM persons WHERE id=c.ownerId) AS ownerName,
         l.title AS salesLinkTitle, l.canonicalUrl, l.rawUrl, l.platformGoodsId, l.platformGoodsCode, l.currentState AS salesLinkState,
         s.id AS shopId, s.platform, s.displayName AS shopDisplayName, s.shopName,
         (SELECT periodEnd FROM connection_period_snapshots ps WHERE ps.salesLinkId=c.salesLinkId
          ORDER BY periodEnd DESC,periodStart DESC,createdAt DESC LIMIT 1) AS latestPeriodEnd,
         (SELECT payAmount FROM connection_period_snapshots ps WHERE ps.salesLinkId=c.salesLinkId
          ORDER BY periodEnd DESC,periodStart DESC,createdAt DESC LIMIT 1) AS latestPayAmount
         ,(SELECT COUNT(*) FROM connection_benchmarks b WHERE b.connectionId=c.id) AS benchmarkCount
         ,(SELECT target.name FROM connection_benchmarks b JOIN connection_profiles target ON target.id=b.benchmarkConnectionId
           WHERE b.connectionId=c.id ORDER BY b.createdAt,b.id LIMIT 1) AS firstBenchmarkName
  FROM connection_profiles c
  JOIN sales_links l ON l.id=c.salesLinkId
  JOIN sales_shops s ON s.id=l.shopId
`;

export function listConnectionProfiles() {
  const rows = getDatabase().prepare(`${connectionSelect} ORDER BY c.updatedAt DESC, c.id DESC`).all();
  return enrichConnectionRows(rows);
}

function changeDirection(analysis) {
  const changes = [analysis.salesGrowth, analysis.visitorGrowth, analysis.conversionChange, analysis.profitGrowth]
    .filter((item) => item !== null && item !== undefined).map(Number);
  const severeDecline = Number(analysis.salesGrowth) <= -0.2 || Number(analysis.visitorGrowth) <= -0.2
    || Number(analysis.conversionChange) <= -0.01 || Number(analysis.profitGrowth) <= -0.2;
  const decliningCount = changes.filter((item) => item < 0).length;
  const growingCount = changes.filter((item) => item > 0).length;
  if (severeDecline || ["attention", "risk"].includes(analysis.healthStatus) || decliningCount >= 2) return "worse";
  if (growingCount > decliningCount) return "better";
  return "stable";
}

export function getMyConnectionWorkbench(userId, isAdmin = false, filter = "all") {
  const personId = value(userId);
  if (!personId) throw new Error("无法识别当前登录人员。");
  if (!["all", "better", "worse", "followed"].includes(filter)) throw new Error("我的链接筛选无效。");
  const profiles = listConnectionProfiles().filter((item) => isAdmin || item.ownerId === personId);
  const analyses = new Map(listConnectionGrowthAnalyses().map((item) => [item.connectionId, item]));
  const followedIds = new Set(getDatabase().prepare("SELECT connectionId FROM connection_follows WHERE userId=?").all(personId).map((item) => item.connectionId));
  const items = profiles.map((profile) => {
    const analysis = analyses.get(profile.id) ?? {};
    const trend = changeDirection(analysis);
    const followed = followedIds.has(profile.id);
    const riskPriority = trend === "worse"
      ? (Number(analysis.salesGrowth) <= -0.2 || Number(analysis.visitorGrowth) <= -0.2 || Number(analysis.profitGrowth) <= -0.2 ? 0 : 1)
      : followed ? 2 : 3;
    return { ...profile, followed, trend, riskPriority,
      currentPayAmount: analysis.currentPeriod?.payAmount ?? null,
      salesGrowth: analysis.salesGrowth ?? null, visitorGrowth: analysis.visitorGrowth ?? null,
      conversionChange: analysis.conversionChange ?? null, profitGrowth: analysis.profitGrowth ?? null,
      healthScore: analysis.healthScore ?? null, healthStatus: analysis.healthStatus ?? "no_data" };
  }).filter((item) => filter === "all" || (filter === "followed" ? item.followed : item.trend === filter))
    .sort((left, right) => left.riskPriority - right.riskPriority
      || Number(left.healthScore ?? 101) - Number(right.healthScore ?? 101)
      || Number(left.salesGrowth ?? 0) - Number(right.salesGrowth ?? 0));
  return { items, isAdmin: Boolean(isAdmin), summary: {
    total: profiles.length,
    better: profiles.reduce((count, item) => count + (changeDirection(analyses.get(item.id) ?? {}) === "better" ? 1 : 0), 0),
    risk: profiles.reduce((count, item) => count + (changeDirection(analyses.get(item.id) ?? {}) === "worse" ? 1 : 0), 0),
    followed: profiles.filter((item) => followedIds.has(item.id)).length,
  } };
}

export function setConnectionFollow(connectionId, userId, followed, isAdmin = false) {
  const id = value(connectionId); const personId = value(userId); const database = getDatabase();
  const profile = database.prepare("SELECT ownerId FROM connection_profiles WHERE id=?").get(id);
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
  const summary = database.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN c.id IS NOT NULL THEN 1 ELSE 0 END) AS existing,
           SUM(CASE WHEN c.id IS NULL THEN 1 ELSE 0 END) AS pending
    FROM sales_links l LEFT JOIN connection_profiles c ON c.salesLinkId=l.id
    WHERE COALESCE(l.currentState,'active')='active'
  `).get();
  const optionRows = database.prepare(`
    SELECT DISTINCT s.id AS shopId,s.platform,s.displayName AS shopDisplayName,s.shopName
    FROM sales_links l JOIN sales_shops s ON s.id=l.shopId
    WHERE COALESCE(l.currentState,'active')='active'
    ORDER BY s.platform,COALESCE(s.displayName,s.shopName),s.id
  `).all();
  const rows = getDatabase().prepare(`
    SELECT l.id AS salesLinkId, l.title AS salesLinkTitle, l.canonicalUrl, l.platformGoodsId, l.platformGoodsCode,
           s.id AS shopId, s.platform, s.displayName AS shopDisplayName, s.shopName,
           c.id AS connectionId,
           CASE WHEN EXISTS (
             SELECT 1 FROM sales_link_skus sku
             WHERE sku.salesLinkId=l.id AND sku.productId IS NOT NULL AND COALESCE(sku.currentState,'active')='active'
           ) THEN 1 ELSE 0 END AS hasLinkedProduct
    FROM sales_links l
    JOIN sales_shops s ON s.id=l.shopId
    LEFT JOIN connection_profiles c ON c.salesLinkId=l.id
    WHERE COALESCE(l.currentState,'active')='active'
      AND (?='all' OR (?='pending' AND c.id IS NULL) OR (?='existing' AND c.id IS NOT NULL))
      AND (?='' OR s.platform=?)
      AND (?='' OR s.id=?)
      AND (?='' OR (?='linked' AND EXISTS (
        SELECT 1 FROM sales_link_skus sku
        WHERE sku.salesLinkId=l.id AND sku.productId IS NOT NULL AND COALESCE(sku.currentState,'active')='active'
      )) OR (?='unlinked' AND NOT EXISTS (
        SELECT 1 FROM sales_link_skus sku
        WHERE sku.salesLinkId=l.id AND sku.productId IS NOT NULL AND COALESCE(sku.currentState,'active')='active'
      )))
      AND (?='' OR LOWER(COALESCE(l.title,'')) LIKE ? OR LOWER(COALESCE(l.platformGoodsId,'')) LIKE ?
        OR LOWER(COALESCE(l.platformGoodsCode,'')) LIKE ? OR LOWER(COALESCE(s.displayName,s.shopName,'')) LIKE ?)
    ORDER BY l.updatedAt DESC, l.id DESC
    LIMIT 500
  `).all(connectionStatus, connectionStatus, connectionStatus, platform, platform, shopId, shopId,
    productRelation, productRelation, productRelation, query, `%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`);
  const items = enrichConnectionRows(rows);
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
  const product = database.prepare(`
    SELECT p.mainImage FROM sales_link_skus sku JOIN products p ON p.id=sku.productId
    WHERE sku.salesLinkId=? AND sku.productId IS NOT NULL AND COALESCE(sku.currentState,'active')='active'
      AND COALESCE(p.mainImage,'')<>''
    ORDER BY sku.createdAt,sku.id,p.id LIMIT 1
  `).get(salesLinkId);
  return product?.mainImage ? { mainImage: product.mainImage, imageSource: "product" } : { mainImage: null, imageSource: null };
}

export function createConnectionProfile(input, userId) {
  void input;
  void userId;
  throw new Error("新连接档案只能通过生意参谋经营数据导入创建。");
}

export function createConnectionProfilesBatch(input, userId) {
  void input;
  void userId;
  throw new Error("已停用从ERP销售链接批量建立连接档案，请通过生意参谋经营数据导入识别连接。");
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
    let link = database.prepare("SELECT * FROM sales_links WHERE shopId=? AND platformGoodsId=?").get(shopId, platformGoodsId);
    let salesLinkCreated = false;
    const now = new Date().toISOString();
    if (!link) {
      const id = `sales-link-${crypto.randomUUID()}`;
      database.prepare(`
        INSERT INTO sales_links (
          id,shopId,platformGoodsId,platformGoodsCode,title,canonicalUrl,rawUrl,status,activityStatus,category,
          identityStrength,originSource,enrichmentStatus,lastModifiedAt,lastSeenBatchId,currentState,missingAt,
          lastImportedAt,createdAt,updatedAt
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(id, shopId, platformGoodsId, null, title, null, null, "待ERP补充", null, null,
        "strong", businessAdvisorSource, "pending_erp", null, null, "active", null, now, now, now);
      link = database.prepare("SELECT * FROM sales_links WHERE id=?").get(id);
      salesLinkCreated = true;
    }
    let profile = database.prepare("SELECT * FROM connection_profiles WHERE salesLinkId=?").get(link.id);
    let profileCreated = false;
    if (!profile) {
      const id = `connection-${crypto.randomUUID()}`;
      const image = connectionImageForSalesLink(database, link.id);
      database.prepare(`
        INSERT INTO connection_profiles (
          id,salesLinkId,name,mainImage,imageSource,ownerId,status,level,notes,originSource,
          originImportBatchId,identifiedAt,createdBy,createdAt,updatedAt
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(id, link.id, title, image.mainImage, image.imageSource, null, "active", "new", "",
        businessAdvisorSource, importBatchId, now, value(userId) || null, now, now);
      profile = database.prepare("SELECT * FROM connection_profiles WHERE id=?").get(id);
      profileCreated = true;
    }
    return { connectionId: profile.id, salesLinkId: link.id, profileCreated, salesLinkCreated };
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
    LEFT JOIN connection_profiles c ON c.salesLinkId=m.salesLinkId
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
  database.prepare(`UPDATE connection_profiles SET name=?,ownerId=?,status=?,level=?,updatedAt=? WHERE id=?`)
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
    if (!database.prepare("SELECT 1 FROM connection_profiles WHERE id=?").get(profileId)) throw new Error("未找到连接档案。");
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
  const row = getDatabase().prepare("SELECT id, salesLinkId FROM connection_profiles WHERE id=?").get(connectionId);
  if (!row) throw new Error("所选连接档案不存在。");
  return row;
}

function readSalesLinkRelation(salesLinkId) {
  if (!salesLinkId) return null;
  const row = getDatabase().prepare(`
    SELECT l.id AS salesLinkId, c.id AS connectionId
    FROM sales_links l LEFT JOIN connection_profiles c ON c.salesLinkId=l.id WHERE l.id=?
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
  LEFT JOIN connection_profiles c ON c.id=m.connectionId
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
