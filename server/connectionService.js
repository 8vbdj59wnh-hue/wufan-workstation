import crypto from "node:crypto";
import { getDatabase } from "./db.js";

const profileStatuses = new Set(["active", "paused", "archived"]);
const actionStatuses = new Set(["pending", "in_progress", "completed", "canceled"]);

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
