import { registerUiModule, renderUiModule } from "../uiModuleRegistry.js";
import { escapeHtml } from "../utils/html.js";
import "./linkImage.js";

export const LINK_BUSINESS_COLUMN_GROUPS = [
  { key: "link", label: "链接信息", columns: [
    { key: "image", label: "主图" }, { key: "name", label: "链接名称", sortable: true },
    { key: "platform", label: "平台", sortable: true }, { key: "shop", label: "店铺", sortable: true },
    { key: "goodsId", label: "商品ID" }, { key: "url", label: "链接地址" },
    { key: "category", label: "商品类目", sortable: true }, { key: "platformStatus", label: "链接状态", sortable: true },
    { key: "owner", label: "负责人", sortable: true },
  ] },
  { key: "platform-product", label: "平台商品属性", note: "来自平台经营数据导入文件", columns: [
    { key: "productType", label: "商品类型", sortable: true }, { key: "productStatus", label: "商品状态", sortable: true },
    { key: "productTags", label: "商品标签", sortable: true },
  ] },
  { key: "period", label: "平台数据周期", note: "当前查询范围内实际纳入的平台经营快照周期", columns: [
    { key: "statisticsDate", label: "统计日期", sortable: true },
    { key: "periodStart", label: "周期开始", sortable: true }, { key: "periodEnd", label: "周期结束", sortable: true },
  ] },
  { key: "sales", label: "ERP销售指标", note: "来自链接利润销售事实", columns: [
    { key: "salesAmount", label: "销售额", sortable: true }, { key: "quantity", label: "销量", sortable: true },
  ] },
  { key: "platform-sales", label: "平台支付指标", note: "来自平台经营快照，不与ERP销售合并", columns: [
    { key: "payAmount", label: "平台支付金额", sortable: true }, { key: "payQuantity", label: "支付件数", sortable: true },
    { key: "payBuyerCount", label: "支付买家数", sortable: true }, { key: "refundAmount", label: "成功退款金额", sortable: true },
    { key: "conversionRate", label: "商品支付转化率", sortable: true },
  ] },
  { key: "profit", label: "利润指标", note: "来自链接利润销售事实", columns: [
    { key: "costAmount", label: "成本", sortable: true }, { key: "profitAmount", label: "利润", sortable: true },
    { key: "profitMargin", label: "利润率", sortable: true },
  ] },
  { key: "traffic", label: "平台流量指标", note: "各平台字段覆盖不同，无数据不显示为0", columns: [
    { key: "viewCount", label: "浏览量", sortable: true }, { key: "visitorCount", label: "访客数", sortable: true },
    { key: "clickCount", label: "点击量", sortable: true }, { key: "averageStayDuration", label: "平均停留时长", sortable: true },
    { key: "bounceRate", label: "商品详情页跳出率", sortable: true }, { key: "visitorValue", label: "访客平均价值", sortable: true },
  ] },
  { key: "interaction", label: "平台互动指标", columns: [
    { key: "favoriteCount", label: "商品收藏人数", sortable: true }, { key: "cartCount", label: "商品加购数", sortable: true },
    { key: "cartBuyerCount", label: "商品加购人数", sortable: true },
  ] },
  { key: "order", label: "平台下单指标", columns: [
    { key: "orderBuyerCount", label: "下单买家数", sortable: true }, { key: "orderQuantity", label: "下单件数", sortable: true },
    { key: "orderAmount", label: "下单金额", sortable: true }, { key: "orderConversionRate", label: "下单转化率", sortable: true },
  ] },
  { key: "buyer", label: "平台买家结构", columns: [
    { key: "payNewBuyerCount", label: "支付新买家数", sortable: true },
    { key: "payOldBuyerCount", label: "支付老买家数", sortable: true },
    { key: "oldBuyerPayAmount", label: "老买家支付金额", sortable: true },
  ] },
  { key: "promotion", label: "平台活动与累计", note: "累计指标在查询范围内取最大累计值", columns: [
    { key: "juHuaSuanPayAmount", label: "聚划算支付金额", sortable: true },
    { key: "annualPayAmount", label: "年累计支付金额", sortable: true },
    { key: "monthlyPayAmount", label: "月累计支付金额", sortable: true },
    { key: "monthlyPayQuantity", label: "月累计支付件数", sortable: true },
  ] },
  { key: "search", label: "搜索引导指标", columns: [
    { key: "searchPayConversionRate", label: "搜索引导支付转化率", sortable: true },
    { key: "searchVisitorCount", label: "搜索引导访客数", sortable: true },
    { key: "searchPayBuyerCount", label: "搜索引导支付买家数", sortable: true },
  ] },
  { key: "structured-detail", label: "结构化详情指标", columns: [
    { key: "structuredDetailConversionRate", label: "结构化详情引导转化率", sortable: true },
    { key: "structuredDetailTransactionShare", label: "结构化详情引导成交占比", sortable: true },
  ] },
  { key: "competition", label: "平台竞争指标", note: "多条快照按当前查询周期取平均值", columns: [
    { key: "competitionScore", label: "竞争力评分", sortable: true },
  ] },
  { key: "status", label: "经营状态", columns: [
    { key: "growthStatus", label: "增长状态", sortable: true }, { key: "archiveStatus", label: "档案状态", sortable: true },
  ] },
];

