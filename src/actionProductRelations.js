import { loadActionProductOptions, resolveAssetUrl, state } from "./appState.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const selectorTimers = new WeakMap();
let indexedActionProducts = null;
let indexedActionProductCount = -1;
let indexedTaskProductContexts = null;
let indexedTaskProductContextCount = -1;
let indexedTaskProductContextSignature = "";
let productIdsByActionId = new Map();
let taskProductsByContextId = new Map();

function identityOf(product) {
  return String(product?.erpSkuId || product?.id || product?.productId || "").trim();
}

function optionStatusLabel(product) {
  const status = String(product?.status || product?.businessStatus || "").trim();
  if (status === "unmaintained") return "经营资料未维护";
  if (status === "active") return "经营中";
  if (status === "paused") return "暂停经营";
  if (status === "clearance") return "清仓";
  if (status === "archived") return "归档";
  return status || (product?.erpSkuId ? "经营资料未维护" : "Legacy 兼容关联");
}

function normalizeLegacyProduct(product) {
  const mapping = (state.productErpMappings ?? []).find((item) => item.productId === product.id && item.currentState === "active");
  return {
    ...product,
    legacyProductId: product.id,
    erpSkuId: mapping?.erpSkuId || "",
    erpSkuCode: mapping?.merchantSkuCode || product.skuCode || "",
    hasBusinessProfile: Boolean(mapping?.erpSkuId),
  };
}

function normalizeTaskContext(context) {
  const erpSkuId = context.erpSkuId || "";
  const legacyProductId = context.productId || "";
  return {
    id: erpSkuId || legacyProductId,
    erpSkuId,
    legacyProductId,
    name: context.productName || context.erpSkuName || context.erpGoodsName || context.erpSkuCode || "ERP SKU",
    skuCode: context.erpSkuCode || context.productSkuCode || "",
    erpSkuCode: context.erpSkuCode || "",
    mainImage: context.erpSkuImage || context.productImage || "",
    productImage: context.productImage || "",
    erpSkuImage: context.erpSkuImage || "",
    status: context.businessStatus || (context.businessProfileId ? "active" : (erpSkuId ? "unmaintained" : context.productStatus || "")),
    hasBusinessProfile: Boolean(context.businessProfileId),
  };
}

