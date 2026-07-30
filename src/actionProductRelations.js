import { resolveAssetUrl, state } from "./appState.js?v=20260705-state-singleton1";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

let indexedActionProducts = null;
let indexedProducts = null;
let indexedActionProductCount = -1;
let indexedProductCount = -1;
let productIdsByActionId = new Map();
let productsById = new Map();

function ensureProductRelationIndexes() {
  if (indexedActionProducts !== state.actionProducts || indexedActionProductCount !== state.actionProducts.length) {
    indexedActionProducts = state.actionProducts;
    indexedActionProductCount = state.actionProducts.length;
    productIdsByActionId = new Map();
    [...state.actionProducts]
      .sort(
        (left, right) =>
          String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")) ||
          String(left.id ?? "").localeCompare(String(right.id ?? "")),
      )
      .forEach((item) => {
        const productIds = productIdsByActionId.get(item.actionId) ?? [];
        productIds.push(item.productId);
        productIdsByActionId.set(item.actionId, productIds);
      });
  }
  if (indexedProducts !== state.products || indexedProductCount !== state.products.length) {
    indexedProducts = state.products;
    indexedProductCount = state.products.length;
    productsById = new Map(state.products.map((product) => [product.id, product]));
  }
}

export function getActionProductIds(actionId) {
  ensureProductRelationIndexes();
  return [...(productIdsByActionId.get(actionId) ?? [])];
}

export function getActionProducts(actionId) {
  ensureProductRelationIndexes();
  return getActionProductIds(actionId).map((productId) => productsById.get(productId)).filter(Boolean);
}

export function getPrimaryActionProduct(actionId) {
  return getActionProducts(actionId)[0] ?? null;
}

export function getActionProductImageUrls(actionId) {
  return getActionProducts(actionId).map((product) => product.mainImage).filter(Boolean);
}

function renderProductThumb(product) {
  return product.mainImage
    ? `<img src="${escapeHtml(resolveAssetUrl(product.mainImage))}" alt="${escapeHtml(product.name)}" />`
    : `<span class="product-image-placeholder">无图</span>`;
}

function renderSelectedProducts(products) {
  if (products.length === 0) return `<p class="form-note">尚未选择关联产品</p>`;
  return products
    .map(
      (product) => `
        <div class="action-product-selected-item">
          ${renderProductThumb(product)}
          <span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.skuCode)}</small></span>
          <button class="icon-button" type="button" data-action="remove-action-product" data-product-id="${escapeHtml(product.id)}" aria-label="移除${escapeHtml(product.name)}">×</button>
        </div>
      `,
    )
    .join("");
}

export function renderActionProductSelector(selectedIds = [], { label = "关联产品" } = {}) {
  const selected = new Set(selectedIds);
  const selectedProducts = state.products.filter((product) => selected.has(product.id));
  const products = state.products.filter((product) => product.status !== "已归档" || selected.has(product.id));
  return `
    <div class="action-product-selector" data-action-product-selector>
      <span class="field-label">${escapeHtml(label)}</span>
      <div class="action-product-selected" data-action-product-selected>${renderSelectedProducts(selectedProducts)}</div>
      <input class="action-product-search" type="search" placeholder="输入SKU编码或产品名称搜索" data-action-product-search autocomplete="off" />
      <div class="action-product-options" data-action-product-options>
        ${products.length === 0 ? `<p class="form-note">产品中心暂无可选产品</p>` : products.map((product) => `
          <label class="action-product-option" data-search="${escapeHtml(`${product.skuCode} ${product.name}`.toLowerCase())}">
            <input type="checkbox" name="actionProductId" value="${escapeHtml(product.id)}" ${selected.has(product.id) ? "checked" : ""} />
            ${renderProductThumb(product)}
            <span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.skuCode)}</small></span>
          </label>
        `).join("")}
      </div>
    </div>
  `;
}

function refreshSelected(selector) {
  const selectedIds = collectActionProductIds(selector);
  const selectedProducts = state.products.filter((product) => selectedIds.includes(product.id));
  const host = selector.querySelector("[data-action-product-selected]");
  if (host !== null) host.innerHTML = renderSelectedProducts(selectedProducts);
}

export function bindActionProductSelectors(root = document) {
  root.querySelectorAll("[data-action-product-selector]").forEach((selector) => {
    selector.addEventListener("input", (event) => {
      if (!event.target.matches("[data-action-product-search]")) return;
      const query = event.target.value.trim().toLowerCase();
      selector.querySelectorAll(".action-product-option").forEach((option) => {
        option.hidden = query !== "" && !option.dataset.search.includes(query);
      });
    });
    selector.addEventListener("change", (event) => {
      if (event.target.name === "actionProductId") refreshSelected(selector);
    });
    selector.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action='remove-action-product']");
      if (button === null) return;
      const input = selector.querySelector(`[name="actionProductId"][value="${CSS.escape(button.dataset.productId)}"]`);
      if (input !== null) input.checked = false;
      refreshSelected(selector);
    });
  });
}

export function collectActionProductIds(root) {
  return [...root.querySelectorAll('[name="actionProductId"]:checked')].map((input) => input.value);
}

export function renderLinkedActionProducts(actionId, { compact = false } = {}) {
  const products = getActionProducts(actionId);
  if (products.length === 0) return `<p class="form-note">未关联产品</p>`;
  return `
    <div class="linked-action-products ${compact ? "is-compact" : ""}">
      ${products.map((product) => `
        <a class="linked-action-product" href="#products/${encodeURIComponent(product.id)}">
          ${renderProductThumb(product)}
          <span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.skuCode)}</small></span>
        </a>
      `).join("")}
    </div>
  `;
}
