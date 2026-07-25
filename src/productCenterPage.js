import {
  createId,
  createPersistentResource,
  commitProductImport,
  getCurrentUser,
  getNow,
  parseProductImport,
  resolveAssetUrl,
  state,
  updatePersistentResource,
  uploadImageFile,
  validateProductImportBatch,
} from "./appState.js?v=20260705-state-singleton1";
import { getProcessInstanceBusinessStatus, getProcessInstanceOwner } from "./data/processInstanceSelectors.js?v=20260722-progress-selectors1";
import { hasPermission } from "./permissions.js?v=20260725-product-center1";

const productStatuses = ["开发中", "待上架", "在售", "停售", "清仓", "已归档"];
let filters = { query: "", brand: "", category: "", status: "" };
let productViewMode = "list";
let modalState = null;
let importState = null;

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
          ${canCreate ? `<button class="secondary-button" type="button" data-action="open-product-import">导入ERP Excel</button><button class="primary-button" type="button" data-action="new-product">新增产品</button>` : ""}
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
      ${renderProductModal()}
      ${renderProductImportModal()}
    </section>
  `;
}

function renderProductImportRecords() {
  const batches = [...state.productImportBatches].sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")));
  if (batches.length === 0) return "";
  const statusLabels = { parsing: "解析中", parsed: "待校验", validated: "待确认", committed: "已导入", failed: "失败" };
  return `<section class="product-import-records">
    <div class="subsection-heading"><div><h2>导入记录</h2><p>保留每次 ERP 文件的映射、校验和提交结果</p></div></div>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>文件</th><th>来源</th><th>工作表</th><th>状态</th><th>总行数</th><th>新增</th><th>更新</th><th>导入时间</th></tr></thead>
      <tbody>${batches.map((batch) => `<tr><td>${escapeHtml(batch.fileName)}</td><td>${escapeHtml(batch.sourceSystem || "ERP")}</td><td>${escapeHtml(batch.sheetName || "-")}</td><td><span class="status-badge">${escapeHtml(statusLabels[batch.status] || batch.status)}</span></td><td>${batch.summary?.total ?? "-"}</td><td>${batch.summary?.create ?? "-"}</td><td>${batch.summary?.update ?? "-"}</td><td>${formatDateTime(batch.committedAt || batch.createdAt)}</td></tr>`).join("")}</tbody>
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

export function bindProductCenterPageEvents(rerender) {
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
}
