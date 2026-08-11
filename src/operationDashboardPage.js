import { getCurrentUser, loadBusinessAnomalies, loadOperationDashboard, loadSalesBusinessDashboard } from "./appState.js";
import { hasPermission } from "./permissions.js";
import { renderUiModule } from "./uiModuleRegistry.js";
import "./uiModules/salesBusinessDashboard.js?v=20260811-sales-business-dashboard1";
import "./uiModules/businessAnomalies.js?v=20260811-business-anomalies1";

let loading = false;
let error = "";
let dashboard = null;
let salesDashboard = null;
let salesDashboardLoading = false;
let salesDashboardError = "";
let salesPreset = "30d";
let anomalies = null;
let anomaliesLoading = false;
let anomaliesError = "";
let selectedAnomalyKey = "";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
}

function number(value, digits = 0) {
  return value === null || value === undefined ? "—" : Number(value).toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

function money(value) {
  return value === null || value === undefined ? "—" : `¥${number(value, 2)}`;
}

function percent(value) {
  if (value === null || value === undefined) return "—";
  const amount = Number(value) * 100;
  return `${amount > 0 ? "+" : ""}${amount.toFixed(1)}%`;
}

function ranking(items, kind, emptyText) {
  if (!items?.length) return `<div class="empty-state compact">${escapeHtml(emptyText)}</div>`;
  return `<ol class="operation-ranking">${items.map((item, index) => {
    const name = item.productName || item.name || "未命名";
    const code = item.skuCode || item.platform || "";
    const value = kind === "sales" ? (item.currentPeriod ? money(item.currentPeriod.payAmount) : number(item.sales30d)) : percent(item.salesGrowth);
    const target = item.productId ? `products/${encodeURIComponent(item.productId)}` : item.connectionId ? "connectionCenter" : "";
    return `<li><span>${index + 1}</span><button type="button" data-operation-target="${escapeHtml(target)}"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(code)}</small></button><em>${value}</em></li>`;
  }).join("")}</ol>`;
}

function trendBars(points) {
  if (!points?.length) return `<div class="empty-state compact">经营快照尚未积累</div>`;
  const values = points.map((item) => Number(item.sales30d || 0));
  const max = Math.max(...values, 1);
  return `<div class="operation-trend-bars" aria-label="产品近30天销量趋势">${points.map((item) => `<div title="${escapeHtml(item.date)} · ${number(item.sales30d)}"><span style="height:${Math.max(4, (Number(item.sales30d || 0) / max) * 100)}%"></span><small>${escapeHtml(item.date.slice(5))}</small></div>`).join("")}</div>`;
}

