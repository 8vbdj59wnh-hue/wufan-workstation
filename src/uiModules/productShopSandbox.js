import { registerUiModule } from "../uiModuleRegistry.js";
import { escapeHtml } from "../utils/html.js";
import { renderProductSalesPresetButtons } from "./productSalesDistribution.js";

const number = (value) => Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const natural = (left, right) => String(left || "").localeCompare(String(right || ""), "zh-CN", { numeric: true });

function skuCodeGroup(item) {
  const code = String(item.skuCode || "").trim();
  return code ? code.split("-")[0].trim() || code : `未编码-${item.productId}`;
}

function sortProductCards(items, sortMode) {
  if (sortMode !== "code_group") return [...items].sort((left, right) => Number(right.salesQuantity) - Number(left.salesQuantity) || natural(left.skuCode || left.productName, right.skuCode || right.productName));
  const groups = new Map();
  for (const item of items) {
    const key = skuCodeGroup(item);
    if (!groups.has(key)) groups.set(key, { key, totalSales: 0, items: [] });
    const group = groups.get(key);
    group.totalSales += Number(item.salesQuantity || 0);
    group.items.push(item);
  }
  return [...groups.values()].sort((left, right) => right.totalSales - left.totalSales || natural(left.key, right.key))
    .flatMap((group) => group.items.sort((left, right) => Number(right.salesQuantity) - Number(left.salesQuantity) || natural(left.skuCode || left.productName, right.skuCode || right.productName)));
}

function renderShopTabs(shops, selectedShopId) {
  return `<nav class="product-sandbox-shop-tabs" aria-label="切换销售店铺">${shops.map((shop) => `<button type="button" data-product-sandbox-shop="${escapeHtml(shop.id)}" class="${shop.id === selectedShopId ? "is-active" : ""}"><span>${escapeHtml(shop.name)}</span><small>${escapeHtml(shop.platform || "未标注平台")}</small></button>`).join("")}</nav>`;
}

function renderProductCards(items, resolveUrl) {
  return `<div class="product-sandbox-grid">${items.map((item) => {
    const label = `${item.productName || "未命名产品"}，销量 ${number(item.salesQuantity)}`;
    return `<button type="button" class="product-sandbox-card" data-product-sandbox-product="${escapeHtml(item.productId)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${item.mainImage ? `<img src="${escapeHtml(resolveUrl(item.mainImage))}" alt="${escapeHtml(item.productName || "产品主图")}" loading="lazy" />` : `<span class="product-sandbox-image-placeholder" aria-hidden="true">无图</span>`}<span class="product-sandbox-quantity" aria-hidden="true"><strong>${number(item.salesQuantity)}</strong></span></button>`;
  }).join("")}</div>`;
}

function renderProductSummary(summary = {}, segment = "all") {
  const items = [["all", "总产品数", summary.productCount], ["active", "动销产品数", summary.productsWithSales], ["slow", "滞销产品数", summary.slowMovingProducts], ["out_of_stock", "无库存产品数", summary.outOfStockProducts]];
  return `<div class="product-sandbox-kpis" aria-label="店铺产品概览">${items.map(([value, label, count]) => `<button type="button" data-product-sandbox-segment="${value}" class="${segment === value ? "is-active" : ""}" aria-pressed="${segment === value}">${label} <strong>${number(count)}</strong></button>`).join("")}</div>`;
}

function renderSortControl(sortMode) {
  return `<div class="product-sandbox-sort" aria-label="产品排序"><span>排序</span><button type="button" data-product-sandbox-sort="sales" class="${sortMode === "sales" ? "is-active" : ""}" aria-pressed="${sortMode === "sales"}">销量</button><button type="button" data-product-sandbox-sort="code_group" class="${sortMode === "code_group" ? "is-active" : ""}" aria-pressed="${sortMode === "code_group"}">编码组</button></div>`;
}

export function renderProductShopSandbox({ state = {}, resolveUrl = (value) => value } = {}) {
  const range = state.range || { preset: "30d" };
  const shops = state.shops || [];
  const items = state.items || [];
  const segment = state.segment || "all";
  const sortMode = state.sortMode === "code_group" ? "code_group" : "sales";
  const filteredItems = segment === "active" ? items.filter((item) => item.hasSales)
    : segment === "slow" ? items.filter((item) => !item.hasSales && item.hasInventoryData && Number(item.inventoryQuantity) > 0)
      : segment === "out_of_stock" ? items.filter((item) => item.hasInventoryData && Number(item.inventoryQuantity) <= 0)
        : items;
  const visibleItems = sortProductCards(filteredItems, sortMode);
  const selectedShop = state.selectedShop || null;
  return `<section class="product-shop-sandbox-module" data-module-key="product_shop_sandbox">
    ${selectedShop ? `<header class="is-summary-only"><span>${escapeHtml(selectedShop.name)} · ${visibleItems.length}${segment !== "all" ? ` / ${items.length}` : ""} 个产品</span></header>` : ""}
    ${shops.length ? renderShopTabs(shops, selectedShop?.id || "") : ""}
    <form data-product-sandbox-filter>${renderProductSalesPresetButtons(range, "data-product-sandbox-preset")}<div class="product-distribution-custom-range ${range.preset === "custom" ? "" : "is-hidden"}"><label>开始日期<input type="date" name="startDate" value="${escapeHtml(range.startDate || "")}" ${range.preset === "custom" ? "required" : "disabled"}/></label><span>→</span><label>结束日期<input type="date" name="endDate" value="${escapeHtml(range.endDate || "")}" ${range.preset === "custom" ? "required" : "disabled"}/></label></div><button type="submit" class="secondary-button">查看</button>${renderSortControl(sortMode)}${renderProductSummary(state.summary, segment)}</form>
    ${range.startDate && range.endDate ? `<div class="product-sandbox-period">${escapeHtml(range.startDate)} 至 ${escapeHtml(range.endDate)}</div>` : ""}
    ${state.loading && !state.loaded ? `<div class="empty-state">正在读取店铺产品…</div>` : state.error ? `<div class="form-error">${escapeHtml(state.error)}</div>` : !shops.length ? `<div class="empty-state"><strong>暂无可用店铺</strong><p>当前没有关联销售链接的在用店铺。</p></div>` : !items.length ? `<div class="empty-state"><strong>暂无关联产品</strong><p>该店铺当前没有可归属到产品档案的有效销售关系。</p></div>` : visibleItems.length ? renderProductCards(visibleItems, resolveUrl) : `<div class="empty-state"><strong>当前关联产品均无销量</strong><p>取消“隐藏无销量”即可查看全部关联产品。</p></div>`}
  </section>`;
}

registerUiModule({
  moduleKey: "product_shop_sandbox",
  name: "ProductShopSandbox",
  domain: "business_products",
  description: "按店铺与销售周期展示产品主图和实际销量的只读产品沙盘。",
  render: renderProductShopSandbox,
  configSchema: { shopSwitch: true, quantityMetric: "totalPhysicalContribution" },
  dependencies: ["Product", "SalesShop", "SalesLink", "QueryProductContribution"],
});
