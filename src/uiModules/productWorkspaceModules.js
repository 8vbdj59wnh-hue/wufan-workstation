import { registerUiModule } from "../uiModuleRegistry.js";
import { renderProductImage } from "./productImage.js";
import { escapeHtml } from "../utils/html.js?v=20260802-module-boundary1";

const value = (input) => input === null || input === undefined || input === "" ? "—" : input;

registerUiModule({
  moduleKey: "product_basic_info",
  name: "ProductBasicInfo",
  domain: "product",
  description: "ERP SKU 与可选产品经营档案的基础信息。",
  render: ({ sku, ownerName, resolveUrl }) => `<section class="product-workspace-basic">
    <div class="product-workspace-cover">${renderProductImage({ src: sku.productImage, fallbackSrc: sku.mainImage, alt: sku.productName || sku.goodsName || sku.merchantSkuCode, className: "product-workspace-main-image", resolveUrl })}</div>
    <div class="product-workspace-identity"><div class="product-workspace-eyebrow"><span class="status-badge">${sku.productId ? "已建立产品档案" : "未建立产品档案"}</span><span>${escapeHtml(value(sku.erpStatus))}</span></div>
      <h1>${escapeHtml(sku.productName || sku.goodsName || sku.specificationName || sku.merchantSkuCode)}</h1>
      <p>${escapeHtml(sku.specificationName || sku.shortName || "暂无规格说明")}</p>
      <dl><div><dt>SKU</dt><dd>${escapeHtml(value(sku.merchantSkuCode))}</dd></div><div><dt>品牌</dt><dd>${escapeHtml(value(sku.brand || sku.erpBrand))}</dd></div><div><dt>类目</dt><dd>${escapeHtml(value(sku.category || sku.erpCategory))}</dd></div><div><dt>负责人</dt><dd>${escapeHtml(value(ownerName))}</dd></div><div><dt>生命周期</dt><dd>${escapeHtml(value(sku.lifecycleStatus))}</dd></div></dl>
    </div>
  </section>`,
  configSchema: {},
  dependencies: ["product_image"],
});

registerUiModule({
  moduleKey: "product_business_data",
  name: "ProductBusinessData",
  domain: "product",
  description: "展示现有服务已计算的经营和库存数据。",
  render: ({ sales, inventory, formatMoney, formatMetric }) => `<section class="product-workspace-panel product-workspace-business"><header><div><span>经营数据</span><h2>当前经营表现</h2></div><small>${escapeHtml(value(sales?.lastPeriod || inventory?.businessDate))}</small></header><div class="product-workspace-metrics">
    <div><span>销量</span><strong>${escapeHtml(formatMetric(sales?.quantity))}</strong></div><div><span>销售额</span><strong>${escapeHtml(formatMoney(sales?.salesAmount))}</strong></div><div><span>利润</span><strong>${escapeHtml(formatMoney(sales?.profitAmount))}</strong></div><div><span>当前库存</span><strong>${escapeHtml(formatMetric(inventory?.stockNum))}</strong></div><div><span>库存金额</span><strong>${escapeHtml(formatMoney(inventory?.inventoryCostAmount))}</strong></div><div><span>30日销量</span><strong>${escapeHtml(formatMetric(inventory?.salesMonth))}</strong></div>
  </div></section>`,
  configSchema: {},
  dependencies: [],
});

registerUiModule({
  moduleKey: "product_gallery",
  name: "ProductGallery",
  domain: "product",
  description: "复用 ProductImage 的产品图片展示。",
  render: ({ images = [], sku, resolveUrl }) => {
    const uniqueImages = [...new Set(images.filter(Boolean))];
    if (!uniqueImages.length) uniqueImages.push(sku.productImage || sku.mainImage || "");
    return `<section class="product-workspace-panel"><header><div><span>产品图片</span><h2>视觉资料</h2></div></header><div class="product-workspace-gallery">${uniqueImages.map((src, index) => renderProductImage({ src, alt: `${sku.productName || sku.goodsName || "产品"}图片${index + 1}`, className: "product-workspace-gallery-image", resolveUrl })).join("")}</div></section>`;
  },
  configSchema: {},
  dependencies: ["product_image"],
});

registerUiModule({
  moduleKey: "product_links",
  name: "ProductLinks",
  domain: "product",
  description: "通过 V2 ERP SKU 映射展示销售链接。",
  render: ({ state }) => `<section class="product-workspace-panel"><header><div><span>销售渠道</span><h2>关联链接</h2></div><small>${state.loaded ? `${state.rows.length} 条` : "按需加载"}</small></header>${state.loading ? `<div class="empty-state compact">正在读取销售链接…</div>` : state.error ? `<div class="form-error">${escapeHtml(state.error)}</div>` : !state.loaded ? `<button class="secondary-button" type="button" data-action="load-product-workspace-section" data-scope="links">查看销售链接</button>` : `<div class="product-workspace-links">${state.rows.length ? state.rows.map((item) => `<a href="${item.connectionId ? `#connectionCenter/${encodeURIComponent(item.connectionId)}` : "#connectionCenter"}"><span>${escapeHtml(item.platform)} · ${escapeHtml(item.shopName)}</span><strong>${escapeHtml(item.title || "查看链接")}</strong></a>`).join("") : `<div class="empty-state compact">暂无销售链接</div>`}</div>`}</section>`,
  configSchema: {},
  dependencies: [],
});
