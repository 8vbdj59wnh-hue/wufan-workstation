import {
  commitConnectionImport,
  confirmConnectionImportRow,
  createConnectionHealthRecord,
  createConnectionImprovementAction,
  createConnectionPeriodSnapshots,
  createConnection,
  createConnectionAction,
  getCurrentUser,
  loadAvailableSalesLinks,
  loadConnectionActions,
  loadConnectionDataMappings,
  loadConnectionImportBatches,
  loadConnectionImportPreview,
  loadConnectionGrowthAnalysis,
  loadConnectionGrowthRankings,
  loadConnectionHealthRecords,
  loadAttentionConnectionHealthRecords,
  loadConnectionImprovements,
  loadConnectionImprovementSummary,
  loadConnectionPeriodSnapshots,
  loadConnections,
  removeConnectionAction,
  ignoreConnectionImportRow,
  updateConnectionDataMapping,
  updateConnectionImprovement,
  uploadConnectionImport,
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
  sort: "default",
  detailTab: "overview",
  actions: [],
  periodSnapshots: [],
  growthAnalysis: null,
  growthRankings: { topGrowth: [], risks: [] },
  healthRecords: [],
  healthAttention: { items: [], counts: { risk: 0, attention: 0, traffic: 0, conversion: 0, sales: 0 } },
  healthModalId: "",
  improvements: [],
  improvementSummary: { total: 0, effective: 0, observing: 0, failed: 0 },
  modalOpen: false,
  section: "connections",
  mappings: [],
  mappingLoading: false,
  mappingFilters: { sourceType: "business_advisor", matchStatus: "pending", search: "" },
  mappingModalId: "",
  importBatches: [],
  currentImport: null,
  importLoading: false,
  importTab: "matched",
  importModalExternalId: "",
  error: "",
};

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function canManage() {
  return hasPermission(getCurrentUser(), "products.edit");
}

function canCreateImprovement() {
  return canManage() && hasPermission(getCurrentUser(), "workPlans.launch");
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
  return ({ active: "经营中", paused: "已暂停", archived: "已归档", pending: "待确认", matched: "已匹配", ignored: "已忽略", rejected: "已拒绝", in_progress: "进行中", completed: "已完成", canceled: "已取消" })[status] ?? status;
}

function growthText(value, { points = false } = {}) {
  if (value === null || value === undefined) return "—";
  const amount = Number(value) * 100;
  return `${amount > 0 ? "+" : ""}${amount.toFixed(points ? 2 : 1)}${points ? "个百分点" : "%"}`;
}

function healthText(status) {
  return ({ growing: "成长", stable: "稳定", attention: "关注", risk: "风险", insufficient_data: "暂无对比周期", no_data: "暂无经营数据" })[status] ?? status;
}

function renderSectionNavigation() {
  return `<nav class="connection-section-nav" aria-label="连接中心页面">
    <button type="button" class="${pageState.section === "connections" ? "active" : ""}" data-connection-section="connections">连接列表</button>
    <button type="button" class="${pageState.section === "mappings" ? "active" : ""}" data-connection-section="mappings">数据匹配</button>
    <button type="button" class="${pageState.section === "imports" ? "active" : ""}" data-connection-section="imports">经营数据导入</button>
  </nav>`;
}

function renderToolbar() {
  return `<div class="connection-toolbar">
    <div class="segmented-control" aria-label="连接展示方式">
      <button type="button" class="${pageState.view === "list" ? "active" : ""}" data-connection-view="list">列表</button>
      <button type="button" class="${pageState.view === "cards" ? "active" : ""}" data-connection-view="cards">卡片</button>
    </div>
    <div class="segmented-control" aria-label="连接经营排序">
      <button type="button" class="${pageState.sort === "default" ? "active" : ""}" data-connection-sort="default">默认</button>
      <button type="button" class="${pageState.sort === "latest" ? "active" : ""}" data-connection-sort="latest">最新经营</button>
      <button type="button" class="${pageState.sort === "pay" ? "active" : ""}" data-connection-sort="pay">周期销售额</button>
    </div>
    ${canManage() ? `<button type="button" class="primary-button" data-action="new-connection">建立连接档案</button>` : ""}
  </div>`;
}

function renderGrowthOverview() {
  const top = pageState.growthRankings.topGrowth ?? [];
  const risks = pageState.growthRankings.risks ?? [];
  const cards = (items, emptyText) => items.length ? items.map((item) => `<button type="button" class="connection-growth-row" data-open-connection="${escapeHtml(item.connectionId)}"><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.platform)} · ${escapeHtml(item.shopDisplayName || item.shopName || "未命名店铺")}</small></span><em>${item.healthScore ?? "—"}分</em><b>${growthText(item.salesGrowth)}</b></button>`).join("") : `<div class="empty-state compact">${escapeHtml(emptyText)}</div>`;
  const counts = pageState.healthAttention.counts ?? {};
  const improvements = pageState.improvementSummary;
  return `<section class="connection-health-summary"><div><span>风险连接</span><strong>${counts.risk || 0}</strong></div><div><span>关注连接</span><strong>${counts.attention || 0}</strong></div><div><span>流量问题</span><strong>${counts.traffic || 0}</strong></div><div><span>转化问题</span><strong>${counts.conversion || 0}</strong></div><div><span>销售下降</span><strong>${counts.sales || 0}</strong></div></section><section class="connection-improvement-summary"><strong>改善项目</strong><span>全部 ${improvements.total || 0}</span><span>有效 ${improvements.effective || 0}</span><span>观察 ${improvements.observing || 0}</span><span>失败 ${improvements.failed || 0}</span></section><section class="connection-growth-overview"><article><header><strong>TOP10 成长连接</strong><span>按最新两期销售增长</span></header>${cards(top, "至少积累两个经营周期后显示排行")}</article><article><header><strong>需要关注</strong><span>健康分低于60</span></header>${cards(risks, "当前没有风险连接")}</article></section>`;
}

