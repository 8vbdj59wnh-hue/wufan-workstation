import crypto from "node:crypto";
import { getDatabase } from "./db.js";
import { previewConnectionImportBatch, readConnectionImportBatch } from "./connectionImportService.js";

const periodTypes = new Set(["rolling_30d", "calendar_month", "custom_period"]);

function text(value) {
  return String(value ?? "").trim();
}

function normalizeDate(value) {
  const match = text(value).match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (!match || Number.isNaN(Date.parse(`${match[0]}T00:00:00Z`))) return "";
  return match[0];
}

function number(value, { percent = false } = {}) {
  const normalized = text(value).replaceAll(",", "").replace(/%$/, "");
  if (!normalized || normalized === "-") return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return percent ? parsed / 100 : parsed;
}

function snapshotMetrics(row) {
  const metrics = row.externalData?.metrics ?? {};
  return {
    visitorCount: number(metrics["商品访客数"]),
    viewCount: number(metrics["商品浏览量"]),
    cartCount: number(metrics["商品加购件数"]),
    orderBuyerCount: number(metrics["下单买家数"]),
    payBuyerCount: number(metrics["支付买家数"]),
    conversionRate: number(metrics["商品支付转化率"], { percent: true }),
    payAmount: number(metrics["支付金额"]),
    payQuantity: number(metrics["支付件数"]),
    refundAmount: number(metrics["成功退款金额"]),
    competitionScore: number(metrics["竞争力评分"]),
    metricsJson: JSON.stringify(metrics),
  };
}

function validatePeriod(input, batch) {
  const periodStart = normalizeDate(input?.periodStart || batch.periodStart);
  const periodEnd = normalizeDate(input?.periodEnd || batch.periodEnd);
  const periodType = text(input?.periodType || batch.periodType || "rolling_30d");
  if (!periodStart || !periodEnd) throw new Error("请确认经营周期的开始和结束日期。");
  if (periodStart > periodEnd) throw new Error("经营周期开始日期不能晚于结束日期。");
  if (!periodTypes.has(periodType)) throw new Error("经营周期类型无效。");
  if (input?.confirmed !== true) throw new Error("请先确认检测到的经营周期。");
  return { periodStart, periodEnd, periodType };
}

export function createConnectionPeriodSnapshots(importBatchId, input = {}) {
  const preview = previewConnectionImportBatch(importBatchId);
  if (preview.batch.status !== "completed") throw new Error("请先确认并保存经营数据映射。");
  const period = validatePeriod(input, preview.batch);
  const database = getDatabase();
  const mappings = database.prepare(`
    SELECT id,connectionId,salesLinkId,externalId FROM connection_data_mappings
    WHERE sourceType=? AND externalShopId=? AND matchStatus='matched' AND deletedAt IS NULL
  `).all(preview.batch.sourceType, preview.batch.externalShopId);
  const mappingsByExternalId = new Map(mappings.map((mapping) => [mapping.externalId, mapping]));
  let created = 0;
  let existing = 0;
  const insert = database.prepare(`
    INSERT OR IGNORE INTO connection_period_snapshots (
      id,connectionId,salesLinkId,mappingId,importBatchId,sourceType,externalId,externalDataJson,
      periodStart,periodEnd,periodType,visitorCount,viewCount,cartCount,orderBuyerCount,payBuyerCount,
      conversionRate,payAmount,payQuantity,refundAmount,competitionScore,metricsJson,createdAt
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const create = database.transaction(() => {
    const now = new Date().toISOString();
    for (const row of preview.rows) {
      const mapping = mappingsByExternalId.get(row.externalId);
      if (!mapping?.salesLinkId) continue;
      const metrics = snapshotMetrics(row);
      const result = insert.run(`connection-period-${crypto.randomUUID()}`, mapping.connectionId, mapping.salesLinkId,
        mapping.id, preview.batch.id, preview.batch.sourceType, row.externalId, JSON.stringify(row.externalData ?? {}),
        period.periodStart, period.periodEnd, period.periodType, metrics.visitorCount, metrics.viewCount,
        metrics.cartCount, metrics.orderBuyerCount, metrics.payBuyerCount, metrics.conversionRate, metrics.payAmount,
        metrics.payQuantity, metrics.refundAmount, metrics.competitionScore, metrics.metricsJson, now);
      if (result.changes) created += 1; else existing += 1;
    }
    database.prepare(`
      UPDATE connection_import_batches SET periodStart=?,periodEnd=?,periodType=?,updatedAt=? WHERE id=?
    `).run(period.periodStart, period.periodEnd, period.periodType, now, preview.batch.id);
  });
  create();
  return { batch: readConnectionImportBatch(preview.batch.id), created, existing, period };
}

export function listConnectionPeriodSnapshots(connectionId) {
  const profile = getDatabase().prepare("SELECT id,salesLinkId FROM connection_profiles WHERE id=?").get(text(connectionId));
  if (!profile) throw new Error("未找到连接档案。");
  return getDatabase().prepare(`
    SELECT id,connectionId,salesLinkId,mappingId,importBatchId,sourceType,externalId,periodStart,periodEnd,periodType,
           visitorCount,viewCount,cartCount,orderBuyerCount,payBuyerCount,conversionRate,payAmount,payQuantity,
           refundAmount,competitionScore,metricsJson,createdAt
    FROM connection_period_snapshots WHERE salesLinkId=?
    ORDER BY periodEnd DESC,periodStart DESC,createdAt DESC
  `).all(profile.salesLinkId).map((row) => {
    try { return { ...row, metrics: JSON.parse(row.metricsJson || "{}") }; }
    catch { return { ...row, metrics: {} }; }
  });
}
