import {
  commitConnectionImport,
  createConnectionHealthRecord,
  createConnectionImprovementAction,
  createConnectionPeriodSnapshots,
  createConnectionAction,
  loadConnectionActions,
  loadConnectionDataMappings,
  loadConnectionImportBatches,
  loadConnectionImportShops,
  loadConnectionImportPreview,
  loadConnectionGrowthAnalysis,
  loadConnectionGrowthRankings,
  loadConnectionManagementOverview,
  loadConnectionHealthRecords,
  loadAttentionConnectionHealthRecords,
  loadConnectionImprovements,
  loadConnectionImprovementSummary,
  loadConnectionHospital,
  joinConnectionDiagnosis,
  loadConnectionBenchmarks,
  loadConnectionBenchmarkCandidates,
  loadConnectionBenchmarkComparison,
  createConnectionBenchmark,
  removeConnectionBenchmark,
  loadConnectionPeriodSnapshots,
  loadConnections,
  loadMyConnectionWorkbench,
  removeConnectionAction,
  ignoreConnectionImportRow,
  updateConnectionDataMapping,
  updateConnection,
  updateConnectionImprovement,
  updateConnectionFollow,
  uploadConnectionImport,
  resolveAssetUrl,
} from "./services/connectionCenterService.js?v=20260803-connection-workbench1";
import { getCurrentUser, state } from "./appState.js?v=20260705-state-singleton1";
import { hasPermission } from "./permissions.js?v=20260705-state-singleton1";
import { escapeHtml } from "./utils/html.js?v=20260802-module-boundary1";

const pageState = {
  loaded: false,
  loading: false,
  items: [],
  importShops: [],
  selectedId: "",
  view: "list",
  sort: "default",
  columnSort: { key: "", direction: "asc" },
  listFilters: { platform: "", shopId: "", productCode: "", ownerId: "", healthStatus: "", status: "" },
  visibleColumns: ["image", "name", "platform", "shop", "products", "period", "payAmount", "growth", "health", "profit", "origin", "owner", "status"],
  fieldSettingsOpen: false,
  detailTab: "overview",
  actions: [],
  periodSnapshots: [],
  growthAnalysis: null,
  growthRankings: { topGrowth: [], risks: [] },
  managementOverview: { summary: {}, owners: [] },
  healthRecords: [],
  healthAttention: { items: [], counts: { risk: 0, attention: 0, traffic: 0, conversion: 0, sales: 0 } },
  healthModalId: "",
  improvements: [],
  improvementSummary: { total: 0, effective: 0, observing: 0, failed: 0 },
  section: "workbench",
  myWorkbench: { items: [], summary: { total: 0, better: 0, risk: 0, followed: 0 }, filter: "all", isAdmin: false, loading: false },
  hospital: { zones: { diagnosis: [], treatment: [], observation: [] }, counts: { diagnosis: 0, treatment: 0, observation: 0 }, stage: "diagnosis", loading: false },
  diagnosisModalId: "",
  benchmarks: { items: [], candidates: [], comparison: null, comparisonId: "", loading: false },
  mappings: [],
  mappingLoading: false,
  mappingFilters: { sourceType: "business_advisor", matchStatus: "pending", search: "" },
  mappingModalId: "",
  importBatches: [],
  currentImport: null,
  importLoading: false,
  importTab: "matched",
  error: "",
};

const listConfigKey = "connection-center-list-config-v2";
const listColumns = [
  { key: "image", label: "图片", sortable: false },
  { key: "name", label: "连接名称", sortable: true },
  { key: "platform", label: "平台", sortable: true },
  { key: "shop", label: "店铺", sortable: true },
  { key: "products", label: "产品编码", sortable: true },
  { key: "period", label: "最新经营数据", sortable: true },
  { key: "payAmount", label: "最近周期销售额", sortable: true },
  { key: "growth", label: "销售增长", sortable: true },
  { key: "health", label: "健康分", sortable: true },
  { key: "profit", label: "同期净利润", sortable: true },
  { key: "origin", label: "来源", sortable: true },
  { key: "owner", label: "负责人", sortable: true },
  { key: "status", label: "状态", sortable: true },
];

function loadListConfig() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(listConfigKey) || "null");
    if (!saved || typeof saved !== "object") return;
    if (Array.isArray(saved.visibleColumns)) {
      const valid = new Set(listColumns.map((column) => column.key));
      const selected = saved.visibleColumns.filter((key) => valid.has(key));
      if (selected.length) pageState.visibleColumns = selected;
    }
    if (saved.filters && typeof saved.filters === "object") pageState.listFilters = { ...pageState.listFilters, ...saved.filters };
    if (["default", "sales", "growth", "risk", "newest"].includes(saved.sort)) pageState.sort = saved.sort;
  } catch {
    // Ignore invalid browser preferences and keep the safe defaults.
  }
}

function saveListConfig() {
  window.localStorage.setItem(listConfigKey, JSON.stringify({
    visibleColumns: pageState.visibleColumns,
    filters: pageState.listFilters,
    sort: pageState.sort,
  }));
}

loadListConfig();

function canManage() {
  return hasPermission(getCurrentUser(), "links.manage") || hasPermission(getCurrentUser(), "products.edit");
}

function canCreateImprovement() {
  return (hasPermission(getCurrentUser(), "links.improve") || canManage()) && hasPermission(getCurrentUser(), "workPlans.launch");
}

function canImprove() {
  return hasPermission(getCurrentUser(), "links.improve") || hasPermission(getCurrentUser(), "products.edit");
}

function canViewHealth() {
  return hasPermission(getCurrentUser(), "links.health") || hasPermission(getCurrentUser(), "products.view");
}

function connectionAnomalies(item) {
  const problems = [];
  if (Number(item.salesGrowth) < -0.2) problems.push({ title: "销售明显下降", value: growthText(item.salesGrowth) });
  if (Number(item.visitorGrowth) < -0.2) problems.push({ title: "流量下降", value: growthText(item.visitorGrowth) });
  if (Number(item.conversionChange) < -0.01) problems.push({ title: "转化下降", value: growthText(item.conversionChange, { points: true }) });
  if (Number(item.profitGrowth) < -0.2) problems.push({ title: "利润下降", value: growthText(item.profitGrowth) });
  if (!problems.length && item.healthScore !== null && item.healthScore !== undefined && Number(item.healthScore) < 60) problems.push({ title: "健康状态异常", value: `${item.healthScore}分` });
  return problems;
}

function canJoinDiagnosis(item) {
  const user = getCurrentUser(); const personId = user?.personId ?? user?.id ?? "";
  const isAdmin = ["admin", "system_admin"].includes(user?.role) || user?.authRole === "admin";
  return canImprove() && (isAdmin || (item.ownerId && item.ownerId === personId)) && connectionAnomalies(item).length > 0
    && !(pageState.hospital.admittedConnectionIds ?? []).includes(item.id);
}

function personName(id) {
  const person = (state.people ?? []).find((item) => String(item.id) === String(id ?? ""));
  const profileOwner = pageState.items.find((item) => String(item.ownerId ?? "") === String(id ?? "") && item.ownerName)?.ownerName;
  return person?.name ?? profileOwner ?? "未设置";
}

function connectionOwnerName(item) {
  return item.ownerName || personName(item.ownerId);
}

function shopName(item) {
  return item.shopDisplayName || item.shopName || "未命名店铺";
}

function productCodes(item, preferredCode = "") {
  const codes = (item.products ?? []).map((product) => product.skuCode).filter(Boolean);
  if (!item.products?.length) return "未关联产品";
  if (!codes.length) return "未设置产品编码";
  const query = String(preferredCode).trim().toLowerCase();
  const primary = codes.find((code) => query && code.toLowerCase().includes(query)) || codes[0];
  return codes.length === 1 ? primary : `${primary} +${codes.length - 1}`;
}

function productNames(item) {
  return item.products?.length ? item.products.map((product) => product.name || product.skuCode).join("、") : "未关联产品";
}

function imageHtml(item) {
  const image = resolveAssetUrl(item.mainImage || item.products?.find((product) => product.mainImage)?.mainImage || "");
  return image
    ? `<img class="connection-cover" src="${escapeHtml(image)}" alt="" loading="lazy" />`
    : `<div class="connection-cover connection-cover-empty" aria-label="暂无图片">无图</div>`;
}

function statusText(status) {
  return ({ active: "经营中", paused: "已暂停", archived: "已归档", pending: "待关联连接", matched: "已关联连接", ignored: "已忽略", rejected: "已拒绝", in_progress: "进行中", completed: "已完成", canceled: "已取消" })[status] ?? status;
}

