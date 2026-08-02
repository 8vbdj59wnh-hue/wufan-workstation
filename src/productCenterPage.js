import {
  createId,
  changeProductSku,
  createPersistentResource,
  createProductFromPendingErpSku,
  createProductsFromPendingErpSkus,
  commitProductImport,
  commitProductV2Import,
  createErpSyncRun,
  generateErpSyncSnapshot,
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
  unbindPlatformSku,
  uploadImageFile,
  validateProductImportBatch,
  validateProductV2Import,
  markPlatformSku,
} from "./services/productCenterService.js?v=20260802-module-boundary1";
import { getCurrentUser, state } from "./stores/appStore.js?v=20260802-module-boundary1";
import { getProcessInstanceBusinessStatus, getProcessInstanceOwner } from "./data/processInstanceSelectors.js?v=20260722-progress-selectors1";
import { hasPermission } from "./permissions.js?v=20260725-product-center1";
import { normalizeProductSkuCode } from "./data/productSku.js?v=20260728-product-sku1";
import { escapeHtml } from "./utils/html.js?v=20260802-module-boundary1";

const productStatuses = ["开发中", "待上架", "在售", "停售", "清仓", "已归档"];
let filters = { query: "", brand: "", category: "", status: "", erpStatus: "", platform: "", stockStatus: "" };
let productSort = "updated-desc";
let productViewMode = "card";
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
let productSubmodule = "products";
let pendingSkuState = { loading: false, loaded: false, rows: [], query: "", error: "", notice: "" };
let selectedPendingSkuIds = new Set();
let platformPreviewRequestId = 0;

