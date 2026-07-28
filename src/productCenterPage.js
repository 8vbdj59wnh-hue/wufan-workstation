import {
  createId,
  createPersistentResource,
  commitProductImport,
  commitProductV2Import,
  bindPlatformSku,
  getCurrentUser,
  getNow,
  loadProductSalesLinks,
  loadProductV2Import,
  loadUnmatchedPlatformSkus,
  parseProductImport,
  parseProductV2Import,
  resolveAssetUrl,
  state,
  updatePersistentResource,
  unbindPlatformSku,
  uploadImageFile,
  validateProductImportBatch,
  validateProductV2Import,
  markPlatformSku,
} from "./appState.js?v=20260705-state-singleton1";
import { getProcessInstanceBusinessStatus, getProcessInstanceOwner } from "./data/processInstanceSelectors.js?v=20260722-progress-selectors1";
import { hasPermission } from "./permissions.js?v=20260725-product-center1";

const productStatuses = ["开发中", "待上架", "在售", "停售", "清仓", "已归档"];
let filters = { query: "", brand: "", category: "", status: "" };
let productViewMode = "list";
let modalState = null;
let importState = null;
let productSalesState = { productId: "", loading: false, loaded: false, rows: [], error: "" };
let unmatchedSkuState = { loading: false, loaded: false, rows: [], total: 0, query: "", error: "" };
let platformPreviewRequestId = 0;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

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
    ? `<img class="${className}" src="${escapeHtml(resolveAssetUrl(product.mainImage))}" alt="${escapeHtml(product.name)}" />`
    : `<span class="${className} product-image-placeholder">无图</span>`;
}

function getRelatedActions(productId) {
  const actionIds = new Set(state.actionProducts.filter((item) => item.productId === productId).map((item) => item.actionId));
  return state.processInstances.filter((instance) => actionIds.has(instance.id));
}

