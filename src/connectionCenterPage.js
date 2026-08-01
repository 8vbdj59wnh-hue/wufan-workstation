import {
  createConnection,
  createConnectionAction,
  getCurrentUser,
  loadAvailableSalesLinks,
  loadConnectionActions,
  loadConnections,
  removeConnectionAction,
  resolveAssetUrl,
  state,
} from "./appState.js?v=20260705-state-singleton1";
import { hasPermission } from "./permissions.js?v=20260705-state-singleton1";

const pageState = {
  loaded: false,
  loading: false,
  items: [],
  availableLinks: [],
  selectedId: "",
  view: "list",
  detailTab: "overview",
  actions: [],
  modalOpen: false,
  error: "",
};

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function canManage() {
  return hasPermission(getCurrentUser(), "products.edit");
}

function personName(id) {
  const person = (state.people ?? []).find((item) => String(item.id) === String(id ?? ""));
  return person?.name ?? "未设置";
}

function shopName(item) {
  return item.shopDisplayName || item.shopName || "未命名店铺";
}

function productNames(item) {
  return item.products?.length ? item.products.map((product) => product.name || product.skuCode).join("、") : "未关联产品";
}

function imageHtml(item) {
  const image = resolveAssetUrl(item.products?.find((product) => product.mainImage)?.mainImage ?? "");
  return image
    ? `<img class="connection-cover" src="${escapeHtml(image)}" alt="" loading="lazy" />`
    : `<div class="connection-cover connection-cover-empty" aria-label="暂无图片">无图</div>`;
}

function statusText(status) {
  return ({ active: "经营中", paused: "已暂停", archived: "已归档", pending: "待处理", in_progress: "进行中", completed: "已完成", canceled: "已取消" })[status] ?? status;
}

function renderToolbar() {
  return `<div class="connection-toolbar">
    <div class="segmented-control" aria-label="连接展示方式">
      <button type="button" class="${pageState.view === "list" ? "active" : ""}" data-connection-view="list">列表</button>
      <button type="button" class="${pageState.view === "cards" ? "active" : ""}" data-connection-view="cards">卡片</button>
    </div>
    ${canManage() ? `<button type="button" class="primary-button" data-action="new-connection">建立连接档案</button>` : ""}
  </div>`;
}

function renderList() {
  if (!pageState.items.length) return `<div class="empty-state"><strong>还没有连接档案</strong><p>从已有销售链接中建立第一条经营连接。</p></div>`;
  if (pageState.view === "cards") {
    return `<div class="connection-card-grid">${pageState.items.map((item) => `<button type="button" class="connection-card" data-open-connection="${escapeHtml(item.id)}">
      ${imageHtml(item)}
      <div class="connection-card-body"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(productNames(item))}</span><span>${escapeHtml(personName(item.ownerId))}</span><em class="status-pill status-${escapeHtml(item.status)}">${escapeHtml(statusText(item.status))}</em></div>
    </button>`).join("")}</div>`;
  }
  return `<div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>图片</th><th>连接名称</th><th>平台</th><th>店铺</th><th>产品</th><th>负责人</th><th>状态</th></tr></thead><tbody>${pageState.items.map((item) => `<tr tabindex="0" data-open-connection="${escapeHtml(item.id)}">
    <td>${imageHtml(item)}</td><td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(item.platform)}</td><td>${escapeHtml(shopName(item))}</td><td>${escapeHtml(productNames(item))}</td><td>${escapeHtml(personName(item.ownerId))}</td><td><span class="status-pill status-${escapeHtml(item.status)}">${escapeHtml(statusText(item.status))}</span></td>
  </tr>`).join("")}</tbody></table></div>`;
}

