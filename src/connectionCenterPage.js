import {
  commitConnectionImport,
  confirmConnectionFoundationImport,
  confirmConnectionFoundationBulkImport,
  confirmConnectionSalesFactImport,
  confirmPlatformLinkShopMappingImport,
  createConnectionHealthRecord,
  createConnectionImprovementAction,
  createConnectionPeriodSnapshots,
  createConnectionAction,
  loadConnectionActions,
  loadConnectionDataMappings,
  loadConnectionImportBatches,
  loadConnectionDataFoundation,
  loadConnectionImportShops,
  loadConnectionImportPreview,
  loadConnectionGrowthAnalysis,
  loadConnectionGrowthRankings,
  loadConnectionManagementOverview,
  loadConnectionBusinessCockpit,
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
  loadConnectionAssets,
  readConnectionFoundationBulkImport,
  previewConnectionOwnerImport,
  loadCurrentConnectionOwnerImport,
  loadConnectionOwnerImportRows,
  loadCurrentConnectionSalesFactImport,
  previewConnectionSalesFactImport,
  previewPlatformLinkShopMappingImport,
  confirmConnectionOwnerImport,
  rebuildConnectionOwnerImportPreview,
  cancelConnectionOwnerImport,
  loadConnectionCoreDetail,
  loadMyConnectionWorkbench,
  loadLinkSalesRanking,
  loadLinkDataStatus,
  removeConnectionAction,
  ignoreConnectionImportRow,
  updateConnectionDataMapping,
  updateConnection,
  updateConnectionImprovement,
  updateConnectionFollow,
  uploadConnectionImport,
  uploadConnectionFoundationImport,
  uploadConnectionFoundationBulkImport,
  createConnectionFoundationTemplate,
  iterateConnectionFoundationTemplate,
  resolveAssetUrl,
} from "./services/connectionCenterService.js?v=20260806-bulk-platform-import1";
import { getCurrentUser, state } from "./appState.js";
import { hasPermission } from "./permissions.js?v=20260705-state-singleton1";
import { escapeHtml } from "./utils/html.js?v=20260802-module-boundary1";
import { renderUiModule } from "./uiModuleRegistry.js";
import "./uiModules/linkSalesRanking.js?v=20260809-my-link-workspace1";
import "./uiModules/linkDataStatus.js?v=20260809-my-link-workspace1";
import "./uiModules/myLinkSummary.js?v=20260809-my-link-workspace1";
import "./uiModules/linkHospitalTodo.js?v=20260809-my-link-workspace1";
import "./uiModules/linkList.js?v=20260809-my-link-workspace1";

const pageState = {
  loaded: false,
  loadedUserId: "",
  loading: false,
  items: [],
  pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 },
  assetMetaLoaded: false,
  loadedSections: new Set(),
  importShops: [],
  selectedId: "",
  view: "list",
  sort: "default",
  columnSort: { key: "", direction: "asc" },
  listFilters: { search: "", platform: "", shopId: "", productCode: "", ownerId: "", healthStatus: "", status: "", salesStatus: "", profitStatus: "", productRelation: "", skuCount: "" },
  visibleColumns: ["image", "name", "platform", "shop", "erpSales", "erpProfit", "health", "owner", "status"],
  fieldSettingsOpen: false,
  detailTab: "basic",
  actions: [],
  periodSnapshots: [],
  growthAnalysis: null,
  growthRankings: { topGrowth: [], risks: [] },
  managementOverview: { summary: {}, owners: [] },
  cockpit: { summary: {}, health: {}, coreLinks: [], riskLinks: [], growthLinks: [], platforms: [], productChannels: [], trends: { erp: [], platform: [] }, periodType: "month" },
  healthRecords: [],
  healthAttention: { items: [], counts: { risk: 0, attention: 0, traffic: 0, conversion: 0, sales: 0 } },
  healthModalId: "",
  improvements: [],
  improvementSummary: { total: 0, effective: 0, observing: 0, failed: 0 },
  section: "cockpit",
  dataCenterTab: "data-foundation",
  myWorkbench: { items: [], summary: { total: 0, better: 0, risk: 0, followed: 0 }, pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 }, serverPaged: true, filter: "all", search: "", isAdmin: false, loading: false, loaded: false },
  linkDataStatus: { data: null, loading: false, loaded: false, error: "" },
  salesRanking: { scope: "mine", range: { preset: "7d" }, items: [], summary: {}, loading: false, error: "" },
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
  foundation: { definitions: {}, templates: [], batches: [], errors: [], loading: false, preview: null, bulkPreview: null, salesPreview: null, salesLoading: false, salesError: "", salesMessage: "", salesFileName: "", salesFile: null, shopMappingPreview: null },
  coreDetail: null,
  coreDetailLoading: false,
  ownerImport: { loading: false, result: null, showCompletion: false, detailKind: "", detailRows: [], detailPagination: null },
  salesPeriodType: "month",
  error: "",
};
let connectionListRequestId = 0;
let connectionSearchTimer = 0;