function improvementStatusText(status) {
  return ({ planned: "计划中", executing: "执行中", observing: "观察中", effective: "有效", failed: "未达预期", closed: "已关闭" })[status] ?? status;
}

function metricEffect(item) {
  const before = item.beforeMetrics ?? {}; const after = item.afterMetrics ?? {};
  const sales = before.payAmount && after.payAmount !== undefined ? (after.payAmount - before.payAmount) / before.payAmount : null;
  const conversion = before.conversionRate !== undefined && after.conversionRate !== undefined ? after.conversionRate - before.conversionRate : null;
  return { sales, conversion };
}

function renderImprovements() {
  if (!pageState.improvements.length) return `<div class="empty-state"><strong>暂无改善记录</strong><p>从体检报告创建改善行动后，改善项目会自动建立。</p></div>`;
  const nextStatuses = { planned: ["executing"], executing: ["observing"], observing: ["effective", "failed"], effective: ["closed"], failed: ["closed"], closed: [] };
  return `<div class="connection-improvement-list">${pageState.improvements.map((item) => { const effect = metricEffect(item); return `<article><header><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.actionName || item.actionId)}</small></div><span class="status-pill">${escapeHtml(improvementStatusText(item.status))}</span></header><div class="connection-improvement-metrics"><span>改善前销售 <b>¥${Number(item.beforeMetrics.payAmount || 0).toLocaleString("zh-CN")}</b></span><span>改善后销售 <b>${item.afterMetrics.payAmount === undefined ? "—" : `¥${Number(item.afterMetrics.payAmount).toLocaleString("zh-CN")}`}</b></span><span>销售变化 <b>${growthText(effect.sales)}</b></span><span>转化变化 <b>${growthText(effect.conversion, { points: true })}</b></span></div>${canManage() ? `<form data-improvement-result="${escapeHtml(item.id)}"><label>状态<select name="status"><option value="${escapeHtml(item.status)}">${escapeHtml(improvementStatusText(item.status))}</option>${nextStatuses[item.status].map((status) => `<option value="${status}">${escapeHtml(improvementStatusText(status))}</option>`).join("")}</select></label><label>改善后销售额<input name="payAmount" type="number" min="0" step="0.01" value="${escapeHtml(item.afterMetrics.payAmount ?? "")}" /></label><label>改善后转化率（%）<input name="conversionRate" type="number" min="0" step="0.01" value="${item.afterMetrics.conversionRate === undefined ? "" : escapeHtml(Number(item.afterMetrics.conversionRate) * 100)}" /></label><label>结果说明<input name="resultSummary" value="${escapeHtml(item.resultSummary || "")}" /></label><button type="submit" class="secondary-button">保存</button></form>` : item.resultSummary ? `<p>${escapeHtml(item.resultSummary)}</p>` : ""}</article>`; }).join("")}</div>`;
}

function renderHealthReport() {
  const analysis = pageState.growthAnalysis;
  if (!analysis?.comparable) return `<div class="empty-state"><strong>暂无可用体检</strong><p>至少需要两个经营周期才能生成体检报告。</p></div>`;
  const record = pageState.healthRecords.find((item) => item.snapshotId === analysis.currentPeriod.snapshotId);
  if (!record) return `<div class="empty-state"><strong>当前周期尚未体检</strong><p>${escapeHtml(`${analysis.currentPeriod.periodStart} 至 ${analysis.currentPeriod.periodEnd}`)}</p>${canManage() ? `<button type="button" class="primary-button" data-generate-health>生成体检报告</button>` : ""}</div>`;
  return `<div class="connection-health-report"><section class="connection-health-card status-${escapeHtml(record.healthStatus)}"><span>健康分</span><strong>${record.healthScore}</strong><em>${escapeHtml(({ healthy: "健康", attention: "关注", risk: "风险" })[record.healthStatus] || record.healthStatus)}</em><small>${escapeHtml(`${record.periodStart} 至 ${record.periodEnd}`)}</small></section><section><h3>发现问题</h3>${record.problems.length ? `<div class="connection-health-list">${record.problems.map((problem) => `<article><strong>⚠ ${escapeHtml(problem.title)}</strong><span>${escapeHtml(problem.value)}</span></article>`).join("")}</div>` : `<div class="empty-state compact">本周期未触发经营风险规则</div>`}</section><section><h3>改善建议</h3><div class="connection-health-list">${record.suggestions.map((suggestion) => `<article><strong>${escapeHtml(suggestion.title)}</strong><span>${escapeHtml(suggestion.reason)}</span>${suggestion.items?.length ? `<small>${escapeHtml(suggestion.items.join(" · "))}</small>` : ""}</article>`).join("")}</div></section>${canCreateImprovement() ? `<button type="button" class="primary-button" data-create-improvement="${escapeHtml(record.id)}">创建改善行动</button>` : ""}${pageState.healthRecords.length > 1 ? `<details><summary>历史体检记录（${pageState.healthRecords.length}）</summary><div class="connection-health-history">${pageState.healthRecords.map((item) => `<span>${escapeHtml(`${item.periodStart} 至 ${item.periodEnd}`)} · ${item.healthScore}分</span>`).join("")}</div></details>` : ""}</div>`;
}

