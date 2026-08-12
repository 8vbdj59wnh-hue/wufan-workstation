import { registerUiModule } from "../uiModuleRegistry.js";
import { escapeHtml } from "../utils/html.js";

export function renderLinkDataToolbar({ keyword = "", range = {}, filters = {}, platforms = [], shops = [], columnSettingHtml = "", dataSource = {} } = {}) {
  const preset = range.preset || "7d";
  return `<section class="link-data-toolbar-module" data-module-key="link_data_toolbar">
    <form data-link-data-toolbar><div class="link-data-toolbar-main">
      <input type="search" name="keyword" value="${escapeHtml(keyword)}" placeholder="搜索链接名称或商品ID" aria-label="搜索我的链接" />
      <select name="preset" aria-label="销售时间范围"><option value="7d" ${preset === "7d" ? "selected" : ""}>近7日</option><option value="30d" ${preset === "30d" ? "selected" : ""}>近30日</option><option value="custom" ${preset === "custom" ? "selected" : ""}>自定义日期</option></select>
      <label class="link-custom-date ${preset === "custom" ? "" : "is-hidden"}">开始<input type="date" name="startDate" value="${escapeHtml(range.startDate || "")}" /></label>
      <label class="link-custom-date ${preset === "custom" ? "" : "is-hidden"}">结束<input type="date" name="endDate" value="${escapeHtml(range.endDate || "")}" /></label>
      <button type="submit" class="primary-button">查询</button>
    </div><div class="link-data-toolbar-filters">
      <select name="platform"><option value="">全部平台</option>${platforms.map((item) => `<option value="${escapeHtml(item)}" ${filters.platform === item ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}</select>
      <select name="shopId"><option value="">全部店铺</option>${shops.map((item) => `<option value="${escapeHtml(item.id)}" ${filters.shopId === item.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}</select>
      <select name="archiveStatus"><option value="">全部档案状态</option><option value="active" ${filters.archiveStatus === "active" ? "selected" : ""}>正常</option><option value="paused" ${filters.archiveStatus === "paused" ? "selected" : ""}>暂停</option><option value="archived" ${filters.archiveStatus === "archived" ? "selected" : ""}>归档</option></select>
      <button type="button" class="text-button" data-clear-link-data-filters>清除筛选</button>${columnSettingHtml}
    </div></form>
    <p class="link-data-source-note">销售来源：真实销售事实${dataSource.maxDate ? ` · 当前数据至 ${escapeHtml(dataSource.maxDate)}` : " · 暂无销售数据"}</p>
  </section>`;
}

registerUiModule({ moduleKey: "link_data_toolbar", name: "LinkDataToolbar", domain: "business_links",
  description: "提供链接经营数据表搜索、服务端筛选、时间范围和字段设置入口。", render: renderLinkDataToolbar,
  configSchema: { scopes: ["mine", "company"], ranges: ["7d", "30d", "custom"] }, dependencies: ["QueryLinkDataTable", "LinkColumnSetting"] });