export const LINK_BUSINESS_COLUMNS = LINK_BUSINESS_COLUMN_GROUPS.flatMap((group) => group.columns.map((column) => ({ ...column, group: group.key })));
export const DEFAULT_LINK_BUSINESS_FIELDS = ["image", "name", "platform", "shop", "salesAmount", "quantity", "profitAmount", "profitMargin", "growthStatus", "archiveStatus"];

const LEFT_ALIGNED_FIELDS = new Set(["name", "platform", "shop", "goodsId", "url", "category", "platformStatus", "productType", "productStatus", "productTags", "owner"]);
const CENTER_ALIGNED_FIELDS = new Set(["image", "statisticsDate", "periodStart", "periodEnd", "growthStatus", "archiveStatus"]);
function fieldAlignment(field) {
  if (LEFT_ALIGNED_FIELDS.has(field)) return "left";
  if (CENTER_ALIGNED_FIELDS.has(field) || field === "actions") return "center";
  return "right";
}

const statusNames = { better: "增长", stable: "稳定", worse: "下滑", no_data: "暂无数据", insufficient_data: "数据不足",
  growing: "向好", attention: "需关注", risk: "风险",
  observation: "观察中", none: "无问题", active: "正常", paused: "暂停", archived: "归档", historical: "历史/退出经营" };
function status(value, type) { const normalized = value || "no_data"; return `<span class="link-table-status is-${escapeHtml(normalized)}" data-status-type="${escapeHtml(type)}">${escapeHtml(statusNames[normalized] || normalized)}</span>`; }
function number(metric) { return metric?.noData ? "暂无数据" : Number(metric?.value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 }); }
function money(metric) { return metric?.noData ? "暂无数据" : `¥${number(metric)}`; }
function percent(metric) { return metric?.noData ? "暂无数据" : `${(Number(metric?.value || 0) * 100).toFixed(2)}%`; }
function seconds(metric) { return metric?.noData ? "暂无数据" : `${number(metric)}秒`; }
function externalLink(value) {
  const url = String(value ?? "").trim();
  if (!url) return "—";
  return /^https?:\/\//i.test(url) ? `<a class="text-button" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">打开链接</a>` : escapeHtml(url);
}

