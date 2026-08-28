import { getCurrentUser, loadBusinessAnomalies, loadOperationDashboard, loadSalesBusinessDashboard, resolveAssetUrl } from "./appState.js";
import { hasPermission } from "../shared/permissions.js";
import { renderUiModule } from "./uiModuleRegistry.js";
import "./uiModules/salesBusinessDashboard.js";
import "./uiModules/businessAnomalies.js";

let loading = false;
let error = "";
let dashboard = null;
let salesDashboard = null;
let salesDashboardLoading = false;
let salesDashboardError = "";
let initialSalesDashboardTimer = 0;
let salesRange = { preset: "7d", startDate: "", endDate: "" };
const salesDashboardCache = new Map();
let salesDashboardRequestVersion = 0;
let visibleMetricKeys = new Set(["salesAmount", "profitAmount", "profitMargin", "paidPromotionRatio", "dataCoverage"]);
let chartMetric = "salesAmount";
let rankingMetrics = { shop: "salesAmount", link: "salesAmount", product: "salesAmount" };
let rankingModes = { shop: "ranking", link: "ranking", product: "ranking" };
let shopShareSelectedId = "";
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
  if (!points?.length) return `<div class="empty-state compact">经营事实尚未积累</div>`;
  const values = points.map((item) => Number(item.sales30d || 0));
  const max = Math.max(...values, 1);
  return `<div class="operation-trend-bars" aria-label="产品近30天实际出货趋势">${points.map((item) => `<div title="${escapeHtml(item.date)} · ${number(item.sales30d)}"><span style="height:${Math.max(4, (Number(item.sales30d || 0) / max) * 100)}%"></span><small>${escapeHtml(item.date.slice(5))}</small></div>`).join("")}</div>`;
}

export function renderOperationDashboardPage() {
  return `<section class="operation-dashboard operation-dashboard-v2">${renderUiModule("sales_business_dashboard", { state: {
    loading: salesDashboardLoading, error: salesDashboardError, data: salesDashboard, range: salesRange,
    customStartDate: salesRange.startDate, customEndDate: salesRange.endDate, visibleMetricKeys,
    chartMetric, rankingMetrics, rankingModes, shopShareSelectedId,
  }, resolveUrl: resolveAssetUrl })}</section>`;
}

async function refresh(rerender) {
  loading = true; error = ""; rerender();
  try { dashboard = (await loadOperationDashboard()).dashboard; }
  catch (caught) { error = caught.message || "经营驾驶舱读取失败。"; }
  loading = false; rerender();
}

async function refreshSales(rerender, range = salesRange, { renderLoading = true } = {}) {
  const requestedRange = { preset: range.preset || "7d", startDate: range.startDate || "", endDate: range.endDate || "" };
  const cacheKey = [requestedRange.preset, requestedRange.startDate, requestedRange.endDate].join("|");
  const requestVersion = ++salesDashboardRequestVersion;
  salesRange = requestedRange;
  salesDashboardError = "";
  const cachedDashboard = salesDashboardCache.get(cacheKey);
  if (cachedDashboard) {
    salesDashboard = cachedDashboard;
    salesRange = { preset: cachedDashboard.preset, startDate: cachedDashboard.startDate, endDate: cachedDashboard.endDate };
    salesDashboardLoading = false;
    if (renderLoading && document.querySelector(".operation-dashboard") !== null) rerender();
    return;
  }
  salesDashboardLoading = true;
  if (renderLoading) rerender();
  try {
    const nextDashboard = (await loadSalesBusinessDashboard(requestedRange)).dashboard;
    if (requestVersion !== salesDashboardRequestVersion) return;
    salesDashboard = nextDashboard;
    salesDashboardCache.set(cacheKey, nextDashboard);
    salesDashboardCache.set([nextDashboard.preset, nextDashboard.startDate, nextDashboard.endDate].join("|"), nextDashboard);
    salesRange = { preset: nextDashboard.preset, startDate: nextDashboard.startDate, endDate: nextDashboard.endDate };
  }
  catch (caught) {
    if (requestVersion !== salesDashboardRequestVersion) return;
    salesDashboardError = caught.message || "销售经营驾驶舱读取失败。";
  }
  if (requestVersion !== salesDashboardRequestVersion) return;
  salesDashboardLoading = false;
  if (document.querySelector(".operation-dashboard") !== null) rerender();
}

