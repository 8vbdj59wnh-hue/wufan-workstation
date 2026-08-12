import { registerUiModule } from "../uiModuleRegistry.js";
import { escapeHtml } from "../utils/html.js";

export function renderLinkColumnSetting({ columns = [], visibleFields = [], open = false } = {}) {
  const visible = new Set(visibleFields);
  return `<details class="link-column-setting-module" data-module-key="link_column_setting" ${open ? "open" : ""}><summary>字段设置</summary>
    <div class="link-column-setting-list">${columns.map((column, index) => `<div>
      <label><input type="checkbox" value="${escapeHtml(column.key)}" data-link-table-field ${visible.has(column.key) ? "checked" : ""} />${escapeHtml(column.label)}</label>
      <span><button type="button" class="text-button" data-move-link-field="${escapeHtml(column.key)}" data-direction="up" ${index === 0 ? "disabled" : ""}>↑</button><button type="button" class="text-button" data-move-link-field="${escapeHtml(column.key)}" data-direction="down" ${index === columns.length - 1 ? "disabled" : ""}>↓</button></span>
    </div>`).join("")}</div><footer><button type="button" class="secondary-button" data-reset-link-fields>恢复默认</button><button type="button" class="primary-button" data-save-link-fields>保存</button></footer>
  </details>`;
}

registerUiModule({ moduleKey: "link_column_setting", name: "LinkColumnSetting", domain: "business_links",
  description: "维护链接经营数据表的本地字段显隐和顺序。", render: renderLinkColumnSetting,
  configSchema: { storage: "localStorage" }, dependencies: ["LinkDataTable"] });
