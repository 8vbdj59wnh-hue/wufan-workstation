import { registerUiModule } from "../uiModuleRegistry.js";
import { escapeHtml } from "../utils/html.js?v=20260802-module-boundary1";

export function renderProductImage({ src = "", fallbackSrc = "", alt = "产品图片", className = "product-list-image", resolveUrl = (value) => value } = {}) {
  const source = src || fallbackSrc;
  if (!source) return `<span class="${escapeHtml(className)} product-image-placeholder" role="img" aria-label="${escapeHtml(alt)}暂无图片">无图</span>`;
  return `<img class="${escapeHtml(className)}" src="${escapeHtml(resolveUrl(source))}" alt="${escapeHtml(alt)}" loading="lazy" data-product-image onerror="this.hidden=true;this.nextElementSibling.hidden=false" /><span class="${escapeHtml(className)} product-image-placeholder" role="img" aria-label="${escapeHtml(alt)}加载失败" hidden>无图</span>`;
}

registerUiModule({
  moduleId: "MOD-001",
  moduleKey: "product_image",
  name: "ProductImage",
  domain: "product",
  description: "统一的产品图片、占位与加载失败展示。",
  render: (context, config) => renderProductImage({ ...context, ...config }),
  configSchema: { className: "string", alt: "string" },
  dependencies: [],
});
