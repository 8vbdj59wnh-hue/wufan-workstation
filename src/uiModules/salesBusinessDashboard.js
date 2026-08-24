import { registerUiModule } from "../uiModuleRegistry.js";
import { escapeHtml } from "../utils/html.js";

const PRESETS = [["yesterday", "昨日"], ["7d", "近7天"], ["15d", "近15天"], ["30d", "近30天"], ["45d", "近45天"], ["60d", "近60天"], ["custom", "自定义"]];
const METRICS = [
  { key: "salesAmount", label: "实际销售额", type: "money", note: "已确认销售日报" },
  { key: "profitAmount", label: "毛利", type: "money", note: "销售额－确认成本" },
  { key: "profitMargin", label: "毛利率", type: "percent", note: "毛利 ÷ 实际销售额" },
  { key: "paidPromotionRatio", label: "付费推广占比", type: "percent", note: "推广费 ÷ 实际销售额" },
  { key: "dataCoverage", label: "数据覆盖率", type: "percent", note: "有数据天数 ÷ 周期天数" },
  { key: "quantity", label: "销量", type: "number", note: "日报确认销量" },
  { key: "costAmount", label: "商品成本", type: "money", note: "日报确认成本" },
  { key: "refundAmount", label: "退款金额", type: "money", note: "日报退款汇总" },
  { key: "feeAmount", label: "平台费用", type: "money", note: "日报费用汇总" },
  { key: "receivedAmount", label: "已收金额", type: "money", note: "日报实收汇总" },
  { key: "incomeAmount", label: "收入", type: "money", note: "日报收入汇总" },
];
const DEFAULT_METRICS = new Set(["salesAmount", "profitAmount", "profitMargin", "paidPromotionRatio", "dataCoverage"]);
const DIMENSIONS = { shop: "店铺", link: "链接", product: "产品" };

const money = (value) => value === null || value === undefined ? "—" : `¥${Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
const number = (value) => value === null || value === undefined ? "—" : Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const percent = (value) => value === null || value === undefined ? "—" : `${(Number(value) * 100).toFixed(1)}%`;
const compactMoney = (value) => {
  if (value === null || value === undefined) return "—";
  const amount = Number(value);
  if (Math.abs(amount) >= 10000) return `¥${(amount / 10000).toFixed(Math.abs(amount) >= 100000 ? 1 : 2)}万`;
  return `¥${amount.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
};

function growthText(value, status = "comparable") {
  if (status === "new") return "新增";
  if (value === null || value === undefined) return "不可比";
  const amount = Number(value) * 100;
  return `${amount > 0 ? "+" : ""}${amount.toFixed(1)}%`;
}

function growthClass(value, status = "comparable") {
  if (status === "new" || Number(value) > 0) return "is-up";
  if (Number(value) < 0) return "is-down";
  return "is-flat";
}

function metricValue(summary, metric) {
  if (metric.key === "paidPromotionRatio" && summary.paidPromotionRatio === null) return "未接入";
  if (metric.type === "money") return money(summary[metric.key]);
  if (metric.type === "percent") return percent(summary[metric.key]);
  return number(summary[metric.key]);
}

function metricComparison(data, metric) {
  if (metric.key === "salesAmount") return { value: data.summaryComparison.salesGrowth, status: data.summaryComparison.salesComparisonStatus };
  if (metric.key === "profitAmount") return { value: data.summaryComparison.profitGrowth, status: data.summaryComparison.profitComparisonStatus };
  if (metric.key === "profitMargin") return { value: data.summary.profitMargin === null || data.previousSummary.profitMargin === null ? null : data.summary.profitMargin - data.previousSummary.profitMargin, point: true };
  return null;
}

function renderMetrics(data, visibleMetricKeys) {
  const visible = METRICS.filter((metric) => visibleMetricKeys.has(metric.key));
  return `<div class="sales-business-metrics sales-business-metrics-v2">${visible.map((metric) => {
    const comparison = metricComparison(data, metric);
    const unavailable = metric.key === "paidPromotionRatio" && data.summary.paidPromotionRatio === null;
    const compareText = comparison?.point ? `${Number(comparison.value || 0) >= 0 ? "+" : ""}${(Number(comparison.value || 0) * 100).toFixed(1)}个百分点` : comparison ? growthText(comparison.value, comparison.status) : "";
    return `<article class="${unavailable ? "is-unavailable" : ""}"><div><span>${escapeHtml(metric.label)}</span>${comparison ? `<em class="${growthClass(comparison.value, comparison.status)}">${escapeHtml(compareText)}</em>` : ""}</div><strong>${escapeHtml(metricValue(data.summary, metric))}</strong><small>${unavailable ? escapeHtml(data.metricAvailability?.paidPromotionAmount?.reason || "暂无数据") : escapeHtml(metric.note)}</small></article>`;
  }).join("")}</div>`;
}

