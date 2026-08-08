import { registerUiModule } from "../uiModuleRegistry.js";
import { escapeHtml } from "../utils/html.js?v=20260802-module-boundary1";

function money(value) {
  return Number(value || 0).toLocaleString("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 2 });
}

export function renderLinkSalesRanking({ state = {}, canViewCompany = false } = {}) {
  const items = state.items ?? [];
  const range = state.range ?? {};
  return `<section class="link-sales-ranking-module" data-module-key="link_sales_ranking">
    <header><div><span>销售额排行</span><h3>${state.scope === "company" ? "全部链接" : "我的链接"}</h3></div><small>${escapeHtml(range.startDate || "—")} 至 ${escapeHtml(range.endDate || "—")}</small></header>
    <form data-link-ranking-filter>
      <select name="scope"><option value="mine" ${state.scope !== "company" ? "selected" : ""}>我的链接</option>${canViewCompany ? `<option value="company" ${state.scope === "company" ? "selected" : ""}>公司全部链接</option>` : ""}</select>
      <select name="preset"><option value="7d" ${range.preset !== "30d" && range.preset !== "custom" ? "selected" : ""}>近7日</option><option value="30d" ${range.preset === "30d" ? "selected" : ""}>近30日</option><option value="custom" ${range.preset === "custom" ? "selected" : ""}>自定义</option></select>
      <input type="date" name="startDate" value="${escapeHtml(range.startDate || "")}" aria-label="开始日期" />
      <input type="date" name="endDate" value="${escapeHtml(range.endDate || "")}" aria-label="结束日期" />
      <button type="submit" class="secondary-button">查看</button>
    </form>
    ${state.loading ? `<div class="empty-state compact">正在读取销售排行…</div>` : state.error ? `<div class="form-error">${escapeHtml(state.error)}</div>` : items.length ? `<ol>${items.map((item) => `<li><b>${item.rank}</b><button type="button" data-open-connection="${escapeHtml(item.connectionId)}"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(`${item.platform} · ${item.shopName}`)}</small></button><em>${money(item.salesAmount)}</em></li>`).join("")}</ol>` : `<div class="empty-state compact">所选期间暂无销售事实</div>`}
  </section>`;
}

registerUiModule({
  moduleKey: "link_sales_ranking",
  name: "LinkSalesRanking",
  domain: "business_links",
  description: "基于现有销售事实，按负责人或公司范围展示链接销售额排行。",
  render: renderLinkSalesRanking,
  configSchema: { scope: ["mine", "company"], preset: ["7d", "30d", "custom"] },
  dependencies: ["BusinessLink", "ConnectionSkuSalesFact", "LinkSalesRanking"],
});
