import crypto from "node:crypto";
import { createResource, getDatabase } from "./db.js";

export const productLifecycleStatuses = ["开发中", "上架", "成长期", "成熟期", "风险期", "淘汰"];

function text(value) { return String(value ?? "").trim(); }
function number(value) { return value === null || value === undefined ? null : Number(value); }
function parseJson(value, fallback) { try { return JSON.parse(value || JSON.stringify(fallback)); } catch { return fallback; } }
function now() { return new Date().toISOString(); }
function ratio(current, previous) { return previous === null || previous === 0 || current === null ? null : (current - previous) / Math.abs(previous); }

function latestProductSnapshots(database, productId) {
  const rows = database.prepare(`
    SELECT p.*,f.businessDate,f.id AS factSnapshotId
    FROM product_daily_snapshots p JOIN erp_fact_snapshots f ON f.id=p.snapshotId
    WHERE p.productId=? AND f.status='completed'
    ORDER BY f.businessDate DESC,f.createdAt DESC LIMIT 2
  `).all(productId);
  return { current: rows[0] ?? null, previous: rows[1] ?? null };
}

function financeMetrics(database, productId) {
  const rows = database.prepare(`SELECT entryType,amount FROM finance_entries WHERE productId=? AND status IN ('confirmed','approved')`).all(productId);
  if (!rows.length) return { revenue: null, refunds: null, cost: null, expense: null, grossProfit: null, netProfit: null, profitMargin: null };
  const sum = (type) => rows.filter((row) => row.entryType === type).reduce((total, row) => total + Number(row.amount || 0), 0);
  const grossIncome = sum("income"); const refunds = sum("refund"); const revenue = grossIncome - refunds;
  const cost = sum("cost"); const expense = sum("expense"); const grossProfit = revenue - cost; const netProfit = grossProfit - expense;
  return { revenue, refunds, cost, expense, grossProfit, netProfit, profitMargin: revenue ? netProfit / revenue : null };
}

function connectionMetrics(database, productId) {
  const periods = database.prepare(`
    SELECT s.periodStart,s.periodEnd,SUM(s.payAmount) payAmount,SUM(s.visitorCount) visitorCount,
      CASE WHEN SUM(s.visitorCount)>0 THEN SUM(s.conversionRate*s.visitorCount)/SUM(s.visitorCount) ELSE NULL END conversionRate
    FROM connection_period_snapshots s
    WHERE s.salesLinkId IN (SELECT DISTINCT salesLinkId FROM sales_link_skus WHERE productId=? AND matchStatus IN ('matched','matched_auto','matched_manual'))
    GROUP BY s.periodStart,s.periodEnd ORDER BY s.periodEnd DESC,s.periodStart DESC LIMIT 2
  `).all(productId);
  const current = periods[0] ?? null; const previous = periods[1] ?? null;
  return { current, previous, salesAmountGrowth: ratio(number(current?.payAmount), number(previous?.payAmount)),
    visitorGrowth: ratio(number(current?.visitorCount), number(previous?.visitorCount)),
    conversionChange: current?.conversionRate === null || previous?.conversionRate === null || !current || !previous
      ? null : Number(current.conversionRate) - Number(previous.conversionRate) };
}

export function getProductBusinessAnalysis(productId) {
  const database = getDatabase();
  const product = database.prepare("SELECT id,name,skuCode,status,mainImage,createdAt,updatedAt FROM products WHERE id=?").get(text(productId));
  if (!product) throw new Error("产品不存在。");
  const snapshots = latestProductSnapshots(database, product.id);
  const currentSales = number(snapshots.current?.sales30d); const previousSales = number(snapshots.previous?.sales30d);
  const actualStock = number(snapshots.current?.totalStock);
  const salesGrowth = ratio(currentSales, previousSales);
  const inventoryTurnover = actualStock !== null && currentSales !== null && actualStock + currentSales > 0 ? currentSales / (actualStock + currentSales) : null;
  return { product, snapshotKey: snapshots.current?.factSnapshotId ?? `live:${new Date().toISOString().slice(0, 10)}`,
    sales: { businessDate: snapshots.current?.businessDate ?? null, sales30d: currentSales, previousSales30d: previousSales, growth: salesGrowth },
    inventory: { actualStock, turnover: inventoryTurnover, risk: actualStock !== null && actualStock > 0 && (currentSales ?? 0) === 0 ? "积压" : actualStock === 0 ? "缺货" : "正常" },
    finance: financeMetrics(database, product.id), connections: connectionMetrics(database, product.id) };
}

