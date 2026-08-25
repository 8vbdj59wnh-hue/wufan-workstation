import crypto from "node:crypto";
import { getDatabase } from "./db.js";
import { getConnectionGrowthAnalysis } from "./connectionGrowthService.js";
import { readConnectionProfile } from "./connectionService.js";
import { LINK_ASSET_SELECT_SQL } from "./linkAssetSql.js";

function text(value) { return String(value ?? "").trim(); }
function number(value) { if (value === "" || value === null || value === undefined) return null; const result = Number(value); return Number.isFinite(result) ? result : null; }
function parseJson(value) { try { return JSON.parse(value || "{}"); } catch { return {}; } }
function metric(metrics, names) {
  for (const name of names) {
    const raw = metrics?.[name];
    if (raw === null || raw === undefined || raw === "" || raw === "-") continue;
    const result = Number(String(raw).replaceAll(",", "").replace(/%$/, ""));
    if (Number.isFinite(result)) return String(raw).endsWith("%") ? result / 100 : result;
  }
  return null;
}

function internalDetail(connectionId) {
  const database = getDatabase(); const profile = readConnectionProfile(connectionId); const analysis = getConnectionGrowthAnalysis(connectionId);
  const snapshot = database.prepare(`SELECT * FROM connection_period_snapshots WHERE salesLinkId=?
    ORDER BY periodEnd DESC,periodStart DESC,createdAt DESC LIMIT 1`).get(profile.salesLinkId);
  const metrics = parseJson(snapshot?.metricsJson);
  return { ...profile, currentPeriod: analysis.currentPeriod, salesGrowth: analysis.salesGrowth, currentFinance: analysis.currentFinance,
    profitGrowth: analysis.profitGrowth, metrics: {
      favoriteCount: metric(metrics, ["商品收藏人数", "收藏人数", "商品收藏数"]), clickRate: metric(metrics, ["商品点击率", "点击率"]),
      price: metric(metrics, ["商品价格", "价格", "客单价"]), reviewCount: metric(metrics, ["评价数", "累计评价数", "商品评价数"]),
      sellingPoints: text(metrics["商品卖点"] || metrics["核心卖点"]), detailContent: text(metrics["详情页内容"] || metrics["商品详情"]),
    }, trend: database.prepare(`SELECT saleDate periodStart,saleDate periodEnd,SUM(salesAmount) payAmount
      FROM connection_sku_sales_daily_facts WHERE salesLinkId=? GROUP BY saleDate
      ORDER BY saleDate DESC LIMIT 6`).all(profile.salesLinkId).reverse() };
}

function normalizeTarget(row) {
  return { ...row, price: number(row.price), internal: row.internalConnectionId ? internalDetail(row.internalConnectionId) : null };
}

function validateInput(connectionId, input) {
  const targetType = text(input?.targetType) || "external"; const internalConnectionId = text(input?.internalConnectionId) || null;
  if (!["external", "internal"].includes(targetType)) throw new Error("对标链接类型无效。");
  if (targetType === "internal" && !internalConnectionId) throw new Error("请选择系统内对标链接。");
  if (internalConnectionId === connectionId) throw new Error("不能将当前链接设置为自己的对标。");
  const internal = internalConnectionId ? readConnectionProfile(internalConnectionId) : null;
  const targetUrl = text(input?.targetUrl || internal?.canonicalUrl);
  if (targetType === "external" && !targetUrl) throw new Error("请填写对标链接URL。");
  const title = text(input?.title || internal?.name);
  if (!title) throw new Error("请填写对标商品标题。");
  return { targetType, internalConnectionId, targetUrl: targetUrl || null, platform: text(input?.platform || internal?.platform) || null,
    title, mainImage: text(input?.mainImage || internal?.mainImage) || null, price: number(input?.price), salesInfo: text(input?.salesInfo) || null,
    reviewInfo: text(input?.reviewInfo) || null, sellingPoints: text(input?.sellingPoints) || null,
    detailContent: text(input?.detailContent) || null, notes: text(input?.notes) || null };
}