export function renderLinkBusinessTable({ items = [], pagination = {}, fields = DEFAULT_LINK_BUSINESS_FIELDS, sort = {}, loading = false } = {}) {
  const definitions = new Map(LINK_BUSINESS_COLUMNS.map((column) => [column.key, column]));
  const visible = fields.filter((field) => definitions.has(field));
  const cell = (item, key) => ({
    image: renderUiModule("link_image", { src: item.imageUrl, alt: item.name, size: "compact", hoverPreview: true }),
    name: `<button type="button" class="link-data-name" data-open-connection="${escapeHtml(item.id)}"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.platformGoodsId || "")}</small></button>`,
    platform: escapeHtml(item.platform || "—"), shop: escapeHtml(item.shopName || "—"), goodsId: escapeHtml(item.platformGoodsId || "—"),
    url: externalLink(item.canonicalUrl), category: escapeHtml(item.category || "—"), platformStatus: escapeHtml(item.platformStatus || "—"),
    statisticsDate: escapeHtml(item.platformMetrics?.statisticsDate || "暂无数据"),
    productType: escapeHtml(item.platformMetrics?.productType || "暂无数据"),
    productStatus: escapeHtml(item.platformMetrics?.productStatus || "暂无数据"),
    productTags: escapeHtml(item.platformMetrics?.productTags || "暂无数据"),
    periodStart: escapeHtml(item.platformPeriodStart || "暂无数据"), periodEnd: escapeHtml(item.platformPeriodEnd || "暂无数据"),
    owner: escapeHtml(item.ownerName || "未分配"),
    salesAmount: money(item.erp?.salesAmount), quantity: number(item.erp?.quantity), costAmount: money(item.erp?.costAmount),
    profitAmount: money(item.erp?.profitAmount), profitMargin: percent(item.erp?.profitMargin), payAmount: money(item.platformMetrics?.payAmount),
    payQuantity: number(item.platformMetrics?.payQuantity), payBuyerCount: number(item.platformMetrics?.payBuyerCount),
    refundAmount: money(item.platformMetrics?.refundAmount), viewCount: number(item.platformMetrics?.viewCount),
    visitorCount: number(item.platformMetrics?.visitorCount), clickCount: number(item.platformMetrics?.clickCount),
    averageStayDuration: seconds(item.platformMetrics?.averageStayDuration), bounceRate: percent(item.platformMetrics?.bounceRate),
    visitorValue: money(item.platformMetrics?.visitorValue), favoriteCount: number(item.platformMetrics?.favoriteCount),
    cartCount: number(item.platformMetrics?.cartCount), cartBuyerCount: number(item.platformMetrics?.cartBuyerCount),
    orderBuyerCount: number(item.platformMetrics?.orderBuyerCount), orderQuantity: number(item.platformMetrics?.orderQuantity),
    orderAmount: money(item.platformMetrics?.orderAmount), orderConversionRate: percent(item.platformMetrics?.orderConversionRate),
    conversionRate: percent(item.platformMetrics?.conversionRate), payNewBuyerCount: number(item.platformMetrics?.payNewBuyerCount),
    payOldBuyerCount: number(item.platformMetrics?.payOldBuyerCount), oldBuyerPayAmount: money(item.platformMetrics?.oldBuyerPayAmount),
    juHuaSuanPayAmount: money(item.platformMetrics?.juHuaSuanPayAmount), annualPayAmount: money(item.platformMetrics?.annualPayAmount),
    monthlyPayAmount: money(item.platformMetrics?.monthlyPayAmount), monthlyPayQuantity: number(item.platformMetrics?.monthlyPayQuantity),
    searchPayConversionRate: percent(item.platformMetrics?.searchPayConversionRate),
    searchVisitorCount: number(item.platformMetrics?.searchVisitorCount),
    searchPayBuyerCount: number(item.platformMetrics?.searchPayBuyerCount),
    structuredDetailConversionRate: percent(item.platformMetrics?.structuredDetailConversionRate),
    structuredDetailTransactionShare: percent(item.platformMetrics?.structuredDetailTransactionShare),
    competitionScore: number(item.platformMetrics?.competitionScore),
    growthStatus: `${status(item.growthStatus, "growth")}${item.growthRate == null ? "" : `<small>${(Number(item.growthRate) * 100).toFixed(1)}%</small>`}`,
    archiveStatus: status(item.archiveStatus, "archive"),
  })[key] ?? "—";
  const headers = visible.map((key) => { const column = definitions.get(key); const active = sort.field === key;
    return `<th data-field="${escapeHtml(key)}" data-align="${fieldAlignment(key)}">${column.sortable ? `<button type="button" data-link-business-sort="${escapeHtml(key)}">${escapeHtml(column.label)}${active ? (sort.direction === "asc" ? " ↑" : " ↓") : " ↕"}</button>` : escapeHtml(column.label)}</th>`; }).join("");
  return `<section class="link-business-table-module" data-module-key="link_business_table">
    ${loading ? `<div class="empty-state">正在汇总链接经营数据…</div>` : items.length ? `<div class="link-business-table-scroll"><table><thead><tr>${headers}<th data-field="actions" data-align="center">操作</th></tr></thead><tbody>${items.map((item) => `<tr>${visible.map((key) => `<td data-field="${escapeHtml(key)}" data-align="${fieldAlignment(key)}">${cell(item, key)}</td>`).join("")}<td data-field="actions" data-align="center"><button type="button" class="text-button" data-open-connection="${escapeHtml(item.id)}">查看详情</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state"><strong>暂无符合条件的经营链接</strong><p>可调整时间、指标或筛选条件。</p></div>`}
    <footer><span>第 ${Number(pagination.page || 1)} / ${Number(pagination.totalPages || 1)} 页 · 共 ${Number(pagination.total || 0)} 条</span><div><button type="button" class="secondary-button" data-link-business-page="${Number(pagination.page || 1) - 1}" ${(pagination.page || 1) <= 1 ? "disabled" : ""}>上一页</button><button type="button" class="secondary-button" data-link-business-page="${Number(pagination.page || 1) + 1}" ${(pagination.page || 1) >= (pagination.totalPages || 1) ? "disabled" : ""}>下一页</button></div></footer>
  </section>`;
}

registerUiModule({ moduleKey: "link_business_table", name: "LinkBusinessTable", domain: "business_links",
  description: "按经营指标提供服务端聚合、排序、筛选和分页的全部链接分析表。", render: renderLinkBusinessTable,
  configSchema: { fields: "string[]", pageSize: "number" }, dependencies: ["QueryLinkBusinessTable", "LinkImage", "BusinessLink"] });