const listConfigKey = "connection-center-list-config-v2";
const listColumns = [
  { key: "image", label: "图片", sortable: false },
  { key: "name", label: "连接名称", sortable: true },
  { key: "platform", label: "平台", sortable: true },
  { key: "shop", label: "店铺", sortable: true },
  { key: "goodsId", label: "商品ID", sortable: true },
  { key: "erpSales", label: "ERP销售额", sortable: true },
  { key: "erpProfit", label: "ERP利润", sortable: true },
  { key: "relations", label: "产品 / SKU", sortable: true },
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

function isAdmin() {
  const user = getCurrentUser();
  return ["admin", "system_admin"].includes(user?.role) || user?.authRole === "admin";
}

function canImportBusinessData() {
  return canManage() || hasPermission(getCurrentUser(), "links.import");
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

export function matchesConnectionAssetSearch(item, query) {
  const normalized = String(query || "").trim().toLowerCase();
  if (!normalized) return true;
  return [item.name, item.salesLinkTitle, item.platformGoodsId, item.platform, shopName(item),
    ...(item.products ?? []).flatMap((product) => [product.skuCode, product.name])]
    .some((part) => String(part || "").toLowerCase().includes(normalized));
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
    platform_link_import: "平台链接导入",
    platform_link_operations: "平台链接经营导入",
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
    <button type="button" class="${pageState.section === "cockpit" ? "active" : ""}" data-connection-section="cockpit">经营驾驶舱</button>
    <button type="button" class="${pageState.section === "my-links" ? "active" : ""}" data-connection-section="my-links">我的链接</button>
    <button type="button" class="${pageState.section === "connections" ? "active" : ""}" data-connection-section="connections">链接资产</button>
    ${canViewHealth() ? `<button type="button" class="${pageState.section === "hospital" ? "active" : ""}" data-connection-section="hospital">链接医院</button>` : ""}
    ${canImportBusinessData() ? `<button type="button" class="${pageState.section === "data-import" ? "active" : ""}" data-connection-section="data-import">数据导入</button>` : ""}
    ${isAdmin() ? `<button type="button" class="${pageState.section === "data-center" ? "active" : ""}" data-connection-section="data-center">数据中心</button>` : ""}
  </nav>`;
}

function renderConnectionDataCenter() {
  const tabs = [
    ["data-foundation", "数据导入"],
    ["mappings", "字段映射"],
  ];
  const content = pageState.dataCenterTab === "imports" ? renderImportPage()
    : pageState.dataCenterTab === "mappings" ? renderMappingPage()
      : pageState.dataCenterTab === "pending-connections" ? renderPendingConnections()
        : renderDataFoundation();
  if (!isAdmin()) return `<div class="empty-state"><strong>无权访问数据中心</strong><p>数据中心仅作为管理员后台。</p></div>`;
  return `<section class="connection-data-center"><header class="connection-section-heading"><div><p class="eyebrow">ADMIN DATA CENTER</p><h2>数据中心</h2><p>管理员统一查看后台批次、日志、异常、模板和调度。</p></div><button type="button" class="primary-button" data-open-admin-data-center>进入管理员数据中心</button></header><div class="connection-import-type-grid"><article><strong>导入批次</strong><span>查看每次导入和同步执行</span></article><article><strong>同步日志</strong><span>追踪API请求与执行过程</span></article><article><strong>异常中心</strong><span>统一处理隔离异常</span></article><article><strong>模板管理</strong><span>维护管理员解析规则</span></article><article><strong>字段映射</strong><span>查看和维护数据映射</span></article><article><strong>自动调度</strong><span>管理API同步任务</span></article></div><nav class="connection-data-center-nav" aria-label="链接数据中心功能">${tabs.filter(([id]) => id !== "data-foundation").map(([id, label]) => `<button type="button" class="${pageState.dataCenterTab === id ? "active" : ""}" data-connection-data-tab="${id}">${label}</button>`).join("")}</nav>${pageState.dataCenterTab === "mappings" ? content : ""}</section>`;
}

function renderDataFoundation() {
  const foundation = pageState.foundation; const types = Object.entries(foundation.definitions);
  const typeLabel = (key) => foundation.definitions[key]?.label || key;
  const preview = foundation.preview;
  const previewPanel = preview ? `<section class="connection-import-preview ${preview.blocked ? "is-blocked" : ""}"><header><div><p class="eyebrow">IMPORT PREVIEW</p><h3>平台链接经营导入预览</h3></div><span class="status-pill">${preview.blocked ? "已阻断" : preview.batch?.status === "completed" || preview.batch?.status === "completed_with_errors" ? "已导入" : "待确认"}</span></header><div class="connection-import-preview-grid"><span>识别模板<strong>${escapeHtml(preview.preview?.templateName || "—")}</strong></span><span>平台<strong>${escapeHtml(preview.preview?.platform || "—")}</strong></span><span>店铺<strong>${escapeHtml(preview.preview?.shop || "—")}</strong></span><span>数据周期<strong>${escapeHtml(preview.preview?.periodStart && preview.preview?.periodEnd ? `${preview.preview.periodStart} 至 ${preview.preview.periodEnd}` : "多个周期 / 无法汇总")}</strong></span><span>原始行数<strong>${escapeHtml(preview.preview?.rawRows ?? 0)}</strong></span><span>过滤后行数<strong>${escapeHtml(preview.preview?.filteredRows ?? 0)}</strong></span><span>新增链接<strong>${escapeHtml(preview.preview?.newLinks ?? 0)}</strong></span><span>更新链接<strong>${escapeHtml(preview.preview?.updatedLinks ?? 0)}</strong></span><span>经营事实<strong>${escapeHtml(preview.preview?.operationFacts ?? 0)}</strong></span><span>异常数量<strong>${escapeHtml(preview.preview?.errors ?? 0)}</strong></span></div>${preview.preview?.duplicateGoodsIds?.length ? `<p class="form-error">过滤后商品ID重复：${escapeHtml(preview.preview.duplicateGoodsIds.join("、"))}</p>` : ""}<footer><small>确认前不会创建链接档案或写入经营事实。</small>${canImportBusinessData() && !preview.blocked && !["completed", "completed_with_errors"].includes(preview.batch?.status) ? `<button type="button" class="primary-button" data-confirm-foundation-import="${escapeHtml(preview.batch.id)}">确认导入</button>` : ""}</footer></section>` : "";
  const salesPreview = foundation.salesPreview;
  const salesSummary = salesPreview?.summary || {};
  const salesBatchStatus = salesPreview?.dataSyncBatch?.status;
  const salesStatusText = salesPreview?.blocked ? "无可写入数据" : salesPreview?.isCurrent ? "待确认" : ["succeeded", "partial"].includes(salesBatchStatus) ? "已导入" : "历史预览";
  const salesPreviewPanel = salesPreview ? `<section class="connection-import-preview ${salesPreview.blocked ? "is-blocked" : ""}"><header><div><p class="eyebrow">SALES FACT PREVIEW</p><h3>链接利润表预览</h3></div><span class="status-pill">${salesStatusText}</span></header><div class="connection-import-preview-grid"><span>批次ID<strong>${escapeHtml(salesPreview.dataSyncBatch?.id || "—")}</strong></span><span>文件<strong>${escapeHtml(salesSummary.fileName || "—")}</strong></span><span>解析版本<strong>${escapeHtml(salesSummary.parserVersion || "—")}</strong></span><span>总行数<strong>${salesSummary.total || 0}</strong></span><span>有效候选<strong>${salesSummary.valid || 0}</strong></span><span>异常<strong>${salesSummary.exceptionCount || 0}</strong></span><span>周期开始<strong>${escapeHtml(salesSummary.periodStart || "—")}</strong></span><span>周期结束<strong>${escapeHtml(salesSummary.periodEnd || "—")}</strong></span></div>${salesPreview.idempotent ? `<p class="form-note">该文件已有 sales-fact-v2 批次，已展示已有结果，未重复创建。</p>` : ""}<footer><small>复用统一真实销售导入任务；确认前不会写入销售事实。</small>${canImportBusinessData() && salesPreview.isCurrent && !salesPreview.blocked ? `<button type="button" class="primary-button" data-confirm-sales-fact-import="${escapeHtml(salesPreview.dataSyncBatch?.id)}">确认导入链接利润表</button>` : ""}</footer></section>` : "";
  const shopPreview = foundation.shopMappingPreview;
  const shopSummary = shopPreview?.summary || {};
  const shopPreviewPanel = shopPreview ? `<section class="connection-import-preview"><header><div><p class="eyebrow">SHOP MATCH PREVIEW</p><h3>店铺匹配预览</h3></div><span class="status-pill">待确认</span></header><div class="connection-import-preview-grid"><span>总行数<strong>${shopSummary.total || 0}</strong></span><span>可新增<strong>${shopSummary.valid || 0}</strong></span><span>已存在<strong>${shopSummary.existing || 0}</strong></span><span>异常<strong>${shopSummary.errors || 0}</strong></span></div><div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>平台</th><th>商品ID</th><th>系统店铺</th><th>结果</th></tr></thead><tbody>${(shopPreview.rows || []).slice(0, 50).map((row) => `<tr><td>${escapeHtml(row.platform || "—")}</td><td>${escapeHtml(row.platformGoodsId || "—")}</td><td>${escapeHtml(row.systemShopText || "—")}</td><td>${escapeHtml(row.message || row.status)}</td></tr>`).join("")}</tbody></table></div><footer><small>只保存解析匹配配置，不修改链接身份和店铺字段。</small>${canImportBusinessData() && shopPreview.batch?.status === "preview_ready" ? `<button type="button" class="primary-button" data-confirm-shop-mapping-import="${escapeHtml(shopPreview.batch.id)}">确认导入店铺匹配</button>` : ""}</footer></section>` : "";
  const bulkPreview = foundation.bulkPreview;
  const bulkStatusText = { waiting: "排队中", running: "处理中", preview_ready: "待批量确认", preview_ready_with_errors: "待确认 · 有异常", completed: "已完成", completed_with_errors: "已完成 · 有异常", failed: "处理失败" };
  const fileStatusText = { waiting: "等待", running: "解析中", preview_ready: "待确认", already_imported: "历史已导入", blocked: "已阻断", failed: "异常", completed: "已导入", completed_with_errors: "已导入 · 有异常" };
  const bulkPreviewPanel = bulkPreview ? `<section class="connection-import-preview ${bulkPreview.batch?.failedCount ? "is-blocked" : ""}"><header><div><p class="eyebrow">BULK IMPORT PREVIEW</p><h3>平台链接数据批量预览</h3></div><span class="status-pill">${escapeHtml(bulkStatusText[bulkPreview.batch?.status] || bulkPreview.batch?.status)}</span></header><div class="connection-import-preview-grid"><span>文件总数<strong>${escapeHtml(bulkPreview.batch?.fileCount || 0)}</strong></span><span>已处理<strong>${escapeHtml(bulkPreview.batch?.processedCount || 0)}</strong></span><span>原始行数<strong>${escapeHtml(bulkPreview.summary?.rawRows || 0)}</strong></span><span>过滤后行数<strong>${escapeHtml(bulkPreview.summary?.filteredRows || 0)}</strong></span><span>新增链接<strong>${escapeHtml(bulkPreview.summary?.newLinks || 0)}</strong></span><span>更新链接<strong>${escapeHtml(bulkPreview.summary?.updatedLinks || 0)}</strong></span><span>经营事实<strong>${escapeHtml(bulkPreview.summary?.operationFacts || 0)}</strong></span><span>异常数量<strong>${escapeHtml(bulkPreview.summary?.errors || 0)}</strong></span></div><div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>文件</th><th>平台</th><th>店铺</th><th>有效行</th><th>异常</th><th>状态</th></tr></thead><tbody>${(bulkPreview.files || []).map((file) => `<tr><td>${escapeHtml(file.fileName)}</td><td>${escapeHtml(file.platform || "识别中")}</td><td>${escapeHtml(file.shop || "—")}</td><td>${escapeHtml(file.summary?.filteredRows || 0)}</td><td>${escapeHtml(file.summary?.errors || 0)}</td><td>${escapeHtml(fileStatusText[file.status] || file.status)}${file.errorMessage ? `<small>${escapeHtml(file.errorMessage)}</small>` : ""}</td></tr>`).join("")}</tbody></table></div><footer><small>后台按文件顺序处理；确认前不创建链接或写入经营事实。</small>${canImportBusinessData() && ["preview_ready", "preview_ready_with_errors"].includes(bulkPreview.batch?.status) ? `<button type="button" class="primary-button" data-confirm-foundation-bulk-import="${escapeHtml(bulkPreview.batch.id)}">批量确认导入</button>` : ""}</footer></section>` : "";
  return `<section class="connection-foundation-page">
    <header class="connection-section-heading"><div><p class="eyebrow">BUSINESS DATA IMPORT</p><h2>业务数据导入</h2><p>业务人员直接上传文件；系统自动识别平台与解析规则，管理员在下方维护模板。</p></div></header>
    ${renderImportStatus(foundation.loading ? "parsed" : foundation.batches?.[0]?.status)}
    <div class="connection-import-type-grid"><article><strong>导入平台链接数据表</strong><span>创建链接资产并写入平台表现</span></article><article><strong>导入平台货品表</strong><span>建立平台SKU与ERP SKU关系</span></article><article><strong>导入链接利润表</strong><span>写入真实销售、成本和利润事实</span></article><article><strong>导入负责人匹配表</strong><span>全量跨店铺更新链接负责人</span></article></div>
    ${canImportBusinessData() ? `<div class="connection-business-import-grid"><form class="connection-foundation-import-form" data-foundation-bulk-import-form><label>平台链接数据表（可多选）<input type="file" name="files" accept=".xls,.xlsx" multiple required /></label><button type="submit" class="primary-button">批量上传并后台预览</button></form><form class="connection-foundation-import-form" data-sales-fact-import-form novalidate><label>链接利润表<input type="file" name="file" accept=".xls,.xlsx" ${foundation.salesLoading ? "disabled" : ""} data-sales-fact-file /></label>${foundation.salesFileName ? `<small>已选择：${escapeHtml(foundation.salesFileName)}</small>` : ""}<button type="submit" class="primary-button" ${foundation.salesLoading ? "disabled aria-busy=\"true\"" : ""}>${foundation.salesLoading ? "正在上传并解析…" : "上传利润表并解析"}</button><div class="connection-import-feedback" aria-live="polite">${foundation.salesError ? `<span class="form-error">${escapeHtml(foundation.salesError)}</span>` : foundation.salesMessage ? `<span class="form-success">${escapeHtml(foundation.salesMessage)}</span>` : ""}</div></form><form class="connection-foundation-import-form" data-shop-mapping-import-form><label>店铺匹配表<input type="file" name="file" accept=".xls,.xlsx" required /></label><button type="submit" class="secondary-button">读取店铺匹配</button></form></div>` : ""}
    ${renderOwnerImport()}
    ${bulkPreviewPanel}${previewPanel}
    ${salesPreviewPanel}${shopPreviewPanel}
    ${canManage() ? `<section class="connection-foundation-panel"><h3>管理员解析模板</h3><form data-foundation-template-form class="connection-foundation-template-form"><input name="name" placeholder="模板名称" required /><select name="dataType">${types.map(([key, definition]) => `<option value="${escapeHtml(key)}">${escapeHtml(definition.label)}</option>`).join("")}</select><input name="sourcePlatform" placeholder="来源平台" /><textarea name="fieldMappingsJson" placeholder='字段映射，例如 {"商品ID":"platformGoodsId"}' required></textarea><input name="changeNote" placeholder="版本说明" /><button type="submit" class="secondary-button">新增模板 V1</button></form><div class="connection-template-list">${foundation.templates.map((item) => `<article><div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(typeLabel(item.dataType))} · V${escapeHtml(item.version)} · ${escapeHtml(item.status)}</span></div><button type="button" class="text-button" data-iterate-foundation-template="${escapeHtml(item.id)}">迭代版本</button></article>`).join("") || "<p>暂无解析模板。</p>"}</div></section>` : ""}
    <section class="connection-foundation-panel"><h3>导入记录</h3><div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>文件</th><th>类型</th><th>时间</th><th>成功</th><th>异常</th><th>状态</th></tr></thead><tbody>${foundation.batches.map((item) => `<tr><td>${escapeHtml(item.fileName)}</td><td>${escapeHtml(typeLabel(item.importType))}</td><td>${escapeHtml(item.createdAt)}</td><td>${escapeHtml(item.matchedRows)}</td><td>${escapeHtml(item.errorRows)}</td><td>${escapeHtml(item.status)}</td></tr>`).join("") || `<tr><td colspan="6">暂无导入记录</td></tr>`}</tbody></table></div></section>
    <section class="connection-foundation-panel"><h3>异常列表</h3><div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>文件</th><th>行号</th><th>外部标识</th><th>异常类型</th><th>说明</th></tr></thead><tbody>${foundation.errors.map((item) => `<tr><td>${escapeHtml(item.fileName)}</td><td>${escapeHtml(item.rowNumber)}</td><td>${escapeHtml(item.externalKey || "—")}</td><td>${escapeHtml(item.errorType)}</td><td>${escapeHtml(item.errorMessage)}</td></tr>`).join("") || `<tr><td colspan="5">暂无导入异常</td></tr>`}</tbody></table></div></section>
  </section>`;
}

function hospitalMetric(value, points = false) { return growthText(value, { points }); }

function renderConnectionHospital() {
  const hospital = pageState.hospital; const stage = hospital.stage; const items = hospital.zones?.[stage] ?? [];
  const meta = { diagnosis: ["诊断区", ""], treatment: ["治疗区", ""], observation: ["观察区", ""] };
  const card = (item) => { const taskProgress = item.taskCount ? `${item.completedTaskCount}/${item.taskCount}` : "尚未生成任务";
    const operation = stage === "diagnosis" ? (!item.improvementId
      ? item.healthRecord && canCreateImprovement() ? `<button type="button" class="primary-button" data-hospital-diagnose="${escapeHtml(item.connectionId)}">发起链接诊断行动</button>` : `<button type="button" class="secondary-button" data-open-connection="${escapeHtml(item.connectionId)}">进入详情完成体检</button>`
      : item.improvementStatus === "planned" && canImprove() ? `<button type="button" class="primary-button" data-hospital-transition="${escapeHtml(item.improvementId)}" data-next-status="executing">诊断完成，进入治疗</button>` : "")
      : stage === "treatment" && canImprove() ? `<button type="button" class="primary-button" data-hospital-transition="${escapeHtml(item.improvementId)}" data-next-status="observing">治疗完成，进入观察</button>`
      : stage === "observation" && canImprove() ? `<div class="hospital-observation-actions"><button type="button" class="primary-button" data-hospital-transition="${escapeHtml(item.improvementId)}" data-next-status="effective">数据恢复</button><button type="button" class="secondary-button" data-hospital-transition="${escapeHtml(item.improvementId)}" data-next-status="failed">未恢复</button></div>` : "";
    return `<article class="connection-hospital-card is-${stage}"><header><button type="button" data-open-connection="${escapeHtml(item.connectionId)}"><strong>${escapeHtml(item.connectionName)}</strong><small>${escapeHtml(`${item.platform} · ${item.shopName}`)}</small></button><span class="status-pill hospital-stage-pill is-${stage}">${escapeHtml(meta[stage][0])}</span></header><div class="hospital-problem"><strong>${escapeHtml(item.problemTitle)}</strong><span>健康 ${item.healthScore == null ? "—" : `${item.healthScore}分`} · 负责人 ${escapeHtml(item.ownerName || "未分配")}</span></div><div class="hospital-metrics"><span>销售 ${coreMoney(item.erpSales?.salesAmount)}</span><span>利润 ${coreMoney(item.erpSales?.profitAmount)}</span><span>销售变化 ${hospitalMetric(item.salesGrowth)}</span><span>流量 ${hospitalMetric(item.visitorGrowth)}</span><span>转化 ${hospitalMetric(item.conversionChange, true)}</span></div>${stage !== "diagnosis" ? `<div class="hospital-treatment"><span>改善方案：${escapeHtml(item.treatmentPlan)}</span><span>任务进度：${escapeHtml(taskProgress)}</span>${stage === "observation" ? `<span>${item.recoveryStatus === "recovered" ? "经营数据已恢复" : "等待新周期验证"}</span>` : ""}</div>` : item.diagnosisEntry?.notes ? `<div class="hospital-treatment"><span>诊断备注：${escapeHtml(item.diagnosisEntry.notes)}</span></div>` : ""}<footer>${operation}<button type="button" class="text-button" data-open-connection="${escapeHtml(item.connectionId)}">查看链接详情</button></footer></article>`; };
  return `<section class="connection-hospital"><header><div><h2>链接医院</h2></div></header><div class="connection-hospital-zones">${Object.entries(meta).map(([id, [label]]) => `<button type="button" class="${stage === id ? "is-active" : ""}" data-hospital-stage="${id}"><span>${label}</span><strong>${hospital.counts?.[id] || 0}</strong></button>`).join("")}</div>${hospital.loading ? `<div class="empty-state">正在读取链接健康状态…</div>` : items.length ? `<div class="connection-hospital-grid">${items.map(card).join("")}</div>` : `<div class="empty-state"><strong>${escapeHtml(meta[stage][0])}暂无链接</strong></div>`}</section>`;
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
  const stageText = { diagnosis: "待诊断", treatment: "治疗中", observation: "观察中" };
  const issues = ["diagnosis", "treatment", "observation"].flatMap((stage) => (pageState.hospital.zones?.[stage] ?? []).map((item) => ({ ...item, stage })));
  const search = workbench.search.trim();
  const filteredItems = workbench.items.filter((item) => matchesConnectionAssetSearch(item, search));
  const page = workbench.pagination?.page || 1;
  const totalPages = workbench.serverPaged ? (workbench.pagination?.totalPages || 1) : Math.max(1, Math.ceil(filteredItems.length / 50));
  const visibleItems = workbench.serverPaged ? filteredItems : filteredItems.slice((page - 1) * 50, page * 50);
  const issueCountByConnection = new Map();
  issues.forEach((item) => issueCountByConnection.set(item.connectionId, Number(issueCountByConnection.get(item.connectionId) || 0) + 1));
  const listItems = visibleItems.map((item) => { const trend = trendLabel(item); const anomalies = connectionAnomalies(item); const issueCount = issueCountByConnection.get(item.id) || anomalies.length;
    return { id: item.id, imageHtml: imageHtml(item), name: item.name, goodsId: item.platformGoodsId, channel: `${item.platform} · ${shopName(item)}`,
      yesterdaySales: item.yesterdaySalesAmount == null ? "暂无数据" : coreMoney(item.yesterdaySalesAmount), growth: growthText(item.salesGrowth), trendClass: trend.className,
      health: item.healthScore == null ? healthText(item.healthStatus) : `${item.healthScore}分`, status: trend.text, issueText: issueCount ? `${issueCount} 项` : "无",
      followed: item.followed, canJoinDiagnosis: canJoinDiagnosis(item) }; });
  const pendingIssues = Object.values(pageState.hospital.counts || {}).reduce((total, value) => total + Number(value || 0), 0);
  return `<section class="my-links-workbench"><header><div><p class="eyebrow">MY LINK WORKSPACE</p><h2>我的链接</h2><p>关注销售贡献、经营风险与今天需要处理的问题。</p></div></header>
    ${renderUiModule("link_data_status", { state: pageState.linkDataStatus })}
    ${renderUiModule("my_link_summary", { summary: { ...summary, pendingIssues }, money: coreMoney })}
    <div class="my-link-workspace-columns">
      ${renderUiModule("link_sales_ranking", { state: pageState.salesRanking, canViewCompany: false, workbenchItems: workbench.items })}
      ${renderUiModule("link_hospital_todo", { items: issues.map((item) => ({ ...item, stageLabel: stageText[item.stage] })), counts: pageState.hospital.counts })}
    </div>
    ${renderUiModule("link_list", { items: listItems, total: search ? filteredItems.length : (workbench.pagination?.total || filteredItems.length), page, totalPages, search, filter: workbench.filter, loading: workbench.loading })}
  </section>`;
}

function renderWorkbenchLinkCards(items, { emptyText = "暂无链接", limit = 6, showFollow = false } = {}) {
  const visible = items.slice(0, limit);
  if (!visible.length) return `<div class="empty-state compact">${escapeHtml(emptyText)}</div>`;
  return `<div class="connection-workbench-card-grid">${visible.map((item) => { const trend = trendLabel(item); return `<article class="connection-workbench-link-card ${showFollow ? "has-follow" : ""}"><button type="button" data-open-connection="${escapeHtml(item.id)}">${imageHtml(item)}<span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(`${item.platform} · ${shopName(item)}`)}</small><em>销售 ${item.currentPayAmount == null ? "—" : `¥${Number(item.currentPayAmount).toLocaleString("zh-CN")}`} · ${growthText(item.salesGrowth)}</em><i class="my-link-trend is-${trend.className}">${escapeHtml(trend.text)} · ${escapeHtml(healthText(item.healthStatus))}</i></span></button>${showFollow ? `<button type="button" class="my-link-follow is-followed" data-toggle-connection-follow="${escapeHtml(item.id)}" data-followed="true">★ 已关注</button>` : ""}</article>`; }).join("")}</div>`;
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
      <input name="search" value="${escapeHtml(filters.search)}" placeholder="搜索名称 / 商品ID / 店铺 / 平台 / 产品编码" aria-label="链接资产统一搜索" />
      <select name="platform" aria-label="平台筛选"><option value="">全部平台</option>${platforms.map((platform) => `<option value="${escapeHtml(platform)}" ${filters.platform === platform ? "selected" : ""}>${escapeHtml(platform)}</option>`).join("")}</select>
      <select name="shopId" aria-label="店铺筛选"><option value="">全部店铺</option>${shops.map((shop) => `<option value="${escapeHtml(shop.id)}" ${filters.shopId === shop.id ? "selected" : ""}>${escapeHtml(shop.name)}</option>`).join("")}</select>
      <input name="productCode" value="${escapeHtml(filters.productCode)}" placeholder="筛选产品编码" aria-label="关联产品编码筛选" />
      <select name="ownerId" aria-label="负责人筛选"><option value="">全部负责人</option><option value="unassigned" ${filters.ownerId === "unassigned" ? "selected" : ""}>未分配负责人</option><option value="assigned" ${filters.ownerId === "assigned" ? "selected" : ""}>已分配负责人</option>${owners.map((person) => `<option value="${escapeHtml(person.id)}" ${filters.ownerId === person.id ? "selected" : ""}>${escapeHtml(person.name)}</option>`).join("")}</select>
      <select name="healthStatus" aria-label="健康状态筛选"><option value="">全部健康状态</option>${["growing", "stable", "attention", "risk", "insufficient_data", "no_data"].map((status) => `<option value="${status}" ${filters.healthStatus === status ? "selected" : ""}>${escapeHtml(healthText(status))}</option>`).join("")}</select>
      <select name="salesStatus" aria-label="销售状态筛选"><option value="">全部销售状态</option><option value="selling" ${filters.salesStatus === "selling" ? "selected" : ""}>有真实销售</option><option value="no_sales" ${filters.salesStatus === "no_sales" ? "selected" : ""}>暂无真实销售</option></select>
      <select name="profitStatus" aria-label="利润状态筛选"><option value="">全部利润状态</option><option value="profit" ${filters.profitStatus === "profit" ? "selected" : ""}>盈利</option><option value="loss" ${filters.profitStatus === "loss" ? "selected" : ""}>亏损</option><option value="unknown" ${filters.profitStatus === "unknown" ? "selected" : ""}>无利润数据</option></select>
      <select name="productRelation" aria-label="产品关联筛选"><option value="">全部产品关联</option><option value="linked" ${filters.productRelation === "linked" ? "selected" : ""}>已关联产品</option><option value="unlinked" ${filters.productRelation === "unlinked" ? "selected" : ""}>未关联产品</option></select>
      <select name="skuCount" aria-label="SKU数量筛选"><option value="">全部SKU数量</option><option value="single" ${filters.skuCount === "single" ? "selected" : ""}>单SKU</option><option value="multiple" ${filters.skuCount === "multiple" ? "selected" : ""}>多SKU</option><option value="none" ${filters.skuCount === "none" ? "selected" : ""}>无SKU</option></select>
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

function renderConnectionAssets() {
  return `<section class="connection-assets"><header class="connection-section-heading"><div><p class="eyebrow">LINK ASSETS</p><h2>链接资产</h2><p>统一查看、筛选和管理公司的销售链接档案。</p></div></header>${renderUiModule("link_sales_ranking", { state: pageState.salesRanking, canViewCompany: isAdmin() })}${renderGrowthOverview()}${renderToolbar()}${renderList()}</section>`;
}

function renderOwnerImport() {
  if (!canManage()) return "";
  const result = pageState.ownerImport.result; const preview = result?.preview ?? {}; const rows = pageState.ownerImport.detailRows ?? [];
  const statusText = { matched: "已匹配", unmatched: "未匹配", conflict: "冲突", ignored: "已忽略", success: "已更新" };
  const batchStatus = { validated: "待确认", preview_ready: "待确认", completed: "已完成", partial: "部分完成", cancelled: "已取消" };
  const exceptions = rows.filter((row) => row.status !== "matched" && row.status !== "success");
  const skipped = Number(preview.unchangedRows || 0) + Number(preview.unmatchedRows || 0) + Number(preview.conflictRows || 0) + Number(preview.ignoredRows || 0);
  const changeGroups = preview.ownerChangeGroups || [];
  const canSubmit = canManage() && result?.submission?.canSubmit && !pageState.ownerImport.loading;
  if (result && pageState.ownerImport.showCompletion && ["completed", "partial"].includes(result.batch?.status)) {
    const exceptionCount = Number(preview.unmatchedRows || 0) + Number(preview.conflictRows || 0) + Number(preview.ignoredRows || 0);
    return `<section class="connection-owner-completion"><span class="connection-owner-completion-mark">✓</span><h2>负责人匹配完成</h2>${result.batch.status === "partial" ? `<p class="connection-owner-partial-note">部分数据已成功更新。异常数据未更新，可进入异常中心处理。</p>` : `<p>本次负责人匹配已全部完成。</p>`}<div class="connection-owner-change-summary"><span>新增负责人<strong>0</strong></span><span>负责人变更<strong>${result.result?.updated || 0}</strong></span><span>保持不变<strong>${result.result?.unchanged || 0}</strong></span><span>异常<strong>${exceptionCount}</strong></span></div><footer><button type="button" class="secondary-button" data-view-owner-import-result>查看本次详情</button><button type="button" class="secondary-button" data-return-connection-center>返回链接经营中心</button><button type="button" class="primary-button" data-continue-owner-import>继续导入负责人表</button></footer></section>`;
  }
  return `<details class="connection-foundation-panel connection-owner-import" ${result ? "open" : ""}>
    <summary>批量匹配负责人</summary>
    <p class="form-note">按“平台 + 商品ID”精确匹配链接，并使用店铺字段校验；支持一个文件覆盖多个平台和店铺。</p>
    <form data-connection-owner-import-form class="connection-foundation-import-form">
      <label>负责人匹配Excel<input type="file" name="file" accept=".xls,.xlsx" required /></label>
      <button type="submit" class="secondary-button" ${pageState.ownerImport.loading ? "disabled" : ""}>${pageState.ownerImport.loading ? "正在解析…" : "生成匹配预览"}</button>
    </form>
    ${result ? `<section class="connection-import-preview"><header><div><h3>本次负责人匹配</h3><p>${escapeHtml(result.batch?.fileName || "负责人匹配表")}</p></div><span class="status-pill">${batchStatus[result.batch?.status] || result.batch?.status}</span></header>
      <div class="connection-owner-change-summary"><span>文件总行数<strong>${preview.totalRows || 0}</strong></span><span>可更新链接<strong>${preview.updatableLinks || 0}</strong></span><span>负责人变更<strong>${preview.changeRows || 0}</strong></span><span>保持不变<strong>${preview.unchangedRows || 0}</strong></span><span>异常<strong>${Number(preview.unmatchedRows || 0) + Number(preview.conflictRows || 0) + Number(preview.ignoredRows || 0)}</strong></span></div>
      <div class="connection-import-preview-grid"><span>可更新链接<strong>${preview.updatableLinks || 0}</strong></span><span>涉及负责人<strong>${preview.ownerCount || 0}</strong></span><span>涉及平台<strong>${preview.platformCount || 0}</strong></span><span>涉及店铺<strong>${preview.shopCount || 0}</strong></span><span>异常行<strong>${Number(preview.unmatchedRows || 0) + Number(preview.conflictRows || 0)}</strong></span><span>不会更新<strong>${skipped}</strong></span></div>
      <div class="connection-owner-detail-actions"><button type="button" class="secondary-button" data-owner-import-detail="changes">查看匹配明细</button><button type="button" class="secondary-button" data-owner-import-detail="errors">查看异常</button></div>
      ${pageState.ownerImport.detailKind ? `<section class="connection-table-wrap"><table class="connection-table"><thead><tr><th>行</th><th>平台</th><th>店铺</th><th>商品ID</th><th>链接标题</th><th>当前负责人</th><th>新负责人</th><th>状态</th><th>说明</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${row.rowNumber}</td><td>${escapeHtml(row.data?.platform || row.rawData?.平台 || "—")}</td><td>${escapeHtml(row.data?.shopName || row.rawData?.店铺 || "—")}</td><td>${escapeHtml(row.data?.platformGoodsId || "—")}</td><td>${escapeHtml(row.data?.linkTitle || "—")}</td><td>${escapeHtml(row.data?.currentOwnerName || "未分配")}</td><td>${escapeHtml(row.data?.newOwnerName || "—")}</td><td>${escapeHtml(statusText[row.status] || row.status)}</td><td>${escapeHtml(row.errorMessage || "—")}</td></tr>`).join("")}</tbody></table></section>` : ""}
      <section class="connection-owner-change-groups"><h4>负责人变更</h4>${changeGroups.length ? changeGroups.map((group) => `<details><summary><span>${escapeHtml(group.currentOwnerName)} <b>→</b> ${escapeHtml(group.newOwnerName)}</span><strong>${group.linkCount}条链接</strong></summary><ul>${(group.links || []).map((link) => `<li><strong>${escapeHtml(link.title || link.platformGoodsId || "未命名链接")}</strong><span>${escapeHtml(`${link.platform || "—"} · ${link.shop || "—"} · ${link.platformGoodsId || "—"}`)}</span></li>`).join("")}</ul></details>`).join("") : `<p class="form-note">本次没有负责人变更。</p>`}</section>
      <aside class="connection-owner-overwrite-note"><strong>本次将按导入文件覆盖更新负责人。</strong><p>导入后，符合匹配条件的链接负责人将更新为文件中的负责人，不会保留旧负责人。</p><small>不会修改：店铺、链接身份、平台SKU、ERP SKU、库存、销售数据。</small></aside>
      ${!["completed", "partial", "cancelled"].includes(result.batch?.status) ? `<footer><button type="button" class="primary-button" data-confirm-owner-import="${escapeHtml(result.batch.id)}" ${canSubmit ? "" : "disabled"}>确认匹配负责人</button>${!canSubmit && result.preview?.parserVersion !== "connection-owner-v3-shop-platform-inference" ? `<button type="button" class="secondary-button" data-rebuild-owner-import="${escapeHtml(result.batch.id)}">重新校验当前预览</button>` : ""}<button type="button" class="secondary-button" data-cancel-owner-import="${escapeHtml(result.batch.id)}">取消本次预览</button>${canSubmit ? "" : `<span class="form-note">${escapeHtml(result?.submission?.reason || "当前用户没有提交权限。")}</span>`}</footer>` : ""}
    </section>` : ""}
  </details>`;
}

function cockpitStageText(stage) { return ({ normal:"正常",diagnosis:"诊断中",treatment:"治疗中",observation:"观察中" })[stage] ?? stage; }
function renderBusinessCockpit() {
  const cockpit=pageState.cockpit; const summary=cockpit.summary??{}; const health=cockpit.health??{};
  const totalHealth=Number(health.healthy||0)+Number(health.attention||0)+Number(health.risk||0)+Number(health.noData||0);
  const healthRate=(value)=>totalHealth?`${(Number(value||0)/totalHealth*100).toFixed(1)}%`:"—";
  const linkCard=(item,extra="")=>`<button type="button" class="connection-cockpit-link" data-open-connection="${escapeHtml(item.id)}">${imageHtml(item)}<span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(`${item.platform} · ${item.shopName}`)}</small><em>销售 ${coreMoney(item.erpSales?.salesAmount)} · 利润 ${coreMoney(item.erpSales?.profitAmount)} · 利润率 ${corePercent(item.erpSales?.profitMargin)}</em><i>${escapeHtml(healthText(item.healthStatus))} · ${escapeHtml(extra||growthText(item.salesGrowth))}</i></span></button>`;
  const trendRows=[...(cockpit.trends?.erp??[]).map((item)=>({...item,visitorCount:null,source:"ERP"})),...(cockpit.trends?.platform??[]).map((item)=>({...item,salesAmount:null,profitAmount:null,source:"平台"}))].filter((item)=>item.periodType===cockpit.periodType).sort((a,b)=>String(a.periodEnd).localeCompare(String(b.periodEnd))||a.source.localeCompare(b.source));
  return `<section class="connection-business-cockpit"><header><div><h2>经营链接驾驶舱</h2><p>${cockpit.scope?.isAdmin?"全部经营链接":"当前权限范围内的经营链接"}</p></div></header>
    <section class="cockpit-summary"><div><span>链接数量</span><strong>${summary.connectionCount||0}</strong><small>正常经营 ${summary.normalCount||0}</small></div><div><span>销售额</span><strong>${coreMoney(summary.salesAmount)}</strong><small>同期 ${growthText(summary.salesGrowth)}</small></div><div><span>利润</span><strong>${coreMoney(summary.profitAmount)}</strong><small>利润率 ${corePercent(summary.profitMargin)}</small></div><div class="is-risk"><span>风险链接</span><strong>${summary.riskCount||0}</strong><small>需要管理关注</small></div><div class="is-diagnosis"><span>诊断中</span><strong>${summary.diagnosisCount||0}</strong><small>等待定位问题</small></div><div class="is-treatment"><span>治疗中</span><strong>${summary.treatmentCount||0}</strong><small>正在推进改善</small></div></section>
    <section class="cockpit-health"><header><h3>健康状态</h3><span>高利润链接 ${summary.highProfitCount||0} · 利润风险 ${summary.profitRiskCount||0}</span></header><div><span>健康 <b>${health.healthy||0}</b><em>${healthRate(health.healthy)}</em></span><span>关注 <b>${health.attention||0}</b><em>${healthRate(health.attention)}</em></span><span>异常 <b>${health.risk||0}</b><em>${healthRate(health.risk)}</em></span><span>待积累数据 <b>${health.noData||0}</b><em>${healthRate(health.noData)}</em></span></div></section>
    <div class="cockpit-two-columns"><section class="cockpit-panel"><header><h3>核心链接</h3><span>按ERP销售额、利润排序</span></header>${cockpit.coreLinks?.length?cockpit.coreLinks.map((item)=>linkCard(item,`销量 ${coreNumber(item.erpSales?.shippedQuantity)}`)).join(""):`<div class="empty-state compact">暂无ERP销售事实</div>`}</section><section class="cockpit-panel is-risk"><header><h3>风险链接</h3><button type="button" class="text-button" data-workbench-hospital="diagnosis">进入链接医院 →</button></header>${cockpit.riskLinks?.length?cockpit.riskLinks.map((item)=>linkCard(item,`${item.anomalyTypes?.join("、")||"健康异常"} · ${cockpitStageText(item.operationStage)}`)).join(""):`<div class="empty-state compact">当前没有风险链接</div>`}</section></div>
    <section class="cockpit-panel"><header><h3>增长链接</h3></header><div class="cockpit-growth-grid">${cockpit.growthLinks?.length?cockpit.growthLinks.map((item)=>linkCard(item,`最快增长 ${growthText(item.growthMetric)}`)).join(""):`<div class="empty-state compact">尚无可比较的增长链接</div>`}</div></section>
    <section class="cockpit-panel"><header><h3>平台渠道分析</h3><span>ERP销售和利润按平台汇总</span></header><div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>平台</th><th>链接数</th><th>销售额</th><th>利润</th><th>利润率</th><th>健康率</th></tr></thead><tbody>${cockpit.platforms?.map((item)=>`<tr><td><strong>${escapeHtml(item.platform)}</strong></td><td>${item.connectionCount}</td><td>${coreMoney(item.salesAmount)}</td><td>${coreMoney(item.profitAmount)}</td><td>${corePercent(item.profitMargin)}</td><td>${corePercent(item.healthyRate)}</td></tr>`).join("")||`<tr><td colspan="6">暂无平台经营事实</td></tr>`}</tbody></table></div></section>
    <section class="cockpit-panel"><header><h3>产品渠道分析</h3><span>链接 → SKU → 产品的最新ERP销售贡献</span></header><div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>产品编码</th><th>产品</th><th>平台</th><th>链接数</th><th>销售贡献</th><th>占产品销售</th></tr></thead><tbody>${cockpit.productChannels?.map((item)=>`<tr><td><a href="#products/${encodeURIComponent(item.productId)}">${escapeHtml(item.skuCode)}</a></td><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.platform)}</td><td>${item.linkCount}</td><td>${coreMoney(item.salesAmount)}</td><td>${corePercent(item.contribution)}</td></tr>`).join("")||`<tr><td colspan="6">暂无产品渠道销售事实</td></tr>`}</tbody></table></div></section>
    <section class="cockpit-panel"><header><div><h3>经营趋势</h3><span>ERP销售/利润与平台流量分开呈现</span></div><div class="segmented-control">${[["day","日"],["week","周"],["month","月"]].map(([id,label])=>`<button type="button" data-cockpit-period="${id}" class="${cockpit.periodType===id?"active":""}">${label}</button>`).join("")}</div></header><div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>周期</th><th>来源</th><th>销售额</th><th>利润</th><th>访客</th></tr></thead><tbody>${trendRows.map((item)=>`<tr><td>${escapeHtml(`${item.periodStart} ~ ${item.periodEnd}`)}</td><td>${item.source}</td><td>${item.salesAmount==null?"—":coreMoney(item.salesAmount)}</td><td>${item.profitAmount==null?"—":coreMoney(item.profitAmount)}</td><td>${item.visitorCount==null?"—":coreNumber(item.visitorCount)}</td></tr>`).join("")||`<tr><td colspan="5">当前粒度暂无趋势数据</td></tr>`}</tbody></table></div></section>
  </section>`;
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
  if (!pageState.items.length) return `<div class="empty-state"><strong>还没有链接资产</strong><p>请在数据中心选择平台链接经营模板，上传平台导出表建立第一条链接资产。</p></div>`;
  const filters = pageState.listFilters;
  const items = [...pageState.items];
  const valueForColumn = (item, key) => ({
    name: item.name || "", platform: item.platform || "", shop: shopName(item), goodsId: item.platformGoodsId || "", erpSales: Number(item.erpSales?.salesAmount || 0), erpProfit: Number(item.erpSales?.profitAmount || 0), relations: Number(item.skuCount || 0), products: productCodes(item),
    period: item.latestPeriodEnd || "", payAmount: Number(item.latestPayAmount || 0), growth: item.salesGrowth == null ? -Infinity : Number(item.salesGrowth),
    health: item.healthScore == null ? Infinity : Number(item.healthScore), profit: Number(item.currentFinance?.netProfit || 0), origin: originText(item.originSource), owner: connectionOwnerName(item), status: statusText(item.status),
  })[key];
  const compareValues = (left, right) => typeof left === "number" || typeof right === "number"
    ? Number(left) - Number(right) : String(left).localeCompare(String(right), "zh-CN", { numeric: true });
  if (!items.length) return `<div class="empty-state"><strong>没有符合条件的连接</strong><p>请调整店铺、产品编码、负责人或状态筛选。</p></div>`;
  if (pageState.view === "cards") {
    return `<div class="connection-card-grid">${items.map((item) => { const anomalies = connectionAnomalies(item); const trend = trendLabel(item); return `<article class="connection-card ${anomalies.length ? "has-anomaly" : ""}"><button type="button" class="connection-card-main" data-open-connection="${escapeHtml(item.id)}">${imageHtml(item)}<span class="connection-card-body"><strong class="connection-card-title">${escapeHtml(item.name)}</strong><small class="connection-card-identity">${escapeHtml(`${item.platform} · ${shopName(item)}`)}</small><span class="connection-v3-card-metrics"><em>销售额 <b>${coreMoney(item.erpSales?.salesAmount)}</b></em><em>利润 <b>${coreMoney(item.erpSales?.profitAmount)}</b></em><em>利润率 <b>${corePercent(item.erpSales?.profitMargin)}</b></em></span><span class="connection-card-state"><em class="connection-health-pill is-${escapeHtml(item.healthStatus || "no_data")}">${escapeHtml(healthText(item.healthStatus || "no_data"))}</em><em class="connection-trend-pill is-${trend.className}">${trend.className === "better" ? "↗" : trend.className === "worse" ? "↘" : "→"} ${growthText(item.salesGrowth)}</em></span><span class="connection-card-owner">负责人 ${escapeHtml(connectionOwnerName(item))}</span></span></button>${anomalies.length ? `<footer><span>⚠ ${escapeHtml(anomalies.map((problem) => problem.title).join("、"))}</span>${canJoinDiagnosis(item) ? `<button type="button" class="primary-button" data-join-diagnosis="${escapeHtml(item.id)}">加入诊断</button>` : `<small>${(pageState.hospital.admittedConnectionIds ?? []).includes(item.id) ? "已加入诊断区" : "异常提醒"}</small>`}</footer>` : ""}</article>`; }).join("")}</div>${renderConnectionPagination()}`;
  }
  const visible = new Set(pageState.visibleColumns);
  const header = listColumns.filter((column) => visible.has(column.key)).map((column) => {
    const active = pageState.columnSort.key === column.key;
    return `<th>${column.sortable ? `<button type="button" data-connection-column-sort="${column.key}">${escapeHtml(column.label)}${active ? (pageState.columnSort.direction === "asc" ? " ↑" : " ↓") : " ↕"}</button>` : escapeHtml(column.label)}</th>`;
  }).join("");
  const cell = (item, key) => ({
    image: imageHtml(item), name: `<strong>${escapeHtml(item.name)}</strong>`, platform: escapeHtml(item.platform), shop: escapeHtml(shopName(item)), goodsId: escapeHtml(item.platformGoodsId || "—"), erpSales: `${coreMoney(item.erpSales?.salesAmount)}<small>销量 ${coreNumber(item.erpSales?.shippedQuantity)}</small>`, erpProfit: `${coreMoney(item.erpSales?.profitAmount)}<small>${corePercent(item.erpSales?.profitMargin)}</small>`, relations: `${item.productCount || 0} 产品 / ${item.skuCount || 0} SKU`,
    products: escapeHtml(productCodes(item, filters.productCode)), period: escapeHtml(item.latestPeriodEnd || "—"),
    payAmount: item.latestPayAmount == null ? "—" : `¥${Number(item.latestPayAmount).toLocaleString("zh-CN")}`,
    growth: growthText(item.salesGrowth), health: item.healthScore == null ? "—" : `${Number(item.healthScore)}分`,
    profit: item.currentFinance == null ? "—" : `¥${Number(item.currentFinance.netProfit || 0).toLocaleString("zh-CN")}`,
    origin: escapeHtml(originText(item.originSource)), owner: escapeHtml(connectionOwnerName(item)), status: `<span class="status-pill status-${escapeHtml(item.status)}">${escapeHtml(statusText(item.status))}</span>`,
  })[key];
  return `<div class="connection-table-wrap"><table class="connection-table"><thead><tr>${header}</tr></thead><tbody>${items.map((item) => `<tr tabindex="0" data-open-connection="${escapeHtml(item.id)}">${listColumns.filter((column) => visible.has(column.key)).map((column) => `<td>${cell(item, column.key)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>${renderConnectionPagination()}`;
}

function renderConnectionPagination() {
  const pagination = pageState.pagination;
  return `<nav class="pagination" aria-label="链接资产分页"><button type="button" class="secondary-button" data-connection-page="${pagination.page - 1}" ${pagination.page <= 1 ? "disabled" : ""}>上一页</button><span>第 ${pagination.page} / ${pagination.totalPages} 页 · 共 ${pagination.total} 条</span><button type="button" class="secondary-button" data-connection-page="${pagination.page + 1}" ${pagination.page >= pagination.totalPages ? "disabled" : ""}>下一页</button></nav>`;
}

function renderPendingConnections() {
  const pendingRows = pageState.currentImport?.rows?.filter((row) => row.previewStatus === "pending") ?? [];
  return `<section class="connection-pending-page"><header class="connection-toolbar"><div><strong>历史待识别数据</strong><p>仅用于处理升级前的生意参谋历史批次；新的链接资产统一通过平台链接经营导入创建。</p></div></header>
    ${pendingRows.length ? `<div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>商品ID</th><th>商品名称</th><th>原因</th></tr></thead><tbody>${pendingRows.map((row) => `<tr><td><strong>${escapeHtml(row.externalId || "—")}</strong></td><td>${escapeHtml(row.goodsName || "—")}</td><td>${escapeHtml(row.pendingReason === "ambiguous_goods_id" ? "同一店铺商品ID存在多个候选，请核对销售身份" : "历史批次缺少有效店铺，无法安全识别")}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state"><strong>当前没有历史待识别数据</strong><p>新的平台数据请使用数据导入页中的平台链接经营模板。</p></div>`}
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

function coreMoney(value) { return value === null || value === undefined ? "—" : `¥${Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`; }
function coreNumber(value) { return value === null || value === undefined ? "—" : Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 }); }
function corePercent(value) { return value === null || value === undefined ? "—" : `${(Number(value) * 100).toFixed(2)}%`; }
function renderCoreBasic(item, core) {
  const sales = core?.salesOverview ?? item.erpSales ?? {};
  const anomalies = connectionAnomalies(item);
  const skuCodes = [...new Set((core?.skuSales ?? []).map((row) => row.skuCode).filter(Boolean))];
  return `<section class="connection-v3-basic"><h3>链接概况</h3><dl><div><dt>负责人</dt><dd>${escapeHtml(connectionOwnerName(item))}</dd></div><div><dt>商品链接</dt><dd>${item.canonicalUrl || item.rawUrl ? `<a href="${escapeHtml(item.canonicalUrl || item.rawUrl)}" target="_blank" rel="noopener noreferrer">打开平台商品</a>` : "—"}</dd></div></dl><section class="connection-v3-metrics"><div><span>销售额</span><strong>${coreMoney(sales.salesAmount)}</strong></div><div><span>利润</span><strong>${coreMoney(sales.profitAmount)}</strong></div><div><span>利润率</span><strong>${corePercent(sales.profitMargin)}</strong></div><div><span>销售趋势</span><strong>${growthText(item.salesGrowth)}</strong></div></section><section class="connection-current-problems"><h3>当前问题</h3>${anomalies.length ? `<div class="connection-health-list">${anomalies.map((problem) => `<article><strong>${escapeHtml(problem.title)}</strong><span>${escapeHtml(problem.value || "需要关注")}</span></article>`).join("")}</div>` : `<div class="empty-state compact">当前未发现经营异常</div>`}</section>${canManage() ? `<form class="connection-action-form" data-connection-profile-form><label>连接名称<input name="name" value="${escapeHtml(item.name)}" required maxlength="120" /></label><label>负责人<select name="ownerId"><option value="">未设置</option>${(state.people ?? []).filter((person) => person.status === "active").map((person) => `<option value="${escapeHtml(person.id)}" ${item.ownerId === person.id ? "selected" : ""}>${escapeHtml(person.name)}</option>`).join("")}</select></label><button type="submit" class="secondary-button">保存档案</button></form>` : ""}<details class="connection-technical-details"><summary>更多信息</summary><dl><div><dt>商品ID</dt><dd>${escapeHtml(item.platformGoodsId || "—")}</dd></div><div><dt>SKU编码</dt><dd>${escapeHtml(skuCodes.join("、") || "—")}</dd></div><div><dt>数据来源</dt><dd>${escapeHtml(originText(item.originSource))}</dd></div><div><dt>识别时间</dt><dd>${escapeHtml(item.identifiedAt || item.createdAt || "—")}</dd></div><div><dt>最近数据日期</dt><dd>${escapeHtml(item.latestPeriodEnd || "—")}</dd></div></dl></details></section>`;
}
function renderCoreOperatingOverview(item, core) {
  const sales = core?.salesOverview ?? item.erpSales ?? {};
  return `<section class="connection-v3-panel"><h3>经营概览</h3><p>核心经营指标来自 ERP 真实销售事实。</p><div class="connection-v3-metrics"><div><span>发货销量</span><strong>${coreNumber(sales.shippedQuantity)}</strong></div><div><span>销售金额</span><strong>${coreMoney(sales.salesAmount)}</strong></div><div><span>成本</span><strong>${coreMoney(sales.costAmount)}</strong></div><div><span>利润</span><strong>${coreMoney(sales.profitAmount)}</strong></div><div><span>利润率</span><strong>${corePercent(sales.profitMargin)}</strong></div></div><small>${sales.periodStart ? escapeHtml(`${sales.periodStart} 至 ${sales.periodEnd}`) : "暂无ERP销售周期"}</small></section>`;
}
function renderCorePlatform(core) {
  const platform = core?.platformPerformance;
  return `<section class="connection-v3-panel"><h3>平台表现</h3>${platform ? `<div class="connection-v3-metrics"><div><span>访客</span><strong>${coreNumber(platform.visitorCount)}</strong></div><div><span>浏览</span><strong>${coreNumber(platform.viewCount)}</strong></div><div><span>点击</span><strong>${coreNumber(platform.metrics?.clickCount)}</strong></div><div><span>收藏</span><strong>${coreNumber(platform.metrics?.favoriteCount)}</strong></div><div><span>加购</span><strong>${coreNumber(platform.cartCount)}</strong></div><div><span>转化率</span><strong>${corePercent(platform.conversionRate)}</strong></div></div>` : `<div class="empty-state compact">暂无平台经营数据</div>`}</section>`;
}
function renderErpSales(core) {
  const rows = (core?.erpTrend ?? []).filter((item) => item.periodType === pageState.salesPeriodType);
  return `<section class="connection-v3-panel"><header><div><h3>ERP真实销售趋势</h3><p>按已导入周期展示发货、销售与利润，不与平台表现混用。</p></div><div class="segmented-control">${[["day","日"],["week","周"],["month","月"]].map(([id,label]) => `<button type="button" data-sales-period-type="${id}" class="${pageState.salesPeriodType===id?"active":""}">${label}</button>`).join("")}</div></header>${rows.length ? `<div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>周期</th><th>发货销量</th><th>销售金额</th><th>成本</th><th>利润</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(`${row.periodStart} ~ ${row.periodEnd}`)}</td><td>${coreNumber(row.shippedQuantity)}</td><td>${coreMoney(row.salesAmount)}</td><td>${coreMoney(row.costAmount)}</td><td>${coreMoney(row.profitAmount)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state">暂无${({day:"日",week:"周",month:"月"})[pageState.salesPeriodType]}粒度ERP销售数据</div>`}</section>`;
}
function renderSkuSales(core) { const rows=core?.skuSales??[]; return `<section class="connection-v3-panel"><h3>SKU销售分析</h3>${rows.length?`<div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>SKU编码</th><th>SKU名称</th><th>销量</th><th>销售额</th><th>销售占比</th></tr></thead><tbody>${rows.map((row)=>`<tr><td><strong>${escapeHtml(row.skuCode)}</strong></td><td>${escapeHtml(row.skuName)}</td><td>${coreNumber(row.shippedQuantity)}</td><td>${coreMoney(row.salesAmount)}</td><td>${corePercent(row.salesShare)}</td></tr>`).join("")}</tbody></table></div>`:`<div class="empty-state">暂无SKU真实销售数据</div>`}</section>`; }
function renderCoreProducts(core) { const rows=core?.products??[]; return `<section class="connection-v3-panel"><h3>关联产品</h3>${rows.length?`<div class="connection-v3-product-grid">${rows.map((product)=>`<a href="#products/${encodeURIComponent(product.id)}">${product.mainImage?`<img src="${escapeHtml(resolveAssetUrl(product.mainImage))}" alt="" />`:`<span class="connection-cover-empty">无图</span>`}<strong>${escapeHtml(product.name)}</strong><span>产品编码 ${escapeHtml(product.skuCode)}</span><small>${product.skuCount} 个关联SKU</small></a>`).join("")}</div>`:`<div class="empty-state">当前链接未关联产品</div>`}</section>`; }
function renderInventory(core) { const rows=core?.inventory??[]; const risk={out:"缺货",low:"库存偏低",high:"库存偏高",normal:"正常"}; return `<section class="connection-v3-panel"><h3>库存供应</h3>${rows.length?`<div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>SKU</th><th>产品</th><th>当前库存</th><th>可售库存</th><th>销售速度</th><th>库存天数</th><th>风险</th></tr></thead><tbody>${rows.map((row)=>`<tr><td><strong>${escapeHtml(row.skuCode)}</strong><small>${escapeHtml(row.specificationName||"")}</small></td><td>${escapeHtml(row.productName||"未关联产品")}</td><td>${coreNumber(row.currentStock)}</td><td>${coreNumber(row.availableStock)}</td><td>${coreNumber(row.salesVelocity)}</td><td>${row.stockDays==null?"—":`${Number(row.stockDays).toFixed(1)}天`}</td><td><span class="status-pill stock-${row.stockRisk}">${risk[row.stockRisk]}</span></td></tr>`).join("")}</tbody></table></div>`:`<div class="empty-state">暂无关联SKU库存事实</div>`}</section>`; }

function connectionOperationState(item) {
  for (const [stage, label] of [["diagnosis", "诊断中"], ["treatment", "治疗中"], ["observation", "观察中"]]) {
    if ((pageState.hospital.zones?.[stage] ?? []).some((entry) => entry.connectionId === item.id)) return { stage, label };
  }
  if (item.followed || pageState.myWorkbench.items.some((entry) => entry.id === item.id && entry.followed)) return { stage: "followed", label: "关注" };
  return { stage: "normal", label: "正常" };
}

function renderConnectionOperationBar(item) {
  const operation = connectionOperationState(item); const anomalies = connectionAnomalies(item);
  const action = operation.stage === "normal" && anomalies.length && canJoinDiagnosis(item)
    ? `<button type="button" class="primary-button" data-join-diagnosis="${escapeHtml(item.id)}">加入诊断</button>`
    : ["diagnosis", "treatment", "observation"].includes(operation.stage)
      ? `<button type="button" class="secondary-button" data-workbench-hospital="${operation.stage}">${operation.stage === "diagnosis" ? "查看诊断" : "查看改善"}</button>` : "";
  return `<section class="connection-operation-bar"><div><span>当前运营状态</span><strong>${escapeHtml(operation.label)}</strong><small>${anomalies.length ? escapeHtml(anomalies.map((problem) => problem.title).join("、")) : "当前无已识别异常"}</small></div>${action}</section>`;
}

function renderConnectionHospitalDetail(item) {
  const entry = ["diagnosis", "treatment", "observation"].flatMap((stage) => (pageState.hospital.zones?.[stage] ?? []).map((row) => ({ ...row, stage }))).find((row) => row.connectionId === item.id);
  if (!entry) return `<section class="connection-v3-panel"><h3>链接医院</h3><div class="empty-state compact"><strong>当前未进入链接医院</strong>${canJoinDiagnosis(item) ? `<button type="button" class="primary-button" data-join-diagnosis="${escapeHtml(item.id)}">加入诊断</button>` : ""}</div></section>`;
  const stageLabel = { diagnosis: "诊断区", treatment: "治疗区", observation: "观察区" }[entry.stage];
  return `<section class="connection-v3-panel"><header><div><h3>链接医院</h3></div><button type="button" class="primary-button" data-workbench-hospital="${entry.stage}">下一步：进入${stageLabel}</button></header><div class="connection-hospital-detail-summary"><div><span>经营状态</span><strong>${stageLabel}</strong></div><div><span>当前问题</span><strong>${escapeHtml(entry.problemTitle || "待诊断")}</strong></div><div><span>任务进度</span><strong>${entry.taskCount ? `${entry.completedTaskCount}/${entry.taskCount}` : "尚未生成任务"}</strong></div></div></section>`;
}

function renderDetail() {
  const item = pageState.items.find((candidate) => candidate.id === pageState.selectedId)
    ?? pageState.myWorkbench.items.find((candidate) => candidate.id === pageState.selectedId);
  if (!item) return "";
  const tabs = [["basic", "概况"], ["overview", "经营概览"], ["platform", "平台表现"], ["erp-sales", "ERP真实销售"], ["sku-sales", "SKU销售分析"], ["products", "产品关联"], ["inventory", "库存供应"], ...(canViewHealth() ? [["health", "健康状态"]] : []), ["hospital", "链接医院"], ["improvements", "改善记录"], ["actions", "经营动作"], ["trend", "经营趋势"], ["benchmarks", `链接对标${pageState.benchmarks.items.length ? ` ${pageState.benchmarks.items.length}` : ""}`]];
  let body = `<div class="connection-overview"><dl><div><dt>平台</dt><dd>${escapeHtml(item.platform)}</dd></div><div><dt>店铺</dt><dd>${escapeHtml(shopName(item))}</dd></div><div><dt>商品ID</dt><dd>${escapeHtml(item.platformGoodsId || "—")}</dd></div><div><dt>负责人</dt><dd>${escapeHtml(personName(item.ownerId))}</dd></div><div><dt>状态</dt><dd>${escapeHtml(statusText(item.status))}</dd></div></dl><section class="connection-operating-metrics"><div><span>最近周期销售额</span><strong>${item.latestPayAmount == null ? "—" : `¥${Number(item.latestPayAmount).toLocaleString("zh-CN")}`}</strong></div><div><span>销售增长</span><strong>${growthText(item.salesGrowth)}</strong></div><div><span>同期净利润</span><strong>${item.currentFinance == null ? "—" : `¥${Number(item.currentFinance.netProfit || 0).toLocaleString("zh-CN")}`}</strong></div><div><span>利润变化</span><strong>${growthText(item.profitGrowth)}</strong></div><div><span>健康状态</span><strong>${escapeHtml(healthText(item.healthStatus || "no_data"))}</strong></div></section>${canManage() ? `<form class="connection-action-form" data-connection-profile-form><label>连接名称<input name="name" value="${escapeHtml(item.name)}" required maxlength="120" /></label><label>负责人<select name="ownerId"><option value="">未设置</option>${(state.people ?? []).filter((person) => person.status === "active").map((person) => `<option value="${escapeHtml(person.id)}" ${item.ownerId === person.id ? "selected" : ""}>${escapeHtml(person.name)}</option>`).join("")}</select></label><button type="submit" class="secondary-button">保存档案</button></form>` : ""}<section><h3>关联产品</h3>${item.products?.length ? item.products.map((product) => `<a href="#products/${encodeURIComponent(product.id)}" data-product-id="${escapeHtml(product.id)}">${escapeHtml(product.name || product.skuCode)}</a>`).join("、") : "未关联产品"}</section></div>`;
  body = body.replace("<div><dt>负责人</dt>", `<div><dt>档案来源</dt><dd>${escapeHtml(originText(item.originSource))}</dd></div><div><dt>识别时间</dt><dd>${escapeHtml(item.identifiedAt || item.createdAt || "—")}</dd></div><div><dt>负责人</dt>`);
  if (pageState.coreDetailLoading) body = `<div class="empty-state">正在读取链接经营详情…</div>`;
  else if (pageState.detailTab === "basic") body = renderCoreBasic(item, pageState.coreDetail);
  else if (pageState.detailTab === "overview") body = renderCoreOperatingOverview(item, pageState.coreDetail);
  else if (pageState.detailTab === "platform") body = renderCorePlatform(pageState.coreDetail);
  else if (pageState.detailTab === "erp-sales") body = renderErpSales(pageState.coreDetail);
  else if (pageState.detailTab === "sku-sales") body = renderSkuSales(pageState.coreDetail);
  else if (pageState.detailTab === "products") body = renderCoreProducts(pageState.coreDetail);
  else if (pageState.detailTab === "inventory") body = renderInventory(pageState.coreDetail);
  if (pageState.detailTab === "actions") body = renderActions(item);
  if (pageState.detailTab === "health") body = renderHealthReport();
  if (pageState.detailTab === "hospital") body = renderConnectionHospitalDetail(item);
  if (pageState.detailTab === "improvements") body = renderImprovements();
  if (pageState.detailTab === "trend") {
    const analysis = pageState.growthAnalysis;
    const growthCard = analysis?.comparable ? `<section class="connection-growth-card"><div><span>健康分</span><strong>${analysis.healthScore}</strong><em>${escapeHtml(healthText(analysis.healthStatus))}</em></div><dl><div><dt>销售</dt><dd>${growthText(analysis.salesGrowth)}</dd></div><div><dt>访客</dt><dd>${growthText(analysis.visitorGrowth)}</dd></div><div><dt>转化</dt><dd>${growthText(analysis.conversionChange, { points: true })}</dd></div><div><dt>客单价</dt><dd>${growthText(analysis.customerValueChange)}</dd></div><div><dt>净利润</dt><dd>${growthText(analysis.profitGrowth)}</dd></div></dl></section>` : `<div class="empty-state compact"><strong>${escapeHtml(healthText(analysis?.healthStatus || "no_data"))}</strong><p>需要至少两个经营周期才能计算成长幅度和健康评分。</p></div>`;
    const comparison = analysis?.currentPeriod ? `<div class="connection-table-wrap"><table class="connection-table connection-period-table"><thead><tr><th>周期</th><th>销售额</th><th>访客/浏览</th><th>加购</th><th>转化率</th><th>客单价</th><th>净利润</th></tr></thead><tbody>${[["当前周期", analysis.currentPeriod, analysis.currentFinance], ["上一周期", analysis.previousPeriod, analysis.previousFinance]].filter(([, period]) => period).map(([label, period, finance]) => `<tr><td><strong>${label}</strong><small>${escapeHtml(`${period.periodStart} 至 ${period.periodEnd}`)}</small></td><td>¥${Number(period.payAmount || 0).toLocaleString("zh-CN")}</td><td>${Number(period.visitorCount || 0).toLocaleString("zh-CN")} / ${Number(period.viewCount || 0).toLocaleString("zh-CN")}</td><td>${Number(period.cartCount || 0).toLocaleString("zh-CN")}</td><td>${period.conversionRate == null ? "—" : `${(Number(period.conversionRate) * 100).toFixed(2)}%`}</td><td>${period.customerValue == null ? "—" : `¥${Number(period.customerValue).toFixed(2)}`}</td><td>${finance == null ? "—" : `¥${Number(finance.netProfit || 0).toLocaleString("zh-CN")}`}</td></tr>`).join("")}</tbody></table></div>` : "";
    body = `<div class="connection-growth-detail">${growthCard}${comparison}</div>`;
  }
  if (pageState.detailTab === "benchmarks") body = renderBenchmarkPanel(item);
  return `<section class="connection-detail"><button type="button" class="text-button" data-action="back-connections">← 返回链接资产</button><header>${imageHtml(item)}<div><p class="eyebrow">${escapeHtml(item.platform)} · ${escapeHtml(shopName(item))}</p><h2>${escapeHtml(item.name)}</h2><p>${escapeHtml(productNames(item))}</p></div></header>${renderConnectionOperationBar(item)}<nav class="connection-tabs">${tabs.map(([id, label]) => `<button type="button" class="${pageState.detailTab === id ? "active" : ""}" data-connection-tab="${id}">${label}</button>`).join("")}</nav>${body}</section>`;
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

function renderImportStatus(status = "waiting") {
  const normalized = status === "failed" ? "failed" : status === "completed" ? "completed" : ["draft", "parsed", "validated"].includes(status) ? "processing" : "waiting";
  const steps = [["waiting", "等待导入"], ["processing", "导入中"], ["completed", "导入完成"], ["failed", "导入异常"]];
  return `<div class="connection-import-status" aria-label="导入状态">${steps.map(([id, label]) => `<span class="${normalized === id ? "is-current" : ""} is-${id}"><i></i>${label}</span>`).join("")}</div>`;
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
    ${renderImportStatus(pageState.importLoading ? "parsed" : batch?.status)}
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
  const pageContent = pageState.section === "cockpit" ? renderBusinessCockpit() : pageState.section === "hospital" ? renderConnectionHospital() : pageState.section === "my-links" ? renderMyLinksWorkbench() : pageState.section === "data-import" ? renderDataFoundation() : pageState.section === "data-center" ? renderConnectionDataCenter() : renderConnectionAssets();
  return `<section class="connection-center-page">${pageState.error ? `<div class="form-error">${escapeHtml(pageState.error)}</div>` : ""}${pageState.loading ? `<div class="empty-state">正在读取连接…</div>` : pageState.selectedId ? renderDetail() : `${renderSectionNavigation()}${pageContent}`}${renderMappingModal()}${renderImprovementModal()}${renderBenchmarkModal()}${renderDiagnosisModal()}</section>`;
}

async function loadHospital(render) {
  pageState.hospital.loading = true; pageState.error = ""; render();
  try { const result = await loadConnectionHospital(); pageState.hospital = { ...pageState.hospital, ...result, loading: false }; }
  catch (error) { pageState.error = error.message; pageState.hospital.loading = false; }
  render();
}

async function loadMyLinks(render, filter = pageState.myWorkbench.filter) {
  const filterChanged = filter !== pageState.myWorkbench.filter;
  const page = filterChanged ? 1 : pageState.myWorkbench.pagination?.page || 1;
  pageState.myWorkbench.loading = true; pageState.myWorkbench.filter = filter; pageState.myWorkbench.pagination.page = page; pageState.error = ""; render();
  try {
    const result = await loadMyConnectionWorkbench(filter, page, 50, filter === "all" ? pageState.myWorkbench.search : "");
    const serverPaged = Boolean(result.pagination);
    const pagination = result.pagination || { page: 1, pageSize: 50, total: result.items?.length || 0, totalPages: Math.max(1, Math.ceil((result.items?.length || 0) / 50)) };
    pageState.myWorkbench = { ...pageState.myWorkbench, ...result, filter, pagination, serverPaged, loading: false, loaded: true };
  }
  catch (error) { pageState.error = error.message; pageState.myWorkbench.loading = false; }
  render();
}

async function loadMyLinkDataStatus(render) {
  pageState.linkDataStatus = { ...pageState.linkDataStatus, loading: true, error: "" }; render();
  try { pageState.linkDataStatus = { data: await loadLinkDataStatus(), loading: false, loaded: true, error: "" }; }
  catch (error) { pageState.linkDataStatus = { ...pageState.linkDataStatus, loading: false, loaded: true, error: error.message }; }
  render();
}

async function loadSalesRanking(render, filters = {}) {
  pageState.salesRanking = { ...pageState.salesRanking, ...filters, loading: true, error: "" }; render();
  try {
    const result = await loadLinkSalesRanking({
      scope: pageState.salesRanking.scope,
      preset: pageState.salesRanking.range?.preset || "7d",
      startDate: pageState.salesRanking.range?.startDate || "",
      endDate: pageState.salesRanking.range?.endDate || "",
    });
    pageState.salesRanking = { ...pageState.salesRanking, ...result, loading: false, error: "" };
  } catch (error) { pageState.salesRanking = { ...pageState.salesRanking, loading: false, error: error.message }; }
  render();
}

function applyConnectionAssetData(connections, rankings, managementOverview) {
  const analysisByConnection = new Map((rankings.listMetrics ?? []).map((item) => [item.connectionId, item]));
  pageState.items = (connections.items ?? []).map((item) => {
    const analysis = analysisByConnection.get(item.id);
    return { ...item, salesGrowth: analysis?.salesGrowth ?? null, visitorGrowth: analysis?.visitorGrowth ?? null,
      conversionChange: analysis?.conversionChange ?? null, healthScore: analysis?.healthScore ?? null,
      healthStatus: analysis?.healthStatus ?? "no_data", currentFinance: analysis?.currentFinance ?? null, profitGrowth: analysis?.profitGrowth ?? null };
  });
  pageState.growthRankings = rankings;
  pageState.managementOverview = managementOverview;
}

async function loadConnectionAssetsPage(render) {
  pageState.error = "";
  const requestId = ++connectionListRequestId;
  try {
    const sortMap = { default: ["default", "desc"], newest: ["newest", "desc"], sales: ["erpSales", "desc"] };
    const [sortField, sortDirection] = sortMap[pageState.sort] || [pageState.columnSort.key || "default", pageState.columnSort.direction || "desc"];
    const connections = await loadConnectionAssets({ page: pageState.pagination.page, pageSize: pageState.pagination.pageSize,
      keyword: pageState.listFilters.search, platform: pageState.listFilters.platform, shopId: pageState.listFilters.shopId,
      ownerId: pageState.listFilters.ownerId, status: pageState.listFilters.status, productCode: pageState.listFilters.productCode,
      salesStatus: pageState.listFilters.salesStatus, profitStatus: pageState.listFilters.profitStatus,
      productRelation: pageState.listFilters.productRelation, skuCount: pageState.listFilters.skuCount, sortField, sortDirection });
    const [rankings, managementOverview] = pageState.assetMetaLoaded
      ? [pageState.growthRankings, pageState.managementOverview]
      : await Promise.all([loadConnectionGrowthRankings(), loadConnectionManagementOverview()]);
    if (requestId !== connectionListRequestId) return;
    applyConnectionAssetData(connections, rankings, managementOverview);
    pageState.pagination = connections.pagination || pageState.pagination;
    pageState.assetMetaLoaded = true;
    pageState.loadedSections.add("connections");
  } catch (error) {
    pageState.error = error.message;
  }
  render();
}

async function loadPage(render) {
  pageState.loading = true; pageState.error = ""; render();
  try {
    const [cockpit, healthAttention, improvementSummary] = await Promise.all([loadConnectionBusinessCockpit(), canViewHealth() ? loadAttentionConnectionHealthRecords() : Promise.resolve({ items: [], counts: {} }), loadConnectionImprovementSummary()]);
    pageState.cockpit = { ...pageState.cockpit, ...cockpit };
    pageState.healthAttention = healthAttention;
    pageState.improvementSummary = improvementSummary.summary;
    pageState.loadedSections.add("cockpit");
    pageState.loaded = true;
    pageState.loadedUserId = String(getCurrentUser()?.personId ?? getCurrentUser()?.id ?? "");
  } catch (error) { pageState.error = error.message; }
  pageState.loading = false; render();
}

async function openConnection(id, render) {
  if (window.location.hash !== `#connectionCenter/${encodeURIComponent(id)}`) window.history.replaceState(null, "", `#connectionCenter/${encodeURIComponent(id)}`);
  pageState.selectedId = id; pageState.detailTab = "basic"; pageState.coreDetail = null; pageState.coreDetailLoading = true; pageState.actions = []; pageState.periodSnapshots = []; pageState.growthAnalysis = null; pageState.healthRecords = []; pageState.healthModalId = ""; pageState.improvements = []; pageState.benchmarks = { items: [], candidates: [], comparison: null, comparisonId: "", loading: false }; render();
  try { pageState.coreDetail = await loadConnectionCoreDetail(id); pageState.error = ""; }
  catch (error) { pageState.error = error.message; }
  pageState.coreDetailLoading = false; render();
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

async function loadDataFoundation(render) {
  pageState.foundation.loading = true; pageState.error = ""; render();
  try {
    const [loaded, currentSalesPreview, ownerImport] = await Promise.all([loadConnectionDataFoundation(), loadCurrentConnectionSalesFactImport(), canManage() ? loadCurrentConnectionOwnerImport() : Promise.resolve(null)]);
    pageState.foundation = { ...loaded, loading: false, preview: pageState.foundation.preview ?? null, bulkPreview: loaded.bulkPreview ?? pageState.foundation.bulkPreview ?? null, salesPreview: pageState.foundation.salesPreview ?? currentSalesPreview ?? null, salesLoading: pageState.foundation.salesLoading ?? false, salesError: pageState.foundation.salesError ?? "", salesMessage: pageState.foundation.salesMessage ?? "", salesFileName: pageState.foundation.salesFileName ?? "", salesFile: pageState.foundation.salesFile ?? null, shopMappingPreview: pageState.foundation.shopMappingPreview ?? null };
    pageState.ownerImport.result = ownerImport;
    pageState.loadedSections.add("data-import");
    if (["waiting", "running"].includes(pageState.foundation.bulkPreview?.batch?.status)) window.setTimeout(() => void pollConnectionBulkPreview(pageState.foundation.bulkPreview.batch.id, render), 800);
  }
  catch (error) { pageState.error = error.message; pageState.foundation.loading = false; }
  render();
}

async function pollConnectionBulkPreview(batchId, render) {
  try {
    const result = await readConnectionFoundationBulkImport(batchId);
    pageState.foundation.bulkPreview = result; render();
    if (["waiting", "running"].includes(result.batch?.status)) window.setTimeout(() => void pollConnectionBulkPreview(batchId, render), 800);
  } catch (error) { pageState.error = error.message; pageState.foundation.loading = false; render(); }
}

export function bindConnectionCenterPageEvents(render) {
  const root = document.querySelector(".connection-center-page");
  if (!root) return;
  const currentUserId = String(getCurrentUser()?.personId ?? getCurrentUser()?.id ?? "");
  if (pageState.loaded && pageState.loadedUserId !== currentUserId) {
    pageState.loaded = false;
    pageState.items = [];
    pageState.myWorkbench = { items: [], summary: { total: 0, better: 0, risk: 0, followed: 0 }, filter: "all", search: "", page: 1, pageSize: 20, isAdmin: false, loading: false, loaded: false };
    pageState.linkDataStatus = { data: null, loading: false, loaded: false, error: "" };
    pageState.selectedId = "";
    pageState.coreDetail = null;
    pageState.ownerImport = { loading: false, result: null, showCompletion: false };
  }
  if (!pageState.loaded && !pageState.loading) void loadPage(render);
  const routeHash = window.location.hash.replace(/^#/, ""); const hasDetailRoute = routeHash.startsWith("connectionCenter/");
  const routeConnectionId = hasDetailRoute ? decodeURIComponent(routeHash.slice("connectionCenter/".length)) : "";
  if (pageState.loaded && hasDetailRoute && pageState.selectedId !== routeConnectionId) void openConnection(routeConnectionId, render);
  if (pageState.loaded && !hasDetailRoute && pageState.selectedId) { pageState.selectedId = ""; pageState.coreDetail = null; render(); return; }
  root.querySelectorAll("[data-connection-section]").forEach((button) => button.addEventListener("click", () => {
    pageState.section = button.dataset.connectionSection; pageState.selectedId = ""; render();
    if (pageState.section === "connections") void loadConnectionAssetsPage(render);
    if (pageState.section === "connections") void loadSalesRanking(render, { scope: isAdmin() ? "company" : "mine" });
    if (pageState.section === "my-links") { if (!pageState.myWorkbench.loaded) void loadMyLinks(render); void loadSalesRanking(render, { scope: "mine" }); if (!pageState.linkDataStatus.loaded) void loadMyLinkDataStatus(render); }
    if (pageState.section === "hospital") void loadHospital(render);
    if (pageState.section === "data-import") void loadDataFoundation(render);
  }));
  root.querySelector("[data-link-ranking-filter]")?.addEventListener("submit", (event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget); const preset = String(data.get("preset") || "7d");
    void loadSalesRanking(render, { scope: String(data.get("scope") || "mine"), range: { preset, startDate: String(data.get("startDate") || ""), endDate: String(data.get("endDate") || "") } });
  });
  root.querySelectorAll("[data-connection-data-tab]").forEach((button) => button.addEventListener("click", () => {
    pageState.dataCenterTab = button.dataset.connectionDataTab; render();
    if (pageState.dataCenterTab === "pending-connections") void loadPendingConnections(render);
    if (pageState.dataCenterTab === "mappings") void loadMappings(render);
    if (pageState.dataCenterTab === "imports") void loadImportBatches(render, true);
    if (pageState.dataCenterTab === "data-foundation") void loadDataFoundation(render);
  }));
  root.querySelectorAll("[data-workbench-go]").forEach((button) => button.addEventListener("click", () => {
    pageState.section = button.dataset.workbenchGo; pageState.selectedId = ""; render();
    if (pageState.section === "my-links") { if (!pageState.myWorkbench.loaded) void loadMyLinks(render, "all"); void loadSalesRanking(render, { scope: "mine" }); if (!pageState.linkDataStatus.loaded) void loadMyLinkDataStatus(render); }
    if (pageState.section === "hospital") void loadHospital(render);
  }));
  root.querySelectorAll("[data-workbench-my-filter]").forEach((button) => button.addEventListener("click", () => {
    pageState.section = "my-links"; pageState.selectedId = ""; void loadMyLinks(render, button.dataset.workbenchMyFilter); void loadSalesRanking(render, { scope: "mine" }); if (!pageState.linkDataStatus.loaded) void loadMyLinkDataStatus(render);
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
  root.querySelector("[data-my-link-search]")?.addEventListener("submit", (event) => {
    event.preventDefault(); pageState.myWorkbench.search = String(new FormData(event.currentTarget).get("search") || ""); pageState.myWorkbench.pagination.page = 1;
    if (pageState.myWorkbench.filter === "all") void loadMyLinks(render, "all"); else render();
  });
  root.querySelectorAll("[data-my-link-page]").forEach((button) => button.addEventListener("click", () => {
    pageState.myWorkbench.pagination.page = Math.max(1, Number(button.dataset.myLinkPage || 1));
    if (pageState.myWorkbench.serverPaged) void loadMyLinks(render, pageState.myWorkbench.filter); else render();
  }));
  root.querySelectorAll("[data-toggle-connection-follow]").forEach((button) => button.addEventListener("click", async () => {
    try { await updateConnectionFollow(button.dataset.toggleConnectionFollow, button.dataset.followed !== "true"); await loadMyLinks(render); }
    catch (error) { pageState.error = error.message; render(); }
  }));
  root.querySelectorAll("[data-open-pending-connections]").forEach((button) => button.addEventListener("click", () => { pageState.section = "data-center"; pageState.dataCenterTab = "pending-connections"; pageState.selectedId = ""; void loadPendingConnections(render); }));
  root.querySelector("[data-open-business-import]")?.addEventListener("click", () => { pageState.section = "data-import"; pageState.selectedId = ""; void loadDataFoundation(render); });
  root.querySelector("[data-connection-owner-import-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    pageState.ownerImport.loading = true; pageState.error = ""; render();
    try { pageState.ownerImport.result = await previewConnectionOwnerImport(form.get("file")); }
    catch (error) { pageState.error = error.message; }
    pageState.ownerImport.loading = false; render();
  });
  root.querySelectorAll("[data-owner-import-detail]").forEach((button) => button.addEventListener("click", async () => {
    const batchId = pageState.ownerImport.result?.batch?.id; if (!batchId) return;
    pageState.ownerImport.loading = true; pageState.error = ""; render();
    try { const detail = await loadConnectionOwnerImportRows(batchId, button.dataset.ownerImportDetail, 1, 50);
      pageState.ownerImport.detailKind = button.dataset.ownerImportDetail; pageState.ownerImport.detailRows = detail.rows || []; pageState.ownerImport.detailPagination = detail.pagination; }
    catch (error) { pageState.error = error.message; }
    pageState.ownerImport.loading = false; render();
  }));
  root.querySelector("[data-confirm-owner-import]")?.addEventListener("click", async (event) => {
    pageState.ownerImport.loading = true; pageState.error = ""; render();
    try {
      const result = await confirmConnectionOwnerImport(event.currentTarget.dataset.confirmOwnerImport);
      pageState.ownerImport.result = result;
      pageState.ownerImport.showCompletion = true;
      await Promise.all([loadConnectionAssetsPage(render), loadMyLinks(render)]);
    } catch (error) { pageState.error = error.message; }
    pageState.ownerImport.loading = false; render();
  });
  root.querySelector("[data-rebuild-owner-import]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget; button.disabled = true;
    try { pageState.ownerImport.result = await rebuildConnectionOwnerImportPreview(button.dataset.rebuildOwnerImport); render(); }
    catch (error) { pageState.error = error.message; render(); }
  });
  root.querySelector("[data-view-owner-import-result]")?.addEventListener("click", () => { pageState.ownerImport.showCompletion = false; render(); });
  root.querySelector("[data-return-connection-center]")?.addEventListener("click", () => { pageState.section = "cockpit"; pageState.ownerImport.showCompletion = false; render(); });
  root.querySelector("[data-continue-owner-import]")?.addEventListener("click", () => { pageState.ownerImport = { loading: false, result: null, showCompletion: false }; render(); });
  root.querySelector("[data-open-admin-data-center]")?.addEventListener("click", () => { window.location.hash = "dataCenter"; });
  root.querySelector("[data-cancel-owner-import]")?.addEventListener("click", async (event) => {
    pageState.ownerImport.loading = true; pageState.error = ""; render();
    try { pageState.ownerImport.result = await cancelConnectionOwnerImport(event.currentTarget.dataset.cancelOwnerImport); }
    catch (error) { pageState.error = error.message; }
    pageState.ownerImport.loading = false; render();
  });
  root.querySelectorAll("[data-connection-view]").forEach((button) => button.addEventListener("click", () => { pageState.view = button.dataset.connectionView; render(); }));
  root.querySelector("[data-connection-list-filters]")?.addEventListener("submit", (event) => {
    event.preventDefault(); pageState.listFilters = Object.fromEntries(new FormData(event.currentTarget)); pageState.pagination.page = 1; void loadConnectionAssetsPage(render);
  });
  root.querySelector('[data-connection-list-filters] input[name="search"]')?.addEventListener("input", (event) => {
    window.clearTimeout(connectionSearchTimer); const value = event.currentTarget.value;
    connectionSearchTimer = window.setTimeout(() => { pageState.listFilters.search = value; pageState.pagination.page = 1; void loadConnectionAssetsPage(render); }, 280);
  });
  root.querySelector("[data-clear-connection-filters]")?.addEventListener("click", () => {
    pageState.listFilters = { search: "", platform: "", shopId: "", productCode: "", ownerId: "", healthStatus: "", status: "", salesStatus: "", profitStatus: "", productRelation: "", skuCount: "" }; pageState.pagination.page = 1; void loadConnectionAssetsPage(render);
  });
  root.querySelectorAll("[data-connection-sort]").forEach((button) => button.addEventListener("click", () => {
    pageState.sort = button.dataset.connectionSort; pageState.columnSort = { key: "", direction: "asc" }; pageState.pagination.page = 1; void loadConnectionAssetsPage(render);
  }));
  root.querySelectorAll("[data-connection-column-sort]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation(); const key = button.dataset.connectionColumnSort;
    pageState.columnSort = pageState.columnSort.key === key
      ? { key, direction: pageState.columnSort.direction === "asc" ? "desc" : "asc" }
      : { key, direction: "asc" };
    pageState.pagination.page = 1; void loadConnectionAssetsPage(render);
  }));
  root.querySelectorAll("[data-connection-page]").forEach((button) => button.addEventListener("click", () => {
    const page = Number(button.dataset.connectionPage); if (page < 1 || page > pageState.pagination.totalPages) return;
    pageState.pagination.page = page; void loadConnectionAssetsPage(render);
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
  root.querySelector('[data-action="back-connections"]')?.addEventListener("click", () => { pageState.selectedId = ""; window.location.hash = "connectionCenter"; render(); });
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
  root.querySelectorAll("[data-sales-period-type]").forEach((button) => button.addEventListener("click", () => { pageState.salesPeriodType = button.dataset.salesPeriodType; render(); }));
  root.querySelectorAll("[data-cockpit-period]").forEach((button) => button.addEventListener("click", () => { pageState.cockpit.periodType = button.dataset.cockpitPeriod; render(); }));
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
  root.querySelector("[data-foundation-bulk-import-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const files = event.currentTarget.querySelector('input[name="files"]')?.files; pageState.foundation.loading = true; pageState.error = ""; render();
    try {
      const result = await uploadConnectionFoundationBulkImport(files); pageState.foundation.bulkPreview = result; pageState.foundation.loading = false; render();
      if (result.idempotent && ["completed", "completed_with_errors"].includes(result.batch?.status)) window.alert("该组文件已经完成导入，本次未重复写入。");
      else void pollConnectionBulkPreview(result.batch.id, render);
    } catch (error) { pageState.error = error.message; pageState.foundation.loading = false; render(); }
  });
  root.querySelector("[data-sales-fact-file]")?.addEventListener("change", (event) => {
    const file = event.currentTarget.files?.[0] || null;
    pageState.foundation.salesFile = file;
    pageState.foundation.salesFileName = file?.name || "";
    pageState.foundation.salesError = "";
    pageState.foundation.salesMessage = "";
  });
  root.querySelector("[data-sales-fact-import-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (pageState.foundation.salesLoading) return;
    const file = event.currentTarget.querySelector('input[name="file"]')?.files?.[0] || pageState.foundation.salesFile;
    pageState.foundation.salesFile = file || null;
    pageState.foundation.salesFileName = file?.name || "";
    pageState.foundation.salesError = "";
    pageState.foundation.salesMessage = "";
    if (!file) { pageState.foundation.salesError = "请先选择链接利润表Excel文件。"; render(); return; }
    pageState.foundation.salesLoading = true; pageState.error = ""; render();
    try {
      const result = await previewConnectionSalesFactImport(file);
      pageState.foundation.salesPreview = result;
      pageState.foundation.salesMessage = result.idempotent
        ? `已找到该文件的 sales-fact-v2 批次（HTTP ${result.httpStatus}），现已展示已有结果。`
        : `上传解析成功（HTTP ${result.httpStatus}），已进入待确认预览。`;
    }
    catch (error) { pageState.foundation.salesError = error.message || "链接利润表上传解析失败。"; }
    finally { pageState.foundation.salesLoading = false; render(); }
  });
  root.querySelector("[data-confirm-sales-fact-import]")?.addEventListener("click", async (event) => {
    pageState.foundation.loading = true; pageState.error = ""; render();
    try { pageState.foundation.salesPreview = await confirmConnectionSalesFactImport(event.currentTarget.dataset.confirmSalesFactImport); await loadDataFoundation(render); }
    catch (error) { pageState.error = error.message; }
    pageState.foundation.loading = false; render();
  });
  root.querySelector("[data-shop-mapping-import-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); pageState.foundation.loading = true; pageState.error = ""; render();
    try { pageState.foundation.shopMappingPreview = await previewPlatformLinkShopMappingImport(form.get("file")); }
    catch (error) { pageState.error = error.message; }
    pageState.foundation.loading = false; render();
  });
  root.querySelector("[data-confirm-shop-mapping-import]")?.addEventListener("click", async (event) => {
    pageState.foundation.loading = true; pageState.error = ""; render();
    try { pageState.foundation.shopMappingPreview = await confirmPlatformLinkShopMappingImport(event.currentTarget.dataset.confirmShopMappingImport); }
    catch (error) { pageState.error = error.message; }
    pageState.foundation.loading = false; render();
  });
  root.querySelector("[data-confirm-foundation-import]")?.addEventListener("click", async (event) => {
    pageState.foundation.loading = true; pageState.error = ""; render();
    try { const result = await confirmConnectionFoundationImport(event.currentTarget.dataset.confirmFoundationImport); pageState.foundation.preview = result; await loadDataFoundation(render); await loadConnectionAssetsPage(render); window.alert(`导入完成：新增链接 ${result.result?.createdLinks || 0}，更新链接 ${result.result?.updatedLinks || 0}，新增经营事实 ${result.result?.factsCreated || 0}。`); }
    catch (error) { pageState.error = error.message; pageState.foundation.loading = false; render(); }
  });
  root.querySelector("[data-confirm-foundation-bulk-import]")?.addEventListener("click", async (event) => {
    pageState.foundation.loading = true; pageState.error = ""; render();
    try {
      const result = await confirmConnectionFoundationBulkImport(event.currentTarget.dataset.confirmFoundationBulkImport); pageState.foundation.bulkPreview = result;
      await loadDataFoundation(render); await loadConnectionAssetsPage(render);
      window.alert(`批量导入完成：新增链接 ${result.result?.createdLinks || 0}，更新链接 ${result.result?.updatedLinks || 0}，新增经营事实 ${result.result?.factsCreated || 0}。`);
    } catch (error) { pageState.error = error.message; pageState.foundation.loading = false; render(); }
  });
  root.querySelector("[data-foundation-template-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try { await createConnectionFoundationTemplate({ ...Object.fromEntries(form), fieldMappings: JSON.parse(form.get("fieldMappingsJson")) }); await loadDataFoundation(render); }
    catch (error) { pageState.error = error.message; render(); }
  });
  root.querySelectorAll("[data-iterate-foundation-template]").forEach((button) => button.addEventListener("click", async () => {
    const template = pageState.foundation.templates.find((item) => item.id === button.dataset.iterateFoundationTemplate);
    const note = window.prompt("填写本次模板迭代说明："); if (note === null) return;
    try { await iterateConnectionFoundationTemplate(template.id, { fieldMappings: template.fieldMappings, changeNote: note }); await loadDataFoundation(render); }
    catch (error) { pageState.error = error.message; render(); }
  }));
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
