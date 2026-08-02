import crypto from "node:crypto";
import { getDatabase } from "./db.js";
import { createConnectionAction } from "./connectionService.js";

const statuses = new Set(["planned", "executing", "observing", "effective", "failed", "closed"]);
const transitions = {
  planned: new Set(["executing"]),
  executing: new Set(["observing"]),
  observing: new Set(["effective", "failed"]),
  effective: new Set(["closed"]),
  failed: new Set(["closed"]),
  closed: new Set(),
};

function text(value) { return String(value ?? "").trim(); }

function parseJson(value, fallback = {}) {
  try { const parsed = JSON.parse(value || JSON.stringify(fallback)); return parsed && typeof parsed === "object" ? parsed : fallback; }
  catch { return fallback; }
}

function normalizeMetrics(value) {
  if (value === undefined || value === null || value === "") return {};
  const source = typeof value === "string" ? parseJson(value, null) : value;
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("改善指标格式无效。");
  const result = {};
  for (const key of ["payAmount", "conversionRate", "visitorCount", "payQuantity"]) {
    if (source[key] === undefined || source[key] === null || source[key] === "") continue;
    const number = Number(source[key]);
    if (!Number.isFinite(number)) throw new Error(`改善指标 ${key} 必须是数字。`);
    result[key] = number;
  }
  return result;
}

function parseImprovement(row) {
  return row ? { ...row, beforeMetrics: parseJson(row.beforeMetricsJson), afterMetrics: parseJson(row.afterMetricsJson) } : row;
}

export function readConnectionImprovement(id) {
  const row = getDatabase().prepare(`
    SELECT i.*,c.name AS connectionName,a.name AS actionName,h.healthScore,h.healthStatus
    FROM connection_improvements i JOIN connection_profiles c ON c.id=i.connectionId
    JOIN process_instances a ON a.id=i.actionId JOIN connection_health_records h ON h.id=i.healthRecordId
    WHERE i.id=?
  `).get(text(id));
  if (!row) throw new Error("改善项目不存在。");
  return parseImprovement(row);
}

export function listConnectionImprovements(filters = {}) {
  const clauses = ["1=1"];
  const values = [];
  if (text(filters.connectionId)) { clauses.push("i.connectionId=?"); values.push(text(filters.connectionId)); }
  if (text(filters.status)) {
    if (!statuses.has(text(filters.status))) throw new Error("改善项目状态无效。");
    clauses.push("i.status=?"); values.push(text(filters.status));
  }
  return getDatabase().prepare(`
    SELECT i.*,c.name AS connectionName,a.name AS actionName,h.healthScore,h.healthStatus
    FROM connection_improvements i JOIN connection_profiles c ON c.id=i.connectionId
    JOIN process_instances a ON a.id=i.actionId JOIN connection_health_records h ON h.id=i.healthRecordId
    WHERE ${clauses.join(" AND ")} ORDER BY i.updatedAt DESC,i.createdAt DESC
  `).all(...values).map(parseImprovement);
}

export function createConnectionImprovement(input, userId) {
  const connectionId = text(input?.connectionId);
  const healthRecordId = text(input?.healthRecordId);
  const actionId = text(input?.actionId);
  const title = text(input?.title);
  if (!title) throw new Error("请填写改善项目名称。");
  const database = getDatabase();
  const create = database.transaction(() => {
    const record = database.prepare(`
      SELECT h.id,h.connectionId,h.snapshotId,s.payAmount,s.conversionRate,s.visitorCount,s.payQuantity
      FROM connection_health_records h JOIN connection_period_snapshots s ON s.id=h.snapshotId
      WHERE h.id=? AND h.connectionId=?
    `).get(healthRecordId, connectionId);
    if (!record) throw new Error("体检记录与连接不匹配。");
    const action = database.prepare("SELECT id,customFields FROM process_instances WHERE id=?").get(actionId);
    if (!action) throw new Error("关联关键行动不存在。");
    const customFields = parseJson(action.customFields);
    if (customFields.connectionId !== connectionId || customFields.healthRecordId !== healthRecordId) throw new Error("关键行动与本次体检记录不匹配。");
    const existing = database.prepare("SELECT id FROM connection_improvements WHERE healthRecordId=? AND actionId=?").get(healthRecordId, actionId);
    if (existing) return { id: existing.id, created: false };
    const now = new Date().toISOString();
    const id = `connection-improvement-${crypto.randomUUID()}`;
    const beforeMetrics = normalizeMetrics({ payAmount: record.payAmount, conversionRate: record.conversionRate,
      visitorCount: record.visitorCount, payQuantity: record.payQuantity });
    database.prepare(`
      INSERT INTO connection_improvements (id,connectionId,healthRecordId,actionId,title,status,beforeMetricsJson,afterMetricsJson,resultSummary,createdAt,updatedAt)
      VALUES (?,?,?,?,?,'planned',?,'{}','',?,?)
    `).run(id, connectionId, healthRecordId, actionId, title, JSON.stringify(beforeMetrics), now, now);
    createConnectionAction(connectionId, { title: `创建改善项目：${title}`, description: `关联关键行动：${actionId}`, status: "pending" }, userId);
    return { id, created: true };
  });
  const result = create();
  return { item: readConnectionImprovement(result.id), created: result.created };
}

export function updateConnectionImprovement(id, input) {
  const current = readConnectionImprovement(id);
  const nextStatus = text(input?.status) || current.status;
  if (!statuses.has(nextStatus)) throw new Error("改善项目状态无效。");
  if (nextStatus !== current.status && !transitions[current.status].has(nextStatus)) throw new Error(`改善项目不能从 ${current.status} 直接变更为 ${nextStatus}。`);
  const afterMetrics = input?.afterMetrics === undefined ? current.afterMetrics : normalizeMetrics(input.afterMetrics);
  const resultSummary = input?.resultSummary === undefined ? current.resultSummary : text(input.resultSummary);
  const now = new Date().toISOString();
  const database = getDatabase();
  database.transaction(() => {
    database.prepare(`UPDATE connection_improvements SET status=?,afterMetricsJson=?,resultSummary=?,updatedAt=? WHERE id=?`)
      .run(nextStatus, JSON.stringify(afterMetrics), resultSummary, now, current.id);
    if (nextStatus === "effective" || nextStatus === "closed") {
      database.prepare(`
        UPDATE connection_diagnosis_entries
        SET status='closed',updatedAt=?
        WHERE connectionId=? AND status='active'
      `).run(now, current.connectionId);
    }
  })();
  return readConnectionImprovement(current.id);
}

export function getConnectionImprovementSummary() {
  const row = getDatabase().prepare(`
    SELECT COUNT(*) total,
      SUM(CASE WHEN status='effective' THEN 1 ELSE 0 END) effective,
      SUM(CASE WHEN status='observing' THEN 1 ELSE 0 END) observing,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed
    FROM connection_improvements
  `).get();
  return { total: Number(row.total || 0), effective: Number(row.effective || 0),
    observing: Number(row.observing || 0), failed: Number(row.failed || 0) };
}