function ensureProductRelationIndexes() {
  if (indexedActionProducts !== state.actionProducts || indexedActionProductCount !== state.actionProducts.length) {
    indexedActionProducts = state.actionProducts;
    indexedActionProductCount = state.actionProducts.length;
    productIdsByActionId = new Map();
    [...state.actionProducts]
      .sort((left, right) => String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")) || String(left.id ?? "").localeCompare(String(right.id ?? "")))
      .forEach((item) => {
        const identities = productIdsByActionId.get(item.actionId) ?? [];
        const identity = String(item.erpSkuId || item.productId || "").trim();
        if (identity) identities.push(identity);
        productIdsByActionId.set(item.actionId, identities);
      });
  }
  const signature = (state.taskProductContexts ?? [])
    .map((item) => [item.contextId, item.productId, item.erpSkuId, item.productImage, item.erpSkuImage, item.businessProfileId].join("|"))
    .join("\n");
  if (indexedTaskProductContexts !== state.taskProductContexts || indexedTaskProductContextCount !== state.taskProductContexts.length || indexedTaskProductContextSignature !== signature) {
    indexedTaskProductContexts = state.taskProductContexts;
    indexedTaskProductContextCount = state.taskProductContexts.length;
    indexedTaskProductContextSignature = signature;
    taskProductsByContextId = new Map();
    for (const context of state.taskProductContexts ?? []) {
      const rows = taskProductsByContextId.get(context.contextId) ?? [];
      rows.push(normalizeTaskContext(context));
      taskProductsByContextId.set(context.contextId, rows);
    }
  }
}

function allKnownProducts() {
  const options = state.actionProductOptions ?? [];
  const contexts = [...taskProductsByContextId.values()].flat();
  const legacy = (state.products ?? []).map(normalizeLegacyProduct);
  return [...new Map([...legacy, ...contexts, ...options].map((product) => [identityOf(product), product])).values()];
}

function findKnownProduct(identity) {
  const id = String(identity ?? "").trim();
  return allKnownProducts().find((product) => identityOf(product) === id || product.legacyProductId === id);
}

export function getActionProductIds(actionId) {
  ensureProductRelationIndexes();
  return [...(productIdsByActionId.get(actionId) ?? [])];
}

export function getActionProducts(actionId) {
  ensureProductRelationIndexes();
  const contextual = [...(taskProductsByContextId.get(actionId) ?? [])];
  if (contextual.length > 0) return contextual;
  return getActionProductIds(actionId).map(findKnownProduct).filter(Boolean);
}

export function getPrimaryActionProduct(actionId) {
  return getActionProducts(actionId)[0] ?? null;
}

export function getActionProductImageUrls(actionId) {
  return getActionProducts(actionId).map((product) => product.mainImage).filter(Boolean);
}

export function getActionDisplayImages(actionId, fallbackImages = []) {
  const products = getActionProducts(actionId);
  if (products.length > 0) return { images: products.slice(0, 9).map((product) => String(product.mainImage ?? "").trim()), linkedProducts: products, usesLinkedProducts: true };
  return { images: Array.isArray(fallbackImages) ? fallbackImages : [], linkedProducts: [], usesLinkedProducts: false };
}

function renderProductThumb(product) {
  return product.mainImage
    ? `<img src="${escapeHtml(resolveAssetUrl(product.mainImage))}" alt="${escapeHtml(product.name)}" />`
    : `<span class="product-image-placeholder">无图</span>`;
}

export function getTaskContextProducts(contextId) {
  ensureProductRelationIndexes();
  return [...(taskProductsByContextId.get(contextId) ?? [])];
}

function normalizeCode(value) { return String(value ?? "").trim().toLowerCase(); }

function relationCreatedAt(actionId, product) {
  const identity = identityOf(product);
  return state.actionProducts.find((item) => item.actionId === actionId && (item.erpSkuId === identity || item.productId === identity || item.productId === product.legacyProductId))?.createdAt ?? "";
}

function formatRelationTime(value) {
  if (!value) return "本次新增，保存后生效";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-CN", { hour12: false });
}

function renderSelectedProducts(products, actionId = "") {
  if (products.length === 0) return `<p class="form-note">尚未选择关联产品</p>`;
  return products.map((product) => {
    const identity = identityOf(product);
    return `<div class="action-product-selected-item">
      ${renderProductThumb(product)}
      <span><strong>${escapeHtml(product.name)}</strong><small>ERP SKU：${escapeHtml(product.erpSkuCode || product.skuCode || "—")}</small><small>经营状态：${escapeHtml(optionStatusLabel(product))}</small><small>关联时间：${escapeHtml(formatRelationTime(relationCreatedAt(actionId, product)))}</small></span>
      ${identity ? `<button class="icon-button" type="button" data-action="remove-action-product" data-product-id="${escapeHtml(identity)}" aria-label="移除${escapeHtml(product.name)}">×</button>` : ""}
    </div>`;
  }).join("");
}

function renderOption(product, selected) {
  const identity = identityOf(product);
  return `<article class="action-product-option" data-product-id="${escapeHtml(identity)}" data-product-code="${escapeHtml(normalizeCode(product.erpSkuCode || product.skuCode))}">
    <input type="checkbox" name="actionProductId" value="${escapeHtml(identity)}" ${selected.has(identity) ? "checked" : ""} hidden />
    ${renderProductThumb(product)}
    <span><strong>${escapeHtml(product.name)}</strong><small>ERP SKU：${escapeHtml(product.erpSkuCode || product.skuCode || "—")}</small><small>经营状态：${escapeHtml(optionStatusLabel(product))}</small></span>
    <button class="text-button" type="button" data-action="choose-action-product" data-product-id="${escapeHtml(identity)}">${selected.has(identity) ? "已关联" : "选择"}</button>
  </article>`;
}

export function renderActionProductSelector(selectedIds = [], { label = "关联产品", actionId = "" } = {}) {
  const selected = new Set(selectedIds.map(String).filter(Boolean));
  const selectedProducts = [...new Map([...getActionProducts(actionId), ...selectedIds.map(findKnownProduct).filter(Boolean)].map((product) => [identityOf(product), product])).values()]
    .filter((product) => selected.size === 0 ? Boolean(actionId) : selected.has(identityOf(product)) || selected.has(product.legacyProductId));
  const preserved = [...selected].map((identity) => `<input type="checkbox" name="actionProductId" value="${escapeHtml(identity)}" checked hidden data-preserved-action-product />`).join("");
  return `<div class="action-product-selector" data-action-product-selector data-action-id="${escapeHtml(actionId)}">
    <span class="field-label">${escapeHtml(label)}</span>${preserved}
    <div class="action-product-selected" data-action-product-selected>${renderSelectedProducts(selectedProducts, actionId)}</div>
    <div class="action-product-quick-link"><strong>按 ERP SKU 关联</strong>
      <div class="action-product-search-row"><input class="action-product-search" type="search" placeholder="输入完整 ERP SKU 编码" data-action-product-quick-code autocomplete="off" /><button class="primary-button" type="button" data-action="quick-link-action-product">关联</button></div>
      <p class="form-note" data-action-product-quick-message>无需建立 Legacy 产品档案，ERP SKU 可直接关联。</p>
    </div>
    <details class="action-product-search-section" data-action-product-search-details><summary>搜索关联</summary>
      <div class="action-product-search-content"><input class="action-product-search" type="search" placeholder="搜索 ERP SKU 编码或产品名称" data-action-product-search autocomplete="off" />
        <p class="form-note" data-action-product-search-message>输入关键词搜索 ERP SKU。</p>
        <div class="action-product-confirm" data-action-product-confirm hidden></div>
        <div class="action-product-options" data-action-product-options></div>
      </div>
    </details>
  </div>`;
}

function mergeKnownOptions(rows) {
  const merged = new Map((state.actionProductOptions ?? []).map((product) => [identityOf(product), product]));
  for (const product of rows) merged.set(identityOf(product), product);
  state.actionProductOptions = [...merged.values()];
}

function renderOptions(selector, rows) {
  const selected = new Set(collectActionProductIds(selector));
  const host = selector.querySelector("[data-action-product-options]");
  if (host) host.innerHTML = rows.length ? rows.map((product) => renderOption(product, selected)).join("") : `<p class="form-note">未找到匹配的 ERP SKU</p>`;
}

async function searchOptions(selector, query) {
  const requestId = String(Date.now()) + Math.random();
  selector.dataset.productRequestId = requestId;
  const message = selector.querySelector("[data-action-product-search-message]");
  if (message) message.textContent = "正在搜索 ERP SKU…";
  try {
    const result = await loadActionProductOptions(query);
    if (selector.dataset.productRequestId !== requestId) return [];
    const rows = result.rows ?? [];
    mergeKnownOptions(rows);
    renderOptions(selector, rows);
    if (message) message.textContent = query ? `找到 ${rows.length} 个匹配 ERP SKU` : "请输入 ERP SKU 编码或产品名称。";
    refreshSelected(selector);
    return rows;
  } catch (error) {
    if (message) message.textContent = error.message || "ERP SKU 搜索失败。";
    return [];
  }
}

function refreshSelected(selector) {
  ensureProductRelationIndexes();
  const selectedProducts = collectActionProductIds(selector).map(findKnownProduct).filter(Boolean);
  const host = selector.querySelector("[data-action-product-selected]");
  if (host) host.innerHTML = renderSelectedProducts(selectedProducts, selector.dataset.actionId);
  selector.querySelectorAll(".action-product-option").forEach((option) => {
    const checked = option.querySelector('[name="actionProductId"]')?.checked === true;
    const button = option.querySelector('[data-action="choose-action-product"]');
    if (button) button.textContent = checked ? "已关联" : "选择";
  });
}

function renderProductConfirmation(product, isSelected = false) {
  const identity = identityOf(product);
  return `${renderProductThumb(product)}<span><strong>${escapeHtml(product.name)}</strong><small>ERP SKU：${escapeHtml(product.erpSkuCode || product.skuCode || "—")}</small><small>经营状态：${escapeHtml(optionStatusLabel(product))}</small></span><button class="primary-button" type="button" data-action="confirm-action-product" data-product-id="${escapeHtml(identity)}" ${isSelected ? "disabled" : ""}>${isSelected ? "已关联" : "确认关联"}</button>`;
}

export function bindActionProductSelectors(root = document) {
  root.querySelectorAll("[data-action-product-selector]").forEach((selector) => {
    selector.addEventListener("input", (event) => {
      if (!event.target.matches("[data-action-product-search]")) return;
      window.clearTimeout(selectorTimers.get(selector));
      const query = event.target.value.trim();
      if (!query) { renderOptions(selector, []); return; }
      selectorTimers.set(selector, window.setTimeout(() => { void searchOptions(selector, query); }, 250));
    });
    selector.addEventListener("keydown", (event) => {
      if (!event.target.matches("[data-action-product-quick-code]") || event.key !== "Enter") return;
      event.preventDefault();
      selector.querySelector('[data-action="quick-link-action-product"]')?.click();
    });
    selector.addEventListener("click", async (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (action === "quick-link-action-product") {
        const query = selector.querySelector("[data-action-product-quick-code]")?.value.trim() ?? "";
        const message = selector.querySelector("[data-action-product-quick-message]");
        if (!query) { if (message) message.textContent = "请输入 ERP SKU 编码。"; return; }
        const rows = await searchOptions(selector, query);
        const matches = rows.filter((product) => normalizeCode(product.erpSkuCode || product.skuCode) === normalizeCode(query));
        if (matches.length !== 1) {
          if (message) message.textContent = matches.length ? "存在多个同编码 ERP SKU，请在搜索结果中选择。" : "未找到对应 ERP SKU。";
          selector.querySelector("[data-action-product-search-details]").open = true;
          return;
        }
        const identity = identityOf(matches[0]);
        const input = selector.querySelector(`[name="actionProductId"][value="${CSS.escape(identity)}"]`);
        if (input) input.checked = true;
        if (message) message.textContent = "关联成功，可继续输入下一个 ERP SKU。";
        const quick = selector.querySelector("[data-action-product-quick-code]"); if (quick) quick.value = "";
        refreshSelected(selector); return;
      }
      if (action === "choose-action-product") {
        const identity = event.target.closest("[data-product-id]")?.dataset.productId || "";
        const product = findKnownProduct(identity); const confirm = selector.querySelector("[data-action-product-confirm]");
        const input = selector.querySelector(`[name="actionProductId"][value="${CSS.escape(identity)}"]`);
        if (confirm && product) { confirm.innerHTML = renderProductConfirmation(product, input?.checked === true); confirm.hidden = false; }
        return;
      }
      if (action === "confirm-action-product") {
        const identity = event.target.closest("[data-product-id]")?.dataset.productId || "";
        selector.querySelectorAll(`[name="actionProductId"][value="${CSS.escape(identity)}"]`).forEach((input) => { input.checked = true; });
        const confirm = selector.querySelector("[data-action-product-confirm]"); if (confirm) confirm.hidden = true;
        refreshSelected(selector); return;
      }
      if (action === "remove-action-product") {
        const identity = event.target.closest("[data-product-id]")?.dataset.productId || "";
        selector.querySelectorAll(`[name="actionProductId"][value="${CSS.escape(identity)}"]`).forEach((input) => { input.checked = false; });
        refreshSelected(selector);
      }
    });
  });
}

export function collectActionProductIds(root) {
  return [...new Set([...root.querySelectorAll('[name="actionProductId"]:checked')].map((input) => input.value).filter(Boolean))];
}

export function renderLinkedActionProducts(actionId, { compact = false } = {}) {
  const products = getActionProducts(actionId);
  if (products.length === 0) return `<p class="form-note">未关联产品</p>`;
  return `<div class="linked-action-products ${compact ? "is-compact" : ""}">${products.map((product) => {
    const href = product.erpSkuId ? `#products/sku/${encodeURIComponent(product.erpSkuId)}` : (product.legacyProductId ? `#products/${encodeURIComponent(product.legacyProductId)}` : "");
    const content = `${renderProductThumb(product)}<span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.erpSkuCode || product.skuCode || "—")}</small><small>${escapeHtml(optionStatusLabel(product))}</small>${compact ? "" : `<small>关联时间：${escapeHtml(formatRelationTime(relationCreatedAt(actionId, product)))}</small>`}</span>`;
    return href ? `<a class="linked-action-product" href="${href}">${content}</a>` : `<div class="linked-action-product">${content}</div>`;
  }).join("")}</div>`;
}