function scheduleInitialSalesDashboard(rerender) {
  if (initialSalesDashboardTimer || salesDashboard || salesDashboardLoading) return;
  initialSalesDashboardTimer = window.setTimeout(() => {
    initialSalesDashboardTimer = 0;
    const route = window.location.hash.replace(/^#/, "").split("/")[0];
    if (!["", "dashboard", "operationDashboard", "operation-dashboard"].includes(route)) return;
    void refreshSales(rerender);
  }, 2_500);
}

async function refreshAnomalies(rerender) {
  anomaliesLoading = true; anomaliesError = ""; rerender();
  try { anomalies = (await loadBusinessAnomalies()).anomalies; }
  catch (caught) { anomaliesError = caught.message || "经营异常读取失败。"; }
  anomaliesLoading = false; rerender();
}

export function bindOperationDashboardPageEvents(rerender) {
  // Only the sales dashboard is rendered on this page. The two legacy reads
  // below used to execute invisibly and occupied the synchronous SQLite API
  // thread after the user had already navigated to another module. Delay the
  // visible dashboard read briefly and start it only while this route remains
  // active, so a direct module switch is never queued behind hidden work.
  scheduleInitialSalesDashboard(rerender);
  document.querySelectorAll("[data-anomaly-select]").forEach((button) => button.addEventListener("click", () => { selectedAnomalyKey = button.dataset.anomalySelect; rerender(); }));
  document.querySelectorAll("[data-launch-anomaly-action]").forEach((button) => button.addEventListener("click", () => {
    if (!hasPermission(getCurrentUser(), "keyActions.launch")) return;
    const item = anomalies?.items?.find((entry) => [entry.anomalyType, entry.objectType, entry.objectId].join("|") === button.dataset.launchAnomalyAction);
    if (!item || !["salesLink", "product", "dataQuality"].includes(item.objectType)) return;
    const sourceContext = { source: "sales_anomaly", objectType: item.objectType, objectId: item.objectId, salesLinkId: item.objectType === "salesLink" ? item.objectId : null, productId: item.objectType === "product" ? item.objectId : null, anomalySnapshot: { anomalyType: item.anomalyType, metric: item.anomalyType === "profit_drop" ? "profitAmount" : "salesAmount", severity: item.severity, currentPeriod: item.currentPeriod, comparePeriod: item.comparePeriod, currentValue: item.currentValue, compareValue: item.compareValue, changeRate: item.changeRate, trendSummary: item.trendSummary || null }, baselineSnapshot: item.baselineSnapshot || null, recommendedActionStandard: item.recommendedActionStandard, recommendedActionTemplate: item.recommendedActionTemplate };
    window.sessionStorage.setItem("goalTaskPrefill", JSON.stringify({ title: "发起关键行动", launchImmediately: false, taskTemplateId: item.recommendedActionStandard?.actionStandardId || "", recommendedActionStandard: item.recommendedActionStandard, recommendedActionTemplate: item.recommendedActionTemplate, actionTitle: item.recommendedActionStandard?.name || `处理${item.objectName || "经营对象"}`, description: "来源：销售经营异常。请人工分析原因并明确行动方案。", sourceContext }));
    window.location.hash = "goals";
  }));
  document.querySelectorAll("[data-anomaly-object]").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.anomalyObject === "product") window.location.hash = `products/${button.dataset.anomalyId}`;
    else if (button.dataset.anomalyObject === "salesLink") window.location.hash = `connectionCenter/${encodeURIComponent(button.dataset.anomalyId)}`;
    else window.location.hash = "connectionCenter/data_update";
  }));
  document.querySelectorAll("[data-sales-dashboard-target]").forEach((button) => button.addEventListener("click", () => { window.location.hash = button.dataset.salesDashboardTarget; }));
  document.querySelectorAll("[data-sales-range]").forEach((button) => button.addEventListener("click", () => {
    const preset = button.dataset.salesRange;
    if (preset === "custom") {
      salesRange = { preset: "custom", startDate: salesDashboard?.startDate || "", endDate: salesDashboard?.endDate || "" };
      rerender();
    } else void refreshSales(rerender, { preset, startDate: "", endDate: "" });
  }));
  document.querySelector("[data-sales-custom-apply]")?.addEventListener("click", () => {
    const startDate = document.querySelector("[data-sales-custom-start]")?.value || "";
    const endDate = document.querySelector("[data-sales-custom-end]")?.value || "";
    void refreshSales(rerender, { preset: "custom", startDate, endDate });
  });
  document.querySelectorAll("[data-sales-metric-field]").forEach((checkbox) => checkbox.addEventListener("change", () => {
    if (checkbox.checked) visibleMetricKeys.add(checkbox.dataset.salesMetricField);
    else if (visibleMetricKeys.size > 1) visibleMetricKeys.delete(checkbox.dataset.salesMetricField);
    rerender();
  }));
  document.querySelectorAll("[data-sales-chart-metric]").forEach((button) => button.addEventListener("click", () => { chartMetric = button.dataset.salesChartMetric; rerender(); }));
  document.querySelectorAll("[data-sales-ranking-metric]").forEach((button) => button.addEventListener("click", () => {
    const dimension = button.dataset.salesRankingDimension;
    if (dimension) rankingMetrics = { ...rankingMetrics, [dimension]: button.dataset.salesRankingMetric };
    rerender();
  }));
  document.querySelectorAll("[data-sales-ranking-mode]").forEach((button) => button.addEventListener("click", () => {
    const dimension = button.dataset.salesRankingDimension;
    if (dimension) rankingModes = { ...rankingModes, [dimension]: button.dataset.salesRankingMode };
    rerender();
  }));
  document.querySelectorAll("[data-sales-shop-share]").forEach((slice) => {
    const selectShop = () => { shopShareSelectedId = slice.dataset.salesShopShare || ""; rerender(); };
    slice.addEventListener("click", selectShop);
    slice.addEventListener("keydown", (event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); selectShop(); } });
  });
  document.querySelectorAll("[data-operation-target]").forEach((button) => button.addEventListener("click", () => { window.location.hash = button.dataset.operationTarget; }));
  document.querySelector("[data-action='refresh-operation-dashboard']")?.addEventListener("click", () => refresh(rerender));
}