function renderList() {
  if (!pageState.items.length) return `<div class="empty-state"><strong>还没有连接档案</strong><p>从已有销售链接中建立第一条经营连接。</p></div>`;
  const items = [...pageState.items].sort((a, b) => pageState.sort === "latest"
    ? String(b.latestPeriodEnd || "").localeCompare(String(a.latestPeriodEnd || ""))
    : pageState.sort === "pay" ? Number(b.latestPayAmount || 0) - Number(a.latestPayAmount || 0) : 0);
  if (pageState.view === "cards") {
    return `<div class="connection-card-grid">${items.map((item) => `<button type="button" class="connection-card" data-open-connection="${escapeHtml(item.id)}">
      ${imageHtml(item)}
      <div class="connection-card-body"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(productNames(item))}</span><span>${item.latestPeriodEnd ? `${escapeHtml(item.latestPeriodEnd)} · ¥${Number(item.latestPayAmount || 0).toLocaleString("zh-CN")}` : "暂无经营数据"}</span><em class="status-pill status-${escapeHtml(item.status)}">${escapeHtml(statusText(item.status))}</em></div>
    </button>`).join("")}</div>`;
  }
  return `<div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>图片</th><th>连接名称</th><th>平台</th><th>店铺</th><th>产品</th><th>最新经营数据</th><th>最近周期销售额</th><th>负责人</th><th>状态</th></tr></thead><tbody>${items.map((item) => `<tr tabindex="0" data-open-connection="${escapeHtml(item.id)}">
    <td>${imageHtml(item)}</td><td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(item.platform)}</td><td>${escapeHtml(shopName(item))}</td><td>${escapeHtml(productNames(item))}</td><td>${escapeHtml(item.latestPeriodEnd || "—")}</td><td>${item.latestPayAmount == null ? "—" : `¥${Number(item.latestPayAmount).toLocaleString("zh-CN")}`}</td><td>${escapeHtml(personName(item.ownerId))}</td><td><span class="status-pill status-${escapeHtml(item.status)}">${escapeHtml(statusText(item.status))}</span></td>
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
  const tabs = [["overview", "经营概况"], ["actions", "经营动作"], ["health", "体检报告"], ["improvements", "改善记录"], ["trend", "经营趋势"]];
  let body = `<div class="connection-overview"><dl><div><dt>平台</dt><dd>${escapeHtml(item.platform)}</dd></div><div><dt>店铺</dt><dd>${escapeHtml(shopName(item))}</dd></div><div><dt>负责人</dt><dd>${escapeHtml(personName(item.ownerId))}</dd></div><div><dt>状态</dt><dd>${escapeHtml(statusText(item.status))}</dd></div></dl><section><h3>关联产品</h3>${item.products?.length ? item.products.map((product) => `<a href="#products/${encodeURIComponent(product.id)}" data-product-id="${escapeHtml(product.id)}">${escapeHtml(product.name || product.skuCode)}</a>`).join("、") : "未关联产品"}</section></div>`;
  if (pageState.detailTab === "actions") body = renderActions(item);
  if (pageState.detailTab === "health") body = renderHealthReport();
  if (pageState.detailTab === "improvements") body = renderImprovements();
  if (pageState.detailTab === "trend") {
    const analysis = pageState.growthAnalysis;
    const growthCard = analysis?.comparable ? `<section class="connection-growth-card"><div><span>健康分</span><strong>${analysis.healthScore}</strong><em>${escapeHtml(healthText(analysis.healthStatus))}</em></div><dl><div><dt>销售</dt><dd>${growthText(analysis.salesGrowth)}</dd></div><div><dt>访客</dt><dd>${growthText(analysis.visitorGrowth)}</dd></div><div><dt>转化</dt><dd>${growthText(analysis.conversionChange, { points: true })}</dd></div><div><dt>客单价</dt><dd>${growthText(analysis.customerValueChange)}</dd></div></dl></section>` : `<div class="empty-state compact"><strong>${escapeHtml(healthText(analysis?.healthStatus || "no_data"))}</strong><p>需要至少两个经营周期才能计算成长幅度和健康评分。</p></div>`;
    const comparison = analysis?.currentPeriod ? `<div class="connection-table-wrap"><table class="connection-table connection-period-table"><thead><tr><th>周期</th><th>销售额</th><th>访客</th><th>转化率</th><th>客单价</th></tr></thead><tbody>${[["当前周期", analysis.currentPeriod], ["上一周期", analysis.previousPeriod]].filter(([, period]) => period).map(([label, period]) => `<tr><td><strong>${label}</strong><small>${escapeHtml(`${period.periodStart} 至 ${period.periodEnd}`)}</small></td><td>¥${Number(period.payAmount || 0).toLocaleString("zh-CN")}</td><td>${Number(period.visitorCount || 0).toLocaleString("zh-CN")}</td><td>${period.conversionRate == null ? "—" : `${(Number(period.conversionRate) * 100).toFixed(2)}%`}</td><td>${period.customerValue == null ? "—" : `¥${Number(period.customerValue).toFixed(2)}`}</td></tr>`).join("")}</tbody></table></div>` : "";
    body = `<div class="connection-growth-detail">${growthCard}${comparison}</div>`;
  }
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