function comparisonFields(metric) {
  return metric === "profitAmount"
    ? { current: "currentProfitAmount", previous: "compareProfitAmount", growth: "profitGrowth", status: "profitComparisonStatus", label: "毛利" }
    : { current: "currentSalesAmount", previous: "compareSalesAmount", growth: "salesGrowth", status: "salesComparisonStatus", label: "销售额" };
}

const SHOP_SHARE_COLORS = ["#157a5b", "#2e90fa", "#f79009", "#7f56d9", "#e04f67", "#0e9384", "#ee46bc", "#6172f3", "#84ad36", "#f04438", "#4e5ba6", "#dc6803"];

function shopSharePoint(ratio, radius = 116) {
  const angle = ratio * Math.PI * 2 - Math.PI / 2;
  return [140 + Math.cos(angle) * radius, 140 + Math.sin(angle) * radius];
}

function shopShareSector(start, end, color, item, fields, selected) {
  const middleAngle = ((start + end) / 2) * Math.PI * 2 - Math.PI / 2;
  const transform = selected ? `translate(${(Math.cos(middleAngle) * 8).toFixed(3)} ${(Math.sin(middleAngle) * 8).toFixed(3)})` : "";
  const share = end - start;
  const [labelX, labelY] = shopSharePoint((start + end) / 2, share >= 0.1 ? 78 : 91);
  const label = share >= 0.035 ? `<text class="shop-share-label" x="${labelX.toFixed(3)}" y="${labelY.toFixed(3)}" font-size="${share >= 0.1 ? 7.5 : 6.2}">${(share * 100).toFixed(1)}%</text>` : "";
  const interaction = `class="shop-share-slice${selected ? " is-selected" : ""}" data-sales-shop-share="${escapeHtml(item.targetId)}" tabindex="0" role="button" aria-label="查看${escapeHtml(item.targetName || "未命名店铺")}业绩" transform="${transform}"`;
  const title = `<title>${escapeHtml(item.targetName || "未命名店铺")}：${escapeHtml(fields.label)} ${money(item[fields.current])}</title>`;
  if (share >= 0.999999) return `<g ${interaction}>${title}<circle cx="140" cy="140" r="116" fill="${color}" />${label}</g>`;
  const [startX, startY] = shopSharePoint(start); const [endX, endY] = shopSharePoint(end);
  return `<g ${interaction}>${title}<path d="M 140 140 L ${startX.toFixed(3)} ${startY.toFixed(3)} A 116 116 0 ${share > 0.5 ? 1 : 0} 1 ${endX.toFixed(3)} ${endY.toFixed(3)} Z" fill="${color}" stroke="#fff" stroke-width="1.5" />${label}</g>`;
}