export function renderOperationDashboardPage() {
  if (loading && !dashboard) return `<section class="operation-dashboard"><div class="form-note">正在汇总经营事实…</div></section>`;
  if (error && !dashboard) return `<section class="operation-dashboard"><div class="form-error">${escapeHtml(error)}</div><button class="secondary-button" data-action="refresh-operation-dashboard">重新加载</button></section>`;
  if (!dashboard) return `<section class="operation-dashboard"><div class="form-note">准备经营驾驶舱…</div></section>`;
  const products = dashboard.company.products;
  const connections = dashboard.company.connections;
  const execution = dashboard.execution;
  const improvements = dashboard.improvements.summary || dashboard.improvements;
  return `<section class="operation-dashboard">
    <div class="operation-hero"><div><p class="eyebrow">经营管理基础 V2.0</p><h1>经营驾驶舱</h1><p>统一查看经营事实、风险和改善执行。所有指标来自现有正式快照，不补造利润或缺失数据。</p></div><button class="secondary-button" data-action="refresh-operation-dashboard">刷新数据</button></div>
    ${renderUiModule("sales_business_dashboard", { state: { loading: salesDashboardLoading, error: salesDashboardError, data: salesDashboard } })}
    ${renderUiModule("business_anomalies", { state: { loading: anomaliesLoading, error: anomaliesError, data: anomalies, selectedKey: selectedAnomalyKey, canLaunch: hasPermission(getCurrentUser(), "workPlans.launch") } })}
    <div class="operation-metric-grid">
      <article><span>产品近30天销量</span><strong>${number(products.sales30d)}</strong><em class="${products.salesGrowth < 0 ? "is-risk" : ""}">${percent(products.salesGrowth)}</em><small>业务日期 ${escapeHtml(products.latestBusinessDate || "—")}</small></article>
      <article><span>库存资金占用</span><strong>${money(products.capitalOccupation)}</strong><em>${number(products.actualStock)} 件实际库存</em><small>成本完整率 ${percent(products.capitalCoverage)}</small></article>
      <article><span>连接周期销售额</span><strong>${money(connections.payAmount)}</strong><em>${number(connections.connectionCount)} 条有经营数据连接</em><small>${connections.periodStart ? `${escapeHtml(connections.periodStart)}—${escapeHtml(connections.periodEnd)}` : "暂无周期数据"}</small></article>
      <article><span>经营风险</span><strong>${dashboard.company.risks.connectionRisk + dashboard.company.risks.connectionAttention}</strong><em class="is-risk">风险 ${dashboard.company.risks.connectionRisk} · 关注 ${dashboard.company.risks.connectionAttention}</em><small>下滑产品 ${dashboard.company.risks.decliningProducts}</small></article>
    </div>
    <div class="operation-layout">
      <article class="operation-panel operation-wide"><header><div><h2>公司经营趋势</h2><p>产品正式ERP快照中的sales30d汇总</p></div><button data-operation-target="dataCenter" class="text-button">进入数据中心</button></header>${trendBars(dashboard.trend)}</article>
      <article class="operation-panel"><header><div><h2>产品销售排行</h2><p>最新正式快照</p></div></header>${ranking(dashboard.products.salesTop, "sales", "暂无产品销售事实")}</article>
      <article class="operation-panel"><header><div><h2>成长产品</h2><p>相邻正式快照变化</p></div></header>${ranking(dashboard.products.growthTop, "growth", "暂无可比产品周期")}</article>
      <article class="operation-panel"><header><div><h2>高增长连接</h2><p>最新两个经营周期</p></div><button data-operation-target="connectionCenter" class="text-button">进入连接中心</button></header>${ranking(dashboard.connections.topGrowth, "growth", "至少需要两个连接经营周期")}</article>
      <article class="operation-panel"><header><div><h2>风险连接</h2><p>健康分低于60</p></div></header>${ranking(dashboard.connections.risks, "growth", "当前没有风险连接")}</article>
    </div>
    <div class="operation-execution">
      <article><span>重点目标</span><strong>${execution.activeGoals}</strong><button data-operation-target="goals">查看目标</button></article>
      <article><span>执行中关键行动</span><strong>${execution.runningActions}</strong><button data-operation-target="scheduleBoard">查看行动</button></article>
      <article><span>进行中任务</span><strong>${execution.doingTasks}</strong><button data-operation-target="tasks">查看任务</button></article>
      <article><span>逾期未完成任务</span><strong>${execution.overdueTasks}</strong><button data-operation-target="tasks">立即处理</button></article>
      <article><span>改善项目</span><strong>${improvements.total || 0}</strong><small>有效 ${improvements.effective || 0} · 观察 ${improvements.observing || 0}</small></article>
    </div>
    <details class="operation-definitions"><summary>经营指标口径</summary><div>${Object.values(dashboard.definitions).map((definition) => `<article><strong>${escapeHtml(definition.label)}</strong><span>${escapeHtml(definition.aggregation)}</span><small>来源：${escapeHtml(definition.source)}</small></article>`).join("")}</div></details>
    <div class="data-center-notice"><strong>利润指标尚未启用</strong><p>${escapeHtml(dashboard.finance.message)}</p></div>
  </section>`;
}

