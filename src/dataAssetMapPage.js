import {
  loadDataAssetDetail,
  loadDataAssetGraph,
  loadDataAssetMapOverview,
  loadDataAssetObjects,
  loadDataAssetSources,
} from "./services/dataAssetMapService.js";

const viewLabels = { overview: "总览", sources: "数据源", objects: "业务对象", relations: "关系地图" };
const truthLabels = { source_of_truth: "Source of Truth", derived: "Derived", legacy: "Legacy" };
const typeLabels = { file: "文件导入", api: "API同步", internal: "系统内部", master: "主数据", fact: "事实", relation: "关系", derived: "派生" };
const state = { view: "overview", loading: false, error: "", overview: null, sources: null, objects: null, graphs: {}, detail: null, page: 1, keyword: "" };

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function formatCount(value) {
  return value === null || value === undefined ? "按查询派生" : Number(value).toLocaleString("zh-CN");
}

function renderGeneratedAt(value) {
  return value ? `<span class="data-asset-map-time">统计时间：${escapeHtml(new Date(value).toLocaleString("zh-CN"))}</span>` : "";
}

function renderOverview() {
  if (!state.overview) return renderLoading();
  const item = state.overview;
  return `<section class="data-asset-overview">
    <div class="data-asset-metrics">
      <article><span>数据源</span><strong>${formatCount(item.dataSourceCount)}</strong></article>
      <article><span>业务对象</span><strong>${formatCount(item.businessObjectCount)}</strong></article>
      <article><span>数据表</span><strong>${formatCount(item.tableCount)}</strong></article>
      <article><span>真相源对象</span><strong>${formatCount(item.truthSourceCount)}</strong></article>
    </div>
    <div class="data-asset-panel"><h3>数据表分类</h3><div class="data-asset-category-list">
      <span>主数据 <strong>${formatCount(item.tableCategories.master)}</strong></span>
      <span>事实数据 <strong>${formatCount(item.tableCategories.fact)}</strong></span>
      <span>关系数据 <strong>${formatCount(item.tableCategories.relation)}</strong></span>
      <span>其他资产 <strong>${formatCount(item.tableCategories.other)}</strong></span>
    </div></div>${renderGeneratedAt(item.generatedAt)}
  </section>`;
}

function renderPager(payload) {
  return `<div class="data-asset-pager"><span>共 ${payload.total} 项</span><div><button type="button" data-asset-page="${payload.page - 1}" ${payload.page <= 1 ? "disabled" : ""}>上一页</button><span>${payload.page} / ${payload.totalPages}</span><button type="button" data-asset-page="${payload.page + 1}" ${payload.page >= payload.totalPages ? "disabled" : ""}>下一页</button></div></div>`;
}

function renderSources() {
  if (!state.sources) return renderLoading();
  return `<section><div class="data-asset-toolbar"><input type="search" data-asset-keyword value="${escapeHtml(state.keyword)}" placeholder="搜索数据源"/><button type="button" data-asset-search>搜索</button></div>
    <div class="data-asset-list">${state.sources.items.map((item) => `<button type="button" class="data-asset-row" data-asset-detail-kind="sources" data-asset-detail-id="${escapeHtml(item.id)}"><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.purpose)}</small></span><span>${escapeHtml(typeLabels[item.type] ?? item.type)}</span><span class="data-asset-status">${item.status === "active" ? "正常" : escapeHtml(item.status)}</span></button>`).join("")}</div>
    ${renderPager(state.sources)}${renderGeneratedAt(state.sources.generatedAt)}</section>`;
}

function renderObjects() {
  if (!state.objects) return renderLoading();
  return `<section><div class="data-asset-toolbar"><input type="search" data-asset-keyword value="${escapeHtml(state.keyword)}" placeholder="搜索业务对象"/><button type="button" data-asset-search>搜索</button></div>
    <div class="data-asset-list">${state.objects.items.map((item) => `<button type="button" class="data-asset-row" data-asset-detail-kind="objects" data-asset-detail-id="${escapeHtml(item.id)}"><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.definition)}</small></span><span>${escapeHtml(typeLabels[item.type] ?? item.type)}</span><span><strong>${formatCount(item.count)}</strong><small>${escapeHtml(truthLabels[item.truthStatus])}</small></span></button>`).join("")}</div>
    ${renderPager(state.objects)}${renderGeneratedAt(state.objects.generatedAt)}</section>`;
}

function renderRelations() {
  const graphIds = ["product_sales", "sales_operations", "erp_inventory"];
  if (graphIds.some((id) => !state.graphs[id])) return renderLoading();
  return `<section class="data-asset-graphs">${graphIds.map((id) => { const graph = state.graphs[id]; return `<article class="data-asset-panel"><h3>${escapeHtml(graph.name)}</h3><div class="data-asset-flow">${graph.nodes.map((node, index) => `${index ? '<span class="data-asset-arrow">↓</span>' : ""}<button type="button" data-asset-detail-kind="objects" data-asset-detail-id="${escapeHtml(node.id)}"><strong>${escapeHtml(node.name)}</strong><small>${formatCount(node.count)} · ${escapeHtml(truthLabels[node.truthStatus])}</small></button>`).join("")}</div>${renderGeneratedAt(graph.generatedAt)}</article>`; }).join("")}</section>`;
}

