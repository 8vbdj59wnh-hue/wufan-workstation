import { registerUiModule } from "../uiModuleRegistry.js";
import { escapeHtml } from "../utils/html.js";
import { LINK_TIME_RANGE_OPTIONS, LINK_TIME_RANGE_VALUES } from "../../shared/linkTimeRange.js";

const platformNames = {
  tmall: "天猫",
  taobao: "淘宝",
  xiaohongshu: "小红书",
  jd: "京东",
  douyin: "抖音",
};

export function businessPlatformLabel(platform = "") {
  const value = String(platform || "").trim();
  return platformNames[value.toLowerCase()] || value;
}

export function businessShopOptionLabel(shop = {}) {
  const name = String(shop.name || "").trim();
  const platform = businessPlatformLabel(shop.platform);
  return platform && name ? `${platform} · ${name}` : name || platform;
}

export function renderLinkBusinessToolbar({ range = {}, filters = {}, options = {}, indicatorHtml = "", dataSources = {} } = {}) {
  const preset = range.preset || "7d";
  const option = (value, label, selected) => `<option value="${escapeHtml(value)}" ${selected === value ? "selected" : ""}>${escapeHtml(label)}</option>`;
  return `<section class="link-business-toolbar-module" data-module-key="link_business_toolbar"><form data-link-business-toolbar>
    <div class="link-business-toolbar-primary"><input type="search" name="keyword" value="${escapeHtml(filters.keyword || "")}" placeholder="搜索链接名称或商品ID" />
      <div class="segmented-control" data-business-range>${LINK_TIME_RANGE_OPTIONS.map(({ value, label }) => `<button type="button" data-business-preset="${value}" class="${preset === value ? "active" : ""}">${label}</button>`).join("")}</div>
      <input type="hidden" name="preset" value="${escapeHtml(preset)}" />
      <label class="link-business-custom-date ${preset === "custom" ? "" : "is-hidden"}">开始<input type="date" name="startDate" value="${escapeHtml(range.startDate || "")}" /></label>
      <label class="link-business-custom-date ${preset === "custom" ? "" : "is-hidden"}">结束<input type="date" name="endDate" value="${escapeHtml(range.endDate || "")}" /></label>
      <button type="submit" class="primary-button">查询</button>${indicatorHtml}</div>
    <div class="link-business-filters"><strong class="link-business-filters-title">经营筛选</strong><div>
      <select name="platform">${option("","全部平台",filters.platform)}${(options.platforms || []).map((item) => option(item,item,filters.platform)).join("")}</select>
      <select name="shopId">${option("","全部店铺",filters.shopId)}${(options.shops || []).map((item) => option(item.id,businessShopOptionLabel(item),filters.shopId)).join("")}</select>
      <select name="ownerId">${option("","全部负责人",filters.ownerId)}${(options.owners || []).map((item) => option(item.id,item.name,filters.ownerId)).join("")}</select>
      <label>销售额<input type="number" name="minSales" value="${escapeHtml(filters.minSales || "")}" placeholder="最低" step="0.01" /></label><span>—</span><input type="number" name="maxSales" value="${escapeHtml(filters.maxSales || "")}" placeholder="最高" step="0.01" />
      <label>利润<input type="number" name="minProfit" value="${escapeHtml(filters.minProfit || "")}" placeholder="最低" step="0.01" /></label><span>—</span><input type="number" name="maxProfit" value="${escapeHtml(filters.maxProfit || "")}" placeholder="最高" step="0.01" />
      <label>毛利率<input type="number" name="minProfitMargin" value="${escapeHtml(filters.minProfitMargin || "")}" placeholder="最低%" step="0.01" /></label><span>—</span><input type="number" name="maxProfitMargin" value="${escapeHtml(filters.maxProfitMargin || "")}" placeholder="最高%" step="0.01" />
      <select name="growthStatus">${option("","全部增长状态",filters.growthStatus)}${option("better","增长",filters.growthStatus)}${option("stable","稳定",filters.growthStatus)}${option("worse","下滑",filters.growthStatus)}${option("no_data","暂无数据",filters.growthStatus)}</select>
      <label><input type="checkbox" name="includeHistorical" value="true" ${filters.includeHistorical ? "checked" : ""} />显示历史/退出经营链接</label>
      <button type="button" class="text-button" data-clear-link-business-filters>清除筛选</button>
    </div></div></form>
    <p class="link-business-source-note">ERP销售：${escapeHtml(dataSources.erp?.maxDate ? `数据至 ${dataSources.erp.maxDate}` : "暂无数据")} · 平台经营：${escapeHtml(dataSources.platform?.maxDate ? `数据至 ${dataSources.platform.maxDate}` : "暂无数据")} · 两类口径不合并</p>
  </section>`;
}

registerUiModule({ moduleKey: "link_business_toolbar", name: "LinkBusinessToolbar", domain: "business_links",
  description: "提供全部链接经营分析的搜索、日期、基础与经营筛选及指标设置入口。", render: renderLinkBusinessToolbar,
  configSchema: { ranges: LINK_TIME_RANGE_VALUES }, dependencies: ["QueryLinkBusinessTable", "LinkIndicatorSetting"] });
