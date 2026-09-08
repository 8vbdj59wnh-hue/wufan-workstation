import { registerUiModule } from "../uiModuleRegistry.js";
import { renderProductImage } from "./productImage.js";
import { escapeHtml } from "../utils/html.js";

const value = (input) => input === null || input === undefined || input === "" ? "—" : input;

registerUiModule({
  moduleKey: "product_basic_info",
  name: "ProductBasicInfo",
  domain: "product",
  description: "ERP SKU 与可选经营资料的基础信息。",
  render: ({ sku, ownerName, resolveUrl }) => `<section class="product-workspace-basic">
    <div class="product-workspace-cover">${renderProductImage({ src: sku.productImage, fallbackSrc: sku.mainImage, alt: sku.productName || sku.goodsName || sku.merchantSkuCode, className: "product-workspace-main-image", resolveUrl })}</div>
    <div class="product-workspace-identity"><div class="product-workspace-eyebrow"><span class="status-badge">${sku.businessProfileId ? "经营资料已维护" : "经营资料未维护"}</span><span>${escapeHtml(value(sku.erpStatus))}</span></div>
      <h1>${escapeHtml(sku.productName || sku.goodsName || sku.specificationName || sku.merchantSkuCode)}</h1>
      <p>${escapeHtml(sku.specificationName || sku.shortName || "暂无规格说明")}</p>
      <dl><div><dt>SKU</dt><dd>${escapeHtml(value(sku.merchantSkuCode))}</dd></div><div><dt>品牌</dt><dd>${escapeHtml(value(sku.brand || sku.erpBrand))}</dd></div><div><dt>类目</dt><dd>${escapeHtml(value(sku.category || sku.erpCategory))}</dd></div><div><dt>负责人</dt><dd>${escapeHtml(value(ownerName))}</dd></div><div><dt>生命周期</dt><dd>${escapeHtml(value(sku.lifecycleStatus))}</dd></div></dl>
    </div>
  </section>`,
  configSchema: {},
  dependencies: ["product_image"],
});

registerUiModule({
  moduleKey: "product_ai_tools",
  name: "ProductAITools",
  domain: "product",
  description: "复用现有产品 AI 资料导出能力的工作台入口。",
  render: ({ productId, notice = "" }) => `<section class="product-workspace-panel product-workspace-ai-tools"><header><div><span>AI 工具</span><h2>产品资料输出</h2></div></header>
    ${notice ? `<div class="form-success">${escapeHtml(notice)}</div>` : ""}
    <p>将产品基础信息与已维护的营销资产整理为稳定的结构化文本。</p>
    <div class="product-workspace-inline-actions"><button class="primary-button" type="button" data-action="copy-product-marketing" ${productId ? "" : "disabled"}>复制 AI 资料</button><button class="secondary-button" type="button" disabled title="当前仅提供素材包清单，尚未生成 ZIP 文件">导出 AI 素材包（暂未开放）</button></div>
  </section>`,
  configSchema: {},
  dependencies: ["ProductMarketingManage"],
});

registerUiModule({
  moduleKey: "product_lifecycle_strategy",
  name: "ProductLifecycleStrategy",
  domain: "product",
  description: "展示现有产品生命周期和负责人信息，不生成新的策略数据。",
  render: ({ sku, ownerName }) => `<section class="product-workspace-panel product-workspace-strategy"><header><div><span>经营管理</span><h2>生命周期与策略</h2></div></header><dl>
    <div><dt>当前生命周期</dt><dd>${escapeHtml(value(sku.businessLifecycle || sku.lifecycleStatus || "未维护"))}</dd></div>
    <div><dt>当前策略</dt><dd>未维护</dd></div>
    <div><dt>下一步动作</dt><dd>未维护</dd></div>
    <div><dt>负责人</dt><dd>${escapeHtml(sku.productId ? value(ownerName) : "未维护")}</dd></div>
  </dl></section>`,
  configSchema: {},
  dependencies: ["Product"],
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

const productLinkSalesSortOptions = [
  ["default", "默认", null],
  ["7d", "7天", "quantity7d"],
  ["15d", "15天", "quantity15d"],
  ["30d", "30天", "quantity30d"],
];

function sortProductLinksBySales(rows = [], salesSort = "default") {
  const field = productLinkSalesSortOptions.find(([key]) => key === salesSort)?.[2];
  if (!field) return rows;
  return rows.map((item, index) => ({ item, index })).sort((left, right) => {
    const leftRawMetric = left.item.salesWindows?.[field];
    const rightRawMetric = right.item.salesWindows?.[field];
    const leftMetric = leftRawMetric === null || leftRawMetric === undefined ? Number.NaN : Number(leftRawMetric);
    const rightMetric = rightRawMetric === null || rightRawMetric === undefined ? Number.NaN : Number(rightRawMetric);
    const leftValue = Number.isFinite(leftMetric) ? leftMetric : Number.NEGATIVE_INFINITY;
    const rightValue = Number.isFinite(rightMetric) ? rightMetric : Number.NEGATIVE_INFINITY;
    return rightValue - leftValue || left.index - right.index;
  }).map(({ item }) => item);
}

registerUiModule({
  moduleKey: "product_links",
  name: "ProductLinks",
  domain: "product",
  description: "通过 V2 ERP SKU 映射展示销售链接。",
  render: ({ state, salesSort = "default", formatMetric = (input) => Number(input || 0).toLocaleString("zh-CN") }) => {
    const rows = sortProductLinksBySales(state.rows, salesSort);
    const headerActions = `<div class="product-workspace-link-header-actions"><small>${state.loaded ? `${state.rows.length} 条` : "按需加载"}</small>${state.loaded && state.rows.length ? `<div class="product-workspace-link-sort" aria-label="关联链接销量排序"><span>销量排序</span>${productLinkSalesSortOptions.map(([key, label]) => `<button type="button" data-action="sort-product-workspace-links" data-sales-sort="${key}" class="${salesSort === key ? "is-active" : ""}" aria-pressed="${salesSort === key}">${label}</button>`).join("")}</div>` : ""}</div>`;
    return `<section class="product-workspace-panel"><header><div><span>销售渠道</span><h2>关联链接</h2></div>${headerActions}</header>${state.loading ? `<div class="empty-state compact">正在读取销售链接…</div>` : state.error ? `<div class="form-error">${escapeHtml(state.error)}</div>` : !state.loaded ? `<button class="secondary-button" type="button" data-action="load-product-workspace-section" data-scope="links">查看销售链接</button>` : `<div class="product-workspace-links">${rows.length ? rows.map((item) => `<a href="${item.connectionId ? `#connectionCenter/${encodeURIComponent(item.connectionId)}` : "#connectionCenter"}"><div class="product-workspace-link-copy"><span>${escapeHtml(item.platform)} · ${escapeHtml(item.shopName)}</span><strong>${escapeHtml(item.title || "查看链接")}</strong></div><div class="product-workspace-link-sales" aria-label="近7天、15天、30天销量">${[["7天销量", item.salesWindows?.quantity7d], ["15天销量", item.salesWindows?.quantity15d], ["30天销量", item.salesWindows?.quantity30d]].map(([label, metric]) => `<span><small>${label}</small><strong>${metric === null || metric === undefined ? "—" : escapeHtml(formatMetric(metric))}</strong></span>`).join("")}</div></a>`).join("") : `<div class="empty-state compact">暂无销售链接</div>`}</div>`}</section>`;
  },
  configSchema: {},
  dependencies: [],
});
