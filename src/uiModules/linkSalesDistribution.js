import { registerUiModule, renderUiModule } from "../uiModuleRegistry.js";
import { escapeHtml } from "../utils/html.js";

const money = (value) => value == null ? "暂无数据" : Number(value).toLocaleString("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 2 });
const percent = (value) => value == null ? "暂无数据" : `${(Number(value) * 100).toFixed(2)}%`;
const color = (groupIndex) => `hsl(${(Number(groupIndex || 1) * 47 + 190) % 360} 48% 54%)`;

function renderChart(items, level) {
  const chartItems = level === "all"
    ? [...items.reduce((groups, item) => {
        const groupIndex = Number(item.groupIndex || 1);
        const current = groups.get(groupIndex) || {
          groupIndex,
          start: Number(item.rank || 0),
          end: Number(item.rank || 0),
          salesAmount: 0,
          hasData: false,
          noData: true,
        };
        current.end = Number(item.rank || current.end);
        if (item.hasData) {
          current.salesAmount += Number(item.salesAmount || 0);
          current.hasData = true;
          current.noData = false;
        }
        groups.set(groupIndex, current);
        return groups;
      }, new Map()).values()]
    : items;
  const width = Math.max(chartItems.length, 1);
  const minimumWidth = level === "all" ? Math.max(1400, Math.ceil(width * 1.4)) : Math.max(900, Math.ceil(width * 8));
  const max = Math.max(...chartItems.filter((item) => item.hasData).map((item) => Number(item.salesAmount || 0)), 1);
  const bars = chartItems.map((item, index) => {
    const height = item.noData ? 2 : Math.max(2, Number(item.salesAmount || 0) / max * 136);
    const y = 146 - height;
    const tooltipLabel = `第${item.rank}名 · ${item.linkName} · ${money(item.salesAmount)} · 占比 ${percent(item.salesPercentage)}${item.noData ? " · 暂无销售事实" : ""}`;
    if (level === "all") {
      return `<rect x="${index}" y="${y}" width=".88" height="${height}" rx=".12" fill="${item.noData ? "#d0d5dd" : color(item.groupIndex)}" opacity="${item.noData ? ".45" : ".92"}"
        data-distribution-group="${item.groupIndex}" tabindex="0" role="button"
        aria-label="${escapeHtml(`第${item.start}–${item.end}名链接销售额合计${money(item.salesAmount)}，点击查看分段`)}"></rect>`;
    }
    return `<rect x="${index}" y="${y}" width=".88" height="${height}" rx=".12" fill="${item.noData ? "#d0d5dd" : color(item.groupIndex)}" opacity="${item.noData ? ".45" : ".92"}"
      data-distribution-bar data-open-connection="${escapeHtml(item.linkId)}" data-return-section="cockpit"
      data-link-name="${escapeHtml(item.linkName)}" data-link-rank="${escapeHtml(item.rank)}"
      data-link-image="${escapeHtml(item.mainImage || "")}" data-link-platform="${escapeHtml(item.platform || "")}" data-link-shop="${escapeHtml(item.shopName || "")}"
      data-sales-label="${escapeHtml(money(item.salesAmount))}" data-percentage-label="${escapeHtml(percent(item.salesPercentage))}"
      tabindex="0" role="link" aria-label="${escapeHtml(`${tooltipLabel}，点击进入链接详情`)}"></rect>`;
  }).join("");
  const chartLabel = level === "all" ? "每个细柱代表一个100链接分段的销售额合计" : "每个细柱代表一个链接的销售额分布";
  return `<div class="link-sales-distribution-chart" role="group" aria-label="${chartLabel}"><div class="distribution-y-label"><span>${money(max)}</span><span>销售额</span><span>0</span></div><div class="distribution-chart-scroll"><svg viewBox="0 0 ${width} 154" preserveAspectRatio="none" style="min-width:${minimumWidth}px">${bars}<line x1="0" y1="147" x2="${width}" y2="147" stroke="#d0d5dd" stroke-width=".5" /></svg></div></div>`;
}

function renderGroupButtons(items) {
  const groups = new Map();
  for (const item of items) {
    const current = groups.get(item.groupIndex) || { start: item.rank, end: item.rank, total: 0 };
    current.end = item.rank;
    if (item.hasData) current.total += Number(item.salesAmount || 0);
    groups.set(item.groupIndex, current);
  }
  return `<div class="distribution-group-legend">${[...groups.entries()].map(([index, group]) => `<button type="button" data-distribution-group="${index}"><i style="background:${color(index)}"></i><span>${group.start}–${group.end}</span><small>${money(group.total)}</small></button>`).join("")}</div>`;
}

function renderRangeButtons(items) {
  const ranges = new Map();
  for (const item of items) {
    const start = Math.floor((Number(item.rank) - 1) / 10) * 10 + 1;
    const end = Math.min(start + 9, Number(items.at(-1)?.rank || start + 9));
    const current = ranges.get(start) || { start, end, total: 0, ids: [] };
    if (item.hasData) current.total += Number(item.salesAmount || 0);
    current.ids.push(item.linkId);
    ranges.set(start, current);
  }
  return `<div class="distribution-range-actions">${[...ranges.values()].map((range) => `<button type="button" data-distribution-range="${range.start}-${range.end}" data-distribution-link-ids="${escapeHtml(range.ids.join(","))}"><span>第 ${range.start}–${range.end} 名</span><strong>${money(range.total)}</strong><small>查看经营数据 →</small></button>`).join("")}</div>`;
}

export function renderLinkSalesDistribution({ state = {}, canViewCompany = false, globalRange = {} } = {}) {
  const items = state.items || [];
  const selectedGroup = Number(state.selectedGroup || 0);
  const groupItems = selectedGroup ? items.filter((item) => Number(item.groupIndex) === selectedGroup) : [];
  const range = globalRange;
  if (state.drillTable) {
    return `<section class="link-sales-distribution-module" data-module-key="link_sales_distribution"><header><div><h3>链接经营数据</h3><small>来自第 ${state.selectedRange?.start || "—"}–${state.selectedRange?.end || "—"} 名区间</small></div><button type="button" class="secondary-button" data-distribution-back="group">返回分布</button></header>${renderUiModule("link_data_table", state.drillTable)}</section>`;
  }
  return `<section class="link-sales-distribution-module" data-module-key="link_sales_distribution">
    <header><div><h3>${selectedGroup ? `第 ${groupItems[0]?.rank || "—"}–${groupItems.at(-1)?.rank || "—"} 名` : "公司销售结构"}</h3></div>${selectedGroup ? `<button type="button" class="secondary-button" data-distribution-back="all">查看全部分布</button>` : ""}</header>
    <form data-link-distribution-filter><label><span>链接范围</span><select name="scope"><option value="mine" ${state.scope === "mine" ? "selected" : ""}>我的链接</option>${canViewCompany ? `<option value="company" ${state.scope !== "mine" ? "selected" : ""}>全部链接</option>` : ""}</select></label><button type="submit" class="secondary-button">查看</button><small>${escapeHtml(`${range.startDate || "—"} 至 ${range.endDate || "—"}`)} · 时间范围由页面顶部统一控制</small></form>
    ${state.loading ? `<div class="empty-state">正在读取销售分布…</div>` : state.error ? `<div class="form-error">${escapeHtml(state.error)}</div>` : !state.summary?.hasData ? `<div class="empty-state"><strong>所选期间暂无销售事实</strong><p>${items.length ? `${items.length} 条链接均保留为“暂无数据”，不会显示为销售额 0。` : "当前范围没有可查看的链接。"}</p></div>` : `<div class="distribution-summary"><span>链接 <strong>${state.summary.totalLinks || 0}</strong></span><span>有销售事实 <strong>${state.summary.linksWithData || 0}</strong></span><span>暂无数据 <strong>${state.summary.linksWithoutData || 0}</strong></span><span>销售额 <strong>${money(state.summary.totalSalesAmount)}</strong></span></div>${renderChart(selectedGroup ? groupItems : items, selectedGroup ? "group" : "all")}${selectedGroup ? renderRangeButtons(groupItems) : renderGroupButtons(items)}`}
  </section>`;
}

registerUiModule({
  moduleKey: "link_sales_distribution", name: "LinkSalesDistribution", domain: "business_links",
  description: "按销售额降序以每链接一个细柱展示整体销售结构，并支持100链接分组和10链接经营数据钻取。",
  render: renderLinkSalesDistribution,
  configSchema: { scope: ["mine", "company"], globalDateRange: true, groupSize: 100, drillSize: 10 },
  dependencies: ["BusinessLink", "ConnectionSkuSalesFact", "LinkSalesDistribution", "QueryLinkDataTable", "link_data_table"],
});