function renderShopShareChart(data, metric, selectedId) {
  const fields = comparisonFields(metric);
  const shops = [...(data.rankings?.shop?.items || [])].map((item) => ({ ...item, shareValue: Number(item[fields.current] || 0) }))
    .sort((left, right) => Math.max(0, right.shareValue) - Math.max(0, left.shareValue));
  const shareTotal = shops.reduce((sum, item) => sum + Math.max(0, item.shareValue), 0);
  const netTotal = shops.reduce((sum, item) => sum + item.shareValue, 0);
  if (!shops.length || shareTotal <= 0) return `<section class="sales-shop-share"><div class="empty-state compact">当前周期暂无可展示的${escapeHtml(fields.label)}占比数据</div></section>`;
  const selectedShop = shops.find((item) => item.targetId === selectedId) || null;
  let consumed = 0;
  const sectors = shops.filter((item) => item.shareValue > 0).map((item, index) => {
    const start = consumed / shareTotal; consumed += item.shareValue; const end = consumed / shareTotal;
    return shopShareSector(start, end, SHOP_SHARE_COLORS[index % SHOP_SHARE_COLORS.length], item, fields, item.targetId === selectedShop?.targetId);
  }).join("");
  const selectedShare = selectedShop ? Math.max(0, selectedShop.shareValue) / shareTotal : 0;
  return `<section class="sales-shop-share"><header><strong>店铺业绩占比</strong><small>按当前统一时间范围统计${metric === "profitAmount" ? " · 亏损店铺不计入正向占比" : ""}</small></header><div class="sales-shop-share-content"><div class="shop-share-visual"><svg class="shop-share-pie sales-shop-share-pie" viewBox="0 0 280 280" role="img" aria-label="各店铺${escapeHtml(fields.label)}占比">${sectors}</svg><div><span>${escapeHtml(fields.label)}合计</span><strong>${money(netTotal)}</strong></div></div>${selectedShop ? `<article class="sales-shop-share-detail"><div><strong>${escapeHtml(selectedShop.targetName || "未命名店铺")}</strong><small>${escapeHtml(selectedShop.targetCode || "")}</small></div><span><small>当前${escapeHtml(fields.label)}</small><strong>${money(selectedShop[fields.current])}</strong></span><span><small>占比</small><strong>${percent(selectedShare)}</strong></span><em class="${growthClass(selectedShop[fields.growth], selectedShop[fields.status])}">${growthText(selectedShop[fields.growth], selectedShop[fields.status])}</em></article>` : `<div class="shop-share-selection-hint">点击饼图扇区查看店铺经营数据</div>`}</div></section>`;
}

function renderShopChart(data, metric) {
  const fields = comparisonFields(metric);
  const items = [...(data.shops?.items || [])].sort((left, right) => Number(right[fields.current] || 0) - Number(left[fields.current] || 0)).slice(0, 12);
  if (!items.length) return `<div class="empty-state compact">所选周期暂无店铺经营数据</div>`;
  const max = Math.max(1, ...items.flatMap((item) => [Math.abs(Number(item[fields.current] || 0)), Math.abs(Number(item[fields.previous] || 0))]));
  return `<div class="shop-performance-chart shop-performance-chart-vertical" role="img" aria-label="店铺${escapeHtml(fields.label)}竖向柱形图，从高到低排列并对比上周期"><div class="shop-performance-legend"><span class="is-current">当前周期</span><span class="is-previous">上周期</span></div><div class="shop-performance-columns">${items.map((item, index) => {
    const currentValue = Number(item[fields.current] || 0); const previousValue = Number(item[fields.previous] || 0);
    const currentHeight = Math.max(2, Math.abs(currentValue) / max * 100); const previousHeight = Math.max(2, Math.abs(previousValue) / max * 100);
    return `<div class="shop-performance-column"><em class="${growthClass(item[fields.growth], item[fields.status])}">${growthText(item[fields.growth], item[fields.status])}</em><div class="shop-performance-vertical-bars"><div class="shop-performance-vertical-bar is-current ${currentValue < 0 ? "is-negative" : ""}" title="当前周期 ${money(currentValue)}"><span style="bottom:calc(${currentHeight}% + 4px)">${compactMoney(currentValue)}</span><i style="height:${currentHeight}%"></i></div><div class="shop-performance-vertical-bar is-previous ${previousValue < 0 ? "is-negative" : ""}" title="上周期 ${money(previousValue)}"><span style="bottom:calc(${previousHeight}% + 4px)">${compactMoney(previousValue)}</span><i style="height:${previousHeight}%"></i></div></div><div class="shop-performance-column-name"><span>${index + 1}</span><strong title="${escapeHtml(item.targetName)}">${escapeHtml(item.targetName)}</strong><small>${escapeHtml(item.targetCode || "")}</small></div></div>`;
  }).join("")}</div></div>`;
}

function rankedItems(data, dimension, mode, metric) {
  const fields = comparisonFields(metric); const items = [...(data.rankings?.[dimension]?.items || [])];
  if (mode === "surge") return items.filter((item) => item[fields.status] === "comparable" && Number.isFinite(Number(item[fields.growth])))
    .sort((left, right) => Number(right[fields.growth]) - Number(left[fields.growth]) || Number(right[fields.current]) - Number(left[fields.current])).slice(0, 30);
  return items.sort((left, right) => Number(right[fields.current] || 0) - Number(left[fields.current] || 0)).slice(0, 30);
}

function rankingTarget(item, dimension) {
  if (dimension === "product") return `products/${encodeURIComponent(item.targetId)}`;
  if (dimension === "link") return `connectionCenter/${encodeURIComponent(item.targetId)}`;
  return "connectionCenter";
}

