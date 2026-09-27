import { apiBaseUrl, authFetch } from "./appState.js";

let monitorState = { status: "idle", range: "6h", overview: null, error: "", loadedAt: null };
let refreshTimer = null;

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / (1024 ** index)).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function formatDuration(value) {
  const milliseconds = Number(value || 0);
  return milliseconds >= 1000 ? `${(milliseconds / 1000).toFixed(2)} s` : `${Math.round(milliseconds)} ms`;
}

function formatTime(value) {
  if (!value) return "暂无";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "暂无" : date.toLocaleString("zh-CN", { hour12: false });
}

function metricTone(value, warning = 70, critical = 85) {
  return value >= critical ? "critical" : value >= warning ? "warning" : "healthy";
}

function renderMetricCard(label, value, detail, tone = "healthy") {
  return `<article class="system-monitor-metric is-${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></article>`;
}

function renderAlerts(alerts = []) {
  if (!alerts.length) return `<div class="system-monitor-empty is-healthy"><strong>当前运行正常</strong><span>未检测到资源、接口或数据同步告警。</span></div>`;
  return `<div class="system-monitor-alerts">${alerts.map((alert) => `<article class="is-${escapeHtml(alert.level)}"><span></span><div><strong>${alert.level === "critical" ? "紧急告警" : "需要关注"}</strong><p>${escapeHtml(alert.message)}</p></div></article>`).join("")}</div>`;
}

function renderSlowRoutes(routes = []) {
  if (!routes.length) return `<div class="system-monitor-empty"><strong>暂无接口样本</strong><span>有请求后将在这里显示慢接口。</span></div>`;
  return `<div class="system-monitor-table-wrap"><table class="system-monitor-table"><thead><tr><th>接口</th><th>请求数</th><th>平均耗时</th><th>最慢</th><th>5xx</th></tr></thead><tbody>${routes.map((item) => `<tr><td>${escapeHtml(item.route)}</td><td>${Number(item.requestCount || 0).toLocaleString()}</td><td>${formatDuration(item.averageDurationMs)}</td><td>${formatDuration(item.maxDurationMs)}</td><td>${Number(item.errorCount || 0)}</td></tr>`).join("")}</tbody></table></div>`;
}

export function renderSystemMonitor() {
  if (monitorState.status === "idle" || (monitorState.status === "loading" && monitorState.overview === null)) {
    return `<section class="settings-section system-monitor-page" id="system-monitor" aria-busy="true"><div class="system-monitor-loading"><span></span><strong>正在读取服务器状态…</strong></div></section>`;
  }
  if (monitorState.overview === null) {
    return `<section class="settings-section system-monitor-page" id="system-monitor"><div class="system-monitor-empty is-error"><strong>监控数据读取失败</strong><span>${escapeHtml(monitorState.error || "请稍后重试。")}</span><button class="secondary-button" type="button" data-system-monitor-refresh>重新读取</button></div></section>`;
  }
  const overview = monitorState.overview;
  const system = overview.system ?? {};
  const api = overview.api ?? {};
  const database = overview.database ?? {};
  const data = overview.data ?? {};
  const memoryPercent = Number(system.memoryPercent || 0);
  const diskPercent = Number(system.diskPercent || 0);
  const cpuPercent = Number(system.cpuPercent || 0);
  return `<section class="settings-section system-monitor-page" id="system-monitor">
    <div class="system-monitor-toolbar">
      <div><span class="system-monitor-live"><i></i>实时监控</span><small>最后更新 ${escapeHtml(formatTime(overview.generatedAt))}</small></div>
      <div class="system-monitor-toolbar-actions"><div class="system-monitor-range" role="group" aria-label="时间范围">${[["1h", "1小时"], ["6h", "6小时"], ["24h", "24小时"]].map(([value, label]) => `<button type="button" data-system-monitor-range="${value}" class="${monitorState.range === value ? "is-active" : ""}">${label}</button>`).join("")}</div><button class="secondary-button" type="button" data-system-monitor-refresh ${monitorState.status === "loading" ? "disabled" : ""}>刷新</button></div>
    </div>
    <div class="system-monitor-metrics">
      ${renderMetricCard("CPU", formatPercent(cpuPercent), `${system.cpuCount || 0} 核 · 负载 ${Number(system.load1 || 0).toFixed(2)}`, metricTone(cpuPercent))}
      ${renderMetricCard("内存", formatPercent(memoryPercent), `${formatBytes(system.memoryUsedBytes)} / ${formatBytes(system.memoryTotalBytes)}`, metricTone(memoryPercent))}
      ${renderMetricCard("磁盘", formatPercent(diskPercent), `剩余 ${formatBytes(Number(system.diskTotalBytes || 0) - Number(system.diskUsedBytes || 0))}`, metricTone(diskPercent))}
      ${renderMetricCard("API P95", formatDuration(api.p95Ms), `${Number(api.requestCount || 0).toLocaleString()} 次请求 · 5xx ${formatPercent(api.errorRate)}`, Number(api.p95Ms || 0) >= 1000 ? "warning" : "healthy")}
    </div>
    <div class="system-monitor-grid">
      <article class="system-monitor-panel system-monitor-trend-panel"><header><div><h3>资源趋势</h3><p>CPU 与内存使用率</p></div><div class="system-monitor-legend"><span class="cpu">CPU</span><span class="memory">内存</span></div></header><canvas data-system-monitor-chart aria-label="服务器资源趋势图"></canvas></article>
      <article class="system-monitor-panel"><header><div><h3>核心服务</h3><p>当前实例与数据状态</p></div></header><div class="system-monitor-services">
        <div><i class="is-online"></i><span><strong>API 服务</strong><small>PID ${Number(overview.service?.pid || 0)} · ${escapeHtml(overview.service?.nodeVersion || "")}</small></span><b>运行中</b></div>
        <div><i class="${database.status === "ok" ? "is-online" : "is-warning"}"></i><span><strong>SQLite</strong><small>${formatBytes(database.bytes)} · WAL ${formatBytes(database.walBytes)}</small></span><b>${database.status === "ok" ? "正常" : "待核对"}</b></div>
        <div><i class="${data.available ? "is-online" : "is-warning"}"></i><span><strong>业务数据</strong><small>最近同步 ${escapeHtml(formatTime(data.latestSync?.syncedAt))}</small></span><b>${data.openExceptions === null ? "未知" : `${Number(data.openExceptions || 0)} 条异常`}</b></div>
        <div><i class="is-online"></i><span><strong>进程内存</strong><small>Heap ${formatBytes(system.processHeapUsedBytes)}</small></span><b>${formatBytes(system.processRssBytes)}</b></div>
      </div></article>
      <article class="system-monitor-panel system-monitor-alert-panel"><header><div><h3>当前告警</h3><p>仅展示状态，不自动执行任何操作</p></div></header>${renderAlerts(overview.alerts)}</article>
      <article class="system-monitor-panel system-monitor-api-panel"><header><div><h3>慢接口</h3><p>按平均响应时间排序</p></div><div class="system-monitor-percentiles"><span>P50 <b>${formatDuration(api.p50Ms)}</b></span><span>P99 <b>${formatDuration(api.p99Ms)}</b></span></div></header>${renderSlowRoutes(api.slowRoutes)}</article>
    </div>
    <p class="system-monitor-footnote">采集间隔 15 秒 · 原始资源数据保留 ${Number(overview.retention?.rawDays || 7)} 天 · API 聚合数据保留 ${Number(overview.retention?.apiDays || 30)} 天 · 监控库与业务库隔离</p>
  </section>`;
}