function renderActions(item) {
  return `<div class="connection-actions-panel">
    ${canManage() ? `<form class="connection-action-form" data-connection-action-form>
      <input name="title" required maxlength="120" placeholder="新增经营动作" />
      <select name="ownerId"><option value="">未设置负责人</option>${(state.people ?? []).filter((person) => person.status === "active").map((person) => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.name)}</option>`).join("")}</select>
      <input name="dueDate" type="date" />
      <button class="primary-button" type="submit">新增</button>
    </form>` : ""}
    <div class="connection-action-list">${pageState.actions.length ? pageState.actions.map((action) => `<article class="connection-action-item"><div><strong>${escapeHtml(action.title)}</strong><p>${escapeHtml(personName(action.ownerId))}${action.dueDate ? ` · ${escapeHtml(action.dueDate)}` : ""}</p></div><div><span class="status-pill status-${escapeHtml(action.status)}">${escapeHtml(statusText(action.status))}</span>${canManage() ? `<button class="text-button danger" type="button" data-delete-connection-action="${escapeHtml(action.id)}">删除</button>` : ""}</div></article>`).join("") : `<div class="empty-state compact">暂无经营动作</div>`}</div>
  </div>`;
}

function renderDetail() {
  const item = pageState.items.find((candidate) => candidate.id === pageState.selectedId);
  if (!item) return "";
  const tabs = [["overview", "经营概况"], ["actions", "经营动作"], ["health", "体检"], ["trend", "趋势"]];
  let body = `<div class="connection-overview"><dl><div><dt>平台</dt><dd>${escapeHtml(item.platform)}</dd></div><div><dt>店铺</dt><dd>${escapeHtml(shopName(item))}</dd></div><div><dt>负责人</dt><dd>${escapeHtml(personName(item.ownerId))}</dd></div><div><dt>状态</dt><dd>${escapeHtml(statusText(item.status))}</dd></div></dl><section><h3>关联产品</h3>${item.products?.length ? item.products.map((product) => `<a href="#products/${encodeURIComponent(product.id)}" data-product-id="${escapeHtml(product.id)}">${escapeHtml(product.name || product.skuCode)}</a>`).join("、") : "未关联产品"}</section></div>`;
  if (pageState.detailTab === "actions") body = renderActions(item);
  if (["health", "trend"].includes(pageState.detailTab)) body = `<div class="empty-state"><strong>${pageState.detailTab === "health" ? "连接体检" : "经营趋势"}</strong><p>该能力将在后续阶段接入真实经营数据。</p></div>`;
  return `<section class="connection-detail"><button type="button" class="text-button" data-action="back-connections">← 返回连接列表</button><header>${imageHtml(item)}<div><p class="eyebrow">${escapeHtml(item.platform)} · ${escapeHtml(shopName(item))}</p><h2>${escapeHtml(item.name)}</h2><p>${escapeHtml(productNames(item))}</p></div></header><nav class="connection-tabs">${tabs.map(([id, label]) => `<button type="button" class="${pageState.detailTab === id ? "active" : ""}" data-connection-tab="${id}">${label}</button>`).join("")}</nav>${body}</section>`;
}

function renderCreateModal() {
  if (!pageState.modalOpen) return "";
  return `<div class="modal-backdrop" data-action="close-connection-modal"><section class="modal-panel connection-modal" role="dialog" aria-modal="true" aria-label="建立连接档案" data-connection-modal><header><div><p class="eyebrow">连接中心</p><h2>建立连接档案</h2></div><button type="button" class="icon-button" data-action="close-connection-modal" aria-label="关闭">×</button></header><form data-create-connection-form>
    <label>选择销售连接<select name="salesLinkId" required><option value="">请选择</option>${pageState.availableLinks.map((item) => `<option value="${escapeHtml(item.salesLinkId)}">${escapeHtml(`${item.platform} · ${shopName(item)} · ${item.salesLinkTitle || item.platformGoodsCode || productNames(item)}`)}</option>`).join("")}</select></label>
    <label>连接名称<input name="name" maxlength="120" placeholder="不填写则沿用销售链接名称" /></label>
    <label>负责人<select name="ownerId"><option value="">未设置</option>${(state.people ?? []).filter((person) => person.status === "active").map((person) => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.name)}</option>`).join("")}</select></label>
    <label>状态<select name="status"><option value="active">经营中</option><option value="paused">已暂停</option></select></label>
    <footer><button type="button" class="secondary-button" data-action="close-connection-modal">取消</button><button type="submit" class="primary-button" ${pageState.availableLinks.length ? "" : "disabled"}>创建</button></footer>
  </form></section></div>`;
}