function evaluate(analysis) {
  const problems = []; const suggestions = [];
  if (analysis.sales.growth !== null && analysis.sales.growth < -0.2) { problems.push({ type: "sales_decline", title: "销售下降", severity: analysis.sales.growth < -0.4 ? "high" : "medium", value: analysis.sales.growth }); suggestions.push({ title: "复盘产品销售下降原因", reason: "近两期销量下降" }); }
  if (analysis.inventory.risk === "积压") { problems.push({ type: "inventory_backlog", title: "库存积压", severity: "high", value: analysis.inventory.actualStock }); suggestions.push({ title: "制定库存去化方案", reason: "有库存但近30天无销量" }); }
  if (analysis.inventory.risk === "缺货" && (analysis.sales.sales30d ?? 0) > 0) { problems.push({ type: "stockout", title: "库存不足", severity: "medium", value: 0 }); suggestions.push({ title: "检查补货计划", reason: "有销量但当前库存为零" }); }
  if (analysis.finance.profitMargin !== null && analysis.finance.profitMargin < 0.1) { problems.push({ type: "profit_low", title: "利润偏低", severity: analysis.finance.profitMargin < 0 ? "high" : "medium", value: analysis.finance.profitMargin }); suggestions.push({ title: "复核成本与费用结构", reason: "产品利润率低于10%" }); }
  if (analysis.connections.conversionChange !== null && analysis.connections.conversionChange < -0.01) { problems.push({ type: "conversion_decline", title: "转化下降", severity: "medium", value: analysis.connections.conversionChange }); suggestions.push({ title: "检查关联连接主图、详情和价格", reason: "连接转化率下降超过1个百分点" }); }
  const scores = [];
  if (analysis.sales.sales30d !== null) scores.push(analysis.sales.sales30d > 0 ? 75 + Math.max(-25, Math.min(25, (analysis.sales.growth ?? 0) * 100)) : 25);
  if (analysis.finance.profitMargin !== null) scores.push(Math.max(0, Math.min(100, 50 + analysis.finance.profitMargin * 100)));
  if (analysis.inventory.actualStock !== null) scores.push(analysis.inventory.risk === "正常" ? 85 : analysis.inventory.risk === "缺货" ? 55 : 25);
  if (analysis.connections.conversionChange !== null) scores.push(Math.max(0, Math.min(100, 70 + analysis.connections.conversionChange * 1000)));
  const healthScore = scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) : null;
  const healthStatus = healthScore === null ? "no_data" : healthScore >= 80 ? "growth" : healthScore >= 60 ? "stable" : healthScore >= 40 ? "attention" : "risk";
  return { healthScore, healthStatus, problems, suggestions };
}

function parseHealth(row) { return row ? { ...row, metrics: parseJson(row.metricsJson, {}), problems: parseJson(row.problemsJson, []), suggestions: parseJson(row.suggestionsJson, []) } : null; }

export function evaluateProductHealth(productId) {
  const database = getDatabase(); const analysis = getProductBusinessAnalysis(productId); const result = evaluate(analysis); const timestamp = now();
  const save = database.transaction(() => {
    const existing = database.prepare("SELECT id,createdAt FROM product_health_records WHERE productId=? AND snapshotKey=?").get(text(productId), analysis.snapshotKey);
    const id = existing?.id ?? `product-health-${crypto.randomUUID()}`;
    database.prepare(`INSERT INTO product_health_records (id,productId,snapshotKey,healthScore,healthStatus,metricsJson,problemsJson,suggestionsJson,createdAt,updatedAt)
      VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(productId,snapshotKey) DO UPDATE SET healthScore=excluded.healthScore,healthStatus=excluded.healthStatus,
      metricsJson=excluded.metricsJson,problemsJson=excluded.problemsJson,suggestionsJson=excluded.suggestionsJson,updatedAt=excluded.updatedAt`)
      .run(id, text(productId), analysis.snapshotKey, result.healthScore, result.healthStatus, JSON.stringify(analysis), JSON.stringify(result.problems), JSON.stringify(result.suggestions), existing?.createdAt ?? timestamp, timestamp);
    const issue = database.prepare(`INSERT INTO product_issues (id,productId,healthRecordId,issueType,title,severity,detailJson,status,createdAt,updatedAt)
      VALUES (?,?,?,?,?,?,?,'open',?,?) ON CONFLICT(healthRecordId,issueType) DO UPDATE SET title=excluded.title,severity=excluded.severity,detailJson=excluded.detailJson,updatedAt=excluded.updatedAt`);
    for (const problem of result.problems) issue.run(`product-issue-${crypto.randomUUID()}`, text(productId), id, problem.type, problem.title, problem.severity, JSON.stringify(problem), timestamp, timestamp);
    return id;
  });
  const id = save(); return parseHealth(database.prepare("SELECT * FROM product_health_records WHERE id=?").get(id));
}

