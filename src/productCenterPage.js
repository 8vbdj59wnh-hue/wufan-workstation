import {
  createId,
  createPersistentResource,
  getCurrentUser,
  getNow,
  resolveAssetUrl,
  state,
  updatePersistentResource,
  uploadImageFile,
} from "./appState.js?v=20260705-state-singleton1";
import { getProcessInstanceBusinessStatus, getProcessInstanceOwner } from "./data/processInstanceSelectors.js?v=20260722-progress-selectors1";
import { hasPermission } from "./permissions.js?v=20260725-product-center1";

const productStatuses = ["开发中", "待上架", "在售", "停售", "清仓", "已归档"];
let filters = { query: "", brand: "", category: "", status: "" };
let modalState = null;

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

function renderProductList() {
  const products = getFilteredProducts();
  const canCreate = hasPermission(getCurrentUser(), "products.create");
  return `
    <section class="product-center-page">
      <div class="section-heading with-actions">
        <div><h1>产品中心</h1><p>以 SKU 为单位维护唯一产品主数据</p></div>
        ${canCreate ? `<button class="primary-button" type="button" data-action="new-product">新增产品</button>` : ""}
      </div>
      <form class="filter-bar product-filter-bar" data-product-filter-form>
        <input type="search" name="query" value="${escapeHtml(filters.query)}" placeholder="搜索产品名称或SKU" />
        <select name="brand">${renderFilterOptions(uniqueValues("brand"), filters.brand, "全部品牌")}</select>
        <select name="category">${renderFilterOptions(uniqueValues("category"), filters.category, "全部分类")}</select>
        <select name="status">${renderFilterOptions(productStatuses, filters.status, "全部状态")}</select>
        <button class="secondary-button" type="submit">筛选</button>
      </form>
      <div class="table-wrap">
        <table class="data-table product-table">
          <thead><tr><th>产品主图</th><th>SKU编码</th><th>产品名称</th><th>品牌</th><th>产品分类</th><th>产品状态</th><th>产品负责人</th><th>关联关键行动</th><th>更新时间</th><th>操作</th></tr></thead>
          <tbody>
            ${products.length === 0 ? `<tr><td colspan="10" class="empty-cell">暂无匹配产品</td></tr>` : products.map((product) => {
              const relatedCount = getRelatedActions(product.id).length;
              return `<tr>
                <td>${renderImage(product)}</td><td><strong>${escapeHtml(product.skuCode)}</strong></td><td>${escapeHtml(product.name)}</td>
                <td>${escapeHtml(product.brand || "-")}</td><td>${escapeHtml(product.category || "-")}</td><td><span class="status-badge">${escapeHtml(product.status)}</span></td>
                <td>${escapeHtml(findName(state.people, product.ownerId))}</td><td>${relatedCount}</td><td>${formatDateTime(product.updatedAt)}</td>
                <td><div class="table-actions"><button class="text-button" type="button" data-action="view-product" data-product-id="${product.id}">查看</button>${hasPermission(getCurrentUser(), "products.edit") ? `<button class="text-button" type="button" data-action="edit-product" data-product-id="${product.id}">编辑</button>` : ""}${product.status !== "已归档" && hasPermission(getCurrentUser(), "products.archive") ? `<button class="text-button danger-text" type="button" data-action="archive-product" data-product-id="${product.id}">归档</button>` : ""}</div></td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
      ${renderProductModal()}
    </section>
  `;
}

function renderProductDetail(product) {
  const actions = getRelatedActions(product.id);
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
      </div>${Array.isArray(product.galleryImages) && product.galleryImages.length ? `<div class="product-gallery">${product.galleryImages.map((url) => `<img src="${escapeHtml(resolveAssetUrl(url))}" alt="产品图片" />`).join("")}</div>` : ""}</section>
      <section class="product-detail-band"><h2>关联关键行动</h2><div class="table-wrap"><table class="data-table"><thead><tr><th>关键行动名称</th><th>行动状态</th><th>负责部门</th><th>负责人</th><th>发起时间</th><th>截止时间</th></tr></thead><tbody>
        ${actions.length === 0 ? `<tr><td colspan="6" class="empty-cell">暂无关联关键行动</td></tr>` : actions.map((instance) => {
          const standard = state.taskTemplates.find((item) => item.id === instance.taskTemplateId);
          const owner = getProcessInstanceOwner(instance.id, state);
          return `<tr><td>${escapeHtml(instance.displayTitle || instance.name)}</td><td>${getProcessInstanceBusinessStatus(instance.id, state).label}</td><td>${escapeHtml(findName(state.departments, standard?.departmentId))}</td><td>${escapeHtml(findName(state.people, owner.userId))}</td><td>${formatDateTime(instance.createdAt)}</td><td>${formatDateTime(instance.dueDate)}</td></tr>`;
        }).join("")}
      </tbody></table></div></section>
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
  document.querySelector(".product-center-page")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (button === null) return;
    const action = button.dataset.action;
    if (action === "new-product") { modalState = { kind: "create", error: "" }; rerender(); }
    if (action === "edit-product") { modalState = { kind: "edit", id: button.dataset.productId, error: "" }; rerender(); }
    if (action === "close-product-modal") { modalState = null; rerender(); }
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
}
