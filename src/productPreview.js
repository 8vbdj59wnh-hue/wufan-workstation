import { resolveAssetUrl, state } from "./appState.js?v=20260705-state-singleton1";
import { getProcessInstanceBusinessStatus } from "./data/processInstanceSelectors.js?v=20260722-progress-selectors1";

let previewProductId = "";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatDateTime(value) {
  if (!value) return "未设置";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? escapeHtml(value) : date.toLocaleString("zh-CN", { hour12: false });
}

function getRelatedActions(productId) {
  const actionIds = new Set(
    state.actionProducts.filter((relation) => relation.productId === productId).map((relation) => relation.actionId),
  );
  return state.processInstances
    .filter((instance) => actionIds.has(instance.id))
    .sort((left, right) =>
      String(right.updatedAt ?? right.createdAt ?? "").localeCompare(String(left.updatedAt ?? left.createdAt ?? "")),
    );
}

function renderProductImage(product) {
  if (!product.mainImage) return `<span class="product-preview-image product-image-placeholder">无图</span>`;
  return `<img class="product-preview-image" src="${escapeHtml(resolveAssetUrl(product.mainImage))}" alt="${escapeHtml(product.name)}" />`;
}

function renderInfoField(label, value) {
  return `<div class="product-preview-field"><span>${label}</span><strong>${escapeHtml(value || "未设置")}</strong></div>`;
}

export function openProductPreview(productId) {
  previewProductId = String(productId ?? "").trim();
}

export function closeProductPreview() {
  previewProductId = "";
}

export function renderProductPreviewModal() {
  if (previewProductId === "") return "";
  const product = state.products.find((item) => item.id === previewProductId);
  if (!product) return "";

  const actions = getRelatedActions(product.id);
  const recentActions = actions.slice(0, 3);
  return `
    <div class="modal-backdrop product-preview-backdrop" data-product-preview-backdrop>
      <section class="modal-panel product-preview-modal" role="dialog" aria-modal="true" aria-labelledby="product-preview-title">
        <header class="modal-header">
          <div>
            <h2 id="product-preview-title">产品预览</h2>
            <p>${escapeHtml(product.skuCode)}</p>
          </div>
          <button class="icon-button" type="button" data-product-preview-close aria-label="关闭产品预览">×</button>
        </header>
        <div class="modal-body product-preview-body">
          <section class="product-preview-primary">
            ${renderProductImage(product)}
            <div>
              <span class="status-badge">${escapeHtml(product.status || "未设置状态")}</span>
              <h3>${escapeHtml(product.name)}</h3>
              <p>${escapeHtml(product.skuCode)}</p>
            </div>
          </section>
          <section class="product-preview-section">
            <h3>基础信息</h3>
            <div class="product-preview-grid">
              ${renderInfoField("产品名称", product.name)}
              ${renderInfoField("SKU编码", product.skuCode)}
              ${renderInfoField("品牌", product.brand)}
              ${renderInfoField("分类", product.category)}
              ${renderInfoField("材质", product.material)}
              ${renderInfoField("规格", product.specification || product.skuName)}
              ${renderInfoField("状态", product.status)}
            </div>
          </section>
          <section class="product-preview-section">
            <div class="product-preview-section-heading">
              <h3>关联信息</h3>
              <span>关联关键行动 ${actions.length}</span>
            </div>
            ${
              recentActions.length === 0
                ? `<p class="form-note">暂无关联关键行动</p>`
                : `<div class="product-preview-action-list">
                    ${recentActions.map((instance) => {
                      const status = getProcessInstanceBusinessStatus(instance.id, state);
                      return `<div class="product-preview-action-item">
                        <div><strong>${escapeHtml(instance.displayTitle || instance.name || "未命名关键行动")}</strong><span class="status-badge">${escapeHtml(status.label)}</span></div>
                        <small>发起于 ${formatDateTime(instance.createdAt)}${instance.dueDate ? ` · 截止 ${formatDateTime(instance.dueDate)}` : ""}</small>
                      </div>`;
                    }).join("")}
                  </div>`
            }
          </section>
        </div>
        <footer class="modal-footer">
          <button class="secondary-button" type="button" data-product-preview-close>关闭</button>
        </footer>
      </section>
    </div>
  `;
}

export function bindProductPreviewEvents() {
  const backdrop = document.querySelector("[data-product-preview-backdrop]");
  if (backdrop === null) return;
  const close = () => {
    closeProductPreview();
    backdrop.remove();
  };
  backdrop.addEventListener("click", (event) => {
    if (event.target !== backdrop && event.target.closest("[data-product-preview-close]") === null) return;
    close();
  });
  backdrop.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    close();
  });
  backdrop.querySelector("[data-product-preview-close]")?.focus({ preventScroll: true });
}