function renderLoading() {
  return `<div class="empty-detail" aria-live="polite">正在读取数据资产…</div>`;
}

function renderDetail() {
  if (!state.detail) return "";
  const item = state.detail;
  const tableRows = (item.tableCounts ?? []).map((row) => `<li><code>${escapeHtml(row.table)}</code><span>${row.exists ? `${formatCount(row.count)} 条` : "当前Schema不存在"}</span></li>`).join("");
  const mappings = (item.fieldMappings ?? []).map((row) => `<tr><td>${escapeHtml(row.sourceField)}</td><td><code>${escapeHtml(row.systemField)}</code></td><td>${escapeHtml(row.meaning)}</td></tr>`).join("");
  return `<div class="data-asset-detail-backdrop" data-asset-close><aside class="data-asset-detail" role="dialog" aria-modal="true"><button type="button" class="modal-close" data-asset-close aria-label="关闭">×</button><span class="eyebrow">只读数据资产</span><h2>${escapeHtml(item.name)}</h2><p>${escapeHtml(item.definition ?? item.purpose)}</p>
    ${item.truthStatus ? `<p><span class="data-asset-truth">${escapeHtml(truthLabels[item.truthStatus])}</span> · ${formatCount(item.count)}</p>` : ""}
    ${tableRows ? `<h3>数据表</h3><ul class="data-asset-table-counts">${tableRows}</ul>` : ""}
    ${mappings ? `<h3>字段关系</h3><div class="table-scroll"><table><thead><tr><th>来源字段</th><th>系统字段</th><th>业务解释</th></tr></thead><tbody>${mappings}</tbody></table></div>` : ""}
    <div class="data-asset-lineage"><div><h3>上游</h3><p>${escapeHtml((item.upstream ?? item.sources ?? []).join("、") || "无")}</p></div><div><h3>下游</h3><p>${escapeHtml((item.downstream ?? []).join("、") || "无")}</p></div></div>${renderGeneratedAt(item.generatedAt)}</aside></div>`;
}

export function renderDataAssetMap() {
  return `<div class="data-asset-map"><div class="data-asset-tabs">${Object.entries(viewLabels).map(([id, label]) => `<button type="button" data-asset-view="${id}" class="${state.view === id ? "is-active" : ""}">${label}</button>`).join("")}</div>
    ${state.error ? `<div class="error-message">${escapeHtml(state.error)}</div>` : ""}
    ${state.view === "overview" ? renderOverview() : state.view === "sources" ? renderSources() : state.view === "objects" ? renderObjects() : renderRelations()}
    ${renderDetail()}</div>`;
}

async function loadCurrent(rerender) {
  state.loading = true; state.error = ""; rerender();
  try {
    if (state.view === "overview") state.overview = await loadDataAssetMapOverview();
    if (state.view === "sources") state.sources = await loadDataAssetSources({ page: state.page, pageSize: 20, keyword: state.keyword });
    if (state.view === "objects") state.objects = await loadDataAssetObjects({ page: state.page, pageSize: 20, keyword: state.keyword });
    if (state.view === "relations") {
      const ids = ["product_sales", "sales_operations", "erp_inventory"];
      const values = await Promise.all(ids.map(loadDataAssetGraph));
      ids.forEach((id, index) => { state.graphs[id] = values[index]; });
    }
  } catch (error) { state.error = error.message || "数据资产读取失败。"; }
  finally { state.loading = false; rerender(); }
}

export function bindDataAssetMapEvents(rerender) {
  if (state.view === "overview" && !state.overview && !state.loading) void loadCurrent(rerender);
  document.querySelectorAll("[data-asset-view]").forEach((button) => button.addEventListener("click", () => { state.view = button.dataset.assetView; state.page = 1; state.keyword = ""; void loadCurrent(rerender); }));
  document.querySelector("[data-asset-search]")?.addEventListener("click", () => { state.keyword = document.querySelector("[data-asset-keyword]")?.value?.trim() ?? ""; state.page = 1; void loadCurrent(rerender); });
  document.querySelector("[data-asset-keyword]")?.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); document.querySelector("[data-asset-search]")?.click(); } });
  document.querySelectorAll("[data-asset-page]").forEach((button) => button.addEventListener("click", () => { state.page = Number(button.dataset.assetPage); void loadCurrent(rerender); }));
  document.querySelectorAll("[data-asset-detail-id]").forEach((button) => button.addEventListener("click", async () => { try { state.detail = await loadDataAssetDetail(button.dataset.assetDetailKind, button.dataset.assetDetailId); rerender(); } catch (error) { state.error = error.message; rerender(); } }));
  document.querySelectorAll("[data-asset-close]").forEach((button) => button.addEventListener("click", (event) => { if (event.target !== button) return; state.detail = null; rerender(); }));
}