function externalData(mapping, key, fallback = "—") {
  return mapping.externalData?.[key] || fallback;
}

function renderMappingPage() {
  const rows = pageState.mappings;
  return `<section class="connection-mapping-page">
    <form class="connection-mapping-filters" data-mapping-filter-form>
      <select name="sourceType" aria-label="数据来源"><option value="business_advisor" ${pageState.mappingFilters.sourceType === "business_advisor" ? "selected" : ""}>生意参谋</option><option value="wangdian" ${pageState.mappingFilters.sourceType === "wangdian" ? "selected" : ""}>旺店通</option><option value="taobao" ${pageState.mappingFilters.sourceType === "taobao" ? "selected" : ""}>淘宝</option><option value="xiaohongshu" ${pageState.mappingFilters.sourceType === "xiaohongshu" ? "selected" : ""}>小红书</option><option value="douyin" ${pageState.mappingFilters.sourceType === "douyin" ? "selected" : ""}>抖音</option></select>
      <select name="matchStatus" aria-label="匹配状态"><option value="">全部状态</option><option value="pending" ${pageState.mappingFilters.matchStatus === "pending" ? "selected" : ""}>待确认</option><option value="matched" ${pageState.mappingFilters.matchStatus === "matched" ? "selected" : ""}>已匹配</option><option value="ignored" ${pageState.mappingFilters.matchStatus === "ignored" ? "selected" : ""}>已忽略</option><option value="rejected" ${pageState.mappingFilters.matchStatus === "rejected" ? "selected" : ""}>已拒绝</option></select>
      <input name="search" value="${escapeHtml(pageState.mappingFilters.search)}" placeholder="搜索商品ID" />
      <button type="submit" class="secondary-button">筛选</button>
    </form>
    ${pageState.mappingLoading ? `<div class="empty-state">正在读取数据匹配…</div>` : rows.length ? `<div class="connection-table-wrap"><table class="connection-table connection-mapping-table"><thead><tr><th>商品ID</th><th>商品名称</th><th>货号</th><th>候选连接</th><th>状态</th><th>操作</th></tr></thead><tbody>${rows.map((mapping) => `<tr><td><strong>${escapeHtml(mapping.externalId)}</strong><small>${escapeHtml(mapping.externalShopId || "未标注外部店铺")}</small></td><td>${escapeHtml(externalData(mapping, "goodsName", externalData(mapping, "title")))}</td><td>${escapeHtml(externalData(mapping, "sku", externalData(mapping, "merchantSkuCode")))}</td><td>${escapeHtml(mapping.connectionName || "待选择")}</td><td><span class="status-pill status-${escapeHtml(mapping.matchStatus)}">${escapeHtml(statusText(mapping.matchStatus))}</span></td><td><div class="connection-mapping-actions">${mapping.matchStatus === "pending" && canManage() ? `<button type="button" class="text-button" data-confirm-mapping="${escapeHtml(mapping.id)}">确认匹配</button><button type="button" class="text-button" data-ignore-mapping="${escapeHtml(mapping.id)}">忽略</button>` : ""}${mapping.connectionId ? `<button type="button" class="text-button" data-view-mapping-connection="${escapeHtml(mapping.connectionId)}">查看连接</button>` : ""}</div></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state"><strong>暂无符合条件的数据</strong><p>本阶段只提供映射接口与人工确认能力，不会自动导入外部文件。</p></div>`}
  </section>`;
}

function renderMappingModal() {
  if (!pageState.mappingModalId) return "";
  const mapping = pageState.mappings.find((item) => item.id === pageState.mappingModalId);
  if (!mapping) return "";
  return `<div class="modal-backdrop" data-action="close-mapping-modal"><section class="modal-panel connection-modal" role="dialog" aria-modal="true" aria-label="确认数据匹配" data-mapping-modal><header><div><p class="eyebrow">${escapeHtml(mapping.externalId)}</p><h2>确认匹配连接</h2></div><button type="button" class="icon-button" data-action="close-mapping-modal" aria-label="关闭">×</button></header><form data-confirm-mapping-form><label>连接档案<select name="connectionId" required><option value="">请选择</option>${pageState.items.map((item) => `<option value="${escapeHtml(item.id)}" ${mapping.connectionId === item.id ? "selected" : ""}>${escapeHtml(`${item.name} · ${item.platform} · ${shopName(item)}`)}</option>`).join("")}</select></label><footer><button type="button" class="secondary-button" data-action="close-mapping-modal">取消</button><button type="submit" class="primary-button">确认匹配</button></footer></form></section></div>`;
}

function importStatusText(status) {
  return ({ draft: "草稿", parsed: "已解析", validated: "待确认", completed: "已完成", failed: "失败" })[status] ?? status;
}

function renderImportRows(rows) {
  if (!rows.length) return `<div class="empty-state compact">暂无数据</div>`;
  const pending = pageState.importTab === "pending";
  return `<div class="connection-table-wrap"><table class="connection-table connection-import-table"><thead><tr><th>商品ID</th><th>商品名称</th><th>货号</th><th>${pending ? "候选连接" : "连接名称"}</th><th>匹配方式</th>${pending ? "<th>操作</th>" : ""}</tr></thead><tbody>${rows.map((row) => `<tr><td><strong>${escapeHtml(row.externalId || "—")}</strong></td><td>${escapeHtml(row.goodsName || "—")}</td><td>${escapeHtml(row.sku || "—")}</td><td>${pending ? escapeHtml(row.candidates?.length ? row.candidates.map((item) => item.connectionName).join("、") : "无候选") : escapeHtml(row.connectionName || "销售连接")}</td><td>${escapeHtml(row.matchMethod === "goods_id" ? "商品ID" : row.matchMethod === "manual" ? "人工确认" : "—")}</td>${pending ? `<td><div class="connection-mapping-actions">${canManage() ? `<button type="button" class="text-button" data-confirm-import-row="${escapeHtml(row.externalId)}">确认连接</button><button type="button" class="text-button" data-ignore-import-row="${escapeHtml(row.externalId)}">忽略</button>` : ""}</div></td>` : ""}</tr>`).join("")}</tbody></table></div>`;
}

function renderImportPage() {
  const current = pageState.currentImport;
  const batch = current?.batch;
  const matchedRows = current?.rows?.filter((row) => row.previewStatus === "matched") ?? [];
  const pendingRows = current?.rows?.filter((row) => row.previewStatus === "pending") ?? [];
  const errorRows = current?.rows?.filter((row) => row.previewStatus === "error") ?? [];
  return `<section class="connection-import-page">
    ${canManage() ? `<form class="connection-import-form" data-connection-import-form><label>生意参谋Excel<input type="file" name="file" accept=".xls,.xlsx" required /></label><label>业务日期<input type="date" name="businessDate" /></label><label>外部店铺标识<input name="externalShopId" maxlength="100" placeholder="同一店铺请保持一致" /></label><button type="submit" class="primary-button">上传并生成预览</button></form>` : ""}
    ${pageState.importBatches.length ? `<label class="connection-import-history">历史批次<select data-import-batch-select><option value="">选择批次</option>${pageState.importBatches.map((item) => `<option value="${escapeHtml(item.id)}" ${batch?.id === item.id ? "selected" : ""}>${escapeHtml(`${item.businessDate} · ${item.fileName} · ${importStatusText(item.status)}`)}</option>`).join("")}</select></label>` : ""}
    ${pageState.importLoading ? `<div class="empty-state">正在解析和匹配…</div>` : batch ? `<div class="connection-import-summary"><div><span>总数据</span><strong>${batch.totalRows}</strong></div><div><span>自动匹配</span><strong>${batch.matchedRows}</strong></div><div><span>待确认</span><strong>${batch.pendingRows}</strong></div><div><span>错误</span><strong>${batch.errorRows}</strong></div></div><div class="connection-import-meta"><span>${escapeHtml(batch.fileName)} · ${escapeHtml(batch.businessDate)}</span><span class="status-pill status-${escapeHtml(batch.status)}">${escapeHtml(importStatusText(batch.status))}</span>${canManage() && batch.status !== "completed" ? `<button type="button" class="primary-button" data-commit-import>确认自动匹配</button>` : ""}</div>${batch.status === "completed" ? `<form class="connection-period-confirm" data-period-snapshot-form><strong>检测周期：${escapeHtml(batch.periodStart || "待确认")} 至 ${escapeHtml(batch.periodEnd || "待确认")}</strong><span>确认后按整个周期保存经营事实，不会拆分成每日数据。</span><label>开始日期<input type="date" name="periodStart" value="${escapeHtml(batch.periodStart || "")}" required /></label><label>结束日期<input type="date" name="periodEnd" value="${escapeHtml(batch.periodEnd || "")}" required /></label><label>周期类型<select name="periodType"><option value="rolling_30d" ${batch.periodType === "rolling_30d" ? "selected" : ""}>近30天滚动周期</option><option value="calendar_month" ${batch.periodType === "calendar_month" ? "selected" : ""}>自然月</option><option value="custom_period" ${batch.periodType === "custom_period" ? "selected" : ""}>自定义周期</option></select></label>${canManage() ? `<button type="submit" class="primary-button">确认并生成周期快照</button>` : ""}</form>` : ""}<nav class="connection-tabs"><button type="button" class="${pageState.importTab === "matched" ? "active" : ""}" data-import-tab="matched">已匹配 ${matchedRows.length}</button><button type="button" class="${pageState.importTab === "pending" ? "active" : ""}" data-import-tab="pending">待确认 ${pendingRows.length}</button><button type="button" class="${pageState.importTab === "error" ? "active" : ""}" data-import-tab="error">错误 ${errorRows.length}</button></nav>${renderImportRows(pageState.importTab === "pending" ? pendingRows : pageState.importTab === "error" ? errorRows : matchedRows)}` : `<div class="empty-state"><strong>尚未上传经营数据</strong><p>上传生意参谋商品经营Excel后，先确认映射，再确认经营周期并生成周期快照。</p></div>`}
  </section>`;
}

function renderImportConfirmModal() {
  if (!pageState.importModalExternalId) return "";
  const row = pageState.currentImport?.rows?.find((item) => item.externalId === pageState.importModalExternalId);
  if (!row) return "";
  const candidateOptions = (row.candidates ?? []).map((item) => `<option value="sales:${escapeHtml(item.salesLinkId)}">${escapeHtml(`${item.connectionName} · ${item.platform} · ${item.shopName}`)}</option>`).join("");
  const connectionOptions = pageState.items.map((item) => `<option value="connection:${escapeHtml(item.id)}">${escapeHtml(`${item.name} · ${item.platform} · ${shopName(item)}`)}</option>`).join("");
  return `<div class="modal-backdrop" data-action="close-import-modal"><section class="modal-panel connection-modal" role="dialog" aria-modal="true" aria-label="确认经营数据连接" data-import-modal><header><div><p class="eyebrow">${escapeHtml(row.externalId)}</p><h2>确认销售连接</h2></div><button type="button" class="icon-button" data-action="close-import-modal" aria-label="关闭">×</button></header><form data-confirm-import-form><label>候选或已有连接<select name="selection" required><option value="">请选择</option>${candidateOptions}${connectionOptions}</select></label><footer><button type="button" class="secondary-button" data-action="close-import-modal">取消</button><button type="submit" class="primary-button">确认</button></footer></form></section></div>`;
}

function renderImprovementModal() {
  if (!pageState.healthModalId) return "";
  const record = pageState.healthRecords.find((item) => item.id === pageState.healthModalId);
  if (!record) return "";
  const goals = (state.goals ?? []).filter((goal) => goal.status === "active");
  const templates = (state.taskTemplates ?? []).filter((template) => template.status === "active" && template.defaultProcessTemplateId);
  const suggestedTitle = record.suggestions?.[0]?.title || "改善连接经营表现";
  return `<div class="modal-backdrop" data-action="close-improvement-modal"><section class="modal-panel connection-modal" role="dialog" aria-modal="true" aria-label="创建改善行动" data-improvement-modal><header><div><p class="eyebrow">来源：连接体检</p><h2>创建改善行动</h2></div><button type="button" class="icon-button" data-action="close-improvement-modal" aria-label="关闭">×</button></header><form data-improvement-form><label>行动标题<input name="title" value="${escapeHtml(suggestedTitle)}" required maxlength="120" /></label><label>关联目标<select name="goalId" required><option value="">请选择目标</option>${goals.map((goal) => `<option value="${escapeHtml(goal.id)}">${escapeHtml(goal.name)}</option>`).join("")}</select></label><label>关键行动<select name="taskTemplateId" required><option value="">请选择已配置标准流程的关键行动</option>${templates.map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)}</option>`).join("")}</select></label><p class="form-note">创建关键行动草稿并关联本次连接体检，不会自动创建任务。</p><footer><button type="button" class="secondary-button" data-action="close-improvement-modal">取消</button><button type="submit" class="primary-button">创建草稿</button></footer></form></section></div>`;
}

