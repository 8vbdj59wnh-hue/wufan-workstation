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

function renderDailyCompleteness(data = {}) {
  const completeness = data.dailyCompleteness;
  if (!completeness) return "";
  const labels = { not_imported: "未导入", imported_no_data: "已导入未更新", updating: "更新中", update_failed: "更新失败", pending: "待完成" };
  const issueRows = (completeness.issues || []).map((item) => `<tr><td><strong>${escapeHtml(displayDay(item.date))}</strong></td><td><span class="daily-data-status is-${escapeHtml(item.status)}">${escapeHtml(labels[item.status] || item.status)}</span></td><td>${escapeHtml(item.reason || "—")}</td><td>${escapeHtml(displayDateTime(item.updatedAt))}</td></tr>`).join("");
  const coverage = completeness.coverageRate == null ? "—" : `${(Number(completeness.coverageRate) * 100).toFixed(1)}%`;
  return `<section class="link-daily-completeness">
    <header><div><span>销售日报完整性</span><strong>${escapeHtml(completeness.startDate || "—")} 至 ${escapeHtml(completeness.endDate || "—")}</strong><small>按天检查是否已导入并形成销售日报事实，今天不计入缺失。</small></div><em class="${Number(completeness.issueCount || 0) ? "is-warning" : "is-ok"}">${Number(completeness.issueCount || 0) ? `${Number(completeness.issueCount)} 天待补` : "每日数据完整"}</em></header>
    <dl><div><dt>应更新</dt><dd>${Number(completeness.expectedDays || 0)} 天</dd></div><div><dt>已更新</dt><dd>${Number(completeness.updatedCount || 0)} 天</dd></div><div><dt>完整率</dt><dd>${escapeHtml(coverage)}</dd></div><div><dt>连续缺失</dt><dd>${Number(completeness.consecutiveMissingDays || 0)} 天</dd></div><div><dt>未导入</dt><dd>${Number(completeness.counts?.notImported || 0)} 天</dd></div><div><dt>导入未形成数据</dt><dd>${Number(completeness.counts?.importedNoData || 0)} 天</dd></div></dl>
    ${issueRows ? `<div class="link-daily-missing-table"><table><thead><tr><th>缺失日期</th><th>状态</th><th>判断说明</th><th>最近处理时间</th></tr></thead><tbody>${issueRows}</tbody></table></div>` : `<div class="link-daily-complete-empty"><strong>检查范围内没有缺失日期</strong><span>每天均已形成销售日报数据。</span></div>`}
  </section>`;
}

export function renderLinkDataStatus({ state = {}, showDailyCompleteness = false } = {}) {
  const status = state.data ?? {};
  if (state.error) return `<section class="link-data-status-module" data-module-key="link_data_status"><header><div><span>数据状态</span><strong>暂时无法读取</strong></div></header><p class="form-error">${escapeHtml(state.error)}</p></section>`;
  return `<div class="link-data-status-stack" data-module-key="link_data_status"><section class="link-data-status-module is-${escapeHtml(status.status || "unknown")}">
    <header><div><span>数据状态</span><strong>${escapeHtml(status.statusLabel || (state.loading ? "读取中" : "暂无数据"))}</strong></div>${status.hasExceptions ? `<em>有 ${Number(status.exceptionCount || 0)} 项异常</em>` : `<em class="is-ok">无待处理异常</em>`}</header>
    <dl><div><dt>最新数据</dt><dd>${escapeHtml(status.latestDataDate || "暂无记录")}</dd></div><div><dt>更新时间</dt><dd>${escapeHtml(displayDateTime(status.lastUpdatedAt))}</dd></div><div><dt>异常</dt><dd>${Number(status.exceptionCount || 0)}</dd></div></dl>
  </section>${showDailyCompleteness ? renderDailyCompleteness(status) : ""}</div>`;
}

registerUiModule({
  moduleKey: "link_data_status",
  name: "LinkDataStatus",
  domain: "business_links",
  description: "面向经营人员展示链接数据日期、更新时间、更新状态、异常摘要与销售日报逐日完整性。",
  render: renderLinkDataStatus,
  configSchema: { showDailyCompleteness: "boolean" },
  dependencies: ["LinkDataStatus"],
});