async function refresh(rerender) {
  loading = true; error = ""; rerender();
  try { dashboard = (await loadOperationDashboard()).dashboard; }
  catch (caught) { error = caught.message || "经营驾驶舱读取失败。"; }
  loading = false; rerender();
}

async function refreshSales(rerender, preset = salesPreset) {
  salesPreset = preset; salesDashboardLoading = true; salesDashboardError = ""; rerender();
  try { salesDashboard = (await loadSalesBusinessDashboard(preset)).dashboard; }
  catch (caught) { salesDashboardError = caught.message || "销售经营驾驶舱读取失败。"; }
  salesDashboardLoading = false; rerender();
}

async function refreshAnomalies(rerender) {
  anomaliesLoading = true; anomaliesError = ""; rerender();
  try { anomalies = (await loadBusinessAnomalies()).anomalies; }
  catch (caught) { anomaliesError = caught.message || "经营异常读取失败。"; }
  anomaliesLoading = false; rerender();
}

export function bindOperationDashboardPageEvents(rerender) {
  if (!dashboard && !loading) refresh(rerender);
  if (!salesDashboard && !salesDashboardLoading) refreshSales(rerender);
  if (!anomalies && !anomaliesLoading) refreshAnomalies(rerender);
  document.querySelectorAll("[data-anomaly-select]").forEach((button) => button.addEventListener("click", () => { selectedAnomalyKey = button.dataset.anomalySelect; rerender(); }));
  document.querySelectorAll("[data-launch-anomaly-action]").forEach((button) => button.addEventListener("click", () => {
    if (!hasPermission(getCurrentUser(), "workPlans.launch")) return;
    const item = anomalies?.items?.find((entry) => [entry.anomalyType, entry.objectType, entry.objectId].join("|") === button.dataset.launchAnomalyAction);
    if (!item || !["salesLink", "product", "dataQuality"].includes(item.objectType)) return;
    const sourceContext = { source: "sales_anomaly", objectType: item.objectType, objectId: item.objectId, salesLinkId: item.objectType === "salesLink" ? item.objectId : null, productId: item.objectType === "product" ? item.objectId : null, anomalySnapshot: { anomalyType: item.anomalyType, metric: item.anomalyType === "profit_drop" ? "profitAmount" : "salesAmount", severity: item.severity, currentPeriod: item.currentPeriod, comparePeriod: item.comparePeriod, currentValue: item.currentValue, compareValue: item.compareValue, changeRate: item.changeRate, trendSummary: item.trendSummary || null }, baselineSnapshot: item.baselineSnapshot || null, recommendedActionTemplate: item.recommendedActionTemplate };
    window.sessionStorage.setItem("goalTaskPrefill", JSON.stringify({ title: "发起关键行动", launchImmediately: false, recommendedActionTemplate: item.recommendedActionTemplate, actionTitle: item.recommendedActionTemplate?.name || `处理${item.objectName || "经营对象"}`, description: "来源：销售经营异常。请人工分析原因并明确行动方案。", sourceContext }));
    window.location.hash = "goals";
  }));
  document.querySelectorAll("[data-anomaly-object]").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.anomalyObject === "product") window.location.hash = `products/${button.dataset.anomalyId}`;
    else if (button.dataset.anomalyObject === "salesLink") window.location.hash = `connectionCenter/${encodeURIComponent(button.dataset.anomalyId)}`;
    else window.location.hash = "connectionCenter/data_update";
  }));
  document.querySelectorAll("[data-sales-dashboard-target]").forEach((button) => button.addEventListener("click", () => { window.location.hash = button.dataset.salesDashboardTarget; }));
  document.querySelectorAll("[data-sales-range]").forEach((button) => button.addEventListener("click", () => refreshSales(rerender, button.dataset.salesRange)));
  document.querySelectorAll("[data-operation-target]").forEach((button) => button.addEventListener("click", () => { window.location.hash = button.dataset.operationTarget; }));
  document.querySelector("[data-action='refresh-operation-dashboard']")?.addEventListener("click", () => refresh(rerender));
}
