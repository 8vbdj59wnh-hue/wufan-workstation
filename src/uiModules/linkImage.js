import { registerUiModule } from "../uiModuleRegistry.js";
import { escapeHtml } from "../utils/html.js?v=20260802-module-boundary1";

export function renderLinkImage({ src = "", alt = "", size = "standard" } = {}) {
  const image = String(src || "").trim();
  return `<span class="link-image-module is-${escapeHtml(size)} ${image ? "" : "is-empty"}" data-module-key="link_image">
    ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(alt)}" loading="lazy" data-link-image />` : ""}
    <span class="link-image-placeholder" aria-hidden="true">链</span>
  </span>`;
}

registerUiModule({ moduleKey: "link_image", name: "LinkImage", domain: "business_links",
  description: "统一展示链接主图、无图占位和加载失败状态。", render: renderLinkImage,
  configSchema: { size: "compact | standard" }, dependencies: ["BusinessLink"] });