function renderRankingImage(item, dimension, resolveUrl) {
  if (dimension === "shop") return "";
  const alt = `${item.targetName || DIMENSIONS[dimension]}主图`;
  if (!item.mainImage) return "";
  return `<img class="sales-ranking-image" src="${escapeHtml(resolveUrl(item.mainImage))}" alt="${escapeHtml(alt)}" loading="lazy" onerror="this.closest('button')?.classList.remove('has-ranking-image');this.closest('li')?.classList.remove('has-ranking-image');this.remove()">`;
}

function renderRanking(data, dimension, mode, metric, resolveUrl) {
  const fields = comparisonFields(metric); const items = rankedItems(data, dimension, mode, metric);
  if (!items.length) return `<div class="empty-state compact">所选周期暂无可比的${escapeHtml(DIMENSIONS[dimension])}数据</div>`;
  return `<ol class="sales-business-ranking sales-business-ranking-v2">${items.map((item, index) => {
    const hasImage = dimension !== "shop" && Boolean(item.mainImage);
    return `<li class="${hasImage ? "has-ranking-image" : ""}"><span class="rank-number">${index + 1}</span><button type="button" data-sales-dashboard-target="${escapeHtml(rankingTarget(item, dimension))}" class="${hasImage ? "has-ranking-image" : ""}">${renderRankingImage(item, dimension, resolveUrl)}<span class="ranking-copy"><strong>${escapeHtml(item.targetName || "未命名")}</strong><small>${escapeHtml(item.targetCode || "")}</small></span></button><div class="ranking-value"><strong>${money(item[fields.current])}</strong><small>上周期 ${money(item[fields.previous])}</small></div><em class="${growthClass(item[fields.growth], item[fields.status])}">${growthText(item[fields.growth], item[fields.status])}</em></li>`;
  }).join("")}</ol>`;
}

function renderRankingPanel(data, dimension, mode, metric, resolveUrl, shopShareSelectedId = "") {
  const label = DIMENSIONS[dimension];
  return `<article class="sales-business-panel sales-business-rank-panel sales-business-rank-card" data-ranking-dimension="${dimension}">
    <header><div><h3>${escapeHtml(label)}榜单</h3><p>${mode === "surge" ? "按较上周期增长百分比排序" : `按当前周期${metric === "profitAmount" ? "毛利" : "销售额"}排序`}</p></div><div class="segmented-control"><button type="button" data-sales-ranking-metric="salesAmount" data-sales-ranking-dimension="${dimension}" class="${metric === "salesAmount" ? "active" : ""}">销售额</button><button type="button" data-sales-ranking-metric="profitAmount" data-sales-ranking-dimension="${dimension}" class="${metric === "profitAmount" ? "active" : ""}">毛利</button></div></header>
    ${dimension === "shop" ? renderShopShareChart(data, metric, shopShareSelectedId) : ""}
    <div class="sales-business-rank-toolbar"><strong>${escapeHtml(label)} TOP 30</strong><div class="sales-business-mode-tabs"><button type="button" data-sales-ranking-mode="ranking" data-sales-ranking-dimension="${dimension}" class="${mode === "ranking" ? "is-active" : ""}">排行榜</button><button type="button" data-sales-ranking-mode="surge" data-sales-ranking-dimension="${dimension}" class="${mode === "surge" ? "is-active" : ""}">飙升榜</button></div></div>
    ${renderRanking(data, dimension, mode, metric, resolveUrl)}
  </article>`;
}

function renderMetricPicker(visibleMetricKeys) {
  return `<details class="sales-business-metric-picker"><summary>更多数据字段 <span>${visibleMetricKeys.size}</span></summary><div>${METRICS.map((metric) => `<label><input type="checkbox" data-sales-metric-field="${metric.key}" ${visibleMetricKeys.has(metric.key) ? "checked" : ""}><span>${escapeHtml(metric.label)}</span></label>`).join("")}</div></details>`;
}

