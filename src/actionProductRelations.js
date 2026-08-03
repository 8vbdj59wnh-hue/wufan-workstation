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

export function getActionDisplayImages(actionId, fallbackImages = []) {
  const products = getActionProducts(actionId);
  if (products.length > 0) {
    return {
      images: products.slice(0, 9).map((product) => String(product.mainImage ?? "").trim()),
      linkedProducts: products,
      usesLinkedProducts: true,
    };
  }
  return {
    images: Array.isArray(fallbackImages) ? fallbackImages : [],
    linkedProducts: [],
    usesLinkedProducts: false,
  };
}

function renderProductThumb(product) {
  return product.mainImage
    ? `<img src="${escapeHtml(resolveAssetUrl(product.mainImage))}" alt="${escapeHtml(product.name)}" />`
    : `<span class="product-image-placeholder">无图</span>`;
}

function relationSkuCodes(productId) {
  return (state.productErpMappings ?? []).filter((item) => item.productId === productId)
    .flatMap((item) => [item.merchantSkuCode, item.barcode]).filter(Boolean);
}

function normalizeCode(value) { return String(value ?? "").trim().toLowerCase(); }

function relationCreatedAt(actionId, productId) {
  return state.actionProducts.find((item) => item.actionId === actionId && item.productId === productId)?.createdAt ?? "";
}

function formatRelationTime(value) {
  if (!value) return "本次新增，保存后生效";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-CN", { hour12: false });
}

function renderSelectedProducts(products, actionId = "") {
  if (products.length === 0) return `<p class="form-note">尚未选择关联产品</p>`;
  return products
    .map(
      (product) => `
        <div class="action-product-selected-item">
          ${renderProductThumb(product)}
          <span><strong>${escapeHtml(product.name)}</strong><small>产品编码：${escapeHtml(product.skuCode)}</small><small>SKU：${escapeHtml(relationSkuCodes(product.id).join("、") || product.skuCode)}</small><small>关联时间：${escapeHtml(formatRelationTime(relationCreatedAt(actionId, product.id)))}</small></span>
          <button class="icon-button" type="button" data-action="remove-action-product" data-product-id="${escapeHtml(product.id)}" aria-label="移除${escapeHtml(product.name)}">×</button>
        </div>
      `,
    )
    .join("");
}

export function renderActionProductSelector(selectedIds = [], { label = "关联产品", actionId = "" } = {}) {
  const selected = new Set(selectedIds);
  const selectedProducts = state.products.filter((product) => selected.has(product.id));
  const products = state.products.filter((product) => product.status !== "已归档" || selected.has(product.id))
    .sort((left, right) => String(left.skuCode ?? "").localeCompare(String(right.skuCode ?? ""), "zh-CN", { numeric: true }));
  return `
    <div class="action-product-selector" data-action-product-selector data-action-id="${escapeHtml(actionId)}">
      <span class="field-label">${escapeHtml(label)}</span>
      <div class="action-product-selected" data-action-product-selected>${renderSelectedProducts(selectedProducts, actionId)}</div>
      <div class="action-product-quick-link">
        <strong>手动关联</strong>
        <div class="action-product-search-row"><input class="action-product-search" type="search" placeholder="输入完整产品编码" data-action-product-quick-code autocomplete="off" /><button class="primary-button" type="button" data-action="quick-link-action-product">关联</button></div>
        <p class="form-note" data-action-product-quick-message>输入准确产品编码后直接关联，可连续添加多个产品。</p>
      </div>
      <details class="action-product-search-section" data-action-product-search-details>
        <summary>搜索关联</summary>
        <div class="action-product-search-content">
          <input class="action-product-search" type="search" placeholder="搜索产品编码、SKU编码或产品名称" data-action-product-search autocomplete="off" />
          <p class="form-note" data-action-product-search-message>输入关键词查看匹配产品。</p>
          <div class="action-product-confirm" data-action-product-confirm hidden></div>
          <div class="action-product-options" data-action-product-options>
            ${products.length === 0 ? `<p class="form-note">产品中心暂无可选产品</p>` : products.map((product) => `
              <article class="action-product-option" data-product-id="${escapeHtml(product.id)}" data-product-code="${escapeHtml(normalizeCode(product.skuCode))}" data-search="${escapeHtml(`${product.skuCode} ${product.name} ${relationSkuCodes(product.id).join(" ")}`.toLowerCase())}" hidden>
                <input type="checkbox" name="actionProductId" value="${escapeHtml(product.id)}" ${selected.has(product.id) ? "checked" : ""} hidden />
                ${renderProductThumb(product)}
                <span><strong>${escapeHtml(product.name)}</strong><small>产品编码：${escapeHtml(product.skuCode)}</small><small>SKU：${escapeHtml(relationSkuCodes(product.id).join("、") || product.skuCode)}</small></span>
                <button class="text-button" type="button" data-action="choose-action-product" data-product-id="${escapeHtml(product.id)}">${selected.has(product.id) ? "已关联" : "选择"}</button>
              </article>
            `).join("")}
          </div>
        </div>
      </details>
    </div>
  `;
}

