import { registerUiModule } from "../uiModuleRegistry.js";
import { escapeHtml } from "../utils/html.js";

const money = (value) => value == null ? "暂无数据" : Number(value).toLocaleString("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 2 });
const number = (value) => value == null ? "暂无数据" : Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const percent = (value) => value == null ? "暂无数据" : `${(Number(value) * 100).toFixed(2)}%`;
const color = (groupIndex) => `hsl(${(Number(groupIndex || 1) * 47 + 190) % 360} 48% 54%)`;

function renderChart(items, level, resolveUrl) {
  const width = Math.max(items.length, 1);
  const minimumWidth = level === "all" ? "100%" : `${Math.max(900, Math.ceil(width * 8))}px`;
  const max = Math.max(...items.filter((item) => item.hasSalesAmountData).map((item) => Math.max(0, Number(item.directSalesAmount || 0))), 1);
  const lastRank = Number(items.at(-1)?.rank || 0);
  const bars = items.map((item, index) => {
    const salesAmount = Number(item.directSalesAmount || 0);
    const visualAmount = item.hasSalesAmountData ? Math.max(0, salesAmount) : 0;
    const height = item.hasSalesAmountData ? Math.max(2, visualAmount / max * 136) : item.hasPhysicalContribution ? 2 : 1.2;
    const y = 146 - height;
    const rangeStart = Math.floor((Number(item.rank) - 1) / 100) * 100 + 1;
    const rangeEnd = Math.min(rangeStart + 99, lastRank || rangeStart + 99);
    const action = level === "all"
      ? `data-product-distribution-group="${item.groupIndex}"`
      : `data-product-distribution-product="${escapeHtml(item.productId)}"`;
    const fill = salesAmount < 0 ? "#d92d20" : item.hasSalesAmountData ? color(item.groupIndex) : item.hasPhysicalContribution ? "#f79009" : "#d0d5dd";
    const description = item.hasSalesAmountData
      ? `${money(item.directSalesAmount)} · 占直接销售额 ${percent(item.salesPercentage)}`
      : item.hasPhysicalContribution ? `无直接金额归属 · 实际出货 ${number(item.totalPhysicalContribution)}` : "暂无经营数据";
    const accessibleLabel = `第${item.rank}名 · ${item.productName} · ${description}`;
    const tooltipAttributes = level === "group"
      ? `data-product-distribution-bar data-tooltip-rank="${item.rank}" data-tooltip-name="${escapeHtml(item.productName || "未命名产品")}" data-tooltip-code="${escapeHtml(item.skuCode || "暂无编码")}" data-tooltip-image="${escapeHtml(item.mainImage ? resolveUrl(item.mainImage) : "")}" data-tooltip-sales="${escapeHtml(money(item.directSalesAmount))}" data-tooltip-share="${escapeHtml(percent(item.salesPercentage))}" data-tooltip-physical="${escapeHtml(number(item.totalPhysicalContribution))}"`
      : "";
    return `<rect x="${index}" y="${y}" width=".88" height="${height}" rx=".12" fill="${fill}" opacity="${item.noData ? ".45" : ".92"}" ${action} ${tooltipAttributes} data-range-label="${rangeStart}-${rangeEnd}" aria-label="${escapeHtml(accessibleLabel)}" tabindex="0"></rect>`;
  }).join("");
  const tooltip = level === "group" ? `<aside class="product-distribution-tooltip" data-product-distribution-tooltip hidden><div class="product-distribution-tooltip-main"><div class="product-distribution-tooltip-image"><img data-product-tooltip-image alt="" hidden /><span data-product-tooltip-image-placeholder>无图</span></div><div class="product-distribution-tooltip-copy"><div><span>第 <strong data-product-tooltip-rank>—</strong> 名</span><small data-product-tooltip-code>—</small></div><h4 data-product-tooltip-name>—</h4></div></div><dl><div><dt>直接销售额</dt><dd data-product-tooltip-sales>—</dd></div><div><dt>销售额占比</dt><dd data-product-tooltip-share>—</dd></div><div><dt>实际出货</dt><dd data-product-tooltip-physical>—</dd></div></dl><p>点击查看产品档案</p></aside>` : "";
  return `<div class="product-sales-distribution-chart" role="img" aria-label="每个细柱代表一个产品的直接销售额"><div class="product-distribution-y-label"><span>${money(max)}</span><span>直接销售额</span><span>0</span></div><div class="product-distribution-chart-scroll"><svg viewBox="0 0 ${width} 154" preserveAspectRatio="none" style="min-width:${minimumWidth}">${bars}<line x1="0" y1="147" x2="${width}" y2="147" stroke="#d0d5dd" stroke-width=".5" /></svg></div>${tooltip}</div>`;
}

function renderGroupButtons(items) {
  const groups = new Map();
  for (const item of items) {
    const current = groups.get(item.groupIndex) || { start: item.rank, end: item.rank, total: 0, withAmount: 0 };
    current.end = item.rank;
    if (item.hasSalesAmountData) { current.total += Number(item.directSalesAmount || 0); current.withAmount += 1; }
    groups.set(item.groupIndex, current);
  }
  return `<div class="product-distribution-group-legend">${[...groups.entries()].map(([index, group]) => `<button type="button" data-product-distribution-group="${index}"><i style="background:${color(index)}"></i><span>${group.start}–${group.end}</span><small>${money(group.total)} · ${group.withAmount} 个有金额</small></button>`).join("")}</div>`;
}

function renderPresetButtons(range) {
  const presets = [["yesterday", "昨日"], ["7d", "近7天"], ["15d", "近15天"], ["30d", "近30天"], ["45d", "近45天"], ["60d", "近60天"], ["90d", "近90天"], ["custom", "自定义"]];
  return `<div class="product-distribution-presets">${presets.map(([value, label]) => `<button type="button" data-product-distribution-preset="${value}" class="${range.preset === value ? "is-active" : ""}">${label}</button>`).join("")}</div>`;
}

export function renderProductSalesDistribution({ state = {}, resolveUrl = (value) => value } = {}) {
  const items = state.items || [];
  const selectedGroup = Number(state.selectedGroup || 0);
  const groupItems = selectedGroup ? items.filter((item) => Number(item.groupIndex) === selectedGroup) : [];
  const range = state.range || { preset: "30d" };
  const chartItems = selectedGroup ? groupItems : items;
  return `<section class="product-sales-distribution-module" data-module-key="product_sales_distribution">
    <header><div><h3>${selectedGroup ? `第 ${groupItems[0]?.rank || "—"}–${groupItems.at(-1)?.rank || "—"} 名产品` : "公司产品销售结构"}</h3><p>每个细柱代表一个产品，按直接销售额降序；组合装金额不拆分。</p></div>${selectedGroup ? `<button type="button" class="secondary-button" data-product-distribution-back>查看全部分布</button>` : ""}</header>
    <form data-product-distribution-filter>${renderPresetButtons(range)}<div class="product-distribution-custom-range ${range.preset === "custom" ? "" : "is-hidden"}"><label>开始日期<input type="date" name="startDate" value="${escapeHtml(range.startDate || "")}" ${range.preset === "custom" ? "required" : "disabled"}/></label><span>→</span><label>结束日期<input type="date" name="endDate" value="${escapeHtml(range.endDate || "")}" ${range.preset === "custom" ? "required" : "disabled"}/></label></div><label class="product-unarchived-toggle"><input type="checkbox" name="includeHistorical" ${state.includeHistorical ? "checked" : ""}/><span>显示历史产品</span></label><button type="submit" class="secondary-button">查看</button></form>
    <div class="product-distribution-period">${range.startDate && range.endDate ? `${escapeHtml(range.startDate)} 至 ${escapeHtml(range.endDate)} · 产品直接销售额结构` : "正在确定销售周期…"}</div>
    ${state.loading ? `<div class="empty-state">正在读取产品销售分布…</div>` : state.error ? `<div class="form-error">${escapeHtml(state.error)}</div>` : !state.summary?.hasData ? `<div class="empty-state"><strong>所选期间暂无产品销售事实</strong><p>${items.length ? `${items.length} 个产品均保留为“暂无数据”，不会模拟为销售额。` : "当前经营范围没有可查看的产品。"}</p></div>` : `<div class="product-distribution-summary"><span>产品 <strong>${state.summary.totalProducts || 0}</strong></span><span>有直接销售额 <strong>${state.summary.productsWithSalesAmount || 0}</strong></span><span>有实际出货 <strong>${state.summary.productsWithPhysicalContribution || 0}</strong></span><span>暂无任何数据 <strong>${state.summary.productsWithoutAnyData || 0}</strong></span><span>直接销售额 <strong>${money(state.summary.totalDirectSalesAmount)}</strong></span><span>实际出货 <strong>${number(state.summary.totalPhysicalContribution)}</strong></span></div>${renderChart(chartItems, selectedGroup ? "group" : "all", resolveUrl)}${selectedGroup ? `<div class="product-distribution-hint">点击柱形进入对应产品档案</div>` : renderGroupButtons(items)}`}
  </section>`;
}

registerUiModule({
  moduleKey: "product_sales_distribution",
  name: "ProductSalesDistribution",
  domain: "business_products",
  description: "按产品直接销售额降序展示公司产品销售结构，支持100产品分组与产品档案下钻。",
  render: renderProductSalesDistribution,
  configSchema: { presets: ["yesterday", "7d", "15d", "30d", "45d", "60d", "90d", "custom"], groupSize: 100 },
  dependencies: ["Product", "QueryProductContribution", "ConnectionSkuSalesDailyFact"],
});
