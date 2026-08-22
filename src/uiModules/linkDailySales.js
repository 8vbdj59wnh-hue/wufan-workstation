import { registerUiModule } from "../uiModuleRegistry.js";
import { escapeHtml } from "../utils/html.js";
import { LINK_TIME_RANGE_OPTIONS, LINK_TIME_RANGE_VALUES } from "../../shared/linkTimeRange.js";

const number = (value) => value === null || value === undefined ? "暂无数据" : Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const money = (value) => value === null || value === undefined ? "暂无数据" : `¥${number(value)}`;
const percent = (value) => value === null || value === undefined ? "暂无数据" : `${(Number(value) * 100).toFixed(2)}%`;

function erpComposition(item) {
  const relation = item.relation;
  if (!relation?.isUsable) return `<span class="daily-sales-relation-unavailable">关系${escapeHtml(relation?.relationStatus === "conflict" ? "存在冲突" : "尚未完整确认")}</span>`;
  return relation.erpSkus.length
    ? `<div class="daily-sales-erp-list">${relation.erpSkus.map((erpSku) => `<span><strong>${escapeHtml(erpSku.merchantSkuCode || erpSku.erpSkuId)}</strong>${erpSku.quantity === 1 ? "" : ` × ${number(erpSku.quantity)}`}${erpSku.name ? `<small>${escapeHtml(erpSku.name)}</small>` : ""}</span>`).join("")}</div>`
    : `<span class="daily-sales-relation-unavailable">暂无完整ERP SKU组成</span>`;
}

export function renderLinkDailySales({ data = null, loading = false, rangePreset = "30d", startDate = "", endDate = "" } = {}) {
  if (loading) return `<section class="connection-v3-panel link-daily-sales-module" data-module-key="link_daily_sales"><div class="empty-state">正在读取销售日报…</div></section>`;
  if (!data) return `<section class="connection-v3-panel link-daily-sales-module" data-module-key="link_daily_sales"><div class="empty-state">销售日报暂不可用</div></section>`;
  const summary = data.summary || {};
  const trend = data.trend?.items || [];
  const skuItems = data.bySku?.items || [];
  return `<section class="connection-v3-panel link-daily-sales-module" data-module-key="link_daily_sales">
    <header><div><h3>销售日报表现</h3><p>来源：销售日报事实 · 缺失日期不补零</p></div><form data-daily-sales-range-form><div class="segmented-control">${LINK_TIME_RANGE_OPTIONS.map(({ value, label }) => `<button type="button" data-daily-sales-range="${value}" class="${rangePreset === value ? "active" : ""}">${label}</button>`).join("")}</div><div class="link-business-custom-date ${rangePreset === "custom" ? "" : "is-hidden"}"><label>开始<input type="date" name="startDate" value="${escapeHtml(startDate || data.range?.startDate || "")}" /></label><label>结束<input type="date" name="endDate" value="${escapeHtml(endDate || data.range?.endDate || "")}" /></label><button type="submit" class="secondary-button">查询</button></div></form></header>
    <div class="daily-sales-period">周期：${escapeHtml(`${data.range.startDate} 至 ${data.range.endDate}`)}</div>
    ${summary.hasData ? `<div class="connection-v3-metrics"><div><span>销售额</span><strong>${money(summary.salesAmount)}</strong></div><div><span>利润</span><strong>${money(summary.profitAmount)}</strong></div><div><span>销量</span><strong>${number(summary.quantity)}</strong></div><div><span>利润率</span><strong>${percent(summary.profitMargin)}</strong></div></div>` : `<div class="empty-state compact"><strong>暂无数据</strong><p>当前周期没有销售日报事实。</p></div>`}
    <div class="daily-sales-grid">
      <section><h4>每日趋势</h4>${summary.hasData ? `<div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>日期</th><th>销售额</th><th>利润</th></tr></thead><tbody>${trend.map((item) => `<tr class="${item.noData ? "is-no-data" : ""}"><td>${escapeHtml(item.date)}</td><td>${item.noData ? "暂无数据" : money(item.salesAmount)}</td><td>${item.noData ? "暂无数据" : money(item.profitAmount)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state compact">暂无趋势数据</div>`}</section>
      <section><h4>SKU贡献</h4>${skuItems.length ? `<div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>链接SKU</th><th>ERP SKU组成</th><th>销售额</th><th>利润</th><th>销量</th></tr></thead><tbody>${skuItems.map((item) => `<tr><td><strong>${escapeHtml(item.salesLinkSkuName)}</strong></td><td>${erpComposition(item)}</td><td>${money(item.salesAmount)}</td><td>${money(item.profitAmount)}</td><td>${number(item.quantity)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state compact">暂无SKU贡献数据</div>`}</section>
    </div>
  </section>`;
}

registerUiModule({
  moduleKey: "link_daily_sales",
  name: "LinkDailySales",
  domain: "business_links",
  description: "展示日报事实口径下的链接概览、每日趋势和SKU贡献。",
  dependencies: ["QueryDailySalesSummary", "QueryDailySalesTrend", "QueryDailySalesBySku", "ResolveLinkSkuErpRelations"],
  configSchema: { ranges: LINK_TIME_RANGE_VALUES },
  render: renderLinkDailySales,
});

export default renderLinkDailySales;
