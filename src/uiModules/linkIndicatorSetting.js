import { registerUiModule } from "../uiModuleRegistry.js";
import { escapeHtml } from "../utils/html.js";

export function reorderVisibleLinkBusinessField(fieldOrder = [], visibleFields = [], sourceField = "", targetField = "", position = "before") {
  const order = [...new Set([...fieldOrder, ...visibleFields])];
  const visibleSet = new Set(visibleFields);
  const selected = order.filter((key) => visibleSet.has(key));
  if (!sourceField || !targetField || sourceField === targetField || !selected.includes(sourceField) || !selected.includes(targetField)) {
    return { fieldOrder: order, visibleFields: selected };
  }
  selected.splice(selected.indexOf(sourceField), 1);
  const targetIndex = selected.indexOf(targetField) + (position === "after" ? 1 : 0);
  selected.splice(targetIndex, 0, sourceField);
  let selectedIndex = 0;
  return { fieldOrder: order.map((key) => visibleSet.has(key) ? selected[selectedIndex++] : key), visibleFields: selected };
}

export function renderLinkIndicatorSetting({ groups = [], visibleFields = [], fieldOrder = [], open = false } = {}) {
  const visible = new Set(visibleFields);
  const columns = new Map(groups.flatMap((group) => group.columns).map((column) => [column.key, column]));
  const selected = [...new Set([...fieldOrder, ...visibleFields])].filter((key) => visible.has(key) && columns.has(key));
  return `<div class="link-indicator-setting-module ${open ? "is-open" : ""}" data-module-key="link_indicator_setting">
    <button type="button" class="secondary-button" data-toggle-link-indicators>指标设置 <b>${visible.size}</b></button>
    ${open ? `<div class="link-indicator-backdrop" data-close-link-indicators></div><aside role="dialog" aria-modal="true" aria-label="指标设置"><header><div><h3>指标设置</h3><p>选择字段，并设置表格从左到右的展示顺序</p></div><button type="button" class="icon-button" data-close-link-indicators aria-label="关闭">×</button></header>
      <section class="link-indicator-selected"><header><div><strong>已选字段排序</strong><small>按住字段拖动，顺序对应表格从左到右</small></div><span>${selected.length} 项</span></header>
        <ol>${selected.map((key, index) => `<li draggable="true" data-selected-link-business-field="${escapeHtml(key)}"><i aria-hidden="true">⋮⋮</i><b>${index + 1}</b><span>${escapeHtml(columns.get(key)?.label || key)}</span></li>`).join("")}</ol>
      </section>
      <div class="link-indicator-groups">${groups.map((group) => `<section><div><strong>${escapeHtml(group.label)}</strong>${group.note ? `<small>${escapeHtml(group.note)}</small>` : ""}</div><div>${group.columns.map((column) => `<label><input type="checkbox" value="${escapeHtml(column.key)}" data-link-business-field ${visible.has(column.key) ? "checked" : ""}/><span>${escapeHtml(column.label)}</span></label>`).join("")}</div></section>`).join("")}</div>
      <footer><button type="button" class="text-button" data-reset-link-business-fields>恢复默认</button><span>已选 ${visible.size} 项</span><button type="button" class="primary-button" data-save-link-business-fields>确认</button></footer></aside>` : ""}
  </div>`;
}

registerUiModule({ moduleKey: "link_indicator_setting", name: "LinkIndicatorSetting", domain: "business_links",
  description: "按指标分类维护链接经营分析表的字段显隐与展示顺序。", render: renderLinkIndicatorSetting,
  configSchema: { storage: "localStorage", groups: "indicator[]", fieldOrder: "string[]" }, dependencies: ["LinkBusinessTable"] });