export function renderSalesBusinessDashboard({ state = {}, resolveUrl = (value) => value } = {}) {
  if (state.loading && !state.data) return `<section class="sales-business-dashboard sales-business-dashboard-v2"><div class="empty-state compact">正在汇总经营数据…</div></section>`;
  if (state.error && !state.data) return `<section class="sales-business-dashboard sales-business-dashboard-v2"><div class="empty-state compact"><strong>经营数据暂不可用</strong><p>${escapeHtml(state.error)}</p></div></section>`;
  const data = state.data;
  if (!data?.hasData) return `<section class="sales-business-dashboard sales-business-dashboard-v2"><header><div><p class="eyebrow">经营事实</p></div></header><div class="empty-state compact">所选周期暂无已确认销售日报事实</div></section>`;
  const visibleMetricKeys = state.visibleMetricKeys instanceof Set ? state.visibleMetricKeys : DEFAULT_METRICS;
  const chartMetric = state.chartMetric === "profitAmount" ? "profitAmount" : "salesAmount";
  const rankingMetrics = Object.fromEntries(Object.keys(DIMENSIONS).map((dimension) => [dimension, state.rankingMetrics?.[dimension] === "profitAmount" ? "profitAmount" : "salesAmount"]));
  const rankingModes = Object.fromEntries(Object.keys(DIMENSIONS).map((dimension) => [dimension, state.rankingModes?.[dimension] === "surge" ? "surge" : "ranking"]));
  const shopShareSelectedId = String(state.shopShareSelectedId || "");
  const activePreset = state.range?.preset || data.preset;
  return `<section class="sales-business-dashboard sales-business-dashboard-v2" data-module-key="sales_business_dashboard">
    <div class="sales-business-control-row"><div class="sales-business-range sales-business-range-v2" aria-label="全页统计周期">${PRESETS.map(([value, label]) => `<button type="button" data-sales-range="${value}" class="${activePreset === value ? "is-active" : ""}">${label}</button>`).join("")}</div><header class="sales-business-head"><div class="sales-business-period-summary"><p class="eyebrow">经营事实 · 更新至 ${escapeHtml(data.endDate)}</p><p>当前周期 ${escapeHtml(data.startDate)} 至 ${escapeHtml(data.endDate)} · 上周期 ${escapeHtml(data.previousStartDate)} 至 ${escapeHtml(data.previousEndDate)}</p></div><div class="sales-business-head-actions">${renderMetricPicker(visibleMetricKeys)}</div></header></div>
    ${activePreset === "custom" ? `<div class="sales-business-custom-range"><label>开始日期<input type="date" data-sales-custom-start value="${escapeHtml(state.customStartDate || data.startDate)}" max="${escapeHtml(data.endDate)}"></label><span>至</span><label>结束日期<input type="date" data-sales-custom-end value="${escapeHtml(state.customEndDate || data.endDate)}" max="${escapeHtml(data.endDate)}"></label><button type="button" class="primary-button" data-sales-custom-apply>应用</button></div>` : ""}
    ${state.error ? `<div class="form-error">${escapeHtml(state.error)}</div>` : ""}
    ${renderMetrics(data, visibleMetricKeys)}
    <article class="sales-business-panel sales-business-shop-panel"><header><div><h3>店铺业绩对比</h3><p>按当前周期从高到低排列，灰色为上一同长度周期</p></div><div class="segmented-control"><button type="button" data-sales-chart-metric="salesAmount" class="${chartMetric === "salesAmount" ? "active" : ""}">销售额</button><button type="button" data-sales-chart-metric="profitAmount" class="${chartMetric === "profitAmount" ? "active" : ""}">毛利</button></div></header>${renderShopChart(data, chartMetric)}</article>
    <section class="sales-business-rank-section" aria-labelledby="sales-business-rank-title"><header><div><h3 id="sales-business-rank-title">经营榜单</h3><p>店铺、链接和产品独立展示；排行榜看规模，飙升榜看较上周期增长百分比</p></div></header><div class="sales-business-rank-grid">${Object.keys(DIMENSIONS).map((dimension) => renderRankingPanel(data, dimension, rankingModes[dimension], rankingMetrics[dimension], resolveUrl, shopShareSelectedId)).join("")}</div></section>
    <footer class="sales-business-foot"><span>数据覆盖 ${data.summary.dataDays}/${data.windowDays} 天</span><span>共 ${number(data.summary.dataCount)} 条经营事实</span><span>付费推广费用尚未接入，相关占比不做推算</span></footer>
  </section>`;
}

registerUiModule({ moduleKey: "sales_business_dashboard", name: "SalesBusinessDashboard", domain: "dashboard", description: "统一周期经营指标、店铺业绩对比及店铺/链接/产品排行榜与飙升榜。", dependencies: ["QueryDailySalesSummaryComparison", "QueryDailySalesTrend", "QuerySalesDailyDataQuality"], configSchema: {}, render: renderSalesBusinessDashboard });
