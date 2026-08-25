import {
  createId,
  changeProductSku,
  createPersistentResource,
  createProductFromPendingErpSku,
  createProductsFromPendingErpSkus,
  commitProductImport,
  commitProductV2Import,
  createErpSyncRun,
  bindPlatformSku,
  getNow,
  loadProductSalesLinks,
  loadProductSalesSummaries,
  loadPendingErpSkus,
  loadErpSyncRun,
  loadProductV2Import,
  loadProductV2Preview,
  loadUnmatchedPlatformSkus,
  listErpSyncRuns,
  parseProductImport,
  parseProductV2Import,
  previewWangdianGoods,
  previewProductSkuChange,
  recalculateErpSyncRun,
  resolveAssetUrl,
  updatePersistentResource,
  uploadImageFile,
  validateProductImportBatch,
  validateProductV2Import,
  markPlatformSku,
  loadProductManagementOverview,
  loadProductBusinessDashboard,
  loadProductSalesDistribution,
  loadProductShopSandbox,
  loadProductHealthAnalysis,
  loadProductBusinessDiagnosis,
  loadProductInsightCenter,
  createProductInsight,
  updateProductInsight,
  loadProductImprovementCenter,
  loadProductManagementDetail,
  loadProductDailySales,
  changeProductLifecycle,
  evaluateProductManagementHealth,
  createProductImprovementAction,
  loadProductCenterV2Skus,
  loadProductCenterV2Metadata,
  loadProductCenterV2SkuDetail,
  loadProductComboSkus,
  loadProductComboSkuDetail,
  createProductProfileForErpSku,
  loadProductMarketingAsset,
  saveProductMarketingAsset,
  exportProductMarketingAsset,
  createProductHealthAction,
  recordProductImprovementResult,
  loadProductStrategy,
  saveProductStrategySection,
  addProductStrategyStep,
  updateProductStrategyStep,
  createProductStrategyAction,
} from "./services/productCenterService.js";
import { getCurrentUser, state } from "./stores/appStore.js";
import { getProcessInstanceBusinessStatus, getProcessInstanceOwner } from "./data/processInstanceSelectors.js";
import { canAccessModule, hasPermission } from "../shared/permissions.js";
import { normalizeProductSkuCode } from "./data/productSku.js";
import { escapeHtml } from "./utils/html.js";
import { renderUiModule } from "./uiModuleRegistry.js";
import "./uiModules/productWorkspaceModules.js";
import "./uiModules/productMarketingAsset.js";
import "./uiModules/productDailySales.js";
import { renderProductSalesPresetButtons } from "./uiModules/productSalesDistribution.js";
import "./uiModules/productShopSandbox.js";

const productStatuses = ["开发中", "上架", "成长期", "成熟期", "风险期", "淘汰", "待上架", "在售", "停售", "清仓", "已归档"];
let filters = { query: "", brand: "", category: "", status: "", erpStatus: "", platform: "", stockStatus: "" };
let productSort = "updated-desc";
let productViewMode = "card";
let productBusinessZone = "all";
let productPage = 1;
const productPageSize = 48;
let productDetailTab = "basic";
let productDetailId = "";
let modalState = null;
let skuChangeState = null;
let importState = null;
let erpSyncState = {
  loading: false,
  runs: [],
  active: null,
  error: "",
  masterImportMode: "incremental",
};
let productSalesState = { productId: "", loading: false, loaded: false, rows: [], error: "" };
let productSalesSummaryState = { loading: false, loaded: false, rows: [], error: "" };
let unmatchedSkuState = { loading: false, loaded: false, rows: [], total: 0, query: "", error: "" };
let platformProductLinkState = { skuId: "", query: "", selectedProductId: "", error: "" };
let productSubmodule = "business-dashboard";
let pendingSkuState = { loading: false, loaded: false, rows: [], query: "", error: "", notice: "" };
let comboSkuState = { loading: false, loaded: false, rows: [], detail: null, search: "", includeHistorical: false, viewMode: "card", page: 1, pageSize: 20, pagination: { total: 0 }, error: "" };
let selectedPendingSkuIds = new Set();
let platformPreviewRequestId = 0;
let productManagementState = { overview: null, details: new Map(), loadingOverview: false, loadingProductId: "", error: "", notice: "" };
let productSkuV2State = { loading: false, loaded: false, rows: [], detail: null, detailId: "", search: "", includeUnarchived: false, includeHistorical: false, profileStatus: "all", erpStatus: "", brand: "", category: "", lifecycleStatus: "", operatingLifecycleStatus: "", platform: "", stockStatus: "", businessZone: "all", sort: "updated-desc", facets: { brands: [], categories: [], lifecycleStatuses: [], operatingLifecycleStatuses: [], platforms: [] }, page: 1, pageSize: 50, pagination: { total: 0 }, summary: { total: 0, profiled: 0, unprofiled: 0, historical: 0, businessZones: {} }, error: "", notice: "" };
let productSkuV2RequestId = 0;
let productSkuV2SearchTimer = 0;
let productSkuV2MetadataLoading = false;
let productWorkspaceState = { activeTab: "overview", sections: {}, marketingMode: "read", marketingNotice: "", dailySales: { data: null, loading: false, loaded: false, rangePreset: "30d", error: "" } };
let productBusinessDashboardState = { readModel: null, loading: false, error: "" };
let productBusinessViewMode = "table";
let productBusinessSearchTimer = 0;
let productBusinessRefreshPending = false;
let productSalesDistributionState = { range: { preset: "30d" }, includeHistorical: false, items: [], summary: {}, selectedGroup: 0, loading: false, loaded: false, error: "" };
let productShopSandboxState = { range: { preset: "30d" }, shopId: "", shops: [], selectedShop: null, items: [], summary: {}, segment: "all", sortMode: "sales", loading: false, loaded: false, error: "" };
let productBusinessFilters = { query: "", brand: "", category: "", lifecycle: "", status: "", healthStatus: "", inventoryStatus: "", ownerId: "", includeHistorical: false, range: "30d", periodStart: "", periodEnd: "", sortBy: "updatedAt", sortDirection: "desc", page: 1, pageSize: 30 };
let productBusinessVisibleMetrics = new Set(["sales", "structure", "inventory", "profit", "health", "diagnosis"]);

function canViewProducts() { return hasPermission(getCurrentUser(), "products.view"); }
function canViewSkus() { return hasPermission(getCurrentUser(), "skus.view"); }
function canViewCombos() { return hasPermission(getCurrentUser(), "combos.view"); }

function ensureAuthorizedProductSubmodule() {
  const allowed = new Set([
    ...(canViewProducts() ? ["business-dashboard", "business-cockpit", "product-sandbox"] : []),
    ...(canViewSkus() ? ["sku-management", "pending-skus"] : []),
    ...(canViewCombos() ? ["combo-skus"] : []),
  ]);
  if (!allowed.has(productSubmodule)) productSubmodule = allowed.values().next().value ?? "";
  return allowed;
}

const productBusinessMetricGroups = [
  { key: "sales", label: "销售贡献", count: 5 },
  { key: "structure", label: "产品结构", count: 2 },
  { key: "inventory", label: "库存经营", count: 3 },
  { key: "profit", label: "利润表现", count: 3 },
  { key: "health", label: "产品健康", count: 1 },
  { key: "diagnosis", label: "经营诊断", count: 1 },
];

