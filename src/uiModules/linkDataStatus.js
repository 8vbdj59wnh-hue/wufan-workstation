import { registerUiModule } from "../uiModuleRegistry.js";
import { escapeHtml } from "../utils/html.js";

function displayDateTime(value) {
  if (!value) return "暂无记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-CN", { hour12: false });
}

function displayDay(value) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00Z`);
  const weekday = Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("zh-CN", { weekday: "short", timeZone: "UTC" });
  return `${value}${weekday ? ` · ${weekday}` : ""}`;
}

function businessSourceText(value) {
  const text = String(value || "");
  if (/WDT_API_URL|WDT_SID|WDT_KEY|WDT_SALT/.test(text)) return "旺店通连接尚未配置，请联系管理员完成接口设置。";
  return text.replaceAll("API", "接口");
}

function renderMatrixCell(cell = {}) {
  const symbol = ({ completed: "✓", no_change: "✓", partial: "◐", pending_review: "◷", updating: "↻", failed: "✕", missing: "✕" })[cell.status] || "—";
  const coverage = cell.status === "partial" && cell.expectedShopCount
    ? `<small>${Number(cell.completedShopCount || 0)}/${Number(cell.expectedShopCount)} 家店铺</small>` : "";
  return `<span class="daily-source-status is-${escapeHtml(cell.status || "missing")}" title="${escapeHtml(businessSourceText(cell.detail))}"><b>${symbol}</b><span>${escapeHtml(businessSourceText(cell.label || "未完成"))}</span>${coverage}</span>`;
}

function renderDailySourceMatrix(data = {}) {
  const matrix = data.dailySourceMatrix;
  if (!matrix) return "";
  const options = (matrix.shopOptions || []).map((shop) => `<option value="${escapeHtml(shop.id)}" ${matrix.selectedShopId === shop.id ? "selected" : ""}>${escapeHtml(shop.name)} · ${escapeHtml(shop.platform)}</option>`).join("");
  const headers = (matrix.columns || []).map((column) => `<th><span>${escapeHtml(businessSourceText(column.label))}</span>${column.scope === "global" ? `<small>企业级</small>` : ""}</th>`).join("");
  const rows = (matrix.rows || []).map((row) => `<tr><td><strong>${escapeHtml(displayDay(row.date))}</strong></td>${(matrix.columns || []).map((column) => `<td>${renderMatrixCell(row.sources?.[column.key])}</td>`).join("")}</tr>`).join("");
  return `<section class="link-daily-source-matrix">
    <header><div><span>每日数据更新</span><strong>${escapeHtml(matrix.startDate || "—")} 至 ${escapeHtml(matrix.endDate || "—")}</strong><small>今天不计入检查；店铺筛选仅影响具有店铺归属的前两类数据。</small></div><label><span>店铺</span><select data-link-data-status-shop ${data.loading ? "disabled" : ""}><option value="">全部店铺</option>${options}</select></label></header>
    <div class="daily-source-legend"><span class="is-completed">✓ 已完成 / 无变化</span><span class="is-partial">◐ 部分未完成 / 待确认</span><span class="is-missing">✕ 未执行 / 同步失败</span></div>
    <div class="link-daily-source-table"><table><thead><tr><th>日期</th>${headers}</tr></thead><tbody>${rows || `<tr><td colspan="${Number(matrix.columns?.length || 0) + 1}">暂无可检查日期</td></tr>`}</tbody></table></div>
  </section>`;
}

export function renderLinkDataStatus({ state = {}, showDailyCompleteness = false } = {}) {
  const status = state.data ?? {};
  if (state.error) return `<section class="link-data-status-module" data-module-key="link_data_status"><header><div><span>数据状态</span><strong>暂时无法读取</strong></div></header><p class="form-error">${escapeHtml(state.error)}</p></section>`;
  return `<div class="link-data-status-stack" data-module-key="link_data_status"><section class="link-data-status-module is-${escapeHtml(status.status || "unknown")}">
    <header><div><span>数据状态</span><strong>${escapeHtml(status.statusLabel || (state.loading ? "读取中" : "暂无数据"))}</strong></div>${status.hasExceptions ? `<em>有 ${Number(status.exceptionCount || 0)} 项异常</em>` : `<em class="is-ok">无待处理异常</em>`}</header>
    <dl><div><dt>最新数据</dt><dd>${escapeHtml(status.latestDataDate || "暂无记录")}</dd></div><div><dt>更新时间</dt><dd>${escapeHtml(displayDateTime(status.lastUpdatedAt))}</dd></div><div><dt>异常</dt><dd>${Number(status.exceptionCount || 0)}</dd></div></dl>
  </section>${showDailyCompleteness ? renderDailySourceMatrix({ ...status, loading: state.loading }) : ""}</div>`;
}

registerUiModule({
  moduleKey: "link_data_status",
  name: "LinkDataStatus",
  domain: "business_links",
  description: "面向经营人员展示链接数据更新状态与按店铺筛选的每日数据源完整性。",
  render: renderLinkDataStatus,
  configSchema: { showDailyCompleteness: "boolean" },
  dependencies: ["LinkDataStatus"],
});
