import crypto from "node:crypto";
import { getDatabase } from "./db.js";

const profileStatuses = new Set(["active", "paused", "archived"]);
const actionStatuses = new Set(["pending", "in_progress", "completed", "canceled"]);
const mappingSourceTypes = new Set(["business_advisor", "wangdian", "taobao", "xiaohongshu", "douyin"]);
const mappingStatuses = new Set(["matched", "pending", "ignored", "rejected"]);
const mappingMethods = new Set(["goods_id", "sku", "manual"]);

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
  SELECT c.id, c.salesLinkId, c.name, c.ownerId, c.status, c.notes, c.createdBy, c.createdAt, c.updatedAt,
         l.title AS salesLinkTitle, l.canonicalUrl, l.rawUrl, l.platformGoodsCode, l.currentState AS salesLinkState,
         s.id AS shopId, s.platform, s.displayName AS shopDisplayName, s.shopName
  FROM connection_profiles c
  JOIN sales_links l ON l.id=c.salesLinkId
  JOIN sales_shops s ON s.id=l.shopId
`;

export function listConnectionProfiles() {
  const rows = getDatabase().prepare(`${connectionSelect} ORDER BY c.updatedAt DESC, c.id DESC`).all();
  return enrichConnectionRows(rows);
}

export function readConnectionProfile(id) {
  const row = getDatabase().prepare(`${connectionSelect} WHERE c.id=?`).get(value(id));
  if (!row) throw new Error("未找到连接档案。");
  return enrichConnectionRows([row])[0];
}

export function listAvailableSalesLinks(search = "") {
  const query = value(search).toLowerCase();
  const rows = getDatabase().prepare(`
    SELECT l.id AS salesLinkId, l.title AS salesLinkTitle, l.canonicalUrl, l.platformGoodsCode,
           s.platform, s.displayName AS shopDisplayName, s.shopName
    FROM sales_links l
    JOIN sales_shops s ON s.id=l.shopId
    LEFT JOIN connection_profiles c ON c.salesLinkId=l.id
    WHERE c.id IS NULL AND COALESCE(l.currentState,'active')='active'
      AND (?='' OR LOWER(COALESCE(l.title,'')) LIKE ? OR LOWER(COALESCE(l.platformGoodsCode,'')) LIKE ?
        OR LOWER(COALESCE(s.displayName,s.shopName,'')) LIKE ?)
    ORDER BY l.updatedAt DESC, l.id DESC
    LIMIT 200
  `).all(query, `%${query}%`, `%${query}%`, `%${query}%`);
  return enrichConnectionRows(rows);
}

export function createConnectionProfile(input, userId) {
  const salesLinkId = value(input?.salesLinkId);
  const ownerId = value(input?.ownerId) || null;
  const status = value(input?.status) || "active";
  if (!salesLinkId) throw new Error("请选择销售连接。");
  if (!profileStatuses.has(status)) throw new Error("连接状态无效。");
  const database = getDatabase();
  const create = database.transaction(() => {
    const link = database.prepare(`
      SELECT l.id, l.title, l.platformGoodsCode, l.currentState, s.displayName, s.shopName
      FROM sales_links l JOIN sales_shops s ON s.id=l.shopId WHERE l.id=?
    `).get(salesLinkId);
    if (!link) throw new Error("所选销售连接不存在。");
    if (String(link.currentState ?? "active") !== "active") throw new Error("失效销售连接不能建立连接档案。");
    if (database.prepare("SELECT 1 FROM connection_profiles WHERE salesLinkId=?").get(salesLinkId)) throw new Error("该销售连接已建立档案。");
    if (ownerId && !database.prepare("SELECT 1 FROM persons WHERE id=? AND status='active'").get(ownerId)) throw new Error("负责人不存在或已停用。");
    const now = new Date().toISOString();
    const id = `connection-${crypto.randomUUID()}`;
    const name = value(input?.name) || value(link.title) || value(link.platformGoodsCode) || value(link.displayName) || value(link.shopName) || "未命名连接";
    database.prepare(`
      INSERT INTO connection_profiles (id,salesLinkId,name,ownerId,status,notes,createdBy,createdAt,updatedAt)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(id, salesLinkId, name, ownerId, status, value(input?.notes), value(userId) || null, now, now);
    return id;
  });
  return readConnectionProfile(create());
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
  if (matchStatus === "matched" && !matchMethod) matchMethod = "manual";
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
  if (matchStatus === "matched" && !matchMethod) matchMethod = "manual";
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
