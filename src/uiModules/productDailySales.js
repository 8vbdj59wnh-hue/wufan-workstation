import { registerUiModule } from "../uiModuleRegistry.js";
import { escapeHtml } from "../utils/html.js";

const number = (value) => value === null || value === undefined ? "暂无数据" : Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const money = (value) => value === null || value === undefined ? "暂无数据" : `¥${number(value)}`;
const percent = (value) => value === null || value === undefined ? "暂无数据" : `${(Number(value) * 100).toFixed(2)}%`;

export function renderProductDailySales({ state = {} } = {}) {
  if (state.loading) return `<section class="product-workspace-panel" data-module-key="product_daily_sales"><div class="empty-state compact">正在读取产品销售日报…</div></section>`;
  if (state.error) return `<section class="product-workspace-panel" data-module-key="product_daily_sales"><div class="form-error">${escapeHtml(state.error)}</div></section>`;
  if (!state.data) return `<section class="product-workspace-panel" data-module-key="product_daily_sales"><div class="empty-state compact">暂无产品销售日报</div></section>`;
  const { summary, trend, contributions, range } = state.data;
  return `<section class="product-workspace-panel product-daily-sales" data-module-key="product_daily_sales">
    <header><div><span>日报事实</span><h2>销售表现</h2></div><div class="segmented-control">${[["7d", "近7日"], ["30d", "近30日"]].map(([value, label]) => `<button type="button" data-action="product-daily-sales-range" data-range="${value}" class="${state.rangePreset === value ? "active" : ""}">${label}</button>`).join("")}</div></header>
    <small>周期：${escapeHtml(`${range.startDate} 至 ${range.endDate}`)}</small>
    ${summary.hasData ? `<div class="product-workspace-metrics"><div><span>销售额</span><strong>${money(summary.salesAmount)}</strong></div><div><span>利润</span><strong>${money(summary.profitAmount)}</strong></div><div><span>销量</span><strong>${number(summary.quantity)}</strong></div><div><span>利润率</span><strong>${percent(summary.profitMargin)}</strong></div></div>` : `<div class="empty-state compact"><strong>暂无数据</strong><p>当前周期没有归属于该产品的日报事实。</p></div>`}
    <div class="product-workspace-grid">
      <section><h3>每日趋势</h3>${summary.hasData ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>日期</th><th>销售额</th><th>利润</th><th>销量</th></tr></thead><tbody>${trend.items.map((item) => `<tr><td>${escapeHtml(item.date)}</td><td>${item.noData ? "暂无数据" : money(item.salesAmount)}</td><td>${item.noData ? "暂无数据" : money(item.profitAmount)}</td><td>${item.noData ? "暂无数据" : number(item.quantity)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state compact">暂无趋势数据</div>`}</section>
      <section><h3>销售链接贡献</h3>${contributions.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>链接</th><th>销售额</th><th>利润</th></tr></thead><tbody>${contributions.map((item) => `<tr><td><strong>${escapeHtml(item.linkName)}</strong><small>${escapeHtml([item.platform, item.shopName].filter(Boolean).join(" · "))}</small></td><td>${money(item.salesAmount)}</td><td>${money(item.profitAmount)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state compact">暂无链接贡献数据</div>`}</section>
    </div>
  </section>`;
}

registerUiModule({ moduleKey: "product_daily_sales", name: "ProductDailySales", domain: "product", description: "展示产品维度日报销售概览、趋势与销售链接贡献。", dependencies: ["QueryDailySalesSummary", "QueryDailySalesTrend"], configSchema: {}, render: renderProductDailySales });
export default renderProductDailySales;