function refreshSelected(selector) {
  const selectedIds = collectActionProductIds(selector);
  const selectedProducts = state.products.filter((product) => selectedIds.includes(product.id));
  const host = selector.querySelector("[data-action-product-selected]");
  if (host !== null) host.innerHTML = renderSelectedProducts(selectedProducts, selector.dataset.actionId);
  selector.querySelectorAll(".action-product-option").forEach((option) => {
    const checked = option.querySelector('[name="actionProductId"]')?.checked === true;
    const button = option.querySelector('[data-action="choose-action-product"]');
    if (button) button.textContent = checked ? "已关联" : "选择";
  });
}

function renderProductConfirmation(product, isSelected = false) {
  return `${renderProductThumb(product)}<span><strong>${escapeHtml(product.name)}</strong><small>产品编码：${escapeHtml(product.skuCode)}</small><small>SKU：${escapeHtml(relationSkuCodes(product.id).join("、") || product.skuCode)}</small></span><button class="primary-button" type="button" data-action="confirm-action-product" data-product-id="${escapeHtml(product.id)}" ${isSelected ? "disabled" : ""}>${isSelected ? "已关联" : "确认关联"}</button>`;
}

function filterProductOptions(selector, query) {
  const normalized = normalizeCode(query); const options = [...selector.querySelectorAll(".action-product-option")];
  const matches = options.filter((option) => normalized && option.dataset.search.includes(normalized));
  matches.sort((left, right) => Number(right.dataset.productCode === normalized) - Number(left.dataset.productCode === normalized));
  options.forEach((option) => { option.hidden = !matches.includes(option); });
  const host = selector.querySelector("[data-action-product-options]"); matches.forEach((option) => host?.append(option));
  return matches;
}

export function bindActionProductSelectors(root = document) {
  root.querySelectorAll("[data-action-product-selector]").forEach((selector) => {
    selector.addEventListener("input", (event) => {
      if (!event.target.matches("[data-action-product-search]")) return;
      const matches = filterProductOptions(selector, event.target.value);
      const message = selector.querySelector("[data-action-product-search-message]");
      if (message) message.textContent = event.target.value.trim() ? `找到 ${matches.length} 个匹配产品` : "输入关键词查看匹配产品。";
    });
    selector.addEventListener("keydown", (event) => {
      if (!event.target.matches("[data-action-product-quick-code]") || event.key !== "Enter") return;
      event.preventDefault();
      selector.querySelector('[data-action="quick-link-action-product"]')?.click();
    });
    selector.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (action === "quick-link-action-product") {
        const query = selector.querySelector("[data-action-product-quick-code]")?.value.trim() ?? "";
        const matches = [...selector.querySelectorAll(".action-product-option")]
          .filter((option) => option.dataset.productCode === normalizeCode(query));
        selector.querySelectorAll(".action-product-option").forEach((option) => { option.hidden = !matches.includes(option); });
        const message = selector.querySelector("[data-action-product-quick-message]");
        if (!query || !matches.length) {
          if (message) message.textContent = !query ? "请输入产品编码。" : "未找到对应产品。";
          return;
        }
        if (matches.length > 1) {
          const details = selector.querySelector("[data-action-product-search-details]");
          if (details) details.open = true;
          const searchMessage = selector.querySelector("[data-action-product-search-message]");
          if (searchMessage) searchMessage.textContent = `存在 ${matches.length} 个同编码产品，请选择。`;
          if (message) message.textContent = "存在多个匹配产品，已进入搜索选择模式。";
          return;
        }
        const input = matches[0].querySelector('[name="actionProductId"]');
        if (input?.checked) {
          if (message) message.textContent = "该产品已关联。";
          return;
        }
        if (input) input.checked = true;
        const quickInput = selector.querySelector("[data-action-product-quick-code]");
        if (quickInput) quickInput.value = "";
        if (message) message.textContent = "关联成功，可继续输入下一个产品编码。";
        refreshSelected(selector);
        return;
      }
      if (action === "choose-action-product") {
        const option = event.target.closest(".action-product-option");
        const product = state.products.find((item) => item.id === option?.dataset.productId);
        const confirm = selector.querySelector("[data-action-product-confirm]");
        if (confirm && product) {
          confirm.innerHTML = renderProductConfirmation(product, option?.querySelector('[name="actionProductId"]')?.checked === true);
          confirm.hidden = false;
        }
        return;
      }
      if (action === "confirm-action-product") {
        const productId = event.target.closest("[data-product-id]")?.dataset.productId ?? "";
        const input = selector.querySelector(`[name="actionProductId"][value="${CSS.escape(productId)}"]`);
        const message = selector.querySelector("[data-action-product-quick-message]");
        if (input?.checked) {
          if (message) message.textContent = "该产品已经关联，无需重复添加。";
          return;
        }
        if (input) input.checked = true;
        const confirm = selector.querySelector("[data-action-product-confirm]");
        if (confirm) confirm.hidden = true;
        const quickInput = selector.querySelector("[data-action-product-quick-code]");
        if (quickInput) quickInput.value = "";
        const searchInput = selector.querySelector("[data-action-product-search]");
        if (searchInput) searchInput.value = "";
        filterProductOptions(selector, "");
        if (message) message.textContent = "已添加关联产品，可继续输入下一个产品编码。";
        refreshSelected(selector);
        return;
      }
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
          <span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.skuCode)}</small>${compact ? "" : `<small>关联时间：${escapeHtml(formatRelationTime(relationCreatedAt(actionId, product.id)))}</small>`}</span>
        </a>
      `).join("")}
    </div>
  `;
}