export function getProductV2Detail(productId) {
  const database = getDatabase(); const analysis = getProductBusinessAnalysis(productId);
  const lifecycle = database.prepare("SELECT * FROM product_lifecycle_events WHERE productId=? ORDER BY changedAt DESC").all(text(productId));
  const healthRecords = database.prepare("SELECT * FROM product_health_records WHERE productId=? ORDER BY updatedAt DESC LIMIT 20").all(text(productId)).map(parseHealth);
  const issues = database.prepare("SELECT * FROM product_issues WHERE productId=? ORDER BY updatedAt DESC").all(text(productId)).map((row) => ({ ...row, detail: parseJson(row.detailJson, {}) }));
  const improvements = database.prepare(`SELECT i.*,p.name actionName,p.status actionStatus FROM product_improvements i JOIN process_instances p ON p.id=i.actionId WHERE i.productId=? ORDER BY i.updatedAt DESC`).all(text(productId)).map((row) => ({ ...row, beforeMetrics: parseJson(row.beforeMetricsJson, {}), afterMetrics: parseJson(row.afterMetricsJson, {}) }));
  return { analysis, lifecycle, healthRecords, issues, improvements };
}

export function getProductV2Overview() {
  const database = getDatabase(); const products = database.prepare("SELECT id,name,skuCode,status,mainImage,createdAt,updatedAt FROM products WHERE status<>'已归档'").all();
  const snapshots = database.prepare(`SELECT * FROM (SELECT p.*,f.businessDate,f.id factSnapshotId,ROW_NUMBER() OVER (PARTITION BY p.productId ORDER BY f.businessDate DESC,f.createdAt DESC) position
    FROM product_daily_snapshots p JOIN erp_fact_snapshots f ON f.id=p.snapshotId WHERE f.status='completed') WHERE position<=2`).all();
  const snapshotsByProduct = new Map(); for (const row of snapshots) { const value=snapshotsByProduct.get(row.productId)||{}; value[row.position===1?"current":"previous"]=row; snapshotsByProduct.set(row.productId,value); }
  const financeRows = database.prepare(`SELECT productId,
    SUM(CASE WHEN entryType='income' THEN amount ELSE 0 END) grossIncome,SUM(CASE WHEN entryType='refund' THEN amount ELSE 0 END) refunds,
    SUM(CASE WHEN entryType='cost' THEN amount ELSE 0 END) cost,SUM(CASE WHEN entryType='expense' THEN amount ELSE 0 END) expense
    FROM finance_entries WHERE productId IS NOT NULL AND status IN ('confirmed','approved') GROUP BY productId`).all();
  const financeByProduct = new Map(financeRows.map((row)=>{const revenue=Number(row.grossIncome||0)-Number(row.refunds||0);const grossProfit=revenue-Number(row.cost||0);const netProfit=grossProfit-Number(row.expense||0);return [row.productId,{revenue,refunds:Number(row.refunds||0),cost:Number(row.cost||0),expense:Number(row.expense||0),grossProfit,netProfit,profitMargin:revenue?netProfit/revenue:null}];}));
  const emptyFinance = { revenue:null,refunds:null,cost:null,expense:null,grossProfit:null,netProfit:null,profitMargin:null };
  const items = products.map((product) => { const pair=snapshotsByProduct.get(product.id)||{};const currentSales=number(pair.current?.sales30d);const previousSales=number(pair.previous?.sales30d);const actualStock=number(pair.current?.totalStock);const analysis={ product,snapshotKey:pair.current?.factSnapshotId??null,
    sales:{businessDate:pair.current?.businessDate??null,sales30d:currentSales,previousSales30d:previousSales,growth:ratio(currentSales,previousSales)},
    inventory:{actualStock,turnover:actualStock!==null&&currentSales!==null&&actualStock+currentSales>0?currentSales/(actualStock+currentSales):null,risk:actualStock!==null&&actualStock>0&&(currentSales??0)===0?"积压":actualStock===0?"缺货":"正常"},
    finance:financeByProduct.get(product.id)||emptyFinance,connections:{current:null,previous:null,salesAmountGrowth:null,visitorGrowth:null,conversionChange:null} }; const health=evaluate(analysis);return {...product,analysis,...health}; });
  const lifecycle = Object.fromEntries(productLifecycleStatuses.map((status) => [status, items.filter((item) => item.status === status).length]));
  lifecycle["待归类"] = items.filter((item) => !productLifecycleStatuses.includes(item.status)).length;
  return { total: items.length, lifecycle, growth: items.filter((item) => item.healthStatus === "growth").sort((a,b) => (b.healthScore ?? -1)-(a.healthScore ?? -1)).slice(0,10),
    risks: items.filter((item) => ["attention","risk"].includes(item.healthStatus)).sort((a,b) => (a.healthScore ?? 101)-(b.healthScore ?? 101)).slice(0,10), items };
}

