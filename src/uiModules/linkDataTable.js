import { registerUiModule, renderUiModule } from "../uiModuleRegistry.js";
import { escapeHtml } from "../utils/html.js";

export const LINK_DATA_COLUMNS = [
  { key: "image", label: "主图" }, { key: "name", label: "链接名称", sortable: true },
  { key: "platform", label: "平台", sortable: true }, { key: "shop", label: "店铺", sortable: true },
  { key: "goodsId", label: "商品ID" }, { key: "owner", label: "负责人" },
  { key: "yesterdaySales", label: "昨日销售", sortable: true }, { key: "sales7d", label: "7日销售", sortable: true },
  { key: "sales30d", label: "30日销售", sortable: true }, { key: "selectedSales", label: "所选周期销售", sortable: true },
  { key: "growthStatus", label: "增长状态" }, { key: "healthStatus", label: "健康状态" },
  { key: "hospitalStatus", label: "问题状态" }, { key: "archiveStatus", label: "档案状态", sortable: true },
];
export const DEFAULT_MINE_LINK_FIELDS = ["image", "name", "platform", "shop", "yesterdaySales", "sales7d", "sales30d", "growthStatus", "healthStatus", "hospitalStatus"];

const money = (metric) => metric?.noData ? "暂无数据" : `¥${Number(metric?.value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
const statusLabel = {
  better: "增长", stable: "稳定", worse: "下滑", no_data: "暂无数据", insufficient_data: "数据不足",
  growing: "健康", attention: "需关注", risk: "风险", healthy: "健康",
  diagnosis: "待诊断", treatment: "改善中", observation: "观察中", none: "无待处理问题",
  active: "正常", paused: "暂停", archived: "归档",
};
function status(value, type) {
  const normalized = value || "no_data";
  return `<span class="link-table-status is-${escapeHtml(normalized)}" data-status-type="${escapeHtml(type)}">${escapeHtml(statusLabel[normalized] || normalized)}</span>`;
}

export function renderLinkDataTable({ items = [], pagination = {}, fields = DEFAULT_MINE_LINK_FIELDS, columns = LINK_DATA_COLUMNS,
  sort = {}, loading = false, showOwner = false } = {}) {
  const visible = fields.filter((field) => showOwner || field !== "owner");
  const definitions = new Map(columns.map((item) => [item.key, item]));
  const cell = (item, key) => ({
    image: renderUiModule("link_image", { src: item.imageUrl, alt: item.name, size: "compact" }),
    name: `<button type="button" class="link-data-name" data-open-connection="${escapeHtml(item.id)}"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.platformGoodsId || "")}</small></button>`,
    platform: escapeHtml(item.platform || "—"), shop: escapeHtml(item.shopName || "—"), goodsId: escapeHtml(item.platformGoodsId || "—"),
    owner: escapeHtml(item.ownerName || "未分配"), yesterdaySales: money(item.sales?.yesterday), sales7d: money(item.sales?.sevenDays),
    sales30d: money(item.sales?.thirtyDays), selectedSales: money(item.sales?.selected),
    growthStatus: `${status(item.growthStatus, "growth")}${item.growthRate == null ? "" : `<small>${Number(item.growthRate * 100).toFixed(1)}%</small>`}`,
    healthStatus: `${status(item.healthStatus, "health")}${item.healthScore == null ? "" : `<small>${Number(item.healthScore)}分</small>`}`,
    hospitalStatus: status(item.hospitalStatus, "hospital"), archiveStatus: status(item.archiveStatus, "archive"),
  })[key] ?? "—";
  const headers = visible.map((key) => { const column = definitions.get(key); if (!column) return "";
    const active = sort.field === key; return `<th>${column.sortable ? `<button type="button" data-link-table-sort="${escapeHtml(key)}">${escapeHtml(column.label)}${active ? (sort.direction === "asc" ? " ↑" : " ↓") : " ↕"}</button>` : escapeHtml(column.label)}</th>`; }).join("");
  return `<section class="link-data-table-module" data-module-key="link_data_table">${loading ? `<div class="empty-state">正在读取链接经营数据…</div>` : items.length ? `<div class="link-data-table-scroll"><table><thead><tr>${headers}<th>操作</th></tr></thead><tbody>${items.map((item) => `<tr>${visible.map((key) => `<td>${cell(item, key)}</td>`).join("")}<td><button type="button" class="text-button" data-open-connection="${escapeHtml(item.id)}">查看详情</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state"><strong>暂无符合条件的链接</strong><p>可调整搜索、筛选或时间范围。</p></div>`}
    <footer><span>第 ${Number(pagination.page || 1)} / ${Number(pagination.totalPages || 1)} 页 · 共 ${Number(pagination.total || 0)} 条</span><div><button type="button" class="secondary-button" data-link-table-page="${Number(pagination.page || 1) - 1}" ${(pagination.page || 1) <= 1 ? "disabled" : ""}>上一页</button><button type="button" class="secondary-button" data-link-table-page="${Number(pagination.page || 1) + 1}" ${(pagination.page || 1) >= (pagination.totalPages || 1) ? "disabled" : ""}>下一页</button></div></footer>
  </section>`;
}

registerUiModule({ moduleKey: "link_data_table", name: "LinkDataTable", domain: "business_links",
  description: "展示按权限、时间范围和服务端分页查询的高密度链接经营数据。", render: renderLinkDataTable,
  configSchema: { pageSize: "number", fields: "string[]", hideOwner: "boolean" },
  dependencies: ["QueryLinkDataTable", "LinkImage", "BusinessLink", "ConnectionSkuSalesFact"] });