async function loadOverview(rerender, { quiet = false } = {}) {
  if (!quiet) monitorState = { ...monitorState, status: "loading", error: "" };
  if (!quiet) rerender();
  try {
    const response = await authFetch(`${apiBaseUrl}/api/system-monitor/overview?range=${encodeURIComponent(monitorState.range)}`);
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success !== true) throw new Error(result.message || "读取失败");
    monitorState = { ...monitorState, status: "ready", overview: result.overview, error: "", loadedAt: new Date().toISOString() };
  } catch (error) {
    monitorState = { ...monitorState, status: "error", error: error.message || "读取失败" };
  }
  rerender();
}

function drawChart(canvas, trends = []) {
  if (!canvas || trends.length < 2) return;
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(320, rect.width);
  const height = Math.max(190, rect.height || 230);
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const context = canvas.getContext("2d");
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);
  const padding = { left: 34, right: 18, top: 18, bottom: 26 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  context.strokeStyle = "#e9edf4";
  context.lineWidth = 1;
  context.font = "11px system-ui";
  context.fillStyle = "#8a95a8";
  for (let value = 0; value <= 100; value += 25) {
    const y = padding.top + plotHeight - (value / 100) * plotHeight;
    context.beginPath(); context.moveTo(padding.left, y); context.lineTo(width - padding.right, y); context.stroke();
    context.fillText(`${value}%`, 2, y + 4);
  }
  const drawLine = (key, color) => {
    context.beginPath();
    trends.forEach((item, index) => {
      const x = padding.left + (index / (trends.length - 1)) * plotWidth;
      const y = padding.top + plotHeight - clampChartValue(item[key]) / 100 * plotHeight;
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    });
    context.strokeStyle = color; context.lineWidth = 2; context.lineJoin = "round"; context.lineCap = "round"; context.stroke();
  };
  drawLine("cpuPercent", "#2f6fec");
  drawLine("memoryPercent", "#14a57a");
}

function clampChartValue(value) { return Math.min(100, Math.max(0, Number(value || 0))); }

export function bindSystemMonitorEvents(rerender) {
  const root = document.querySelector(".system-monitor-page");
  if (root === null) {
    if (refreshTimer !== null) window.clearInterval(refreshTimer);
    refreshTimer = null;
    return;
  }
  drawChart(root.querySelector("[data-system-monitor-chart]"), monitorState.overview?.trends ?? []);
  root.querySelector("[data-system-monitor-refresh]")?.addEventListener("click", () => loadOverview(rerender));
  root.querySelectorAll("[data-system-monitor-range]").forEach((button) => button.addEventListener("click", () => {
    monitorState = { ...monitorState, range: button.dataset.systemMonitorRange || "6h" };
    loadOverview(rerender);
  }));
  if (monitorState.status === "idle") void loadOverview(rerender);
  if (refreshTimer === null) {
    refreshTimer = window.setInterval(() => {
      if (document.querySelector(".system-monitor-page") === null) {
        window.clearInterval(refreshTimer);
        refreshTimer = null;
        return;
      }
      void loadOverview(rerender, { quiet: true });
    }, 15_000);
  }
}

