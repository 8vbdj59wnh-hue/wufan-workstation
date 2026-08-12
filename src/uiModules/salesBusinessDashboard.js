import { registerUiModule } from "../uiModuleRegistry.js";
import { escapeHtml } from "../utils/html.js";

const amount = (value) => value === null || value === undefined ? "暂无数据" : `¥${Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
const quantity = (value) => value === null || value === undefined ? "暂无数据" : Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const percent = (value) => value === null || value === undefined ? "暂无数据" : `${(Number(value) * 100).toFixed(1)}%`;
const healthLabel = { healthy: "健康", warning: "需要关注", error: "存在阻断问题" };

function trend(items = []) {
  const available = items.filter((item) => !item.noData); const max = Math.max(1, ...available.flatMap((item) => [Math.abs(Number(item.salesAmount || 0)), Math.abs(Number(item.profitAmount || 0))]));
  return `<div class="sales-business-trend">${items.map((item) => `<div class="${item.noData ? "is-no-data" : ""}" title="${escapeHtml(item.date)} · ${item.noData ? "暂无事实" : `销售额 ${amount(item.salesAmount)}，利润 ${amount(item.profitAmount)}`}"><div><i style="height:${item.noData ? 0 : Math.max(3, Math.abs(Number(item.salesAmount || 0)) / max * 100)}%"></i><b style="height:${item.noData ? 0 : Math.max(3, Math.abs(Number(item.profitAmount || 0)) / max * 100)}%"></b></div><small>${escapeHtml(item.date.slice(5))}</small></div>`).join("")}</div>`;
}

function ranking(items = [], type) {
  if (!items.length) return `<div class="empty-state compact">暂无销售日报事实</div>`;
  return `<ol class="sales-business-ranking">${items.map((item) => `<li><span>${item.rank}</span><button type="button" data-sales-dashboard-target="${type === "product" ? `products/${encodeURIComponent(item.targetId)}` : "connectionCenter"}"><strong>${escapeHtml(item.targetName || "未命名")}</strong><small>${escapeHtml(item.targetCode || "")}</small></button><div><strong>${amount(item.salesAmount)}</strong><small>利润 ${amount(item.profitAmount)}${type === "product" ? ` · ${percent(item.profitMargin)}` : ""}</small></div></li>`).join("")}</ol>`;
}

export function renderSalesBusinessDashboard({ state = {} } = {}) {
  if (state.loading) return `<section class="sales-business-dashboard"><div class="empty-state compact">正在读取销售经营事实…</div></section>`;
  if (state.error) return `<section class="sales-business-dashboard"><div class="empty-state compact"><strong>驾驶舱暂不可用</strong><p>${escapeHtml(state.error)}</p></div></section>`;
  const data = state.data;
  if (!data?.hasData) return `<section class="sales-business-dashboard"><header><div><p class="eyebrow">SALES BUSINESS V1</p><h2>销售经营驾驶舱</h2></div></header><div class="empty-state compact">暂无已确认销售日报事实</div></section>`;
  const quality = data.quality;
  return `<section class="sales-business-dashboard" data-module-key="sales_business_dashboard">
    <header><div><p class="eyebrow">SALES BUSINESS V1</p><h2>销售经营驾驶舱</h2><p>${escapeHtml(data.startDate)} 至 ${escapeHtml(data.endDate)} · 数据源：销售日报事实</p></div><div class="sales-business-range"><button data-sales-range="7d" class="${data.preset === "7d" ? "is-active" : ""}">近7日</button><button data-sales-range="30d" class="${data.preset === "30d" ? "is-active" : ""}">近30日</button></div></header>
    <div class="sales-business-metrics"><article><span>销售额</span><strong>${amount(data.summary.salesAmount)}</strong><small>${data.summary.dataCount} 条事实</small></article><article><span>利润</span><strong>${amount(data.summary.profitAmount)}</strong><small>已确认商品销售</small></article><article><span>利润率</span><strong>${percent(data.summary.profitMargin)}</strong><small>查询结果展示比率</small></article><article><span>数据覆盖率</span><strong>${percent(quality.amounts.salesCoverage)}</strong><small>商品销售额覆盖</small></article></div>
    <article class="sales-business-panel is-wide"><header><div><h3>每日销售趋势</h3><p>绿色为销售额，蓝色为利润；缺失日期保持暂无数据</p></div><small>销量 ${quantity(data.summary.quantity)}</small></header>${trend(data.trend.items)}</article>
    <div class="sales-business-grid"><article class="sales-business-panel"><header><div><h3>产品销售排行</h3><p>产品维度批量查询</p></div></header>${ranking(data.products.items, "product")}</article><article class="sales-business-panel"><header><div><h3>链接销售排行</h3><p>链接维度批量查询</p></div></header>${ranking(data.links.items, "link")}</article></div>
    <article class="sales-business-health is-${escapeHtml(quality.health.status)}"><div><span>数据健康</span><strong>${escapeHtml(healthLabel[quality.health.status] || quality.health.status)}</strong></div><div><span>异常行</span><strong>${quality.health.exceptionCount}</strong></div><div><span>用途待确认</span><strong>${quality.governance.erpUsagePending.erpSkuCount} 个SKU</strong></div><div><span>关系待治理</span><strong>${quality.governance.relationPending.rowCount} 行</strong></div><div><span>关系冲突</span><strong>${quality.governance.conflicts.rowCount} 行</strong></div></article>
  </section>`;
}

registerUiModule({ moduleKey: "sales_business_dashboard", name: "SalesBusinessDashboard", domain: "dashboard", description: "销售日报经营指标、趋势、产品与链接排行及数据健康概览。", dependencies: ["QueryDailySalesSummary", "QueryDailySalesTrend", "QuerySalesDailyDataQuality"], configSchema: {}, render: renderSalesBusinessDashboard });