export function listConnectionBenchmarkTargets(connectionId) {
  const id = text(connectionId); const database = getDatabase();
  if (!database.prepare("SELECT 1 FROM sales_links WHERE id=?").get(id)) throw new Error("未找到链接资产。");
  return database.prepare(`SELECT * FROM connection_benchmark_targets WHERE connectionId=? ORDER BY createdAt,id`).all(id).map(normalizeTarget);
}

export function listConnectionBenchmarkCandidates(connectionId, userId = "", isAdmin = false) {
  const id = text(connectionId); const database = getDatabase();
  if (!database.prepare("SELECT 1 FROM sales_links WHERE id=?").get(id)) throw new Error("未找到链接资产。");
  return database.prepare(`SELECT c.id,c.name,c.mainImage,c.status,l.canonicalUrl,l.platformGoodsId,s.platform,s.displayName shopDisplayName,s.shopName
    FROM ${LINK_ASSET_SELECT_SQL} c JOIN sales_links l ON l.id=c.salesLinkId JOIN sales_shops s ON s.id=l.shopId
    WHERE c.id<>? AND (?=1 OR c.ownerId=?) ORDER BY c.name,c.id`).all(id, isAdmin ? 1 : 0, text(userId));
}

export function createConnectionBenchmarkTarget(connectionId, input, userId) {
  const id = text(connectionId); const database = getDatabase();
  if (!database.prepare("SELECT 1 FROM sales_links WHERE id=?").get(id)) throw new Error("未找到链接资产。");
  const target = validateInput(id, input); const now = new Date().toISOString(); const targetId = `connection-benchmark-${crypto.randomUUID()}`;
  database.prepare(`INSERT INTO connection_benchmark_targets
    (id,connectionId,targetType,internalConnectionId,targetUrl,platform,title,mainImage,price,salesInfo,reviewInfo,sellingPoints,detailContent,notes,createdBy,createdAt,updatedAt)
    VALUES (@id,@connectionId,@targetType,@internalConnectionId,@targetUrl,@platform,@title,@mainImage,@price,@salesInfo,@reviewInfo,@sellingPoints,@detailContent,@notes,@createdBy,@createdAt,@updatedAt)`)
    .run({ id: targetId, connectionId: id, ...target, createdBy: text(userId) || null, createdAt: now, updatedAt: now });
  return normalizeTarget(database.prepare("SELECT * FROM connection_benchmark_targets WHERE id=?").get(targetId));
}

export function updateConnectionBenchmarkTarget(connectionId, targetId, input) {
  const id = text(connectionId); const targetKey = text(targetId); const database = getDatabase();
  if (!database.prepare("SELECT 1 FROM connection_benchmark_targets WHERE id=? AND connectionId=?").get(targetKey, id)) throw new Error("未找到对标链接。");
  const target = validateInput(id, input); database.prepare(`UPDATE connection_benchmark_targets SET
    targetType=@targetType,internalConnectionId=@internalConnectionId,targetUrl=@targetUrl,platform=@platform,title=@title,mainImage=@mainImage,
    price=@price,salesInfo=@salesInfo,reviewInfo=@reviewInfo,sellingPoints=@sellingPoints,detailContent=@detailContent,notes=@notes,updatedAt=@updatedAt
    WHERE id=@id AND connectionId=@connectionId`).run({ id: targetKey, connectionId: id, ...target, updatedAt: new Date().toISOString() });
  return normalizeTarget(database.prepare("SELECT * FROM connection_benchmark_targets WHERE id=?").get(targetKey));
}

export function deleteConnectionBenchmarkTarget(connectionId, targetId) {
  const result = getDatabase().prepare("DELETE FROM connection_benchmark_targets WHERE id=? AND connectionId=?").run(text(targetId), text(connectionId));
  if (!result.changes) throw new Error("未找到对标链接。");
  return { success: true };
}

export function getConnectionBenchmarkComparison(connectionId, targetId) {
  const target = listConnectionBenchmarkTargets(connectionId).find((item) => item.id === text(targetId));
  if (!target) throw new Error("未找到对标链接。");
  return { mine: internalDetail(text(connectionId)), target };
}
