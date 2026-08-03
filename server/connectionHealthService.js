import crypto from "node:crypto";
import { createResource, getDatabase } from "./db.js";
import { createConnectionAction } from "./connectionService.js";
import { getConnectionGrowthAnalysis } from "./connectionGrowthService.js";
import { createConnectionImprovement } from "./connectionImprovementService.js";

function text(value) {
  return String(value ?? "").trim();
}

function percentage(value, points = false) {
  if (value === null || value === undefined) return "—";
  const amount = Number(value) * 100;
  return `${amount > 0 ? "+" : ""}${amount.toFixed(1)}${points ? "个百分点" : "%"}`;
}

function parseRecord(row) {
  if (!row) return row;
  const parse = (value, fallback) => { try { return JSON.parse(value || JSON.stringify(fallback)); } catch { return fallback; } };
  return { ...row, problems: parse(row.problemsJson, []), suggestions: parse(row.suggestionsJson, []) };
}

function evaluate(analysis) {
  const problems = [];
  const suggestions = [];
  if (analysis.visitorGrowth < -0.2) {
    problems.push({ type: "traffic", title: "流量下降", value: percentage(analysis.visitorGrowth) });
    suggestions.push({ title: "检查流量来源", reason: "流量下降", items: ["搜索流量", "主图点击率", "推广来源"] });
  }
  if (analysis.visitorGrowth > 0.1 && analysis.conversionChange < -0.01) {
    problems.push({ type: "conversion", title: "转化能力下降", value: percentage(analysis.conversionChange, true) });
    suggestions.push({ title: "优化连接转化率", reason: "流量增长但转化下降", items: ["主图", "详情页", "价格", "评价"] });
  }
  if (analysis.salesGrowth < -0.3) {
    problems.push({ type: "sales", title: "销售衰退风险", value: percentage(analysis.salesGrowth) });
    suggestions.push({ title: "重新分析经营策略", reason: "销售下降超过30%", items: ["商品竞争力", "流量来源", "运营策略"] });
  }
  if (analysis.profitGrowth !== null && analysis.profitGrowth < -0.2) {
    problems.push({ type: "profit", title: "利润下降", value: percentage(analysis.profitGrowth) });
    suggestions.push({ title: "复核连接利润结构", reason: "同期净利润下降超过20%", items: ["退款", "商品成本", "平台费用", "推广费用"] });
  }
  const healthyGrowth = analysis.salesGrowth > 0.2 && analysis.conversionChange >= 0;
  if (healthyGrowth && suggestions.length === 0) suggestions.push({ title: "保持当前增长策略", reason: "销售增长且转化稳定", items: [] });
  const healthStatus = problems.some((problem) => problem.type === "sales") || analysis.healthScore < 40
    ? "risk" : problems.length > 0 || analysis.healthScore < 60 ? "attention" : "healthy";
  return { problems, suggestions, healthStatus };
}

export function listConnectionHealthRecords(connectionId) {
  if (!getDatabase().prepare("SELECT 1 FROM connection_profiles WHERE id=?").get(text(connectionId))) throw new Error("未找到连接档案。");
  return getDatabase().prepare(`
    SELECT r.*,s.periodStart,s.periodEnd FROM connection_health_records r
    JOIN connection_period_snapshots s ON s.id=r.snapshotId
    WHERE r.connectionId=? ORDER BY s.periodEnd DESC,s.periodStart DESC,r.createdAt DESC
  `).all(text(connectionId)).map(parseRecord);
}