export function renderConnectionCenterPage() {
  return `<section class="connection-center-page">${pageState.error ? `<div class="form-error">${escapeHtml(pageState.error)}</div>` : ""}${pageState.loading ? `<div class="empty-state">正在读取连接…</div>` : pageState.selectedId ? renderDetail() : `${renderToolbar()}${renderList()}`}${renderCreateModal()}</section>`;
}

async function loadPage(render) {
  pageState.loading = true; pageState.error = ""; render();
  try {
    pageState.items = (await loadConnections()).items ?? [];
    pageState.loaded = true;
  } catch (error) { pageState.error = error.message; }
  pageState.loading = false; render();
}

async function openConnection(id, render) {
  pageState.selectedId = id; pageState.detailTab = "overview"; pageState.actions = []; render();
}

export function bindConnectionCenterPageEvents(render) {
  const root = document.querySelector(".connection-center-page");
  if (!root) return;
  if (!pageState.loaded && !pageState.loading) void loadPage(render);
  root.querySelectorAll("[data-connection-view]").forEach((button) => button.addEventListener("click", () => { pageState.view = button.dataset.connectionView; render(); }));
  root.querySelectorAll("[data-open-connection]").forEach((element) => {
    const open = () => void openConnection(element.dataset.openConnection, render);
    element.addEventListener("click", open);
    element.addEventListener("keydown", (event) => { if (["Enter", " "].includes(event.key)) open(); });
  });
  root.querySelector('[data-action="back-connections"]')?.addEventListener("click", () => { pageState.selectedId = ""; render(); });
  root.querySelector('[data-action="new-connection"]')?.addEventListener("click", async () => {
    try { pageState.availableLinks = (await loadAvailableSalesLinks()).items ?? []; pageState.modalOpen = true; pageState.error = ""; render(); } catch (error) { pageState.error = error.message; render(); }
  });
  root.querySelectorAll('[data-action="close-connection-modal"]').forEach((element) => element.addEventListener("click", (event) => { if (event.target.closest("[data-connection-modal]") && !event.target.matches('[data-action="close-connection-modal"]')) return; pageState.modalOpen = false; render(); }));
  root.querySelector("[data-create-connection-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try { const result = await createConnection(Object.fromEntries(form)); pageState.items.unshift(result.item); pageState.modalOpen = false; pageState.error = ""; render(); } catch (error) { pageState.error = error.message; render(); }
  });
  root.querySelectorAll("[data-connection-tab]").forEach((button) => button.addEventListener("click", async () => {
    pageState.detailTab = button.dataset.connectionTab; render();
    if (pageState.detailTab === "actions") { try { pageState.actions = (await loadConnectionActions(pageState.selectedId)).items ?? []; render(); } catch (error) { pageState.error = error.message; render(); } }
  }));
  root.querySelector("[data-connection-action-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try { const result = await createConnectionAction(pageState.selectedId, Object.fromEntries(form)); pageState.actions.unshift(result.item); pageState.error = ""; render(); } catch (error) { pageState.error = error.message; render(); }
  });
  root.querySelectorAll("[data-delete-connection-action]").forEach((button) => button.addEventListener("click", async () => {
    if (!window.confirm("确认删除这条经营动作？")) return;
    try { await removeConnectionAction(pageState.selectedId, button.dataset.deleteConnectionAction); pageState.actions = pageState.actions.filter((item) => item.id !== button.dataset.deleteConnectionAction); render(); } catch (error) { pageState.error = error.message; render(); }
  }));
}
