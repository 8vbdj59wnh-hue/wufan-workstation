import { registerUiModule } from "../uiModuleRegistry.js";
import { escapeHtml } from "../utils/html.js?v=20260802-module-boundary1";

export function renderLinkIndicatorSetting({ groups = [], visibleFields = [], open = false } = {}) {
  const visible = new Set(visibleFields);
  return `<div class="link-indicator-setting-module ${open ? "is-open" : ""}" data-module-key="link_indicator_setting">
    <button type="button" class="secondary-button" data-toggle-link-indicators>指标设置 <b>${visible.size}</b></button>
    ${open ? `<div class="link-indicator-backdrop" data-close-link-indicators></div><aside role="dialog" aria-modal="true" aria-label="指标设置"><header><div><h3>指标设置</h3><p>选择经营分析表展示的字段</p></div><button type="button" class="icon-button" data-close-link-indicators aria-label="关闭">×</button></header>
      <div class="link-indicator-groups">${groups.map((group) => `<section><div><strong>${escapeHtml(group.label)}</strong>${group.note ? `<small>${escapeHtml(group.note)}</small>` : ""}</div><div>${group.columns.map((column) => `<label><input type="checkbox" value="${escapeHtml(column.key)}" data-link-business-field ${visible.has(column.key) ? "checked" : ""}/><span>${escapeHtml(column.label)}</span></label>`).join("")}</div></section>`).join("")}</div>
      <footer><button type="button" class="text-button" data-reset-link-business-fields>恢复默认</button><span>已选 ${visible.size} 项</span><button type="button" class="primary-button" data-save-link-business-fields>确认</button></footer></aside>` : ""}
  </div>`;
}

registerUiModule({ moduleKey: "link_indicator_setting", name: "LinkIndicatorSetting", domain: "business_links",
  description: "按指标分类维护链接经营分析表的字段显隐。", render: renderLinkIndicatorSetting,
  configSchema: { storage: "localStorage", groups: "indicator[]" }, dependencies: ["LinkBusinessTable"] });