export function renderConnectionCenterPage() {
  const pageContent = pageState.section === "mappings" ? renderMappingPage() : pageState.section === "imports" ? renderImportPage() : `${renderGrowthOverview()}${renderToolbar()}${renderList()}`;
  return `<section class="connection-center-page">${pageState.error ? `<div class="form-error">${escapeHtml(pageState.error)}</div>` : ""}${pageState.loading ? `<div class="empty-state">正在读取连接…</div>` : pageState.selectedId ? renderDetail() : `${renderSectionNavigation()}${pageContent}`}${renderCreateModal()}${renderMappingModal()}${renderImportConfirmModal()}${renderImprovementModal()}</section>`;
}

async function loadPage(render) {
  pageState.loading = true; pageState.error = ""; render();
  try {
    const [connections, rankings, healthAttention, improvementSummary] = await Promise.all([loadConnections(), loadConnectionGrowthRankings(), loadAttentionConnectionHealthRecords(), loadConnectionImprovementSummary()]);
    pageState.items = connections.items ?? [];
    pageState.growthRankings = rankings;
    pageState.healthAttention = healthAttention;
    pageState.improvementSummary = improvementSummary.summary;
    pageState.loaded = true;
  } catch (error) { pageState.error = error.message; }
  pageState.loading = false; render();
}

