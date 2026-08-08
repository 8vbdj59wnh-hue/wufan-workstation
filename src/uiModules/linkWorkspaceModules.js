import { registerUiModule } from "../uiModuleRegistry.js";
import { escapeHtml } from "../utils/html.js?v=20260802-module-boundary1";

function register(moduleKey, name, description, dependencies, render, configSchema = {}) {
  registerUiModule({ moduleKey, name, domain: "business_links", description, render, configSchema, dependencies });
}

export function renderLinkFilter({ content = "" } = {}) {
  return `<section class="link-filter-module" data-module-key="link_filter"><header><div><span>筛选链接</span><small>搜索、筛选和排序沿用现有规则</small></div></header>${content}</section>`;
}

export function renderLinkDetailHeader({ item = {}, imageHtml = "", channel = "", productSummary = "", operationHtml = "" } = {}) {
  return `<section class="link-detail-header-module" data-module-key="link_detail_header"><button type="button" class="text-button" data-action="back-connections">← 返回全部链接</button><header>${imageHtml}<div><p class="eyebrow">${escapeHtml(channel)}</p><h2>${escapeHtml(item.name || "未命名链接")}</h2><p>${escapeHtml(productSummary || "尚未关联产品")}</p></div></header>${operationHtml}</section>`;
}

export function renderLinkBusinessSummary({ metricsHtml = "", trendHtml = "", healthHtml = "", productHtml = "" } = {}) {
  return `<section class="link-workspace-module" data-module-key="link_business_summary"><div class="link-workspace-grid">${metricsHtml}${trendHtml}${healthHtml}${productHtml}</div></section>`;
}

export function renderLinkSalesAnalysis({ platformHtml = "", erpHtml = "", skuHtml = "", trendHtml = "" } = {}) {
  return `<section class="link-workspace-module" data-module-key="link_sales_analysis"><div class="link-workspace-stack">${platformHtml}${erpHtml}${skuHtml}${trendHtml}</div></section>`;
}

export function renderLinkInventorySummary({ productsHtml = "", inventoryHtml = "" } = {}) {
  return `<section class="link-workspace-module" data-module-key="link_inventory_summary"><div class="link-workspace-stack">${productsHtml}${inventoryHtml}</div></section>`;
}

export function renderLinkHospitalOverview({ overviewHtml = "", listHtml = "", actionsHtml = "" } = {}) {
  return `<section class="link-hospital-overview-module" data-module-key="link_hospital_overview">${overviewHtml}${listHtml}${actionsHtml}</section>`;
}

register("link_filter", "LinkFilter", "复用链接资产既有搜索、筛选、排序与字段设置能力。", ["BusinessLink", "QueryBusinessLinks"], renderLinkFilter);
register("link_detail_header", "LinkDetailHeader", "链接详情 Workspace 的统一身份、渠道与经营操作头部。", ["BusinessLink", "ProductRelation"], renderLinkDetailHeader);
register("link_business_summary", "LinkBusinessSummary", "组合既有核心指标、趋势、健康与产品摘要。", ["BusinessLink", "ConnectionPeriodSnapshot", "ConnectionHealthRecord"], renderLinkBusinessSummary);
register("link_sales_analysis", "LinkSalesAnalysis", "组合既有平台表现、ERP销售、SKU销售与趋势能力。", ["ConnectionPeriodSnapshot", "ConnectionSkuSalesFact"], renderLinkSalesAnalysis);
register("link_inventory_summary", "LinkInventorySummary", "组合既有产品、SKU与库存查询结果。", ["Product", "ErpSku", "ErpSkuInventory"], renderLinkInventorySummary);
register("link_hospital_overview", "LinkHospitalOverview", "组合既有医院阶段、诊断、改善和经营动作入口。", ["ConnectionHealthRecord", "ConnectionImprovement", "ConnectionAction"], renderLinkHospitalOverview);