export function createConnectionHealthRecord(connectionId, snapshotId) {
  const analysis = getConnectionGrowthAnalysis(connectionId);
  if (!analysis.comparable) throw new Error("至少需要两个经营周期才能生成体检报告。");
  if (analysis.currentPeriod.snapshotId !== text(snapshotId)) throw new Error("请选择当前最新经营周期生成体检报告。");
  const result = evaluate(analysis);
  const database = getDatabase();
  const existing = database.prepare("SELECT * FROM connection_health_records WHERE connectionId=? AND snapshotId=?").get(text(connectionId), text(snapshotId));
  if (existing) return { item: listConnectionHealthRecords(connectionId).find((item) => item.id === existing.id), created: false };
  const now = new Date().toISOString();
  const id = `connection-health-${crypto.randomUUID()}`;
  database.prepare(`
    INSERT INTO connection_health_records (id,connectionId,snapshotId,healthScore,healthStatus,problemsJson,suggestionsJson,createdAt,updatedAt)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(id, text(connectionId), text(snapshotId), analysis.healthScore, result.healthStatus,
    JSON.stringify(result.problems), JSON.stringify(result.suggestions), now, now);
  return { item: listConnectionHealthRecords(connectionId).find((item) => item.id === id), created: true };
}

export function listAttentionConnectionHealthRecords(userId = "", isAdmin = false) {
  const items = getDatabase().prepare(`
    SELECT r.*,c.name,c.salesLinkId,s.periodStart,s.periodEnd,sh.platform,sh.displayName AS shopDisplayName,sh.shopName
    FROM connection_health_records r
    JOIN connection_profiles c ON c.id=r.connectionId
    JOIN connection_period_snapshots s ON s.id=r.snapshotId
    JOIN sales_links l ON l.id=c.salesLinkId JOIN sales_shops sh ON sh.id=l.shopId
    WHERE r.healthStatus IN ('attention','risk')
      AND (?=1 OR c.ownerId=?)
      AND NOT EXISTS (SELECT 1 FROM connection_health_records newer WHERE newer.connectionId=r.connectionId AND newer.createdAt>r.createdAt)
    ORDER BY CASE r.healthStatus WHEN 'risk' THEN 0 ELSE 1 END,r.healthScore ASC,r.createdAt DESC
  `).all(isAdmin ? 1 : 0, text(userId)).map(parseRecord);
  const categories = { traffic: 0, conversion: 0, sales: 0, profit: 0 };
  for (const item of items) for (const problem of item.problems) if (Object.prototype.hasOwnProperty.call(categories, problem.type)) categories[problem.type] += 1;
  return { items, counts: { risk: items.filter((item) => item.healthStatus === "risk").length,
    attention: items.filter((item) => item.healthStatus === "attention").length, ...categories } };
}

export function createImprovementAction(healthRecordId, input, userId) {
  const database = getDatabase();
  const record = database.prepare(`
    SELECT r.*,c.name AS connectionName FROM connection_health_records r
    JOIN connection_profiles c ON c.id=r.connectionId WHERE r.id=?
  `).get(text(healthRecordId));
  if (!record) throw new Error("体检记录不存在。");
  const goal = database.prepare("SELECT id,name,status FROM goals WHERE id=?").get(text(input?.goalId));
  if (!goal || goal.status !== "active") throw new Error("请选择有效目标。");
  const actionTemplate = database.prepare(`
    SELECT t.id,t.name,t.defaultProcessTemplateId,p.version FROM task_templates t
    JOIN process_templates p ON p.id=t.defaultProcessTemplateId WHERE t.id=? AND t.status='active'
  `).get(text(input?.taskTemplateId));
  if (!actionTemplate) throw new Error("请选择已绑定标准流程的启用关键行动。");
  const problems = parseRecord(record).problems;
  const suggestions = parseRecord(record).suggestions;
  const title = text(input?.title) || suggestions[0]?.title || `改善${record.connectionName}`;
  const create = database.transaction(() => {
    const now = new Date().toISOString();
    const instance = createResource("process-instances", {
      id: `process-instance-${crypto.randomUUID()}`,
      templateId: actionTemplate.defaultProcessTemplateId,
      taskTemplateId: actionTemplate.id,
      templateVersion: actionTemplate.version,
      name: title,
      displayTitle: title,
      goalId: goal.id,
      initiatorId: text(userId),
      description: `来源：连接体检；连接：${record.connectionName}`,
      status: "draft",
      customFields: { source: "connection_health", connectionId: record.connectionId,
        healthRecordId: record.id, problems, suggestions },
      createdAt: now,
      updatedAt: now,
    });
    const linkedProducts = database.prepare(`
      SELECT DISTINCT s.productId FROM connection_profiles c
      JOIN sales_link_skus s ON s.salesLinkId=c.salesLinkId
      WHERE c.id=? AND s.productId IS NOT NULL AND COALESCE(s.currentState,'active')='active'
    `).all(record.connectionId);
    for (const product of linkedProducts) {
      database.prepare(`INSERT OR IGNORE INTO action_products (id,actionId,productId,createdAt) VALUES (?,?,?,?)`)
        .run(`action-product-${crypto.randomUUID()}`, instance.id, product.productId, now);
    }
    const problemTitles = problems.map((problem) => problem.title).join("、") || "持续改善";
    const connectionAction = createConnectionAction(record.connectionId, { title: `系统发现问题：${problemTitles}`,
      description: `创建改善行动：${title}；关键行动ID：${instance.id}`, status: "pending" }, userId);
    const improvement = createConnectionImprovement({ connectionId: record.connectionId, healthRecordId: record.id,
      actionId: instance.id, title }, userId);
    return { instance, connectionAction, improvement };
  });
  return create();
}