export function changeProductLifecycle(productId, input, userId) {
  const toStatus = text(input?.status); if (!productLifecycleStatuses.includes(toStatus)) throw new Error("产品生命周期状态无效。");
  const database = getDatabase(); const product = database.prepare("SELECT id,status FROM products WHERE id=?").get(text(productId)); if (!product) throw new Error("产品不存在。");
  if (product.status === toStatus) throw new Error("产品已经处于该生命周期状态。"); const timestamp = now();
  return database.transaction(() => { database.prepare("UPDATE products SET status=?,updatedAt=? WHERE id=?").run(toStatus,timestamp,product.id);
    const event = { id:`product-lifecycle-${crypto.randomUUID()}`,productId:product.id,fromStatus:product.status,toStatus,reason:text(input?.reason),changedBy:userId||null,changedAt:timestamp };
    database.prepare("INSERT INTO product_lifecycle_events (id,productId,fromStatus,toStatus,reason,changedBy,changedAt) VALUES (@id,@productId,@fromStatus,@toStatus,@reason,@changedBy,@changedAt)").run(event); return event; })();
}

export function createProductImprovementAction(issueId, input, userId) {
  const database = getDatabase(); const issue = database.prepare("SELECT i.*,p.name productName FROM product_issues i JOIN products p ON p.id=i.productId WHERE i.id=?").get(text(issueId)); if (!issue) throw new Error("产品经营问题不存在。");
  const goal = database.prepare("SELECT id,status FROM goals WHERE id=?").get(text(input?.goalId)); if (!goal || goal.status !== "active") throw new Error("请选择有效目标。");
  const template = database.prepare(`SELECT t.id,t.name,t.defaultProcessTemplateId,p.version FROM task_templates t JOIN process_templates p ON p.id=t.defaultProcessTemplateId WHERE t.id=? AND t.status='active'`).get(text(input?.taskTemplateId));
  if (!template) throw new Error("请选择已绑定标准流程的启用关键行动。"); const title = text(input?.title) || `改善${issue.productName}：${issue.title}`;
  return database.transaction(() => { const timestamp=now(); const instance=createResource("process-instances",{id:`process-instance-${crypto.randomUUID()}`,templateId:template.defaultProcessTemplateId,taskTemplateId:template.id,templateVersion:template.version,name:title,displayTitle:title,goalId:goal.id,initiatorId:text(userId),description:`来源：产品经营问题；产品：${issue.productName}；问题：${issue.title}`,status:"draft",customFields:{source:"product_health",productId:issue.productId,productIssueId:issue.id,healthRecordId:issue.healthRecordId},createdAt:timestamp,updatedAt:timestamp});
    const id=`product-improvement-${crypto.randomUUID()}`; const health=database.prepare("SELECT metricsJson FROM product_health_records WHERE id=?").get(issue.healthRecordId);
    database.prepare(`INSERT INTO product_improvements (id,productId,issueId,actionId,title,status,beforeMetricsJson,afterMetricsJson,createdAt,updatedAt) VALUES (?,?,?,?,?,'planned',?,'{}',?,?)`).run(id,issue.productId,issue.id,instance.id,title,health?.metricsJson||"{}",timestamp,timestamp);
    database.prepare("UPDATE product_issues SET status='improving',updatedAt=? WHERE id=?").run(timestamp,issue.id); return { instance, improvement: database.prepare("SELECT * FROM product_improvements WHERE id=?").get(id) }; })();
}