async function openConnection(id, render) {
  pageState.selectedId = id; pageState.detailTab = "overview"; pageState.actions = []; pageState.periodSnapshots = []; pageState.growthAnalysis = null; pageState.healthRecords = []; pageState.healthModalId = ""; pageState.improvements = []; render();
}

async function loadMappings(render) {
  pageState.mappingLoading = true; pageState.error = ""; render();
  try { pageState.mappings = (await loadConnectionDataMappings(pageState.mappingFilters)).items ?? []; }
  catch (error) { pageState.error = error.message; }
  pageState.mappingLoading = false; render();
}

async function loadImportBatches(render, openLatest = false) {
  pageState.importLoading = true; pageState.error = ""; render();
  try {
    pageState.importBatches = (await loadConnectionImportBatches()).items ?? [];
    if (openLatest && pageState.importBatches[0]) pageState.currentImport = await loadConnectionImportPreview(pageState.importBatches[0].id);
  } catch (error) { pageState.error = error.message; }
  pageState.importLoading = false; render();
}

export function bindConnectionCenterPageEvents(render) {
  const root = document.querySelector(".connection-center-page");
  if (!root) return;
  if (!pageState.loaded && !pageState.loading) void loadPage(render);
  root.querySelectorAll("[data-connection-section]").forEach((button) => button.addEventListener("click", () => {
    pageState.section = button.dataset.connectionSection; pageState.selectedId = ""; render();
    if (pageState.section === "mappings") void loadMappings(render);
    if (pageState.section === "imports") void loadImportBatches(render, true);
  }));
  root.querySelectorAll("[data-connection-view]").forEach((button) => button.addEventListener("click", () => { pageState.view = button.dataset.connectionView; render(); }));
  root.querySelectorAll("[data-connection-sort]").forEach((button) => button.addEventListener("click", () => { pageState.sort = button.dataset.connectionSort; render(); }));
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
    if (pageState.detailTab === "trend") { try { const [snapshots, analysis] = await Promise.all([loadConnectionPeriodSnapshots(pageState.selectedId), loadConnectionGrowthAnalysis(pageState.selectedId)]); pageState.periodSnapshots = snapshots.items ?? []; pageState.growthAnalysis = analysis.item; render(); } catch (error) { pageState.error = error.message; render(); } }
    if (pageState.detailTab === "health") { try { const [records, analysis] = await Promise.all([loadConnectionHealthRecords(pageState.selectedId), loadConnectionGrowthAnalysis(pageState.selectedId)]); pageState.healthRecords = records.items ?? []; pageState.growthAnalysis = analysis.item; render(); } catch (error) { pageState.error = error.message; render(); } }
    if (pageState.detailTab === "improvements") { try { pageState.improvements = (await loadConnectionImprovements({ connectionId: pageState.selectedId })).items ?? []; render(); } catch (error) { pageState.error = error.message; render(); } }
  }));
  root.querySelector("[data-generate-health]")?.addEventListener("click", async () => {
    try { const result = await createConnectionHealthRecord(pageState.selectedId, pageState.growthAnalysis.currentPeriod.snapshotId); pageState.healthRecords = [result.item, ...pageState.healthRecords.filter((item) => item.id !== result.item.id)]; pageState.healthAttention = await loadAttentionConnectionHealthRecords(); render(); }
    catch (error) { pageState.error = error.message; render(); }
  });
  root.querySelectorAll("[data-create-improvement]").forEach((button) => button.addEventListener("click", () => { pageState.healthModalId = button.dataset.createImprovement; render(); }));
  root.querySelectorAll('[data-action="close-improvement-modal"]').forEach((element) => element.addEventListener("click", (event) => { if (event.target.closest("[data-improvement-modal]") && !event.target.matches('[data-action="close-improvement-modal"]')) return; pageState.healthModalId = ""; render(); }));
  root.querySelector("[data-improvement-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try { const result = await createConnectionImprovementAction(pageState.healthModalId, Object.fromEntries(new FormData(event.currentTarget))); pageState.healthModalId = ""; pageState.improvementSummary = (await loadConnectionImprovementSummary()).summary; window.alert(`改善行动草稿及改善项目已创建：${result.instance.businessCode || result.instance.id}`); render(); }
    catch (error) { pageState.error = error.message; render(); }
  });
  root.querySelectorAll("[data-improvement-result]").forEach((formElement) => formElement.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const afterMetrics = {};
    if (String(form.get("payAmount") || "") !== "") afterMetrics.payAmount = Number(form.get("payAmount"));
    if (String(form.get("conversionRate") || "") !== "") afterMetrics.conversionRate = Number(form.get("conversionRate")) / 100;
    try { const result = await updateConnectionImprovement(event.currentTarget.dataset.improvementResult, { status: form.get("status"), afterMetrics, resultSummary: form.get("resultSummary") }); pageState.improvements = pageState.improvements.map((item) => item.id === result.item.id ? result.item : item); pageState.improvementSummary = (await loadConnectionImprovementSummary()).summary; render(); }
    catch (error) { pageState.error = error.message; render(); }
  }));
  root.querySelector("[data-connection-action-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try { const result = await createConnectionAction(pageState.selectedId, Object.fromEntries(form)); pageState.actions.unshift(result.item); pageState.error = ""; render(); } catch (error) { pageState.error = error.message; render(); }
  });
  root.querySelectorAll("[data-delete-connection-action]").forEach((button) => button.addEventListener("click", async () => {
    if (!window.confirm("确认删除这条经营动作？")) return;
    try { await removeConnectionAction(pageState.selectedId, button.dataset.deleteConnectionAction); pageState.actions = pageState.actions.filter((item) => item.id !== button.dataset.deleteConnectionAction); render(); } catch (error) { pageState.error = error.message; render(); }
  }));
  root.querySelector("[data-mapping-filter-form]")?.addEventListener("submit", (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); pageState.mappingFilters = Object.fromEntries(form); void loadMappings(render);
  });
  root.querySelectorAll("[data-confirm-mapping]").forEach((button) => button.addEventListener("click", () => { pageState.mappingModalId = button.dataset.confirmMapping; render(); }));
  root.querySelectorAll("[data-ignore-mapping]").forEach((button) => button.addEventListener("click", async () => {
    try { const result = await updateConnectionDataMapping(button.dataset.ignoreMapping, { matchStatus: "ignored" }); pageState.mappings = pageState.mappings.map((item) => item.id === result.item.id ? result.item : item).filter((item) => pageState.mappingFilters.matchStatus !== "pending" || item.matchStatus === "pending"); render(); }
    catch (error) { pageState.error = error.message; render(); }
  }));
  root.querySelectorAll("[data-view-mapping-connection]").forEach((button) => button.addEventListener("click", () => { pageState.section = "connections"; void openConnection(button.dataset.viewMappingConnection, render); }));
  root.querySelectorAll('[data-action="close-mapping-modal"]').forEach((element) => element.addEventListener("click", (event) => { if (event.target.closest("[data-mapping-modal]") && !event.target.matches('[data-action="close-mapping-modal"]')) return; pageState.mappingModalId = ""; render(); }));
  root.querySelector("[data-confirm-mapping-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try { const result = await updateConnectionDataMapping(pageState.mappingModalId, { connectionId: form.get("connectionId"), matchStatus: "matched", matchMethod: "manual" }); pageState.mappings = pageState.mappings.map((item) => item.id === result.item.id ? result.item : item).filter((item) => pageState.mappingFilters.matchStatus !== "pending" || item.matchStatus === "pending"); pageState.mappingModalId = ""; render(); }
    catch (error) { pageState.error = error.message; render(); }
  });
  root.querySelector("[data-connection-import-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const file = form.get("file");
    pageState.importLoading = true; pageState.error = ""; render();
    try { const result = await uploadConnectionImport(file, { businessDate: form.get("businessDate"), externalShopId: form.get("externalShopId") }); pageState.currentImport = result; pageState.importTab = "matched"; pageState.importBatches = [result.batch, ...pageState.importBatches.filter((item) => item.id !== result.batch.id)]; }
    catch (error) { pageState.error = error.message; }
    pageState.importLoading = false; render();
  });
  root.querySelector("[data-import-batch-select]")?.addEventListener("change", async (event) => {
    if (!event.target.value) return; pageState.importLoading = true; render();
    try { pageState.currentImport = await loadConnectionImportPreview(event.target.value); pageState.error = ""; } catch (error) { pageState.error = error.message; }
    pageState.importLoading = false; render();
  });
  root.querySelectorAll("[data-import-tab]").forEach((button) => button.addEventListener("click", () => { pageState.importTab = button.dataset.importTab; render(); }));
  root.querySelector("[data-commit-import]")?.addEventListener("click", async () => {
    try { const result = await commitConnectionImport(pageState.currentImport.batch.id); pageState.currentImport = await loadConnectionImportPreview(result.batch.id); pageState.importBatches = pageState.importBatches.map((item) => item.id === result.batch.id ? result.batch : item); pageState.error = ""; render(); }
    catch (error) { pageState.error = error.message; render(); }
  });
  root.querySelector("[data-period-snapshot-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const period = Object.fromEntries(new FormData(event.currentTarget));
    try { const result = await createConnectionPeriodSnapshots(pageState.currentImport.batch.id, period); pageState.currentImport = await loadConnectionImportPreview(result.batch.id); window.alert(`周期快照生成完成：新增 ${result.created} 条，已存在 ${result.existing} 条。`); render(); }
    catch (error) { pageState.error = error.message; render(); }
  });
  root.querySelectorAll("[data-confirm-import-row]").forEach((button) => button.addEventListener("click", () => { pageState.importModalExternalId = button.dataset.confirmImportRow; render(); }));
  root.querySelectorAll("[data-ignore-import-row]").forEach((button) => button.addEventListener("click", async () => {
    try { await ignoreConnectionImportRow(pageState.currentImport.batch.id, button.dataset.ignoreImportRow); pageState.currentImport = await loadConnectionImportPreview(pageState.currentImport.batch.id); render(); }
    catch (error) { pageState.error = error.message; render(); }
  }));
  root.querySelectorAll('[data-action="close-import-modal"]').forEach((element) => element.addEventListener("click", (event) => { if (event.target.closest("[data-import-modal]") && !event.target.matches('[data-action="close-import-modal"]')) return; pageState.importModalExternalId = ""; render(); }));
  root.querySelector("[data-confirm-import-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const selected = String(new FormData(event.currentTarget).get("selection") ?? ""); const [kind, id] = selected.split(":");
    try { await confirmConnectionImportRow(pageState.currentImport.batch.id, pageState.importModalExternalId, kind === "connection" ? { connectionId: id } : { salesLinkId: id }); pageState.currentImport = await loadConnectionImportPreview(pageState.currentImport.batch.id); pageState.importModalExternalId = ""; render(); }
    catch (error) { pageState.error = error.message; render(); }
  });
}
