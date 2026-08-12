import { registerUiModule, renderUiModule } from "../uiModuleRegistry.js";
import { escapeHtml } from "../utils/html.js";

export const LINK_BUSINESS_COLUMN_GROUPS = [
  { key: "link", label: "链接信息", columns: [
    { key: "image", label: "主图" }, { key: "name", label: "链接名称", sortable: true },
    { key: "platform", label: "平台", sortable: true }, { key: "shop", label: "店铺", sortable: true },
    { key: "goodsId", label: "商品ID" }, { key: "owner", label: "负责人", sortable: true },
  ] },
  { key: "sales", label: "ERP销售指标", note: "来自链接利润销售事实", columns: [
    { key: "salesAmount", label: "销售额", sortable: true }, { key: "quantity", label: "销量", sortable: true },
  ] },
  { key: "platform-sales", label: "平台支付指标", note: "来自平台经营快照，不与ERP销售合并", columns: [
    { key: "payQuantity", label: "支付件数", sortable: true }, { key: "payBuyerCount", label: "支付买家数", sortable: true },
  ] },
  { key: "profit", label: "利润指标", note: "来自链接利润销售事实", columns: [
    { key: "costAmount", label: "成本", sortable: true }, { key: "profitAmount", label: "利润", sortable: true },
    { key: "profitMargin", label: "利润率", sortable: true },
  ] },
  { key: "traffic", label: "平台流量指标", note: "各平台字段覆盖不同，无数据不显示为0", columns: [
    { key: "viewCount", label: "浏览量", sortable: true }, { key: "visitorCount", label: "访客数", sortable: true },
    { key: "favoriteCount", label: "收藏", sortable: true }, { key: "cartCount", label: "加购", sortable: true },
  ] },
  { key: "conversion", label: "平台转化指标", columns: [{ key: "conversionRate", label: "转化率", sortable: true }] },
  { key: "status", label: "经营状态", columns: [
    { key: "growthStatus", label: "增长状态", sortable: true }, { key: "healthStatus", label: "健康状态", sortable: true },
    { key: "hospitalStatus", label: "医院状态", sortable: true }, { key: "archiveStatus", label: "档案状态", sortable: true },
  ] },
];

export const LINK_BUSINESS_COLUMNS = LINK_BUSINESS_COLUMN_GROUPS.flatMap((group) => group.columns.map((column) => ({ ...column, group: group.key })));
export const DEFAULT_LINK_BUSINESS_FIELDS = ["image", "name", "platform", "shop", "salesAmount", "quantity", "profitAmount", "profitMargin", "growthStatus", "healthStatus", "archiveStatus"];

const statusNames = { better: "增长", stable: "稳定", worse: "下滑", no_data: "暂无数据", insufficient_data: "数据不足",
  growing: "健康", attention: "需关注", risk: "风险", healthy: "健康", diagnosis: "待诊断", treatment: "改善中",
  observation: "观察中", none: "无问题", active: "正常", paused: "暂停", archived: "归档" };
function status(value, type) { const normalized = value || "no_data"; return `<span class="link-table-status is-${escapeHtml(normalized)}" data-status-type="${escapeHtml(type)}">${escapeHtml(statusNames[normalized] || normalized)}</span>`; }
function number(metric) { return metric?.noData ? "暂无数据" : Number(metric?.value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 }); }
function money(metric) { return metric?.noData ? "暂无数据" : `¥${number(metric)}`; }
function percent(metric) { return metric?.noData ? "暂无数据" : `${(Number(metric?.value || 0) * 100).toFixed(2)}%`; }

export function renderLinkBusinessTable({ items = [], pagination = {}, fields = DEFAULT_LINK_BUSINESS_FIELDS, sort = {}, loading = false } = {}) {
  const definitions = new Map(LINK_BUSINESS_COLUMNS.map((column) => [column.key, column]));
  const visible = fields.filter((field) => definitions.has(field));
  const cell = (item, key) => ({
    image: renderUiModule("link_image", { src: item.imageUrl, alt: item.name, size: "compact" }),
    name: `<button type="button" class="link-data-name" data-open-connection="${escapeHtml(item.id)}"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.platformGoodsId || "")}</small></button>`,
    platform: escapeHtml(item.platform || "—"), shop: escapeHtml(item.shopName || "—"), goodsId: escapeHtml(item.platformGoodsId || "—"), owner: escapeHtml(item.ownerName || "未分配"),
    salesAmount: money(item.erp?.salesAmount), quantity: number(item.erp?.quantity), costAmount: money(item.erp?.costAmount),
    profitAmount: money(item.erp?.profitAmount), profitMargin: percent(item.erp?.profitMargin), payQuantity: number(item.platformMetrics?.payQuantity),
    payBuyerCount: number(item.platformMetrics?.payBuyerCount), viewCount: number(item.platformMetrics?.viewCount),
    visitorCount: number(item.platformMetrics?.visitorCount), favoriteCount: number(item.platformMetrics?.favoriteCount),
    cartCount: number(item.platformMetrics?.cartCount), conversionRate: percent(item.platformMetrics?.conversionRate),
    growthStatus: `${status(item.growthStatus, "growth")}${item.growthRate == null ? "" : `<small>${(Number(item.growthRate) * 100).toFixed(1)}%</small>`}`,
    healthStatus: `${status(item.healthStatus, "health")}${item.healthScore == null ? "" : `<small>${Number(item.healthScore)}分</small>`}`,
    hospitalStatus: status(item.hospitalStatus, "hospital"), archiveStatus: status(item.archiveStatus, "archive"),
  })[key] ?? "—";
  const headers = visible.map((key) => { const column = definitions.get(key); const active = sort.field === key;
    return `<th>${column.sortable ? `<button type="button" data-link-business-sort="${escapeHtml(key)}">${escapeHtml(column.label)}${active ? (sort.direction === "asc" ? " ↑" : " ↓") : " ↕"}</button>` : escapeHtml(column.label)}</th>`; }).join("");
  return `<section class="link-business-table-module" data-module-key="link_business_table">
    ${loading ? `<div class="empty-state">正在汇总链接经营数据…</div>` : items.length ? `<div class="link-business-table-scroll"><table><thead><tr>${headers}<th>操作</th></tr></thead><tbody>${items.map((item) => `<tr>${visible.map((key) => `<td data-field="${escapeHtml(key)}">${cell(item, key)}</td>`).join("")}<td><button type="button" class="text-button" data-open-connection="${escapeHtml(item.id)}">查看详情</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state"><strong>暂无符合条件的经营链接</strong><p>可调整时间、指标或筛选条件。</p></div>`}
    <footer><span>第 ${Number(pagination.page || 1)} / ${Number(pagination.totalPages || 1)} 页 · 共 ${Number(pagination.total || 0)} 条</span><div><button type="button" class="secondary-button" data-link-business-page="${Number(pagination.page || 1) - 1}" ${(pagination.page || 1) <= 1 ? "disabled" : ""}>上一页</button><button type="button" class="secondary-button" data-link-business-page="${Number(pagination.page || 1) + 1}" ${(pagination.page || 1) >= (pagination.totalPages || 1) ? "disabled" : ""}>下一页</button></div></footer>
  </section>`;
}

registerUiModule({ moduleKey: "link_business_table", name: "LinkBusinessTable", domain: "business_links",
  description: "按经营指标提供服务端聚合、排序、筛选和分页的全部链接分析表。", render: renderLinkBusinessTable,
  configSchema: { fields: "string[]", pageSize: "number" }, dependencies: ["QueryLinkBusinessTable", "LinkImage", "BusinessLink"] });
