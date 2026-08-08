import { registerUiModule } from "../uiModuleRegistry.js";
import { escapeHtml } from "../utils/html.js?v=20260802-module-boundary1";

export function renderMyLinkSummary({ summary = {}, money = (value) => value } = {}) {
  const cards = [
    ["我的链接", Number(summary.total || 0), "all"],
    ["昨日销售额", summary.yesterdaySalesAmount == null ? "暂无数据" : money(summary.yesterdaySalesAmount), ""],
    ["昨日提成", "待配置", ""],
    ["上涨链接", Number(summary.better || 0), "better"],
    ["风险链接", Number(summary.risk || 0), "worse"],
    ["待处理问题", Number(summary.pendingIssues || 0), "hospital"],
  ];
  return `<section class="my-link-summary-module" data-module-key="my_link_summary"><header><span>我的经营概览</span><small>昨日数据与当前经营状态</small></header><div>${cards.map(([label, value, action]) => action === "hospital"
    ? `<button type="button" data-workbench-go="hospital"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></button>`
    : action ? `<button type="button" data-my-link-filter="${escapeHtml(action)}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></button>`
      : `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`).join("")}</div></section>`;
}

registerUiModule({
  moduleKey: "my_link_summary",
  name: "MyLinkSummary",
  domain: "business_links",
  description: "汇总当前运营负责链接的经营与待处理状态。",
  render: renderMyLinkSummary,
  configSchema: {},
  dependencies: ["BusinessLink", "ConnectionSkuSalesFact", "ConnectionHospital"],
});