function getRouteProductId() {
  const match = window.location.hash.replace(/^#/, "").match(/^products\/(.+)$/);
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
  return { erpByProduct, salesByProduct, actionIdsByProduct };
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
    return matchesQuery && (!filters.brand || product.brand === filters.brand) &&
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

function uniqueValues(key) {
  return [...new Set(state.products.map((product) => String(product[key] ?? "").trim()).filter(Boolean))].sort();
}

function renderFilterOptions(values, selected, emptyLabel) {
  return `<option value="">${emptyLabel}</option>${values.map((value) => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}`;
}

function renderProductActions(product) {
  return `<div class="table-actions">
    <button class="text-button" type="button" data-action="view-product" data-product-id="${product.id}">查看</button>
    ${hasPermission(getCurrentUser(), "products.edit") ? `<button class="text-button" type="button" data-action="edit-product" data-product-id="${product.id}">编辑</button>` : ""}
    ${product.status !== "已归档" && hasPermission(getCurrentUser(), "products.archive") ? `<button class="text-button danger-text" type="button" data-action="archive-product" data-product-id="${product.id}">归档</button>` : ""}
  </div>`;
}

function renderProductTable(products) {
  return `<div class="table-wrap">
    <table class="data-table product-table">
      <thead><tr><th>产品主图</th><th>SKU编码</th><th>产品名称</th><th>品牌</th><th>产品分类</th><th>产品状态</th><th>产品负责人</th><th>关联关键行动</th><th>更新时间</th><th>操作</th></tr></thead>
      <tbody>
        ${products.length === 0 ? `<tr><td colspan="10" class="empty-cell">暂无匹配产品</td></tr>` : products.map((product) => {
          const relatedCount = getRelatedActions(product.id).length;
          return `<tr>
            <td>${renderImage(product)}</td><td><strong>${escapeHtml(product.skuCode)}</strong></td><td>${escapeHtml(product.name)}</td>
            <td>${escapeHtml(product.brand || "-")}</td><td>${escapeHtml(product.category || "-")}</td><td><span class="status-badge">${escapeHtml(product.status)}</span></td>
            <td>${escapeHtml(findName(state.people, product.ownerId))}</td><td>${relatedCount}</td><td>${formatDateTime(product.updatedAt)}</td>
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
      return `
      <article class="product-archive-card" data-action="view-product" data-product-id="${escapeHtml(product.id)}" role="button" tabindex="0" aria-label="查看产品：${escapeHtml(product.name)}">
        <div class="product-archive-card-media">${renderImage(product, "product-card-image")}</div>
        <div class="product-archive-card-body">
          <div class="product-archive-card-heading">
            <h3 title="${escapeHtml(product.name)}">${escapeHtml(product.name)}</h3>
            <span class="status-badge">${escapeHtml(product.status)}</span>
          </div>
          <div class="product-card-identities">
            <span>SKU <strong>${escapeHtml(product.skuCode || "—")}</strong></span>
            <span>ERP <strong>${escapeHtml(erp.goods?.goodsCode || "—")}</strong></span>
          </div>
          <div class="product-card-metrics">
            <div><strong>${index.actionIdsByProduct.get(product.id)?.size ?? 0}</strong><span>关联行动</span></div>
            <div><strong>${formatMetric(erp.stock.sales30d)}</strong><span>近30天销量</span></div>
            <div><strong>${sales.loaded ? sales.platformCount : "—"}</strong><span>平台</span></div>
            <div><strong>${sales.loaded ? sales.shopCount : "—"}</strong><span>店铺</span></div>
            <div><strong>${sales.loaded ? sales.linkCount : "—"}</strong><span>链接</span></div>
          </div>
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

function renderProductList() {
  if (productSubmodule === "pending-skus") return renderPendingSkuPage();
  const index = buildProductUiIndex();
  const products = getSortedProducts(getFilteredProducts(index), index);
  const totalPages = Math.max(1, Math.ceil(products.length / productPageSize));
  productPage = Math.min(productPage, totalPages);
  const visibleProducts = products.slice((productPage - 1) * productPageSize, productPage * productPageSize);
  const canCreate = hasPermission(getCurrentUser(), "products.create");
  return `
    <section class="product-center-page">
      <div class="section-heading with-actions">
        <div><h1>产品中心</h1><p>以 SKU 为单位维护唯一产品主数据</p></div>
        <div class="heading-actions">
          ${canCreate ? `<button class="secondary-button" type="button" data-action="open-product-v2-import">导入ERP数据</button><button class="primary-button" type="button" data-action="new-product">新增产品</button>` : ""}
        </div>
      </div>
      ${renderProductSubmoduleTabs()}
      <form class="filter-bar product-filter-bar" data-product-filter-form>
        <input type="search" name="query" value="${escapeHtml(filters.query)}" placeholder="搜索产品名称或SKU" />
        <select name="brand">${renderFilterOptions(uniqueValues("brand"), filters.brand, "全部品牌")}</select>
        <select name="category">${renderFilterOptions(uniqueValues("category"), filters.category, "全部分类")}</select>
        <details class="product-more-filters" ${filters.status || filters.erpStatus || filters.platform || filters.stockStatus ? "open" : ""}>
          <summary>更多筛选</summary>
          <div>
            <select name="status">${renderFilterOptions(productStatuses, filters.status, "全部状态")}</select>
            <select name="erpStatus"><option value="">全部ERP状态</option><option value="linked" ${filters.erpStatus === "linked" ? "selected" : ""}>已关联ERP</option><option value="unlinked" ${filters.erpStatus === "unlinked" ? "selected" : ""}>未关联ERP</option></select>
            <select name="platform">${renderFilterOptions([...new Set((state.salesShops ?? []).map((item) => item.platform).filter(Boolean))].sort(), filters.platform, "全部销售平台")}</select>
            <select name="stockStatus"><option value="">全部库存</option><option value="available" ${filters.stockStatus === "available" ? "selected" : ""}>有库存</option><option value="low" ${filters.stockStatus === "low" ? "selected" : ""}>低库存</option><option value="empty" ${filters.stockStatus === "empty" ? "selected" : ""}>无库存</option></select>
          </div>
        </details>
        <button class="secondary-button" type="submit">筛选</button>
        <button class="text-button" type="button" data-action="clear-product-filters">清空</button>
      </form>
      <div class="product-list-toolbar">
        <span>共 ${products.length} 个 SKU</span>
        <div class="product-list-toolbar-actions">
          ${renderProductBusinessSort()}
          <div class="product-view-switch" aria-label="产品展示方式">
            <button type="button" data-action="set-product-view" data-view-mode="list" class="${productViewMode === "list" ? "is-active" : ""}">列表</button>
            <button type="button" data-action="set-product-view" data-view-mode="card" class="${productViewMode === "card" ? "is-active" : ""}">卡片</button>
          </div>
        </div>
      </div>
      ${productViewMode === "card" ? renderProductCards(visibleProducts, index) : renderProductTable(visibleProducts)}
      ${renderProductPagination(products.length, totalPages)}
      ${renderProductImportRecords()}
      ${renderUnmatchedPlatformSkus()}
      ${renderProductModal()}
      ${renderProductSkuChangeModal()}
      ${renderProductV2ImportModal()}
    </section>
  `;
}

function renderProductSubmoduleTabs() {
  return `<nav class="product-submodule-tabs" aria-label="产品中心子模块">
    <button type="button" data-action="product-submodule" data-submodule="products" class="${productSubmodule === "products" ? "is-active" : ""}">产品列表</button>
    <button type="button" data-action="product-submodule" data-submodule="pending-skus" class="${productSubmodule === "pending-skus" ? "is-active" : ""}">待建立SKU</button>
    <button type="button" data-action="open-product-v2-import">ERP同步</button>
  </nav>`;
}

function renderPendingSkuPage() {
  const canCreate = hasPermission(getCurrentUser(), "products.create");
  const selectedCount = selectedPendingSkuIds.size;
  const allSelected = pendingSkuState.rows.length > 0 && pendingSkuState.rows.every((item) => selectedPendingSkuIds.has(item.id));
  return `<section class="product-center-page">
    <div class="section-heading with-actions">
      <div><h1>产品中心</h1><p>识别ERP已发现、尚未建立产品档案的SKU</p></div>
    </div>
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
      rawUrl: row.rawUrl,
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
            ${link.rawUrl ? `<a class="text-button" href="${escapeHtml(link.rawUrl)}" target="_blank" rel="noopener noreferrer">打开链接</a>` : ""}
          </div>
          <div class="table-wrap"><table class="data-table"><thead><tr><th>平台SKU编码</th><th>规格名称</th><th>价格</th><th>平台库存</th><th>匹配方式</th><th>操作</th></tr></thead>
            <tbody>${link.skus.map((sku) => `<tr><td>${escapeHtml(sku.platformSkuCode || sku.platformSkuId || "—")}</td><td>${escapeHtml(sku.specificationName || "—")}</td>
              <td>${sku.price ?? "—"}</td><td>${sku.platformStock ?? "—"}</td>
              <td>${escapeHtml(sku.matchMethod === "manual" ? "人工绑定" : sku.matchMethod === "sku_code" ? "规格编码匹配" : sku.matchMethod === "goods_single_sku" ? "单规格货品匹配" : sku.matchStatus || "—")}</td>
              <td>${sku.matchStatus === "matched_manual" ? `<button class="text-button" type="button" data-action="unbind-platform-sku" data-sku-id="${escapeHtml(sku.id)}">取消人工绑定</button>` : "—"}</td></tr>`).join("")}</tbody>
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
          <td>${sku.rawUrl ? `<a class="text-button" href="${escapeHtml(sku.rawUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(sku.title || "打开链接")}</a>` : escapeHtml(sku.title || "-")}</td>
          <td>${escapeHtml(sku.platformGoodsCode || "-")}</td><td>${escapeHtml(sku.platformSkuCode || sku.platformSkuId || "-")}</td>
          <td>${escapeHtml(sku.specificationName || "-")}</td><td>${escapeHtml(sku.possibleErpGoodsCode ? `${sku.possibleErpGoodsCode} · ${sku.possibleErpGoodsName || ""}` : "—")}</td><td>${escapeHtml(sku.matchReason || sku.matchStatus || "-")}</td>
          <td><input list="platform-product-options" data-platform-bind-product="${escapeHtml(sku.id)}" placeholder="输入SKU或产品名" /></td>
          <td class="table-actions"><button class="text-button" type="button" data-action="bind-platform-sku" data-sku-id="${escapeHtml(sku.id)}">绑定</button>
            <button class="text-button" type="button" data-action="mark-platform-combination" data-sku-id="${escapeHtml(sku.id)}">组合装</button>
            <button class="text-button" type="button" data-action="ignore-platform-sku" data-sku-id="${escapeHtml(sku.id)}">忽略</button></td></tr>`;
      }).join("")}</tbody></table></div>
    <datalist id="platform-product-options">${state.products.map((product) => `<option value="${escapeHtml(product.skuCode)} · ${escapeHtml(product.name)}"></option>`).join("")}</datalist>
  </section>`;
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
      <button class="text-button product-detail-back" type="button" data-action="back-products">← 返回产品列表</button>
      <header class="product-detail-hero">
        <div class="product-detail-media">${renderImage(product, "product-detail-main-image")}</div>
        <div class="product-detail-identity">
          <div><span class="status-badge">${escapeHtml(product.status || "—")}</span><span>${escapeHtml(product.brand || "未设置品牌")}</span></div>
          <h1>${escapeHtml(product.name)}</h1>
          <p>SKU：${escapeHtml(product.skuCode || "—")}</p>
          <p>ERP：${escapeHtml(erp.goods?.goodsCode || "—")}</p>
          <p>${escapeHtml(product.category || "未设置分类")}</p>
        </div>
        ${hasPermission(getCurrentUser(), "products.edit") ? `<button class="primary-button" type="button" data-action="edit-product" data-product-id="${product.id}">编辑产品</button>` : ""}
      </header>
      <nav class="product-detail-tabs" aria-label="产品详情">
        ${[
          ["basic", "基本信息"],
          ["erp", "ERP与库存"],
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

function renderProductErpTab({ mapping, goods, stock }) {
  if (mapping === null) return `<div class="product-detail-empty"><strong>尚未关联 ERP 规格</strong><p>可通过“导入ERP数据”建立关联。</p></div>`;
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
      <label><span>SKU编码 *</span><input name="skuCode" required value="${escapeHtml(item.skuCode)}" ${product ? "readonly" : ""} />${product ? `<small>ERP关联关键字段，普通编辑不可修改。${hasPermission(getCurrentUser(), "products.archive") ? ` <button class="text-button" type="button" data-action="open-sku-change" data-product-id="${product.id}">使用SKU修改流程</button>` : ""}</small>` : ""}</label><label><span>产品名称 *</span><input name="name" required value="${escapeHtml(item.name)}" /></label>
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
        <div><span>人工平台绑定</span><strong>${impact.manualBindingCount}</strong></div>
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
          <option value="wangdian_api">旺店通API</option>
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
        ? `<button class="secondary-button" type="button" data-action="resume-product-v2-import" data-batch-id="${escapeHtml(batch.id)}">${completed ? "查看结果" : batch.status === "failed" ? "查看失败并重试" : "继续处理"}</button>`
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
      ${run.reconciliationStatus === "completed" && run.syncType === "master_data" ? `
      <div>
        <span>历史快照</span>
        <strong>不生成</strong>
      </div>
      <p class="form-note">主数据同步只维护ERP货品与SKU事实；历史经营快照由经营数据同步生成。</p>` : run.reconciliationStatus === "completed" ? `
      <div>
        <span>历史快照</span>
        <strong>${run.snapshotStatus === "completed" ? "已生成" : run.snapshotStatus === "failed" ? "生成失败" : "生成中"}</strong>
      </div>
      ${run.snapshotStatus === "completed"
        ? `<div class="erp-sync-snapshot-summary">
            <span>快照版本：V${run.version}</span>
            <span>产品：${run.snapshot?.productCount ?? "—"}</span>
            <span>ERP规格：${run.snapshot?.inventoryRowCount ?? "—"}</span>
            <span>链接：${run.snapshot?.salesLinkCount ?? "—"}</span>
            <span>平台SKU：${run.snapshot?.platformSkuCount ?? "—"}</span>
          </div>`
        : run.snapshotStatus === "failed"
          ? `<p class="form-error">三张表已导入完成，但历史快照生成失败：${escapeHtml(run.snapshotError || "未知错误")}</p>
            <button class="secondary-button" type="button" data-action="retry-erp-snapshot">重新生成快照</button>`
          : `<p class="form-note">缺失记录对账已完成，系统正在生成历史事实快照。</p>`}` : ""}
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
    const mappingLabels = { existing: "已关联产品", auto: "可自动关联产品", pending: "待人工关联产品", error: "错误行" };
    const goodsLabels = { new: "新增ERP货品", update: "更新ERP货品", unchanged: "无变化" };
    return `<div class="product-import-preview">
      <div class="import-summary-grid">
        ${[
          ["文件行数", summary.total], ["有效货品", summary.validGoods], ["新增ERP货品", summary.created],
          ["更新ERP货品", summary.updated], ["已有映射", summary.existingMappings],
          ["自动建立映射", summary.autoMappings], ["待人工关联", summary.pendingMappings],
          ["无变化", summary.unchanged], ["无效行", summary.invalid], ["错误", summary.error],
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
          <td>${row.errors?.length ? "失败" : "通过"}</td><td>${escapeHtml(row.errors?.join("；") || "—")}</td>
        </tr>`).join("")}
      </tbody></table></div>
      <p class="form-note">待人工关联不阻止ERP货品主档导入，也不会自动创建products；预览最多展示前 ${importState.preview?.length ?? 0} 行。</p>
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
    const linkKey = `${row.rawShopName}|${row.platformGoodsId || row.canonicalUrl}`;
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
  const productId = getRouteProductId();
  const product = state.products.find((item) => item.id === productId);
  return product ? renderProductDetail(product) : renderProductList();
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

export function bindProductCenterPageEvents(rerender) {
  const routeProductId = getRouteProductId();
  if (routeProductId && productDetailTab === "sales" && productSalesState.productId !== routeProductId && !productSalesState.loading) {
    void refreshProductSalesLinks(routeProductId, rerender);
  }
  if (!routeProductId && productSubmodule === "products" && !unmatchedSkuState.loaded && !unmatchedSkuState.loading) {
    void refreshUnmatchedPlatformSkus(rerender);
  }
  if (!routeProductId && productSubmodule === "products" && !productSalesSummaryState.loaded && !productSalesSummaryState.loading) {
    void refreshProductSalesSummaries(rerender);
  }
  if (!routeProductId && productSubmodule === "pending-skus" && !pendingSkuState.loaded && !pendingSkuState.loading) {
    void refreshPendingErpSkus(rerender);
  }
  document.querySelector("[data-pending-sku-search]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void refreshPendingErpSkus(rerender, event.currentTarget.elements.query.value.trim());
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
    if (action === "product-submodule") {
      productSubmodule = button.dataset.submodule === "pending-skus" ? "pending-skus" : "products";
      rerender();
    }
    if (action === "clear-pending-sku-search") {
      pendingSkuState = { ...pendingSkuState, query: "", loaded: false, error: "", notice: "" };
      rerender();
    }
    if (action === "create-product-from-pending-sku") {
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
    if (action === "new-product") { modalState = { kind: "create", error: "" }; rerender(); }
    if (action === "open-product-import") {
      importState = { version: "v2", step: "upload", importType: "goods_info", loading: false, error: "" };
      rerender();
    }
    if (action === "open-product-v2-import") {
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
    if (action === "back-to-erp-sync") {
      const syncRunId = importState.syncRun?.id || importState.result?.syncRun?.id || importState.batch?.syncRunId;
      await refreshErpSyncState(syncRunId);
      importState = { version: "v2", step: "sync", loading: false, error: "" };
      rerender();
    }
    if (action === "retry-erp-snapshot") {
      erpSyncState = { ...erpSyncState, loading: true, error: "" };
      rerender();
      try {
        const result = await generateErpSyncSnapshot(erpSyncState.active.id);
        erpSyncState = { ...erpSyncState, loading: false, active: result.syncRun, error: "" };
      } catch (error) {
        erpSyncState = { ...erpSyncState, loading: false, error: error.message || "ERP历史快照生成失败。" };
      }
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
    if (action === "bind-platform-sku") {
      const input = document.querySelector(`[data-platform-bind-product="${CSS.escape(button.dataset.skuId)}"]`);
      const product = state.products.find((item) => `${item.skuCode} · ${item.name}` === input?.value.trim());
      if (product) await bindPlatformSku(button.dataset.skuId, product.id);
      await Promise.all([
        refreshUnmatchedPlatformSkus(rerender),
        refreshProductSalesSummaries(rerender),
      ]);
    }
    if (action === "unbind-platform-sku") {
      await unbindPlatformSku(button.dataset.skuId);
      await Promise.all([
        refreshProductSalesLinks(getRouteProductId(), rerender),
        refreshProductSalesSummaries(rerender),
      ]);
    }
    if (action === "mark-platform-combination") { await markPlatformSku(button.dataset.skuId, "combination"); await refreshUnmatchedPlatformSkus(rerender); }
    if (action === "ignore-platform-sku") { await markPlatformSku(button.dataset.skuId, "ignored"); await refreshUnmatchedPlatformSkus(rerender); }
    if (action === "view-product") window.location.hash = `products/${encodeURIComponent(button.dataset.productId)}`;
    if (action === "back-products") window.location.hash = "products";
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
