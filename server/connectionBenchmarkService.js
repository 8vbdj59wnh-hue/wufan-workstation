import crypto from "node:crypto";
import { getDatabase } from "./db.js";
import { getConnectionGrowthAnalysis } from "./connectionGrowthService.js";
import { readConnectionProfile } from "./connectionService.js";

function text(value) { return String(value ?? "").trim(); }
function parseJson(value) { try { return JSON.parse(value || "{}"); } catch { return {}; } }
function metric(metrics, names) {
  for (const name of names) {
    const raw = metrics?.[name];
    if (raw === null || raw === undefined || raw === "" || raw === "-") continue;
    const number = Number(String(raw).replaceAll(",", "").replace(/%$/, ""));
    if (Number.isFinite(number)) return String(raw).endsWith("%") ? number / 100 : number;
  }
  return null;
}

function comparisonItem(connectionId) {
  const database = getDatabase();
  const profile = readConnectionProfile(connectionId);
  const analysis = getConnectionGrowthAnalysis(connectionId);
  const snapshot = database.prepare(`SELECT * FROM connection_period_snapshots WHERE salesLinkId=?
    ORDER BY periodEnd DESC,periodStart DESC,createdAt DESC LIMIT 1`).get(profile.salesLinkId);
  const metrics = parseJson(snapshot?.metricsJson);
  return {
    ...profile,
    currentPeriod: analysis.currentPeriod,
    previousPeriod: analysis.previousPeriod,
    salesGrowth: analysis.salesGrowth,
    currentFinance: analysis.currentFinance,
    profitGrowth: analysis.profitGrowth,
    healthScore: analysis.healthScore,
    healthStatus: analysis.healthStatus,
    metrics: {
      favoriteCount: metric(metrics, ["商品收藏人数", "收藏人数", "商品收藏数"]),
      clickRate: metric(metrics, ["商品点击率", "点击率"]),
      price: metric(metrics, ["商品价格", "价格", "客单价"]),
      reviewCount: metric(metrics, ["评价数", "累计评价数", "商品评价数"]),
    },
    trend: database.prepare(`SELECT periodStart,periodEnd,payAmount,visitorCount,viewCount,cartCount,conversionRate,payQuantity
      FROM connection_period_snapshots WHERE salesLinkId=? ORDER BY periodEnd DESC,periodStart DESC LIMIT 6`).all(profile.salesLinkId).reverse(),
  };
}

export function getConnectionBenchmarks(connectionId) {
  const id = text(connectionId); const database = getDatabase();
  if (!database.prepare("SELECT 1 FROM connection_profiles WHERE id=?").get(id)) throw new Error("未找到连接档案。");
  const relations = database.prepare(`SELECT id,benchmarkConnectionId,sourceType,createdAt FROM connection_benchmarks
    WHERE connectionId=? ORDER BY createdAt,id`).all(id);
  return { relations, items: relations.map((relation) => ({ ...relation, benchmark: comparisonItem(relation.benchmarkConnectionId) })) };
}

export function listConnectionBenchmarkCandidates(connectionId) {
  const id = text(connectionId); const database = getDatabase();
  if (!database.prepare("SELECT 1 FROM connection_profiles WHERE id=?").get(id)) throw new Error("未找到连接档案。");
  return database.prepare(`SELECT c.id,c.name,c.mainImage,c.status,l.platformGoodsId,s.platform,s.displayName shopDisplayName,s.shopName
    FROM connection_profiles c JOIN sales_links l ON l.id=c.salesLinkId JOIN sales_shops s ON s.id=l.shopId
    WHERE c.id<>? ORDER BY c.name,c.id`).all(id);
}

export function replaceConnectionBenchmarks(connectionId, benchmarkConnectionIds, userId) {
  const id = text(connectionId); const requested = [...new Set((Array.isArray(benchmarkConnectionIds) ? benchmarkConnectionIds : []).map(text).filter(Boolean))];
  if (requested.includes(id)) throw new Error("不能将当前链接设置为自己的竞品。");
  const database = getDatabase();
  if (!database.prepare("SELECT 1 FROM connection_profiles WHERE id=?").get(id)) throw new Error("未找到连接档案。");
  if (requested.length) {
    const count = database.prepare(`SELECT COUNT(*) count FROM connection_profiles WHERE id IN (${requested.map(() => "?").join(",")})`).get(...requested).count;
    if (Number(count) !== requested.length) throw new Error("存在无效的竞品链接。");
  }
  const save = database.transaction(() => {
    const now = new Date().toISOString();
    if (requested.length) database.prepare(`DELETE FROM connection_benchmarks WHERE connectionId=?
      AND benchmarkConnectionId NOT IN (${requested.map(() => "?").join(",")})`).run(id, ...requested);
    else database.prepare("DELETE FROM connection_benchmarks WHERE connectionId=?").run(id);
    const insert = database.prepare(`INSERT INTO connection_benchmarks
      (id,connectionId,benchmarkConnectionId,sourceType,createdBy,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(connectionId,benchmarkConnectionId) DO UPDATE SET updatedAt=excluded.updatedAt`);
    for (const benchmarkId of requested) insert.run(`connection-benchmark-${crypto.randomUUID()}`, id, benchmarkId, "internal", text(userId) || null, now, now);
  });
  save();
  return getConnectionBenchmarks(id);
}

export function getConnectionBenchmarkComparison(connectionId, benchmarkConnectionId) {
  const id = text(connectionId); const benchmarkId = text(benchmarkConnectionId); const database = getDatabase();
  if (!database.prepare("SELECT 1 FROM connection_benchmarks WHERE connectionId=? AND benchmarkConnectionId=?").get(id, benchmarkId)) {
    throw new Error("该链接尚未设置此竞品。");
  }
  return { mine: comparisonItem(id), competitor: comparisonItem(benchmarkId) };
}
