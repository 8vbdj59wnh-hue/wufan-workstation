import { registerUiModule } from "../uiModuleRegistry.js";
import { escapeHtml } from "../utils/html.js";

function displayDateTime(value) {
  if (!value) return "暂无记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-CN", { hour12: false });
}

export function renderLinkDataStatus({ state = {} } = {}) {
  const status = state.data ?? {};
  if (state.error) return `<section class="link-data-status-module" data-module-key="link_data_status"><header><div><span>数据状态</span><strong>暂时无法读取</strong></div></header><p class="form-error">${escapeHtml(state.error)}</p></section>`;
  return `<section class="link-data-status-module is-${escapeHtml(status.status || "unknown")}" data-module-key="link_data_status">
    <header><div><span>数据状态</span><strong>${escapeHtml(status.statusLabel || (state.loading ? "读取中" : "暂无数据"))}</strong></div>${status.hasExceptions ? `<em>有 ${Number(status.exceptionCount || 0)} 项异常</em>` : `<em class="is-ok">无待处理异常</em>`}</header>
    <dl><div><dt>最新数据</dt><dd>${escapeHtml(status.latestDataDate || "暂无记录")}</dd></div><div><dt>更新时间</dt><dd>${escapeHtml(displayDateTime(status.lastUpdatedAt))}</dd></div><div><dt>异常</dt><dd>${Number(status.exceptionCount || 0)}</dd></div></dl>
  </section>`;
}

registerUiModule({
  moduleKey: "link_data_status",
  name: "LinkDataStatus",
  domain: "business_links",
  description: "面向经营人员展示链接数据日期、更新时间、更新状态与异常摘要。",
  render: renderLinkDataStatus,
  configSchema: {},
  dependencies: ["LinkDataStatus"],
});
