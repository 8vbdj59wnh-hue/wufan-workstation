import { getCurrentUser, loadDataCenterProductDetail, loadDataCenterView, resolveAssetUrl } from "./appState.js";
import { canAccessModule } from "./permissions.js";

let view = "trends";
let loading = false;
let error = "";
let result = null;
let detail = null;
let query = { search: "", page: 1, pageSize: 48, direction: "focus", status: "", sort: "" };

const viewConfig = {
  trends: { label: "趋势变化", endpoint: "trends", description: "识别产品sales30d历史序列的上涨、下滑、稳定和数据不足。" },
  "slow-moving": { label: "长期滞销", endpoint: "slow-moving", description: "识别有库存且长期处于低销量区间的产品。" },
  capital: { label: "资金占用", endpoint: "capital-occupation", description: "按ERP规格实际库存 × 单位成本汇总库存资金。" },
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character]);
}

function number(value, digits = 0) {
  if (value === null || value === undefined) return "—";
  return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

function percent(value) {
  return value === null || value === undefined ? "—" : `${(Number(value) * 100).toFixed(1)}%`;
}

function image(product) {
  return product.image
    ? `<img src="${escapeHtml(resolveAssetUrl(product.image))}" alt="" loading="lazy" />`
    : `<span>无图</span>`;
}

function statusLabel(status) {
  return ({
    up: "上涨", down: "下滑", stable: "稳定", volatile: "波动", insufficient: "数据不足",
    observing: "待观察", suspected: "疑似滞销", long_term: "长期滞销", invalid: "数据异常",
  })[status] ?? status;
}

function sortOptions() {
  if (view === "trends") return [["", "按趋势强度"], ["sales", "按近30天销量"], ["stock", "按当前库存"]];
  if (view === "slow-moving") return [["", "按滞销程度"], ["days", "按持续天数"], ["capital", "按库存金额"]];
  return [["", "按资金占用"], ["sales", "按近30天销量"], ["stock", "按实际库存"]];
}

function renderOverview() {
  if (!result) return "";
  if (view === "trends") {
    return `${result.availableBusinessDays < 7 ? `<div class="data-center-notice"><strong>历史数据正在积累</strong><p>当前已有${result.availableBusinessDays ?? 0}个业务日快照；2—6日仅说明较前一阶段变化，不作正式趋势判断，正式趋势至少需要7个业务日。</p></div>` : ""}
    <div class="data-center-overview">
      <div><span>最新业务日期</span><strong>${escapeHtml(result.latestBusinessDate || "—")}</strong></div>
      <div><span>历史业务日</span><strong>${result.availableBusinessDays ?? 0}</strong></div>
      <div><span>上涨</span><strong>${result.counts?.up ?? 0}</strong></div>
      <div><span>下滑</span><strong>${result.counts?.down ?? 0}</strong></div>
      <div><span>稳定/波动</span><strong>${(result.counts?.stable ?? 0) + (result.counts?.volatile ?? 0)}</strong></div>
      <div><span>数据不足</span><strong>${result.counts?.insufficient ?? 0}</strong></div>
    </div>`;
  }
  if (view === "slow-moving") {
    return `<div class="data-center-overview">
      <div><span>最新业务日期</span><strong>${escapeHtml(result.latestBusinessDate || "—")}</strong></div>
      <div><span>历史业务日</span><strong>${result.availableBusinessDays ?? 0}</strong></div>
      <div><span>正式判定门槛</span><strong>30 / 60日</strong></div>
    </div>
    ${result.availableBusinessDays < 30 ? `<div class="data-center-notice"><strong>长期滞销需要至少30个业务日数据</strong><p>当前数据仍在积累，仅展示待观察产品，不作正式滞销判断。</p></div>` : ""}`;
  }
  const summary = result.summary ?? {};
  return `<div class="data-center-overview">
    <div><span>最新业务日期</span><strong>${escapeHtml(result.latestBusinessDate || "—")}</strong></div>
    <div><span>可计算资金总额</span><strong>¥${number(summary.totalAmount, 2)}</strong></div>
    <div><span>数据完整产品</span><strong>${summary.completeProducts ?? 0}</strong></div>
    <div><span>缺少成本/实际库存</span><strong>${summary.missingCostProducts ?? 0}</strong></div>
    <div><span>最高占用</span><strong>¥${number(summary.highestAmount, 2)}</strong></div>
    <div><span>前20占比</span><strong>${percent(summary.top20Share)}</strong></div>
  </div>`;
}

function renderRows() {
  const rows = result?.rows ?? [];
  if (!rows.length) return `<div class="empty-state"><strong>当前没有符合条件的产品</strong><p>数据中心不会为了产生结果而降低判断阈值。</p></div>`;
  if (view === "trends") {
    return `<div class="data-center-list">${rows.map((row) => `<article class="data-center-row">
      <div class="data-center-product-image">${image(row)}</div>
      <div class="data-center-product"><strong>${escapeHtml(row.productName)}</strong><span>${escapeHtml(row.skuCode)}</span><small>${escapeHtml(row.startDate)}—${escapeHtml(row.endDate)}</small></div>
      <div><span>趋势</span><strong>${escapeHtml(row.strength)}</strong></div>
      <div><span>sales30d</span><strong>${number(row.windowStartValue)} → ${number(row.currentSales30d)}</strong></div>
      <div><span>变化</span><strong>${number(row.changeAmount)} / ${percent(row.changeRate)}</strong></div>
      <div><span>连续方向</span><strong>${row.consecutiveDays ?? 0}日</strong></div>
      <div><span>当前库存</span><strong>${number(row.currentStock)}</strong></div>
      <p>${escapeHtml(row.reason)}</p>
      <button class="text-button" data-action="open-data-center-detail" data-product-id="${escapeHtml(row.productId)}">查看分析</button>
    </article>`).join("")}</div>`;
  }
  if (view === "slow-moving") {
    return `<div class="data-center-list">${rows.map((row) => `<article class="data-center-row">
      <div class="data-center-product-image">${image(row)}</div>
      <div class="data-center-product"><strong>${escapeHtml(row.productName)}</strong><span>${escapeHtml(row.skuCode)}</span><small>首次观察 ${escapeHtml(row.firstObservedAt)}</small></div>
      <div><span>状态</span><strong>${escapeHtml(statusLabel(row.status))}</strong></div>
      <div><span>当前库存</span><strong>${number(row.currentStock)}</strong></div>
      <div><span>sales30d</span><strong>${number(row.currentSales30d)}</strong></div>
      <div><span>连续低销量日</span><strong>${row.continuousLowDays ?? 0}</strong></div>
      <div><span>当前库存金额</span><strong>${row.currentCapitalAmount === null ? "—" : `¥${number(row.currentCapitalAmount, 2)}`}</strong></div>
      <p>${escapeHtml(row.reason)}</p>
      <button class="text-button" data-action="open-data-center-detail" data-product-id="${escapeHtml(row.productId)}">查看分析</button>
    </article>`).join("")}</div>`;
  }
  return `<div class="data-center-list">${rows.map((row) => `<article class="data-center-row">
    <div class="data-center-product-image">${image(row)}</div>
    <div class="data-center-product"><strong>${escapeHtml(row.productName)}</strong><span>${escapeHtml(row.skuCode)}</span><small>${row.rank ? `排名 ${row.rank}` : "金额数据不完整"}</small></div>
    <div><span>实际库存</span><strong>${number(row.actualStock)}</strong></div>
    <div><span>单位成本区间</span><strong>${row.minUnitCost === null ? "—" : `¥${number(row.minUnitCost, 2)}—¥${number(row.maxUnitCost, 2)}`}</strong></div>
    <div><span>库存资金</span><strong>${row.amount === null ? "无法计算" : `¥${number(row.amount, 2)}`}</strong></div>
    <div><span>近30天销量</span><strong>${number(row.currentSales30d)}</strong></div>
    <div><span>资金占比</span><strong>${percent(row.share)}</strong></div>
    <p>${escapeHtml(row.reason)}</p>
    <button class="text-button" data-action="open-data-center-detail" data-product-id="${escapeHtml(row.productId)}">查看分析</button>
  </article>`).join("")}</div>`;
}

function renderDetail() {
  if (!detail) return "";
  const current = detail.current;
  const capitalByDate = new Map((detail.capitalHistory ?? []).map((item) => [item.businessDate, item.amount]));
  const points = detail.history.map((item) => `${item.businessDate}：sales30d ${number(item.sales30d)}，sales7d ${number(item.sales7d)}，库存 ${number(item.totalStock)}，库存资金 ${capitalByDate.get(item.businessDate) === null ? "无法计算" : `¥${number(capitalByDate.get(item.businessDate), 2)}`}，平台/店铺/链接 ${item.platformCount}/${item.shopCount}/${item.salesLinkCount}`).join("<br>");
  return `<div class="modal-backdrop"><section class="modal-panel data-center-detail">
    <header class="modal-header"><div><h2>${escapeHtml(current.productName)}</h2><p>${escapeHtml(current.skuCode)}</p></div><button class="icon-button" data-action="close-data-center-detail">×</button></header>
    <div class="modal-body">
      <div class="data-center-overview"><div><span>当前库存</span><strong>${number(current.totalStock)}</strong></div><div><span>sales30d</span><strong>${number(current.sales30d)}</strong></div><div><span>平台/店铺/链接</span><strong>${current.platformCount}/${current.shopCount}/${current.salesLinkCount}</strong></div></div>
      <section><h3>历史变化</h3><p class="data-center-history">${points}</p></section>
      <section><h3>本次判断</h3><p>${escapeHtml(detail.judgment || "—")}</p></section>
      <section><h3>数据来源</h3><p>${escapeHtml(detail.dataSource.firstBusinessDate)}—${escapeHtml(detail.dataSource.latestBusinessDate)}；使用每日当前正式快照版本。${detail.dataSource.missingFields?.length ? `缺失：${escapeHtml(detail.dataSource.missingFields.join("、"))}。` : "核心计算字段完整。"}</p></section>
    </div>
    <footer class="modal-footer">${canAccessModule(getCurrentUser(), "products") ? `<button class="secondary-button" data-action="open-data-center-product" data-product-id="${escapeHtml(detail.productId)}">查看产品中心详情</button>` : ""}<button class="primary-button" data-action="close-data-center-detail">关闭</button></footer>
  </section></div>`;
}

export function renderDataCenterPage() {
  const config = viewConfig[view];
  return `<section class="data-center-page">
    <div class="section-heading"><div><h1>数据中心</h1><p>${escapeHtml(config.description)}</p></div><button type="button" class="secondary-button" data-action="open-operation-dashboard">经营驾驶舱</button></div>
    <div class="subtabs">${Object.entries(viewConfig).map(([key, item]) => `<button class="${view === key ? "is-active" : ""}" data-action="switch-data-center-view" data-view="${key}">${item.label}</button>`).join("")}</div>
    <form id="data-center-filter" class="data-center-filter"><input name="search" value="${escapeHtml(query.search)}" placeholder="搜索产品名称或编码" />
      ${view === "trends" ? `<select name="direction"><option value="focus" ${query.direction === "focus" ? "selected" : ""}>重点：上涨与下滑</option><option value="" ${query.direction === "" ? "selected" : ""}>全部趋势</option>${["up", "down", "stable", "volatile", "insufficient"].map((item) => `<option value="${item}" ${query.direction === item ? "selected" : ""}>${statusLabel(item)}</option>`).join("")}</select>` : ""}
      ${view === "slow-moving" ? `<select name="status"><option value="">全部状态</option>${["long_term", "suspected", "observing", "invalid"].map((item) => `<option value="${item}" ${query.status === item ? "selected" : ""}>${statusLabel(item)}</option>`).join("")}</select>` : ""}
      <select name="sort">${sortOptions().map(([value, label]) => `<option value="${value}" ${query.sort === value ? "selected" : ""}>${label}</option>`).join("")}</select>
      <button class="secondary-button" type="submit">筛选</button></form>
    ${loading ? `<div class="form-note">正在计算经营结果…</div>` : error ? `<div class="form-error">${escapeHtml(error)}</div>` : `${renderOverview()}${renderRows()}`}
    ${result?.pagination ? `<div class="pagination"><button data-action="data-center-page" data-page="${result.pagination.page - 1}" ${result.pagination.page <= 1 ? "disabled" : ""}>上一页</button><span>${result.pagination.page} / ${result.pagination.pages}，共 ${result.pagination.total} 项</span><button data-action="data-center-page" data-page="${result.pagination.page + 1}" ${result.pagination.page >= result.pagination.pages ? "disabled" : ""}>下一页</button></div>` : ""}
    ${renderDetail()}
  </section>`;
}

async function refresh(rerender) {
  loading = true; error = ""; rerender();
  try {
    result = await loadDataCenterView(viewConfig[view].endpoint, query);
  } catch (caught) {
    error = caught.message || "数据中心读取失败。";
  }
  loading = false; rerender();
}

export function bindDataCenterPageEvents(rerender) {
  if (!result && !loading) refresh(rerender);
  document.querySelectorAll("[data-action='switch-data-center-view']").forEach((button) => button.addEventListener("click", () => {
    view = button.dataset.view; query = { search: "", page: 1, pageSize: 48, direction: button.dataset.view === "trends" ? "focus" : "", status: "", sort: "" }; result = null; detail = null; refresh(rerender);
  }));
  document.querySelector("#data-center-filter")?.addEventListener("submit", (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    query = { ...query, search: String(form.get("search") || ""), direction: String(form.get("direction") || ""), status: String(form.get("status") || ""), sort: String(form.get("sort") || ""), page: 1 };
    refresh(rerender);
  });
  document.querySelectorAll("[data-action='data-center-page']").forEach((button) => button.addEventListener("click", () => {
    query.page = Number(button.dataset.page); refresh(rerender);
  }));
  document.querySelectorAll("[data-action='open-data-center-detail']").forEach((button) => button.addEventListener("click", async () => {
    try { detail = (await loadDataCenterProductDetail(button.dataset.productId, view)).detail; rerender(); } catch (caught) { error = caught.message; rerender(); }
  }));
  document.querySelector("[data-action='open-data-center-product']")?.addEventListener("click", (event) => {
    window.location.hash = `products/${encodeURIComponent(event.currentTarget.dataset.productId)}`;
    rerender();
  });
  document.querySelectorAll("[data-action='close-data-center-detail']").forEach((button) => button.addEventListener("click", () => { detail = null; rerender(); }));
  document.querySelector("[data-action='open-operation-dashboard']")?.addEventListener("click", () => { window.location.hash = "operationDashboard"; });
}