function originText(originSource) {
  return ({
    business_advisor: "生意参谋识别",
    legacy_business_advisor_supported: "历史档案 · 已有经营数据",
    legacy_bulk_initialized: "历史批量初始化",
    legacy_unknown: "历史来源未确认",
  })[originSource] ?? "历史来源未确认";
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
    <button type="button" class="${pageState.section === "workbench" ? "active" : ""}" data-connection-section="workbench">链接经营工作台</button>
    <button type="button" class="${pageState.section === "connections" ? "active" : ""}" data-connection-section="connections">全部链接</button>
    <button type="button" class="${pageState.section === "my-links" ? "active" : ""}" data-connection-section="my-links">我的链接</button>
    ${canViewHealth() ? `<button type="button" class="${pageState.section === "hospital" ? "active" : ""}" data-connection-section="hospital">链接医院</button>` : ""}
    <button type="button" class="${pageState.section === "pending-connections" ? "active" : ""}" data-connection-section="pending-connections">待识别经营连接</button>
    <button type="button" class="${pageState.section === "mappings" ? "active" : ""}" data-connection-section="mappings">数据关联</button>
    <button type="button" class="${pageState.section === "imports" ? "active" : ""}" data-connection-section="imports">经营数据导入</button>
  </nav>`;
}

function hospitalMetric(value, points = false) { return growthText(value, { points }); }

function renderConnectionHospital() {
  const hospital = pageState.hospital; const stage = hospital.stage; const items = hospital.zones?.[stage] ?? [];
  const meta = { diagnosis: ["诊断区", "发现异常并发起链接诊断行动"], treatment: ["治疗区", "执行关键行动和改善方案"], observation: ["观察区", "治疗完成后观察经营恢复"] };
  const card = (item) => { const profile = pageState.items.find((profileItem) => profileItem.id === item.connectionId) ?? item; const taskProgress = item.taskCount ? `${item.completedTaskCount}/${item.taskCount}` : "尚未生成任务";
    const operation = stage === "diagnosis" ? (!item.improvementId
      ? item.healthRecord && canCreateImprovement() ? `<button type="button" class="primary-button" data-hospital-diagnose="${escapeHtml(item.connectionId)}">发起链接诊断行动</button>` : `<button type="button" class="secondary-button" data-open-connection="${escapeHtml(item.connectionId)}">进入详情完成体检</button>`
      : item.improvementStatus === "planned" && canImprove() ? `<button type="button" class="primary-button" data-hospital-transition="${escapeHtml(item.improvementId)}" data-next-status="executing">诊断完成，进入治疗</button>` : "")
      : stage === "treatment" && canImprove() ? `<button type="button" class="primary-button" data-hospital-transition="${escapeHtml(item.improvementId)}" data-next-status="observing">治疗完成，进入观察</button>`
      : stage === "observation" && canImprove() ? `<div class="hospital-observation-actions"><button type="button" class="primary-button" data-hospital-transition="${escapeHtml(item.improvementId)}" data-next-status="effective">数据恢复</button><button type="button" class="secondary-button" data-hospital-transition="${escapeHtml(item.improvementId)}" data-next-status="failed">未恢复</button></div>` : "";
    return `<article class="connection-hospital-card"><header><button type="button" data-open-connection="${escapeHtml(item.connectionId)}"><strong>${escapeHtml(item.connectionName)}</strong><small>${escapeHtml(`${item.platform} · ${item.shopName}`)}</small></button><span class="status-pill">${escapeHtml(meta[stage][0])}</span></header><p class="hospital-product">产品：${escapeHtml(productCodes(profile))}</p><div class="hospital-problem"><strong>${escapeHtml(item.problemTitle)}</strong><span>健康 ${item.healthScore == null ? "—" : `${item.healthScore}分`} · 负责人 ${escapeHtml(item.ownerName || "未分配")}</span></div><div class="hospital-metrics"><span>销售 ${hospitalMetric(item.salesGrowth)}</span><span>流量 ${hospitalMetric(item.visitorGrowth)}</span><span>转化 ${hospitalMetric(item.conversionChange, true)}</span><span>利润 ${hospitalMetric(item.profitGrowth)}</span></div>${stage !== "diagnosis" ? `<div class="hospital-treatment"><span>方案：${escapeHtml(item.treatmentPlan)}</span><span>行动：${escapeHtml(item.actionId || "—")}</span><span>任务进度：${escapeHtml(taskProgress)}</span></div>` : `<div class="hospital-treatment"><span>加入时间：${escapeHtml(item.discoveredAt || "—")}</span><span>当前状态：等待发起诊断行动</span>${item.diagnosisEntry?.notes ? `<span>备注：${escapeHtml(item.diagnosisEntry.notes)}</span>` : ""}</div>`}<footer>${operation}<button type="button" class="text-button" data-open-connection="${escapeHtml(item.connectionId)}">查看连接详情</button></footer></article>`; };
  return `<section class="connection-hospital"><header><div><p class="eyebrow">发现问题 → 诊断 → 治疗 → 观察恢复</p><h2>链接医院</h2></div></header><div class="connection-hospital-zones">${Object.entries(meta).map(([id, [label, description]]) => `<button type="button" class="${stage === id ? "is-active" : ""}" data-hospital-stage="${id}"><span>${label}</span><strong>${hospital.counts?.[id] || 0}</strong><small>${description}</small></button>`).join("")}</div>${hospital.loading ? `<div class="empty-state">正在读取链接健康状态…</div>` : items.length ? `<div class="connection-hospital-grid">${items.map(card).join("")}</div>` : `<div class="empty-state"><strong>${escapeHtml(meta[stage][0])}暂无链接</strong><p>${stage === "observation" ? "已恢复链接会自动退出观察区。" : "经营数据正常或尚未形成对应阶段记录。"}</p></div>`}</section>`;
}

function trendLabel(item) {
  if (item.trend === "better") return { text: "经营向好", className: "better" };
  if (item.trend === "worse") return { text: "需要关注", className: "worse" };
  return { text: item.healthStatus === "insufficient_data" ? "暂无对比周期" : "经营平稳", className: "stable" };
}

function trendDetails(item) {
  return [["销售", item.salesGrowth, false], ["流量", item.visitorGrowth, false], ["转化", item.conversionChange, true], ["利润", item.profitGrowth, false]]
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([label, value, points]) => `${label} ${growthText(value, { points })}`).join(" · ") || "尚无可比较变化";
}

function renderMyLinksWorkbench() {
  const workbench = pageState.myWorkbench; const summary = workbench.summary ?? {};
  const tabs = [["all", "全部"], ["better", "变好"], ["worse", "变差"], ["followed", "我的关注"]];
  return `<section class="my-links-workbench"><header><div><p class="eyebrow">运营日常经营工作台</p><h2>我的链接</h2><p>${workbench.isAdmin ? "管理员视角展示全部经营链接。" : "仅展示由当前登录人员负责的经营链接。"}</p></div></header>
    <div class="my-links-summary"><button type="button" data-my-link-filter="all"><span>我的链接</span><strong>${summary.total || 0}</strong></button><button type="button" data-my-link-filter="better"><span>向好链接</span><strong>${summary.better || 0}</strong></button><button type="button" data-my-link-filter="worse"><span>风险链接</span><strong>${summary.risk || 0}</strong></button><button type="button" data-my-link-filter="followed"><span>关注链接</span><strong>${summary.followed || 0}</strong></button></div>
    <nav class="segmented-control my-links-filters" aria-label="我的链接筛选">${tabs.map(([id, label]) => `<button type="button" class="${workbench.filter === id ? "active" : ""}" data-my-link-filter="${id}">${label}</button>`).join("")}</nav>
    ${workbench.loading ? `<div class="empty-state">正在读取我的链接…</div>` : workbench.items.length ? `<div class="my-links-grid">${workbench.items.map((item) => { const trend = trendLabel(item); const anomalies = connectionAnomalies(item); return `<article class="my-link-card"><button type="button" class="my-link-main" data-open-connection="${escapeHtml(item.id)}">${imageHtml(item)}<span class="my-link-content"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(`${shopName(item)} · ${productCodes(item)}`)}</small><span class="my-link-metrics"><em>销售额 <b>${item.currentPayAmount == null ? "—" : `¥${Number(item.currentPayAmount).toLocaleString("zh-CN")}`}</b></em><em>增长 <b>${growthText(item.salesGrowth)}</b></em><em>健康 <b>${escapeHtml(healthText(item.healthStatus))}${item.healthScore == null ? "" : ` ${item.healthScore}分`}</b></em><em>状态 <b>${escapeHtml(statusText(item.status))}</b></em></span><small class="my-link-changes">${escapeHtml(trendDetails(item))}</small><span class="my-link-trend is-${trend.className}">${trend.text}</span></span></button><button type="button" class="my-link-follow ${item.followed ? "is-followed" : ""}" data-toggle-connection-follow="${escapeHtml(item.id)}" data-followed="${item.followed ? "true" : "false"}" aria-label="${item.followed ? "取消关注" : "关注链接"}">${item.followed ? "★ 已关注" : "☆ 关注"}</button>${anomalies.length ? `<div class="connection-anomaly-reminder"><span>⚠ ${escapeHtml(anomalies.map((problem) => problem.title).join("、"))}</span>${canJoinDiagnosis(item) ? `<button type="button" data-join-diagnosis="${escapeHtml(item.id)}">加入诊断</button>` : `<small>${(pageState.hospital.admittedConnectionIds ?? []).includes(item.id) ? "已加入诊断区" : "异常提醒"}</small>`}</div>` : ""}</article>`; }).join("")}</div>` : `<div class="empty-state"><strong>暂无符合条件的链接</strong><p>${workbench.filter === "followed" ? "你还没有关注链接。" : "当前账号没有符合此经营状态的负责链接。"}</p></div>`}
  </section>`;
}

function renderWorkbenchLinkCards(items, { emptyText = "暂无链接", limit = 6, showFollow = false } = {}) {
  const visible = items.slice(0, limit);
  if (!visible.length) return `<div class="empty-state compact">${escapeHtml(emptyText)}</div>`;
  return `<div class="connection-workbench-card-grid">${visible.map((item) => { const trend = trendLabel(item); return `<article class="connection-workbench-link-card ${showFollow ? "has-follow" : ""}"><button type="button" data-open-connection="${escapeHtml(item.id)}">${imageHtml(item)}<span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(`${productCodes(item)} · ${shopName(item)}`)}</small><em>销售 ${item.currentPayAmount == null ? "—" : `¥${Number(item.currentPayAmount).toLocaleString("zh-CN")}`} · ${growthText(item.salesGrowth)}</em><i class="my-link-trend is-${trend.className}">${escapeHtml(trend.text)} · ${escapeHtml(healthText(item.healthStatus))}</i></span></button>${showFollow ? `<button type="button" class="my-link-follow is-followed" data-toggle-connection-follow="${escapeHtml(item.id)}" data-followed="true">★ 已关注</button>` : ""}</article>`; }).join("")}</div>`;
}

function renderConnectionWorkbenchHome() {
  const mine = pageState.myWorkbench; const summary = mine.summary ?? {}; const hospital = pageState.hospital;
  const issues = ["diagnosis", "treatment", "observation"].flatMap((stage) => (hospital.zones?.[stage] ?? []).map((item) => ({ ...item, stage })));
  const followed = mine.items.filter((item) => item.followed); const risks = mine.items.filter((item) => item.trend === "worse");
  const normalCount = mine.items.filter((item) => item.trend === "stable").length;
  const stageText = { diagnosis: "待诊断", treatment: "治疗中", observation: "观察中" };
  const issueCards = issues.length ? `<div class="connection-workbench-issues">${issues.slice(0, 6).map((item) => `<button type="button" data-workbench-hospital="${item.stage}"><span><strong>${escapeHtml(item.connectionName)}</strong><small>${escapeHtml(item.problemTitle || "经营异常")} · ${escapeHtml(item.ownerName || "未分配")}</small></span><em>${escapeHtml(stageText[item.stage])}</em><b>${item.taskCount ? `${item.completedTaskCount}/${item.taskCount}` : item.stage === "diagnosis" ? "待发起行动" : "—"}</b></button>`).join("")}</div>` : `<div class="empty-state compact">当前没有已确认待处理问题</div>`;
  return `<section class="connection-workbench-home"><header><p class="eyebrow">运营人员每日统一入口</p><h2>链接经营工作台</h2><span>${mine.isAdmin ? "管理员当前查看全部经营链接。" : "仅展示当前账号负责和关注的经营链接。"}</span></header>
    <div class="connection-workbench-summary"><button type="button" data-workbench-go="my-links"><span>我的链接</span><strong>${summary.total || 0}</strong></button><button type="button" data-workbench-my-filter="worse"><span>风险链接</span><strong>${summary.risk || 0}</strong></button><button type="button" data-workbench-hospital="diagnosis"><span>诊断中</span><strong>${hospital.counts?.diagnosis || 0}</strong></button><button type="button" data-workbench-hospital="treatment"><span>治疗中</span><strong>${hospital.counts?.treatment || 0}</strong></button><button type="button" data-workbench-hospital="observation"><span>观察中</span><strong>${hospital.counts?.observation || 0}</strong></button></div>
    <section class="connection-workbench-block is-priority"><header><div><h3>待处理问题</h3><p>只展示已经人工确认进入链接医院的连接</p></div><button type="button" class="text-button" data-workbench-go="hospital">进入链接医院 →</button></header>${issueCards}</section>
    <section class="connection-workbench-block"><header><div><h3>我的经营</h3><p>风险优先排列当前负责链接</p></div><button type="button" class="text-button" data-workbench-go="my-links">查看全部 →</button></header><div class="connection-workbench-mine-stats"><span>正常 <b>${normalCount}</b></span><span>向好 <b>${summary.better || 0}</b></span><span>风险 <b>${summary.risk || 0}</b></span></div>${renderWorkbenchLinkCards(mine.items, { emptyText: "当前账号暂无负责链接" })}</section>
    <section class="connection-workbench-block is-risk"><header><div><h3>风险链接</h3><p>优先处理经营指标明显下降的连接</p></div><button type="button" class="text-button" data-workbench-my-filter="worse">查看风险链接 →</button></header>${renderWorkbenchLinkCards(risks, { emptyText: "当前没有风险链接", limit: 4 })}</section>
    <section class="connection-workbench-block"><header><div><h3>重点关注</h3><p>当前账号主动收藏的重要链接</p></div><button type="button" class="text-button" data-workbench-my-filter="followed">查看全部关注 →</button></header>${renderWorkbenchLinkCards(followed, { emptyText: "尚未关注链接", limit: 4, showFollow: true })}</section>
    <section class="connection-workbench-block is-all-links"><header><div><h3>全部链接</h3><p>完整经营链接资产，支持负责人、店铺、平台、健康和经营状态组合筛选</p></div></header>${renderToolbar()}${renderList()}</section>
  </section>`;
}

function renderToolbar() {
  const platforms = [...new Set(pageState.items.map((item) => item.platform).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const shops = [...new Map(pageState.items.map((item) => [item.shopId, { id: item.shopId, name: shopName(item) }])).values()].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  const owners = [...new Map([...(state.people ?? []).filter((person) => person.status === "active"),
    ...(pageState.managementOverview.owners ?? []).filter((owner) => owner.ownerId !== "unassigned")
      .map((owner) => ({ id: owner.ownerId, name: owner.ownerName, status: "active" }))].map((person) => [person.id, person])).values()];
  const filters = pageState.listFilters;
  return `<div class="connection-list-tools">
    <form class="connection-list-filters" data-connection-list-filters>
      <select name="platform" aria-label="平台筛选"><option value="">全部平台</option>${platforms.map((platform) => `<option value="${escapeHtml(platform)}" ${filters.platform === platform ? "selected" : ""}>${escapeHtml(platform)}</option>`).join("")}</select>
      <select name="shopId" aria-label="店铺筛选"><option value="">全部店铺</option>${shops.map((shop) => `<option value="${escapeHtml(shop.id)}" ${filters.shopId === shop.id ? "selected" : ""}>${escapeHtml(shop.name)}</option>`).join("")}</select>
      <input name="productCode" value="${escapeHtml(filters.productCode)}" placeholder="筛选产品编码" aria-label="关联产品编码筛选" />
      <select name="ownerId" aria-label="负责人筛选"><option value="">全部负责人</option><option value="unassigned" ${filters.ownerId === "unassigned" ? "selected" : ""}>未设置负责人</option>${owners.map((person) => `<option value="${escapeHtml(person.id)}" ${filters.ownerId === person.id ? "selected" : ""}>${escapeHtml(person.name)}</option>`).join("")}</select>
      <select name="healthStatus" aria-label="健康状态筛选"><option value="">全部健康状态</option>${["growing", "stable", "attention", "risk", "insufficient_data", "no_data"].map((status) => `<option value="${status}" ${filters.healthStatus === status ? "selected" : ""}>${escapeHtml(healthText(status))}</option>`).join("")}</select>
      <select name="status" aria-label="状态筛选"><option value="">全部状态</option>${["active", "paused", "archived"].map((status) => `<option value="${status}" ${filters.status === status ? "selected" : ""}>${escapeHtml(statusText(status))}</option>`).join("")}</select>
      <button type="submit" class="secondary-button">筛选</button>
      <button type="button" class="text-button" data-clear-connection-filters>清除</button>
    </form>
    <div class="connection-toolbar">
    <div class="segmented-control" aria-label="连接展示方式">
      <button type="button" class="${pageState.view === "list" ? "active" : ""}" data-connection-view="list">列表</button>
      <button type="button" class="${pageState.view === "cards" ? "active" : ""}" data-connection-view="cards">卡片</button>
    </div>
    <div class="segmented-control" aria-label="连接经营排序">
      <button type="button" class="${pageState.sort === "default" ? "active" : ""}" data-connection-sort="default">综合</button>
      <button type="button" class="${pageState.sort === "sales" ? "active" : ""}" data-connection-sort="sales">销售额</button>
      <button type="button" class="${pageState.sort === "growth" ? "active" : ""}" data-connection-sort="growth">增长最快</button>
      <button type="button" class="${pageState.sort === "risk" ? "active" : ""}" data-connection-sort="risk">风险最高</button>
      <button type="button" class="${pageState.sort === "newest" ? "active" : ""}" data-connection-sort="newest">最新连接</button>
    </div>
    <details class="connection-field-settings" ${pageState.fieldSettingsOpen ? "open" : ""}><summary>字段设置</summary><div>${listColumns.map((column) => `<label><input type="checkbox" value="${column.key}" data-connection-column-visibility ${pageState.visibleColumns.includes(column.key) ? "checked" : ""} />${escapeHtml(column.label)}</label>`).join("")}<button type="button" class="secondary-button" data-save-connection-list-config>保存当前列表配置</button></div></details>
    <span class="form-note">新连接档案由生意参谋经营数据导入识别创建</span>
  </div></div>`;
}

function renderGrowthOverview() {
  const top = pageState.growthRankings.topGrowth ?? [];
  const risks = pageState.growthRankings.risks ?? [];
  const cards = (items, emptyText) => items.length ? items.map((item) => `<button type="button" class="connection-growth-row" data-open-connection="${escapeHtml(item.connectionId)}"><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.platform)} · ${escapeHtml(item.shopDisplayName || item.shopName || "未命名店铺")}</small></span><em>${item.healthScore ?? "—"}分</em><b>${growthText(item.salesGrowth)}</b></button>`).join("") : `<div class="empty-state compact">${escapeHtml(emptyText)}</div>`;
  const counts = pageState.healthAttention.counts ?? {};
  const improvements = pageState.improvementSummary;
  const summary = pageState.managementOverview.summary ?? {};
  const owners = pageState.managementOverview.owners ?? [];
  const money = (value) => `¥${Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
  return `<section class="connection-management-summary"><div><span>经营连接</span><strong>${summary.connectionCount || 0}</strong><small>经营中 ${summary.activeCount || 0}</small></div><div><span>最近周期销售额</span><strong>${money(summary.salesAmount)}</strong></div><div><span>同期已确认净利润</span><strong>${money(summary.netProfit)}</strong></div><div><span>平均销售增长</span><strong>${growthText(summary.averageGrowth)}</strong></div><div><span>风险连接</span><strong>${summary.riskCount || 0}</strong></div></section><section class="connection-health-summary"><div><span>风险体检</span><strong>${counts.risk || 0}</strong></div><div><span>关注体检</span><strong>${counts.attention || 0}</strong></div><div><span>流量问题</span><strong>${counts.traffic || 0}</strong></div><div><span>转化问题</span><strong>${counts.conversion || 0}</strong></div><div><span>销售下降</span><strong>${counts.sales || 0}</strong></div><div><span>利润下降</span><strong>${counts.profit || 0}</strong></div></section><section class="connection-improvement-summary"><strong>改善项目</strong><span>全部 ${improvements.total || 0}</span><span>有效 ${improvements.effective || 0}</span><span>观察 ${improvements.observing || 0}</span><span>失败 ${improvements.failed || 0}</span></section><section class="connection-growth-overview"><article><header><strong>TOP10 成长连接</strong><span>按最新两期销售增长</span></header>${cards(top, "至少积累两个经营周期后显示排行")}</article><article><header><strong>需要关注</strong><span>健康分低于60</span></header>${cards(risks, "当前没有风险连接")}</article></section><section class="connection-owner-contribution"><header><div><strong>负责人经营贡献</strong><span>按最近经营周期销售额排序</span></div></header>${owners.length ? `<div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>负责人</th><th>连接数</th><th>销售额</th><th>净利润</th><th>平均增长</th><th>风险连接</th><th>有效改善</th></tr></thead><tbody>${owners.slice(0, 20).map((owner) => `<tr><td><strong>${escapeHtml(owner.ownerName)}</strong></td><td>${owner.connectionCount}</td><td>${money(owner.salesAmount)}</td><td>${money(owner.netProfit)}</td><td>${growthText(owner.averageGrowth)}</td><td>${owner.riskCount}</td><td>${owner.effectiveImprovements}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state compact">暂无负责人经营数据</div>`}</section>`;
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
  const filters = pageState.listFilters;
  const items = pageState.items.filter((item) => {
    const codeQuery = String(filters.productCode || "").trim().toLowerCase();
    return (!filters.shopId || item.shopId === filters.shopId)
      && (!filters.platform || item.platform === filters.platform)
      && (!codeQuery || item.products?.some((product) => String(product.skuCode || "").toLowerCase().includes(codeQuery)))
      && (!filters.ownerId || (filters.ownerId === "unassigned" ? !item.ownerId : item.ownerId === filters.ownerId))
      && (!filters.healthStatus || item.healthStatus === filters.healthStatus)
      && (!filters.status || item.status === filters.status);
  });
  const valueForColumn = (item, key) => ({
    name: item.name || "", platform: item.platform || "", shop: shopName(item), products: productCodes(item),
    period: item.latestPeriodEnd || "", payAmount: Number(item.latestPayAmount || 0), growth: item.salesGrowth == null ? -Infinity : Number(item.salesGrowth),
    health: item.healthScore == null ? Infinity : Number(item.healthScore), profit: Number(item.currentFinance?.netProfit || 0), origin: originText(item.originSource), owner: connectionOwnerName(item), status: statusText(item.status),
  })[key];
  const compareValues = (left, right) => typeof left === "number" || typeof right === "number"
    ? Number(left) - Number(right) : String(left).localeCompare(String(right), "zh-CN", { numeric: true });
  items.sort((a, b) => {
    if (pageState.columnSort.key) {
      const result = compareValues(valueForColumn(a, pageState.columnSort.key), valueForColumn(b, pageState.columnSort.key));
      return pageState.columnSort.direction === "asc" ? result : -result;
    }
    if (pageState.sort === "sales") return Number(b.latestPayAmount || 0) - Number(a.latestPayAmount || 0);
    if (pageState.sort === "growth") return Number(b.salesGrowth ?? -Infinity) - Number(a.salesGrowth ?? -Infinity);
    if (pageState.sort === "risk") return Number(a.healthScore ?? Infinity) - Number(b.healthScore ?? Infinity);
    if (pageState.sort === "newest") return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });
  if (!items.length) return `<div class="empty-state"><strong>没有符合条件的连接</strong><p>请调整店铺、产品编码、负责人或状态筛选。</p></div>`;
  if (pageState.view === "cards") {
    return `<div class="connection-card-grid">${items.map((item) => { const anomalies = connectionAnomalies(item); return `<article class="connection-card ${anomalies.length ? "has-anomaly" : ""}"><button type="button" class="connection-card-main" data-open-connection="${escapeHtml(item.id)}">${imageHtml(item)}<span class="connection-card-body"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(productCodes(item, filters.productCode))}</span><span>${item.latestPeriodEnd ? `${escapeHtml(item.latestPeriodEnd)} · ¥${Number(item.latestPayAmount || 0).toLocaleString("zh-CN")}` : "暂无经营数据"}</span>${Number(item.benchmarkCount || 0) ? `<span class="connection-benchmark-status">对标：${escapeHtml(item.firstBenchmarkName)}${Number(item.benchmarkCount) > 1 ? ` +${Number(item.benchmarkCount) - 1}` : ""}</span>` : `<span class="connection-benchmark-status is-empty">未设置对标</span>`}<em class="status-pill status-${escapeHtml(item.status)}">${escapeHtml(statusText(item.status))}</em></span></button>${anomalies.length ? `<footer><span>⚠ ${escapeHtml(anomalies.map((problem) => problem.title).join("、"))}</span>${canJoinDiagnosis(item) ? `<button type="button" class="primary-button" data-join-diagnosis="${escapeHtml(item.id)}">加入诊断</button>` : `<small>${(pageState.hospital.admittedConnectionIds ?? []).includes(item.id) ? "已加入诊断区" : "异常提醒"}</small>`}</footer>` : ""}</article>`; }).join("")}</div>`;
  }
  const visible = new Set(pageState.visibleColumns);
  const header = listColumns.filter((column) => visible.has(column.key)).map((column) => {
    const active = pageState.columnSort.key === column.key;
    return `<th>${column.sortable ? `<button type="button" data-connection-column-sort="${column.key}">${escapeHtml(column.label)}${active ? (pageState.columnSort.direction === "asc" ? " ↑" : " ↓") : " ↕"}</button>` : escapeHtml(column.label)}</th>`;
  }).join("");
  const cell = (item, key) => ({
    image: imageHtml(item), name: `<strong>${escapeHtml(item.name)}</strong>`, platform: escapeHtml(item.platform), shop: escapeHtml(shopName(item)),
    products: escapeHtml(productCodes(item, filters.productCode)), period: escapeHtml(item.latestPeriodEnd || "—"),
    payAmount: item.latestPayAmount == null ? "—" : `¥${Number(item.latestPayAmount).toLocaleString("zh-CN")}`,
    growth: growthText(item.salesGrowth), health: item.healthScore == null ? "—" : `${Number(item.healthScore)}分`,
    profit: item.currentFinance == null ? "—" : `¥${Number(item.currentFinance.netProfit || 0).toLocaleString("zh-CN")}`,
    origin: escapeHtml(originText(item.originSource)), owner: escapeHtml(connectionOwnerName(item)), status: `<span class="status-pill status-${escapeHtml(item.status)}">${escapeHtml(statusText(item.status))}</span>`,
  })[key];
  return `<div class="connection-table-wrap"><table class="connection-table"><thead><tr>${header}</tr></thead><tbody>${items.map((item) => `<tr tabindex="0" data-open-connection="${escapeHtml(item.id)}">${listColumns.filter((column) => visible.has(column.key)).map((column) => `<td>${cell(item, column.key)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function renderPendingConnections() {
  const pendingRows = pageState.currentImport?.rows?.filter((row) => row.previewStatus === "pending") ?? [];
  return `<section class="connection-pending-page"><header class="connection-toolbar"><div><strong>待识别经营连接</strong><p>只展示生意参谋导入中尚未识别的商品，不再从ERP销售链接直接建立连接档案。</p></div>${canManage() ? `<button type="button" class="primary-button" data-open-business-import>上传生意参谋数据</button>` : ""}</header>
    ${pendingRows.length ? `<div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>商品ID</th><th>商品名称</th><th>原因</th></tr></thead><tbody>${pendingRows.map((row) => `<tr><td><strong>${escapeHtml(row.externalId || "—")}</strong></td><td>${escapeHtml(row.goodsName || "—")}</td><td>${escapeHtml(row.pendingReason === "ambiguous_goods_id" ? "同一店铺商品ID存在多个候选，请核对销售身份" : "历史批次缺少有效店铺，无法安全识别")}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state"><strong>当前没有待识别经营连接</strong><p>上传生意参谋文件并选择平台店铺后，系统会按商品ID创建或复用连接档案。</p></div>`}
  </section>`;
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
  const tabs = [["overview", "经营概况"], ["actions", "经营动作"], ...(canViewHealth() ? [["health", "体检报告"]] : []), ["improvements", "改善记录"], ["trend", "经营趋势"], ["benchmarks", `链接对标${pageState.benchmarks.items.length ? ` ${pageState.benchmarks.items.length}` : ""}`]];
  let body = `<div class="connection-overview"><dl><div><dt>平台</dt><dd>${escapeHtml(item.platform)}</dd></div><div><dt>店铺</dt><dd>${escapeHtml(shopName(item))}</dd></div><div><dt>商品ID</dt><dd>${escapeHtml(item.platformGoodsId || "—")}</dd></div><div><dt>负责人</dt><dd>${escapeHtml(personName(item.ownerId))}</dd></div><div><dt>状态</dt><dd>${escapeHtml(statusText(item.status))}</dd></div></dl><section class="connection-operating-metrics"><div><span>最近周期销售额</span><strong>${item.latestPayAmount == null ? "—" : `¥${Number(item.latestPayAmount).toLocaleString("zh-CN")}`}</strong></div><div><span>销售增长</span><strong>${growthText(item.salesGrowth)}</strong></div><div><span>同期净利润</span><strong>${item.currentFinance == null ? "—" : `¥${Number(item.currentFinance.netProfit || 0).toLocaleString("zh-CN")}`}</strong></div><div><span>利润变化</span><strong>${growthText(item.profitGrowth)}</strong></div><div><span>健康状态</span><strong>${escapeHtml(healthText(item.healthStatus || "no_data"))}</strong></div></section>${canManage() ? `<form class="connection-action-form" data-connection-profile-form><label>连接名称<input name="name" value="${escapeHtml(item.name)}" required maxlength="120" /></label><label>负责人<select name="ownerId"><option value="">未设置</option>${(state.people ?? []).filter((person) => person.status === "active").map((person) => `<option value="${escapeHtml(person.id)}" ${item.ownerId === person.id ? "selected" : ""}>${escapeHtml(person.name)}</option>`).join("")}</select></label><button type="submit" class="secondary-button">保存档案</button></form>` : ""}<section><h3>关联产品</h3>${item.products?.length ? item.products.map((product) => `<a href="#products/${encodeURIComponent(product.id)}" data-product-id="${escapeHtml(product.id)}">${escapeHtml(product.name || product.skuCode)}</a>`).join("、") : "未关联产品"}</section></div>`;
  body = body.replace("<div><dt>负责人</dt>", `<div><dt>档案来源</dt><dd>${escapeHtml(originText(item.originSource))}</dd></div><div><dt>识别时间</dt><dd>${escapeHtml(item.identifiedAt || item.createdAt || "—")}</dd></div><div><dt>负责人</dt>`);
  if (pageState.detailTab === "actions") body = renderActions(item);
  if (pageState.detailTab === "health") body = renderHealthReport();
  if (pageState.detailTab === "improvements") body = renderImprovements();
  if (pageState.detailTab === "trend") {
    const analysis = pageState.growthAnalysis;
    const growthCard = analysis?.comparable ? `<section class="connection-growth-card"><div><span>健康分</span><strong>${analysis.healthScore}</strong><em>${escapeHtml(healthText(analysis.healthStatus))}</em></div><dl><div><dt>销售</dt><dd>${growthText(analysis.salesGrowth)}</dd></div><div><dt>访客</dt><dd>${growthText(analysis.visitorGrowth)}</dd></div><div><dt>转化</dt><dd>${growthText(analysis.conversionChange, { points: true })}</dd></div><div><dt>客单价</dt><dd>${growthText(analysis.customerValueChange)}</dd></div><div><dt>净利润</dt><dd>${growthText(analysis.profitGrowth)}</dd></div></dl></section>` : `<div class="empty-state compact"><strong>${escapeHtml(healthText(analysis?.healthStatus || "no_data"))}</strong><p>需要至少两个经营周期才能计算成长幅度和健康评分。</p></div>`;
    const comparison = analysis?.currentPeriod ? `<div class="connection-table-wrap"><table class="connection-table connection-period-table"><thead><tr><th>周期</th><th>销售额</th><th>访客/浏览</th><th>加购</th><th>转化率</th><th>客单价</th><th>净利润</th></tr></thead><tbody>${[["当前周期", analysis.currentPeriod, analysis.currentFinance], ["上一周期", analysis.previousPeriod, analysis.previousFinance]].filter(([, period]) => period).map(([label, period, finance]) => `<tr><td><strong>${label}</strong><small>${escapeHtml(`${period.periodStart} 至 ${period.periodEnd}`)}</small></td><td>¥${Number(period.payAmount || 0).toLocaleString("zh-CN")}</td><td>${Number(period.visitorCount || 0).toLocaleString("zh-CN")} / ${Number(period.viewCount || 0).toLocaleString("zh-CN")}</td><td>${Number(period.cartCount || 0).toLocaleString("zh-CN")}</td><td>${period.conversionRate == null ? "—" : `${(Number(period.conversionRate) * 100).toFixed(2)}%`}</td><td>${period.customerValue == null ? "—" : `¥${Number(period.customerValue).toFixed(2)}`}</td><td>${finance == null ? "—" : `¥${Number(finance.netProfit || 0).toLocaleString("zh-CN")}`}</td></tr>`).join("")}</tbody></table></div>` : "";
    body = `<div class="connection-growth-detail">${growthCard}${comparison}</div>`;
  }
  if (pageState.detailTab === "benchmarks") body = renderBenchmarkPanel(item);
  return `<section class="connection-detail"><button type="button" class="text-button" data-action="back-connections">← 返回连接列表</button><header>${imageHtml(item)}<div><p class="eyebrow">${escapeHtml(item.platform)} · ${escapeHtml(shopName(item))}</p><h2>${escapeHtml(item.name)}</h2><p>${escapeHtml(productNames(item))}</p></div></header><nav class="connection-tabs">${tabs.map(([id, label]) => `<button type="button" class="${pageState.detailTab === id ? "active" : ""}" data-connection-tab="${id}">${label}</button>`).join("")}</nav>${body}</section>`;
}

function benchmarkMoney(value) { return value === null || value === undefined ? "—" : `¥${Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`; }
function benchmarkNumber(value) { return value === null || value === undefined ? "—" : Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 }); }
function benchmarkPercent(value) { return value === null || value === undefined ? "—" : `${(Number(value) * 100).toFixed(2)}%`; }

function renderBenchmarkPanel(item) {
  const benchmark = pageState.benchmarks;
  return `<section class="connection-benchmark-panel"><header><div><h3>链接对标分析</h3><p>保存市场对标资料，左右并排查看两个商品详情页。</p></div></header>
    ${canManage() ? `<form data-benchmark-settings><div class="benchmark-target-form"><label>对标类型<select name="targetType" data-benchmark-target-type><option value="external">外部市场链接</option><option value="internal">系统内优秀链接</option></select></label><label data-external-benchmark-field>对标链接URL<input name="targetUrl" type="url" placeholder="https://..." /></label><label data-internal-benchmark-field hidden>系统内链接<select name="internalConnectionId"><option value="">请选择</option>${benchmark.candidates.map((candidate) => `<option value="${escapeHtml(candidate.id)}">${escapeHtml(`${candidate.name} · ${candidate.platform} · ${candidate.shopDisplayName || candidate.shopName || "未命名店铺"}`)}</option>`).join("")}</select></label><label>平台<input name="platform" placeholder="淘宝、天猫、抖音等" /></label><label>商品标题<input name="title" required maxlength="200" /></label><label>商品图片URL<input name="mainImage" type="url" placeholder="无图片可留空" /></label><label>商品价格<input name="price" type="number" min="0" step="0.01" /></label><label>销量信息<input name="salesInfo" placeholder="按采集页面原文填写" /></label><label>评价信息<input name="reviewInfo" placeholder="按采集页面原文填写" /></label><label>商品卖点<textarea name="sellingPoints" rows="2"></textarea></label><label>详情页内容<textarea name="detailContent" rows="3"></textarea></label><label>备注<textarea name="notes" rows="2"></textarea></label></div><button type="submit" class="primary-button">添加对标链接</button></form>` : ""}
    ${benchmark.loading ? `<div class="empty-state compact">正在读取对标资料…</div>` : benchmark.items.length ? `<div class="benchmark-selected-list">${benchmark.items.map((target) => `<article><div>${target.mainImage ? `<img src="${escapeHtml(resolveAssetUrl(target.mainImage))}" alt="" />` : `<span class="connection-image-placeholder">无图</span>`}<span><strong>${escapeHtml(target.title)}</strong><small>${escapeHtml(`${target.platform || "未标注平台"} · ${target.targetType === "internal" ? "系统内链接" : target.targetUrl || "外部链接"}`)}</small></span></div><div><button type="button" class="primary-button" data-open-benchmark-comparison="${escapeHtml(target.id)}">打开对比页面</button>${canManage() ? `<button type="button" class="text-button danger" data-delete-benchmark="${escapeHtml(target.id)}">删除</button>` : ""}</div></article>`).join("")}</div>` : `<div class="empty-state"><strong>尚未设置对标链接</strong><p>可以添加外部市场竞品，也可以选择系统内其他优秀链接。</p></div>`}
  </section>`;
}

function renderOwnProductPage(label, item) {
  const period = item?.currentPeriod ?? {}; const finance = item?.currentFinance; const metrics = item?.metrics ?? {};
  return `<article class="benchmark-phone-page"><span class="benchmark-page-label">${escapeHtml(label)}</span><div class="benchmark-product-image">${imageHtml(item || {})}</div><section><h3>${escapeHtml(item?.name || "暂无标题")}</h3><strong class="benchmark-price">${benchmarkMoney(metrics.price)}</strong><div class="benchmark-commerce-row"><span>销量 ${benchmarkNumber(period.payQuantity)}</span><span>评价 ${benchmarkNumber(metrics.reviewCount)}</span></div></section><dl><div><dt>销售额</dt><dd>${benchmarkMoney(period.payAmount)}</dd></div><div><dt>转化率</dt><dd>${benchmarkPercent(period.conversionRate)}</dd></div><div><dt>利润</dt><dd>${benchmarkMoney(finance?.netProfit)}</dd></div><div><dt>增长率</dt><dd>${growthText(item?.salesGrowth)}</dd></div></dl><section><h4>商品卖点</h4><p>${escapeHtml(metrics.sellingPoints || "暂无数据")}</p></section><section><h4>详情页内容</h4><p>${escapeHtml(metrics.detailContent || "暂无数据")}</p></section><footer>${escapeHtml(`${item?.platform || "—"} · ${item?.shopDisplayName || item?.shopName || "—"} · ${productCodes(item || {})}`)}</footer></article>`;
}

function renderTargetProductPage(label, target) {
  const internal = target?.internal;
  if (internal) return renderOwnProductPage(label, internal);
  return `<article class="benchmark-phone-page"><span class="benchmark-page-label">${escapeHtml(label)}</span><div class="benchmark-product-image">${target?.mainImage ? `<img src="${escapeHtml(resolveAssetUrl(target.mainImage))}" alt="${escapeHtml(target.title)}" />` : `<span class="connection-image-placeholder">暂无商品图片</span>`}</div><section><h3>${escapeHtml(target?.title || "暂无标题")}</h3><strong class="benchmark-price">${benchmarkMoney(target?.price)}</strong><div class="benchmark-commerce-row"><span>销量 ${escapeHtml(target?.salesInfo || "暂无数据")}</span><span>评价 ${escapeHtml(target?.reviewInfo || "暂无数据")}</span></div></section><section><h4>商品卖点</h4><p>${escapeHtml(target?.sellingPoints || "暂无数据")}</p></section><section><h4>详情页内容</h4><p>${escapeHtml(target?.detailContent || "暂无数据")}</p></section><section><h4>备注</h4><p>${escapeHtml(target?.notes || "暂无数据")}</p></section><footer>${escapeHtml(target?.platform || "未标注平台")}${target?.targetUrl ? ` · <a href="${escapeHtml(target.targetUrl)}" target="_blank" rel="noopener noreferrer">打开原链接</a>` : ""}</footer></article>`;
}

function renderBenchmarkModal() {
  const comparison = pageState.benchmarks.comparison;
  if (!comparison) return "";
  return `<div class="modal-backdrop" data-close-benchmark-comparison><section class="modal-panel benchmark-comparison-modal" role="dialog" aria-modal="true" aria-label="链接对标分析" data-benchmark-comparison-modal><header><div><p class="eyebrow">两个商品详情页并排分析</p><h2>链接对标分析</h2></div><button type="button" class="icon-button" data-close-benchmark-comparison aria-label="关闭">×</button></header><div class="benchmark-comparison-grid">${renderOwnProductPage("我的链接", comparison.mine)}${renderTargetProductPage("对标链接", comparison.target)}</div></section></div>`;
}

function renderDiagnosisModal() {
  if (!pageState.diagnosisModalId) return "";
  const item = pageState.items.find((candidate) => candidate.id === pageState.diagnosisModalId)
    ?? pageState.myWorkbench.items.find((candidate) => candidate.id === pageState.diagnosisModalId);
  if (!item) return "";
  const problems = connectionAnomalies(item);
  return `<div class="modal-backdrop" data-close-diagnosis-modal><section class="modal-panel connection-modal" role="dialog" aria-modal="true" aria-label="加入诊断区" data-diagnosis-modal><header><div><p class="eyebrow">人工确认经营异常</p><h2>加入诊断区</h2></div><button type="button" class="icon-button" data-close-diagnosis-modal aria-label="关闭">×</button></header><div class="diagnosis-confirm-summary"><strong>${escapeHtml(item.name)}</strong>${problems.map((problem) => `<span><b>${escapeHtml(problem.title)}</b>${escapeHtml(problem.value)}</span>`).join("")}</div><form data-diagnosis-confirm-form><label>诊断备注<textarea name="notes" rows="4" placeholder="说明为什么需要进入诊断，以及建议优先检查的方向"></textarea></label><p class="form-note">确认后只加入诊断区，不会自动创建关键行动或任务。</p><footer><button type="button" class="secondary-button" data-close-diagnosis-modal>取消</button><button type="submit" class="primary-button">确认加入诊断</button></footer></form></section></div>`;
}

function externalData(mapping, key, fallback = "—") {
  return mapping.externalData?.[key] || fallback;
}

function renderMappingPage() {
  const rows = pageState.mappings;
  return `<section class="connection-mapping-page">
    <form class="connection-mapping-filters" data-mapping-filter-form>
      <select name="sourceType" aria-label="数据来源"><option value="business_advisor" ${pageState.mappingFilters.sourceType === "business_advisor" ? "selected" : ""}>生意参谋</option><option value="wangdian" ${pageState.mappingFilters.sourceType === "wangdian" ? "selected" : ""}>旺店通</option><option value="taobao" ${pageState.mappingFilters.sourceType === "taobao" ? "selected" : ""}>淘宝</option><option value="xiaohongshu" ${pageState.mappingFilters.sourceType === "xiaohongshu" ? "selected" : ""}>小红书</option><option value="douyin" ${pageState.mappingFilters.sourceType === "douyin" ? "selected" : ""}>抖音</option></select>
      <select name="matchStatus" aria-label="关联状态"><option value="">全部状态</option><option value="pending" ${pageState.mappingFilters.matchStatus === "pending" ? "selected" : ""}>待关联连接</option><option value="matched" ${pageState.mappingFilters.matchStatus === "matched" ? "selected" : ""}>已关联连接</option><option value="ignored" ${pageState.mappingFilters.matchStatus === "ignored" ? "selected" : ""}>已忽略</option><option value="rejected" ${pageState.mappingFilters.matchStatus === "rejected" ? "selected" : ""}>已拒绝</option></select>
      <input name="search" value="${escapeHtml(pageState.mappingFilters.search)}" placeholder="搜索商品ID" />
      <button type="submit" class="secondary-button">筛选</button>
    </form>
    ${pageState.mappingLoading ? `<div class="empty-state">正在读取数据关联…</div>` : rows.length ? `<div class="connection-table-wrap"><table class="connection-table connection-mapping-table"><thead><tr><th>商品ID</th><th>商品名称</th><th>货号</th><th>销售连接</th><th>状态</th><th>操作</th></tr></thead><tbody>${rows.map((mapping) => `<tr><td><strong>${escapeHtml(mapping.externalId)}</strong><small>${escapeHtml(mapping.externalShopId || "未标注外部店铺")}</small></td><td>${escapeHtml(externalData(mapping, "goodsName", externalData(mapping, "title")))}</td><td>${escapeHtml(externalData(mapping, "sku", externalData(mapping, "merchantSkuCode")))}</td><td>${escapeHtml(mapping.connectionName || mapping.salesLinkTitle || "未找到商品ID对应连接")}</td><td><span class="status-pill status-${escapeHtml(mapping.matchStatus)}">${escapeHtml(statusText(mapping.matchStatus))}</span></td><td><div class="connection-mapping-actions">${mapping.matchStatus === "pending" && canManage() ? `<button type="button" class="text-button" data-open-pending-connections>查看待识别经营连接</button><button type="button" class="text-button" data-ignore-mapping="${escapeHtml(mapping.id)}">忽略</button>` : ""}${mapping.connectionId ? `<button type="button" class="text-button" data-view-mapping-connection="${escapeHtml(mapping.connectionId)}">查看连接</button>` : ""}</div></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state"><strong>暂无符合条件的数据</strong><p>生意参谋仅按商品ID识别经营连接，不使用货号、SKU或商品名称。</p></div>`}
  </section>`;
}

function renderMappingModal() {
  if (!pageState.mappingModalId) return "";
  const mapping = pageState.mappings.find((item) => item.id === pageState.mappingModalId);
  if (!mapping) return "";
  return `<div class="modal-backdrop" data-action="close-mapping-modal"><section class="modal-panel connection-modal" role="dialog" aria-modal="true" aria-label="确认数据关联" data-mapping-modal><header><div><p class="eyebrow">${escapeHtml(mapping.externalId)}</p><h2>确认关联连接</h2></div><button type="button" class="icon-button" data-action="close-mapping-modal" aria-label="关闭">×</button></header><form data-confirm-mapping-form><label>连接档案<select name="connectionId" required><option value="">请选择</option>${pageState.items.map((item) => `<option value="${escapeHtml(item.id)}" ${mapping.connectionId === item.id ? "selected" : ""}>${escapeHtml(`${item.name} · ${item.platform} · ${shopName(item)}`)}</option>`).join("")}</select></label><footer><button type="button" class="secondary-button" data-action="close-mapping-modal">取消</button><button type="submit" class="primary-button">确认关联</button></footer></form></section></div>`;
}

function importStatusText(status) {
  return ({ draft: "草稿", parsed: "已解析", validated: "待确认关联", completed: "已完成", failed: "失败" })[status] ?? status;
}

function renderImportRows(rows) {
  if (!rows.length) return `<div class="empty-state compact">暂无数据</div>`;
  const pending = pageState.importTab === "pending";
  return `<div class="connection-table-wrap"><table class="connection-table connection-import-table"><thead><tr><th>商品ID</th><th>商品名称</th><th>货号</th><th>${pending ? "处理状态" : "识别结果"}</th><th>识别方式</th>${pending ? "<th>操作</th>" : ""}</tr></thead><tbody>${rows.map((row) => `<tr><td><strong>${escapeHtml(row.externalId || "—")}</strong></td><td>${escapeHtml(row.goodsName || "—")}</td><td>${escapeHtml(row.sku || "—")}</td><td>${pending ? escapeHtml(row.pendingReason === "ambiguous_goods_id" ? "当前身份范围存在多个同商品ID候选" : "历史批次未记录有效店铺") : escapeHtml(row.connectionName || (row.resolutionAction === "create_sales_link_profile" ? "提交后创建销售身份和连接档案" : row.resolutionAction === "create_profile" ? "提交后创建连接档案" : "复用已有连接档案"))}</td><td>${escapeHtml(row.matchMethod === "goods_id" ? "商品ID精确识别" : "—")}</td>${pending ? `<td><div class="connection-mapping-actions">${canManage() ? `<button type="button" class="text-button" data-ignore-import-row="${escapeHtml(row.externalId)}">忽略</button>` : ""}</div></td>` : ""}</tr>`).join("")}</tbody></table></div>`;
}

function renderImportPage() {
  const current = pageState.currentImport;
  const batch = current?.batch;
  const matchedRows = current?.rows?.filter((row) => row.previewStatus === "matched") ?? [];
  const pendingRows = current?.rows?.filter((row) => row.previewStatus === "pending") ?? [];
  const errorRows = current?.rows?.filter((row) => row.previewStatus === "error") ?? [];
  return `<section class="connection-import-page">
    ${canManage() ? `<form class="connection-import-form" data-connection-import-form><label>生意参谋Excel<input type="file" name="file" accept=".xls,.xlsx" required /></label><label>业务日期<input type="date" name="businessDate" /></label><label>平台店铺<select name="externalShopId" required><option value="">请选择</option>${pageState.importShops.map((shop) => `<option value="${escapeHtml(shop.id)}">${escapeHtml(`${shop.platform} · ${shop.displayName || shop.shopName}`)}</option>`).join("")}</select></label><button type="submit" class="primary-button">上传并生成预览</button></form>` : ""}
    ${pageState.importBatches.length ? `<label class="connection-import-history">历史批次<select data-import-batch-select><option value="">选择批次</option>${pageState.importBatches.map((item) => `<option value="${escapeHtml(item.id)}" ${batch?.id === item.id ? "selected" : ""}>${escapeHtml(`${item.businessDate} · ${item.fileName} · ${importStatusText(item.status)}`)}</option>`).join("")}</select></label>` : ""}
    ${pageState.importLoading ? `<div class="empty-state">正在解析和识别连接…</div>` : batch ? `<div class="connection-import-summary"><div><span>总数据</span><strong>${batch.totalRows}</strong></div><div><span>已识别连接</span><strong>${batch.matchedRows}</strong></div><div><span>待关联连接</span><strong>${batch.pendingRows}</strong></div><div><span>错误</span><strong>${batch.errorRows}</strong></div></div><div class="connection-import-meta"><span>${escapeHtml(batch.fileName)} · ${escapeHtml(batch.businessDate)}</span><span class="status-pill status-${escapeHtml(batch.status)}">${escapeHtml(importStatusText(batch.status))}</span>${canManage() && batch.status !== "completed" ? `<button type="button" class="primary-button" data-commit-import>确认已识别连接</button>` : ""}</div>${batch.status === "completed" ? `<form class="connection-period-confirm" data-period-snapshot-form><strong>检测周期：${escapeHtml(batch.periodStart || "待确认")} 至 ${escapeHtml(batch.periodEnd || "待确认")}</strong><span>确认后按整个周期保存经营事实，不会拆分成每日数据。</span><label>开始日期<input type="date" name="periodStart" value="${escapeHtml(batch.periodStart || "")}" required /></label><label>结束日期<input type="date" name="periodEnd" value="${escapeHtml(batch.periodEnd || "")}" required /></label><label>周期类型<select name="periodType"><option value="rolling_30d" ${batch.periodType === "rolling_30d" ? "selected" : ""}>近30天滚动周期</option><option value="calendar_month" ${batch.periodType === "calendar_month" ? "selected" : ""}>自然月</option><option value="custom_period" ${batch.periodType === "custom_period" ? "selected" : ""}>自定义周期</option></select></label>${canManage() ? `<button type="submit" class="primary-button">确认并生成周期快照</button>` : ""}</form>` : ""}<nav class="connection-tabs"><button type="button" class="${pageState.importTab === "matched" ? "active" : ""}" data-import-tab="matched">已关联连接 ${matchedRows.length}</button><button type="button" class="${pageState.importTab === "pending" ? "active" : ""}" data-import-tab="pending">待关联连接 ${pendingRows.length}</button><button type="button" class="${pageState.importTab === "error" ? "active" : ""}" data-import-tab="error">错误 ${errorRows.length}</button></nav>${renderImportRows(pageState.importTab === "pending" ? pendingRows : pageState.importTab === "error" ? errorRows : matchedRows)}` : `<div class="empty-state"><strong>尚未上传经营数据</strong><p>上传生意参谋商品经营Excel后，先识别连接，再确认经营周期并生成周期快照。</p></div>`}
  </section>`;
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
  const pageContent = pageState.section === "workbench" ? renderConnectionWorkbenchHome() : pageState.section === "hospital" ? renderConnectionHospital() : pageState.section === "my-links" ? renderMyLinksWorkbench() : pageState.section === "mappings" ? renderMappingPage() : pageState.section === "imports" ? renderImportPage() : pageState.section === "pending-connections" ? renderPendingConnections() : `${renderGrowthOverview()}${renderToolbar()}${renderList()}`;
  return `<section class="connection-center-page">${pageState.error ? `<div class="form-error">${escapeHtml(pageState.error)}</div>` : ""}${pageState.loading ? `<div class="empty-state">正在读取连接…</div>` : pageState.selectedId ? renderDetail() : `${renderSectionNavigation()}${pageContent}`}${renderMappingModal()}${renderImprovementModal()}${renderBenchmarkModal()}${renderDiagnosisModal()}</section>`;
}

async function loadHospital(render) {
  pageState.hospital.loading = true; pageState.error = ""; render();
  try { const result = await loadConnectionHospital(); pageState.hospital = { ...pageState.hospital, ...result, loading: false }; }
  catch (error) { pageState.error = error.message; pageState.hospital.loading = false; }
  render();
}

async function loadMyLinks(render, filter = pageState.myWorkbench.filter) {
  pageState.myWorkbench.loading = true; pageState.myWorkbench.filter = filter; pageState.error = ""; render();
  try { const result = await loadMyConnectionWorkbench(filter); pageState.myWorkbench = { ...pageState.myWorkbench, ...result, filter, loading: false }; }
  catch (error) { pageState.error = error.message; pageState.myWorkbench.loading = false; }
  render();
}

async function loadPage(render) {
  pageState.loading = true; pageState.error = ""; render();
  try {
    const [connections, rankings, managementOverview, healthAttention, improvementSummary, importShops, hospital, myWorkbench] = await Promise.all([loadConnections(), loadConnectionGrowthRankings(), loadConnectionManagementOverview(), canViewHealth() ? loadAttentionConnectionHealthRecords() : Promise.resolve({ items: [], counts: {} }), loadConnectionImprovementSummary(), loadConnectionImportShops(), canViewHealth() ? loadConnectionHospital() : Promise.resolve({ zones: { diagnosis: [], treatment: [], observation: [] }, counts: {}, admittedConnectionIds: [] }), loadMyConnectionWorkbench("all")]);
    const analysisByConnection = new Map((rankings.listMetrics ?? []).map((item) => [item.connectionId, item]));
    pageState.items = (connections.items ?? []).map((item) => {
      const analysis = analysisByConnection.get(item.id);
      return { ...item, salesGrowth: analysis?.salesGrowth ?? null, visitorGrowth: analysis?.visitorGrowth ?? null,
        conversionChange: analysis?.conversionChange ?? null, healthScore: analysis?.healthScore ?? null,
        healthStatus: analysis?.healthStatus ?? "no_data", currentFinance: analysis?.currentFinance ?? null, profitGrowth: analysis?.profitGrowth ?? null };
    });
    pageState.growthRankings = rankings;
    pageState.managementOverview = managementOverview;
    pageState.healthAttention = healthAttention;
    pageState.improvementSummary = improvementSummary.summary;
    pageState.hospital = { ...pageState.hospital, ...hospital };
    pageState.myWorkbench = { ...pageState.myWorkbench, ...myWorkbench, filter: "all", loading: false };
    pageState.importShops = importShops.items ?? [];
    pageState.loaded = true;
  } catch (error) { pageState.error = error.message; }
  pageState.loading = false; render();
}

async function openConnection(id, render) {
  pageState.selectedId = id; pageState.detailTab = "overview"; pageState.actions = []; pageState.periodSnapshots = []; pageState.growthAnalysis = null; pageState.healthRecords = []; pageState.healthModalId = ""; pageState.improvements = []; pageState.benchmarks = { items: [], candidates: [], comparison: null, comparisonId: "", loading: false }; render();
}

async function loadBenchmarks(render) {
  pageState.benchmarks.loading = true; pageState.error = ""; render();
  try {
    const [benchmarks, candidates] = await Promise.all([loadConnectionBenchmarks(pageState.selectedId), loadConnectionBenchmarkCandidates(pageState.selectedId)]);
    pageState.benchmarks = { ...pageState.benchmarks, ...benchmarks, candidates: candidates.items ?? [], loading: false };
  } catch (error) { pageState.error = error.message; pageState.benchmarks.loading = false; }
  render();
}

async function loadMappings(render) {
  pageState.mappingLoading = true; pageState.error = ""; render();
  try { pageState.mappings = (await loadConnectionDataMappings(pageState.mappingFilters)).items ?? []; }
  catch (error) { pageState.error = error.message; }
  pageState.mappingLoading = false; render();
}

async function loadPendingConnections(render) {
  pageState.loading = true; pageState.error = ""; render();
  try {
    pageState.importBatches = (await loadConnectionImportBatches()).items ?? [];
    pageState.currentImport = pageState.importBatches[0] ? await loadConnectionImportPreview(pageState.importBatches[0].id) : null;
  }
  catch (error) { pageState.error = error.message; }
  pageState.loading = false; render();
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
    if (pageState.section === "pending-connections") void loadPendingConnections(render);
    if (pageState.section === "my-links") void loadMyLinks(render);
    if (pageState.section === "hospital") void loadHospital(render);
    if (pageState.section === "mappings") void loadMappings(render);
    if (pageState.section === "imports") void loadImportBatches(render, true);
  }));
  root.querySelectorAll("[data-workbench-go]").forEach((button) => button.addEventListener("click", () => {
    pageState.section = button.dataset.workbenchGo; pageState.selectedId = ""; render();
    if (pageState.section === "my-links") void loadMyLinks(render, "all");
    if (pageState.section === "hospital") void loadHospital(render);
  }));
  root.querySelectorAll("[data-workbench-my-filter]").forEach((button) => button.addEventListener("click", () => {
    pageState.section = "my-links"; pageState.selectedId = ""; void loadMyLinks(render, button.dataset.workbenchMyFilter);
  }));
  root.querySelectorAll("[data-workbench-hospital]").forEach((button) => button.addEventListener("click", () => {
    pageState.section = "hospital"; pageState.hospital.stage = button.dataset.workbenchHospital; pageState.selectedId = ""; void loadHospital(render);
  }));
  root.querySelectorAll("[data-hospital-stage]").forEach((button) => button.addEventListener("click", () => { pageState.hospital.stage = button.dataset.hospitalStage; render(); }));
  root.querySelectorAll("[data-hospital-diagnose]").forEach((button) => button.addEventListener("click", () => {
    const item = pageState.hospital.zones.diagnosis.find((candidate) => candidate.connectionId === button.dataset.hospitalDiagnose);
    if (!item?.healthRecord) return; pageState.healthRecords = [item.healthRecord]; pageState.healthModalId = item.healthRecord.id; render();
  }));
  root.querySelectorAll("[data-hospital-transition]").forEach((button) => button.addEventListener("click", async () => {
    try { await updateConnectionImprovement(button.dataset.hospitalTransition, { status: button.dataset.nextStatus }); await loadHospital(render); }
    catch (error) { pageState.error = error.message; render(); }
  }));
  root.querySelectorAll("[data-join-diagnosis]").forEach((button) => button.addEventListener("click", () => {
    pageState.diagnosisModalId = button.dataset.joinDiagnosis; render();
  }));
  root.querySelectorAll("[data-close-diagnosis-modal]").forEach((element) => element.addEventListener("click", (event) => {
    if (event.target.closest("[data-diagnosis-modal]") && !event.target.matches("[data-close-diagnosis-modal]")) return;
    pageState.diagnosisModalId = ""; render();
  }));
  root.querySelector("[data-diagnosis-confirm-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const connectionId = pageState.diagnosisModalId;
    try { await joinConnectionDiagnosis(connectionId, Object.fromEntries(new FormData(event.currentTarget))); pageState.diagnosisModalId = ""; await loadHospital(render);
      pageState.section = "hospital"; pageState.hospital.stage = "diagnosis"; pageState.selectedId = ""; render(); }
    catch (error) { pageState.error = error.message; render(); }
  });
  root.querySelectorAll("[data-my-link-filter]").forEach((button) => button.addEventListener("click", () => { void loadMyLinks(render, button.dataset.myLinkFilter); }));
  root.querySelectorAll("[data-toggle-connection-follow]").forEach((button) => button.addEventListener("click", async () => {
    try { await updateConnectionFollow(button.dataset.toggleConnectionFollow, button.dataset.followed !== "true"); await loadMyLinks(render); }
    catch (error) { pageState.error = error.message; render(); }
  }));
  root.querySelectorAll("[data-open-pending-connections]").forEach((button) => button.addEventListener("click", () => { pageState.section = "pending-connections"; pageState.selectedId = ""; void loadPendingConnections(render); }));
  root.querySelector("[data-open-business-import]")?.addEventListener("click", () => { pageState.section = "imports"; pageState.selectedId = ""; void loadImportBatches(render, true); });
  root.querySelectorAll("[data-connection-view]").forEach((button) => button.addEventListener("click", () => { pageState.view = button.dataset.connectionView; render(); }));
  root.querySelector("[data-connection-list-filters]")?.addEventListener("submit", (event) => {
    event.preventDefault(); pageState.listFilters = Object.fromEntries(new FormData(event.currentTarget)); render();
  });
  root.querySelector("[data-clear-connection-filters]")?.addEventListener("click", () => {
    pageState.listFilters = { platform: "", shopId: "", productCode: "", ownerId: "", healthStatus: "", status: "" }; render();
  });
  root.querySelectorAll("[data-connection-sort]").forEach((button) => button.addEventListener("click", () => {
    pageState.sort = button.dataset.connectionSort; pageState.columnSort = { key: "", direction: "asc" }; render();
  }));
  root.querySelectorAll("[data-connection-column-sort]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation(); const key = button.dataset.connectionColumnSort;
    pageState.columnSort = pageState.columnSort.key === key
      ? { key, direction: pageState.columnSort.direction === "asc" ? "desc" : "asc" }
      : { key, direction: "asc" };
    render();
  }));
  root.querySelectorAll("[data-connection-column-visibility]").forEach((checkbox) => checkbox.addEventListener("change", () => {
    const selected = [...root.querySelectorAll("[data-connection-column-visibility]:checked")].map((item) => item.value);
    if (!selected.length) { checkbox.checked = true; return; }
    pageState.visibleColumns = selected; pageState.fieldSettingsOpen = true; render();
  }));
  root.querySelector(".connection-field-settings")?.addEventListener("toggle", (event) => { pageState.fieldSettingsOpen = event.currentTarget.open; });
  root.querySelector("[data-save-connection-list-config]")?.addEventListener("click", () => {
    saveListConfig(); pageState.fieldSettingsOpen = false; pageState.error = ""; render();
  });
  root.querySelectorAll("[data-open-connection]").forEach((element) => {
    const open = () => void openConnection(element.dataset.openConnection, render);
    element.addEventListener("click", open);
    element.addEventListener("keydown", (event) => { if (["Enter", " "].includes(event.key)) open(); });
  });
  root.querySelector('[data-action="back-connections"]')?.addEventListener("click", () => { pageState.selectedId = ""; render(); });
  root.querySelector("[data-connection-profile-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await updateConnection(pageState.selectedId, Object.fromEntries(new FormData(event.currentTarget)));
      pageState.items = pageState.items.map((item) => item.id === result.item.id ? { ...item, ...result.item } : item);
      pageState.error = ""; render();
    } catch (error) { pageState.error = error.message; render(); }
  });
  root.querySelectorAll("[data-connection-tab]").forEach((button) => button.addEventListener("click", async () => {
    pageState.detailTab = button.dataset.connectionTab; render();
    if (pageState.detailTab === "actions") { try { pageState.actions = (await loadConnectionActions(pageState.selectedId)).items ?? []; render(); } catch (error) { pageState.error = error.message; render(); } }
    if (pageState.detailTab === "trend") { try { const [snapshots, analysis] = await Promise.all([loadConnectionPeriodSnapshots(pageState.selectedId), loadConnectionGrowthAnalysis(pageState.selectedId)]); pageState.periodSnapshots = snapshots.items ?? []; pageState.growthAnalysis = analysis.item; render(); } catch (error) { pageState.error = error.message; render(); } }
    if (pageState.detailTab === "health") { try { const [records, analysis] = await Promise.all([loadConnectionHealthRecords(pageState.selectedId), loadConnectionGrowthAnalysis(pageState.selectedId)]); pageState.healthRecords = records.items ?? []; pageState.growthAnalysis = analysis.item; render(); } catch (error) { pageState.error = error.message; render(); } }
    if (pageState.detailTab === "improvements") { try { pageState.improvements = (await loadConnectionImprovements({ connectionId: pageState.selectedId })).items ?? []; render(); } catch (error) { pageState.error = error.message; render(); } }
    if (pageState.detailTab === "benchmarks") await loadBenchmarks(render);
  }));
  root.querySelector("[data-benchmark-settings]")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const payload = Object.fromEntries(new FormData(event.currentTarget));
    try { const result = await createConnectionBenchmark(pageState.selectedId, payload); pageState.benchmarks.items.push(result.item);
      pageState.items = pageState.items.map((item) => item.id === pageState.selectedId
        ? { ...item, benchmarkCount: pageState.benchmarks.items.length, firstBenchmarkName: pageState.benchmarks.items[0]?.title || null } : item);
      pageState.error = ""; render(); }
    catch (error) { pageState.error = error.message; render(); }
  });
  root.querySelector("[data-benchmark-target-type]")?.addEventListener("change", (event) => {
    const internal = event.target.value === "internal"; const externalField = root.querySelector("[data-external-benchmark-field]"); const internalField = root.querySelector("[data-internal-benchmark-field]");
    if (externalField) externalField.hidden = internal; if (internalField) internalField.hidden = !internal;
    const titleInput = root.querySelector('[data-benchmark-settings] [name="title"]'); if (titleInput) titleInput.required = !internal;
  });
  root.querySelectorAll("[data-delete-benchmark]").forEach((button) => button.addEventListener("click", async () => {
    if (!window.confirm("确认删除这个对标链接？")) return;
    try { await removeConnectionBenchmark(pageState.selectedId, button.dataset.deleteBenchmark); pageState.benchmarks.items = pageState.benchmarks.items.filter((item) => item.id !== button.dataset.deleteBenchmark);
      pageState.items = pageState.items.map((item) => item.id === pageState.selectedId ? { ...item, benchmarkCount: pageState.benchmarks.items.length, firstBenchmarkName: pageState.benchmarks.items[0]?.title || null } : item); render(); }
    catch (error) { pageState.error = error.message; render(); }
  }));
  root.querySelectorAll("[data-open-benchmark-comparison]").forEach((button) => button.addEventListener("click", async () => {
    pageState.benchmarks.loading = true; render();
    try { const result = await loadConnectionBenchmarkComparison(pageState.selectedId, button.dataset.openBenchmarkComparison); pageState.benchmarks.comparison = result; pageState.benchmarks.comparisonId = button.dataset.openBenchmarkComparison; pageState.error = ""; }
    catch (error) { pageState.error = error.message; }
    pageState.benchmarks.loading = false; render();
  }));
  root.querySelectorAll("[data-close-benchmark-comparison]").forEach((element) => element.addEventListener("click", (event) => {
    if (event.target.closest("[data-benchmark-comparison-modal]") && !event.target.matches("[data-close-benchmark-comparison]")) return;
    pageState.benchmarks.comparison = null; pageState.benchmarks.comparisonId = ""; render();
  }));
  root.querySelector("[data-generate-health]")?.addEventListener("click", async () => {
    try { const result = await createConnectionHealthRecord(pageState.selectedId, pageState.growthAnalysis.currentPeriod.snapshotId); pageState.healthRecords = [result.item, ...pageState.healthRecords.filter((item) => item.id !== result.item.id)]; pageState.healthAttention = await loadAttentionConnectionHealthRecords(); render(); }
    catch (error) { pageState.error = error.message; render(); }
  });
  root.querySelectorAll("[data-create-improvement]").forEach((button) => button.addEventListener("click", () => { pageState.healthModalId = button.dataset.createImprovement; render(); }));
  root.querySelectorAll('[data-action="close-improvement-modal"]').forEach((element) => element.addEventListener("click", (event) => { if (event.target.closest("[data-improvement-modal]") && !event.target.matches('[data-action="close-improvement-modal"]')) return; pageState.healthModalId = ""; render(); }));
  root.querySelector("[data-improvement-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try { const result = await createConnectionImprovementAction(pageState.healthModalId, Object.fromEntries(new FormData(event.currentTarget))); pageState.healthModalId = ""; pageState.improvementSummary = (await loadConnectionImprovementSummary()).summary; if (pageState.section === "hospital") await loadHospital(render); window.alert(`改善行动草稿及改善项目已创建：${result.instance.businessCode || result.instance.id}`); render(); }
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
  root.querySelectorAll("[data-ignore-import-row]").forEach((button) => button.addEventListener("click", async () => {
    try { await ignoreConnectionImportRow(pageState.currentImport.batch.id, button.dataset.ignoreImportRow); pageState.currentImport = await loadConnectionImportPreview(pageState.currentImport.batch.id); render(); }
    catch (error) { pageState.error = error.message; render(); }
  }));
}
