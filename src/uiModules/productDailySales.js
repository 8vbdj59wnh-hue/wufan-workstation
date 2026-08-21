import { registerUiModule } from "../uiModuleRegistry.js";
import { escapeHtml } from "../utils/html.js";

const number = (value) => value === null || value === undefined ? "暂无数据" : Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const money = (value) => value === null || value === undefined ? "暂无数据" : `¥${number(value)}`;
const percent = (value) => value === null || value === undefined ? "暂无数据" : `${(Number(value) * 100).toFixed(2)}%`;

export function renderProductDailySales({ state = {} } = {}) {
  if (state.loading) return `<section class="product-workspace-panel" data-module-key="product_daily_sales"><div class="empty-state compact">正在读取产品销售日报…</div></section>`;
  if (state.error) return `<section class="product-workspace-panel" data-module-key="product_daily_sales"><div class="form-error">${escapeHtml(state.error)}</div></section>`;
  if (!state.data) return `<section class="product-workspace-panel" data-module-key="product_daily_sales"><div class="empty-state compact">暂无产品销售日报</div></section>`;
  const { summary, physicalTrend, bundleParticipations = [], range } = state.data;
  return `<section class="product-workspace-panel product-daily-sales" data-module-key="product_daily_sales">
    <header><div><span>日报事实</span><h2>销售表现</h2></div><div class="segmented-control">${[["7d", "近7日"], ["30d", "近30日"]].map(([value, label]) => `<button type="button" data-action="product-daily-sales-range" data-range="${value}" class="${state.rangePreset === value ? "active" : ""}">${label}</button>`).join("")}</div></header>
    <small>周期：${escapeHtml(`${range.startDate} 至 ${range.endDate}`)}</small>
    ${summary.hasContributionData ? `<div class="product-workspace-metrics"><div><span>直接销量</span><strong>${number(summary.directSalesQuantity)}</strong></div><div><span>组合贡献销量</span><strong>${number(summary.bundleContributionQuantity)}</strong></div><div><span>实际出货贡献</span><strong>${number(summary.totalPhysicalContribution)}</strong></div><div><span>直接销售额</span><strong>${money(summary.directSalesAmount)}</strong></div><div><span>直接利润</span><strong>${money(summary.directProfit)}</strong></div><div><span>BOM证据</span><strong>${escapeHtml(summary.bomEvidenceLevel || "不适用")}</strong></div></div>` : `<div class="empty-state compact"><strong>暂无数据</strong><p>当前周期没有可归属的直接销量或组合贡献销量。</p></div>`}
    <div class="product-workspace-grid">
      <section><h3>每日实际出货</h3>${summary.hasContributionData ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>日期</th><th>直接销量</th><th>组合贡献</th><th>实际出货</th><th>直接销售额</th></tr></thead><tbody>${physicalTrend.items.map((item) => `<tr><td>${escapeHtml(item.date)}</td><td>${item.noData ? "暂无数据" : number(item.directSalesQuantity)}</td><td>${item.noData ? "暂无数据" : number(item.bundleContributionQuantity)}</td><td>${item.noData ? "暂无数据" : number(item.totalPhysicalContribution)}</td><td>${item.noData ? "暂无数据" : money(item.directSalesAmount)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state compact">暂无趋势数据</div>`}</section>
      <section><h3>参与的组合装</h3>${bundleParticipations.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>组合装</th><th>销售套数</th><th>贡献数量</th><th>证据</th></tr></thead><tbody>${bundleParticipations.map((item) => `<tr><td><strong>${escapeHtml(item.bundleCode)}</strong></td><td>${number(item.bundleSalesQuantity)}</td><td>${number(item.contributionQuantity)}</td><td>${escapeHtml(Object.keys(item.bomEvidence || {}).filter((key) => item.bomEvidence[key]).join(" / ") || "unknown")}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state compact">当前周期未参与组合装销售</div>`}</section>
    </div>
    <small>金额口径：仅展示Single直接销售事实；Bundle销售额和利润不拆分给组件Product。</small>
  </section>`;
}

registerUiModule({ moduleKey: "product_daily_sales", name: "ProductDailySales", domain: "product", description: "展示Product直接销量、组合贡献销量与实际出货贡献。", dependencies: ["QueryProductContribution"], configSchema: {}, render: renderProductDailySales });
export default renderProductDailySales;