function getRouteProductId() {
  const match = window.location.hash.replace(/^#/, "").match(/^products\/(?!sku\/|combo-skus(?:\/|$))(.+)$/);
  return match ? decodeURIComponent(match[1]) : "";
}

function isComboSkuRoute() {
  return /^products\/combo-skus(?:\/|$)/u.test(window.location.hash.replace(/^#/, ""));
}

function getRouteErpSkuId() {
  const match = window.location.hash.replace(/^#/, "").match(/^products\/sku\/(.+)$/);
  return match ? decodeURIComponent(match[1]) : "";
}

function findName(items, id, fallback = "未设置") {
  return items.find((item) => item.id === id)?.name ?? fallback;
}

function formatDateTime(value) {
  if (!value) return "未设置";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? escapeHtml(value) : date.toLocaleString("zh-CN", { hour12: false });
}

function renderImage(product, className = "product-list-image") {
  return product.mainImage
    ? `<img class="${className}" src="${escapeHtml(resolveAssetUrl(product.mainImage))}" alt="${escapeHtml(product.name)}" loading="lazy" />`
    : `<span class="${className} product-image-placeholder">无图</span>`;
}

function getRelatedActions(productId) {
  const actionIds = new Set(state.actionProducts.filter((item) => item.productId === productId).map((item) => item.actionId));
  return state.processInstances.filter((instance) => actionIds.has(instance.id));
}

function buildProductUiIndex() {
  const goodsById = new Map((state.erpGoods ?? []).map((item) => [item.id, item]));
  const erpByProduct = new Map((state.productErpMappings ?? []).map((mapping) => [mapping.productId, {
    mapping,
    goods: goodsById.get(mapping.erpGoodsId) ?? null,
    stock: mapping.latestStateJson && typeof mapping.latestStateJson === "object" ? mapping.latestStateJson : {},
  }]));
  const salesByProduct = new Map((productSalesSummaryState.rows ?? []).map((summary) => [
    summary.productId,
    {
      platforms: new Set(summary.platforms ?? []),
      platformCount: Number(summary.platformCount) || 0,
      shopCount: Number(summary.shopCount) || 0,
      linkCount: Number(summary.linkCount) || 0,
    },
  ]));
  const validActionIds = new Set(state.processInstances.map((item) => item.id));
  const actionIdsByProduct = new Map();
  for (const relation of state.actionProducts ?? []) {
    if (!validActionIds.has(relation.actionId)) continue;
    const actionIds = actionIdsByProduct.get(relation.productId) ?? new Set();
    actionIds.add(relation.actionId);
    actionIdsByProduct.set(relation.productId, actionIds);
  }
  const managementByProduct = new Map((productManagementState.overview?.items ?? []).map((item) => [item.id, item]));
  return { erpByProduct, salesByProduct, actionIdsByProduct, managementByProduct };
}

function getFilteredProducts(index) {
  const query = filters.query.trim().toLowerCase();
  const normalizedSkuQuery = normalizeProductSkuCode(filters.query);
  return state.products.filter((product) => {
    const matchesQuery = query === ""
      || String(product.name ?? "").toLowerCase().includes(query)
      || normalizeProductSkuCode(product.skuCode).includes(normalizedSkuQuery);
    const erp = getProductErpContext(product.id, index);
    const platforms = getProductSalesSummary(product.id, index).platforms;
    const stock = Number(erp.stock.currentStock ?? erp.stock.stock ?? 0);
    const matchesStock = !filters.stockStatus
      || (filters.stockStatus === "available" && stock > 10)
      || (filters.stockStatus === "low" && stock > 0 && stock <= 10)
      || (filters.stockStatus === "empty" && stock <= 0);
    const businessZone = index.managementByProduct.get(product.id)?.businessZone ?? null;
    return matchesQuery && (productBusinessZone === "all" || businessZone === productBusinessZone) && (!filters.brand || product.brand === filters.brand) &&
      (!filters.category || product.category === filters.category) && (!filters.status || product.status === filters.status) &&
      (!filters.erpStatus || (filters.erpStatus === "linked" ? erp.mapping !== null : erp.mapping === null)) &&
      (!filters.platform || platforms.has(filters.platform)) && matchesStock;
  });
}

const productTextCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

function getProductSortNumber(product, index, field) {
  const stock = getProductErpContext(product.id, index).stock;
  const actualStock = Number(stock.actualStock ?? 0) || 0;
  if (field === "stock") return actualStock;
  if (field === "capital") return actualStock * (Number(stock.costPrice ?? 0) || 0);
  return Number(stock.totalSales ?? 0) || 0;
}

function getSortedProducts(products, index) {
  const stableSkuCompare = (left, right) => productTextCollator.compare(String(left.skuCode ?? ""), String(right.skuCode ?? ""));
  return [...products].sort((left, right) => {
    let comparison = 0;
    if (productSort.startsWith("stock-")) comparison = getProductSortNumber(left, index, "stock") - getProductSortNumber(right, index, "stock");
    else if (productSort.startsWith("sales-")) comparison = getProductSortNumber(left, index, "sales") - getProductSortNumber(right, index, "sales");
    else if (productSort.startsWith("capital-")) comparison = getProductSortNumber(left, index, "capital") - getProductSortNumber(right, index, "capital");
    else {
      const field = productSort === "created-desc" ? "createdAt" : "updatedAt";
      comparison = (Date.parse(left[field]) || 0) - (Date.parse(right[field]) || 0);
    }
    return comparison === 0 ? stableSkuCompare(left, right) : comparison * -1;
  });
}

function renderProductBusinessSort() {
  const options = [
    ["updated-desc", "综合"],
    ["sales-desc", "🔥销量"],
    ["stock-desc", "📦库存"],
    ["capital-desc", "💰资金占用"],
    ["created-desc", "🆕新品"],
  ];
  return `<div class="product-business-sort" aria-label="产品经营排序"><span>经营排序：</span>${options.map(([value, label]) => `<button type="button" data-action="set-product-sort" data-product-sort="${value}" class="${productSort === value ? "is-active" : ""}" aria-pressed="${productSort === value}">${label}</button>`).join("")}</div>`;
}

const productBusinessZoneMeta = {
  new: { label: "新品区", description: "新品验证与上市周期", icon: "🆕" },
  hit: { label: "爆款区", description: "持续销售且排名靠前", icon: "🔥" },
  active: { label: "动销区", description: "稳定产生销售", icon: "📈" },
  clearance: { label: "清仓区", description: "有库存且低销或衰退", icon: "📦" },
};

function renderProductBusinessZones(index) {
  const productIds = new Set(state.products.map((item) => item.id));
  const counts = { new: 0, hit: 0, active: 0, clearance: 0 };
  for (const item of index.managementByProduct.values()) {
    if (productIds.has(item.id) && Object.hasOwn(counts, item.businessZone)) counts[item.businessZone] += 1;
  }
  const rules = productManagementState.overview?.businessZoneRules;
  return `<section class="product-business-zones" aria-label="产品经营分区">
    <header><div><h2>产品经营分区</h2><p>基于生命周期、销售、库存和利润数据动态识别，不改变产品生命周期。</p></div>${rules ? `<small>新品周期 ${rules.newProductCycleDays} 天 · 排名阈值前 ${rules.hitTopPercent}%</small>` : ""}</header>
    <div class="product-business-zone-tabs">
      <button type="button" data-action="set-product-zone" data-product-zone="all" class="${productBusinessZone === "all" ? "is-active" : ""}"><span>全部产品</span><strong>${state.products.length}</strong><small>查看完整产品池</small></button>
      ${Object.entries(productBusinessZoneMeta).map(([zone, meta]) => `<button type="button" data-action="set-product-zone" data-product-zone="${zone}" class="${productBusinessZone === zone ? "is-active" : ""}"><span>${meta.icon} ${meta.label}</span><strong>${counts[zone]}</strong><small>${meta.description}</small></button>`).join("")}
    </div>
  </section>`;
}

function businessZoneBadge(zone) {
  const meta = productBusinessZoneMeta[zone];
  return meta ? `<span class="product-zone-badge is-${zone}">${meta.label}</span>` : `<span class="product-zone-badge">待识别</span>`;
}

function getProductErpContext(productId, index = null) {
  if (index) return index.erpByProduct.get(productId) ?? { mapping: null, goods: null, stock: {} };
  const mapping = state.productErpMappings.find((item) => item.productId === productId) ?? null;
  const goods = mapping ? state.erpGoods.find((item) => item.id === mapping.erpGoodsId) ?? null : null;
  const stock = mapping?.latestStateJson && typeof mapping.latestStateJson === "object"
    ? mapping.latestStateJson
    : {};
  return { mapping, goods, stock };
}

function getProductSalesSummary(productId, index = null) {
  const summary = index?.salesByProduct.get(productId) ?? null;
  if (!productSalesSummaryState.loaded) {
    return { loaded: false, platforms: new Set(), platformCount: null, shopCount: null, linkCount: null };
  }
  return summary
    ? { loaded: true, ...summary }
    : { loaded: true, platforms: new Set(), platformCount: 0, shopCount: 0, linkCount: 0 };
}

function formatMetric(value) {
  return value === null || value === undefined || value === "" ? "—" : escapeHtml(value);
}

function formatMoney(value) { return value === null || value === undefined ? "—" : `¥${Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`; }
function formatPercent(value) { return value === null || value === undefined ? "—" : `${(Number(value) * 100).toFixed(1)}%`; }
function healthLabel(status) { return ({ growth: "成长", stable: "稳定", healthy: "健康", attention: "关注", risk: "风险", no_data: "数据不足" })[status] || status || "数据不足"; }

function renderProductManagementOverview() {
  const overview = productManagementState.overview;
  if (!overview) return `<section class="product-v2-overview"><div class="form-note">${productManagementState.loadingOverview ? "正在读取产品经营概览…" : "产品经营概览尚未加载"}</div></section>`;
  const lifecycle = Object.entries(overview.lifecycle || {});
  const ranking = (title, items, risk = false) => `<section class="product-v2-ranking"><h3>${title}</h3>${items?.length ? items.map((item) => `<button type="button" data-action="view-product" data-product-id="${escapeHtml(item.id)}"><span>${escapeHtml(item.name)}</span><strong class="${risk ? "is-risk" : ""}">${item.healthScore ?? "—"}分</strong><small>${escapeHtml(healthLabel(item.healthStatus))}</small></button>`).join("") : `<p>暂无数据</p>`}</section>`;
  return `<section class="product-v2-overview"><header><div><h2>产品经营概览</h2><p>销售、利润、增长与库存健康的统一视图</p></div><strong>${overview.total} 个产品</strong></header><div class="product-lifecycle-distribution">${lifecycle.map(([status,count]) => `<div><span>${escapeHtml(status)}</span><strong>${count}</strong></div>`).join("")}</div><div class="product-v2-rankings">${ranking("成长产品",overview.growth)}${ranking("风险产品",overview.risks,true)}</div></section>`;
}

function uniqueValues(key) {
  return [...new Set(state.products.map((product) => String(product[key] ?? "").trim()).filter(Boolean))].sort();
}

function renderFilterOptions(values, selected, emptyLabel) {
  return `<option value="">${emptyLabel}</option>${values.map((value) => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}`;
}

function renderProductActions(product) {
  return `<div class="table-actions">
    <button class="text-button" type="button" data-action="view-product" data-product-id="${product.id}">查看</button>
    ${hasPermission(getCurrentUser(), "products.manage") ? `<button class="text-button" type="button" data-action="edit-product" data-product-id="${product.id}">编辑</button>` : ""}
    ${product.status !== "已归档" && hasPermission(getCurrentUser(), "products.archive") ? `<button class="text-button danger-text" type="button" data-action="archive-product" data-product-id="${product.id}">归档</button>` : ""}
  </div>`;
}

function renderProductTable(products, index) {
  return `<div class="table-wrap">
    <table class="data-table product-table">
      <thead><tr><th>产品主图</th><th>SKU编码</th><th>产品名称</th><th>经营区</th><th>生命周期</th><th>上架时间</th><th>直接销售额</th><th>实际出货</th><th>出货增长</th><th>直接毛利润</th><th>库存</th><th>负责人</th><th>操作</th></tr></thead>
      <tbody>
        ${products.length === 0 ? `<tr><td colspan="13" class="empty-cell">暂无匹配产品</td></tr>` : products.map((product) => {
          const relatedCount = getRelatedActions(product.id).length;
          const management = index.managementByProduct.get(product.id);
          const business = management?.analysis;
          return `<tr>
            <td>${renderImage(product)}</td><td><strong>${escapeHtml(product.skuCode)}</strong></td><td>${escapeHtml(product.name)}</td>
            <td>${businessZoneBadge(management?.businessZone)}</td><td><span class="status-badge">${escapeHtml(product.status)}</span></td><td>${formatDateTime(management?.listedAt)}</td><td>${formatMoney(business?.finance?.revenue)}</td><td>${formatMetric(business?.sales?.totalPhysicalContribution)}</td><td>${formatPercent(business?.sales?.growth)}</td>
            <td>${formatMoney(business?.finance?.grossProfit)}</td><td>${formatMetric(business?.inventory?.actualStock)}</td><td>${escapeHtml(findName(state.people, product.ownerId))}<small> · ${relatedCount}个行动</small></td>
            <td>${renderProductActions(product)}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  </div>`;
}

function renderProductCards(products, index) {
  if (products.length === 0) return `<div class="product-card-empty">暂无匹配产品</div>`;
  return `<div class="product-card-grid">
    ${products.map((product) => {
      const erp = getProductErpContext(product.id, index);
      const sales = getProductSalesSummary(product.id, index);
      const management = index.managementByProduct.get(product.id);
      const business = management?.analysis;
      return `
      <article class="product-archive-card" data-action="view-product" data-product-id="${escapeHtml(product.id)}" role="button" tabindex="0" aria-label="查看产品：${escapeHtml(product.name)}">
        <div class="product-archive-card-media">${renderImage(product, "product-card-image")}</div>
        <div class="product-archive-card-body">
          <div class="product-archive-card-heading">
            <h3 title="${escapeHtml(product.name)}">${escapeHtml(product.name)}</h3>
            ${businessZoneBadge(management?.businessZone)}
          </div>
          <div class="product-card-identities">
            <span>SKU <strong>${escapeHtml(product.skuCode || "—")}</strong></span>
            <span>ERP <strong>${escapeHtml(erp.goods?.goodsCode || "—")}</strong></span>
          </div>
          <div class="product-card-metrics">
            <div><strong>${formatMoney(business?.finance?.revenue)}</strong><span>直接销售额</span></div>
            <div><strong>${formatMetric(business?.sales?.totalPhysicalContribution)}</strong><span>30天实际出货</span></div>
            <div><strong>${formatPercent(business?.sales?.growth)}</strong><span>出货增长</span></div>
            <div><strong>${formatMoney(business?.finance?.grossProfit)}</strong><span>直接毛利润</span></div>
            <div><strong>${formatMetric(business?.inventory?.actualStock ?? erp.stock.actualStock)}</strong><span>库存</span></div>
            <div><strong>${sales.loaded ? sales.linkCount : "—"}</strong><span>销售链接</span></div>
          </div>
          <small class="product-card-listed-at">上架时间 ${formatDateTime(management?.listedAt)}</small>
          <div class="product-card-more">
            <button class="icon-button" type="button" data-action="toggle-product-menu" data-product-id="${escapeHtml(product.id)}" aria-label="产品操作">•••</button>
            <div class="product-card-menu" data-product-menu="${escapeHtml(product.id)}" hidden>${renderProductActions(product)}</div>
          </div>
        </div>
      </article>
    `;
    }).join("")}
  </div>`;
}

function renderProductWorkspaceTabs() {
  ensureAuthorizedProductSubmodule();
  const isProductDetail = Boolean(getRouteProductId());
  const skuManagementActive = Boolean(getRouteErpSkuId())
    || (!isProductDetail && ["sku-management", "pending-skus", "combo-skus"].includes(productSubmodule));
  const cockpitActive = !isProductDetail && !skuManagementActive && productSubmodule === "business-cockpit";
  const sandboxActive = !isProductDetail && !skuManagementActive && productSubmodule === "product-sandbox";
  return `<nav class="product-workspace-tabs" aria-label="产品中心视图">
    ${canViewProducts() ? `<button type="button" data-action="product-workspace-view" data-view="business-cockpit" class="${cockpitActive ? "is-active" : ""}">经营驾驶舱</button>
    <button type="button" data-action="product-workspace-view" data-view="product-sandbox" class="${sandboxActive ? "is-active" : ""}">产品沙盘</button>
    <button type="button" data-action="product-workspace-view" data-view="business-dashboard" class="${!cockpitActive && !sandboxActive && !skuManagementActive ? "is-active" : ""}">产品经营</button>` : ""}
    ${canViewSkus() || canViewCombos() ? `<button type="button" data-action="product-workspace-view" data-view="sku-management" class="${skuManagementActive ? "is-active" : ""}">SKU管理</button>` : ""}
  </nav>`;
}

function businessMetricEnabled(key) { return productBusinessVisibleMetrics.has(key); }
function businessValue(value) { return value === null || value === undefined ? `<span class="business-no-data">暂无数据</span>` : Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 }); }
function businessMoney(value) { return value === null || value === undefined ? `<span class="business-no-data">暂无数据</span>` : `¥${Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function businessPercent(value) { return value === null || value === undefined ? `<span class="business-no-data">暂无数据</span>` : `${(Number(value) * 100).toFixed(1)}%`; }
function businessStatus(label, code, kind = "status") { return `<span class="product-business-pill ${kind}-${escapeHtml(code || "no_data")}">${escapeHtml(label || "暂无数据")}</span>`; }
function businessTrend(trend) { const text = trend?.rate === null || trend?.rate === undefined ? trend?.label || "暂无对比" : `${trend.label} ${Math.abs(Number(trend.rate) * 100).toFixed(1)}%`; return businessStatus(text, trend?.code, "trend"); }

function businessSortHeader(key, label) {
  const active = productBusinessFilters.sortBy === key;
  const arrow = active ? (productBusinessFilters.sortDirection === "asc" ? "↑" : "↓") : "↕";
  return `<button type="button" class="business-sort-button ${active ? "is-active" : ""}" data-action="product-business-sort" data-sort-by="${key}">${label}<span>${arrow}</span></button>`;
}

function renderBusinessSelect(values, selected, emptyLabel, readValue = (value) => value, readLabel = (value) => value) {
  return `<option value="">${emptyLabel}</option>${(values ?? []).map((value) => `<option value="${escapeHtml(readValue(value))}" ${readValue(value) === selected ? "selected" : ""}>${escapeHtml(readLabel(value))}</option>`).join("")}`;
}

function renderProductBusinessFilters(readModel) {
  const options = readModel?.options ?? {};
  const healthLabels = { healthy: "健康", attention: "关注", risk: "风险", no_data: "暂无数据" };
  const inventoryLabels = { healthy: "健康", attention: "关注", backlog: "积压风险", stockout: "缺货风险", no_data: "暂无数据" };
  return `<form class="product-business-filters" data-product-business-filter>
    <div class="product-business-filter-main">
      <input type="search" name="query" value="${escapeHtml(productBusinessFilters.query)}" placeholder="搜索产品名称 / SKU / 产品编码" />
      <select name="brand">${renderBusinessSelect(options.brands, productBusinessFilters.brand, "全部品牌")}</select>
      <select name="category">${renderBusinessSelect(options.categories, productBusinessFilters.category, "全部分类")}</select>
      <select name="lifecycle">${renderBusinessSelect(options.lifecycleStatuses, productBusinessFilters.lifecycle, "全部生命周期")}</select>
      <select name="status">${renderBusinessSelect(options.statuses, productBusinessFilters.status, "全部产品状态")}</select>
      <select name="healthStatus">${renderBusinessSelect(options.healthStatuses, productBusinessFilters.healthStatus, "全部健康状态", (value) => value, (value) => healthLabels[value] || value)}</select>
      <select name="inventoryStatus">${renderBusinessSelect(options.inventoryStatuses, productBusinessFilters.inventoryStatus, "全部库存状态", (value) => value, (value) => inventoryLabels[value] || value)}</select>
      <select name="ownerId">${renderBusinessSelect(options.owners, productBusinessFilters.ownerId, "全部负责人", (value) => value.id, (value) => value.name)}</select>
      <label class="product-unarchived-toggle"><input type="checkbox" name="includeHistorical" ${productBusinessFilters.includeHistorical ? "checked" : ""}/><span>显示历史产品</span></label>
    </div>
  </form>`;
}

function renderProductBusinessPeriodControl(readModel) {
  const custom = productBusinessFilters.range === "custom";
  const period = readModel?.period;
  return `<form class="product-business-time-control" data-product-business-period-filter>
    ${period ? `<span class="product-business-time-period">销售数据周期 ${escapeHtml(period.periodStart)} 至 ${escapeHtml(period.periodEnd)}</span>` : ""}
    ${renderProductSalesPresetButtons({ preset: productBusinessFilters.range }, "data-product-business-range")}
    <div class="product-distribution-custom-range ${custom ? "" : "is-hidden"}"><label>开始日期<input type="date" name="periodStart" value="${escapeHtml(productBusinessFilters.periodStart)}" ${custom ? "required" : "disabled"}/></label><span>→</span><label>结束日期<input type="date" name="periodEnd" value="${escapeHtml(productBusinessFilters.periodEnd)}" ${custom ? "required" : "disabled"}/></label></div>
    <button type="submit" class="secondary-button">查看</button>
  </form>`;
}

function renderProductBusinessMetricSettings() {
  return `<details class="product-business-metric-settings"><summary>指标设置</summary><div>${productBusinessMetricGroups.map((group) => `<label><input type="checkbox" data-product-business-metric="${group.key}" ${businessMetricEnabled(group.key) ? "checked" : ""} />${group.label}</label>`).join("")}</div></details>`;
}

function renderProductBusinessOperatingSort() {
  const options = [["updatedAt", "综合"], ["salesQuantity", "🔥销量"], ["inventoryQuantity", "📦库存"], ["inventoryAmount", "💰资金占用"], ["createdAt", "🆕新品"]];
  return `<div class="product-business-sort" aria-label="产品经营排序"><span>经营排序：</span>${options.map(([value, label]) => {
    const active = productBusinessFilters.sortBy === value && productBusinessFilters.sortDirection === "desc";
    return `<button type="button" data-action="set-product-business-operating-sort" data-sort-by="${value}" class="${active ? "is-active" : ""}" aria-pressed="${active}">${label}</button>`;
  }).join("")}</div>`;
}

function renderProductBusinessTable(readModel) {
  const groups = productBusinessMetricGroups.filter((group) => businessMetricEnabled(group.key));
  const totalColumns = 9 + groups.reduce((total, group) => total + group.count, 0);
  const rows = readModel?.items ?? [];
  return `<div class="product-business-table-wrap"><table class="product-business-table">
    <thead><tr class="product-business-groups"><th colspan="5">产品信息</th><th colspan="2">生命周期</th>${groups.map((group) => `<th colspan="${group.count}">${group.label}</th>`).join("")}<th colspan="2">经营动作</th></tr>
    <tr><th>图片</th><th>${businessSortHeader("name", "产品")}</th><th>品牌</th><th>分类</th><th>负责人</th><th>生命周期</th><th>产品状态</th>
      ${businessMetricEnabled("sales") ? `<th>${businessSortHeader("salesAmount", "直接销售额")}</th><th>直接销量</th><th>组合贡献</th><th>${businessSortHeader("salesQuantity", "实际出货")}</th><th>${businessSortHeader("salesTrend", "出货趋势")}</th>` : ""}
      ${businessMetricEnabled("structure") ? `<th>${businessSortHeader("skuCount", "SKU数量")}</th><th>${businessSortHeader("salesLinkCount", "销售链接")}</th>` : ""}
      ${businessMetricEnabled("inventory") ? `<th>${businessSortHeader("inventoryQuantity", "库存数量")}</th><th>${businessSortHeader("inventoryAmount", "库存金额")}</th><th>库存状态</th>` : ""}
      ${businessMetricEnabled("profit") ? `<th>${businessSortHeader("grossMargin", "毛利率")}</th><th>${businessSortHeader("grossProfit", "毛利润")}</th><th>盈利状态</th>` : ""}
      ${businessMetricEnabled("health") ? `<th>${businessSortHeader("healthStatus", "健康摘要")}</th>` : ""}
      ${businessMetricEnabled("diagnosis") ? `<th>经营状态</th>` : ""}
      <th>${businessSortHeader("pendingCount", "待处理事项")}</th><th>详情</th></tr></thead>
    <tbody>${rows.length ? rows.map((item) => `<tr>
      <td><button type="button" class="product-business-product-button is-image" data-action="view-product" data-direct-product-detail data-product-id="${escapeHtml(item.id)}">${renderImage({ mainImage: item.image, name: item.name }, "product-business-image")}</button></td>
      <td><button type="button" class="product-business-product-button" data-action="view-product" data-direct-product-detail data-product-id="${escapeHtml(item.id)}"><strong>${escapeHtml(item.name)}</strong><small>SKU ${escapeHtml(item.sku || "—")}</small><small>产品编码 ${escapeHtml(item.productCode || "—")}</small></button></td>
      <td>${escapeHtml(item.brand || "—")}</td><td>${escapeHtml(item.category || "—")}</td><td>${escapeHtml(item.ownerName || "未分配")}</td>
      <td>${businessStatus(item.lifecycle, item.lifecycle, "lifecycle")}</td><td>${businessStatus(item.status, "product")}</td>
      ${businessMetricEnabled("sales") ? `<td>${businessMoney(item.sales.directAmount)}</td><td>${businessValue(item.sales.directQuantity)}</td><td>${businessValue(item.sales.bundleContributionQuantity)}</td><td>${businessValue(item.sales.totalPhysicalContribution)}</td><td>${businessTrend(item.sales.trend)}</td>` : ""}
      ${businessMetricEnabled("structure") ? `<td>${businessValue(item.structure.skuCount)}</td><td>${businessValue(item.structure.salesLinkCount)}</td>` : ""}
      ${businessMetricEnabled("inventory") ? `<td>${businessValue(item.inventory.quantity)}</td><td>${businessMoney(item.inventory.amount)}</td><td>${businessStatus(item.inventory.status.label, item.inventory.status.code, "inventory")}</td>` : ""}
      ${businessMetricEnabled("profit") ? `<td>${businessPercent(item.profit.grossMargin)}</td><td>${businessMoney(item.profit.grossProfit)}</td><td>${businessStatus(item.profit.status.label, item.profit.status.code, "profit")}</td>` : ""}
      ${businessMetricEnabled("health") ? `<td><button type="button" class="product-health-summary-button" data-action="open-product-health" data-product-id="${escapeHtml(item.id)}"><span>${escapeHtml(item.healthAnalysis?.overall?.emoji || "⚪")}</span>${businessStatus(item.healthAnalysis?.overall?.label, item.healthAnalysis?.overall?.code, "health")}<small>查看原因</small></button></td>` : ""}
      ${businessMetricEnabled("diagnosis") ? `<td><button type="button" class="product-health-summary-button product-diagnosis-summary-button" data-action="open-product-diagnosis" data-product-id="${escapeHtml(item.id)}"><span>${escapeHtml(item.diagnosis?.status?.emoji || "⚪")}</span>${businessStatus(item.diagnosis?.status?.label, item.diagnosis?.status?.code, "diagnosis")}<small>查看诊断</small></button></td>` : ""}
      <td>${item.actions.pendingCount ? `<div class="product-business-actions"><strong>${item.actions.pendingCount}</strong><small>改善 ${item.actions.improvementCount} · 行动 ${item.actions.actionCount} · 任务 ${item.actions.taskCount}</small></div>` : `<span class="business-no-data">暂无行动</span>`}</td>
      <td><button type="button" class="text-button" data-action="view-product" data-direct-product-detail data-product-id="${escapeHtml(item.id)}">产品档案 →</button></td>
    </tr>`).join("") : `<tr><td colspan="${totalColumns}" class="empty-cell">当前筛选条件下暂无产品</td></tr>`}</tbody>
  </table></div>`;
}

function renderProductBusinessCards(readModel) {
  const rows = readModel?.items ?? [];
  if (!rows.length) return `<div class="product-card-empty">当前筛选条件下暂无产品</div>`;
  return `<div class="product-card-grid product-sku-v2-card-grid product-business-card-grid">${rows.map((item) => `<article class="product-archive-card product-business-card" data-action="view-product" data-direct-product-detail data-product-id="${escapeHtml(item.id)}" role="button" tabindex="0" aria-label="查看产品：${escapeHtml(item.name)}">
    <div class="product-archive-card-media">${renderImage({ mainImage: item.image, name: item.name }, "product-card-image")}</div>
    <div class="product-archive-card-body">
      <div class="product-archive-card-heading"><h3 title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</h3>${businessStatus(item.healthAnalysis?.overall?.label, item.healthAnalysis?.overall?.code, "health")}</div>
      <small class="product-card-listed-at">${escapeHtml(item.brand || "未设置品牌")} · ${escapeHtml(item.category || "未设置分类")} · ${escapeHtml(item.lifecycle || "未设置生命周期")} · ${escapeHtml(item.status || "未设置状态")}</small>
      <div class="product-card-identities"><span>SKU <strong>${escapeHtml(item.sku || "—")}</strong></span><span>产品编码 <strong>${escapeHtml(item.productCode || "—")}</strong></span></div>
      <div class="product-card-metrics">
        <div><strong>${businessMoney(item.sales?.directAmount)}</strong><span>销售表现</span></div>
        <div><strong>${businessMoney(item.profit?.grossProfit)}</strong><span>毛利润</span></div>
        <div><strong>${businessValue(item.inventory?.quantity)}</strong><span>${Number(item.inventory?.quantity || 0) <= 0 ? "库存风险" : "当前库存"}</span></div>
      </div>
    </div>
  </article>`).join("")}</div>`;
}

function renderProductBusinessPagination(readModel) {
  const pagination = readModel?.pagination;
  if (!pagination || pagination.pages <= 1) return "";
  return `<nav class="product-pagination" aria-label="产品经营看板分页"><span>第 ${pagination.page}/${pagination.pages} 页 · 共 ${pagination.total} 个产品</span><div><button class="secondary-button" type="button" data-action="product-business-page" data-page="${pagination.page - 1}" ${pagination.page <= 1 ? "disabled" : ""}>上一页</button><button class="secondary-button" type="button" data-action="product-business-page" data-page="${pagination.page + 1}" ${pagination.page >= pagination.pages ? "disabled" : ""}>下一页</button></div></nav>`;
}

function renderProductBusinessDashboard() {
  const readModel = productBusinessDashboardState.readModel;
  const summary = readModel?.summary;
  return `<section class="product-center-page product-business-dashboard">
    ${renderProductWorkspaceTabs()}
    ${renderProductBusinessPeriodControl(readModel)}
    ${productBusinessDashboardState.error ? `<div class="form-error">${escapeHtml(productBusinessDashboardState.error)}</div>` : ""}
    ${summary ? `<section class="product-business-summary"><article><span>产品总数</span><strong>${businessValue(summary.totalProducts)}</strong><small>与产品库同源</small></article><article><span>筛选结果</span><strong>${businessValue(summary.filteredProducts)}</strong><small>当前筛选范围</small></article><article><span>直接销售额</span><strong>${businessMoney(summary.directSalesAmount)}</strong><small>仅Single直接事实</small></article><article><span>直接销量</span><strong>${businessValue(summary.directSalesQuantity)}</strong><small>Single直接销售</small></article><article><span>组合贡献销量</span><strong>${businessValue(summary.bundleContributionQuantity)}</strong><small>Bundle销量 × BOM数量</small></article><article><span>实际出货贡献</span><strong>${businessValue(summary.totalPhysicalContribution)}</strong><small>直接 + 组合贡献</small></article><article><span>库存数量</span><strong>${businessValue(summary.inventoryQuantity)}</strong><small>库存模块最新口径</small></article><article><span>风险产品</span><strong>${businessValue(summary.riskProducts)}</strong><small>健康或库存风险</small></article></section>` : ""}
    ${renderProductBusinessFilters(readModel)}
    <div class="product-business-toolbar"><div class="product-business-toolbar-primary"><span>${productBusinessDashboardState.loading ? "正在读取产品经营数据…" : `共 ${summary?.filteredProducts ?? 0} 个产品`}</span>${renderProductBusinessOperatingSort()}</div><div class="product-business-toolbar-actions"><div class="product-view-switch" aria-label="产品经营视图"><button type="button" data-action="product-business-view" data-view="table" class="${productBusinessViewMode === "table" ? "is-active" : ""}" aria-pressed="${productBusinessViewMode === "table"}">列表</button><button type="button" data-action="product-business-view" data-view="card" class="${productBusinessViewMode === "card" ? "is-active" : ""}" aria-pressed="${productBusinessViewMode === "card"}">卡片</button></div>${renderProductBusinessMetricSettings()}</div></div>
    ${productBusinessDashboardState.loading && !readModel ? `<div class="empty-state">正在读取销售、库存与经营数据…</div>` : productBusinessViewMode === "card" ? renderProductBusinessCards(readModel) : renderProductBusinessTable(readModel)}
    ${renderProductBusinessPagination(readModel)}
  </section>`;
}

function renderProductBusinessCockpit() {
  return `<section class="product-center-page product-business-cockpit">
    <div class="section-heading with-actions"><div><h1>产品经营驾驶舱</h1><p>从产品销售结构开始，看清核心产品、长尾产品与数据空白。</p></div></div>
    ${renderProductWorkspaceTabs()}
    <section class="product-business-cockpit-hero"><div><p class="eyebrow">产品经营分析</p><h2>产品销售结构</h2><p>读取销售日报事实、Sales Object 与产品映射；只读分析，不拆分组合装金额。</p></div></section>
    ${renderUiModule("product_sales_distribution", { state: productSalesDistributionState, resolveUrl: resolveAssetUrl })}
  </section>`;
}

function renderProductShopSandboxPage() {
  return `<section class="product-center-page product-shop-sandbox-page">
    ${renderProductWorkspaceTabs()}
    ${renderUiModule("product_shop_sandbox", { state: productShopSandboxState, resolveUrl: resolveAssetUrl })}
  </section>`;
}

function renderProductList() {
  if (productSubmodule === "pending-skus") return renderPendingSkuPage();
  if (productSubmodule === "combo-skus") return comboSkuState.detail ? renderComboSkuDetail() : renderComboSkuList();
  if (productSubmodule === "sku-management") return renderProductSkuV2List();
  if (productSubmodule === "business-cockpit") return renderProductBusinessCockpit();
  if (productSubmodule === "product-sandbox") return renderProductShopSandboxPage();
  return renderProductBusinessDashboard();
}

function renderProductSkuV2List() {
  const { rows, summary, pagination, facets } = productSkuV2State;
  const totalPages = Math.max(1, Math.ceil(Number(pagination.total || 0) / productSkuV2State.pageSize));
  return `<section class="product-center-page product-sku-v2-page">
    <div class="section-heading with-actions"><div><h1>产品中心</h1><p>查看每个 SKU 的经营表现与库存状态</p></div>${hasPermission(getCurrentUser(), "products.import") ? `<details class="product-more-filters"><summary>更多</summary><div><button type="button" class="text-button" data-action="open-product-v2-import">数据同步</button></div></details>` : ""}</div>
    ${renderProductWorkspaceTabs()}
    ${renderProductSubmoduleTabs()}
    ${productSkuV2State.error ? `<div class="form-error">${escapeHtml(productSkuV2State.error)}</div>` : ""}
    ${productSkuV2State.notice ? `<div class="form-success">${escapeHtml(productSkuV2State.notice)}</div>` : ""}
    <section class="stats-grid product-sku-v2-stats">
      <article><span>SKU总数</span><strong>${summary.total ?? 0}</strong></article>
      <article><span>已建档</span><strong>${summary.profiled ?? 0}</strong></article>
      <article><span>未建档</span><strong>${summary.unprofiled ?? 0}</strong></article>
    </section>
    <section class="product-business-zones" aria-label="产品经营分区">
      <header><div><h2>产品经营分区</h2></div></header>
      <div class="product-business-zone-tabs">
        <button type="button" data-action="set-product-v2-zone" data-product-zone="all" class="${productSkuV2State.businessZone === "all" ? "is-active" : ""}"><span>全部SKU</span><strong>${summary.total ?? 0}</strong><small>查看完整SKU池</small></button>
        ${Object.entries(productBusinessZoneMeta).map(([zone, meta]) => `<button type="button" data-action="set-product-v2-zone" data-product-zone="${zone}" class="${productSkuV2State.businessZone === zone ? "is-active" : ""}"><span>${meta.icon} ${meta.label}</span><strong>${summary.businessZones?.[zone] ?? 0}</strong><small>${meta.description}</small></button>`).join("")}
      </div>
    </section>
    <form class="filter-bar product-filter-bar" data-product-v2-filter>
      <input type="search" name="search" value="${escapeHtml(productSkuV2State.search)}" placeholder="搜索SKU编码、货品名称、规格" />
      <select name="brand">${renderFilterOptions(facets.brands ?? [], productSkuV2State.brand, "全部品牌")}</select>
      <select name="category">${renderFilterOptions(facets.categories ?? [], productSkuV2State.category, "全部分类")}</select>
      <label class="product-unarchived-toggle"><input type="checkbox" name="includeUnarchived" ${productSkuV2State.includeUnarchived ? "checked" : ""} /><span>显示未建档产品</span></label>
      <label class="product-unarchived-toggle"><input type="checkbox" name="includeHistorical" ${productSkuV2State.includeHistorical ? "checked" : ""} /><span>显示历史/非经营ERP SKU</span></label>
      <details class="product-more-filters" ${productSkuV2State.erpStatus || productSkuV2State.lifecycleStatus || productSkuV2State.platform || productSkuV2State.stockStatus ? "open" : ""}>
        <summary>更多筛选</summary><div>
          <select name="lifecycleStatus">${renderFilterOptions(facets.lifecycleStatuses ?? [], productSkuV2State.lifecycleStatus, "全部生命周期")}</select>
          <select name="operatingLifecycleStatus"><option value="">全部经营状态</option>${(facets.operatingLifecycleStatuses || []).map((item) => `<option value="${escapeHtml(item.value)}" ${productSkuV2State.operatingLifecycleStatus === item.value ? "selected" : ""}>${escapeHtml(({ active: "当前经营", active_dependency: "组合依赖", sales_active: "近期销售", archived: "历史经营", external_unused: "外部/未使用" })[item.value] || item.value)} (${item.total})</option>`).join("")}</select>
          <select name="platform">${renderFilterOptions(facets.platforms ?? [], productSkuV2State.platform, "全部销售平台")}</select>
          <select name="stockStatus"><option value="">全部库存</option><option value="available" ${productSkuV2State.stockStatus === "available" ? "selected" : ""}>有库存</option><option value="low" ${productSkuV2State.stockStatus === "low" ? "selected" : ""}>低库存</option><option value="empty" ${productSkuV2State.stockStatus === "empty" ? "selected" : ""}>无库存</option></select>
          <details><summary>技术筛选</summary><input name="erpStatus" value="${escapeHtml(productSkuV2State.erpStatus)}" placeholder="ERP状态" /></details>
        </div>
      </details>
      <button class="primary-button" type="submit">查询</button>
      <button class="text-button" type="button" data-action="clear-product-v2-filter">清空</button>
    </form>
    <div class="product-list-toolbar"><span>当前筛选 ${pagination.total || 0} 个SKU</span>${renderProductV2BusinessSort()}</div>
    ${productSkuV2State.loading ? `<div class="empty-state">正在读取产品数据…</div>` : renderProductSkuV2Cards(rows)}
    <nav class="product-pagination"><span>第 ${productSkuV2State.page}/${totalPages} 页 · 共 ${pagination.total || 0} 个SKU</span><div>
      <button class="secondary-button" type="button" data-action="product-v2-page" data-page="${productSkuV2State.page - 1}" ${productSkuV2State.page <= 1 ? "disabled" : ""}>上一页</button>
      <button class="secondary-button" type="button" data-action="product-v2-page" data-page="${productSkuV2State.page + 1}" ${productSkuV2State.page >= totalPages ? "disabled" : ""}>下一页</button>
    </div></nav>
  </section>`;
}

function renderProductSkuV2Cards(rows) {
  if (!rows.length) return `<div class="product-card-empty">没有符合条件的 SKU</div>`;
  return `<div class="product-card-grid product-sku-v2-card-grid">${rows.map((item) => {
    const product = item.productId ? state.products.find((entry) => entry.id === item.productId) : null;
    const title = item.productName || item.goodsName || item.specificationName || item.merchantSkuCode;
    const imageSource = { mainImage: item.productImage || item.skuImage, name: title };
    const usageLabel = ({ sale_goods: "销售商品", packaging_material: "包装材料", consumable_auxiliary: "耗材/辅料", unknown: "用途待确认" })[item.erpUsage?.primaryUsage] || "用途待确认";
    const lifecycleLabel = ({ active: "当前经营", active_dependency: "组合依赖", sales_active: "近期销售", archived: "历史经营", external_unused: "外部/未使用" })[item.operatingLifecycleStatus] || "状态待确认";
    return `<article class="product-archive-card ${item.productId ? "is-profiled" : "is-unprofiled"}" data-action="view-product-v2-sku" data-erp-sku-id="${escapeHtml(item.erpSkuId)}" role="button" tabindex="0" aria-label="查看SKU：${escapeHtml(title)}">
      <div class="product-archive-card-media">${renderImage(imageSource, "product-card-image")}</div>
      <div class="product-archive-card-body">
        <div class="product-archive-card-heading"><h3 title="${escapeHtml(title)}">${escapeHtml(title)}</h3>${businessZoneBadge(item.businessZone)}</div>
        <small class="product-card-listed-at">${escapeHtml(usageLabel)} · ${escapeHtml(lifecycleLabel)}${item.erpUsage?.saleGoods ? " · 直接销售" : ""}${item.erpUsage?.bundleComponent ? " · 参与组合装" : ""}</small>
        <div class="product-card-metrics">
          <div><strong>${formatMoney(item.salesAmount)}</strong><span>销售表现</span></div>
          <div><strong>${formatMoney(item.profitAmount)}</strong><span>利润</span></div>
          <div><strong>${formatMetric(item.stockNum)}</strong><span>${Number(item.stockNum || 0) <= 0 ? "库存风险" : "当前库存"}</span></div>
        </div>
        ${!item.productId ? `<small class="product-card-listed-at">未建立产品档案</small>` : ""}
        ${!item.productId && hasPermission(getCurrentUser(), "skus.manage") ? `<button class="primary-button compact-button" type="button" data-action="create-product-v2-profile" data-erp-sku-id="${escapeHtml(item.erpSkuId)}">创建产品档案</button>` : ""}
        ${product ? `<div class="product-card-more"><button class="icon-button" type="button" data-action="toggle-product-menu" data-product-id="${escapeHtml(product.id)}" aria-label="产品操作">•••</button><div class="product-card-menu" data-product-menu="${escapeHtml(product.id)}" hidden>${renderProductActions(product)}</div></div>` : ""}
      </div>
    </article>`;
  }).join("")}</div>`;
}

function renderProductV2BusinessSort() {
  const options = [["updated-desc", "综合"], ["sales-desc", "🔥销量"], ["stock-desc", "📦库存"], ["capital-desc", "💰资金占用"], ["created-desc", "🆕新品"]];
  return `<div class="product-business-sort" aria-label="产品经营排序"><span>经营排序：</span>${options.map(([value, label]) => `<button type="button" data-action="set-product-v2-sort" data-product-sort="${value}" class="${productSkuV2State.sort === value ? "is-active" : ""}" aria-pressed="${productSkuV2State.sort === value}">${label}</button>`).join("")}</div>`;
}

function renderProductSkuV2Detail() {
  const detail = productSkuV2State.detail;
  if (productSkuV2State.loading || !detail) return `<section class="product-center-page"><button class="text-button" data-action="back-products">← 返回SKU管理</button>${renderProductWorkspaceTabs()}${productSkuV2State.error ? `<div class="form-error">${escapeHtml(productSkuV2State.error)}</div>` : `<div class="empty-state">正在读取SKU详情…</div>`}</section>`;
  const { sku, inventory, sales } = detail;
  const listRow = productSkuV2State.rows.find((item) => item.erpSkuId === sku.id);
  const section = (scope) => productWorkspaceState.sections[scope] ?? { loading: false, loaded: false, rows: [], error: "" };
  const galleryImages = (() => { try { return JSON.parse(sku.galleryImages || "[]"); } catch { return []; } })();
  const moduleContext = { sku, inventory, sales, ownerName: findName(state.people, sku.ownerId), resolveUrl: resolveAssetUrl, formatMoney, formatMetric };
  const tabs = [["overview", "概览"], ["marketing", "营销资产"], ["sku", "SKU管理"], ["inventory", "库存记录"], ["sales", "销售记录"], ["operations", "操作记录"]];
  const activeTab = productWorkspaceState.activeTab;
  const marketing = section("marketing");
  const canEditMarketing = hasPermission(getCurrentUser(), "products.manage");
  const marketingSummary = !sku.productId
    ? `<section class="product-workspace-panel product-marketing-summary"><header><div><span>产品知识资产</span><h2>产品营销资产</h2></div></header><div class="empty-state compact">需先建立产品档案，才能维护产品营销资产。</div></section>`
    : marketing.loading ? `<section class="product-workspace-panel"><div class="empty-state compact">正在读取产品营销资产…</div></section>`
    : marketing.error ? `<section class="product-workspace-panel"><div class="form-error">${escapeHtml(marketing.error)}</div><button class="secondary-button" type="button" data-action="load-product-marketing">重新加载</button></section>`
    : marketing.loaded ? renderUiModule("product_marketing_asset", { asset: marketing.asset, mode: "summary", notice: productWorkspaceState.marketingNotice, canEdit: canEditMarketing })
    : `<section class="product-workspace-panel"><button class="secondary-button" type="button" data-action="load-product-marketing">加载营销资产</button></section>`;
  let tabContent = "";
  if (activeTab === "overview") tabContent = `<div class="product-workspace-overview">
    ${sku.productId ? renderUiModule("product_daily_sales", { state: productWorkspaceState.dailySales }) : `<section class="product-workspace-panel"><div class="empty-state compact">需先建立产品档案，才能查看产品维度销售表现；ERP SKU日报事实保持原归属。</div></section>`}
    ${marketingSummary}
    <div class="product-workspace-grid">
      <div>${renderUiModule("product_gallery", { ...moduleContext, images: galleryImages })}${renderUiModule("product_links", { state: section("links") })}</div>
      <div>${renderUiModule("product_ai_tools", { productId: sku.productId, notice: productWorkspaceState.marketingNotice })}${renderUiModule("product_lifecycle_strategy", moduleContext)}</div>
    </div>
  </div>`;
  if (activeTab === "sku") {
    const usage = detail.erpUsage;
    const usageLabel = ({ sale_goods: "销售商品", packaging_material: "包装材料", consumable_auxiliary: "耗材/辅料", unknown: "用途待确认" })[usage?.primaryUsage] || "用途待确认";
    const lifecycleLabel = ({ active: "当前经营", active_dependency: "组合依赖", sales_active: "近期销售", archived: "历史经营", external_unused: "外部/未使用" })[sku.operatingLifecycleStatus] || "状态待确认";
    tabContent = `<section class="product-workspace-panel">${renderInfoGroup("SKU与ERP关系", [["SKU编码",sku.merchantSkuCode],["用途",usageLabel],["经营状态",lifecycleLabel],["Product",sku.productName || "—"],["当前库存",inventory?.stockNum ?? "—"],["直接销售",usage?.saleGoods ? "是" : "否"],["参与组合装",usage?.bundleComponent ? "是" : "否"],["规格",sku.specificationName],["条码",sku.barcode],["单位",sku.unit],["ERP货品",`${sku.goodsCode || "—"} · ${sku.goodsName || "—"}`]])}</section>`;
  }
  if (activeTab === "marketing") {
    tabContent = !sku.productId
      ? `<section class="product-workspace-panel"><div class="empty-state">需先建立产品档案，才能维护产品营销资产。</div></section>`
      : marketing.loading ? `<div class="empty-state">正在读取产品营销资产…</div>`
      : marketing.error ? `<div class="form-error">${escapeHtml(marketing.error)}</div>`
      : marketing.loaded ? renderUiModule("product_marketing_asset", { asset: marketing.asset, mode: productWorkspaceState.marketingMode, notice: productWorkspaceState.marketingNotice, canEdit: canEditMarketing })
      : `<section class="product-workspace-panel"><button class="secondary-button" type="button" data-action="load-product-marketing">加载营销资产</button></section>`;
  }
  if (activeTab === "inventory") tabContent = renderProductWorkspaceRecords("inventory", section("inventory"));
  if (activeTab === "sales") tabContent = renderProductWorkspaceRecords("sales", section("sales"));
  if (activeTab === "operations") tabContent = renderProductWorkspaceRecords("operations", section("operations"));
  return `<section class="product-center-page product-detail-page product-sku-v2-detail product-workspace">
    <button class="text-button product-detail-back" type="button" data-action="back-products">← 返回SKU管理</button>
    ${renderProductWorkspaceTabs()}
    ${productSkuV2State.error ? `<div class="form-error">${escapeHtml(productSkuV2State.error)}</div>` : ""}
    <div class="product-workspace-top">${businessZoneBadge(listRow?.businessZone)}<div class="product-workspace-hero">${renderUiModule("product_basic_info", moduleContext)}${renderUiModule("product_business_data", moduleContext)}</div><div class="product-workspace-actions">${!sku.productId && hasPermission(getCurrentUser(), "skus.manage") ? `<button class="primary-button" type="button" data-action="create-product-v2-profile" data-erp-sku-id="${escapeHtml(sku.id)}">创建产品档案</button>` : sku.productId && canViewProducts() ? `<a class="secondary-button" href="#products/${encodeURIComponent(sku.productId)}">查看关联产品档案 →</a>` : ""}</div></div>
    <nav class="product-workspace-tabs" aria-label="Product Workspace">${tabs.map(([key,label])=>`<button type="button" data-action="product-workspace-tab" data-tab="${key}" class="${activeTab===key?"is-active":""}">${label}</button>`).join("")}</nav>
    <div class="product-workspace-content">${tabContent}</div>
  </section>`;
}

function renderProductWorkspaceRecords(scope, section) {
  const labels = { inventory: "库存记录", sales: "销售记录", operations: "操作记录" };
  if (section.loading) return `<div class="empty-state">正在读取${labels[scope]}…</div>`;
  if (section.error) return `<div class="form-error">${escapeHtml(section.error)}</div>`;
  if (!section.loaded) return `<section class="product-workspace-panel"><button class="secondary-button" type="button" data-action="load-product-workspace-section" data-scope="${scope}">加载${labels[scope]}</button></section>`;
  const rows = section.rows || [];
  if (!rows.length) return `<div class="empty-state">暂无${labels[scope]}</div>`;
  if (scope === "inventory") return `<div class="table-wrap"><table class="data-table"><thead><tr><th>日期</th><th>库存</th><th>可发</th><th>库存金额</th><th>30日销量</th></tr></thead><tbody>${rows.map((row)=>`<tr><td>${escapeHtml(row.businessDate||"—")}</td><td>${formatMetric(row.stockNum)}</td><td>${formatMetric(row.availableSendStock)}</td><td>${formatMoney(row.inventoryCostAmount)}</td><td>${formatMetric(row.salesMonth)}</td></tr>`).join("")}</tbody></table></div>`;
  if (scope === "sales") return `<div class="table-wrap"><table class="data-table"><thead><tr><th>周期</th><th>销量</th><th>销售额</th><th>成本</th><th>利润</th></tr></thead><tbody>${rows.map((row)=>`<tr><td>${escapeHtml(row.periodStart||"—")} – ${escapeHtml(row.periodEnd||"—")}</td><td>${formatMetric(row.quantity)}</td><td>${formatMoney(row.salesAmount)}</td><td>${formatMoney(row.costAmount)}</td><td>${formatMoney(row.profitAmount)}</td></tr>`).join("")}</tbody></table></div>`;
  return `<div class="product-workspace-timeline">${rows.map((row)=>`<article><strong>${escapeHtml(row.fromStatus||"未设置")} → ${escapeHtml(row.toStatus||"未设置")}</strong><p>${escapeHtml(row.reason||"无补充说明")}</p><small>${formatDateTime(row.changedAt)}</small></article>`).join("")}</div>`;
}

function renderProductSubmoduleTabs() {
  return `<nav class="product-submodule-tabs" aria-label="产品中心子模块">
    ${canViewSkus() ? `<button type="button" data-action="product-submodule" data-submodule="sku-management" class="${productSubmodule === "sku-management" ? "is-active" : ""}">SKU列表</button>
    <button type="button" data-action="product-submodule" data-submodule="pending-skus" class="${productSubmodule === "pending-skus" ? "is-active" : ""}">待建立SKU</button>` : ""}
    ${canViewCombos() ? `<button type="button" data-action="product-submodule" data-submodule="combo-skus" class="${productSubmodule === "combo-skus" ? "is-active" : ""}">组合装管理</button>` : ""}
  </nav>`;
}

function renderComboSkuList() {
  const total = Number(comboSkuState.pagination.total || 0); const totalPages = Math.max(1, Math.ceil(total / comboSkuState.pageSize));
  return `<section class="product-center-page"><div class="section-heading"><div><h1>组合装管理</h1><p>组合装是 Sales Object(bundle)，由一个或多个 ERP SKU 按数量组成的销售组合</p></div></div>${renderProductWorkspaceTabs()}${renderProductSubmoduleTabs()}
    <form class="filter-bar" data-combo-sku-search><input type="search" name="search" value="${escapeHtml(comboSkuState.search)}" placeholder="搜索组合装编码或名称"/><label class="product-unarchived-toggle"><input type="checkbox" name="includeHistorical" ${comboSkuState.includeHistorical ? "checked" : ""}/><span>显示历史组合装</span></label><button class="secondary-button" type="submit">搜索</button></form>
    <div class="product-list-toolbar"><span>当前筛选 ${total} 个组合装</span><div class="product-view-switch" aria-label="组合装视图"><button type="button" data-action="combo-sku-view" data-view="card" class="${comboSkuState.viewMode === "card" ? "is-active" : ""}">卡片</button><button type="button" data-action="combo-sku-view" data-view="table" class="${comboSkuState.viewMode === "table" ? "is-active" : ""}">列表</button></div></div>
    ${comboSkuState.error ? `<div class="form-error">${escapeHtml(comboSkuState.error)}</div>` : ""}${comboSkuState.loading ? `<div class="empty-state">正在读取组合装…</div>` : !comboSkuState.rows.length ? `<div class="empty-state">暂无组合装</div>` : comboSkuState.viewMode === "card" ? renderComboSkuCards(comboSkuState.rows) : renderComboSkuTable(comboSkuState.rows)}
    <nav class="pagination"><span>共 ${total} 个 · 第 ${comboSkuState.page}/${totalPages} 页</span><div><button class="secondary-button" type="button" data-action="combo-sku-page" data-page="${comboSkuState.page - 1}" ${comboSkuState.page <= 1 ? "disabled" : ""}>上一页</button><button class="secondary-button" type="button" data-action="combo-sku-page" data-page="${comboSkuState.page + 1}" ${comboSkuState.page >= totalPages ? "disabled" : ""}>下一页</button></div></nav></section>`;
}

function renderComboSkuTable(rows) {
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>组合装编码</th><th>组合装名称</th><th>组成商品数量</th><th>关联链接</th><th>组合销售额</th><th>状态</th><th>更新时间</th></tr></thead><tbody>${rows.map((row) => `<tr data-action="view-combo-sku" data-sales-object-id="${escapeHtml(row.salesObjectId)}" tabindex="0" role="button"><td><strong>${escapeHtml(row.objectCode)}</strong></td><td>${escapeHtml(row.name || row.objectCode)}</td><td>${formatMetric(row.componentCount)}</td><td>${formatMetric(row.linkedSalesLinkCount)}</td><td>${formatMoney(row.salesAmount)}</td><td>${escapeHtml(row.status)}</td><td>${formatDateTime(row.updatedAt)}</td></tr>`).join("")}</tbody></table></div>`;
}

function renderComboSkuCards(rows) {
  return `<div class="product-card-grid combo-sku-card-grid">${rows.map((row) => {
    const products = (row.componentProducts || []).slice(0, 9);
    const layout = Number(row.componentCount || 0) <= 1 ? "is-single" : Number(row.componentCount || 0) <= 4 ? "is-four" : "is-nine";
    return `<article class="product-archive-card combo-sku-card" data-action="view-combo-sku" data-sales-object-id="${escapeHtml(row.salesObjectId)}" role="button" tabindex="0" aria-label="查看组合装：${escapeHtml(row.name || row.objectCode)}">
      <div class="product-archive-card-media combo-product-collage ${layout}">${products.length ? products.map((product) => renderImage({ mainImage: product.mainImage, name: product.productName || row.name || row.objectCode }, "combo-product-image")).join("") : renderImage({ name: row.name || row.objectCode }, "combo-product-image")}</div>
      <div class="product-archive-card-body"><div class="product-archive-card-heading"><h3 title="${escapeHtml(row.name || row.objectCode)}">${escapeHtml(row.name || row.objectCode)}</h3><span class="status-badge">bundle</span></div>
        <div class="product-card-identities"><span>组合编码 <strong>${escapeHtml(row.objectCode)}</strong></span></div>
        <div class="product-card-metrics"><div><strong>${formatMetric(row.componentCount)}</strong><span>组成商品</span></div><div><strong>${formatMetric(row.linkedSalesLinkCount)}</strong><span>关联链接</span></div><div><strong>${formatMoney(row.salesAmount)}</strong><span>组合销售额</span></div></div>
        <small class="product-card-listed-at">更新时间 ${formatDateTime(row.updatedAt)}</small>
      </div></article>`;
  }).join("")}</div>`;
}

function renderComboSkuDetail() {
  const detail = comboSkuState.detail; if (!detail) return `<div class="empty-state">正在读取组合装详情…</div>`; const summary = detail.salesPerformance?.summary || {};
  return `<section class="product-center-page product-detail-page"><button class="text-button" type="button" data-action="back-combo-skus">← 返回组合装管理</button><div class="section-heading"><div><span>组合装详情 · Sales Object(bundle)</span><h1>${escapeHtml(detail.salesObject.name || detail.salesObject.objectCode)}</h1><p>组合装编码 ${escapeHtml(detail.salesObject.objectCode)} · 结构版本 V${formatMetric(detail.structure.version)}</p></div></div>
    <section class="product-workspace-panel"><header><h2>组成</h2></header><div class="table-wrap"><table class="data-table"><thead><tr><th>ERP SKU</th><th>货品</th><th>Product</th><th>数量</th></tr></thead><tbody>${detail.components.map((row) => `<tr><td>${escapeHtml(row.merchantSkuCode)}</td><td>${escapeHtml(row.goodsName || row.specificationName || "—")}</td><td>${escapeHtml(row.productName || "未建档")}</td><td>${formatMetric(row.quantity)}</td></tr>`).join("")}</tbody></table></div></section>
    <section class="product-workspace-panel"><header><h2>销售表现</h2><small>销售额仅按原始销售行计一次，不向组件复制</small></header><div class="product-card-metrics"><div><strong>${formatMoney(summary.salesAmount)}</strong><span>销售额</span></div><div><strong>${formatMoney(summary.profitAmount)}</strong><span>利润</span></div><div><strong>${formatMetric(summary.quantity)}</strong><span>销量</span></div><div><strong>${formatMetric(summary.dataCount)}</strong><span>事实来源行</span></div></div></section>
    <section class="product-workspace-panel"><header><h2>关联链接</h2></header>${detail.links.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>店铺</th><th>链接</th><th>链接SKU</th><th>解析状态</th></tr></thead><tbody>${detail.links.map((row) => `<tr><td>${escapeHtml(row.shopName)}</td><td>${escapeHtml(row.linkName || row.platformGoodsId || "—")}</td><td>${escapeHtml(row.specificationName || row.platformSkuCode || row.platformSkuId || "—")}</td><td>${escapeHtml(row.relation?.status || "—")}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state compact">暂无关联链接</div>`}</section></section>`;
}

function renderPendingSkuPage() {
  const canCreate = hasPermission(getCurrentUser(), "skus.manage");
  const selectedCount = selectedPendingSkuIds.size;
  const allSelected = pendingSkuState.rows.length > 0 && pendingSkuState.rows.every((item) => selectedPendingSkuIds.has(item.id));
  return `<section class="product-center-page">
    <div class="section-heading with-actions">
      <div><h1>产品中心</h1><p>识别ERP已发现、尚未建立产品档案的SKU</p></div>
    </div>
    ${renderProductWorkspaceTabs()}
    ${renderProductSubmoduleTabs()}
    <form class="filter-bar pending-sku-filter-bar" data-pending-sku-search>
      <input type="search" name="query" value="${escapeHtml(pendingSkuState.query)}" placeholder="搜索SKU、货品名称或ERP货品编码" />
      <button class="secondary-button" type="submit">搜索</button>
      ${pendingSkuState.query ? `<button class="text-button" type="button" data-action="clear-pending-sku-search">清空</button>` : ""}
    </form>
    ${pendingSkuState.error ? `<div class="form-error">${escapeHtml(pendingSkuState.error)}</div>` : ""}
    ${pendingSkuState.notice ? `<div class="form-success">${escapeHtml(pendingSkuState.notice)}</div>` : ""}
    ${pendingSkuState.loading ? `<div class="empty-state">正在读取待建立SKU…</div>` : `
      <div class="product-list-toolbar">
        <span>共 ${pendingSkuState.rows.length} 个待建立SKU${selectedCount > 0 ? ` · 已选择 ${selectedCount} 个` : ""}</span>
        ${canCreate ? `<button class="primary-button" type="button" data-action="batch-create-products-from-pending-skus" ${selectedCount === 0 ? "disabled" : ""}>批量创建产品</button>` : ""}
      </div>
      <div class="table-wrap"><table class="data-table pending-sku-table">
        <thead><tr>
          <th class="pending-sku-select-cell">${canCreate ? `<input type="checkbox" data-pending-sku-select-all aria-label="选择全部待建立SKU" ${allSelected ? "checked" : ""} />` : "选择"}</th>
          <th>产品图片</th><th>SKU编码</th><th>ERP货品名称</th><th>ERP货品编号</th><th>规格名称</th>
          <th>单位</th><th>条码</th><th>首次发现时间</th><th>状态</th><th>操作</th>
        </tr></thead>
        <tbody>${pendingSkuState.rows.length === 0
          ? `<tr><td colspan="11" class="empty-cell">暂无待建立SKU</td></tr>`
          : pendingSkuState.rows.map((sku) => `<tr>
              <td class="pending-sku-select-cell">${canCreate ? `<input type="checkbox" data-pending-sku-select="${escapeHtml(sku.id)}" aria-label="选择SKU ${escapeHtml(sku.merchantSkuCode)}" ${selectedPendingSkuIds.has(sku.id) ? "checked" : ""} />` : "—"}</td>
              <td>${renderImage({ mainImage: sku.mainImage, name: sku.goodsName || sku.merchantSkuCode }, "pending-sku-image")}</td>
              <td><strong>${escapeHtml(sku.merchantSkuCode)}</strong></td>
              <td>${escapeHtml(sku.goodsName || "未命名ERP货品")}</td>
              <td>${escapeHtml(sku.goodsCode || "—")}</td>
              <td>${escapeHtml(sku.specificationName || "—")}</td>
              <td>${escapeHtml(sku.unit || "—")}</td>
              <td>${escapeHtml(sku.barcode || "—")}</td>
              <td>${formatDateTime(sku.firstSeenAt)}</td>
              <td><span class="status-badge">待建立</span></td>
              <td>${canCreate ? `<button class="primary-button compact-button" type="button" data-action="create-product-from-pending-sku" data-erp-sku-id="${escapeHtml(sku.id)}" data-sku-code="${escapeHtml(sku.merchantSkuCode)}">创建产品</button>` : "仅可查看"}</td>
            </tr>`).join("")}
        </tbody>
      </table></div>`}
    ${renderProductV2ImportModal()}
  </section>`;
}

function renderProductPagination(total, totalPages) {
  if (totalPages <= 1) return "";
  const start = Math.max(1, Math.min(productPage - 2, totalPages - 4));
  const pages = Array.from({ length: Math.min(5, totalPages) }, (_, index) => start + index);
  return `<nav class="product-pagination" aria-label="产品分页">
    <span>第 ${productPage}/${totalPages} 页 · 共 ${total} 个 SKU</span>
    <div>
      <button class="secondary-button" type="button" data-action="product-page" data-page="${productPage - 1}" ${productPage === 1 ? "disabled" : ""}>上一页</button>
      ${pages.map((page) => `<button type="button" data-action="product-page" data-page="${page}" class="${page === productPage ? "is-active" : ""}">${page}</button>`).join("")}
      <button class="secondary-button" type="button" data-action="product-page" data-page="${productPage + 1}" ${productPage === totalPages ? "disabled" : ""}>下一页</button>
    </div>
  </nav>`;
}

function renderProductImportRecords() {
  const batches = [
    ...state.erpImportBatches.map((batch) => ({
      ...batch,
      fileName: batch.originalFilename,
      sourceSystem: `${batch.importType === "goods_info" ? "货品信息" : batch.importType === "inventory" ? "库存明细" : "平台货品"}${batch.syncRunId ? "" : " · 历史独立批次"}`,
      summary: batch.summaryJson,
    })),
    ...state.productImportBatches,
  ].sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")));
  if (batches.length === 0) return "";
  const statusLabels = {
    parsing: "解析中", parsed: "待校验", validated: "待确认", importing: "导入中",
    completed: "已导入", committed: "已导入", failed: "失败",
  };
  return `<section class="product-import-records">
    <div class="subsection-heading"><div><h2>导入记录</h2><p>货品信息、库存明细与平台货品分批记录，可追溯每次校验和提交结果</p></div></div>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>文件</th><th>来源</th><th>工作表</th><th>状态</th><th>总行数</th><th>新增</th><th>更新</th><th>导入时间</th><th>操作</th></tr></thead>
      <tbody>${batches.map((batch) => `<tr><td>${escapeHtml(batch.fileName)}</td><td>${escapeHtml(batch.sourceSystem || "ERP")}</td><td>${escapeHtml(batch.sheetName || "-")}</td><td><span class="status-badge">${escapeHtml(statusLabels[batch.status] || batch.status)}</span></td><td>${batch.summary?.total ?? "-"}</td><td>${batch.summary?.create ?? batch.summary?.created ?? "-"}</td><td>${batch.summary?.update ?? batch.summary?.updated ?? "-"}</td><td>${formatDateTime(batch.committedAt || batch.createdAt)}</td>
        <td>${batch.importType && ["parsed", "validated", "failed"].includes(batch.status) ? `<button class="text-button" type="button" data-action="resume-product-v2-import" data-batch-id="${escapeHtml(batch.id)}">继续处理</button>` : "—"}</td></tr>`).join("")}</tbody>
    </table></div>
  </section>`;
}

function getProductExecutionArchive(productId) {
  const actions = getRelatedActions(productId);
  const actionIds = new Set(actions.map((instance) => instance.id));
  const tasks = state.tasks.filter((task) => actionIds.has(task.processInstanceId));
  const departmentIds = new Set();

  actions.forEach((instance) => {
    const standard = state.taskTemplates.find((item) => item.id === instance.taskTemplateId);
    if (standard?.departmentId) departmentIds.add(standard.departmentId);
  });
  tasks.forEach((task) => {
    if (task.departmentId) departmentIds.add(task.departmentId);
    const node = state.processTemplateNodes.find((item) => item.id === task.processNodeId);
    const departmentId = node?.departmentId ?? node?.ownerDepartmentId;
    if (departmentId) departmentIds.add(departmentId);
  });

  const activities = [
    ...actions.map((instance) => ({
      id: `action-${instance.id}`,
      type: "关键行动",
      title: instance.displayTitle || instance.name || "未命名关键行动",
      detail: getProcessInstanceBusinessStatus(instance.id, state).label,
      occurredAt: instance.updatedAt || instance.completedAt || instance.startedAt || instance.createdAt,
    })),
    ...tasks.map((task) => ({
      id: `task-${task.id}`,
      type: "任务",
      title: task.name || "未命名任务",
      detail: task.submittedAt ? "已提交结果" : task.completedAt ? "已完成" : "任务已更新",
      occurredAt: task.updatedAt || task.submittedAt || task.completedAt || task.startDate || task.createdAt,
    })),
  ].filter((item) => item.occurredAt).sort((left, right) => String(right.occurredAt).localeCompare(String(left.occurredAt))).slice(0, 6);

  return {
    actions,
    tasks,
    departments: [...departmentIds].map((id) => findName(state.departments, id)).filter((name) => name !== "未设置"),
    activities,
  };
}

function renderProductSourceDetails(product) {
  const dimensions = [product.lengthCm, product.widthCm, product.heightCm].some((value) => value !== null && value !== undefined)
    ? `${product.lengthCm ?? "-"} × ${product.widthCm ?? "-"} × ${product.heightCm ?? "-"} cm`
    : "";
  const fields = [
    ["规格名称", product.skuName],
    ["品类", product.productType],
    ["风格", product.style],
    ["重量", product.weightKg === null || product.weightKg === undefined ? "" : `${product.weightKg} kg`],
    ["长宽高", dimensions],
    ["体积", product.volumeCm3 === null || product.volumeCm3 === undefined ? "" : `${product.volumeCm3} cm³`],
    ["摆放位置", product.placement],
    ["级别", product.grade],
    ["主条码", product.identifiers?.barcode],
    ["主供应商", product.supplierInfo?.primarySupplier],
    ["数据来源", product.sourceSystem],
    ["ERP更新时间", product.sourceUpdatedAt],
  ].filter(([, value]) => String(value ?? "").trim() !== "");
  if (fields.length === 0) return "";
  return `<div class="product-source-details">
    <h3>ERP 与规格资料</h3>
    <div class="detail-grid">${fields.map(([label, value]) => `<div class="detail-field"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}</div>
  </div>`;
}

function renderProductExecutionSummary(archive) {
  return `<section class="product-detail-band">
    <h2>执行情况</h2>
    <div class="product-execution-summary">
      <div class="product-execution-metrics">
        <div><span>关联任务</span><strong>${archive.tasks.length}</strong></div>
        <div><span>涉及部门</span><strong>${archive.departments.length}</strong></div>
        <div><span>最近活动</span><strong>${archive.activities.length ? formatDateTime(archive.activities[0].occurredAt) : "暂无"}</strong></div>
      </div>
      <div class="product-execution-departments">
        <h3>涉及部门</h3>
        ${archive.departments.length ? `<div>${archive.departments.map((name) => `<span>${escapeHtml(name)}</span>`).join("")}</div>` : `<p class="form-note">暂无部门记录</p>`}
      </div>
      <div class="product-activity-list">
        <h3>最近活动</h3>
        ${archive.activities.length ? archive.activities.map((activity) => `<div class="product-activity-item">
          <span>${escapeHtml(activity.type)}</span>
          <strong>${escapeHtml(activity.title)}</strong>
          <small>${escapeHtml(activity.detail)} · ${formatDateTime(activity.occurredAt)}</small>
        </div>`).join("") : `<p class="form-note">暂无执行活动</p>`}
      </div>
    </div>
  </section>`;
}

function getProductSalesRows(productId) {
  return productSalesState.productId === productId ? productSalesState.rows : [];
}

function renderProductSalesLinks(productId) {
  const rows = getProductSalesRows(productId);
  const platformCount = new Set(rows.map((item) => item.platform)).size;
  const shopCount = new Set(rows.map((item) => item.shopId)).size;
  const linkCount = new Set(rows.map((item) => item.salesLinkId)).size;
  return `<section class="product-detail-band product-sales-links">
    <div class="subsection-heading"><div><h2>销售链接</h2><p>${platformCount} 个平台 · ${shopCount} 个店铺 · ${linkCount} 条链接 · ${rows.length} 个平台SKU</p></div></div>
    ${productSalesState.loading ? `<p class="form-note">正在读取销售链接…</p>` : ""}
    ${productSalesState.error ? `<div class="form-error">${escapeHtml(productSalesState.error)}</div>` : ""}
    ${!productSalesState.loading && rows.length === 0 ? `<div class="empty-cell">暂无平台销售链接</div>` : renderProductSalesGroups(rows)}
  </section>`;
}

function renderProductSalesGroups(rows) {
  const platforms = new Map();
  for (const row of rows) {
    const platformKey = row.platform || "未识别平台";
    const shops = platforms.get(platformKey) ?? new Map();
    const shopKey = row.shopId || row.displayName || row.shopName || "unknown-shop";
    const shop = shops.get(shopKey) ?? { name: row.displayName || row.shopName || "未命名店铺", links: new Map() };
    const link = shop.links.get(row.salesLinkId) ?? {
      id: row.salesLinkId,
      title: row.title,
      platformGoodsId: row.platformGoodsId,
      platformGoodsCode: row.platformGoodsCode,
      connectionProfileId: row.connectionProfileId,
      canonicalUrl: row.canonicalUrl,
      status: row.linkStatus,
      skus: [],
    };
    link.skus.push(row);
    shop.links.set(row.salesLinkId, link);
    shops.set(shopKey, shop);
    platforms.set(platformKey, shops);
  }
  return `<div class="product-sales-platforms">${[...platforms.entries()].map(([platform, shops]) => `
    <section class="product-sales-platform-group"><h3>${escapeHtml(platform)}</h3>
      ${[...shops.values()].map((shop) => `<div class="product-sales-shop-group">
        <div class="product-sales-shop-heading"><strong>${escapeHtml(shop.name)}</strong><span>${shop.links.size} 条商品链接</span></div>
        ${[...shop.links.values()].map((link) => `<details class="product-sales-link-card">
          <summary><span>${escapeHtml(link.title || link.platformGoodsCode || link.platformGoodsId || "未命名商品")}</span><span>${link.skus.length} 个当前产品SKU</span></summary>
          <div class="product-sales-link-meta">
            <span>平台商品ID：${escapeHtml(link.platformGoodsId || "—")}</span>
            <span>平台货品编号：${escapeHtml(link.platformGoodsCode || "—")}</span>
            <span>状态：${escapeHtml(link.status || "—")}</span>
            ${link.canonicalUrl ? `<a class="text-button" href="${escapeHtml(link.canonicalUrl)}" target="_blank" rel="noopener noreferrer">打开链接</a>` : ""}
            ${link.connectionProfileId ? `<a class="text-button" href="#connectionCenter/${encodeURIComponent(link.connectionProfileId)}">进入经营链接详情</a>` : ""}
          </div>
          <div class="table-wrap"><table class="data-table"><thead><tr><th>平台SKU编码</th><th>产品编码</th><th>产品名称</th><th>规格名称</th><th>价格</th><th>平台库存</th><th>关联时间</th><th>关联状态</th><th>匹配方式</th><th>操作</th></tr></thead>
            <tbody>${link.skus.map((sku) => { const product = state.products.find((item) => item.id === sku.productId); return `<tr><td>${escapeHtml(sku.platformSkuCode || sku.platformSkuId || "—")}</td><td><strong>${escapeHtml(product?.skuCode || "—")}</strong></td><td>${escapeHtml(product?.name || "—")}</td><td>${escapeHtml(sku.specificationName || "—")}</td>
              <td>${sku.price ?? "—"}</td><td>${sku.platformStock ?? "—"}</td><td>${formatDateTime(sku.updatedAt)}</td><td><span class="status-badge">${escapeHtml(sku.currentState === "active" ? "关联有效" : sku.currentState || "—")}</span></td><td>${escapeHtml(sku.matchMethod === "manual" ? "关系审批" : sku.matchMethod === "sku_code" ? "规格编码匹配" : sku.matchMethod === "goods_single_sku" ? "单规格货品匹配" : sku.matchStatus || "—")}</td>
              <td>—</td></tr>`; }).join("")}</tbody>
          </table></div>
        </details>`).join("")}
      </div>`).join("")}
    </section>`).join("")}</div>`;
}

function renderUnmatchedPlatformSkus() {
  const rows = unmatchedSkuState.rows;
  if (!unmatchedSkuState.loading && unmatchedSkuState.loaded && rows.length === 0) return "";
  return `<section class="product-import-records unmatched-platform-skus">
    <div class="subsection-heading"><div><h2>未匹配平台 SKU</h2><p>共 ${unmatchedSkuState.total} 条；人工绑定优先于下次自动匹配。</p></div>
      <form data-unmatched-search><input name="query" value="${escapeHtml(unmatchedSkuState.query)}" placeholder="搜索平台SKU、商品标题或商品ID" /><button class="secondary-button" type="submit">搜索</button></form>
    </div>
    ${unmatchedSkuState.loading ? `<p class="form-note">正在读取未匹配平台SKU…</p>` : ""}
    ${unmatchedSkuState.error ? `<div class="form-error">${escapeHtml(unmatchedSkuState.error)}</div>` : ""}
    <div class="table-wrap"><table class="data-table"><thead><tr><th>平台</th><th>店铺</th><th>商品链接</th><th>平台货品编号</th><th>平台SKU</th><th>规格</th><th>可能ERP货品</th><th>原因</th><th>绑定产品</th><th>操作</th></tr></thead>
      <tbody>${rows.slice(0, 200).map((sku) => {
        return `<tr><td>${escapeHtml(sku.platform || "-")}</td><td>${escapeHtml(sku.displayName || sku.shopName || "-")}</td>
          <td>${sku.canonicalUrl ? `<a class="text-button" href="${escapeHtml(sku.canonicalUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(sku.title || "打开链接")}</a>` : escapeHtml(sku.title || "-")}</td>
          <td>${escapeHtml(sku.platformGoodsCode || "-")}</td><td>${escapeHtml(sku.platformSkuCode || sku.platformSkuId || "-")}</td>
          <td>${escapeHtml(sku.specificationName || "-")}</td><td>${escapeHtml(sku.possibleErpGoodsCode ? `${sku.possibleErpGoodsCode} · ${sku.possibleErpGoodsName || ""}` : "—")}</td><td>${escapeHtml(sku.matchReason || sku.matchStatus || "-")}</td>
          <td><button class="secondary-button compact-button" type="button" data-action="open-platform-product-link" data-sku-id="${escapeHtml(sku.id)}">搜索并关联</button></td>
          <td class="table-actions">
            <button class="text-button" type="button" data-action="mark-platform-combination" data-sku-id="${escapeHtml(sku.id)}">组合装</button>
            <button class="text-button" type="button" data-action="ignore-platform-sku" data-sku-id="${escapeHtml(sku.id)}">忽略</button></td></tr>`;
      }).join("")}</tbody></table></div>
  </section>`;
}

function productRelationSkuCodes(productId) {
  return (state.productErpMappings ?? []).filter((item) => item.productId === productId)
    .flatMap((item) => [item.merchantSkuCode, item.barcode]).filter(Boolean);
}

function platformProductMatches(query) {
  const raw = String(query ?? "").trim(); const normalized = normalizeProductSkuCode(raw); const lowered = raw.toLowerCase();
  if (!raw) return [];
  return state.products.filter((product) => product.status !== "已归档").map((product) => {
    const codes = [product.skuCode, ...productRelationSkuCodes(product.id)].filter(Boolean);
    const exactProductCode = normalizeProductSkuCode(product.skuCode) === normalized;
    const exactSkuCode = codes.some((code) => normalizeProductSkuCode(code) === normalized);
    const matched = exactSkuCode || String(product.name ?? "").toLowerCase().includes(lowered)
      || codes.some((code) => normalizeProductSkuCode(code).includes(normalized));
    return { product, codes, exactProductCode, exactSkuCode, matched };
  }).filter((item) => item.matched).sort((left, right) => Number(right.exactProductCode) - Number(left.exactProductCode)
    || Number(right.exactSkuCode) - Number(left.exactSkuCode)
    || String(left.product.skuCode).localeCompare(String(right.product.skuCode), "zh-CN", { numeric: true })).slice(0, 30);
}

function renderPlatformProductLinkModal() {
  if (!platformProductLinkState.skuId) return "";
  const sku = unmatchedSkuState.rows.find((item) => item.id === platformProductLinkState.skuId);
  if (!sku) return "";
  const matches = platformProductMatches(platformProductLinkState.query); const selected = state.products.find((item) => item.id === platformProductLinkState.selectedProductId);
  return `<div class="modal-backdrop"><section class="modal-panel platform-product-link-modal" role="dialog" aria-modal="true" aria-label="产品编码搜索与关联"><header class="modal-header"><div><p class="eyebrow">平台SKU快速关联</p><h2>搜索并关联产品</h2><small>${escapeHtml(sku.platformSkuCode || sku.platformSkuId || "未命名平台SKU")} · ${escapeHtml(sku.specificationName || "未设置规格")}</small></div><button class="icon-button" type="button" data-action="close-platform-product-link" aria-label="关闭">×</button></header>
    <form class="platform-product-quick-search" data-platform-product-search><label>产品编码、SKU编码或产品名称<input name="query" value="${escapeHtml(platformProductLinkState.query)}" placeholder="优先输入完整产品编码" autofocus autocomplete="off" /></label><button class="secondary-button" type="submit">查询</button></form>
    ${platformProductLinkState.error ? `<div class="form-error">${escapeHtml(platformProductLinkState.error)}</div>` : ""}
    ${platformProductLinkState.query && !matches.length ? `<div class="empty-state compact"><strong>未找到对应产品</strong><p>请核对产品编码，或改用SKU编码、产品名称搜索。</p></div>` : ""}
    ${matches.length ? `<div class="platform-product-search-results">${matches.map(({ product, codes, exactProductCode }) => `<button type="button" class="${selected?.id === product.id ? "is-selected" : ""}" data-action="select-platform-product" data-product-id="${escapeHtml(product.id)}">${renderImage(product, "platform-product-result-image")}<span><strong>${escapeHtml(product.skuCode)}</strong><small>${escapeHtml(product.name)}</small><em>ERP/SKU：${escapeHtml(codes.join("、") || "—")}</em></span><i>${selected?.id === product.id ? "已选择" : exactProductCode ? "编码精确匹配" : "可关联"}</i></button>`).join("")}</div>` : !platformProductLinkState.query ? `<div class="empty-state compact">输入产品编码可最快定位；也支持SKU编码和产品名称。</div>` : ""}
    ${selected ? `<section class="platform-product-link-confirm"><h3>关联确认</h3><div>${renderImage(selected, "platform-product-result-image")}<span><strong>${escapeHtml(selected.name)}</strong><small>产品编码：${escapeHtml(selected.skuCode)}</small><small>SKU：${escapeHtml(productRelationSkuCodes(selected.id).join("、") || selected.skuCode)}</small></span></div><button class="primary-button" type="button" data-action="confirm-platform-product-link">确认关联</button></section>` : ""}
  </section></div>`;
}

function renderProductDetail(product) {
  if (productDetailId !== product.id) {
    productDetailId = product.id;
    productDetailTab = "basic";
  }
  const archive = getProductExecutionArchive(product.id);
  const actions = archive.actions;
  const erp = getProductErpContext(product.id);
  return `
    <section class="product-center-page product-detail-page">
      ${productManagementState.error ? `<div class="form-error">${escapeHtml(productManagementState.error)}</div>` : ""}
      ${productManagementState.notice ? `<div class="form-success">${escapeHtml(productManagementState.notice)}</div>` : ""}
      <button class="text-button product-detail-back" type="button" data-action="back-products">← 返回产品列表</button>
      ${renderProductWorkspaceTabs()}
      <header class="product-detail-hero">
        <div class="product-detail-media">${renderImage(product, "product-detail-main-image")}</div>
        <div class="product-detail-identity">
          <div><span class="status-badge">${escapeHtml(product.status || "—")}</span><span>${escapeHtml(product.brand || "未设置品牌")}</span></div>
          <h1>${escapeHtml(product.name)}</h1>
          <p>${escapeHtml(product.category || "未设置分类")}</p>
        </div>
        ${hasPermission(getCurrentUser(), "products.manage") ? `<button class="primary-button" type="button" data-action="edit-product" data-product-id="${product.id}">编辑产品</button>` : ""}
      </header>
      <nav class="product-detail-tabs" aria-label="产品详情">
        ${[
          ["basic", "基本信息"],
          ["strategy", "产品战略"],
          ["business", "经营分析"],
          ["health-analysis", "产品健康分析"],
          ["business-diagnosis", "经营诊断"],
          ["user-insights", "用户洞察"],
          ["business-improvement", "经营改善"],
          ["lifecycle", "生命周期"],
          ["improvements", "改善记录"],
          ["erp", "更多信息"],
          ["sales", "销售链接"],
          ["actions", "关键行动"],
          ["templates", "关联模板"],
        ].map(([id, label]) => `<button type="button" data-action="product-detail-tab" data-tab="${id}" class="${productDetailTab === id ? "is-active" : ""}">${label}</button>`).join("")}
      </nav>
      <div class="product-detail-tab-panel">${renderProductDetailTab(product, archive, erp)}</div>
      ${renderProductModal()}
      ${renderProductSkuChangeModal()}
    </section>
  `;
}

function renderInfoGroup(title, fields) {
  return `<section class="product-info-group"><h2>${escapeHtml(title)}</h2><div class="product-info-grid">
    ${fields.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${formatMetric(value)}</strong></div>`).join("")}
  </div></section>`;
}

function renderProductDetailTab(product, archive, erp) {
  if (productDetailTab === "business") return renderProductBusinessTab(product);
  if (productDetailTab === "health-analysis") return renderProductHealthAnalysisTab(product);
  if (productDetailTab === "business-improvement") return renderProductBusinessImprovementTab(product);
  if (productDetailTab === "lifecycle") return renderProductLifecycleTab(product);
  if (productDetailTab === "strategy") return renderProductStrategyTab(product);
  if (productDetailTab === "business-diagnosis") return renderProductBusinessDiagnosisTab(product);
  if (productDetailTab === "user-insights") return renderProductInsightTab(product);
  if (productDetailTab === "improvements") return renderProductImprovementsTab(product);
  if (productDetailTab === "erp") return renderProductErpTab(erp);
  if (productDetailTab === "sales") return renderProductSalesLinks(product.id);
  if (productDetailTab === "actions") return renderProductActionsTab(archive.actions);
  if (productDetailTab === "templates") return renderProductTemplatesTab(archive.actions);
  const dimensions = [product.lengthCm, product.widthCm, product.heightCm].some((value) => value !== null && value !== undefined)
    ? `${product.lengthCm ?? "—"} × ${product.widthCm ?? "—"} × ${product.heightCm ?? "—"} cm`
    : "—";
  return `<div class="product-basic-layout">
    ${renderInfoGroup("产品身份", [
      ["产品名称", product.name], ["SKU编码", product.skuCode], ["规格名称", product.skuName || product.specification],
      ["品牌", product.brand], ["分类", product.category], ["品类", product.productType],
    ])}
    ${renderInfoGroup("产品属性", [
      ["风格", product.style], ["材质", product.material], ["颜色", product.color], ["摆放位置", product.placement],
      ["条码", product.identifiers?.barcode], ["单位", product.unitInfo?.unit || product.unitInfo?.name],
    ])}
    ${renderInfoGroup("包装与物流", [
      ["重量", product.weightKg === null || product.weightKg === undefined ? "—" : `${product.weightKg} kg`],
      ["长宽高", dimensions], ["体积", product.volumeCm3 === null || product.volumeCm3 === undefined ? "—" : `${product.volumeCm3} cm³`],
      ["产品负责人", findName(state.people, product.ownerId)], ["备注", product.remark],
    ])}
    ${Array.isArray(product.galleryImages) && product.galleryImages.length ? `<section class="product-info-group"><h2>产品图片</h2><div class="product-gallery">${product.galleryImages.map((url) => `<img src="${escapeHtml(resolveAssetUrl(url))}" alt="产品图片" loading="lazy" />`).join("")}</div></section>` : ""}
  </div>`;
}

function getProductManagementDetail(productId) { return productManagementState.details.get(productId) ?? null; }

function renderProductBusinessTab(product) {
  const detail = getProductManagementDetail(product.id);
  if (!detail) return `<div class="product-detail-empty">${productManagementState.loadingProductId === product.id ? "正在读取经营分析…" : "暂无经营分析"}</div>`;
  const analysis = detail.analysis; const latestHealth = detail.healthRecords?.[0];
  return `<div class="product-business-analysis"><div class="product-business-metrics">
    <article><span>直接销量</span><strong>${formatMetric(analysis.sales.directSalesQuantity)}</strong><small>Single直接销售</small></article>
    <article><span>组合贡献销量</span><strong>${formatMetric(analysis.sales.bundleContributionQuantity)}</strong><small>参与 ${formatMetric(analysis.sales.contributingBundleCount)} 个组合装</small></article>
    <article><span>实际出货贡献</span><strong>${formatMetric(analysis.sales.totalPhysicalContribution)}</strong><small>增长 ${formatPercent(analysis.sales.growth)}</small></article>
    <article><span>直接销售额</span><strong>${formatMoney(analysis.finance.revenue)}</strong><small>Bundle金额不分摊</small></article>
    <article><span>直接毛利润</span><strong>${formatMoney(analysis.finance.grossProfit)}</strong><small>毛利率 ${formatPercent(analysis.finance.profitMargin)}</small></article>
    <article><span>实际库存</span><strong>${formatMetric(analysis.inventory.actualStock)}</strong><small>${escapeHtml(analysis.inventory.risk)}</small></article>
    <article><span>库存周转</span><strong>${formatPercent(analysis.inventory.turnover)}</strong><small>库存效率</small></article>
    <article><span>健康状态</span><strong>${escapeHtml(detail.healthAnalysis?.overall?.label || healthLabel(latestHealth?.healthStatus))}</strong><small>详细原因请查看“产品健康分析”</small></article>
  </div>${hasPermission(getCurrentUser(), "products.manage") ? `<button class="primary-button" type="button" data-action="evaluate-product-health" data-product-id="${escapeHtml(product.id)}">生成经营体检</button>` : ""}
  <section class="product-problem-list"><h2>经营问题</h2>${detail.issues?.length ? detail.issues.map((issue) => `<article><span class="status-badge">${escapeHtml(issue.severity)}</span><strong>${escapeHtml(issue.title)}</strong><small>${escapeHtml(issue.status)}</small></article>`).join("") : `<p>暂未生成经营问题</p>`}</section></div>`;
}

function renderProductHealthRecommendation(product, recommendation, issue, activeGoals, actionTemplates, canCreate) {
  return `<article><div><strong>${escapeHtml(recommendation.title)}</strong><p>${escapeHtml(recommendation.reason)}</p></div>
    ${issue ? `<dl class="product-health-action-context"><div><dt>产品</dt><dd>${escapeHtml(product.name)}</dd></div><div><dt>问题类型</dt><dd>${escapeHtml(issue.category)} · ${escapeHtml(issue.issueTypeLabel)}</dd></div><div><dt>问题描述</dt><dd>${escapeHtml(issue.problemDescription)}</dd></div><div><dt>改善目标</dt><dd>${escapeHtml(issue.improvementGoal)}</dd></div><div><dt>建议方向</dt><dd>${escapeHtml(issue.suggestedDirection)}</dd></div></dl>` : ""}
    ${canCreate ? `<form data-product-health-action-form data-product-id="${escapeHtml(product.id)}" data-recommendation-code="${escapeHtml(recommendation.code)}"><input type="hidden" name="title" value="${escapeHtml(recommendation.title)}：${escapeHtml(product.name)}" /><select name="goalId" required><option value="">选择目标</option>${activeGoals.map((goal) => `<option value="${escapeHtml(goal.id)}">${escapeHtml(goal.name)}</option>`).join("")}</select><select name="taskTemplateId" required><option value="">选择行动标准</option>${actionTemplates.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("")}</select><button class="primary-button" type="submit" ${!activeGoals.length || !actionTemplates.length ? "disabled" : ""}>确认并创建改善行动</button><small>创建后进入关键行动，可继续关联多个产品；本步不生成任务。</small></form>` : ""}</article>`;
}

function renderProductHealthAnalysisTab(product) {
  const detail = getProductManagementDetail(product.id);
  const analysis = detail?.healthAnalysis;
  if (!analysis) return `<div class="product-detail-empty">${productManagementState.loadingProductId === product.id ? "正在读取产品健康分析…" : "暂无健康分析数据"}</div>`;
  const dimensionMeta = [
    ["sales", "销售趋势", "近30天销售变化"],
    ["inventory", "库存状态", "当前库存覆盖周期"],
    ["profit", "利润状态", "毛利率、利润贡献"],
    ["links", "链接表现", "关联销售链接整体表现"],
    ["lifecycle", "生命周期", "产品阶段判断"],
  ];
  const activeGoals = state.goals.filter((item) => item.status === "active");
  const actionTemplates = state.taskTemplates.filter((item) => item.status === "active" && item.defaultProcessTemplateId
    && state.processTemplates.some((process) => process.id === item.defaultProcessTemplateId));
  const canCreate = hasPermission(getCurrentUser(), "products.manage");
  const center = detail?.improvementCenter;
  return `<div class="product-health-analysis">
    <header class="product-health-overall"><div><p class="eyebrow">产品健康</p><h2>综合状态：${escapeHtml(analysis.overall?.emoji || "⚪")} ${escapeHtml(analysis.overall?.label || "暂无数据")}</h2><p>基于现有销售、库存、利润、链接与生命周期数据的可解释规则分析。</p></div><span class="product-health-readonly">只读分析 · 不覆盖人工判断</span></header>
    <section class="product-health-dimensions">${dimensionMeta.map(([key, title, caption]) => { const dimension = analysis.dimensions?.[key] ?? { code: "no_data", label: "暂无数据", explanation: "暂无数据" }; return `<article class="product-health-dimension severity-${escapeHtml(dimension.severity || "no_data")}"><div><span>${escapeHtml(title)}</span>${businessStatus(dimension.label, dimension.code, `health-dimension`)}</div><strong>${escapeHtml(caption)}</strong><p>${escapeHtml(dimension.explanation || "暂无数据")}</p></article>`; }).join("")}</section>
    <section class="product-health-recommendations"><header><div><h2>改善建议</h2><p>选择目标和行动标准后创建关键行动草稿；不直接生成任务。</p></div></header>
      ${analysis.recommendations?.length ? analysis.recommendations.map((recommendation) => renderProductHealthRecommendation(product, recommendation, center?.currentIssues?.find((item) => item.recommendationCode === recommendation.code), activeGoals, actionTemplates, canCreate)).join("") : `<div class="product-detail-empty">当前未发现需要创建改善行动的问题。</div>`}
      ${canCreate && analysis.recommendations?.length && (!activeGoals.length || !actionTemplates.length) ? `<p class="product-health-action-hint">需先准备一个进行中的目标，并启用已绑定标准流程的关键行动。</p>` : ""}
    </section>
  </div>`;
}

function productImprovementActionStatus(status) {
  return ({ draft: "草稿", running: "执行中", done: "已完成", completed: "已完成", stopped: "已终止", canceled: "已取消", cancelled: "已取消" })[status] || status || "待执行";
}

function renderProductBusinessImprovementTab(product) {
  const detail = getProductManagementDetail(product.id);
  const center = detail?.improvementCenter;
  if (!center) return `<div class="product-detail-empty">${productManagementState.loadingProductId === product.id ? "正在读取经营改善…" : "暂无经营改善数据"}</div>`;
  const canEdit = hasPermission(getCurrentUser(), "products.manage");
  const resultItems = center.improvements.filter((item) => item.resultSummary);
  const issueGroups = [...new Map(center.issueTypes.map((item) => [item.category, center.issueTypes.filter((type) => type.category === item.category)])).entries()];
  return `<div class="product-business-improvement">
    <section class="product-improvement-current"><header><div><p class="eyebrow">产品 → 健康分析 → 经营问题</p><h2>当前经营问题</h2><p>仅展示当前健康分析发现；不自动关闭问题，不覆盖人工判断。</p></div></header>
      <div class="product-improvement-issues">${center.currentIssues.length ? center.currentIssues.map((issue) => `<article class="severity-${escapeHtml(issue.severity)}"><div><span>${issue.severity === "risk" ? "🔴" : "🟡"}</span><strong>${escapeHtml(issue.title)}</strong>${businessStatus(issue.status === "improving" ? "改善中" : "待改善", issue.status, "improvement")}</div><dl><div><dt>标准问题</dt><dd>${escapeHtml(issue.category)} · ${escapeHtml(issue.issueTypeLabel)}</dd></div><div><dt>原因</dt><dd>${escapeHtml(issue.reason)}</dd></div><div><dt>改善目标</dt><dd>${escapeHtml(issue.improvementGoal)}</dd></div><div><dt>建议方向</dt><dd>${escapeHtml(issue.suggestedDirection)}</dd></div></dl>${canEdit ? `<button class="primary-button" type="button" data-action="open-product-health" data-product-id="${escapeHtml(product.id)}">创建改善行动</button>` : ""}</article>`).join("") : `<div class="product-detail-empty">当前健康分析未发现待改善问题。</div>`}</div>
      <details class="product-issue-type-catalog"><summary>查看标准产品经营问题类型</summary><div>${issueGroups.map(([category, items]) => `<section><strong>${escapeHtml(category)}</strong><p>${items.map((item) => escapeHtml(item.label)).join(" · ")}</p></section>`).join("")}</div></details>
    </section>
    <section class="product-improvement-actions"><header><div><h2>改善行动列表</h2><p>复用关键行动和任务执行链路，不创建第二套任务系统。</p></div></header>
      ${center.improvements.length ? `<div class="connection-table-wrap"><table class="connection-table product-improvement-table"><thead><tr><th>改善事项</th><th>问题类型</th><th>关联关键行动</th><th>负责人</th><th>状态</th><th>开始时间</th><th>完成时间</th><th>结果</th></tr></thead><tbody>${center.improvements.map((item) => `<tr><td><strong>${escapeHtml(item.title)}</strong><small>任务进度 ${item.doneTaskCount}/${item.taskCount}</small></td><td>${escapeHtml(item.issueCategory)} · ${escapeHtml(item.issueTypeLabel)}</td><td><a class="text-button" href="#schedule-board">${escapeHtml(item.actionName || item.actionId)} →</a></td><td>${escapeHtml(item.ownerName)}</td><td>${businessStatus(productImprovementActionStatus(item.actionStatus), item.actionStatus, "improvement-action")}</td><td>${formatDateTime(item.startAt)}</td><td>${item.completedAt ? formatDateTime(item.completedAt) : "—"}</td><td>${item.resultSummary ? escapeHtml(item.resultSummary) : item.canRecordResult ? "待记录" : "执行中"}</td></tr>`).join("")}</tbody></table></div>` : `<div class="product-detail-empty">暂无关联改善行动。</div>`}
    </section>
    <section class="product-improvement-results"><header><div><h2>改善结果</h2><p>关键行动完成后由用户手工记录；不自动完成行动或关闭问题。</p></div></header>
      ${center.improvements.filter((item) => item.canRecordResult && !item.resultSummary).map((item) => canEdit ? `<form class="product-improvement-result-form" data-product-improvement-result-form data-improvement-id="${escapeHtml(item.id)}"><div><strong>${escapeHtml(item.title)}</strong><p>改善前状态：${escapeHtml(item.beforeMetrics?.summary || item.issueTitle || "暂无数据")}</p></div><label>改善措施<textarea name="improvementMeasures" rows="3" required placeholder="例如：重新制作详情页"></textarea></label><label>改善后结果<textarea name="resultSummary" rows="3" required placeholder="例如：转化率 5.2% → 7.1%"></textarea></label><label>完成时间<input type="date" name="completedAt" value="${escapeHtml(String(item.actionCompletedAt || item.completedAt || "").slice(0, 10))}" required /></label><button class="primary-button" type="submit">记录改善结果</button></form>` : "").join("")}
      ${resultItems.length ? `<div class="product-improvement-result-list">${resultItems.map((item) => `<article><div><strong>${escapeHtml(item.title)}</strong><span>${formatDateTime(item.completedAt)}</span></div><dl><div><dt>问题</dt><dd>${escapeHtml(item.issueTypeLabel)}</dd></div><div><dt>改善前状态</dt><dd>${escapeHtml(item.beforeMetrics?.summary || "暂无数据")}</dd></div><div><dt>改善措施</dt><dd>${escapeHtml(item.improvementMeasures || "暂无数据")}</dd></div><div><dt>改善后结果</dt><dd>${escapeHtml(item.resultSummary)}</dd></div></dl></article>`).join("")}</div>` : center.improvements.some((item) => item.canRecordResult) ? "" : `<div class="product-detail-empty">暂无已完成关键行动的改善结果。</div>`}
    </section>
  </div>`;
}

function strategyPersonOptions(selectedId = "") {
  return `<option value="">未设置</option>${state.people.map((person) => `<option value="${escapeHtml(person.id)}" ${person.id === selectedId ? "selected" : ""}>${escapeHtml(person.name)}</option>`).join("")}`;
}

function strategyOptionList(values, selected = "", emptyLabel = "未设置") {
  return `<option value="">${emptyLabel}</option>${values.map((value) => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}`;
}

function renderStrategyHistoryVersion(version) {
  const content = version.content; const management = content.management;
  return `<details><summary><strong>V${version.version}</strong><span>生效 ${formatDateTime(version.effectiveAt)} · 结束 ${version.endedAt ? formatDateTime(version.endedAt) : "—"} · ${escapeHtml(version.changedByName || "未知修改人")}</span></summary>
    <div class="product-strategy-history-content"><p><b>产品定位：</b>${escapeHtml(content.positioning.positioning || "未设置")} · ${escapeHtml(content.positioning.productRole || "未设置角色")}</p>
    <p><b>竞争策略：</b>${escapeHtml(content.competition.description || content.competition.differentiation || "未设置")}</p>
    <p><b>策略周期：</b>${escapeHtml(management.periodLabel || management.periodType || "未设置")}</p>
    <p><b>当前经营策略：</b>${escapeHtml(management.currentStrategy || "未设置")}</p>
    <p><b>下一步策略：</b>${content.nextStrategies.length ? content.nextStrategies.map((item) => escapeHtml(item.content)).join(" · ") : "未设置"}</p></div></details>`;
}

function renderProductStrategyTab(product) {
  const strategy = getProductManagementDetail(product.id)?.strategy;
  if (!strategy) return `<div class="product-detail-empty">${productManagementState.loadingProductId === product.id ? "正在读取产品战略…" : "暂无产品战略数据"}</div>`;
  const current = strategy.current; const content = current?.content ?? { positioning: {}, competition: {}, goals: {}, management: {}, nextStrategies: [] };
  const { positioning, competition, goals, management, nextStrategies } = content;
  const canEdit = hasPermission(getCurrentUser(), "products.manage");
  const activeGoals = state.goals.filter((item) => item.status === "active");
  const actionTemplates = state.taskTemplates.filter((item) => item.status === "active" && item.defaultProcessTemplateId
    && state.processTemplates.some((process) => process.id === item.defaultProcessTemplateId));
  const ownerName = (id) => state.people.find((person) => person.id === id)?.name || "未设置";
  return `<div class="product-strategy-panel">
    <header class="product-strategy-heading"><div><p class="eyebrow">POSITION → COMPETE → TARGET → STRATEGY → ACTION</p><h2>产品战略</h2><p>由管理者人工制定，系统不自动生成、改写或覆盖。</p></div>${current ? `<span class="product-strategy-version">V${current.version} · ${formatDateTime(current.effectiveAt)}</span>` : `<span class="product-strategy-version">尚未建立</span>`}</header>
    <aside class="product-strategy-boundary"><div><strong>产品战略</strong><span>接下来准备怎么经营这个产品？</span></div><div><strong>经营改善</strong><span>当前发现了什么问题，准备怎么解决？</span></div></aside>
    <div class="product-strategy-grid">
      <form class="product-strategy-card" data-product-strategy-section="positioning" data-product-id="${escapeHtml(product.id)}"><header><h3>产品定位</h3><span>经营角色与生命周期独立</span></header><label>目标用户<textarea name="targetUsers" rows="2">${escapeHtml(positioning.targetUsers || "")}</textarea></label><label>核心使用场景<textarea name="coreScenarios" rows="2">${escapeHtml(positioning.coreScenarios || "")}</textarea></label><label>产品定位<textarea name="positioning" rows="3">${escapeHtml(positioning.positioning || "")}</textarea></label><label>价格定位<input name="pricePositioning" value="${escapeHtml(positioning.pricePositioning || "")}" /></label><label>产品角色<select name="productRole">${strategyOptionList(strategy.options.roles, positioning.productRole)}</select><small>当前生命周期：${escapeHtml(product.status || "未设置")}</small></label>${canEdit ? `<button class="primary-button" type="submit">保存产品定位</button>` : ""}</form>
      <form class="product-strategy-card" data-product-strategy-section="competition" data-product-id="${escapeHtml(product.id)}"><header><h3>竞争策略</h3><span>第一版使用人工文字记录</span></header><label>主要竞争对象<textarea name="mainCompetitors" rows="2">${escapeHtml(competition.mainCompetitors || "")}</textarea></label><label>核心竞争优势<textarea name="strengths" rows="2">${escapeHtml(competition.strengths || "")}</textarea></label><label>核心竞争短板<textarea name="weaknesses" rows="2">${escapeHtml(competition.weaknesses || "")}</textarea></label><label>价格策略<input name="priceStrategy" value="${escapeHtml(competition.priceStrategy || "")}" /></label><label>差异化方向<textarea name="differentiation" rows="2">${escapeHtml(competition.differentiation || "")}</textarea></label><label>竞争策略说明<textarea name="description" rows="3">${escapeHtml(competition.description || "")}</textarea></label>${canEdit ? `<button class="primary-button" type="submit">保存竞争策略</button>` : ""}</form>
      <form class="product-strategy-card" data-product-strategy-section="goals" data-product-id="${escapeHtml(product.id)}"><header><h3>经营目标</h3><span>所有目标可留空，不根据历史数据自动生成</span></header><label>目标销售额<input type="number" min="0" step="0.01" name="targetSalesAmount" value="${escapeHtml(goals.targetSalesAmount ?? "")}" /></label><label>目标销量<input type="number" min="0" step="1" name="targetSalesQuantity" value="${escapeHtml(goals.targetSalesQuantity ?? "")}" /></label><label>目标毛利率（%）<input type="number" min="0" max="100" step="0.1" name="targetGrossMargin" value="${escapeHtml(goals.targetGrossMargin ?? "")}" /></label><label>目标库存状态<input name="targetInventoryStatus" value="${escapeHtml(goals.targetInventoryStatus || "")}" placeholder="例如：健康" /></label><label>目标生命周期状态<select name="targetLifecycleStatus">${strategyOptionList(productStatuses, goals.targetLifecycleStatus)}</select><small>仅作目标记录，不会修改当前生命周期。</small></label>${canEdit ? `<button class="primary-button" type="submit">保存经营目标</button>` : ""}</form>
      <form class="product-strategy-card" data-product-strategy-section="management" data-product-id="${escapeHtml(product.id)}"><header><h3>当前经营策略</h3><span>记录管理者已确定的经营方向</span></header><label>负责人<select name="ownerId">${strategyPersonOptions(management.ownerId)}</select></label><label>周期类型<select name="periodType">${strategyOptionList(strategy.options.periodTypes, management.periodType)}</select></label><label>策略周期<input name="periodLabel" value="${escapeHtml(management.periodLabel || "")}" placeholder="例如：2026 Q3" /></label><div class="product-strategy-period"><label>开始日期<input type="date" name="periodStart" value="${escapeHtml(management.periodStart || "")}" /></label><label>结束日期<input type="date" name="periodEnd" value="${escapeHtml(management.periodEnd || "")}" /></label></div><label>当前策略<textarea name="currentStrategy" rows="7" placeholder="例如：继续扩大主销颜色库存…">${escapeHtml(management.currentStrategy || "")}</textarea></label><label>备注<textarea name="notes" rows="3">${escapeHtml(management.notes || "")}</textarea></label>${canEdit ? `<button class="primary-button" type="submit">保存当前策略</button>` : ""}</form>
    </div>
    <section class="product-strategy-next"><header><div><h3>下一步策略</h3><p>策略不是任务；只有经人工确认后才可创建关键行动草稿。</p></div></header>
      ${canEdit ? `<form class="product-strategy-step-create" data-product-strategy-step-create data-product-id="${escapeHtml(product.id)}"><label>策略内容<input name="content" required placeholder="例如：优化主图" /></label><label>优先级<select name="priority">${strategyOptionList(strategy.options.priorities, "中", "")}</select></label><label>负责人<select name="ownerId">${strategyPersonOptions(management.ownerId)}</select></label><label>计划时间<input type="date" name="plannedAt" /></label><button class="primary-button" type="submit">新增策略</button></form>` : ""}
      <div class="product-strategy-step-list">${nextStrategies.length ? nextStrategies.map((item) => `<article><form data-product-strategy-step-update data-product-id="${escapeHtml(product.id)}" data-item-id="${escapeHtml(item.id)}"><label>策略内容<input name="content" value="${escapeHtml(item.content)}" required /></label><label>优先级<select name="priority">${strategyOptionList(strategy.options.priorities, item.priority, "")}</select></label><label>状态<select name="status">${strategyOptionList(strategy.options.statuses, item.status, "")}</select></label><label>负责人<select name="ownerId">${strategyPersonOptions(item.ownerId)}</select></label><label>计划时间<input type="date" name="plannedAt" value="${escapeHtml(item.plannedAt || "")}" /></label>${canEdit ? `<button class="secondary-button" type="submit">保存</button>` : ""}</form>
        <footer><span>${escapeHtml(item.priority)}优先级 · ${escapeHtml(item.status)} · ${escapeHtml(ownerName(item.ownerId))}</span>${item.action ? `<a class="text-button" href="#schedule-board">关键行动：${escapeHtml(item.action.displayTitle || item.action.actionName)} →</a>` : canEdit ? `<form class="product-strategy-action-create" data-product-strategy-action-form data-product-id="${escapeHtml(product.id)}" data-item-id="${escapeHtml(item.id)}"><input type="hidden" name="title" value="${escapeHtml(item.content)}：${escapeHtml(product.name)}" /><div><strong>创建关键行动草稿</strong><small>自动带入产品、策略内容、周期与负责人；不生成任务。</small></div><select name="goalId" required><option value="">选择目标</option>${activeGoals.map((goal) => `<option value="${escapeHtml(goal.id)}">${escapeHtml(goal.name)}</option>`).join("")}</select><select name="taskTemplateId" required><option value="">选择行动标准</option>${actionTemplates.map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)}</option>`).join("")}</select><button class="primary-button" type="submit" ${!activeGoals.length || !actionTemplates.length ? "disabled" : ""}>创建关键行动</button></form>` : ""}</footer></article>`).join("") : `<div class="product-detail-empty">暂无下一步策略。</div>`}</div>
    </section>
    <section class="product-strategy-history"><header><h3>战略历史</h3><p>每次保存都会产生新版本，旧版本不会被覆盖。</p></header>${strategy.history.length ? strategy.history.map(renderStrategyHistoryVersion).join("") : `<div class="product-detail-empty">暂无历史版本。</div>`}</section>
  </div>`;
}

function renderProductBusinessDiagnosisTab(product) {
  const diagnosis = getProductManagementDetail(product.id)?.businessDiagnosis;
  if (!diagnosis) return `<div class="product-detail-empty">${productManagementState.loadingProductId === product.id ? "正在组合销售、库存、健康、战略与改善数据…" : "暂无经营诊断数据"}</div>`;
  const noData = diagnosis.status.code === "no_data";
  const sourceLabel = (source) => ({
    "ProductHealthAnalysis.sales": "销售健康规则", "ProductHealthAnalysis.inventory": "库存健康规则",
    "ProductHealthAnalysis.profit": "利润健康规则", "ProductHealthAnalysis.links": "链接表现规则",
    "ProductBusinessReadModel.sales": "现有销售事实", "ProductBusinessReadModel.profit": "现有利润事实",
    "ProductBusinessReadModel.inventory": "现有库存数据", "ProductBusinessReadModel.links": "现有销售链接数据",
    "ProductStrategy + ProductBusinessReadModel.sales": "当前战略 + 销售事实", RuleProductDiagnosisProvider: "明确诊断规则",
  })[source] || source;
  return `<div class="product-business-diagnosis">
    <header class="product-diagnosis-overall diagnosis-${escapeHtml(diagnosis.status.code)}"><div><p class="eyebrow">产品经营状态</p><h2>${escapeHtml(diagnosis.status.emoji)} ${escapeHtml(diagnosis.status.label)}</h2><p>规则版本 ${escapeHtml(diagnosis.provider.version)} · 只读分析</p></div><span>诊断 ≠ 决策</span></header>
    <section class="product-diagnosis-reasons"><header><h3>主要原因</h3><p>仅展示可以追溯到现有数据的判断。</p></header>${diagnosis.primaryReasons.length ? `<div>${diagnosis.primaryReasons.map((item) => `<article><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.explanation)}</p><small>依据：${escapeHtml(sourceLabel(item.source))}</small></article>`).join("")}</div>` : `<div class="product-diagnosis-no-data">暂无足够经营数据。</div>`}</section>
    <div class="product-diagnosis-columns">
      <section class="product-diagnosis-advantages"><header><h3>产品优势</h3><p>没有数据依据时不做推断。</p></header>${diagnosis.advantages.length ? `<ul>${diagnosis.advantages.map((item) => `<li><span>✓</span><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.explanation)}</p><small>${escapeHtml(sourceLabel(item.source))}</small></div></li>`).join("")}</ul>` : `<div class="product-diagnosis-no-data">暂无足够数据。</div>`}</section>
      <section class="product-diagnosis-risks"><header><h3>当前风险</h3><p>来自产品健康、经营数据和战略匹配规则。</p></header>${diagnosis.risks.length ? `<ul>${diagnosis.risks.map((item) => `<li><span>⚠</span><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.explanation)}</p><small>${escapeHtml(sourceLabel(item.source))} · ${escapeHtml(item.response?.label || "待管理者确认")}</small></div></li>`).join("")}</ul>` : `<div class="product-diagnosis-no-data">${noData ? "暂无足够数据。" : "当前未触发已定义风险规则。"}</div>`}</section>
    </div>
    <section class="product-diagnosis-focus"><header><h3>建议关注方向</h3><p>以下是经营提示，不是执行建议，也不会自动创建行动。</p></header>${diagnosis.focusDirections.length ? `<ol>${diagnosis.focusDirections.map((item) => `<li><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.explanation)}</p></div></li>`).join("")}</ol>` : `<div class="product-diagnosis-no-data">暂无足够数据形成关注方向。</div>`}</section>
    <footer class="product-diagnosis-boundary"><span>数据源：ProductBusinessReadModel · ProductHealthAnalysis · ProductStrategy · ProductImprovement</span><strong>不修改战略、健康状态、生命周期，不生成任务或关键行动。</strong></footer>
  </div>`;
}

function productInsightMeta(item) {
  return `<small>来源：${escapeHtml(item.source)} · ${escapeHtml(item.createdByName || "未知录入人")} · ${formatDateTime(item.createdAt)}</small>`;
}

function renderProductInsightTab(product) {
  const center = getProductManagementDetail(product.id)?.insightCenter;
  if (!center) return `<div class="product-detail-empty">${productManagementState.loadingProductId === product.id ? "正在读取用户洞察…" : "暂无用户洞察数据"}</div>`;
  const canEdit = hasPermission(getCurrentUser(), "products.manage"); const groups = center.groups;
  const improvementOptions = `<option value="">不关联</option>${center.relations.improvements.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)} · ${escapeHtml(item.actionName || item.actionId)}</option>`).join("")}`;
  const strategyOptions = `<option value="">不关联</option>${center.relations.strategies.map((item) => `<option value="${escapeHtml(item.id)}">V${item.version} · ${item.status === "current" ? "当前战略" : "历史战略"}</option>`).join("")}`;
  const actionOptions = `<option value="">不关联</option>${center.relations.actions.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} · ${escapeHtml(productImprovementActionStatus(item.status))}</option>`).join("")}`;
  const sourceInput = `<label>来源<input name="source" required placeholder="例如：淘宝评价分析" /></label>`;
  return `<div class="product-insight-center">
    <header class="product-insight-heading"><div><p class="eyebrow">UNDERSTAND USERS → IMPROVE PRODUCTS → GUIDE NEW PRODUCTS</p><h2>用户洞察与产品机会</h2><p>当前为人工录入分析结果；洞察只提供决策依据，不自动改写产品、营销或战略资料。</p></div><span>${escapeHtml(center.provider.id)} · AI Ready</span></header>
    <section class="product-insight-section insight-attention"><header><div><h3>用户关注点</h3><p>消费者购买这个产品时最关注什么？</p></div></header>
      ${canEdit ? `<form class="product-insight-create" data-product-insight-form data-product-id="${escapeHtml(product.id)}"><input type="hidden" name="insightType" value="attention" /><label>关注主题<input name="content" required placeholder="例如：设计感" /></label><label>重要程度<select name="importance">${center.options.importanceLevels.map((level) => `<option value="${level}">${"★".repeat(level)}${"☆".repeat(5 - level)}</option>`).join("")}</select></label><label>说明<textarea name="description" rows="2" placeholder="用户为什么关注"></textarea></label>${sourceInput}<button class="primary-button" type="submit">新增关注点</button></form>` : ""}
      <div class="product-insight-card-grid">${groups.attention.length ? groups.attention.map((item) => `<article><div><strong>${escapeHtml(item.content)}</strong><span class="product-insight-stars">${"★".repeat(item.importance)}${"☆".repeat(5-item.importance)}</span></div><p>${escapeHtml(item.description || "未填写说明")}</p>${productInsightMeta(item)}</article>`).join("") : `<div class="product-detail-empty">暂无用户关注点。</div>`}</div>
    </section>
    <section class="product-insight-section insight-satisfaction"><header><div><h3>用户满意点</h3><p>用户为什么喜欢这个产品？</p></div><span>可作为营销卖点参考，不自动覆盖营销资料</span></header>
      ${canEdit ? `<form class="product-insight-create" data-product-insight-form data-product-id="${escapeHtml(product.id)}"><input type="hidden" name="insightType" value="satisfaction" /><label>满意点<input name="content" required placeholder="例如：高级感强" /></label><label>占比 / 频次<input name="frequencyText" placeholder="例如：32% 或 18次" /></label>${sourceInput}<label>备注<textarea name="note" rows="2"></textarea></label><button class="primary-button" type="submit">新增满意点</button></form>` : ""}
      <div class="product-insight-list">${groups.satisfaction.length ? groups.satisfaction.map((item) => `<article><span>✓</span><div><strong>${escapeHtml(item.content)}</strong>${item.frequencyText ? `<em>${escapeHtml(item.frequencyText)}</em>` : ""}<p>${escapeHtml(item.note || "可作为产品卖点表达的人工参考。")}</p>${productInsightMeta(item)}</div></article>`).join("") : `<div class="product-detail-empty">暂无用户满意点。</div>`}</div>
    </section>
    <section class="product-insight-section insight-dissatisfaction"><header><div><h3>用户不满意点</h3><p>产品哪里没有满足用户？</p></div><span>可关联现有改善行动，不直接生成任务</span></header>
      ${canEdit ? `<form class="product-insight-create is-wide" data-product-insight-form data-product-id="${escapeHtml(product.id)}"><input type="hidden" name="insightType" value="dissatisfaction" /><label>问题描述<input name="content" required placeholder="例如：尺寸偏小" /></label><label>影响程度<select name="impactLevel">${strategyOptionList(center.options.impactLevels, "中", "")}</select></label><label>处理状态<select name="handlingStatus">${strategyOptionList(center.options.handlingStatuses, "待处理", "")}</select></label><label>关联改善行动<select name="relatedImprovementId">${improvementOptions}</select></label>${sourceInput}<label>备注<input name="note" /></label><button class="primary-button" type="submit">新增不满意点</button></form>` : ""}
      <div class="product-insight-problem-list">${groups.dissatisfaction.length ? groups.dissatisfaction.map((item) => `<article><div><span class="insight-impact-${escapeHtml(item.impactLevel)}">${escapeHtml(item.impactLevel)}影响</span><strong>${escapeHtml(item.content)}</strong></div><p>${escapeHtml(item.note || "未填写备注")}</p>${item.relatedImprovementId ? `<a class="text-button" href="#schedule-board">改善行动：${escapeHtml(item.improvementTitle || item.actionName || item.relatedImprovementId)}</a>` : `<small>暂未关联改善行动</small>`}${productInsightMeta(item)}${canEdit ? `<form data-product-insight-update data-product-id="${escapeHtml(product.id)}" data-insight-id="${escapeHtml(item.id)}"><select name="handlingStatus">${strategyOptionList(center.options.handlingStatuses, item.handlingStatus, "")}</select><button class="secondary-button" type="submit">更新状态</button></form>` : ""}</article>`).join("") : `<div class="product-detail-empty">暂无用户不满点。</div>`}</div>
    </section>
    <section class="product-insight-section insight-opportunity"><header><div><h3>产品机会</h3><p>根据用户反馈记录产品方向，由管理者决定是否进入战略与行动。</p></div></header>
      ${canEdit ? `<form class="product-insight-create is-opportunity" data-product-insight-form data-product-id="${escapeHtml(product.id)}"><input type="hidden" name="insightType" value="opportunity" /><label>机会描述<input name="content" required placeholder="例如：增加大尺寸版本" /></label><label>机会类型<select name="opportunityType">${strategyOptionList(center.options.opportunityTypes, "其他", "")}</select></label><label>优先级<select name="priority">${strategyOptionList(center.options.opportunityPriorities, "中", "")}</select></label><label>状态<select name="status">${strategyOptionList(center.options.opportunityStatuses, "待评估", "")}</select></label><label>关联战略<select name="relatedStrategyVersionId">${strategyOptions}</select></label><label>关联关键行动<select name="relatedActionId">${actionOptions}</select></label>${sourceInput}<label>备注<input name="note" /></label><button class="primary-button" type="submit">新增产品机会</button></form>` : ""}
      <div class="product-opportunity-list">${groups.opportunity.length ? groups.opportunity.map((item) => `<article><header><div><span>${escapeHtml(item.opportunityType)}</span><strong>${escapeHtml(item.content)}</strong></div>${businessStatus(item.status, item.status, "opportunity")}</header><dl><div><dt>优先级</dt><dd>${escapeHtml(item.priority)}</dd></div><div><dt>关联战略</dt><dd>${item.strategyVersion ? `V${item.strategyVersion}` : "未关联"}</dd></div><div><dt>关联行动</dt><dd>${escapeHtml(item.actionName || "未关联")}</dd></div></dl><p>${escapeHtml(item.note || "未填写备注")}</p>${productInsightMeta(item)}${canEdit ? `<form data-product-insight-update data-product-id="${escapeHtml(product.id)}" data-insight-id="${escapeHtml(item.id)}"><select name="status">${strategyOptionList(center.options.opportunityStatuses, item.status, "")}</select><button class="secondary-button" type="submit">更新状态</button></form>` : ""}</article>`).join("") : `<div class="product-detail-empty">暂无产品机会。</div>`}</div>
    </section>
    <footer class="product-insight-boundary"><strong>标准路径</strong><span>用户反馈 → 产品机会 → 产品战略调整 → 关键行动 → 任务执行</span><small>本模块只记录洞察和关联，不跳过战略与行动决策。</small></footer>
  </div>`;
}

function renderProductLifecycleTab(product) {
  const detail = getProductManagementDetail(product.id); const statuses = detail?.lifecycleStatuses || ["开发中","上架","成长期","成熟期","风险期","淘汰"];
  return `<div class="product-lifecycle-panel">${hasPermission(getCurrentUser(), "products.archive") ? `<form data-product-lifecycle-form data-product-id="${escapeHtml(product.id)}"><select name="status">${statuses.map((status) => `<option value="${escapeHtml(status)}" ${product.status===status?"selected":""}>${escapeHtml(status)}</option>`).join("")}</select><input name="reason" placeholder="变更原因" required /><button class="primary-button">更新生命周期</button></form>` : ""}<div class="product-lifecycle-timeline">${detail?.lifecycle?.length ? detail.lifecycle.map((item) => `<article><strong>${escapeHtml(item.fromStatus || "未设置")} → ${escapeHtml(item.toStatus)}</strong><p>${escapeHtml(item.reason || "未填写原因")}</p><small>${formatDateTime(item.changedAt)}</small></article>`).join("") : `<p>暂无生命周期变更记录</p>`}</div></div>`;
}

function renderProductImprovementsTab(product) {
  const detail = getProductManagementDetail(product.id); if (!detail) return `<div class="product-detail-empty">正在读取改善记录…</div>`;
  const activeGoals = state.goals.filter((item) => item.status === "active");
  const actionTemplates = state.taskTemplates.filter((item) => item.status === "active" && item.defaultProcessTemplateId && state.processTemplates.some((process) => process.id === item.defaultProcessTemplateId));
  return `<div class="product-improvement-panel"><section><h2>待改善问题</h2>${detail.issues?.filter((item) => item.status !== "closed").map((issue) => `<article class="product-improvement-issue"><strong>${escapeHtml(issue.title)}</strong><span>${escapeHtml(issue.status)}</span>${hasPermission(getCurrentUser(), "products.manage") ? `<form data-product-improvement-form data-issue-id="${escapeHtml(issue.id)}"><input name="title" value="改善${escapeHtml(product.name)}：${escapeHtml(issue.title)}" required /><select name="goalId" required><option value="">选择目标</option>${activeGoals.map((goal) => `<option value="${escapeHtml(goal.id)}">${escapeHtml(goal.name)}</option>`).join("")}</select><select name="taskTemplateId" required><option value="">选择行动标准</option>${actionTemplates.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("")}</select><button class="primary-button">创建改善行动</button></form>` : ""}</article>`).join("") || `<p>暂无待改善问题，请先生成经营体检。</p>`}</section><section><h2>改善项目</h2>${detail.improvements?.length ? detail.improvements.map((item) => `<article class="product-improvement-record"><div><strong>${escapeHtml(item.title)}</strong><span class="status-badge">${escapeHtml(item.status)}</span></div><p>关键行动：${escapeHtml(item.actionName || item.actionId)} · ${escapeHtml(item.actionStatus || "—")}</p></article>`).join("") : `<p>暂无改善项目</p>`}</section></div>`;
}

function renderProductErpTab({ mapping, goods, stock }) {
  if (mapping === null) return `<div class="product-detail-empty"><strong>暂无更多信息</strong></div>`;
  return `<div class="product-erp-layout">
    ${renderInfoGroup("ERP货品信息", [
      ["ERP货品编码", goods?.goodsCode], ["ERP货品名称", goods?.goodsName], ["货品简称", goods?.shortName],
      ["主供应商", goods?.primarySupplier], ["供应商货号", goods?.supplierGoodsCode],
      ["成本价", stock.costPrice], ["零售价", stock.retailPrice],
    ])}
    <section class="product-info-group product-inventory-primary"><h2>库存概览</h2><div class="product-inventory-highlights">
      <div><span>当前库存</span><strong>${formatMetric(stock.currentStock ?? stock.stock)}</strong></div>
      <div><span>可发库存</span><strong>${formatMetric(stock.shippableStock)}</strong></div>
      <div><span>采购在途</span><strong>${formatMetric(stock.purchaseInTransit)}</strong></div>
    </div></section>
    ${renderInfoGroup("库存明细", [
      ["可用库存", stock.availableStock], ["实际库存", stock.actualStock],
      ["实际可发库存", stock.actualShippableStock], ["待发货量", stock.pendingShipment],
    ])}
    ${renderInfoGroup("销量概览", [
      ["7天销量", stock.sales7d], ["30天销量", stock.sales30d], ["90天销量", stock.sales90d],
      ["180天销量", stock.sales180d], ["总销量", stock.totalSales],
    ])}
  </div>`;
}

function renderProductActionsTab(actions) {
  if (actions.length === 0) return `<div class="product-detail-empty">暂无关联关键行动</div>`;
  return `<div class="product-related-actions">${actions.map((instance) => {
    const standard = state.taskTemplates.find((item) => item.id === instance.taskTemplateId);
    const owner = getProcessInstanceOwner(instance.id, state);
    const progress = state.tasks.filter((task) => task.processInstanceId === instance.id);
    const done = progress.filter((task) => ["done", "completed"].includes(task.status)).length;
    return `<a class="product-related-action" href="#schedule-board">
      <div><strong>${escapeHtml(instance.businessCode || "—")}</strong><span>${escapeHtml(getProcessInstanceBusinessStatus(instance.id, state).label)}</span></div>
      <h3>${escapeHtml(instance.displayTitle || instance.name || "未命名关键行动")}</h3>
      <p>${escapeHtml(standard?.name || "未设置行动标准")} · ${escapeHtml(findName(state.people, owner.userId))}</p>
      <small>进度 ${done}/${progress.length}</small>
    </a>`;
  }).join("")}</div>`;
}

function renderProductTemplatesTab(actions) {
  const relations = new Map();
  for (const instance of actions) {
    const workPlan = state.workPlans.find((item) => item.processInstanceId === instance.id);
    const templateIds = instance.customFields?.linkedTemplateIds ?? workPlan?.customFields?.linkedTemplateIds ?? [];
    for (const templateId of templateIds) {
      const current = relations.get(templateId) ?? { count: 0, latestAt: "" };
      current.count += 1;
      current.latestAt = [current.latestAt, instance.updatedAt, instance.createdAt].filter(Boolean).sort().at(-1) ?? "";
      relations.set(templateId, current);
    }
  }
  const templates = [...relations.entries()].map(([id, relation]) => ({
    template: state.templates.find((item) => item.id === id),
    relation,
  })).filter((item) => item.template);
  if (templates.length === 0) return `<div class="product-detail-empty">暂无通过关键行动关联的模板</div>`;
  return `<div class="product-related-templates">${templates.map(({ template, relation }) => {
    const previewUrl = template.previewImage?.fileUrl ?? template.previewImage?.url ?? "";
    return `<article class="product-related-template">
      ${previewUrl ? `<img src="${escapeHtml(resolveAssetUrl(previewUrl))}" alt="${escapeHtml(template.name)}" loading="lazy" />` : `<span class="product-image-placeholder">无预览</span>`}
      <div><h3>${escapeHtml(template.name)}</h3><p>${escapeHtml(template.businessCode || "—")} · ${escapeHtml(template.fileType || "—")}</p>
      <small>关联行动 ${relation.count} · 最近 ${formatDateTime(relation.latestAt)}</small></div>
    </article>`;
  }).join("")}</div>`;
}

function renderProductModal() {
  if (modalState === null) return "";
  const product = modalState.id ? state.products.find((item) => item.id === modalState.id) : null;
  const item = product ?? { skuCode: "", name: "", mainImage: "", galleryImages: [], status: "开发中" };
  return `<div class="modal-backdrop"><section class="modal-panel product-modal"><header class="modal-header"><div><h2>${product ? "编辑产品" : "新增产品"}</h2><p>每个 SKU 仅维护一条产品记录</p></div><button class="icon-button" type="button" data-action="close-product-modal" aria-label="关闭">×</button></header>
    <form class="modal-body product-form" id="product-form"><div class="form-error" ${modalState.error ? "" : "hidden"}>${escapeHtml(modalState.error || "")}</div><div class="form-grid">
      <label><span>SKU编码 *</span><input name="skuCode" required value="${escapeHtml(item.skuCode)}" ${product ? "readonly" : ""} />${product ? `<small>ERP关联关键字段，普通编辑不可修改。${hasPermission(getCurrentUser(), "skus.manage") ? ` <button class="text-button" type="button" data-action="open-sku-change" data-product-id="${product.id}">使用SKU修改流程</button>` : ""}</small>` : ""}</label><label><span>产品名称 *</span><input name="name" required value="${escapeHtml(item.name)}" /></label>
      ${[["brand", "品牌"], ["category", "产品分类"], ["series", "产品系列"], ["material", "材质"], ["color", "颜色"], ["specification", "规格尺寸"]].map(([name, label]) => `<label><span>${label}</span><input name="${name}" value="${escapeHtml(item[name] || "")}" /></label>`).join("")}
      <label><span>产品状态</span><select name="status">${productStatuses.filter((status) => status !== "已归档" || item.status === "已归档" || hasPermission(getCurrentUser(), "products.archive")).map((status) => `<option ${status === item.status ? "selected" : ""}>${status}</option>`).join("")}</select></label>
      <label><span>产品负责人</span><select name="ownerId"><option value="">未设置</option>${state.people.filter((person) => person.status !== "inactive").map((person) => `<option value="${person.id}" ${person.id === item.ownerId ? "selected" : ""}>${escapeHtml(person.name)}</option>`).join("")}</select></label>
      <label class="span-2"><span>产品主图</span>${item.mainImage ? `<img class="product-form-preview" src="${escapeHtml(resolveAssetUrl(item.mainImage))}" alt="当前主图" />` : ""}<input name="mainImageFile" type="file" accept="image/jpeg,image/png,image/webp" /><input name="existingMainImage" type="hidden" value="${escapeHtml(item.mainImage || "")}" /></label>
      <label class="span-2"><span>其他产品图片</span><input name="galleryImageFiles" type="file" accept="image/jpeg,image/png,image/webp" multiple /><input name="existingGalleryImages" type="hidden" value="${escapeHtml(JSON.stringify(item.galleryImages || []))}" /></label>
      <label class="span-2"><span>备注</span><textarea name="remark" rows="3">${escapeHtml(item.remark || "")}</textarea></label>
    </div></form><footer class="modal-footer"><button class="secondary-button" type="button" data-action="close-product-modal">取消</button><button class="primary-button" type="submit" form="product-form">保存</button></footer></section></div>`;
}

function renderProductSkuChangeModal() {
  if (skuChangeState === null) return "";
  const impact = skuChangeState.impact;
  const conflictMessages = impact
    ? [
        impact.conflicts?.product ? "新SKU已被其他产品使用" : "",
        impact.conflicts?.erpMapping ? "新SKU已被其他ERP映射使用" : "",
        impact.conflicts?.platformSku ? "新SKU与其他产品的平台SKU关系冲突" : "",
      ].filter(Boolean)
    : [];
  return `<div class="modal-backdrop"><section class="modal-panel product-modal"><header class="modal-header"><div><h2>修改产品SKU</h2><p>该操作会同步更新ERP映射，但不会改写平台SKU和历史快照。</p></div><button class="icon-button" type="button" data-action="close-sku-change" aria-label="关闭">×</button></header>
    <form class="modal-body product-form" id="product-sku-change-form">
      <div class="form-error" ${skuChangeState.error ? "" : "hidden"}>${escapeHtml(skuChangeState.error || "")}</div>
      <div class="form-grid">
        <label><span>当前SKU</span><input name="oldSkuCode" readonly value="${escapeHtml(skuChangeState.oldSkuCode)}" /></label>
        <label><span>新SKU *</span><input name="newSkuCode" required value="${escapeHtml(skuChangeState.newSkuCode || "")}" ${impact ? "readonly" : ""} /></label>
        <label class="span-2"><span>修改原因 *</span><textarea name="reason" rows="3" required ${impact ? "readonly" : ""}>${escapeHtml(skuChangeState.reason || "")}</textarea></label>
      </div>
      ${impact ? `<section class="product-info-group"><h3>影响范围</h3><div class="product-info-grid">
        <div><span>ERP规格映射</span><strong>${impact.erpMappingCount}</strong></div>
        <div><span>平台SKU</span><strong>${impact.platformSkuCount}</strong></div>
        <div><span>历史快照</span><strong>${impact.historySnapshotCount}</strong></div>
        <div><span>历史业务日</span><strong>${impact.historyBusinessDayCount}</strong></div>
        <div><span>关联关键行动</span><strong>${impact.actionCount}</strong></div>
      </div>${impact.warnings?.length ? `<p>${impact.warnings.map(escapeHtml).join("<br />")}</p>` : ""}${conflictMessages.length ? `<div class="form-error">${conflictMessages.map(escapeHtml).join("；")}</div>` : ""}</section>` : ""}
    </form>
    <footer class="modal-footer">
      <button class="secondary-button" type="button" data-action="close-sku-change">取消</button>
      ${impact ? `<button class="secondary-button" type="button" data-action="back-sku-change">返回修改</button><button class="primary-button" type="button" data-action="confirm-sku-change" ${impact.hasConflict || skuChangeState.loading ? "disabled" : ""}>确认修改SKU</button>` : `<button class="primary-button" type="submit" form="product-sku-change-form" ${skuChangeState.loading ? "disabled" : ""}>检查影响范围</button>`}
    </footer></section></div>`;
}

function getImportStepNumber() {
  if (importState?.step === "mapping") return 2;
  if (importState?.step === "preview") return 4;
  if (importState?.step === "complete") return 5;
  return 1;
}

function renderImportSteps() {
  const current = getImportStepNumber();
  return `<ol class="product-import-steps">${["上传Excel", "字段匹配", "数据预览", "校验", "确认导入"].map((label, index) => {
    const step = index + 1;
    return `<li class="${step === current ? "is-current" : step < current ? "is-complete" : ""}"><span>${step}</span>${label}</li>`;
  }).join("")}</ol>`;
}

function renderImportUpload() {
  return `<form id="product-import-upload-form" class="product-import-upload-form">
    <label><span>数据来源</span><input name="sourceSystem" value="ERP" maxlength="40" /></label>
    <label class="product-import-file-field"><span>ERP Excel *</span><input name="file" type="file" accept=".xls,.xlsx" required /><small>支持通用 .xls、.xlsx；上传后先匹配字段，不会直接写入产品数据。</small></label>
    <div class="form-error" ${importState?.error ? "" : "hidden"}>${escapeHtml(importState?.error || "")}</div>
  </form>`;
}

function renderMappingOptions(selected) {
  return `<option value="rawSourceData" ${selected === "rawSourceData" ? "selected" : ""}>仅保留在原始数据</option>${importState.fieldDefinitions.map((definition) =>
    `<option value="${escapeHtml(definition.key)}" ${selected === definition.key ? "selected" : ""}>${escapeHtml(definition.label)}</option>`,
  ).join("")}`;
}

function getImportSample(header) {
  return importState.preview.map((row) => row.product?.rawSourceData?.[header]).filter((value) => String(value ?? "").trim() !== "").slice(0, 2).join("；");
}

function renderImportMapping() {
  const batch = importState.batch;
  return `<div class="product-import-mapping">
    <div class="import-summary-line"><strong>${escapeHtml(batch.fileName)}</strong><span>工作表：${escapeHtml(batch.sheetName)}</span><span>${batch.summary?.total ?? 0} 行</span><span>提取图片 ${batch.summary?.imageCount ?? 0} 张</span></div>
    ${(batch.summary?.warnings ?? []).map((warning) => `<div class="form-warning">${escapeHtml(warning)}</div>`).join("")}
    <div class="form-error" ${importState.error ? "" : "hidden"}>${escapeHtml(importState.error || "")}</div>
    <form id="product-import-mapping-form"><div class="table-wrap import-mapping-table-wrap"><table class="data-table"><thead><tr><th>ERP字段</th><th>样例数据</th><th>系统字段</th></tr></thead>
      <tbody>${batch.headers.map((header, index) => `<tr><td><strong>${escapeHtml(header)}</strong></td><td class="import-sample-cell">${escapeHtml(getImportSample(header) || "-")}</td><td><select name="mapping-${index}" data-import-header="${escapeHtml(header)}">${renderMappingOptions(batch.mappingConfig?.[header] || "rawSourceData")}</select></td></tr>`).join("")}</tbody>
    </table></div></form>
    <p class="form-note">未映射字段不会丢失，将按 ERP 原始字段名完整保存在 <code>rawSourceData</code>。</p>
  </div>`;
}

function renderImportPreview() {
  const { batch, preview, valid } = importState;
  const summary = batch.summary ?? {};
  return `<div class="product-import-preview">
    <div class="import-summary-grid">
      <div><span>总数据</span><strong>${summary.total ?? 0}</strong></div><div><span>新增</span><strong>${summary.create ?? 0}</strong></div>
      <div><span>更新</span><strong>${summary.update ?? 0}</strong></div><div><span>错误行</span><strong>${summary.invalid ?? 0}</strong></div>
    </div>
    ${(summary.mappingErrors ?? []).length ? `<div class="form-error">${summary.mappingErrors.map(escapeHtml).join("<br />")}</div>` : ""}
    ${(summary.warnings ?? []).map((warning) => `<div class="form-warning">${escapeHtml(warning)}</div>`).join("")}
    <div class="table-wrap import-preview-table-wrap"><table class="data-table"><thead><tr><th>行号</th><th>图片</th><th>SKU编码</th><th>产品名称</th><th>判断</th><th>校验结果</th></tr></thead>
      <tbody>${preview.map((row) => `<tr class="${row.errors.length ? "import-row-error" : ""}"><td>${row.rowNumber}</td><td>${row.product.mainImage ? `<img class="product-import-preview-image" src="${escapeHtml(resolveAssetUrl(row.product.mainImage))}" alt="" />` : `<span class="product-import-preview-image product-image-placeholder">无图</span>`}</td><td>${escapeHtml(row.product.skuCode || "-")}</td><td>${escapeHtml(row.product.name || "-")}</td><td><span class="status-badge">${row.action === "update" ? "更新" : "新增"}</span></td><td>${row.errors.length ? escapeHtml(row.errors.join("；")) : "通过"}</td></tr>`).join("")}</tbody>
    </table></div>
    <p class="form-note">${valid ? "全部数据校验通过，可以确认导入。" : "存在校验错误，请返回字段匹配后重新生成预览。"}</p>
  </div>`;
}

function renderImportComplete() {
  const summary = importState.batch.summary ?? {};
  return `<div class="product-import-complete"><strong>ERP 产品数据导入完成</strong><p>共处理 ${summary.total ?? 0} 个 SKU，新增 ${summary.create ?? 0}，更新 ${summary.update ?? 0}；导入记录已保存。</p></div>`;
}

function renderProductImportModal() {
  if (importState === null) return "";
  let body = renderImportUpload();
  if (importState.step === "mapping") body = renderImportMapping();
  if (importState.step === "preview") body = renderImportPreview();
  if (importState.step === "complete") body = renderImportComplete();
  let footer = `<button class="secondary-button" type="button" data-action="close-product-import">取消</button><button class="primary-button" type="submit" form="product-import-upload-form" ${importState.loading ? "disabled" : ""}>${importState.loading ? "正在解析…" : "上传并解析"}</button>`;
  if (importState.step === "mapping") footer = `<button class="secondary-button" type="button" data-action="close-product-import">取消</button><button class="primary-button" type="button" data-action="validate-product-import" ${importState.loading ? "disabled" : ""}>${importState.loading ? "正在校验…" : "生成预览并校验"}</button>`;
  if (importState.step === "preview") footer = `<button class="secondary-button" type="button" data-action="back-product-import-mapping">返回字段匹配</button><button class="primary-button" type="button" data-action="commit-product-import" ${!importState.valid || importState.loading ? "disabled" : ""}>${importState.loading ? "正在导入…" : "确认导入"}</button>`;
  if (importState.step === "complete") footer = `<button class="primary-button" type="button" data-action="close-product-import">完成</button>`;
  return `<div class="modal-backdrop"><section class="modal-panel product-import-modal"><header class="modal-header"><div><h2>ERP 产品数据导入</h2><p>字段可配置，未知字段完整保留</p></div><button class="icon-button" type="button" data-action="close-product-import" aria-label="关闭">×</button></header>
    ${renderImportSteps()}<div class="modal-body">${body}</div><footer class="modal-footer">${footer}</footer></section></div>`;
}

function collectImportMapping() {
  return Object.fromEntries(Array.from(document.querySelectorAll("[data-import-header]")).map((select) => [select.dataset.importHeader, select.value]));
}

function renderProductV2Upload() {
  const fixedImportType = importState?.syncRun ? importState.importType : "";
  const importTypeLabels = {
    goods_info: "货品信息（ERP货品主档）",
    inventory: "库存明细（库存与销量）",
    platform_goods: "平台货品（店铺、链接与平台SKU）",
  };
  return `<form id="product-v2-import-upload-form" class="product-import-upload-form">
    ${fixedImportType
      ? `<label><span>导入类型</span><input name="importType" value="${escapeHtml(fixedImportType)}" type="hidden" /><strong>${escapeHtml(importTypeLabels[fixedImportType])}</strong></label>`
      : `<label><span>导入类型 *</span><select name="importType" required>
      <option value="goods_info">货品信息（ERP货品主档）</option>
      <option value="inventory">库存明细（库存与销量）</option>
      <option value="platform_goods">平台货品（店铺、链接与平台SKU）</option>
    </select></label>`}
    ${fixedImportType === "goods_info" ? `<fieldset class="product-import-mode-field">
      <legend>主数据导入模式</legend>
      <label><input type="radio" name="importMode" value="incremental" ${importState?.importMode !== "full" ? "checked" : ""} /> 增量新增</label>
      <label><input type="radio" name="importMode" value="full" ${importState?.importMode === "full" ? "checked" : ""} /> 全量同步</label>
      <small>增量新增不会把文件中未出现的历史货品或SKU标记为缺失。</small>
    </fieldset>` : ""}
    <label class="product-import-file-field"><span>Excel 文件 *</span><input name="file" type="file" accept=".xls,.xlsx" required />
      <small>上传后先预览和校验，不会直接写入数据库。建议依次导入货品信息、库存明细、平台货品。</small></label>
    <div class="form-error" ${importState?.error ? "" : "hidden"}>${escapeHtml(importState?.error || "")}</div>
  </form>`;
}

function renderWangdianGoodsQuery() {
  const date = importState.syncRun?.businessDate || new Date().toLocaleDateString("sv-SE");
  return `<form id="wangdian-goods-query-form" class="product-import-upload-form">
    <p class="form-note">从旺店通读取指定时间范围内发生变化的货品与SKU。读取后先进入现有预览与校验，不会直接写入产品数据。</p>
    <fieldset class="product-import-mode-field">
      <legend>导入模式</legend>
      <label><input type="radio" name="importMode" value="incremental" ${importState.importMode !== "full" ? "checked" : ""} /> 增量同步</label>
      <label><input type="radio" name="importMode" value="full" ${importState.importMode === "full" ? "checked" : ""} /> 全量同步</label>
    </fieldset>
    <small>增量同步不会对未返回记录执行missing；全量同步要求所选范围覆盖完整ERP货品主档，否则未返回的历史货品与SKU将进入missing。</small>
    <label><span>开始修改时间 *</span><input name="startTime" type="datetime-local" value="${escapeHtml(`${date}T00:00`)}" required /></label>
    <label><span>结束修改时间 *</span><input name="endTime" type="datetime-local" value="${escapeHtml(`${date}T23:59`)}" required /></label>
    <small>增量同步跨度不能超过30天；全量同步会由服务端按30天窗口分段读取。</small>
    <div class="form-error" ${importState.error ? "" : "hidden"}>${escapeHtml(importState.error || "")}</div>
  </form>`;
}

function renderErpSyncDashboard() {
  const run = erpSyncState.active;
  const statusLabels = {
    draft: "草稿",
    processing: "处理中",
    syncing: "同步中",
    partial: "部分完成",
    completed: "已完成",
    failed: "失败",
  };
  const batchStatusLabels = {
    parsed: "待校验", validated: "待确认导入", importing: "导入中", completed: "已完成",
    committed: "已完成", failed: "失败",
  };
  const allTypes = [
    ["goods_info", "货品信息", "ERP货品主档与产品映射"],
    ["inventory", "库存明细", "库存与销量当前值"],
    ["platform_goods", "平台货品", "店铺、商品链接与平台SKU"],
  ];
  const types = run?.syncType === "master_data"
    ? allTypes.filter(([importType]) => importType === "goods_info")
    : run?.syncType === "daily_business"
      ? allTypes.filter(([importType]) => importType !== "goods_info")
      : allTypes;
  if (erpSyncState.loading && !run) return `<div class="form-note">正在读取ERP每日同步状态…</div>`;
  if (!run) {
    const today = new Date().toLocaleDateString("sv-SE");
    const user = getCurrentUser();
    const canUseWangdian = ["admin", "system_admin"].includes(user?.role) || user?.authRole === "admin";
    return `<div class="erp-sync-create">
      <p class="form-note">ERP主数据与每日经营数据分别同步，互不阻塞。</p>
      <form id="erp-sync-create-form" class="product-import-upload-form">
        <label><span>业务日期 *</span><input name="businessDate" type="date" value="${escapeHtml(today)}" required /></label>
        <label><span>同步类型 *</span><select name="syncType" required>
          <option value="master_data">ERP主数据同步</option>
          <option value="daily_business">ERP经营数据同步</option>
        </select></label>
        <label data-master-data-source><span>主数据来源 *</span><select name="dataSource">
          <option value="excel">Excel文件</option>
          ${canUseWangdian ? `<option value="wangdian_api">旺店通API</option>` : ""}
        </select></label>
        <fieldset class="product-import-mode-field" data-master-import-mode>
          <legend>主数据导入模式</legend>
          <label><input type="radio" name="importMode" value="incremental" checked /> 增量新增</label>
          <label><input type="radio" name="importMode" value="full" /> 全量同步</label>
        </fieldset>
        <button class="primary-button" type="submit" ${erpSyncState.loading ? "disabled" : ""}>${erpSyncState.loading ? "正在创建…" : "创建同步"}</button>
      </form>
      ${erpSyncState.runs.length ? `<div class="erp-sync-history"><h3>最近同步</h3>${erpSyncState.runs.slice(0, 8).map((item) =>
        `<button class="erp-sync-history-item" type="button" data-action="open-erp-sync-run" data-sync-run-id="${escapeHtml(item.id)}">
          <strong>${escapeHtml(item.syncCode)}</strong><span>${escapeHtml(item.businessDate)} · ${escapeHtml(statusLabels[item.status] || item.status)}</span>
        </button>`).join("")}</div>` : ""}
      <div class="form-error" ${erpSyncState.error ? "" : "hidden"}>${escapeHtml(erpSyncState.error)}</div>
    </div>`;
  }
  return `<div class="erp-sync-dashboard">
    <div class="erp-sync-overview">
      <div><span>同步编码</span><strong>${escapeHtml(run.syncCode)}</strong></div>
      <div><span>同步类型</span><strong>${run.syncType === "master_data" ? "ERP主数据同步" : run.syncType === "daily_business" ? "ERP经营数据同步" : "历史联合同步"}</strong></div>
      <div><span>数据来源</span><strong>${["wangdian", "wangdian_api"].includes(run.dataSource) ? "旺店通API" : "Excel文件"}</strong></div>
      <div><span>业务日期</span><strong>${escapeHtml(run.businessDate)}</strong></div>
      <div><span>整体状态</span><strong>${escapeHtml(statusLabels[run.status] || run.status)}</strong></div>
      <div><span>版本</span><strong>V${run.version}</strong></div>
      <div><span>系统创建时间</span><strong>${formatDateTime(run.createdAt)}</strong></div>
      <div><span>最近更新时间</span><strong>${formatDateTime(run.updatedAt)}</strong></div>
    </div>
    ${run.supersedesRunId ? `<p class="form-note">本次为同一业务日期的重新同步版本，历史同步仍保留。</p>` : ""}
    <div class="erp-sync-file-grid">${types.map(([importType, label, description]) => {
      const batch = run.batches?.[importType];
      const completed = ["completed", "committed"].includes(batch?.status);
      const action = batch
        ? `<button class="secondary-button" type="button" data-action="resume-product-v2-import" data-batch-id="${escapeHtml(batch.id)}">${completed ? "查看结果" : batch.status === "failed" ? "查看失败并重试" : "继续处理"}</button>
          ${!completed && ["wangdian", "wangdian_api"].includes(run.dataSource) && importType === "goods_info"
            ? `<button class="primary-button" type="button" data-action="regenerate-wangdian-preview">重新生成预览</button>`
            : ""}`
        : ["wangdian", "wangdian_api"].includes(run.dataSource) && importType === "goods_info"
          ? `<button class="primary-button" type="button" data-action="sync-wangdian-goods">同步旺店通货品</button>`
          : `<button class="primary-button" type="button" data-action="upload-erp-sync-child" data-import-type="${importType}">上传文件</button>`;
      return `<article class="erp-sync-file-card">
        <div><h3>${label}</h3><p>${description}</p></div>
        <dl><div><dt>状态</dt><dd>${escapeHtml(batchStatusLabels[batch?.status] || (batch ? batch.status : "待导入"))}</dd></div>
          <div><dt>文件</dt><dd>${escapeHtml(batch?.originalFilename || "—")}</dd></div>
          <div><dt>批次</dt><dd>${escapeHtml(batch?.id || "—")}</dd></div>
          ${importType === "goods_info" ? `<div><dt>导入模式</dt><dd>${batch ? (batch.importMode === "full" ? "全量同步" : "增量新增") : "提交时选择"}</dd></div>` : ""}</dl>
        ${action}
      </article>`;
    }).join("")}</div>
    ${run.status === "completed" ? `<section class="erp-sync-snapshot-status">
      <div>
        <span>缺失记录对账</span>
        <strong>${run.reconciliationStatus === "completed" ? "已完成" : run.reconciliationStatus === "failed" ? "失败" : "处理中"}</strong>
      </div>
      ${run.reconciliationStatus === "completed"
        ? `<div class="erp-sync-snapshot-summary">
            <span>缺失货品：${run.reconciliationSummary?.goods?.current?.missing ?? 0}</span>
            <span>缺失ERP关系：${run.reconciliationSummary?.mappings?.current?.missing ?? 0}</span>
            <span>缺失库存事实：${run.reconciliationSummary?.inventory?.current?.missing ?? 0}</span>
            <span>缺失链接：${run.reconciliationSummary?.links?.current?.missing ?? 0}</span>
            <span>缺失平台SKU：${run.reconciliationSummary?.platformSkus?.current?.missing ?? 0}</span>
          </div>`
        : run.reconciliationStatus === "failed"
          ? `<p class="form-error">三张表已完成，但缺失记录对账失败：${escapeHtml(run.reconciliationError || "未知错误")}</p>
            <button class="secondary-button" type="button" data-action="retry-erp-reconciliation">重新执行对账</button>`
          : `<p class="form-note">系统正在对账当日未出现的ERP事实，对账完成后生成快照。</p>`}
      ${run.reconciliationStatus === "completed" ? `
      <div>
        <span>经营事实</span>
        <strong>已切换新数据链</strong>
      </div>
      <p class="form-note">产品经营统一读取销售日报、Sales Object与库存事实，不再生成旧经营快照。</p>` : ""}
    </section>` : ""}
    ${(run.errorSummary ?? []).length ? `<div class="form-error">${(run.errorSummary ?? []).map((item) =>
      `${escapeHtml(item.importType)}：${escapeHtml(item.reason)}`).join("<br>")}</div>` : ""}
    <div class="erp-sync-history-actions"><button class="secondary-button" type="button" data-action="choose-erp-sync-run">查看其他同步</button></div>
  </div>`;
}

function renderShopMapping() {
  const statusLabels = { confirmed: "已确认", suggested: "待确认", pending: "无法识别", ignored: "已忽略" };
  return `<div class="product-v2-shop-mapping">
    <p class="form-note">系统只给出平台建议；请逐项确认店铺，无法识别或无效店铺可明确忽略。</p>
    <div class="shop-mapping-toolbar"><span>共 ${importState.shopMappings?.length ?? 0} 个原始店铺</span><button class="secondary-button" type="button" data-action="confirm-suggested-shops">确认全部明确建议</button></div>
    <div class="table-wrap product-v2-shop-table"><table class="data-table"><thead><tr><th>原始店铺</th><th>行数 / 链接</th><th>识别状态</th><th>关联已有店铺</th><th>平台</th><th>标准店铺名</th><th>确认 / 忽略</th></tr></thead>
      <tbody>${(importState.shopMappings ?? []).map((mapping) => `<tr>
        <td>${escapeHtml(mapping.rawName)}</td><td>${mapping.rows ?? 0} / ${mapping.links ?? 0}</td>
        <td><span class="status-badge ${mapping.mappingStatus === "pending" ? "is-warning" : ""}">${escapeHtml(statusLabels[mapping.mappingStatus] || mapping.mappingStatus)}</span></td>
        <td><select data-shop-existing="${escapeHtml(mapping.rawName)}"><option value="">新建或确认下列信息</option>${state.salesShops.map((shop) => `<option value="${escapeHtml(shop.id)}" ${shop.id === mapping.shopId ? "selected" : ""}>${escapeHtml(shop.platform)} · ${escapeHtml(shop.displayName || shop.shopName)}</option>`).join("")}</select></td>
        <td><select data-shop-platform="${escapeHtml(mapping.rawName)}">${["", "天猫", "淘宝", "京东", "小红书", "抖店", "视频号小店"].map((item) => `<option value="${item}" ${item === mapping.platform ? "selected" : ""}>${item || "请选择"}</option>`).join("")}</select></td>
        <td><input data-shop-name="${escapeHtml(mapping.rawName)}" value="${escapeHtml(mapping.shopName || "")}" /></td>
        <td><label class="inline-checkbox"><input type="checkbox" data-shop-confirm="${escapeHtml(mapping.rawName)}" ${mapping.mappingStatus === "confirmed" ? "checked" : ""} />确认</label>
          <label class="inline-checkbox"><input type="checkbox" data-shop-ignore="${escapeHtml(mapping.rawName)}" ${mapping.mappingStatus === "ignored" ? "checked" : ""} />忽略</label></td>
      </tr>`).join("")}</tbody></table></div>
    <div class="form-error" ${importState.error ? "" : "hidden"}>${escapeHtml(importState.error || "")}</div>
  </div>`;
}

function renderProductV2Preview() {
  const summary = importState.summary ?? {};
  const isGoodsInfo = importState.importType === "goods_info";
  const isInventory = importState.importType === "inventory";
  if (!isGoodsInfo && !isInventory) return renderPlatformV2Preview();
  if (isGoodsInfo) {
    const mappingLabels = { existing: "保留现有产品映射", auto: "不自动关联", pending: "待人工关联产品", skipped: "异常隔离" };
    const goodsLabels = { new: "新增ERP货品", update: "更新ERP货品", unchanged: "无变化" };
    return `<div class="product-import-preview">
      ${summary.previewVersion ? `<div class="form-note"><strong>当前有效预览：V${summary.previewVersion}</strong> · 批次 ${escapeHtml(importState.batch?.id || "—")}。重新生成后旧预览仍保留，但只有最新预览可以提交。</div>` : ""}
      <div class="import-summary-grid">
        ${[
          ["文件行数", summary.total], ["有效货品", summary.validGoods], ["新增ERP货品", summary.created],
          ["更新ERP货品", summary.updated], ["已有映射", summary.existingMappings],
          ["自动建立映射", summary.autoMappings], ["待人工关联", summary.pendingMappings],
          ["无变化", summary.unchanged], ["可导入SKU", summary.importable], ["异常跳过SKU", summary.skipped], ["警告", summary.warnings],
        ].map(([label, count]) => `<div><span>${label}</span><strong>${count ?? 0}</strong></div>`).join("")}
      </div>
      ${importState.duplicate ? `<div class="form-warning">相同文件曾于 ${formatDateTime(importState.duplicate.completedAt)} 导入；再次确认将幂等更新，不会重复创建ERP货品、产品或映射。</div>` : ""}
      <div class="table-wrap import-preview-table-wrap"><table class="data-table"><thead><tr>
        <th>行号</th><th>ERP货品编码</th><th>货品名称</th><th>规格</th><th>分类</th>
        <th>当前匹配产品</th><th>处理方式</th><th>校验状态</th><th>错误原因</th>
      </tr></thead><tbody>
        ${(importState.preview ?? []).map((row) => `<tr class="${row.errors?.length ? "import-row-error" : ""}">
          <td>${row.rowNumber}</td><td>${escapeHtml(row.goodsCode || "—")}</td><td>${escapeHtml(row.goodsName || "—")}</td>
          <td>${escapeHtml(row.specificationName || "—")}</td><td>${escapeHtml(row.category || "—")}</td>
          <td>${escapeHtml(row.systemProduct ? `${row.systemProduct.skuCode} · ${row.systemProduct.name}` : "—")}</td>
          <td>${escapeHtml(`${goodsLabels[row.goodsAction] || row.goodsAction}；${mappingLabels[row.mappingAction] || row.mappingAction}`)}</td>
          <td>${row.errors?.length ? "隔离跳过" : row.warnings?.length ? "警告后继续" : "通过"}</td><td>${escapeHtml([...(row.errors ?? []), ...(row.warnings ?? [])].join("；") || "—")}</td>
        </tr>`).join("")}
      </tbody></table></div>
      <p class="form-note">异常SKU按行隔离，不阻止其他SKU提交；同步不会自动创建products，也不会新增或修改product_erp_mappings。预览最多展示前 ${importState.preview?.length ?? 0} 行。</p>
    </div>`;
  }
  const columns = `<th>行号</th><th>货品编号</th><th>商家编码</th><th>ERP名称</th><th>系统产品</th><th>匹配状态</th><th>新增货品</th><th>更新字段</th><th>错误说明</th>`;
  return `<div class="product-import-preview">
    <div class="import-summary-grid">
      <div><span>有效行</span><strong>${summary.total ?? 0}</strong></div>
      <div><span>已匹配</span><strong>${summary.matched ?? summary.matchedAuto ?? 0}</strong></div>
      <div><span>未匹配</span><strong>${summary.unmatched ?? 0}</strong></div>
      <div><span>异常</span><strong>${summary.error ?? 0}</strong></div>
    </div>
    ${importState.duplicate ? `<div class="form-warning">相同文件曾于 ${formatDateTime(importState.duplicate.completedAt)} 导入；再次确认只会幂等更新，不会重复创建链接。</div>` : ""}
    <div class="table-wrap import-preview-table-wrap"><table class="data-table"><thead><tr>${columns}</tr></thead><tbody>
      ${isInventory ? (importState.preview ?? []).map((row) =>
        `<tr class="${row.errors?.length ? "import-row-error" : ""}"><td>${row.rowNumber}</td><td>${escapeHtml(row.goodsCode || "-")}</td><td>${escapeHtml(row.merchantSkuCode || "-")}</td><td>${escapeHtml(row.erpName || "-")}</td><td>${escapeHtml(row.systemProduct ? `${row.systemProduct.skuCode} · ${row.systemProduct.name}` : "未匹配")}</td><td>${escapeHtml(row.status === "matched" ? "已匹配" : "异常")}</td><td>${row.newGoods ? "是" : "否"}</td><td>${escapeHtml(row.updateFields?.join("、") || "—")}</td><td>${escapeHtml(row.errors?.join("；") || "—")}</td></tr>`
      ).join("") : renderPlatformPreviewRows(importState.preview ?? [])}
    </tbody></table></div>
    <p class="form-note">预览最多展示前 ${importState.preview?.length ?? 0} 行；确认后按稳定唯一键新增或更新，不会替换现有产品 ID。</p>
  </div>`;
}

function renderPlatformV2Preview() {
  const summary = importState.summary ?? {};
  const filters = importState.previewFilters ?? { platform: "", shop: "", status: "", query: "" };
  const platforms = [...new Set((importState.shopMappings ?? []).map((item) => item.platform).filter(Boolean))].sort();
  const shops = [...new Set((importState.shopMappings ?? []).filter((item) => item.mappingStatus === "confirmed").map((item) => item.rawName))].sort();
  const pagination = importState.pagination ?? { page: 1, totalPages: 1, totalLinks: 0 };
  const currentPage = pagination.page ?? 1;
  const totalPages = pagination.totalPages ?? 1;
  const pageNumbers = [...new Set([1, currentPage - 1, currentPage, currentPage + 1, totalPages])]
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((left, right) => left - right);
  return `<div class="product-import-preview platform-goods-preview">
    ${importState.loading ? `<div class="form-note">正在导入平台货品，请勿关闭页面或重复点击。完整文件通常需要约半分钟。</div>` : ""}
    <div class="form-error" ${importState.error ? "" : "hidden"}>${escapeHtml(importState.error || "")}</div>
    <div class="platform-preview-summary">
      ${[
        ["店铺", summary.shops], ["商品链接", summary.links], ["平台SKU", summary.total],
        ["自动匹配", summary.matchedAuto], ["人工匹配", summary.matchedManual], ["未匹配", summary.unmatched],
        ["歧义", summary.ambiguous], ["组合装", summary.combination], ["错误", summary.error],
        ["新增", summary.created], ["更新", summary.updated], ["未变化", summary.unchanged],
      ].map(([label, number]) => `<div><span>${label}</span><strong>${number ?? 0}</strong></div>`).join("")}
    </div>
    <form class="platform-preview-filters" data-platform-preview-filter>
      <select name="platform"><option value="">全部平台</option>${platforms.map((item) => `<option value="${escapeHtml(item)}" ${item === filters.platform ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}</select>
      <select name="shop"><option value="">全部店铺</option>${shops.map((item) => `<option value="${escapeHtml(item)}" ${item === filters.shop ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}</select>
      <select name="status"><option value="">全部匹配状态</option>${[
        ["matched_auto", "自动匹配"], ["matched_manual", "人工匹配"], ["unmatched", "未匹配"],
        ["ambiguous", "歧义"], ["combination", "组合装"],
      ].map(([value, label]) => `<option value="${value}" ${value === filters.status ? "selected" : ""}>${label}</option>`).join("")}</select>
      <input name="query" value="${escapeHtml(filters.query)}" placeholder="搜索平台规格编码、标题或商品ID" />
      <button class="secondary-button" type="submit">筛选</button>
    </form>
    <div class="platform-link-preview-list">
      ${(importState.previewLinks ?? []).length === 0 ? `<div class="empty-cell">当前筛选条件下没有商品链接</div>` : (importState.previewLinks ?? []).map((link, index) => `
        <details class="platform-link-preview-card" ${index === 0 ? "open" : ""}>
          <summary>
            <span><strong>${escapeHtml(link.platform || "未识别平台")}</strong> · ${escapeHtml(link.shopName || link.rawShopName)}</span>
            <span>${escapeHtml(link.title || link.platformGoodsCode || link.platformGoodsId || "未命名商品")}</span>
            <span>${link.skuCount} 个SKU</span>
          </summary>
          <div class="platform-link-preview-meta">商品ID：${escapeHtml(link.platformGoodsId || "—")} · 平台货品编号：${escapeHtml(link.platformGoodsCode || "—")}</div>
          <div class="table-wrap"><table class="data-table"><thead><tr><th>平台SKU</th><th>规格</th><th>系统产品</th><th>匹配状态</th><th>原因</th></tr></thead>
            <tbody>${link.skus.map((sku) => `<tr><td>${escapeHtml(sku.platformSkuCode || sku.platformSkuId || "—")}</td><td>${escapeHtml(sku.specificationName || "—")}</td>
              <td>${escapeHtml(sku.product ? `${sku.product.skuCode} · ${sku.product.name}` : "—")}</td><td><span class="status-badge">${escapeHtml(sku.matchStatus)}</span></td><td>${escapeHtml(sku.matchReason || sku.errors?.join("；") || "—")}</td></tr>`).join("")}</tbody>
          </table></div>
          ${link.skuCount > link.skus.length ? `<p class="form-note">本链接共 ${link.skuCount} 个SKU，当前展示前 ${link.skus.length} 个。</p>` : ""}
        </details>`).join("")}
    </div>
    <div class="platform-preview-pagination">
      <span>共 ${pagination.totalLinks ?? 0} 条链接 · 第 ${currentPage}/${totalPages} 页${importState.loading ? " · 正在读取…" : ""}</span>
      <div><button class="secondary-button" type="button" data-action="platform-preview-page" data-page="${Math.max(1, currentPage - 1)}" ${currentPage <= 1 || importState.loading ? "disabled" : ""}>上一页</button>
      ${pageNumbers.map((page) => `<button class="${page === currentPage ? "primary-button" : "secondary-button"}" type="button" data-action="platform-preview-page" data-page="${page}" ${page === currentPage || importState.loading ? "disabled" : ""}>${page}</button>`).join("")}
      <button class="secondary-button" type="button" data-action="platform-preview-page" data-page="${Math.min(totalPages, currentPage + 1)}" ${currentPage >= totalPages || importState.loading ? "disabled" : ""}>下一页</button></div>
    </div>
    <p class="form-note">预览只分组加载当前页链接；确认导入前不会写入销售链接数据。</p>
  </div>`;
}

function renderPlatformPreviewRows(rows) {
  let previousLink = "";
  return rows.map((row) => {
    const linkKey = `${row.rawShopName}|${row.platformGoodsId}`;
    const linkHeader = linkKey === previousLink ? "" : `<tr class="platform-link-preview-row"><td colspan="6"><strong>商品链接</strong> · ${escapeHtml(row.rawShopName || "-")} · ${escapeHtml(row.title || row.platformGoodsCode || row.platformGoodsId || "-")}</td></tr>`;
    previousLink = linkKey;
    return `${linkHeader}<tr class="${row.errors?.length ? "import-row-error" : ""}"><td>${row.rowNumber}</td><td>${escapeHtml(row.rawShopName || "-")}</td><td>${escapeHtml(row.title || row.platformGoodsCode || "-")}</td><td>${escapeHtml(row.platformSkuCode || row.platformSkuId || "-")}</td><td>${escapeHtml(row.product ? `${row.product.skuCode} · ${row.product.name}` : "未匹配")}</td><td>${escapeHtml(row.errors?.join("；") || row.matchReason || row.matchStatus)}</td></tr>`;
  }).join("");
}

function renderProductV2Complete() {
  const summary = importState.result?.summary ?? {};
  if (importState.importType === "goods_info") {
    return `<div class="product-import-complete"><strong>ERP 货品信息导入完成</strong>
      <p>新增ERP货品 ${summary.created ?? 0}，更新 ${summary.updated ?? 0}，无变化 ${summary.unchanged ?? 0}；已有映射 ${summary.existingMappings ?? 0}，自动建立映射 ${summary.autoMappings ?? 0}，待人工关联 ${summary.pendingMappings ?? 0}。</p>
    </div>`;
  }
  if (importState.importType === "inventory") {
    return `<div class="product-import-complete"><strong>ERP 库存明细导入完成</strong>
      <p>新增 ${summary.created ?? 0}，更新 ${summary.updated ?? 0}，匹配 ${summary.matched ?? 0}，未匹配 ${summary.unmatched ?? 0}。</p>
    </div>`;
  }
  return `<div class="product-import-complete"><strong>ERP 平台货品导入完成</strong>
    <p>批次：${escapeHtml(importState.result?.batch?.id || importState.batch?.id || "—")}</p>
    <div class="import-summary-grid">
      ${[
        ["店铺", summary.shops], ["新增链接", summary.created], ["更新链接", summary.updated],
        ["未变化链接", summary.unchanged], ["平台SKU", summary.skus], ["自动匹配", summary.matchedAuto],
        ["人工匹配", summary.matchedManual], ["未匹配", summary.unmatched], ["歧义", summary.ambiguous],
        ["组合装", summary.combination], ["错误", summary.errors],
      ].map(([label, count]) => `<div><span>${label}</span><strong>${count ?? 0}</strong></div>`).join("")}
    </div>
  </div>`;
}

function renderProductV2ImportModal() {
  if (importState?.version !== "v2") return "";
  let body = importState.step === "sync" ? renderErpSyncDashboard() : renderProductV2Upload();
  if (importState.step === "wangdian") body = renderWangdianGoodsQuery();
  if (importState.step === "shops") body = renderShopMapping();
  if (importState.step === "preview") body = renderProductV2Preview();
  if (importState.step === "complete") body = renderProductV2Complete();
  let footer = importState.step === "sync"
    ? `<button class="secondary-button" type="button" data-action="close-product-import">关闭</button>`
    : `<button class="secondary-button" type="button" data-action="${importState.syncRun ? "back-to-erp-sync" : "close-product-import"}">返回</button><button class="primary-button" type="submit" form="product-v2-import-upload-form" ${importState.loading ? "disabled" : ""}>${importState.loading ? "正在解析…" : "上传并解析"}</button>`;
  if (importState.step === "wangdian") footer = `<button class="secondary-button" type="button" data-action="back-to-erp-sync" ${importState.loading ? "disabled" : ""}>返回</button><button class="primary-button" type="submit" form="wangdian-goods-query-form" ${importState.loading ? "disabled" : ""}>${importState.loading ? "正在读取旺店通…" : "读取并生成预览"}</button>`;
  if (importState.step === "shops") footer = `<button class="secondary-button" type="button" data-action="close-product-import">取消</button><button class="primary-button" type="button" data-action="confirm-shop-mappings" ${importState.loading ? "disabled" : ""}>确认店铺并生成预览</button>`;
  if (importState.step === "preview") {
    const backendValidated = importState.batch?.status === "validated";
    const importLabel = importState.importType === "goods_info" ? "货品信息" : importState.importType === "platform_goods" ? "平台货品" : "库存明细";
    const secondaryAction = importState.importType === "platform_goods" && !backendValidated
      ? "return-product-v2-shop-mapping"
      : importState.syncRun ? "back-to-erp-sync" : "close-product-import";
    footer = `<button class="secondary-button" type="button" data-action="${secondaryAction}" ${importState.loading ? "disabled" : ""}>${importState.importType === "platform_goods" && !backendValidated ? "返回店铺确认" : "返回每日同步"}</button><button class="primary-button" type="button" data-action="commit-product-v2-import" ${!backendValidated || importState.loading ? "disabled" : ""}>${importState.loading ? `正在导入${importLabel}…` : backendValidated ? "确认导入" : "尚未完成后台校验"}</button>`;
  }
  if (importState.step === "complete") footer = `<button class="primary-button" type="button" data-action="${importState.syncRun ? "back-to-erp-sync" : "close-product-import"}">返回每日同步</button>`;
  return `<div class="modal-backdrop"><section class="modal-panel product-import-modal"><header class="modal-header"><div><h2>ERP 每日同步</h2><p>一个业务日期统一组织货品信息、库存明细与平台货品</p></div><button class="icon-button" type="button" data-action="close-product-import">×</button></header>
    <div class="modal-body">${body}</div><footer class="modal-footer">${footer}</footer></section></div>`;
}

function collectShopMappings() {
  return Object.fromEntries((importState.shopMappings ?? []).map((mapping) => {
    const rawName = mapping.rawName;
    const ignored = document.querySelector(`[data-shop-ignore="${CSS.escape(rawName)}"]`)?.checked;
    const shopId = document.querySelector(`[data-shop-existing="${CSS.escape(rawName)}"]`)?.value ?? "";
    const confirmed = document.querySelector(`[data-shop-confirm="${CSS.escape(rawName)}"]`)?.checked;
    return [rawName, ignored ? { action: "ignore" } : !confirmed ? {} : shopId ? { shopId } : {
      platform: document.querySelector(`[data-shop-platform="${CSS.escape(rawName)}"]`)?.value ?? "",
      shopName: document.querySelector(`[data-shop-name="${CSS.escape(rawName)}"]`)?.value.trim() ?? "",
    }];
  }));
}

async function refreshErpSyncState(syncRunId = erpSyncState.active?.id) {
  erpSyncState = { ...erpSyncState, loading: true, error: "" };
  try {
    const [listResult, detailResult] = await Promise.all([
      listErpSyncRuns(),
      syncRunId ? loadErpSyncRun(syncRunId) : Promise.resolve(null),
    ]);
    erpSyncState = {
      loading: false,
      runs: listResult.runs ?? [],
      active: detailResult?.syncRun ?? (syncRunId ? null : erpSyncState.active),
      error: "",
      masterImportMode: erpSyncState.masterImportMode || "incremental",
    };
  } catch (error) {
    erpSyncState = { ...erpSyncState, loading: false, error: error.message || "ERP每日同步读取失败。" };
  }
  return erpSyncState;
}

export function renderProductCenterPage() {
  ensureAuthorizedProductSubmodule();
  if (isComboSkuRoute()) productSubmodule = "combo-skus";
  const erpSkuId = getRouteErpSkuId();
  if (erpSkuId && !canViewSkus()) return `<section class="product-center-page"><div class="empty-state">你没有查看 SKU 的权限。</div></section>`;
  if (erpSkuId) return renderProductSkuV2Detail();
  const productId = getRouteProductId();
  if (productId && !canViewProducts()) return `<section class="product-center-page"><div class="empty-state">你没有查看产品的权限。</div></section>`;
  const product = state.products.find((item) => item.id === productId) ?? getProductManagementDetail(productId)?.product;
  if (productId && !product) {
    const message = productManagementState.error || "正在读取产品详情…";
    return `<section class="product-center-page product-detail-page"><button class="text-button product-detail-back" type="button" data-action="back-products">← 返回产品列表</button><div class="product-detail-empty">${escapeHtml(message)}</div></section>${renderPlatformProductLinkModal()}`;
  }
  return `${product ? renderProductDetail(product) : renderProductList()}${renderPlatformProductLinkModal()}`;
}

async function refreshProductSkuV2List(rerender) {
  const requestId = ++productSkuV2RequestId;
  productSkuV2State = { ...productSkuV2State, loading: true, error: "" }; rerender();
  try {
    const result = await loadProductCenterV2Skus({ search: productSkuV2State.search, includeUnarchived: productSkuV2State.includeUnarchived, includeHistorical: productSkuV2State.includeHistorical, profileStatus: "all",
      erpStatus: productSkuV2State.erpStatus, brand: productSkuV2State.brand, category: productSkuV2State.category,
      lifecycleStatus: productSkuV2State.lifecycleStatus, operatingLifecycleStatus: productSkuV2State.operatingLifecycleStatus, platform: productSkuV2State.platform, stockStatus: productSkuV2State.stockStatus,
      businessZone: productSkuV2State.businessZone, sort: productSkuV2State.sort,
      limit: productSkuV2State.pageSize, offset: (productSkuV2State.page - 1) * productSkuV2State.pageSize });
    if (requestId !== productSkuV2RequestId) return;
    productSkuV2State = { ...productSkuV2State, loading: false, loaded: true, rows: result.rows || [], pagination: result.pagination || { total: 0 }, summary: { ...productSkuV2State.summary, ...(result.summary || {}) }, facets: result.facets || productSkuV2State.facets, error: "" };
    if (!productSkuV2MetadataLoading && !Object.keys(productSkuV2State.summary.businessZones || {}).length) {
      productSkuV2MetadataLoading = true;
      void loadProductCenterV2Metadata().then((metadata) => { productSkuV2State = { ...productSkuV2State, summary: metadata.summary || productSkuV2State.summary, facets: metadata.facets || productSkuV2State.facets }; rerender(); }).catch(() => {}).finally(() => { productSkuV2MetadataLoading = false; });
    }
  } catch (error) { if (requestId !== productSkuV2RequestId) return; productSkuV2State = { ...productSkuV2State, loading: false, loaded: true, rows: [], error: error.message || "ERP SKU列表读取失败。" }; }
  rerender();
}

async function refreshComboSkuList(rerender) {
  comboSkuState = { ...comboSkuState, loading: true, error: "" }; rerender();
  try { const result = await loadProductComboSkus({ search: comboSkuState.search, includeHistorical: comboSkuState.includeHistorical, limit: comboSkuState.pageSize, offset: (comboSkuState.page - 1) * comboSkuState.pageSize }); comboSkuState = { ...comboSkuState, loading: false, loaded: true, rows: result.items || [], pagination: result.pagination || { total: 0 }, error: "" }; }
  catch (error) { comboSkuState = { ...comboSkuState, loading: false, loaded: true, rows: [], error: error.message || "组合装列表读取失败。" }; } rerender();
}

async function refreshComboSkuDetail(salesObjectId, rerender) {
  comboSkuState = { ...comboSkuState, loading: true, detail: null, error: "" }; rerender();
  try { const result = await loadProductComboSkuDetail(salesObjectId); comboSkuState = { ...comboSkuState, loading: false, detail: result.detail, error: "" }; }
  catch (error) { comboSkuState = { ...comboSkuState, loading: false, detail: null, error: error.message || "组合装详情读取失败。" }; } rerender();
}

async function refreshProductSkuV2Detail(erpSkuId, rerender) {
  if (!erpSkuId || productSkuV2State.loading || productSkuV2State.detailId === erpSkuId) return;
  productWorkspaceState = { activeTab: "overview", sections: {}, marketingMode: "read", marketingNotice: "", dailySales: { data: null, loading: false, loaded: false, rangePreset: "30d", error: "" } };
  productSkuV2State = { ...productSkuV2State, loading: true, detail: null, detailId: "", error: "" }; rerender();
  try { const result = await loadProductCenterV2SkuDetail(erpSkuId, "summary"); productSkuV2State = { ...productSkuV2State, loading: false, detail: result.detail, detailId: erpSkuId, error: "" }; }
  catch (error) { productSkuV2State = { ...productSkuV2State, loading: false, detail: null, detailId: erpSkuId, error: error.message || "ERP SKU详情读取失败。" }; }
  rerender();
  if (productSkuV2State.detail?.sku?.productId) { void loadProductMarketingSection(rerender); void loadProductDailySalesSection(rerender); }
}

async function loadProductDailySalesSection(rerender, rangePreset = productWorkspaceState.dailySales.rangePreset) {
  const productId = productSkuV2State.detail?.sku?.productId;
  if (!productId || productWorkspaceState.dailySales.loading) return;
  const end = new Date(); const start = new Date(end); start.setDate(start.getDate() - (rangePreset === "7d" ? 6 : 29));
  productWorkspaceState = { ...productWorkspaceState, dailySales: { ...productWorkspaceState.dailySales, loading: true, rangePreset, error: "" } }; rerender();
  try {
    const data = await loadProductDailySales(productId, { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) });
    productWorkspaceState = { ...productWorkspaceState, dailySales: { data, loading: false, loaded: true, rangePreset, error: "" } };
  } catch (error) { productWorkspaceState = { ...productWorkspaceState, dailySales: { ...productWorkspaceState.dailySales, loading: false, error: error.message || "产品销售日报读取失败。" } }; }
  rerender();
}

async function loadProductWorkspaceSection(scope, rerender) {
  const erpSkuId = getRouteErpSkuId();
  const current = productWorkspaceState.sections[scope];
  if (!erpSkuId || current?.loading || current?.loaded) return;
  productWorkspaceState = { ...productWorkspaceState, sections: { ...productWorkspaceState.sections, [scope]: { loading: true, loaded: false, rows: [], error: "" } } };
  rerender();
  try {
    const result = await loadProductCenterV2SkuDetail(erpSkuId, scope);
    const field = { links: "links", inventory: "inventoryRecords", sales: "salesTrend", operations: "operations" }[scope];
    productWorkspaceState = { ...productWorkspaceState, sections: { ...productWorkspaceState.sections, [scope]: { loading: false, loaded: true, rows: result.detail?.[field] || [], error: "" } } };
  } catch (error) {
    productWorkspaceState = { ...productWorkspaceState, sections: { ...productWorkspaceState.sections, [scope]: { loading: false, loaded: false, rows: [], error: error.message || "数据读取失败。" } } };
  }
  rerender();
}

async function loadProductMarketingSection(rerender) {
  const productId = productSkuV2State.detail?.sku?.productId;
  const current = productWorkspaceState.sections.marketing;
  if (!productId || current?.loading || current?.loaded) return;
  productWorkspaceState = { ...productWorkspaceState, sections: { ...productWorkspaceState.sections, marketing: { loading: true, loaded: false, asset: null, error: "" } } };
  rerender();
  try {
    const result = await loadProductMarketingAsset(productId);
    productWorkspaceState = { ...productWorkspaceState, sections: { ...productWorkspaceState.sections, marketing: { loading: false, loaded: true, asset: result.asset || null, error: "" } } };
  } catch (error) {
    productWorkspaceState = { ...productWorkspaceState, sections: { ...productWorkspaceState.sections, marketing: { loading: false, loaded: false, asset: null, error: error.message || "产品营销资产读取失败。" } } };
  }
  rerender();
}

function splitMarketingLines(value) {
  return String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

async function submitProductMarketing(form, rerender) {
  const productId = productSkuV2State.detail?.sku?.productId;
  if (!productId) return;
  const data = new FormData(form);
  const payload = { positioning: data.get("positioning"), targetAudience: data.get("targetAudience"), productStory: data.get("productStory"),
    usageScenarios: splitMarketingLines(data.get("usageScenarios")), keywords: splitMarketingLines(data.get("keywords")),
    sellingPoints: splitMarketingLines(data.get("sellingPoints")).map((text, index) => ({ text, sortOrder: index + 1 })) };
  try {
    const result = await saveProductMarketingAsset(productId, payload);
    productWorkspaceState = { ...productWorkspaceState, marketingMode: "read", marketingNotice: "产品营销信息已保存。", sections: { ...productWorkspaceState.sections, marketing: { loading: false, loaded: true, asset: result.asset, error: "" } } };
  } catch (error) {
    productWorkspaceState = { ...productWorkspaceState, sections: { ...productWorkspaceState.sections, marketing: { ...productWorkspaceState.sections.marketing, error: error.message || "产品营销资产保存失败。" } } };
  }
  rerender();
}

function setModalError(message, rerender) {
  modalState = { ...modalState, error: message };
  rerender();
}

async function saveProduct(form, rerender) {
  const existing = modalState.id ? state.products.find((item) => item.id === modalState.id) : null;
  try {
    const mainFile = form.elements.mainImageFile.files[0];
    const mainImage = mainFile ? (await uploadImageFile(mainFile)).url : form.elements.existingMainImage.value || null;
    let galleryImages = JSON.parse(form.elements.existingGalleryImages.value || "[]");
    for (const file of Array.from(form.elements.galleryImageFiles.files ?? [])) galleryImages.push((await uploadImageFile(file)).url);
    const now = getNow();
    const item = {
      ...(existing ?? {}),
      id: existing?.id ?? createId("product"),
      skuCode: existing?.skuCode ?? form.elements.skuCode.value.trim(), name: form.elements.name.value.trim(), mainImage, galleryImages,
      brand: form.elements.brand.value.trim(), category: form.elements.category.value.trim(), series: form.elements.series.value.trim(),
      material: form.elements.material.value.trim(), color: form.elements.color.value.trim(), specification: form.elements.specification.value.trim(),
      status: form.elements.status.value, ownerId: form.elements.ownerId.value || null, remark: form.elements.remark.value.trim(),
      createdAt: existing?.createdAt ?? now, updatedAt: now,
    };
    if (existing) {
      await updatePersistentResource("products", existing.id, item);
      state.products = state.products.map((product) => product.id === existing.id ? item : product);
    } else {
      await createPersistentResource("products", item);
      state.products = [item, ...state.products];
    }
    modalState = null;
    rerender();
  } catch (error) {
    setModalError(error.message || "产品保存失败。", rerender);
  }
}

async function refreshProductSalesLinks(productId, rerender) {
  productSalesState = { productId, loading: true, loaded: false, rows: [], error: "" };
  rerender();
  try {
    const result = await loadProductSalesLinks(productId);
    productSalesState = { productId, loading: false, loaded: true, rows: result.rows ?? [], error: "" };
  } catch (error) {
    productSalesState = { productId, loading: false, loaded: true, rows: [], error: error.message || "销售链接读取失败。" };
  }
  rerender();
}

async function refreshProductSalesSummaries(rerender) {
  if (productSalesSummaryState.loading) return;
  productSalesSummaryState = { ...productSalesSummaryState, loading: true, error: "" };
  rerender();
  try {
    const result = await loadProductSalesSummaries();
    productSalesSummaryState = { loading: false, loaded: true, rows: result.rows ?? [], error: "" };
  } catch (error) {
    productSalesSummaryState = {
      loading: false,
      loaded: false,
      rows: [],
      error: error.message || "产品销售汇总读取失败。",
    };
    console.error(productSalesSummaryState.error);
  }
  rerender();
}

async function refreshPendingErpSkus(rerender, query = pendingSkuState.query) {
  if (pendingSkuState.loading) return;
  pendingSkuState = { ...pendingSkuState, query, loading: true, error: "", notice: "" };
  rerender();
  try {
    const result = await loadPendingErpSkus(query);
    pendingSkuState = {
      loading: false,
      loaded: true,
      rows: result.rows ?? [],
      query,
      error: "",
      notice: pendingSkuState.notice,
    };
    selectedPendingSkuIds = new Set([...selectedPendingSkuIds].filter((id) => pendingSkuState.rows.some((item) => item.id === id)));
  } catch (error) {
    pendingSkuState = {
      ...pendingSkuState,
      loading: false,
      loaded: true,
      rows: [],
      error: error.message || "待建立SKU读取失败。",
    };
  }
  rerender();
}

async function refreshProductManagementOverview(rerender) {
  if (productManagementState.loadingOverview) return;
  productManagementState = { ...productManagementState, loadingOverview: true, error: "" }; rerender();
  try { const result = await loadProductManagementOverview(); const moduleData=result.moduleData||{};
    state.products=moduleData.products||[]; state.actionProducts=moduleData.actionProducts||[]; state.erpGoods=moduleData.erpGoods||[];
    state.productErpMappings=moduleData.productErpMappings||[]; state.salesShops=moduleData.salesShops||[]; state.salesShopAliases=moduleData.salesShopAliases||[];
    state.productImportBatches=moduleData.productImportBatches||[]; state.erpImportBatches=moduleData.erpImportBatches||[];
    productManagementState = { ...productManagementState, overview: result.overview, loadingOverview: false, error: "" }; }
  catch (error) { productManagementState = { ...productManagementState, loadingOverview: false, error: error.message || "产品经营概览读取失败。" }; }
  rerender();
}

async function refreshProductBusinessDashboard(rerender) {
  if (productBusinessDashboardState.loading) {
    productBusinessRefreshPending = true;
    return;
  }
  productBusinessRefreshPending = false;
  const hasReadModel = Boolean(productBusinessDashboardState.readModel);
  productBusinessDashboardState = { ...productBusinessDashboardState, loading: true, error: "" };
  if (!hasReadModel) rerender();
  try {
    const result = await loadProductBusinessDashboard(productBusinessFilters);
    productBusinessDashboardState = { readModel: result.readModel, loading: false, error: "" };
    if (result.readModel?.pagination) productBusinessFilters.page = result.readModel.pagination.page;
  } catch (error) {
    productBusinessDashboardState = { ...productBusinessDashboardState, loading: false, error: error.message || "产品经营看板读取失败。" };
  }
  rerender();
  if (productBusinessRefreshPending) void refreshProductBusinessDashboard(rerender);
}

async function refreshProductSalesDistribution(rerender) {
  if (productSalesDistributionState.loading) return;
  productSalesDistributionState = { ...productSalesDistributionState, loading: true, error: "" };
  rerender();
  try {
    const result = await loadProductSalesDistribution({
      preset: productSalesDistributionState.range?.preset || "30d",
      startDate: productSalesDistributionState.range?.startDate || "",
      endDate: productSalesDistributionState.range?.endDate || "",
      includeHistorical: productSalesDistributionState.includeHistorical,
    });
    productSalesDistributionState = {
      ...productSalesDistributionState,
      range: result.range,
      includeHistorical: Boolean(result.includeHistorical),
      items: result.items || [],
      summary: result.summary || {},
      selectedGroup: 0,
      loading: false,
      loaded: true,
      error: "",
    };
  } catch (error) {
    productSalesDistributionState = { ...productSalesDistributionState, loading: false, loaded: true, error: error.message || "产品销售结构读取失败。" };
  }
  rerender();
}

async function refreshProductShopSandbox(rerender) {
  if (productShopSandboxState.loading) return;
  productShopSandboxState = { ...productShopSandboxState, loading: true, error: "" };
  rerender();
  try {
    const result = await loadProductShopSandbox({
      preset: productShopSandboxState.range?.preset || "30d",
      startDate: productShopSandboxState.range?.startDate || "",
      endDate: productShopSandboxState.range?.endDate || "",
      shopId: productShopSandboxState.shopId || "",
    });
    productShopSandboxState = {
      ...productShopSandboxState,
      range: result.range,
      shopId: result.selectedShop?.id || "",
      shops: result.shops || [],
      selectedShop: result.selectedShop || null,
      items: result.items || [],
      summary: result.summary || {},
      loading: false,
      loaded: true,
      error: "",
    };
  } catch (error) {
    productShopSandboxState = { ...productShopSandboxState, loading: false, loaded: true, error: error.message || "产品沙盘读取失败。" };
  }
  rerender();
}

async function refreshProductManagementDetail(productId, rerender) {
  if (!productId || productManagementState.loadingProductId === productId) return;
  productManagementState = { ...productManagementState, loadingProductId: productId, error: "" }; rerender();
  try { const result = await loadProductManagementDetail(productId); const details = new Map(productManagementState.details); details.set(productId, { ...(details.get(productId) ?? {}), ...result.detail, lifecycleStatuses: result.lifecycleStatuses }); productManagementState = { ...productManagementState, details, loadingProductId: "", error: "" }; }
  catch (error) { productManagementState = { ...productManagementState, loadingProductId: "", error: error.message || "产品经营详情读取失败。" }; }
  rerender();
}

async function refreshProductHealthAnalysis(productId, rerender) {
  if (!productId || productManagementState.loadingProductId === productId) return;
  productManagementState = { ...productManagementState, loadingProductId: productId, error: "" }; rerender();
  try {
    const [result, improvementResult] = await Promise.all([loadProductHealthAnalysis(productId), loadProductImprovementCenter(productId)]);
    const details = new Map(productManagementState.details);
    details.set(productId, { ...(details.get(productId) ?? {}), healthAnalysis: result.analysis, improvementCenter: improvementResult.center });
    productManagementState = { ...productManagementState, details, loadingProductId: "", error: "" };
  } catch (error) {
    productManagementState = { ...productManagementState, loadingProductId: "", error: error.message || "产品健康分析读取失败。" };
  }
  rerender();
}

async function refreshProductImprovementCenter(productId, rerender) {
  if (!productId || productManagementState.loadingProductId === productId) return;
  productManagementState = { ...productManagementState, loadingProductId: productId, error: "" }; rerender();
  try {
    const result = await loadProductImprovementCenter(productId);
    const details = new Map(productManagementState.details);
    details.set(productId, { ...(details.get(productId) ?? {}), improvementCenter: result.center });
    productManagementState = { ...productManagementState, details, loadingProductId: "", error: "" };
  } catch (error) {
    productManagementState = { ...productManagementState, loadingProductId: "", error: error.message || "产品经营改善读取失败。" };
  }
  rerender();
}

async function refreshProductStrategy(productId, rerender) {
  if (!productId || productManagementState.loadingProductId === productId) return;
  productManagementState = { ...productManagementState, loadingProductId: productId, error: "" }; rerender();
  try {
    const result = await loadProductStrategy(productId); const details = new Map(productManagementState.details);
    details.set(productId, { ...(details.get(productId) ?? {}), strategy: result.strategy });
    productManagementState = { ...productManagementState, details, loadingProductId: "", error: "" };
  } catch (error) { productManagementState = { ...productManagementState, loadingProductId: "", error: error.message || "产品战略读取失败。" }; }
  rerender();
}

async function refreshProductBusinessDiagnosis(productId, rerender) {
  if (!productId || productManagementState.loadingProductId === productId) return;
  productManagementState = { ...productManagementState, loadingProductId: productId, error: "" }; rerender();
  try {
    const result = await loadProductBusinessDiagnosis(productId); const details = new Map(productManagementState.details);
    details.set(productId, { ...(details.get(productId) ?? {}), businessDiagnosis: result.diagnosis });
    productManagementState = { ...productManagementState, details, loadingProductId: "", error: "" };
  } catch (error) { productManagementState = { ...productManagementState, loadingProductId: "", error: error.message || "产品经营诊断读取失败。" }; }
  rerender();
}

async function refreshProductInsightCenter(productId, rerender) {
  if (!productId || productManagementState.loadingProductId === productId) return;
  productManagementState = { ...productManagementState, loadingProductId: productId, error: "" }; rerender();
  try {
    const result = await loadProductInsightCenter(productId); const details = new Map(productManagementState.details);
    details.set(productId, { ...(details.get(productId) ?? {}), insightCenter: result.center });
    productManagementState = { ...productManagementState, details, loadingProductId: "", error: "" };
  } catch (error) { productManagementState = { ...productManagementState, loadingProductId: "", error: error.message || "用户洞察读取失败。" }; }
  rerender();
}

async function refreshUnmatchedPlatformSkus(rerender, query = unmatchedSkuState.query) {
  unmatchedSkuState = { ...unmatchedSkuState, query, loading: true, error: "" };
  rerender();
  try {
    const result = await loadUnmatchedPlatformSkus({ query, limit: 100, offset: 0 });
    unmatchedSkuState = {
      loading: false,
      loaded: true,
      rows: result.rows ?? [],
      total: result.pagination?.total ?? 0,
      query,
      error: "",
    };
  } catch (error) {
    unmatchedSkuState = { ...unmatchedSkuState, loading: false, loaded: true, rows: [], total: 0, error: error.message || "未匹配平台SKU读取失败。" };
  }
  rerender();
}

async function refreshPlatformPreview(rerender, { page = 1, filters = importState.previewFilters ?? {} } = {}) {
  if (importState.loading) return;
  const previousPagination = importState.pagination;
  const totalPages = Math.max(1, previousPagination?.totalPages ?? 1);
  const targetPage = Math.min(totalPages, Math.max(1, Number(page) || 1));
  const batchId = importState.batch.id;
  const requestId = ++platformPreviewRequestId;
  importState = {
    ...importState,
    loading: true,
    error: "",
    previewFilters: filters,
    pagination: { ...previousPagination, page: targetPage },
  };
  rerender();
  try {
    const result = await loadProductV2Preview(batchId, {
      previewFilters: filters,
      page: targetPage,
      pageSize: 30,
    });
    if (requestId !== platformPreviewRequestId) return;
    importState = {
      ...importState,
      step: "preview",
      loading: false,
      batch: result.batch,
      valid: result.batch?.status === "validated",
      summary: result.summary,
      previewLinks: result.previewLinks ?? [],
      pagination: result.pagination,
      shopMappings: result.shopMappings,
    };
  } catch (error) {
    if (requestId !== platformPreviewRequestId) return;
    importState = {
      ...importState,
      loading: false,
      pagination: previousPagination,
      error: error.message || "平台货品预览读取失败。",
    };
  }
  rerender();
}

function bindProductDistributionTooltips() {
  const tooltip = document.querySelector("[data-product-distribution-tooltip]");
  const chart = tooltip?.closest(".product-sales-distribution-chart");
  if (!tooltip || !chart) return;
  const fields = {
    rank: tooltip.querySelector("[data-product-tooltip-rank]"),
    name: tooltip.querySelector("[data-product-tooltip-name]"),
    code: tooltip.querySelector("[data-product-tooltip-code]"),
    image: tooltip.querySelector("[data-product-tooltip-image]"),
    imagePlaceholder: tooltip.querySelector("[data-product-tooltip-image-placeholder]"),
    sales: tooltip.querySelector("[data-product-tooltip-sales]"),
    share: tooltip.querySelector("[data-product-tooltip-share]"),
    physical: tooltip.querySelector("[data-product-tooltip-physical]"),
  };
  const showImagePlaceholder = () => {
    fields.image.hidden = true;
    fields.imagePlaceholder.hidden = false;
  };
  fields.image.addEventListener("error", showImagePlaceholder);
  const positionTooltip = (bar, event) => {
    const chartRect = chart.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    const pointerX = Number.isFinite(event?.clientX) ? event.clientX : barRect.left + barRect.width / 2;
    const pointerY = Number.isFinite(event?.clientY) ? event.clientY : barRect.top;
    const tooltipRect = tooltip.getBoundingClientRect();
    const padding = 10;
    const preferredLeft = pointerX - chartRect.left + 14;
    const maxLeft = Math.max(padding, chartRect.width - tooltipRect.width - padding);
    const left = Math.min(Math.max(padding, preferredLeft), maxLeft);
    const above = pointerY - chartRect.top - tooltipRect.height - 14;
    const below = pointerY - chartRect.top + 16;
    const top = above >= padding ? above : Math.min(below, Math.max(padding, chartRect.height - tooltipRect.height - padding));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };
  const showTooltip = (bar, event) => {
    fields.rank.textContent = bar.dataset.tooltipRank || "—";
    fields.name.textContent = bar.dataset.tooltipName || "未命名产品";
    fields.code.textContent = bar.dataset.tooltipCode || "暂无编码";
    const imageUrl = bar.dataset.tooltipImage || "";
    if (imageUrl) {
      fields.image.src = imageUrl;
      fields.image.alt = bar.dataset.tooltipName || "产品主图";
      fields.image.hidden = false;
      fields.imagePlaceholder.hidden = true;
    } else {
      fields.image.removeAttribute("src");
      showImagePlaceholder();
    }
    fields.sales.textContent = bar.dataset.tooltipSales || "暂无数据";
    fields.share.textContent = bar.dataset.tooltipShare || "暂无数据";
    fields.physical.textContent = bar.dataset.tooltipPhysical || "暂无数据";
    tooltip.hidden = false;
    positionTooltip(bar, event);
  };
  const hideTooltip = () => { tooltip.hidden = true; };
  document.querySelectorAll("[data-product-distribution-bar]").forEach((bar) => {
    bar.addEventListener("pointerenter", (event) => showTooltip(bar, event));
    bar.addEventListener("pointermove", (event) => positionTooltip(bar, event));
    bar.addEventListener("pointerleave", hideTooltip);
    bar.addEventListener("focus", () => showTooltip(bar));
    bar.addEventListener("blur", hideTooltip);
  });
}

export function bindProductCenterPageEvents(rerender) {
  ensureAuthorizedProductSubmodule();
  if (isComboSkuRoute()) productSubmodule = "combo-skus";
  const routeErpSkuId = getRouteErpSkuId();
  const routeProductId = getRouteProductId();
  if (!routeProductId && !routeErpSkuId && productSubmodule === "sku-management" && !productSkuV2State.loaded && !productSkuV2State.loading) void refreshProductSkuV2List(rerender);
  if (routeErpSkuId && productSkuV2State.detailId !== routeErpSkuId && !productSkuV2State.loading) void refreshProductSkuV2Detail(routeErpSkuId, rerender);
  if (routeProductId && !getProductManagementDetail(routeProductId) && productManagementState.loadingProductId !== routeProductId) void refreshProductManagementDetail(routeProductId, rerender);
  if (!routeProductId && !routeErpSkuId && productSubmodule === "business-dashboard" && !productBusinessDashboardState.readModel && !productBusinessDashboardState.loading) void refreshProductBusinessDashboard(rerender);
  if (!routeProductId && !routeErpSkuId && productSubmodule === "business-cockpit" && !productSalesDistributionState.loaded && !productSalesDistributionState.loading) void refreshProductSalesDistribution(rerender);
  if (!routeProductId && !routeErpSkuId && productSubmodule === "product-sandbox" && !productShopSandboxState.loaded && !productShopSandboxState.loading) void refreshProductShopSandbox(rerender);
  if (routeProductId && productDetailTab === "health-analysis" && (!getProductManagementDetail(routeProductId)?.healthAnalysis || !getProductManagementDetail(routeProductId)?.improvementCenter) && productManagementState.loadingProductId !== routeProductId) void refreshProductHealthAnalysis(routeProductId, rerender);
  if (routeProductId && productDetailTab === "business-improvement" && !getProductManagementDetail(routeProductId)?.improvementCenter && productManagementState.loadingProductId !== routeProductId) void refreshProductImprovementCenter(routeProductId, rerender);
  if (routeProductId && productDetailTab === "strategy" && !getProductManagementDetail(routeProductId)?.strategy && productManagementState.loadingProductId !== routeProductId) void refreshProductStrategy(routeProductId, rerender);
  if (routeProductId && productDetailTab === "business-diagnosis" && !getProductManagementDetail(routeProductId)?.businessDiagnosis && productManagementState.loadingProductId !== routeProductId) void refreshProductBusinessDiagnosis(routeProductId, rerender);
  if (routeProductId && productDetailTab === "user-insights" && !getProductManagementDetail(routeProductId)?.insightCenter && productManagementState.loadingProductId !== routeProductId) void refreshProductInsightCenter(routeProductId, rerender);
  if (routeProductId && productDetailTab === "sales" && productSalesState.productId !== routeProductId && !productSalesState.loading) {
    void refreshProductSalesLinks(routeProductId, rerender);
  }
  if (!routeProductId && !routeErpSkuId && productSubmodule === "sku-management" && !unmatchedSkuState.loaded && !unmatchedSkuState.loading) {
    void refreshUnmatchedPlatformSkus(rerender);
  }
  if (!routeProductId && !routeErpSkuId && productSubmodule === "sku-management" && !productSalesSummaryState.loaded && !productSalesSummaryState.loading) {
    void refreshProductSalesSummaries(rerender);
  }
  if (!routeProductId && productSubmodule === "pending-skus" && !pendingSkuState.loaded && !pendingSkuState.loading) {
    void refreshPendingErpSkus(rerender);
  }
  if (!routeProductId && !routeErpSkuId && productSubmodule === "combo-skus" && !comboSkuState.loaded && !comboSkuState.loading && !comboSkuState.detail) void refreshComboSkuList(rerender);
  document.querySelector("[data-combo-sku-search]")?.addEventListener("submit", (event) => { event.preventDefault(); comboSkuState = { ...comboSkuState, search: event.currentTarget.elements.search.value.trim(), includeHistorical: event.currentTarget.elements.includeHistorical.checked, page: 1, loaded: false, detail: null }; void refreshComboSkuList(rerender); });
  const productBusinessFilterForm = document.querySelector("[data-product-business-filter]");
  const applyProductBusinessFilters = (form) => {
    productBusinessFilters = {
      ...productBusinessFilters,
      query: form.elements.query.value.trim(), brand: form.elements.brand.value, category: form.elements.category.value,
      lifecycle: form.elements.lifecycle.value, status: form.elements.status.value, healthStatus: form.elements.healthStatus.value,
      inventoryStatus: form.elements.inventoryStatus.value, ownerId: form.elements.ownerId.value,
      includeHistorical: form.elements.includeHistorical.checked,
      page: 1,
    };
    void refreshProductBusinessDashboard(rerender);
  };
  productBusinessFilterForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    window.clearTimeout(productBusinessSearchTimer);
    applyProductBusinessFilters(event.currentTarget);
  });
  productBusinessFilterForm?.querySelectorAll("select, input[type='checkbox']").forEach((field) => field.addEventListener("change", () => {
    window.clearTimeout(productBusinessSearchTimer);
    productBusinessSearchTimer = window.setTimeout(() => applyProductBusinessFilters(productBusinessFilterForm), 120);
  }));
  productBusinessFilterForm?.elements.query.addEventListener("input", () => {
    window.clearTimeout(productBusinessSearchTimer);
    productBusinessSearchTimer = window.setTimeout(() => applyProductBusinessFilters(productBusinessFilterForm), 450);
  });
  document.querySelector("[data-product-business-period-filter]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    productBusinessFilters = { ...productBusinessFilters, periodStart: form.elements.periodStart?.value || "", periodEnd: form.elements.periodEnd?.value || "", page: 1 };
    void refreshProductBusinessDashboard(rerender);
  });
  document.querySelectorAll("[data-product-business-range]").forEach((button) => button.addEventListener("click", () => {
    productBusinessFilters = { ...productBusinessFilters, range: button.dataset.productBusinessRange || "30d", page: 1 };
    if (button.dataset.productBusinessRange === "custom") rerender();
    else void refreshProductBusinessDashboard(rerender);
  }));
  document.querySelector("[data-product-distribution-filter]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    productSalesDistributionState = {
      ...productSalesDistributionState,
      range: { ...productSalesDistributionState.range, startDate: form.elements.startDate.value, endDate: form.elements.endDate.value },
      includeHistorical: form.elements.includeHistorical.checked,
      selectedGroup: 0,
      loaded: false,
    };
    void refreshProductSalesDistribution(rerender);
  });
  document.querySelectorAll("[data-product-distribution-preset]").forEach((button) => button.addEventListener("click", () => {
    const includeHistorical = document.querySelector("[data-product-distribution-filter] [name='includeHistorical']")?.checked ?? productSalesDistributionState.includeHistorical;
    productSalesDistributionState = { ...productSalesDistributionState, range: { ...productSalesDistributionState.range, preset: button.dataset.productDistributionPreset }, includeHistorical, selectedGroup: 0, loaded: false };
    if (button.dataset.productDistributionPreset === "custom") rerender();
    else void refreshProductSalesDistribution(rerender);
  }));
  document.querySelectorAll("[data-product-distribution-group]").forEach((button) => {
    const openGroup = () => { productSalesDistributionState = { ...productSalesDistributionState, selectedGroup: Number(button.dataset.productDistributionGroup || 0) }; rerender(); };
    button.addEventListener("click", openGroup);
    button.addEventListener("keydown", (event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); openGroup(); } });
  });
  document.querySelector("[data-product-distribution-back]")?.addEventListener("click", () => {
    productSalesDistributionState = { ...productSalesDistributionState, selectedGroup: 0 };
    rerender();
  });
  document.querySelectorAll("[data-product-distribution-product]").forEach((bar) => {
    const openProduct = () => { window.location.hash = `products/${encodeURIComponent(bar.dataset.productDistributionProduct)}`; };
    bar.addEventListener("click", openProduct);
    bar.addEventListener("keydown", (event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); openProduct(); } });
  });
  bindProductDistributionTooltips();
  document.querySelector("[data-product-sandbox-filter]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    productShopSandboxState = {
      ...productShopSandboxState,
      range: { ...productShopSandboxState.range, startDate: form.elements.startDate.value, endDate: form.elements.endDate.value },
      loaded: false,
    };
    void refreshProductShopSandbox(rerender);
  });
  document.querySelectorAll("[data-product-sandbox-preset]").forEach((button) => button.addEventListener("click", () => {
    productShopSandboxState = { ...productShopSandboxState, range: { ...productShopSandboxState.range, preset: button.dataset.productSandboxPreset }, loaded: false };
    if (button.dataset.productSandboxPreset === "custom") rerender();
    else void refreshProductShopSandbox(rerender);
  }));
  document.querySelectorAll("[data-product-sandbox-shop]").forEach((button) => button.addEventListener("click", () => {
    productShopSandboxState = { ...productShopSandboxState, shopId: button.dataset.productSandboxShop || "", loaded: false };
    void refreshProductShopSandbox(rerender);
  }));
  document.querySelectorAll("[data-product-sandbox-segment]").forEach((button) => button.addEventListener("click", () => {
    productShopSandboxState = { ...productShopSandboxState, segment: button.dataset.productSandboxSegment || "all" };
    rerender();
  }));
  document.querySelectorAll("[data-product-sandbox-sort]").forEach((button) => button.addEventListener("click", () => {
    productShopSandboxState = { ...productShopSandboxState, sortMode: button.dataset.productSandboxSort === "code_group" ? "code_group" : "sales" };
    rerender();
  }));
  document.querySelectorAll("[data-product-sandbox-product]").forEach((button) => button.addEventListener("click", () => {
    window.location.hash = `products/${encodeURIComponent(button.dataset.productSandboxProduct)}`;
  }));
  document.querySelectorAll("[data-product-business-metric]").forEach((checkbox) => checkbox.addEventListener("change", (event) => {
    const metric = event.currentTarget.dataset.productBusinessMetric;
    if (event.currentTarget.checked) productBusinessVisibleMetrics.add(metric);
    else productBusinessVisibleMetrics.delete(metric);
    rerender();
  }));
  document.querySelector("[data-pending-sku-search]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void refreshPendingErpSkus(rerender, event.currentTarget.elements.query.value.trim());
  });
  document.querySelector("[data-platform-product-search]")?.addEventListener("submit", (event) => {
    event.preventDefault(); const query = event.currentTarget.elements.query.value.trim(); const matches = platformProductMatches(query);
    const exact = matches.filter((item) => item.exactProductCode);
    platformProductLinkState = { ...platformProductLinkState, query,
      selectedProductId: exact.length === 1 ? exact[0].product.id : matches.length === 1 ? matches[0].product.id : "",
      error: query && !matches.length ? "未找到对应产品。" : "" };
    rerender();
  });
  document.querySelector("[data-pending-sku-select-all]")?.addEventListener("change", (event) => {
    selectedPendingSkuIds = event.currentTarget.checked
      ? new Set(pendingSkuState.rows.map((item) => item.id))
      : new Set();
    rerender();
  });
  document.querySelectorAll("[data-pending-sku-select]").forEach((checkbox) => checkbox.addEventListener("change", (event) => {
    const id = event.currentTarget.dataset.pendingSkuSelect;
    if (event.currentTarget.checked) selectedPendingSkuIds.add(id);
    else selectedPendingSkuIds.delete(id);
    rerender();
  }));
  document.querySelector("[data-unmatched-search]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void refreshUnmatchedPlatformSkus(rerender, event.currentTarget.elements.query.value.trim());
  });
  document.querySelector("[data-platform-preview-filter]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    void refreshPlatformPreview(rerender, {
      page: 1,
      filters: {
        platform: form.elements.platform.value,
        shop: form.elements.shop.value,
        status: form.elements.status.value,
        query: form.elements.query.value.trim(),
      },
    });
  });
  document.querySelector("[data-product-filter-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    filters = {
      query: form.elements.query.value,
      brand: form.elements.brand.value,
      category: form.elements.category.value,
      status: form.elements.status.value,
      erpStatus: form.elements.erpStatus.value,
      platform: form.elements.platform.value,
      stockStatus: form.elements.stockStatus.value,
    };
    productPage = 1;
    rerender();
  });
  document.querySelector("[data-product-v2-filter]")?.addEventListener("submit", (event) => {
    event.preventDefault(); const form = event.currentTarget;
    productSkuV2State = { ...productSkuV2State, search: form.elements.search.value.trim(), includeUnarchived: form.elements.includeUnarchived.checked, includeHistorical: form.elements.includeHistorical.checked, profileStatus: "all",
      erpStatus: form.elements.erpStatus.value.trim(), brand: form.elements.brand.value, category: form.elements.category.value,
      lifecycleStatus: form.elements.lifecycleStatus.value, operatingLifecycleStatus: form.elements.operatingLifecycleStatus.value, platform: form.elements.platform.value, stockStatus: form.elements.stockStatus.value,
      page: 1, loaded: false, notice: "" };
    void refreshProductSkuV2List(rerender);
  });
  document.querySelector('[data-product-v2-filter] input[name="search"]')?.addEventListener("input", (event) => {
    window.clearTimeout(productSkuV2SearchTimer); const value = event.currentTarget.value;
    productSkuV2SearchTimer = window.setTimeout(() => { productSkuV2State = { ...productSkuV2State, search: value.trim(), page: 1, loaded: false }; void refreshProductSkuV2List(rerender); }, 280);
  });
  document.querySelector('[data-product-v2-filter] input[name="includeUnarchived"]')?.addEventListener("change", (event) => {
    productSkuV2State = { ...productSkuV2State, includeUnarchived: event.currentTarget.checked, profileStatus: "all", page: 1, loaded: false, notice: "" };
    void refreshProductSkuV2List(rerender);
  });
  document.querySelector("[data-product-lifecycle-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form=event.currentTarget; const productId=form.dataset.productId;
    if (!hasPermission(getCurrentUser(), "products.archive")) return;
    try { await changeProductLifecycle(productId,{status:form.elements.status.value,reason:form.elements.reason.value.trim()}); const product=state.products.find((item)=>item.id===productId); if(product) product.status=form.elements.status.value; const details=new Map(productManagementState.details); details.delete(productId); productManagementState={...productManagementState,details,overview:null,notice:"生命周期已更新。"}; await refreshProductManagementDetail(productId,rerender); }
    catch(error){productManagementState={...productManagementState,error:error.message||"生命周期更新失败。"};rerender();}
  });
  document.querySelectorAll("[data-product-improvement-form]").forEach((form)=>form.addEventListener("submit",async(event)=>{
    event.preventDefault(); const payload=Object.fromEntries(new FormData(form));
    try { const result=await createProductImprovementAction(form.dataset.issueId,payload); if(result.instance) state.processInstances=[result.instance,...state.processInstances.filter((item)=>item.id!==result.instance.id)]; if(result.actionProduct) state.actionProducts=[result.actionProduct,...state.actionProducts.filter((item)=>item.id!==result.actionProduct.id)]; const details=new Map(productManagementState.details); details.delete(routeProductId); productManagementState={...productManagementState,details,notice:"改善行动草稿已创建。"}; await refreshProductManagementDetail(routeProductId,rerender); }
    catch(error){productManagementState={...productManagementState,error:error.message||"改善行动创建失败。"};rerender();}
  }));
  document.querySelectorAll("[data-product-health-action-form]").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(form));
    payload.recommendationCode = form.dataset.recommendationCode;
    try {
      const result = await createProductHealthAction(form.dataset.productId, payload);
      if (result.instance) state.processInstances = [result.instance, ...state.processInstances.filter((item) => item.id !== result.instance.id)];
      if (result.actionProduct) state.actionProducts = [result.actionProduct, ...state.actionProducts.filter((item) => item.id !== result.actionProduct.id)];
      const details = new Map(productManagementState.details); const current = { ...(details.get(form.dataset.productId) ?? {}) }; delete current.businessDiagnosis; delete current.insightCenter; details.set(form.dataset.productId, current);
      productManagementState = { ...productManagementState, details, notice: "改善行动草稿已创建，正在进入关键行动。", error: "" };
      window.location.hash = "schedule-board";
    } catch (error) {
      productManagementState = { ...productManagementState, error: error.message || "产品健康改善行动创建失败。" };
      rerender();
    }
  }));
  document.querySelectorAll("[data-product-improvement-result-form]").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(form));
    try {
      await recordProductImprovementResult(form.dataset.improvementId, payload);
      const details = new Map(productManagementState.details);
      const { improvementCenter: _staleImprovementCenter, ...current } = details.get(routeProductId) ?? {};
      details.set(routeProductId, current);
      productManagementState = { ...productManagementState, details, notice: "改善结果已记录，问题和关键行动状态未自动更改。", error: "" };
      await refreshProductImprovementCenter(routeProductId, rerender);
    } catch (error) {
      productManagementState = { ...productManagementState, error: error.message || "产品改善结果保存失败。" }; rerender();
    }
  }));
  document.querySelectorAll("[data-product-strategy-section]").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault(); const payload = Object.fromEntries(new FormData(form));
    try {
      await saveProductStrategySection(form.dataset.productId, form.dataset.productStrategySection, payload);
      const details = new Map(productManagementState.details); const current = { ...(details.get(form.dataset.productId) ?? {}) }; delete current.strategy; delete current.businessDiagnosis; delete current.insightCenter; details.set(form.dataset.productId, current);
      productManagementState = { ...productManagementState, details, notice: "产品战略已保存，上一版已转入历史。", error: "" };
      await refreshProductStrategy(form.dataset.productId, rerender);
    } catch (error) { productManagementState = { ...productManagementState, error: error.message || "产品战略保存失败。" }; rerender(); }
  }));
  document.querySelectorAll("[data-product-strategy-step-create]").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await addProductStrategyStep(form.dataset.productId, Object.fromEntries(new FormData(form)));
      const details = new Map(productManagementState.details); const current = { ...(details.get(form.dataset.productId) ?? {}) }; delete current.strategy; delete current.businessDiagnosis; delete current.insightCenter; details.set(form.dataset.productId, current);
      productManagementState = { ...productManagementState, details, notice: "下一步策略已新增，未生成任务。", error: "" };
      await refreshProductStrategy(form.dataset.productId, rerender);
    } catch (error) { productManagementState = { ...productManagementState, error: error.message || "下一步策略新增失败。" }; rerender(); }
  }));
  document.querySelectorAll("[data-product-strategy-step-update]").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await updateProductStrategyStep(form.dataset.productId, form.dataset.itemId, Object.fromEntries(new FormData(form)));
      const details = new Map(productManagementState.details); const current = { ...(details.get(form.dataset.productId) ?? {}) }; delete current.strategy; delete current.businessDiagnosis; delete current.insightCenter; details.set(form.dataset.productId, current);
      productManagementState = { ...productManagementState, details, notice: "策略状态已保存，不会自动变更任务或产品状态。", error: "" };
      await refreshProductStrategy(form.dataset.productId, rerender);
    } catch (error) { productManagementState = { ...productManagementState, error: error.message || "下一步策略保存失败。" }; rerender(); }
  }));
  document.querySelectorAll("[data-product-strategy-action-form]").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await createProductStrategyAction(form.dataset.productId, form.dataset.itemId, Object.fromEntries(new FormData(form)));
      if (result.instance) state.processInstances = [result.instance, ...state.processInstances.filter((item) => item.id !== result.instance.id)];
      if (result.actionProduct) state.actionProducts = [result.actionProduct, ...state.actionProducts.filter((item) => item.id !== result.actionProduct.id)];
      const details = new Map(productManagementState.details); const current = { ...(details.get(form.dataset.productId) ?? {}) }; delete current.businessDiagnosis; delete current.insightCenter; details.set(form.dataset.productId, current);
      productManagementState = { ...productManagementState, details, notice: "关键行动草稿已创建，未生成任务。", error: "" };
      window.location.hash = "schedule-board";
    } catch (error) { productManagementState = { ...productManagementState, error: error.message || "战略关键行动创建失败。" }; rerender(); }
  }));
  document.querySelectorAll("[data-product-insight-form]").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await createProductInsight(form.dataset.productId, Object.fromEntries(new FormData(form)));
      const details = new Map(productManagementState.details); const current = { ...(details.get(form.dataset.productId) ?? {}) }; delete current.insightCenter; details.set(form.dataset.productId, current);
      productManagementState = { ...productManagementState, details, notice: "用户洞察已保存，未修改产品或自动生成任务。", error: "" };
      await refreshProductInsightCenter(form.dataset.productId, rerender);
    } catch (error) { productManagementState = { ...productManagementState, error: error.message || "用户洞察保存失败。" }; rerender(); }
  }));
  document.querySelectorAll("[data-product-insight-update]").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await updateProductInsight(form.dataset.productId, form.dataset.insightId, Object.fromEntries(new FormData(form)));
      const details = new Map(productManagementState.details); const current = { ...(details.get(form.dataset.productId) ?? {}) }; delete current.insightCenter; details.set(form.dataset.productId, current);
      productManagementState = { ...productManagementState, details, notice: "用户洞察状态已更新。", error: "" };
      await refreshProductInsightCenter(form.dataset.productId, rerender);
    } catch (error) { productManagementState = { ...productManagementState, error: error.message || "用户洞察更新失败。" }; rerender(); }
  }));
  const page = document.querySelector(".product-center-page");
  page?.addEventListener("keydown", (event) => {
    const card = event.target.closest(".product-archive-card");
    if (card === null || event.target !== card || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    card.click();
  });
  page?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (button === null) return;
    const action = button.dataset.action;
    if (action === "view-product-v2-sku") {
      productSubmodule = "sku-management";
      window.location.hash = `products/sku/${encodeURIComponent(button.dataset.erpSkuId)}`;
      return;
    }
    if (action === "product-workspace-tab") {
      const tab = button.dataset.tab || "overview";
      productWorkspaceState = { ...productWorkspaceState, activeTab: tab, marketingNotice: "" };
      rerender();
      if (["inventory", "sales", "operations"].includes(tab)) void loadProductWorkspaceSection(tab, rerender);
      if (tab === "marketing") void loadProductMarketingSection(rerender);
      return;
    }
    if (action === "product-daily-sales-range") { void loadProductDailySalesSection(rerender, button.dataset.range); return; }
    if (action === "view-product-marketing") {
      productWorkspaceState = { ...productWorkspaceState, activeTab: "marketing", marketingMode: "read", marketingNotice: "" };
      rerender(); void loadProductMarketingSection(rerender); return;
    }
    if (action === "load-product-marketing") { void loadProductMarketingSection(rerender); return; }
    if (action === "edit-product-marketing") { productWorkspaceState = { ...productWorkspaceState, activeTab: "marketing", marketingMode: "edit", marketingNotice: "" }; rerender(); return; }
    if (action === "cancel-product-marketing") { productWorkspaceState = { ...productWorkspaceState, marketingMode: "read", marketingNotice: "" }; rerender(); return; }
    if (action === "copy-product-marketing") {
      const productId = productSkuV2State.detail?.sku?.productId;
      if (!productId) return;
      try {
        const result = await exportProductMarketingAsset(productId);
        if (!navigator.clipboard?.writeText) throw new Error("当前浏览器不支持复制。");
        await navigator.clipboard.writeText(result.export.text);
        productWorkspaceState = { ...productWorkspaceState, marketingNotice: "产品 AI 资料已复制。" };
      } catch (error) { productWorkspaceState = { ...productWorkspaceState, marketingNotice: error.message || "AI资料复制失败。" }; }
      rerender(); return;
    }
    if (action === "load-product-workspace-section") {
      void loadProductWorkspaceSection(button.dataset.scope, rerender);
      return;
    }
    if (action === "product-v2-page") {
      productSkuV2State = { ...productSkuV2State, page: Math.max(1, Number(button.dataset.page) || 1), loaded: false };
      void refreshProductSkuV2List(rerender);
      return;
    }
    if (action === "clear-product-v2-filter") {
      productSkuV2State = { ...productSkuV2State, search: "", includeUnarchived: false, includeHistorical: false, profileStatus: "all", erpStatus: "", brand: "", category: "", lifecycleStatus: "", operatingLifecycleStatus: "", platform: "", stockStatus: "", businessZone: "all", sort: "updated-desc", page: 1, loaded: false, notice: "" };
      void refreshProductSkuV2List(rerender);
      return;
    }
    if (action === "set-product-v2-zone") {
      productSkuV2State = { ...productSkuV2State, businessZone: button.dataset.productZone || "all", page: 1, loaded: false };
      void refreshProductSkuV2List(rerender);
      return;
    }
    if (action === "set-product-v2-sort") {
      productSkuV2State = { ...productSkuV2State, sort: button.dataset.productSort || "updated-desc", page: 1, loaded: false };
      void refreshProductSkuV2List(rerender);
      return;
    }
    if (action === "create-product-v2-profile") {
      if (!hasPermission(getCurrentUser(), "skus.manage")) return;
      const erpSkuId = button.dataset.erpSkuId;
      if (!window.confirm("确认基于当前ERP SKU创建产品经营档案？")) return;
      button.disabled = true;
      try {
        const result = await createProductProfileForErpSku(erpSkuId);
        if (result.product) state.products = [result.product, ...state.products.filter((item) => item.id !== result.product.id)];
        if (result.mapping) state.productErpMappings = [result.mapping, ...state.productErpMappings.filter((item) => item.id !== result.mapping.id)];
        productSkuV2State = { ...productSkuV2State, loaded: false, detailId: "", notice: `SKU ${result.product?.skuCode || ""} 已创建产品档案。`, error: "" };
        if (getRouteErpSkuId()) await refreshProductSkuV2Detail(erpSkuId, rerender); else await refreshProductSkuV2List(rerender);
      } catch (error) { productSkuV2State = { ...productSkuV2State, error: error.message || "产品档案创建失败。" }; rerender(); }
      return;
    }
    if (action === "product-workspace-view") {
      const requestedView = button.dataset.view;
      if (["business-dashboard", "business-cockpit", "product-sandbox"].includes(requestedView) && !canViewProducts()) return;
      if (requestedView === "sku-management" && !canViewSkus() && !canViewCombos()) return;
      productSubmodule = ["sku-management", "business-cockpit", "product-sandbox"].includes(button.dataset.view) ? button.dataset.view : "business-dashboard";
      if (getRouteProductId() || getRouteErpSkuId()) window.location.hash = "products";
      if (productSubmodule === "business-cockpit") void refreshProductSalesDistribution(rerender);
      else if (productSubmodule === "product-sandbox") void refreshProductShopSandbox(rerender);
      else if (productSubmodule === "business-dashboard") void refreshProductBusinessDashboard(rerender);
      else if (!productSkuV2State.loaded && !productSkuV2State.loading) void refreshProductSkuV2List(rerender);
      else rerender();
      return;
    }
    if (action === "product-business-view") {
      productBusinessViewMode = button.dataset.view === "card" ? "card" : "table";
      rerender();
      return;
    }
    if (action === "set-product-business-operating-sort") {
      productBusinessFilters = { ...productBusinessFilters, sortBy: button.dataset.sortBy || "updatedAt", sortDirection: "desc", page: 1 };
      void refreshProductBusinessDashboard(rerender);
      return;
    }
    if (action === "product-business-sort") {
      const sortBy = button.dataset.sortBy;
      const sortDirection = productBusinessFilters.sortBy === sortBy && productBusinessFilters.sortDirection === "desc" ? "asc" : "desc";
      productBusinessFilters = { ...productBusinessFilters, sortBy, sortDirection, page: 1 };
      void refreshProductBusinessDashboard(rerender);
    }
    if (action === "product-business-page") {
      productBusinessFilters = { ...productBusinessFilters, page: Math.max(1, Number(button.dataset.page) || 1) };
      void refreshProductBusinessDashboard(rerender);
    }
    if (action === "open-product-health") {
      productDetailId = button.dataset.productId;
      productDetailTab = "health-analysis";
      window.location.hash = `products/${encodeURIComponent(button.dataset.productId)}`;
      rerender();
    }
    if (action === "open-product-diagnosis") {
      productDetailId = button.dataset.productId;
      productDetailTab = "business-diagnosis";
      window.location.hash = `products/${encodeURIComponent(button.dataset.productId)}`;
      rerender();
    }
    if (action === "product-submodule") {
      if (["sku-management", "pending-skus"].includes(button.dataset.submodule) && !canViewSkus()) return;
      if (button.dataset.submodule === "combo-skus" && !canViewCombos()) return;
      productSubmodule = ["pending-skus", "combo-skus"].includes(button.dataset.submodule) ? button.dataset.submodule : "sku-management";
      rerender();
      return;
    }
    if (action === "combo-sku-page") { comboSkuState = { ...comboSkuState, page: Math.max(1, Number(button.dataset.page) || 1), loaded: false, detail: null }; void refreshComboSkuList(rerender); return; }
    if (action === "combo-sku-view") { comboSkuState = { ...comboSkuState, viewMode: button.dataset.view === "table" ? "table" : "card" }; rerender(); return; }
    if (action === "view-combo-sku") { void refreshComboSkuDetail(button.dataset.salesObjectId, rerender); return; }
    if (action === "back-combo-skus") { comboSkuState = { ...comboSkuState, detail: null, error: "" }; rerender(); return; }
    if (action === "clear-pending-sku-search") {
      pendingSkuState = { ...pendingSkuState, query: "", loaded: false, error: "", notice: "" };
      rerender();
    }
    if (action === "create-product-from-pending-sku") {
      if (!hasPermission(getCurrentUser(), "skus.manage")) return;
      const skuCode = button.dataset.skuCode || "";
      if (!window.confirm(`确认以SKU ${skuCode} 建立产品档案并关联ERP货品？`)) return;
      button.disabled = true;
      button.textContent = "正在创建…";
      try {
        const result = await createProductFromPendingErpSku(button.dataset.erpSkuId);
        state.products = [result.product, ...state.products.filter((item) => item.id !== result.product.id)];
        state.productErpMappings = [
          result.mapping,
          ...state.productErpMappings.filter((item) => item.id !== result.mapping.id),
        ];
        pendingSkuState = {
          ...pendingSkuState,
          rows: pendingSkuState.rows.filter((item) => item.id !== button.dataset.erpSkuId),
          notice: `SKU ${result.product.skuCode} 的产品档案已创建。`,
          error: "",
        };
        selectedPendingSkuIds.delete(button.dataset.erpSkuId);
        rerender();
      } catch (error) {
        pendingSkuState = { ...pendingSkuState, error: error.message || "产品创建失败。", notice: "" };
        rerender();
      }
    }
    if (action === "batch-create-products-from-pending-skus") {
      const erpSkuIds = [...selectedPendingSkuIds];
      if (erpSkuIds.length === 0) return;
      if (!window.confirm(`确认批量建立 ${erpSkuIds.length} 个产品档案并关联ERP货品？`)) return;
      button.disabled = true;
      button.textContent = "正在批量创建…";
      try {
        const result = await createProductsFromPendingErpSkus(erpSkuIds);
        const productIds = new Set(result.products.map((item) => item.id));
        const mappingIds = new Set(result.mappings.map((item) => item.id));
        state.products = [...result.products, ...state.products.filter((item) => !productIds.has(item.id))];
        state.productErpMappings = [
          ...result.mappings,
          ...state.productErpMappings.filter((item) => !mappingIds.has(item.id)),
        ];
        pendingSkuState = {
          ...pendingSkuState,
          rows: pendingSkuState.rows.filter((item) => !selectedPendingSkuIds.has(item.id)),
          notice: `已成功创建 ${result.createdCount} 个产品档案。`,
          error: "",
        };
        selectedPendingSkuIds = new Set();
        rerender();
      } catch (error) {
        pendingSkuState = { ...pendingSkuState, error: error.message || "产品批量创建失败。", notice: "" };
        rerender();
      }
    }
    if (action === "set-product-view") { productViewMode = button.dataset.viewMode === "card" ? "card" : "list"; rerender(); }
    if (action === "set-product-sort") {
      productSort = ["updated-desc", "sales-desc", "stock-desc", "capital-desc", "created-desc"].includes(button.dataset.productSort)
        ? button.dataset.productSort
        : "updated-desc";
      productPage = 1;
      rerender();
    }
    if (action === "set-product-zone") {
      productBusinessZone = ["all", "new", "hit", "active", "clearance"].includes(button.dataset.productZone)
        ? button.dataset.productZone
        : "all";
      productPage = 1;
      rerender();
    }
    if (action === "product-page") {
      productPage = Math.max(1, Number(button.dataset.page) || 1);
      rerender();
      document.querySelector(".product-list-toolbar")?.scrollIntoView({ block: "start" });
    }
    if (action === "clear-product-filters") {
      filters = { query: "", brand: "", category: "", status: "", erpStatus: "", platform: "", stockStatus: "" };
      productPage = 1;
      rerender();
    }
    if (action === "toggle-product-menu") {
      event.stopPropagation();
      const menu = document.querySelector(`[data-product-menu="${CSS.escape(button.dataset.productId)}"]`);
      if (menu) menu.hidden = !menu.hidden;
    }
    if (action === "product-detail-tab") {
      productDetailTab = button.dataset.tab || "basic";
      rerender();
    }
    if (action === "evaluate-product-health") {
      try { await evaluateProductManagementHealth(button.dataset.productId); const details=new Map(productManagementState.details); details.delete(button.dataset.productId); productManagementState={...productManagementState,details,overview:null,notice:"产品经营体检已生成。"}; await refreshProductManagementDetail(button.dataset.productId,rerender); }
      catch(error){productManagementState={...productManagementState,error:error.message||"产品经营体检失败。"};rerender();}
    }
    if (action === "new-product") { modalState = { kind: "create", error: "" }; rerender(); }
    if (action === "open-product-analysis") { productSubmodule = "business-dashboard"; window.location.hash = "products"; }
    if (action === "open-product-import") {
      if (!hasPermission(getCurrentUser(), "products.import")) return;
      importState = { version: "v2", step: "upload", importType: "goods_info", loading: false, error: "" };
      rerender();
    }
    if (action === "open-product-v2-import") {
      if (!hasPermission(getCurrentUser(), "products.import")) return;
      importState = { version: "v2", step: "sync", loading: false, error: "" };
      erpSyncState = { ...erpSyncState, loading: true, active: null, error: "" };
      rerender();
      await refreshErpSyncState();
      rerender();
    }
    if (action === "choose-erp-sync-run") {
      erpSyncState = { ...erpSyncState, active: null, error: "" };
      rerender();
    }
    if (action === "open-erp-sync-run") {
      await refreshErpSyncState(button.dataset.syncRunId);
      rerender();
    }
    if (action === "upload-erp-sync-child") {
      importState = {
        version: "v2",
        step: "upload",
        importType: button.dataset.importType,
        importMode: button.dataset.importType === "goods_info"
          ? erpSyncState.active?.batches?.goods_info?.importMode || erpSyncState.masterImportMode || "incremental"
          : "",
        syncRun: erpSyncState.active,
        loading: false,
        error: "",
      };
      rerender();
    }
    if (action === "sync-wangdian-goods") {
      importState = {
        version: "v2",
        step: "wangdian",
        importType: "goods_info",
        importMode: erpSyncState.masterImportMode || "incremental",
        syncRun: erpSyncState.active,
        loading: false,
        error: "",
      };
      rerender();
    }
    if (action === "regenerate-wangdian-preview") {
      importState = {
        version: "v2",
        step: "wangdian",
        importType: "goods_info",
        importMode: erpSyncState.active?.batches?.goods_info?.importMode || erpSyncState.masterImportMode || "incremental",
        syncRun: erpSyncState.active,
        loading: false,
        error: "",
      };
      rerender();
    }
    if (action === "back-to-erp-sync") {
      const syncRunId = importState.syncRun?.id || importState.result?.syncRun?.id || importState.batch?.syncRunId;
      await refreshErpSyncState(syncRunId);
      importState = { version: "v2", step: "sync", loading: false, error: "" };
      rerender();
    }
    if (action === "retry-erp-reconciliation") {
      erpSyncState = { ...erpSyncState, loading: true, error: "" };
      rerender();
      try {
        const result = await recalculateErpSyncRun(erpSyncState.active.id);
        erpSyncState = { ...erpSyncState, loading: false, active: result.syncRun, error: "" };
      } catch (error) {
        erpSyncState = { ...erpSyncState, loading: false, error: error.message || "ERP缺失记录对账重试失败。" };
      }
      rerender();
    }
    if (action === "resume-product-v2-import") {
      importState = { version: "v2", step: "upload", loading: true, error: "" };
      rerender();
      try {
        const result = await loadProductV2Import(button.dataset.batchId);
        const restoredMappings = Object.fromEntries((result.shopMappings ?? []).map((mapping) => [
          mapping.rawName,
          mapping.mappingStatus === "ignored"
            ? { action: "ignore" }
            : mapping.shopId
              ? { shopId: mapping.shopId }
              : { platform: mapping.platform, shopName: mapping.shopName, displayName: mapping.displayName },
        ]));
        const isCompleted = ["completed", "committed"].includes(result.batch.status);
        const isValidatedPlatform = result.batch.importType === "platform_goods" && result.batch.status === "validated";
        importState = {
          version: "v2",
          step: isCompleted ? "complete" : result.batch.importType === "platform_goods" && !isValidatedPlatform ? "shops" : "preview",
          loading: false,
          error: "",
          importType: result.batch.importType,
          syncRun: erpSyncState.active || result.syncRun,
          result: isCompleted ? { batch: result.batch, summary: result.batch.summaryJson, syncRun: result.syncRun } : null,
          submittedShopMappings: restoredMappings,
          ...result,
        };
        if (isValidatedPlatform) await refreshPlatformPreview(rerender);
      } catch (error) {
        importState = {
          version: "v2", step: "sync", loading: false,
          error: error.message || "导入批次读取失败.",
        };
      }
      rerender();
    }
    if (action === "edit-product") { modalState = { kind: "edit", id: button.dataset.productId, error: "" }; rerender(); }
    if (action === "close-product-modal") { modalState = null; rerender(); }
    if (action === "open-sku-change") {
      if (!hasPermission(getCurrentUser(), "skus.manage")) return;
      const product = state.products.find((item) => item.id === button.dataset.productId);
      if (product) {
        modalState = null;
        skuChangeState = { productId: product.id, oldSkuCode: product.skuCode, newSkuCode: "", reason: "", impact: null, loading: false, error: "" };
        rerender();
      }
    }
    if (action === "close-sku-change") { skuChangeState = null; rerender(); }
    if (action === "back-sku-change") { skuChangeState = { ...skuChangeState, impact: null, error: "" }; rerender(); }
    if (action === "confirm-sku-change" && skuChangeState && !skuChangeState.loading) {
      skuChangeState = { ...skuChangeState, loading: true, error: "" };
      rerender();
      try {
        await changeProductSku(skuChangeState.productId, {
          oldSkuCode: skuChangeState.oldSkuCode,
          newSkuCode: skuChangeState.newSkuCode,
          reason: skuChangeState.reason,
        });
        skuChangeState = null;
      } catch (error) {
        skuChangeState = { ...skuChangeState, loading: false, error: error.message || "SKU修改失败。" };
      }
      rerender();
    }
    if (action === "close-product-import") { importState = null; rerender(); }
    if (action === "return-product-v2-shop-mapping") {
      importState = { ...importState, step: "shops", valid: false, error: "请确认或忽略全部店铺后重新生成导入预览。" };
      rerender();
    }
    if (action === "back-product-import-mapping") { importState = { ...importState, step: "mapping", error: "" }; rerender(); }
    if (action === "validate-product-import") {
      const mapping = collectImportMapping();
      importState = { ...importState, loading: true, error: "" };
      rerender();
      try {
        const result = await validateProductImportBatch(importState.batch.id, mapping);
        importState = { ...importState, step: "preview", loading: false, valid: result.valid, batch: result.batch, preview: result.preview };
      } catch (error) {
        importState = { ...importState, loading: false, error: error.message || "导入校验失败。" };
      }
      rerender();
    }
    if (action === "commit-product-import") {
      importState = { ...importState, loading: true, error: "" };
      rerender();
      try {
        const result = await commitProductImport(importState.batch.id);
        importState = { ...importState, step: "complete", loading: false, batch: result.batch, valid: true };
      } catch (error) {
        importState = { ...importState, loading: false, error: error.message || "确认导入失败。" };
      }
      rerender();
    }
    if (action === "confirm-suggested-shops") {
      importState = {
        ...importState,
        shopMappings: (importState.shopMappings ?? []).map((mapping) =>
          mapping.mappingStatus === "suggested" ? { ...mapping, mappingStatus: "confirmed" } : mapping,
        ),
      };
      rerender();
    }
    if (action === "confirm-shop-mappings") {
      const shopMappings = collectShopMappings();
      importState = { ...importState, loading: true, error: "", submittedShopMappings: shopMappings };
      rerender();
      try {
        const result = await validateProductV2Import(importState.batch.id, { shopMappings });
        const pendingNames = (result.shopMappings ?? []).filter((item) => !["confirmed", "ignored"].includes(item.mappingStatus)).map((item) => item.rawName);
        importState = {
          ...importState,
          step: result.valid ? "preview" : "shops",
          loading: false,
          batch: result.batch,
          valid: result.batch?.status === "validated",
          summary: result.summary,
          preview: result.preview,
          previewLinks: result.previewLinks ?? [],
          pagination: result.pagination,
          shopMappings: result.shopMappings,
          error: result.valid ? "" : `仍有店铺未确认：${pendingNames.join("、")}`,
        };
      } catch (error) {
        importState = { ...importState, loading: false, error: error.message || "店铺映射校验失败。" };
      }
      rerender();
    }
    if (action === "commit-product-v2-import") {
      if (importState.loading) return;
      const batchId = importState.batch?.id;
      const submittedShopMappings = importState.submittedShopMappings ?? {};
      if (!batchId) {
        importState = { ...importState, error: "导入批次状态已丢失，请返回导入记录后重新进入预览。" };
        rerender();
        return;
      }
      if (importState.batch?.status !== "validated") {
        importState = {
          ...importState,
          error: "当前批次尚未完成后台校验，请返回店铺确认并点击“确认店铺并生成预览”。",
        };
        rerender();
        return;
      }
      importState = { ...importState, loading: true, error: "", result: null };
      rerender();
      try {
        const result = await commitProductV2Import(batchId, { shopMappings: submittedShopMappings });
        importState = { ...importState, step: "complete", loading: false, result, syncRun: result.syncRun || importState.syncRun };
        unmatchedSkuState = { loading: false, loaded: false, rows: [], total: 0, query: "", error: "" };
        rerender();
        await Promise.all([
          refreshUnmatchedPlatformSkus(rerender),
          refreshProductSalesSummaries(rerender),
        ]);
      } catch (error) {
        importState = {
          ...importState,
          loading: false,
          error: `批次 ${batchId} 导入失败：${error.message || "ERP 数据确认导入失败。"}`,
        };
        rerender();
      }
    }
    if (action === "platform-preview-page") {
      await refreshPlatformPreview(rerender, { page: Number(button.dataset.page) || 1 });
    }
    if (action === "open-platform-product-link") { platformProductLinkState = { skuId: button.dataset.skuId, query: "", selectedProductId: "", error: "" }; rerender(); }
    if (action === "close-platform-product-link") { platformProductLinkState = { skuId: "", query: "", selectedProductId: "", error: "" }; rerender(); }
    if (action === "select-platform-product") { platformProductLinkState = { ...platformProductLinkState, selectedProductId: button.dataset.productId, error: "" }; rerender(); }
    if (action === "confirm-platform-product-link") {
      if (!platformProductLinkState.selectedProductId) { platformProductLinkState = { ...platformProductLinkState, error: "请先选择产品。" }; rerender(); return; }
      try { await bindPlatformSku(platformProductLinkState.skuId, platformProductLinkState.selectedProductId);
        platformProductLinkState = { skuId: "", query: "", selectedProductId: "", error: "" };
        await Promise.all([refreshUnmatchedPlatformSkus(rerender), refreshProductSalesSummaries(rerender)]); }
      catch (error) { platformProductLinkState = { ...platformProductLinkState, error: error.message || "产品关联失败。" }; rerender(); }
    }
    if (action === "mark-platform-combination") { await markPlatformSku(button.dataset.skuId, "combination"); await refreshUnmatchedPlatformSkus(rerender); }
    if (action === "ignore-platform-sku") { await markPlatformSku(button.dataset.skuId, "ignored"); await refreshUnmatchedPlatformSkus(rerender); }
    if (action === "view-product") {
      productSubmodule = "business-dashboard";
      window.location.hash = `products/${encodeURIComponent(button.dataset.productId)}`;
    }
    if (action === "back-products") {
      productSubmodule = getRouteErpSkuId() ? "sku-management" : "business-dashboard";
      window.location.hash = "products";
    }
    if (action === "archive-product") {
      const product = state.products.find((item) => item.id === button.dataset.productId);
      if (product && window.confirm(`确认归档 SKU ${product.skuCode}？历史关联不会删除。`)) {
        try {
          const updatedProduct = { ...product, status: "已归档", updatedAt: getNow() };
          await updatePersistentResource("products", product.id, updatedProduct);
          state.products = state.products.map((item) => item.id === product.id ? updatedProduct : item);
          rerender();
        }
        catch (error) { window.alert(error.message || "产品归档失败。"); }
      }
    }
  });
  document.querySelector("[data-product-marketing-form]")?.addEventListener("submit", (event) => { event.preventDefault(); void submitProductMarketing(event.currentTarget, rerender); });
  document.querySelector("#product-form")?.addEventListener("submit", (event) => { event.preventDefault(); saveProduct(event.currentTarget, rerender); });
  document.querySelector("#product-sku-change-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!skuChangeState || skuChangeState.loading) return;
    const form = event.currentTarget;
    const newSkuCode = form.elements.newSkuCode.value.trim();
    const reason = form.elements.reason.value.trim();
    skuChangeState = { ...skuChangeState, newSkuCode, reason, loading: true, error: "" };
    rerender();
    try {
      const impact = await previewProductSkuChange(skuChangeState.productId, {
        oldSkuCode: skuChangeState.oldSkuCode,
        newSkuCode,
      });
      skuChangeState = { ...skuChangeState, impact, loading: false };
    } catch (error) {
      skuChangeState = { ...skuChangeState, loading: false, error: error.message || "SKU修改影响检查失败。" };
    }
    rerender();
  });
  document.querySelector("#product-import-upload-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const file = form.elements.file.files[0];
    if (!file) return;
    const sourceSystem = form.elements.sourceSystem.value.trim() || "ERP";
    importState = { ...importState, loading: true, error: "" };
    rerender();
    try {
      const result = await parseProductImport(file, sourceSystem);
      importState = {
        step: "mapping",
        loading: false,
        error: "",
        batch: result.batch,
        preview: result.preview,
        fieldDefinitions: result.fieldDefinitions,
      };
    } catch (error) {
      importState = { step: "upload", loading: false, error: error.message || "ERP Excel 解析失败。" };
    }
    rerender();
  });
  document.querySelector("#erp-sync-create-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const businessDate = form.elements.businessDate.value;
    const syncType = form.elements.syncType.value;
    const dataSource = syncType === "master_data" ? form.elements.dataSource.value : "excel";
    const importMode = syncType === "master_data" ? form.elements.importMode.value : "";
    erpSyncState = { ...erpSyncState, loading: true, error: "" };
    if (importMode) erpSyncState.masterImportMode = importMode;
    rerender();
    try {
      const result = await createErpSyncRun(businessDate, syncType, dataSource);
      await refreshErpSyncState(result.syncRun.id);
    } catch (error) {
      erpSyncState = {
        ...erpSyncState,
        loading: false,
        active: error.syncRun ?? erpSyncState.active,
        error: error.message || "ERP每日同步创建失败。",
      };
    }
    rerender();
  });
  document.querySelector("#erp-sync-create-form [name='syncType']")?.addEventListener("change", (event) => {
    const modeField = document.querySelector("[data-master-import-mode]");
    if (modeField) modeField.hidden = event.currentTarget.value !== "master_data";
    const sourceField = document.querySelector("[data-master-data-source]");
    if (sourceField) sourceField.hidden = event.currentTarget.value !== "master_data";
  });
  document.querySelector("#wangdian-goods-query-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const syncRun = importState.syncRun;
    if (!syncRun?.id) return;
    const selectedImportMode = form.elements.importMode.value || "incremental";
    const toApiDateTime = (input) => input ? `${input.replace("T", " ")}:00` : "";
    const query = {
      startTime: toApiDateTime(form.elements.startTime.value),
      endTime: toApiDateTime(form.elements.endTime.value),
      importMode: selectedImportMode,
    };
    importState = { ...importState, loading: true, error: "" };
    rerender();
    try {
      const result = await previewWangdianGoods(syncRun.id, query);
      const validated = await validateProductV2Import(result.batch.id);
      importState = {
        version: "v2",
        step: "preview",
        loading: false,
        error: "",
        importType: "goods_info",
        importMode: selectedImportMode,
        syncRun: validated.syncRun || result.syncRun || syncRun,
        duplicate: result.duplicate,
        batch: validated.batch,
        valid: validated.valid,
        summary: validated.summary,
        preview: validated.preview,
      };
    } catch (error) {
      importState = { ...importState, step: "wangdian", loading: false, error: error.message || "旺店通货品读取失败。" };
    }
    rerender();
  });
  document.querySelector("#product-v2-import-upload-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const file = form.elements.file.files[0];
    if (!file) return;
    const importType = form.elements.importType.value;
    const importMode = importType === "goods_info" ? form.elements.importMode?.value || "incremental" : "";
    const syncRun = importState.syncRun;
    if (!syncRun?.id) {
      importState = { ...importState, loading: false, error: "请先创建或恢复ERP每日同步批次。" };
      rerender();
      return;
    }
    importState = { ...importState, loading: true, error: "", importType };
    rerender();
    try {
      const result = await parseProductV2Import(file, importType, syncRun.id, importMode);
      if (importType === "platform_goods") {
        importState = { version: "v2", step: "shops", loading: false, error: "", importType, syncRun: result.syncRun || syncRun, ...result };
      } else {
        const validated = await validateProductV2Import(result.batch.id);
        importState = {
          version: "v2", step: "preview", loading: false, error: "", importType,
          syncRun: validated.syncRun || result.syncRun || syncRun,
          duplicate: result.duplicate, batch: validated.batch, valid: validated.valid,
          summary: validated.summary, preview: validated.preview,
        };
      }
    } catch (error) {
      importState = { version: "v2", step: "upload", importType, syncRun, loading: false, error: error.message || "ERP 数据解析失败。" };
    }
    rerender();
  });
}