function getFilteredProducts() {
  const query = filters.query.trim().toLowerCase();
  return state.products.filter((product) => {
    const matchesQuery = query === "" || `${product.name} ${product.skuCode}`.toLowerCase().includes(query);
    return matchesQuery && (!filters.brand || product.brand === filters.brand) &&
      (!filters.category || product.category === filters.category) && (!filters.status || product.status === filters.status);
  });
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

function renderProductCards(products) {
  if (products.length === 0) return `<div class="product-card-empty">暂无匹配产品</div>`;
  return `<div class="product-card-grid">
    ${products.map((product) => `
      <article class="product-archive-card" data-action="view-product" data-product-id="${escapeHtml(product.id)}" role="button" tabindex="0" aria-label="查看产品：${escapeHtml(product.name)}">
        <div class="product-archive-card-media">${renderImage(product, "product-card-image")}</div>
        <div class="product-archive-card-body">
          <div class="product-archive-card-heading">
            <h3 title="${escapeHtml(product.name)}">${escapeHtml(product.name)}</h3>
            <span class="status-badge">${escapeHtml(product.status)}</span>
          </div>
          <strong class="product-card-sku">${escapeHtml(product.skuCode)}</strong>
          <div class="product-archive-card-meta">
            <span>${escapeHtml(product.brand || "未设置品牌")}</span>
            <span>关联关键行动 ${getRelatedActions(product.id).length}</span>
          </div>
          ${renderProductActions(product)}
        </div>
      </article>
    `).join("")}
  </div>`;
}

function renderProductList() {
  const products = getFilteredProducts();
  const canCreate = hasPermission(getCurrentUser(), "products.create");
  return `
    <section class="product-center-page">
      <div class="section-heading with-actions">
        <div><h1>产品中心</h1><p>以 SKU 为单位维护唯一产品主数据</p></div>
        <div class="heading-actions">
          ${canCreate ? `<button class="secondary-button" type="button" data-action="open-product-v2-import">导入ERP数据</button><button class="primary-button" type="button" data-action="new-product">新增产品</button>` : ""}
        </div>
      </div>
      <form class="filter-bar product-filter-bar" data-product-filter-form>
        <input type="search" name="query" value="${escapeHtml(filters.query)}" placeholder="搜索产品名称或SKU" />
        <select name="brand">${renderFilterOptions(uniqueValues("brand"), filters.brand, "全部品牌")}</select>
        <select name="category">${renderFilterOptions(uniqueValues("category"), filters.category, "全部分类")}</select>
        <select name="status">${renderFilterOptions(productStatuses, filters.status, "全部状态")}</select>
        <button class="secondary-button" type="submit">筛选</button>
      </form>
      <div class="product-list-toolbar">
        <span>共 ${products.length} 个 SKU</span>
        <div class="product-view-switch" aria-label="产品展示方式">
          <button type="button" data-action="set-product-view" data-view-mode="list" class="${productViewMode === "list" ? "is-active" : ""}">列表</button>
          <button type="button" data-action="set-product-view" data-view-mode="card" class="${productViewMode === "card" ? "is-active" : ""}">卡片</button>
        </div>
      </div>
      ${productViewMode === "card" ? renderProductCards(products) : renderProductTable(products)}
      ${renderProductImportRecords()}
      ${renderUnmatchedPlatformSkus()}
      ${renderProductModal()}
      ${renderProductV2ImportModal()}
    </section>
  `;
}

function renderProductImportRecords() {
  const batches = [
    ...state.erpImportBatches.map((batch) => ({
      ...batch,
      fileName: batch.originalFilename,
      sourceSystem: batch.importType === "inventory" ? "库存明细" : "平台货品",
      summary: batch.summaryJson,
    })),
    ...state.productImportBatches,
  ].sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")));
  if (batches.length === 0) return "";
  const statusLabels = { parsing: "解析中", parsed: "待校验", validated: "待确认", committed: "已导入", failed: "失败" };
  return `<section class="product-import-records">
    <div class="subsection-heading"><div><h2>导入记录</h2><p>库存明细与平台货品分批记录，可追溯每次校验和提交结果</p></div></div>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>文件</th><th>来源</th><th>工作表</th><th>状态</th><th>总行数</th><th>新增</th><th>更新</th><th>导入时间</th><th>操作</th></tr></thead>
      <tbody>${batches.map((batch) => `<tr><td>${escapeHtml(batch.fileName)}</td><td>${escapeHtml(batch.sourceSystem || "ERP")}</td><td>${escapeHtml(batch.sheetName || "-")}</td><td><span class="status-badge">${escapeHtml(statusLabels[batch.status] || batch.status)}</span></td><td>${batch.summary?.total ?? "-"}</td><td>${batch.summary?.create ?? batch.summary?.created ?? "-"}</td><td>${batch.summary?.update ?? batch.summary?.updated ?? "-"}</td><td>${formatDateTime(batch.committedAt || batch.createdAt)}</td>
        <td>${batch.importType && batch.status !== "committed" ? `<button class="text-button" type="button" data-action="resume-product-v2-import" data-batch-id="${escapeHtml(batch.id)}">继续处理</button>` : "—"}</td></tr>`).join("")}</tbody>
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
        ${[...shop.links.values()].map((link) => `<details class="product-sales-link-card" open>
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
  const archive = getProductExecutionArchive(product.id);
  const actions = archive.actions;
  const statuses = actions.map((instance) => getProcessInstanceBusinessStatus(instance.id, state).status);
  return `
    <section class="product-center-page product-detail-page">
      <div class="section-heading with-actions">
        <div><button class="text-button" type="button" data-action="back-products">← 返回产品列表</button><h1>${escapeHtml(product.name)}</h1><p>${escapeHtml(product.skuCode)}</p></div>
        ${hasPermission(getCurrentUser(), "products.edit") ? `<button class="primary-button" type="button" data-action="edit-product" data-product-id="${product.id}">编辑产品</button>` : ""}
      </div>
      <div class="product-summary-stats"><div><span>累计关联</span><strong>${actions.length}</strong></div><div><span>执行中</span><strong>${statuses.filter((status) => status === "running").length}</strong></div><div><span>已完成</span><strong>${statuses.filter((status) => status === "done").length}</strong></div></div>
      <section class="product-detail-band"><h2>基础信息</h2><div class="product-detail-grid">
        <div class="product-detail-media">${renderImage(product, "product-detail-main-image")}</div>
        <div class="detail-grid">
          ${[["SKU编码", product.skuCode], ["产品名称", product.name], ["品牌", product.brand], ["产品分类", product.category], ["产品系列", product.series], ["材质", product.material], ["颜色", product.color], ["规格尺寸", product.specification], ["产品状态", product.status], ["产品负责人", findName(state.people, product.ownerId)], ["备注", product.remark]].map(([label, value]) => `<div class="detail-field"><span>${label}</span><strong>${escapeHtml(value || "-")}</strong></div>`).join("")}
        </div>
      </div>${Array.isArray(product.galleryImages) && product.galleryImages.length ? `<div class="product-gallery">${product.galleryImages.map((url) => `<img src="${escapeHtml(resolveAssetUrl(url))}" alt="产品图片" />`).join("")}</div>` : ""}
      ${renderProductSourceDetails(product)}</section>
      ${renderProductSalesLinks(product.id)}
      <section class="product-detail-band"><h2>关联关键行动</h2><div class="table-wrap"><table class="data-table"><thead><tr><th>关键行动名称</th><th>行动状态</th><th>负责部门</th><th>负责人</th><th>发起时间</th><th>截止时间</th></tr></thead><tbody>
        ${actions.length === 0 ? `<tr><td colspan="6" class="empty-cell">暂无关联关键行动</td></tr>` : actions.map((instance) => {
          const standard = state.taskTemplates.find((item) => item.id === instance.taskTemplateId);
          const owner = getProcessInstanceOwner(instance.id, state);
          return `<tr><td>${escapeHtml(instance.displayTitle || instance.name)}</td><td>${getProcessInstanceBusinessStatus(instance.id, state).label}</td><td>${escapeHtml(findName(state.departments, standard?.departmentId))}</td><td>${escapeHtml(findName(state.people, owner.userId))}</td><td>${formatDateTime(instance.createdAt)}</td><td>${formatDateTime(instance.dueDate)}</td></tr>`;
        }).join("")}
      </tbody></table></div></section>
      ${renderProductExecutionSummary(archive)}
      ${renderProductModal()}
    </section>
  `;
}

function renderProductModal() {
  if (modalState === null) return "";
  const product = modalState.id ? state.products.find((item) => item.id === modalState.id) : null;
  const item = product ?? { skuCode: "", name: "", mainImage: "", galleryImages: [], status: "开发中" };
  return `<div class="modal-backdrop"><section class="modal-panel product-modal"><header class="modal-header"><div><h2>${product ? "编辑产品" : "新增产品"}</h2><p>每个 SKU 仅维护一条产品记录</p></div><button class="icon-button" type="button" data-action="close-product-modal" aria-label="关闭">×</button></header>
    <form class="modal-body product-form" id="product-form"><div class="form-error" ${modalState.error ? "" : "hidden"}>${escapeHtml(modalState.error || "")}</div><div class="form-grid">
      <label><span>SKU编码 *</span><input name="skuCode" required value="${escapeHtml(item.skuCode)}" /></label><label><span>产品名称 *</span><input name="name" required value="${escapeHtml(item.name)}" /></label>
      ${[["brand", "品牌"], ["category", "产品分类"], ["series", "产品系列"], ["material", "材质"], ["color", "颜色"], ["specification", "规格尺寸"]].map(([name, label]) => `<label><span>${label}</span><input name="${name}" value="${escapeHtml(item[name] || "")}" /></label>`).join("")}
      <label><span>产品状态</span><select name="status">${productStatuses.filter((status) => status !== "已归档" || item.status === "已归档" || hasPermission(getCurrentUser(), "products.archive")).map((status) => `<option ${status === item.status ? "selected" : ""}>${status}</option>`).join("")}</select></label>
      <label><span>产品负责人</span><select name="ownerId"><option value="">未设置</option>${state.people.filter((person) => person.status !== "inactive").map((person) => `<option value="${person.id}" ${person.id === item.ownerId ? "selected" : ""}>${escapeHtml(person.name)}</option>`).join("")}</select></label>
      <label class="span-2"><span>产品主图</span>${item.mainImage ? `<img class="product-form-preview" src="${escapeHtml(resolveAssetUrl(item.mainImage))}" alt="当前主图" />` : ""}<input name="mainImageFile" type="file" accept="image/jpeg,image/png,image/webp" /><input name="existingMainImage" type="hidden" value="${escapeHtml(item.mainImage || "")}" /></label>
      <label class="span-2"><span>其他产品图片</span><input name="galleryImageFiles" type="file" accept="image/jpeg,image/png,image/webp" multiple /><input name="existingGalleryImages" type="hidden" value="${escapeHtml(JSON.stringify(item.galleryImages || []))}" /></label>
      <label class="span-2"><span>备注</span><textarea name="remark" rows="3">${escapeHtml(item.remark || "")}</textarea></label>
    </div></form><footer class="modal-footer"><button class="secondary-button" type="button" data-action="close-product-modal">取消</button><button class="primary-button" type="submit" form="product-form">保存</button></footer></section></div>`;
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
  return `<form id="product-v2-import-upload-form" class="product-import-upload-form">
    <label><span>导入类型 *</span><select name="importType" required>
      <option value="inventory">库存明细（ERP货品与规格）</option>
      <option value="platform_goods">平台货品（店铺、链接与平台SKU）</option>
    </select></label>
    <label class="product-import-file-field"><span>Excel 文件 *</span><input name="file" type="file" accept=".xls,.xlsx" required />
      <small>上传后先预览和校验，不会直接写入数据库。库存明细建议先于平台货品导入。</small></label>
    <div class="form-error" ${importState?.error ? "" : "hidden"}>${escapeHtml(importState?.error || "")}</div>
  </form>`;
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
  const isInventory = importState.importType === "inventory";
  if (!isInventory) return renderPlatformV2Preview();
  const columns = isInventory
    ? `<th>行号</th><th>货品编号</th><th>商家编码</th><th>ERP名称</th><th>系统产品</th><th>匹配状态</th><th>新增货品</th><th>更新字段</th><th>错误说明</th>`
    : `<th>行号</th><th>店铺</th><th>商品</th><th>平台SKU</th><th>系统产品</th><th>结果</th>`;
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
  return `<div class="product-import-complete"><strong>ERP 数据导入完成</strong>
    <p>新增 ${summary.created ?? 0}，更新 ${summary.updated ?? 0}，匹配 ${summary.matched ?? 0}，未匹配 ${summary.unmatched ?? 0}。</p>
  </div>`;
}

function renderProductV2ImportModal() {
  if (importState?.version !== "v2") return "";
  let body = renderProductV2Upload();
  if (importState.step === "shops") body = renderShopMapping();
  if (importState.step === "preview") body = renderProductV2Preview();
  if (importState.step === "complete") body = renderProductV2Complete();
  let footer = `<button class="secondary-button" type="button" data-action="close-product-import">取消</button><button class="primary-button" type="submit" form="product-v2-import-upload-form" ${importState.loading ? "disabled" : ""}>${importState.loading ? "正在解析…" : "上传并解析"}</button>`;
  if (importState.step === "shops") footer = `<button class="secondary-button" type="button" data-action="close-product-import">取消</button><button class="primary-button" type="button" data-action="confirm-shop-mappings" ${importState.loading ? "disabled" : ""}>确认店铺并生成预览</button>`;
  if (importState.step === "preview") footer = `<button class="secondary-button" type="button" data-action="close-product-import">取消</button><button class="primary-button" type="button" data-action="commit-product-v2-import" ${!importState.valid || importState.loading ? "disabled" : ""}>确认导入</button>`;
  if (importState.step === "complete") footer = `<button class="primary-button" type="button" data-action="close-product-import">完成</button>`;
  return `<div class="modal-backdrop"><section class="modal-panel product-import-modal"><header class="modal-header"><div><h2>导入 ERP 数据</h2><p>库存明细与平台货品分别校验、分别提交</p></div><button class="icon-button" type="button" data-action="close-product-import">×</button></header>
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
      skuCode: form.elements.skuCode.value.trim(), name: form.elements.name.value.trim(), mainImage, galleryImages,
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
  const shopMappings = importState.submittedShopMappings ?? {};
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
    const result = await validateProductV2Import(batchId, {
      shopMappings,
      previewFilters: filters,
      page: targetPage,
      pageSize: 30,
    });
    if (requestId !== platformPreviewRequestId) return;
    importState = {
      ...importState,
      step: "preview",
      loading: false,
      valid: result.valid,
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
  if (routeProductId && productSalesState.productId !== routeProductId && !productSalesState.loading) {
    void refreshProductSalesLinks(routeProductId, rerender);
  }
  if (!routeProductId && !unmatchedSkuState.loaded && !unmatchedSkuState.loading) {
    void refreshUnmatchedPlatformSkus(rerender);
  }
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
    filters = { query: form.elements.query.value, brand: form.elements.brand.value, category: form.elements.category.value, status: form.elements.status.value };
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
    if (action === "set-product-view") { productViewMode = button.dataset.viewMode === "card" ? "card" : "list"; rerender(); }
    if (action === "new-product") { modalState = { kind: "create", error: "" }; rerender(); }
    if (action === "open-product-import") { importState = { step: "upload", loading: false, error: "" }; rerender(); }
    if (action === "open-product-v2-import") { importState = { version: "v2", step: "upload", loading: false, error: "" }; rerender(); }
    if (action === "resume-product-v2-import") {
      importState = { version: "v2", step: "upload", loading: true, error: "" };
      rerender();
      try {
        const result = await loadProductV2Import(button.dataset.batchId);
        importState = {
          version: "v2",
          step: result.batch.importType === "platform_goods" ? "shops" : "preview",
          loading: false,
          error: "",
          importType: result.batch.importType,
          ...result,
        };
      } catch (error) {
        importState = { version: "v2", step: "upload", loading: false, error: error.message || "导入批次读取失败。" };
      }
      rerender();
    }
    if (action === "edit-product") { modalState = { kind: "edit", id: button.dataset.productId, error: "" }; rerender(); }
    if (action === "close-product-modal") { modalState = null; rerender(); }
    if (action === "close-product-import") { importState = null; rerender(); }
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
          valid: result.valid,
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
      importState = { ...importState, loading: true, error: "" };
      rerender();
      try {
        const result = await commitProductV2Import(importState.batch.id, { shopMappings: importState.submittedShopMappings ?? {} });
        unmatchedSkuState = { loading: false, loaded: false, rows: [], total: 0, query: "", error: "" };
        importState = { ...importState, step: "complete", loading: false, result };
      } catch (error) {
        importState = { ...importState, loading: false, error: error.message || "ERP 数据确认导入失败。" };
      }
      rerender();
    }
    if (action === "platform-preview-page") {
      await refreshPlatformPreview(rerender, { page: Number(button.dataset.page) || 1 });
    }
    if (action === "bind-platform-sku") {
      const input = document.querySelector(`[data-platform-bind-product="${CSS.escape(button.dataset.skuId)}"]`);
      const product = state.products.find((item) => `${item.skuCode} · ${item.name}` === input?.value.trim());
      if (product) await bindPlatformSku(button.dataset.skuId, product.id);
      await refreshUnmatchedPlatformSkus(rerender);
    }
    if (action === "unbind-platform-sku") {
      await unbindPlatformSku(button.dataset.skuId);
      await refreshProductSalesLinks(getRouteProductId(), rerender);
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
  document.querySelector("#product-v2-import-upload-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const file = form.elements.file.files[0];
    if (!file) return;
    const importType = form.elements.importType.value;
    importState = { ...importState, loading: true, error: "", importType };
    rerender();
    try {
      const result = await parseProductV2Import(file, importType);
      if (importType === "platform_goods") {
        importState = { version: "v2", step: "shops", loading: false, error: "", importType, ...result };
      } else {
        const validated = await validateProductV2Import(result.batch.id);
        importState = { version: "v2", step: "preview", loading: false, error: "", importType, duplicate: result.duplicate, batch: validated.batch, valid: validated.valid, summary: validated.summary, preview: validated.preview };
      }
    } catch (error) {
      importState = { version: "v2", step: "upload", loading: false, error: error.message || "ERP 数据解析失败。" };
    }
    rerender();
  });
}
