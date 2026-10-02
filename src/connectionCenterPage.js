import {
  loadLinkContributions,
  saveLinkContributionRules,
  runLinkContributions,
  confirmConnectionFoundationImport,
  confirmConnectionFoundationBulkImport,
  createConnectionAction,
  loadConnectionActions,
  loadConnectionDataFoundation,
  loadDataSyncCenter,
  loadConnectionGrowthAnalysis,
  loadConnectionGrowthRankings,
  loadConnectionManagementOverview,
  loadConnectionBusinessCockpit,
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
  previewConnectionSalesDailyImport,
  loadCurrentConnectionSalesDailyImport,
  loadSalesDailyDataQuality,
  loadConnectionSalesDailyPreview,
  recalculateConnectionSalesDailyPreview,
  confirmConnectionSalesDailyFacts,
  loadSalesRelationCandidates,
  loadSalesRelationGovernance,
  loadSalesDataQualityAnomalies,
  loadPlatformGoodsExcelDataSyncPreview,
  reanalyzePlatformGoodsExcelDataSync,
  submitSalesDataQualityAnomalyDecision,
  loadSalesRelationCandidateDetail,
  confirmSalesRelationCandidate,
  confirmSalesRelationCandidateBatch,
  commitPlatformGoodsExcelDataSync,
  confirmConnectionOwnerImport,
  rebuildConnectionOwnerImportPreview,
  cancelConnectionOwnerImport,
  loadConnectionCoreDetail,
  loadConnectionInspection,
  loadConnectionInspections,
  loadConnectionBusinessPositioning,
  loadConnectionBusinessGoals,
  loadConnectionBusinessGoalEvaluation,
  refreshConnectionBusinessGoalEvaluation,
  loadConnectionGoalWorkbench,
  loadConnectionGoalHealthSummary,
  loadConnectionGoalPilotBatches,
  loadConnectionGoalPilotCandidates,
  loadConnectionGoalPilotMembers,
  loadConnectionDailySales,
  loadMyConnectionWorkbench,
  loadLinkSalesDistribution,
  loadLinkDataTable,
  loadLinkBusinessTable,
  loadLinkDataStatus,
  removeConnectionAction,
  updateConnection,
  updateConnectionAction,
  updateConnectionBusinessPositioning,
  startConnectionInspection,
  saveConnectionInspectionDraft,
  completeConnectionInspection,
  createConnectionInspectionAction,
  saveConnectionInspectionSchedule,
  createConnectionBusinessGoalSuggestion,
  confirmConnectionBusinessGoal,
  batchSetConnectionGoalPositioning,
  batchGenerateConnectionGoalSuggestions,
  batchConfirmConnectionGoals,
  createConnectionGoalPilotBatch,
  updateConnectionGoalPilotBatch,
  addConnectionGoalPilotLinks,
  excludeConnectionGoalPilotMember,
  confirmConnectionGoalPilotPositioning,
  createConnectionGoalPilotSuggestion,
  confirmConnectionGoalPilotTarget,
  updateConnectionFollow,
  uploadConnectionFoundationImport,
  uploadConnectionFoundationBulkImport,
  previewPlatformGoodsExcelDataSync,
  createConnectionFoundationTemplate,
  iterateConnectionFoundationTemplate,
  resolveAssetUrl,
} from "./services/connectionCenterService.js?v=inspection-v1";
import { getCurrentUser, state } from "./appState.js";
import { hasPermission } from "../shared/permissions.js";
import { escapeHtml } from "./utils/html.js";
import { CONNECTION_CENTER_SECTIONS, connectionCenterSectionHash, parseConnectionCenterRoute } from "./utils/connectionCenterRoute.js";
import { renderUiModule } from "./uiModuleRegistry.js";
import "./uiModules/linkSalesDistribution.js";
import "./uiModules/linkDataStatus.js";
import "./uiModules/salesDailyDataQuality.js";
import "./uiModules/myLinkSummary.js";
import "./uiModules/linkList.js";
import "./uiModules/linkWorkspaceModules.js";
import "./uiModules/linkDailySales.js";
import "./uiModules/linkImage.js";
import "./uiModules/linkColumnSetting.js";
import "./uiModules/linkDataToolbar.js";
import { LINK_DATA_COLUMNS, DEFAULT_MINE_LINK_FIELDS } from "./uiModules/linkDataTable.js";
import { reorderVisibleLinkBusinessField } from "./uiModules/linkIndicatorSetting.js";
import { businessPlatformLabel } from "./uiModules/linkBusinessToolbar.js";
import { LINK_BUSINESS_COLUMN_GROUPS, LINK_BUSINESS_COLUMNS, DEFAULT_LINK_BUSINESS_FIELDS } from "./uiModules/linkBusinessTable.js";
import { LINK_TIME_RANGE_OPTIONS, linkTimeRangeDays } from "../shared/linkTimeRange.js";

const connectionSectionStorageKey = "connection-center-section-v1";
const importPages = [
  ["platform-goods", "平台货品"],
  ["platform-operations", "平台经营数据"],
  ["sales-profit", "链接利润表"],
  ["owners", "链接负责人"],
];
let currentImportPage = "platform-goods";
let contributionModel = null;
let contributionLoading = false;
let contributionError = "";
let contributionPage = 1;
async function loadContributionPage(render) {
 contributionLoading=true;render();
 try{contributionModel=await loadLinkContributions();contributionError="";}catch(error){contributionError=error.message;}
 finally{contributionLoading=false;render();}
}

function initialConnectionSection() {
  const route = typeof window === "undefined" ? {} : parseConnectionCenterRoute(window.location.hash);
  if (route.redirectHash) window.location.hash = route.redirectHash;
  const routeSection = route.section || "";
  if (routeSection) return routeSection;
  try {
    const saved = window.localStorage.getItem(connectionSectionStorageKey) || "";
    return CONNECTION_CENTER_SECTIONS.has(saved) ? saved : "cockpit";
  } catch { return "cockpit"; }
}

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
  inspectionTaskId: "",
  detailReturnSection: "connections",
  view: "list",
  sort: "default",
  columnSort: { key: "", direction: "asc" },
  listFilters: { search: "", platform: "", shopId: "", productCode: "", ownerId: "", status: "", salesStatus: "", profitStatus: "", productRelation: "", skuCount: "", includeHistorical: "" },
  operatingSummary: { historicalAssetCount: 0, operatingCount: 0, historicalCount: 0 },
  visibleColumns: ["image", "name", "platform", "shop", "erpSales", "erpProfit", "owner", "status"],
  fieldSettingsOpen: false,
  detailTab: "business",
  detailLoaded: new Set(),
  actions: [],
  periodSnapshots: [],
  growthAnalysis: null,
  growthRankings: { topGrowth: [], risks: [] },
  managementOverview: { summary: {}, owners: [] },
  cockpit: { summary: {}, ratingSummary: {}, coreLinks: [], riskLinks: [], growthLinks: [], platforms: [], productChannels: [], trends: { erp: [], platform: [] }, periodType: "day" },
  cockpitRange: { preset: "30d", startDate: "", endDate: "", loading: false },
  cockpitShopShareMetric: "salesAmount",
  cockpitShopShareSelectedId: "",
  cockpitExpanded: false,
  cockpitProductChannels: { loading: false, loaded: false, error: "" },
  cockpitGoalHealthLoading: false,
  goalHealth: { totalLinks: 0, positionedLinks: 0, unpositionedLinks: 0, activeGoalLinks: 0, pendingGoalLinks: 0, evaluatedLinks: 0, pendingEvaluationLinks: 0, gradeSummary: {}, positioningSummary: [], evaluationPeriod: {} },
  section: initialConnectionSection(),
  dataCenterTab: "data-foundation",
  myWorkbench: { items: [], summary: { total: 0, better: 0, risk: 0, followed: 0 }, pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 }, serverPaged: true, filter: "all", search: "", isAdmin: false, loading: false, loaded: false },
  myLinkTable: { items: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 }, range: { preset: "7d", startDate: "", endDate: "" },
    filters: { keyword: "", platform: "", shopId: "", archiveStatus: "" }, sort: { field: "default", direction: "desc" },
    visibleFields: [...DEFAULT_MINE_LINK_FIELDS], fieldOrder: LINK_DATA_COLUMNS.map((item) => item.key), filterOptions: { platforms: [], shops: [] },
    dataSource: {}, columnSettingOpen: false, loading: false, loaded: false },
  businessTable: { items: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 }, range: { preset: "7d", startDate: "", endDate: "" },
    filters: { keyword: "", platform: "", shopId: "", ownerId: "", minSales: "", maxSales: "", minProfit: "", maxProfit: "", minProfitMargin: "", maxProfitMargin: "", growthStatus: "", includeHistorical: "" },
    sort: { field: "salesAmount", direction: "desc" }, visibleFields: [...DEFAULT_LINK_BUSINESS_FIELDS],
    fieldOrder: LINK_BUSINESS_COLUMNS.map((item) => item.key), filterOptions: { platforms: [], shops: [], owners: [] }, dataSources: {}, indicatorOpen: false, loading: false, loaded: false },
  goalWorkbench: { summary: {}, items: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 },
    filters: { keyword: "", positioning: "", goalStatus: "", evaluationStatus: "", ownerId: "" }, filterOptions: { owners: [] },
    period: {}, selectedIds: new Set(), loading: false, loaded: false, operating: false },
  goalManagementTab: "workbench",
  goalPilot: { batches: [], batchPagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 }, selectedBatchId: "", batch: null,
    members: [], memberPagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 }, memberFilters: { keyword: "", status: "" },
    candidates: [], candidatePagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 }, candidateFilters: { keyword: "", ownerId: "", stableOnly: "", sort: "sales" },
    filterOptions: { owners: [] }, candidateSelectedIds: new Set(), showCandidates: false, loading: false, loaded: false, operating: false },
  linkDataStatus: { data: null, shopId: "", loading: false, loaded: false, error: "" },
  salesDailyQuality: { data: null, loading: false, loaded: false, error: "" },
  salesDistribution: { scope: "company", items: [], summary: {}, selectedGroup: 0, selectedRange: null, drillTable: null, loading: false, loaded: false, error: "" },
  benchmarks: { items: [], candidates: [], comparison: null, comparisonId: "", loading: false },
  foundation: { definitions: {}, templates: [], batches: [], errors: [], loading: false, preview: null, bulkPreview: null, salesPreview: null, dailyPreview: null, dailyLoading: false, dailyCommitting: false, dailyError: "", dailyMessage: "", dailyFileName: "", dailyFile: null, dailyCategory: "ready" },
  platformGoodsImport: { taskId: "", preview: null, loading: false, loaded: false, error: "", message: "" },
  relationCandidates: { items: [], summary: {}, pagination: {}, filterOptions: {}, candidateType: "", loading: false, confirming: false, selected: null, selectedIds: [] },
  relationGovernance: { items: [], summary: { byType: {} }, pagination: {}, filterOptions: {}, filters: { governanceType: "", shopId: "", keyword: "", minSales: "", maxSales: "", status: "pending" }, selected: null, loading: false, loaded: false },
  salesDataQualityGovernance: { items: [], summary: { byType: {} }, pagination: {}, filters: { anomalyType: "", keyword: "" }, selected: null, loading: false, saving: false, loaded: false },
  coreDetail: null,
  coreDetailLoading: false,
  inspection: { data: null, active: null, historyDetail: null, loading: false, error: "", mode: "summary", selectedIssues: new Set() },
  dailySales: { data: null, loading: false, loaded: false, rangePreset: "30d", startDate: "", endDate: "", error: "" },
  ownerImport: { loading: false, result: null, showCompletion: false, detailKind: "", detailRows: [], detailPagination: null },
  salesPeriodType: "month",
  error: "",
};
let connectionListRequestId = 0;
let connectionSearchTimer = 0;
let cockpitRequestId = 0;

function recordCockpitPerformance(kind, detail = {}) {
  if (typeof window === "undefined") return;
  const store = window.__wufanCockpitPerformance ?? {
    startedAt: new Date().toISOString(), fetches: [], renders: [], interactive: [], renderCount: 0,
  };
  window.__wufanCockpitPerformance = store;
  if (kind === "render") { store.renderCount += 1; store.renders.push({ at: performance.now(), ...detail }); }
  else if (kind === "interactive") store.interactive.push({ at: performance.now(), ...detail });
  else store.fetches.push({ kind, at: performance.now(), ...detail });
}

function scheduleCockpitInteractiveMeasurement(label, startedAt) {
  if (typeof window === "undefined") return;
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    const root = document.querySelector(".connection-business-cockpit");
    recordCockpitPerformance("interactive", {
      label,
      elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
      domNodes: root?.querySelectorAll("*").length ?? 0,
      distributionBars: root?.querySelectorAll("[data-distribution-group],[data-distribution-bar]").length ?? 0,
    });
  }));
}

const listConfigKey = "connection-center-list-config-v2";
const myLinkTableConfigKey = "my-link-data-table-config-v1";
const linkBusinessTableConfigKey = "link-business-table-config-v1";
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

function loadLinkBusinessTableConfig() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(linkBusinessTableConfigKey) || "null");
    if (!saved || typeof saved !== "object") return;
    const valid = new Set(LINK_BUSINESS_COLUMNS.map((item) => item.key));
    if (Array.isArray(saved.fieldOrder)) {
      const order = saved.fieldOrder.filter((key) => valid.has(key));
      pageState.businessTable.fieldOrder = [...order, ...LINK_BUSINESS_COLUMNS.map((item) => item.key).filter((key) => !order.includes(key))];
    }
    if (Array.isArray(saved.visibleFields)) {
      const fields = saved.visibleFields.filter((key) => valid.has(key));
      if (fields.length) pageState.businessTable.visibleFields = fields;
    }
  } catch {
    // Invalid local UI preferences fall back to the documented defaults.
  }
}

function saveLinkBusinessTableConfig() {
  window.localStorage.setItem(linkBusinessTableConfigKey, JSON.stringify({
    fieldOrder: pageState.businessTable.fieldOrder, visibleFields: pageState.businessTable.visibleFields,
  }));
}

loadLinkBusinessTableConfig();

function loadMyLinkTableConfig() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(myLinkTableConfigKey) || "null");
    if (!saved || typeof saved !== "object") return;
    const valid = new Set(LINK_DATA_COLUMNS.map((item) => item.key));
    if (Array.isArray(saved.fieldOrder)) {
      const order = saved.fieldOrder.filter((key) => valid.has(key));
      pageState.myLinkTable.fieldOrder = [...order, ...LINK_DATA_COLUMNS.map((item) => item.key).filter((key) => !order.includes(key))];
    }
    if (Array.isArray(saved.visibleFields)) {
      const fields = saved.visibleFields.filter((key) => valid.has(key));
      if (fields.length) pageState.myLinkTable.visibleFields = fields;
    }
  } catch {
    // Invalid browser preferences fall back to the safe operating defaults.
  }
}

function saveMyLinkTableConfig() {
  window.localStorage.setItem(myLinkTableConfigKey, JSON.stringify({
    fieldOrder: pageState.myLinkTable.fieldOrder,
    visibleFields: pageState.myLinkTable.visibleFields,
  }));
}

loadMyLinkTableConfig();

function canManage() {
  return hasPermission(getCurrentUser(), "links.manage");
}

function canRefreshRating() {
  return hasPermission(getCurrentUser(), "links.rating");
}

function isAdmin() {
  const user = getCurrentUser();
  return ["admin", "system_admin"].includes(user?.role) || user?.authRole === "admin";
}

function canManageAdminDataCenter() {
  return isAdmin() && hasPermission(getCurrentUser(), "dataCenter.manage");
}

function canImportBusinessData() {
  return hasPermission(getCurrentUser(), "links.import");
}

function canManageRelations() {
  return hasPermission(getCurrentUser(), "links.manageRelations");
}

function canOpenConnectionSection(section) {
  if (["sales-relation-governance", "sales-data-quality-governance"].includes(section)) return canManageRelations();
  return CONNECTION_CENTER_SECTIONS.has(section);
}

function selectConnectionSection(section, { updateRoute = true } = {}) {
  const normalized = canOpenConnectionSection(section) ? section : "cockpit";
  pageState.section = normalized; pageState.selectedId = ""; pageState.coreDetail = null;
  try { window.localStorage.setItem(connectionSectionStorageKey, normalized); } catch { /* Browser preferences are optional. */ }
  if (updateRoute) {
    const nextHash = normalized === "data-import" ? `#connectionCenter/data-import/${currentImportPage}` : connectionCenterSectionHash(normalized);
    if (window.location.hash !== nextHash) window.history.replaceState(null, "", nextHash);
  }
  return normalized;
}

function ensureConnectionSectionLoaded(section, render) {
  if (section === "cockpit" && !pageState.loadedSections.has("cockpit")) void loadBusinessCockpitPage(render);
  if (section === "connections") {
    if (!pageState.businessTable.loaded && !pageState.businessTable.loading) void loadLinkBusinessTablePage(render);
    if (!pageState.linkDataStatus.loaded && !pageState.linkDataStatus.loading) void loadMyLinkDataStatus(render);
  }
  if (section === "goal-management") {
    if (!contributionModel && !contributionLoading && !contributionError) void loadContributionPage(render);
  }
  if (section === "my-links") {
    if (!pageState.myLinkTable.loaded && !pageState.myLinkTable.loading) void loadMyLinks(render);
    if (!pageState.linkDataStatus.loaded && !pageState.linkDataStatus.loading) void loadMyLinkDataStatus(render);
  }
  if (section === "data-import") {
    if (!pageState.linkDataStatus.loaded && !pageState.linkDataStatus.loading) void loadMyLinkDataStatus(render);
    if (!pageState.salesDailyQuality.loaded && !pageState.salesDailyQuality.loading) void loadSalesDailyQualityPanel(render);
    if (canImportBusinessData() && !pageState.loadedSections.has("data-import") && !pageState.foundation.loading) void loadDataFoundation(render);
    if (canManageAdminDataCenter() && !pageState.platformGoodsImport.loaded && !pageState.platformGoodsImport.loading) void loadPlatformGoodsImport(render);
  }
  if (section === "sales-relation-governance" && canImportBusinessData()
    && !pageState.relationGovernance.loaded && !pageState.relationGovernance.loading) void loadSalesRelationGovernancePage(render, { page: 1 });
  if (section === "sales-data-quality-governance" && canImportBusinessData()
    && !pageState.salesDataQualityGovernance.loaded && !pageState.salesDataQualityGovernance.loading) void loadSalesDataQualityGovernancePage(render, { page: 1 });
}

function invalidateLinkOperatingViews(operatingSet = null) {
  for (const section of ["cockpit", "connections", "goal-management", "my-links"]) pageState.loadedSections.delete(section);
  pageState.assetMetaLoaded = false;
  pageState.businessTable = { ...pageState.businessTable, items: [], pagination: { ...pageState.businessTable.pagination, page: 1, total: 0 }, loaded: false, loading: false };
  pageState.myLinkTable = { ...pageState.myLinkTable, items: [], pagination: { ...pageState.myLinkTable.pagination, page: 1, total: 0 }, loaded: false, loading: false };
  pageState.goalWorkbench = { ...pageState.goalWorkbench, summary: {}, items: [], pagination: { ...pageState.goalWorkbench.pagination, page: 1, total: 0 }, loaded: false, loading: false };
  pageState.salesDistribution = { ...pageState.salesDistribution, items: [], summary: {}, selectedGroup: 0, selectedRange: null, drillTable: null, loaded: false, loading: false };
  if (operatingSet) pageState.operatingSummary = operatingSet;
}

function connectionAnomalies(item) {
  const problems = [];
  if (Number(item.salesGrowth) < -0.2) problems.push({ title: "销售明显下降", value: growthText(item.salesGrowth) });
  if (Number(item.visitorGrowth) < -0.2) problems.push({ title: "流量下降", value: growthText(item.visitorGrowth) });
  if (Number(item.conversionChange) < -0.01) problems.push({ title: "转化下降", value: growthText(item.conversionChange, { points: true }) });
  if (Number(item.profitGrowth) < -0.2) problems.push({ title: "利润下降", value: growthText(item.profitGrowth) });
  return problems;
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
  const names = [...new Set((item.products ?? []).map((product) => product.name || product.skuCode).filter(Boolean))];
  return names.length ? names.join("、") : "未关联产品";
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

const importStatusLabels = {
  waiting: "排队中", running: "处理中", validated: "已校验", preview_ready: "待确认",
  preview_ready_with_errors: "待确认·有异常", completed: "已完成", completed_with_errors: "已完成·有异常",
  completed_with_exceptions: "已完成·有异常", succeeded: "已成功", partial: "部分完成", failed: "失败",
  blocked: "已阻断", superseded: "已被新批次替代", cancelled: "已取消", pending: "待处理",
  active: "生效中", ignored: "已忽略", resolved: "已解决", idempotent_skipped: "重复数据已跳过",
};
function dataUpdateStatusText(status) { return importStatusLabels[status] || status || "—"; }

const importErrorLabels = {
  ERP_USAGE_NOT_CLASSIFIED: "ERP商品用途待确认", SOURCE_FIELDS_INCOMPLETE: "来源字段不完整", SUMMARY_ROW: "汇总行",
  combo_goods: "历史组合关系待治理", bundle_sku: "历史套装关系待治理",
  missing_product_structure: "商品结构缺失", product_structure_review_pending: "商品结构待审核",
  product_structure_conflict: "商品结构冲突", duplicate_data: "重复数据",
  duplicate_relation: "重复关系", empty_owner: "负责人为空", erp_relation_conflict: "ERP关系冲突",
  erp_relation_governance_pending: "ERP关系待确认", invalid_platform: "平台信息无效", invalid_format: "数据格式错误",
  missing_erp_mapping: "ERP关系缺失", missing_erp_sku: "ERP商品编码未匹配", missing_erp_sku_code: "ERP商品编码缺失",
  missing_field: "必填字段缺失", missing_link: "链接未匹配", missing_period: "数据日期缺失", link_shop_mismatch: "链接店铺归属不一致",
  missing_platform_sku: "平台规格未匹配", missing_platform_sku_id: "平台规格编号缺失", missing_shop: "店铺未匹配",
  profile_not_found: "负责人档案不存在", no_system_goods: "系统商品未匹配", api_or_validation_error: "接口或数据校验异常",
  erp_sku_row_isolated: "ERP商品数据已隔离", erp_sku_row_warning: "ERP商品数据提醒", image_download_warning: "图片下载提醒",
};
function importErrorText(errorType) { return importErrorLabels[errorType] || errorType || "未分类异常"; }

function importErrorMessageText(message) {
  return String(message || "—")
    .replaceAll("platformGoodsId", "平台货品编号")
    .replaceAll("platformSkuId", "平台规格编号")
    .replaceAll("salesLinkSkuId", "链接规格编号")
    .replaceAll("平台货品ID", "平台货品编号")
    .replaceAll("平台规格ID", "平台规格编号")
    .replaceAll("平台SKU", "平台规格")
    .replaceAll("商品ID", "商品编号")
    .replaceAll("ERP SKU", "ERP商品编码")
    .replaceAll("链接SKU", "链接规格")
    .replaceAll("active", "生效")
    .replaceAll("mapping", "关系")
    .replaceAll("API", "接口");
}

function importTypeText(key, fallback) {
  return ({ platform_link_operations: "平台链接经营数据", erp_sales: "真实销售数据", erp_product_relations: "产品关系数据", erp_inventory: "库存数据" })[key]
    || String(fallback || key || "未知类型").replace(/^ERP/, "");
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

function renderSectionNavigation() {
  return `<nav class="connection-section-nav" aria-label="连接中心页面">
    <button type="button" class="${pageState.section === "cockpit" ? "active" : ""}" data-connection-section="cockpit">经营驾驶舱</button>
    <button type="button" class="${pageState.section === "my-links" ? "active" : ""}" data-connection-section="my-links">我的链接</button>
    <button type="button" class="${pageState.section === "connections" ? "active" : ""}" data-connection-section="connections">全部链接</button>
    <button type="button" class="${pageState.section === "goal-management" ? "active" : ""}" data-connection-section="goal-management">链接经营管理</button>
    <button type="button" class="${["data-import", "sales-relation-governance", "sales-data-quality-governance"].includes(pageState.section) ? "active" : ""}" data-connection-section="data-import">数据更新</button>
  </nav>`;
}

function renderDataUpdateWorkspace() {
  const navigation = `<nav class="connection-section-nav connection-import-page-nav" aria-label="数据上传类型">${importPages.map(([key, label]) => `<button type="button" data-import-page="${key}" class="${currentImportPage === key ? "active" : ""}" aria-current="${currentImportPage === key ? "page" : "false"}">${label}</button>`).join("")}</nav>`;
  const content = currentImportPage === "platform-goods" ? renderPlatformGoodsImport() : canImportBusinessData() ? renderDataFoundation(currentImportPage) : "";
  const quality = currentImportPage === "sales-profit" ? renderUiModule("sales_daily_data_quality", { state: pageState.salesDailyQuality, showGovernanceEntry: canImportBusinessData() }) : "";
  const descriptions = {
    "platform-goods": "更新店铺、Link和Link SKU基础资料；识别关系候选。不更新销售利润，不因文件缺行删除链接。",
    "platform-operations": "更新浏览、访客、收藏、加购和转化等平台表现。不创建链接，不改变ERP关系。",
    "sales-profit": "更新正式销量、销售额、成本和利润。不改变链接资产及正式ERP关系。",
    owners: "分配或替换链接负责人。不改变经营数据和商品关系。",
  };
  const types = { "platform-operations": /platform_link_operations/, "sales-profit": /sales_daily|erp_sales/, owners: /connection_owner_assignments/ };
  const batches = pageState.foundation.batches.filter(item => types[currentImportPage]?.test(item.importType || ""));
  const platformHistory = pageState.platformGoodsImport.preview?.history || [];
  const latest = currentImportPage === "platform-goods"
    ? [...platformHistory].filter(item => ["succeeded", "partial"].includes(item.status)).sort((a,b) => String(b.analyzedAt).localeCompare(String(a.analyzedAt))).map(item => ({ fileName: item.fileName || pageState.platformGoodsImport.preview?.summary?.fileName, createdAt: item.analyzedAt }))[0]
    : [...batches].filter(item => ["completed", "completed_with_errors", "succeeded", "partial"].includes(item.status)).sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  const status = currentImportPage === "sales-profit" ? quality : `<section class="connection-foundation-panel import-current-status"><h3>当前数据状态</h3><div class="connection-import-preview-grid"><span>最近已加载的确认记录<strong>${escapeHtml(latest?.fileName || "尚未加载确认记录")}</strong></span><span>记录时间<strong>${escapeHtml(latest?.createdAt || "—")}</strong></span><span>统计口径<strong>当前上传类型</strong></span></div><small>这里展示已加载的导入记录，不代表没有历史数据，也不代表所有店铺和日期均已覆盖。</small></section>`;
  return `<section class="link-data-update-workspace">${navigation}<header class="import-workspace-heading"><h2>${escapeHtml(importPages.find(([key]) => key === currentImportPage)?.[1] || "数据更新")}</h2><p>${descriptions[currentImportPage]}</p><small>首次使用：先同步平台货品，再上传经营数据或利润表；负责人可以独立更新。</small></header>${status}${content}${content ? "" : `<div class="empty-state compact"><strong>数据由管理员统一更新</strong><p>当前账号可查看最新数据状态；如有异常，请联系数据管理员处理。</p></div>`}</section>`;
}

function renderPlatformGoodsImport() {
  if (!canManageAdminDataCenter()) return "";
  const model = pageState.platformGoodsImport;
  const summary = model.preview?.summary || {};
  const exceptionReasonText = (values = {}) => {
    const reasons = Array.isArray(values.exceptionReasons) ? values.exceptionReasons : [];
    if (!Number(values.exception || 0)) return "—";
    if (!reasons.length) return "请查看差异明细";
    return reasons.map((item) => `${escapeHtml(item.reason || item.code || "需要人工确认")} ${Number(item.count || 0)}`).join("；");
  };
  const diffRow = (label, values = {}) => `<tr><td><strong>${label}</strong></td><td>${values.total || 0}</td><td>${values.new || 0}</td><td>${values.updated || 0}</td><td>${values.unchanged || 0}</td><td>${values.exception || 0}</td><td class="connection-asset-exception-reasons"><small>${exceptionReasonText(values)}</small></td></tr>`;
  const actionLabels = { new: "新增", update: "更新", unchanged: "无变化", exception: "异常", existing: "已存在", candidate: "新增候选", governance: "商品结构待治理", not_applicable: "无需ERP关系", blocked: "身份未确认", unresolved: "ERP待识别", conflict: "关系冲突", ignored: "已过滤" };
  const sampleRows = (model.preview?.preview || []).slice(0, 50);
  const history = model.preview?.history || [];
  const historyPanel = history.length ? `<details class="connection-preview-fold" ${model.preview?.duplicateFile ? "open" : ""}><summary><strong>历史分析记录</strong><span>${history.length} 次</span></summary><div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>分析时间</th><th>状态</th><th>数据量</th><th>操作</th></tr></thead><tbody>${history.map((item) => `<tr><td>${escapeHtml(String(item.analyzedAt || "—").replace("T", " ").slice(0, 19))}</td><td>${escapeHtml(item.isCurrent ? "待确认" : item.status === "succeeded" ? "已完成" : item.status === "partial" ? "部分完成" : item.status === "superseded" ? "已被新预览替代" : item.status || "—")}</td><td>共 ${item.totalCount || 0} · 新增 ${item.createdCount || 0} · 更新 ${item.updatedCount || 0} · 异常 ${item.exceptionCount || 0}</td><td><button type="button" class="text-button" data-view-platform-goods-history="${escapeHtml(item.id)}">查看历史结果</button><button type="button" class="text-button" data-reanalyze-platform-goods="${escapeHtml(item.id)}" ${model.loading ? "disabled" : ""}>重新分析</button></td></tr>`).join("")}</tbody></table></div></details>` : "";
  const preview = model.preview ? `<section class="connection-import-preview ${Number(summary.exceptionCount || 0) ? "is-blocked" : ""}"><header><div><p class="eyebrow">平台资产同步预览</p><h3>${model.preview.isCurrent ? "2 检查并确认" : "历史结果 · 只读"}</h3><p>${escapeHtml(summary.fileName || "—")} · 共 ${summary.sourceRows || 0} 行</p></div><span class="status-pill">${model.preview.isCurrent ? "待确认" : "仅查看"}</span></header>
    <div class="connection-table-wrap"><table class="connection-table connection-asset-preview-table"><thead><tr><th>资产</th><th>总数</th><th>新增</th><th>更新</th><th>无变化</th><th>异常</th><th>异常原因</th></tr></thead><tbody>${diffRow("店铺", summary.shops)}${diffRow("Link", summary.links)}${diffRow("Link SKU", summary.linkSkus)}${diffRow("平台规格编码（单品）", summary.platformSkuCodes?.single)}${diffRow("平台规格编码（组合）", summary.platformSkuCodes?.combo)}</tbody></table></div>
    <p class="form-note connection-asset-preview-note">无需ERP关系 ${summary.erpRelations?.notApplicable || 0} 条，不计入平台规格编码关系；非业务行已过滤 ${summary.ignoredNonBusiness || 0} 条。</p>
    <details class="connection-preview-fold"><summary><strong>查看差异明细</strong><span>前 ${sampleRows.length} 行</span></summary><div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>行</th><th>店铺</th><th>货品ID</th><th>规格ID</th><th>店铺</th><th>Link</th><th>Link SKU</th><th>ERP关系</th></tr></thead><tbody>${sampleRows.map((row) => `<tr><td>${row.rowNumber}</td><td>${escapeHtml(row.sourceShopName || "—")}</td><td>${escapeHtml(row.platformGoodsId || "—")}</td><td>${escapeHtml(row.platformSkuId || "—")}</td><td>${actionLabels[row.shopAction] || "—"}</td><td>${actionLabels[row.linkAction] || "—"}</td><td>${actionLabels[row.skuAction] || "—"}</td><td>${actionLabels[row.relationAction] || "—"}${row.message ? `<small>${escapeHtml(row.message)}</small>` : ""}</td></tr>`).join("") || `<tr><td colspan="8">暂无明细</td></tr>`}</tbody></table></div></details>${historyPanel}
    <footer><small>确认后只新增或更新店铺、Link和Link SKU；ERP关系只生成待审核候选，不会改动正式关系或销售事实。</small>${model.preview.isCurrent ? `<button type="button" class="primary-button" data-confirm-platform-goods-excel="${escapeHtml(model.preview.dataSyncBatch?.id)}">确认同步资产</button>` : ""}</footer></section>` : "";
  return `<section class="connection-foundation-panel"><header class="connection-section-heading"><div><h3><span class="import-step-number">1</span>上传文件</h3><p>上传后先查看店铺、Link、Link SKU、平台规格编码（单品/组合）的差异，确认后再同步。</p></div><a class="text-button" href="#settings/admin-data-center">管理员数据中心</a></header>${model.loading && !model.loaded ? `<p class="form-note">正在加载平台资产同步能力…</p>` : model.taskId ? `<form class="connection-foundation-import-form" data-platform-goods-excel-form><label>平台货品Excel<input type="file" name="file" accept=".xlsx,.xls" required ${model.loading ? "disabled" : ""} /></label><button type="submit" class="primary-button" ${model.loading ? "disabled" : ""}>${model.loading ? "正在分析差异…" : "上传并检查"}</button></form>` : `<p class="form-error">${escapeHtml(model.error || "平台货品资产同步任务不可用。")}</p>`}${model.message ? `<p class="form-success">${escapeHtml(model.message)}</p>` : ""}${model.error && model.taskId ? `<p class="form-error">${escapeHtml(model.error)}</p>` : ""}${preview}</section>`;
}

const goalPositioningLabels = { sales_growth: "引流爆款", balanced_sales: "优质动销款", long_tail: "长尾动销款", profit_contribution: "高毛利款" };
function renderGoalWorkbench() {
  const model = pageState.goalWorkbench; const summary = model.summary || {}; const filters = model.filters; const selectedCount = model.selectedIds.size;
  const percentage = (value) => Number(summary.total) ? `${(Number(value || 0) / Number(summary.total) * 100).toFixed(1)}%` : "0%";
  const rows = model.items.map((item) => {
    const evaluationText = item.evaluationStatus === "evaluated" ? goalGradeText(item.grade) : "待评价";
    return `<tr><td><input type="checkbox" data-goal-workbench-select="${escapeHtml(item.id)}" ${model.selectedIds.has(item.id) ? "checked" : ""} aria-label="选择${escapeHtml(item.name)}" /></td><td><button type="button" class="text-button connection-goal-link" data-open-connection="${escapeHtml(item.id)}" data-return-section="goal-management">${escapeHtml(item.name || item.title || "未命名链接")}</button><small>${escapeHtml(item.platformGoodsId || "—")}</small></td><td>${escapeHtml(item.platform || "—")}</td><td>${escapeHtml(item.shopDisplayName || item.shopName || "—")}</td><td>${escapeHtml(item.ownerName || "未设置")}</td><td>${escapeHtml(goalPositioningLabels[item.positioningType] || "未设置")}</td><td>${item.goalStatus === "set" ? `<span class="status-pill status-active">已设置</span>` : `<span class="status-pill">待设置</span>`}</td><td>${escapeHtml(evaluationText)}</td><td>${coreMoney(item.salesAmount)}</td><td>${coreMoney(item.profitAmount)}</td><td>${item.grade ? `<span class="status-pill goal-grade-${escapeHtml(item.grade)}">${escapeHtml(goalGradeText(item.grade))}</span>` : "—"}</td></tr>`;
  }).join("");
  const owners = model.filterOptions.owners || [];
  const pageIds = model.items.filter((item) => item.canManage).map((item) => item.id);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => model.selectedIds.has(id));
  return `<section class="connection-goal-workbench"><div class="connection-management-summary connection-goal-coverage"><article><span>链接总数</span><strong>${summary.total || 0}</strong><small>当前权限范围</small></article><article><span>经营定位</span><strong>${summary.positioned || 0}</strong><small>未设置 ${summary.unpositioned || 0} · 覆盖 ${percentage(summary.positioned)}</small></article><article><span>经营目标</span><strong>${summary.goalSet || 0}</strong><small>待设置 ${summary.goalPending || 0} · 覆盖 ${percentage(summary.goalSet)}</small></article><article><span>目标评价</span><strong>${summary.evaluated || 0}</strong><small>待评价 ${summary.evaluationPending || 0} · 覆盖 ${percentage(summary.evaluated)}</small></article></div>
    <form class="connection-goal-workbench-filters" data-goal-workbench-filters><input name="keyword" value="${escapeHtml(filters.keyword)}" placeholder="搜索链接名称或商品ID" /><select name="positioning"><option value="">全部定位</option>${Object.entries(goalPositioningLabels).map(([value, label]) => `<option value="${value}" ${filters.positioning === value ? "selected" : ""}>${label}</option>`).join("")}<option value="unset" ${filters.positioning === "unset" ? "selected" : ""}>未设置</option></select><select name="goalStatus"><option value="">全部目标状态</option><option value="set" ${filters.goalStatus === "set" ? "selected" : ""}>已设置</option><option value="pending" ${filters.goalStatus === "pending" ? "selected" : ""}>待设置</option></select><select name="evaluationStatus"><option value="">全部评价状态</option>${[["excellent","优秀"],["good","良好"],["on_target","达标"],["underperforming","不达标"],["pending","待评价"]].map(([value,label]) => `<option value="${value}" ${filters.evaluationStatus === value ? "selected" : ""}>${label}</option>`).join("")}</select><select name="ownerId"><option value="">全部负责人</option>${owners.map((owner) => `<option value="${escapeHtml(owner.id)}" ${filters.ownerId === owner.id ? "selected" : ""}>${escapeHtml(owner.name || owner.id)}</option>`).join("")}</select><button type="submit" class="secondary-button">筛选</button></form>
    <div class="connection-goal-batch-bar"><strong>已选 ${selectedCount} 个链接</strong><form data-goal-workbench-positioning><select name="positioningType" required><option value="">批量设置定位</option>${Object.entries(goalPositioningLabels).map(([value,label]) => `<option value="${value}">${label}</option>`).join("")}</select><input name="decisionReason" required maxlength="500" placeholder="填写批量设置原因" /><button type="submit" class="secondary-button" ${!selectedCount || model.operating ? "disabled" : ""}>应用定位</button></form><button type="button" class="secondary-button" data-goal-workbench-suggest ${!selectedCount || model.operating ? "disabled" : ""}>生成目标建议</button><button type="button" class="primary-button" data-goal-workbench-confirm ${!selectedCount || model.operating ? "disabled" : ""}>确认系统建议</button></div>
    <small class="form-note">近30天经营数据周期：${model.period.startDate ? escapeHtml(`${model.period.startDate} 至 ${model.period.endDate}`) : "暂无销售事实"}。批量建议不会自动生效。</small>
    ${model.loading ? `<div class="empty-state">正在读取链接经营覆盖情况…</div>` : `<div class="connection-table-wrap"><table class="connection-table"><thead><tr><th><input type="checkbox" data-goal-workbench-select-all ${allSelected ? "checked" : ""} aria-label="选择本页" /></th><th>链接名称</th><th>平台</th><th>店铺</th><th>负责人</th><th>经营定位</th><th>目标状态</th><th>评价状态</th><th>近30天销售额</th><th>近30天利润</th><th>经营评级</th></tr></thead><tbody>${rows || `<tr><td colspan="11">暂无符合条件的链接</td></tr>`}</tbody></table></div><footer class="connection-goal-workbench-footer"><small>共 ${model.pagination.total || 0} 条，每页 ${model.pagination.pageSize || 50} 条，服务端分页</small><div><button type="button" class="text-button" data-goal-workbench-page="${Math.max(1, model.pagination.page - 1)}" ${model.pagination.page <= 1 ? "disabled" : ""}>上一页</button><span>${model.pagination.page} / ${model.pagination.totalPages}</span><button type="button" class="text-button" data-goal-workbench-page="${model.pagination.page + 1}" ${model.pagination.page >= model.pagination.totalPages ? "disabled" : ""}>下一页</button></div></footer>`}
  </section>`;
}

const goalPilotBatchStatusLabels = { draft: "候选选择", positioning: "定位确认", target_confirm: "目标确认", evaluation: "进入评价", completed: "已完成" };
const goalPilotLinkStatusLabels = { selected: "已选择", positioning_pending: "待确认定位", target_pending: "待确认目标", active: "目标已生效", excluded: "已排除" };

function renderGoalPilotMemberAction(item, batch) {
  if (!item.canManage || item.status === "excluded") return "—";
  if (!item.positioningType) return batch.status === "positioning" ? `<form class="goal-pilot-inline-form" data-goal-pilot-positioning data-member-id="${escapeHtml(item.id)}"><select name="positioningType" required><option value="">选择定位</option>${Object.entries(goalPositioningLabels).map(([value,label]) => `<option value="${value}">${label}</option>`).join("")}</select><input name="decisionReason" required maxlength="500" placeholder="确认原因" /><button type="submit" class="secondary-button">确认定位</button></form>` : `<small>等待进入定位确认阶段</small>`;
  if (!item.goalPlanId) return batch.status === "target_confirm" ? `<button type="button" class="secondary-button" data-goal-pilot-suggestion="${escapeHtml(item.id)}">生成目标建议</button>` : `<small>定位已确认，等待目标确认阶段</small>`;
  if (item.goalStatus !== "active") {
    const suggestedMargin = Number(item.salesSuggested) ? (Number(item.profitSuggested || 0) / Number(item.salesSuggested) * 100).toFixed(2) : "";
    return batch.status === "target_confirm" ? `<form class="goal-pilot-inline-form goal-pilot-target-form" data-goal-pilot-target data-member-id="${escapeHtml(item.id)}" data-plan-id="${escapeHtml(item.goalPlanId)}"><label>月份<input type="month" name="targetMonth" required value="${escapeHtml(currentGoalMonth())}" /></label><label>销售<input type="number" name="salesAmount" min="0" step="0.01" required value="${item.salesSuggested ?? ""}" /></label><label>毛利率<input type="number" name="profitMargin" min="-100" max="100" step="0.01" required value="${escapeHtml(suggestedMargin)}" /></label><label>利润<input type="number" name="profitAmount" data-goal-pilot-profit-target step="0.01" readonly value="${item.profitSuggested ?? ""}" /></label><button type="submit" class="primary-button">确认目标</button></form>` : `<small>等待进入目标确认阶段</small>`;
  }
  return `<span class="status-pill status-active">已进入目标管理</span>${batch.status === "evaluation" ? `<small>等待现有评价流程计算</small>` : ""}`;
}

function renderGoalPilot() {
  const model = pageState.goalPilot; const batch = model.batch; const progress = batch?.progress || {};
  const batchOptions = model.batches.map((item) => `<option value="${escapeHtml(item.id)}" ${model.selectedBatchId === item.id ? "selected" : ""}>${escapeHtml(item.name)} · ${escapeHtml(goalPilotBatchStatusLabels[item.status] || item.status)}</option>`).join("");
  const nextStatus = batch ? ({ draft: "positioning", positioning: "target_confirm", target_confirm: "evaluation", evaluation: "completed" })[batch.status] : "";
  const memberRows = model.members.map((item) => `<tr><td><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.platformGoodsId || "—")} · ${escapeHtml(item.shopName || "—")}</small></td><td>${escapeHtml(item.ownerName || "—")}</td><td>${coreMoney(item.salesAmount)}<small>利润 ${coreMoney(item.profitAmount)} · 活跃 ${item.activeDays || 0}天</small></td><td>${item.tags.map((tag) => `<span class="status-pill">${escapeHtml(tag)}</span>`).join(" ")}</td><td>${escapeHtml(item.positioningName || "待确认")}</td><td>${escapeHtml(goalPilotLinkStatusLabels[item.status] || item.status)}${item.goalPlanId ? `<small>${escapeHtml(item.targetBasis)} · ${item.targetConfidence === "high" ? "高置信度" : item.targetConfidence === "low" ? "低置信度" : "需人工设置"}</small>` : ""}</td><td>${renderGoalPilotMemberAction(item, batch)}${model.permissions?.canAdjustScope && item.status !== "excluded" ? `<button type="button" class="text-button danger" data-goal-pilot-exclude="${escapeHtml(item.id)}">排除</button>` : ""}</td></tr>`).join("");
  const candidateRows = model.candidates.map((item) => `<tr><td><input type="checkbox" data-goal-pilot-candidate="${escapeHtml(item.id)}" ${model.candidateSelectedIds.has(item.id) ? "checked" : ""} /></td><td><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.platformGoodsId || "—")} · ${escapeHtml(item.shopName || "—")}</small></td><td>${escapeHtml(item.ownerName || "—")}</td><td>${coreMoney(item.salesAmount)}</td><td>${coreMoney(item.profitAmount)}</td><td>${item.activeDays || 0}天</td><td>${item.tags.map((tag) => `<span class="status-pill">${escapeHtml(tag)}</span>`).join(" ")}</td></tr>`).join("");
  return `<section class="connection-goal-pilot">
    <div class="goal-pilot-toolbar"><select data-goal-pilot-batch-select><option value="">选择试点批次</option>${batchOptions}</select>${model.permissions?.canCreateBatch ? `<form data-goal-pilot-create><input name="name" required maxlength="120" placeholder="例如：2026年8月链接经营试点" /><input name="description" maxlength="1000" placeholder="试点说明（可选）" /><button type="submit" class="primary-button">创建批次</button></form>` : ""}</div>
    ${!batch ? `<div class="empty-state"><strong>还没有可查看的经营试点</strong><p>管理员创建批次后，再从有负责人、有近30天销售数据的链接中选择候选。</p></div>` : `
      <header class="goal-pilot-header"><div><h3>${escapeHtml(batch.name)}</h3><p>${escapeHtml(batch.description || "首批核心链接经营目标初始化")}</p></div><span class="status-pill status-active">${escapeHtml(goalPilotBatchStatusLabels[batch.status] || batch.status)}</span>${model.permissions?.canAdjustScope && nextStatus ? `<button type="button" class="secondary-button" data-goal-pilot-advance="${nextStatus}">推进到${escapeHtml(goalPilotBatchStatusLabels[nextStatus])}</button>` : ""}</header>
      <div class="connection-management-summary goal-pilot-progress"><article><span>总链接</span><strong>${Math.max(0, Number(progress.totalLinks || 0) - Number(progress.excludedLinks || 0))}</strong><small>已排除 ${progress.excludedLinks || 0}</small></article><article><span>已定位</span><strong>${progress.positionedLinks || 0}</strong></article><article><span>已生成目标</span><strong>${progress.generatedGoalLinks || 0}</strong></article><article><span>已确认目标</span><strong>${progress.confirmedGoalLinks || 0}</strong></article><article><span>进入评价</span><strong>${progress.evaluationLinks || 0}</strong></article></div>
      <div class="goal-pilot-list-tools"><form data-goal-pilot-member-filter><input name="keyword" value="${escapeHtml(model.memberFilters.keyword)}" placeholder="搜索试点链接" /><select name="status"><option value="">全部状态</option>${Object.entries(goalPilotLinkStatusLabels).map(([value,label]) => `<option value="${value}" ${model.memberFilters.status === value ? "selected" : ""}>${label}</option>`).join("")}</select><button class="secondary-button">筛选</button></form>${model.permissions?.canAdjustScope && ["draft","positioning"].includes(batch.status) ? `<button type="button" class="secondary-button" data-goal-pilot-toggle-candidates>${model.showCandidates ? "收起候选" : "添加候选链接"}</button>` : ""}</div>
      ${model.showCandidates ? `<section class="goal-pilot-candidates"><form data-goal-pilot-candidate-filter><input name="keyword" value="${escapeHtml(model.candidateFilters.keyword)}" placeholder="搜索候选链接" /><select name="ownerId"><option value="">全部负责人</option>${(model.filterOptions.owners || []).map((owner) => `<option value="${escapeHtml(owner.id)}" ${model.candidateFilters.ownerId === owner.id ? "selected" : ""}>${escapeHtml(owner.name)}</option>`).join("")}</select><select name="stableOnly"><option value="">全部稳定性</option><option value="true" ${model.candidateFilters.stableOnly === "true" ? "selected" : ""}>近30天至少20天有销售</option></select><select name="sort"><option value="sales" ${model.candidateFilters.sort === "sales" ? "selected" : ""}>销售额优先</option><option value="profit" ${model.candidateFilters.sort === "profit" ? "selected" : ""}>利润贡献优先</option><option value="stability" ${model.candidateFilters.sort === "stability" ? "selected" : ""}>稳定性优先</option></select><button class="secondary-button">筛选</button></form><div class="goal-pilot-selection"><strong>已选 ${model.candidateSelectedIds.size} 个</strong><button type="button" class="primary-button" data-goal-pilot-add-candidates ${!model.candidateSelectedIds.size ? "disabled" : ""}>加入当前批次</button><small>候选只要求有负责人和近30天销售数据；标签不会自动生成经营定位。</small></div><div class="connection-table-wrap"><table class="connection-table"><thead><tr><th></th><th>链接</th><th>负责人</th><th>近30天销售额</th><th>利润贡献</th><th>销售活跃</th><th>辅助标签</th></tr></thead><tbody>${candidateRows || `<tr><td colspan="7">暂无符合条件的候选链接</td></tr>`}</tbody></table></div>${renderGoalPilotPager("candidate", model.candidatePagination)}</section>` : ""}
      <div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>链接</th><th>负责人</th><th>近30天经营</th><th>辅助标签</th><th>当前定位</th><th>目标状态</th><th>操作</th></tr></thead><tbody>${memberRows || `<tr><td colspan="7">当前批次还没有链接</td></tr>`}</tbody></table></div>${renderGoalPilotPager("member", model.memberPagination)}
    `}
  </section>`;
}

function renderGoalPilotPager(kind, pagination = {}) {
  return `<footer class="connection-goal-workbench-footer"><small>共 ${pagination.total || 0} 条，每页 ${pagination.pageSize || 50} 条，服务端分页</small><div><button type="button" class="text-button" data-goal-pilot-${kind}-page="${Math.max(1, Number(pagination.page || 1) - 1)}" ${Number(pagination.page || 1) <= 1 ? "disabled" : ""}>上一页</button><span>${pagination.page || 1} / ${pagination.totalPages || 1}</span><button type="button" class="text-button" data-goal-pilot-${kind}-page="${Number(pagination.page || 1) + 1}" ${Number(pagination.page || 1) >= Number(pagination.totalPages || 1) ? "disabled" : ""}>下一页</button></div></footer>`;
}

function renderGoalManagement() {
 const rule=contributionModel?.rule,run=contributionModel?.run;
 const allResults=contributionModel?.results||[], totalPages=Math.max(1,Math.ceil(allResults.length/100));
 contributionPage=Math.min(contributionPage,totalPages);
 const visibleResults=allResults.slice((contributionPage-1)*100,contributionPage*100);
 return `<section class="connection-v3-panel"><header><h2>链接贡献级别</h2><span>公司统一利润排名 · 每30天评级 · 新品90天</span></header>
 ${contributionError?`<p role="alert">${escapeHtml(contributionError)}</p>`:""}
 ${contributionLoading?`<p>正在读取贡献评级…</p>`:""}
 ${isAdmin()&&canRefreshRating()?`<form data-contribution-rules class="connection-positioning-form"><label>分级指标<select name="mode"><option value="rank_percentile" ${rule?.mode==="rank_percentile"?"selected":""}>利润排名百分位</option><option value="profit_share" ${rule?.mode==="profit_share"?"selected":""}>累计利润贡献占比</option></select></label>${["S","A","B","C"].map(k=>`<label>${k}级累计边界（%）<input name="${k}" type="number" min="0.01" max="99.99" step="0.01" required value="${rule?.thresholds?.[k]??""}" /></label>`).join("")}<label>首次评级日<input name="firstRatingDate" type="date" required value="${rule?.firstRatingDate||""}" ${run?"readonly":""} /></label><button class="primary-button">保存公司级规则</button></form><button class="secondary-button" type="button" data-contribution-run>执行到期评级</button>`:""}
 <p>边界由低到高设置，剩余归D。同利润同等级；新品不占S～D名额。上架日期缺失时提示错误，后续导入。零利润/亏损的非新品为D。规则修改只影响下一期。</p>
 <p>${run?`最近评级 ${escapeHtml(run.ratingDate)} · 数据 ${escapeHtml(run.periodStart)} 至 ${escapeHtml(run.periodEnd)}`:"尚未生成评级"}</p>
 <div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>链接</th><th>平台 · 店铺</th><th>近30天利润</th><th>公司利润排名</th><th>贡献级别</th><th>数据提示</th></tr></thead><tbody>${visibleResults.map(r=>`<tr><td><button class="text-button" data-open-connection="${escapeHtml(r.salesLinkId)}">${escapeHtml(r.title||r.platformGoodsId)}</button></td><td>${escapeHtml(`${r.platform} · ${r.shopName}`)}</td><td>${r.profitAmount==null?"—":coreMoney(r.profitAmount)}</td><td>${r.companyRank||"—"}</td><td>${r.grade||"—"}</td><td>${escapeHtml(r.error||"—")}</td></tr>`).join("")||`<tr><td colspan="6">${rule?"等待到期评级":"请先设置公司级评级规则"}</td></tr>`}</tbody></table></div><footer><small>共 ${allResults.length} 条 · 第 ${contributionPage}/${totalPages} 页</small><button type="button" class="text-button" data-contribution-page="${contributionPage-1}" ${contributionPage<=1?"disabled":""}>上一页</button><button type="button" class="text-button" data-contribution-page="${contributionPage+1}" ${contributionPage>=totalPages?"disabled":""}>下一页</button></footer></section>`;
}

const anomalyLabels = { identity_error: "身份异常", missing_relation: "缺失关系", relation_conflict: "关系冲突", incomplete_structure: "结构不完整" };
const anomalyActionLabels = { add: "新增关系申请", replace: "替换关系申请", ignore: "忽略并留痕" };
function renderSalesDataQualityGovernance() {
  const model = pageState.salesDataQualityGovernance; const summary = model.summary || {}; const filters = model.filters || {};
  const cards = Object.entries(anomalyLabels).map(([key, label]) => `<button type="button" data-quality-anomaly-type="${key}" class="${filters.anomalyType === key ? "is-active" : ""}"><span>${label}</span><strong>${summary.byType?.[key]?.count || 0}</strong><small>¥${usageMoney(summary.byType?.[key]?.salesAmount)}</small></button>`).join("");
  const rows = (model.items || []).map((item) => `<tr><td>${escapeHtml(anomalyLabels[item.anomalyType] || item.anomalyType)}<small>${escapeHtml(item.reason?.label || "—")}</small></td><td>${escapeHtml(item.saleDate || "—")}</td><td>${escapeHtml(item.shop?.name || item.shop?.sourceName || "—")}</td><td>${escapeHtml(item.link?.name || item.link?.platformGoodsId || "—")}<small>${escapeHtml(item.salesLinkSku?.platformSkuId || "—")}</small></td><td>${escapeHtml(item.erpSku?.merchantSkuCode || "—")}</td><td>¥${usageMoney(item.salesAmount)}<small>利润 ¥${usageMoney(item.profitAmount)}</small></td><td><button type="button" class="text-button" data-open-quality-anomaly="${escapeHtml(item.id)}">查看处理</button></td></tr>`).join("");
  const selected = model.selected;
  const detail = selected ? `<article class="connection-import-preview"><header><div><h3>${escapeHtml(anomalyLabels[selected.anomalyType] || selected.anomalyType)}</h3><p>${escapeHtml(selected.reason?.message || "—")}</p></div><button type="button" class="text-button" data-close-quality-anomaly>关闭</button></header><div class="connection-import-preview-grid"><span>销售日期<strong>${escapeHtml(selected.saleDate || "—")}</strong></span><span>店铺<strong>${escapeHtml(selected.shop?.name || selected.shop?.sourceName || "—")}</strong></span><span>链接<strong>${escapeHtml(selected.link?.name || selected.link?.platformGoodsId || "—")}</strong></span><span>链接规格<strong>${escapeHtml(selected.salesLinkSku?.platformSkuId || "—")}</strong></span><span>ERP商品编码<strong>${escapeHtml(selected.erpSku?.merchantSkuCode || "—")}</strong></span><span>影响金额<strong>¥${usageMoney(selected.salesAmount)}</strong></span></div><h4>关系差异</h4><p>当前组件：${escapeHtml((selected.componentDiff?.currentComponents || []).join("、") || "无")}<br />销售记录中额外出现的ERP商品：${escapeHtml((selected.componentDiff?.salesExtra || []).join("、") || "无")}</p>${canManage() ? `<form data-quality-anomaly-decision><label>处理方式<select name="action">${selected.availableActions.map((action) => `<option value="${action}">${escapeHtml(anomalyActionLabels[action])}</option>`).join("")}</select></label><label>处理说明<textarea name="decisionNote" required rows="3"></textarea></label><button type="submit" class="primary-button" ${model.saving ? "disabled" : ""}>提交治理草稿</button><small>新增/替换只进入货品结构审批；不直接修改正式关系。忽略会保留审核快照。</small></form>` : ""}</article>` : "";
  return `<section class="connection-foundation-page"><header class="connection-section-heading"><div><p class="eyebrow">销售数据异常治理</p><h2>销售数据异常治理</h2><p>解释真实异常，并将修复路由到正式关系审批。</p></div><button type="button" class="secondary-button" data-workbench-go="data-import">返回数据更新</button></header><div class="connection-import-preview-grid"><span>异常总数<strong>${summary.total || 0}</strong></span><span>影响销售额<strong>¥${usageMoney(summary.salesAmount)}</strong></span><span>影响利润<strong>¥${usageMoney(summary.profitAmount)}</strong></span></div><div class="relation-governance-type-grid"><button type="button" data-quality-anomaly-type="" class="${!filters.anomalyType ? "is-active" : ""}"><span>全部</span><strong>${summary.total || 0}</strong></button>${cards}</div><form class="connection-filter-row" data-quality-anomaly-filters><input name="keyword" value="${escapeHtml(filters.keyword || "")}" placeholder="搜索店铺、链接、规格或ERP商品编码" /><button type="submit" class="secondary-button">筛选</button></form>${model.loading ? `<div class="empty-state">正在分析异常…</div>` : `<div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>异常</th><th>日期</th><th>店铺</th><th>链接 / 规格</th><th>ERP商品编码</th><th>影响</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="7">暂无异常</td></tr>`}</tbody></table></div><footer><small>每页 ${model.pagination?.pageSize || 30} 条，服务端分页。</small><div><button type="button" class="text-button" data-quality-anomaly-page="${Math.max(1, Number(model.pagination?.page || 1) - 1)}" ${Number(model.pagination?.page || 1) <= 1 ? "disabled" : ""}>上一页</button><span>${model.pagination?.page || 1} / ${model.pagination?.totalPages || 1}</span><button type="button" class="text-button" data-quality-anomaly-page="${Number(model.pagination?.page || 1) + 1}" ${Number(model.pagination?.page || 1) >= Number(model.pagination?.totalPages || 1) ? "disabled" : ""}>下一页</button></div></footer>`}${detail}</section>`;
}

const relationGovernanceLabels = { single: "单关系确认", single_quantity: "单组件数量确认", combo: "商品结构审核" };
const relationGovernanceStatusLabels = { pending: "待治理", approved: "已确认", rejected: "已拒绝", superseded: "已替代", conflict: "冲突" };

function renderSalesRelationGovernance() {
  const model = pageState.relationGovernance; const summary = model.summary || {}; const filters = model.filters || {}; const selected = model.selected;
  const typeStats = Object.entries(relationGovernanceLabels).map(([key, label]) => { const value = summary.byType?.[key] || {}; return `<button type="button" data-governance-type="${key}" class="${filters.governanceType === key ? "is-active" : ""}"><span>${label}</span><strong>${value.count || 0}</strong><small>¥${usageMoney(value.salesAmount)} · 利润 ¥${usageMoney(value.profitAmount)}</small></button>`; }).join("");
  const rows = (model.items || []).map((item) => `<tr><td><strong>${escapeHtml(item.platformSkuName || item.platformSkuId || "—")}</strong><small>${escapeHtml(item.linkName || "—")}</small></td><td>${escapeHtml(item.shop?.name || "—")}<small>${escapeHtml(item.shop?.platform || "")}</small></td><td>${item.erpSkus.map((erp) => `<strong>${escapeHtml(erp.merchantSkuCode || "—")}</strong><small>${escapeHtml(erp.specificationName || "")}</small>`).join("")}</td><td>${escapeHtml(relationGovernanceLabels[item.governanceType] || item.governanceType)}</td><td>${item.salesEvidence?.affectedRows || 0}<small>${escapeHtml(item.salesEvidence?.dateStart && item.salesEvidence?.dateEnd ? `${item.salesEvidence.dateStart} 至 ${item.salesEvidence.dateEnd}` : "—")}</small></td><td>¥${usageMoney(item.salesAmount)}<small>利润 ¥${usageMoney(item.profitAmount)}</small></td><td>${escapeHtml(relationGovernanceStatusLabels[item.status] || item.status)}</td><td><button type="button" class="text-button" data-open-relation-governance="${escapeHtml(item.id)}">${escapeHtml(relationGovernanceLabels[item.governanceType] || "审核")}</button></td></tr>`).join("");
  const detail = selected ? `<article class="connection-import-preview relation-governance-detail"><header><div><h3>${escapeHtml(selected.platformSkuName || selected.linkName || "销售关系证据")}</h3><p>${escapeHtml(relationGovernanceLabels[selected.governanceType])} · ${escapeHtml(selected.shop?.name || "—")}</p></div><button type="button" class="text-button" data-close-relation-governance>关闭</button></header><div class="connection-import-preview-grid"><span>链接<strong>${escapeHtml(selected.linkName || "—")}</strong></span><span>平台货品编号<strong>${escapeHtml(selected.platformGoodsId || "—")}</strong></span><span>平台规格编号<strong>${escapeHtml(selected.platformSkuId || "—")}</strong></span><span>影响行数<strong>${selected.salesEvidence?.affectedRows || 0}</strong></span><span>影响销售额<strong>¥${usageMoney(selected.salesAmount)}</strong></span><span>影响利润<strong>¥${usageMoney(selected.profitAmount)}</strong></span></div><h4>候选ERP商品编码</h4><div class="connection-template-list">${selected.erpSkus.map((erp) => `<article><div><strong>${escapeHtml(erp.merchantSkuCode || "—")}</strong><span>${escapeHtml(erp.specificationName || "—")}</span></div></article>`).join("")}</div>${selected.governanceType === "single_quantity" ? `<p class="form-note">观察到的日报数量：${escapeHtml((selected.salesEvidence?.observedQuantities || []).join("、") || "—")}。该数量仅为销售证据，正式关系中的组件数量必须由人工确认，系统不会自动推导。</p>` : ""}<footer><small>此工作台只组织证据和审核入口，不会自动创建正式关系、修改ERP用途或写入日报事实。</small>${selected.governanceType === "combo" ? `<span class="status-pill">请进入商品结构审批</span>` : selected.governanceType === "single_quantity" ? `<span class="status-pill">数量人工确认入口</span>` : `<button type="button" class="secondary-button" data-enter-relation-review>进入单关系确认</button>`}</footer></article>` : "";
  return `<section class="connection-foundation-page sales-relation-governance"><header class="connection-section-heading"><div><p class="eyebrow">销售关系治理</p><h2>销售关系治理</h2><p>统一处理单关系、单组件数量和组合关系；系统只整理精确匹配证据。</p></div><button type="button" class="secondary-button" data-workbench-go="data-import">返回数据更新</button></header><div class="connection-import-preview-grid"><span>待治理链接规格<strong>${summary.pendingLinkSkuCount || 0}</strong></span><span>影响销售额<strong>¥${usageMoney(summary.salesAmount)}</strong></span><span>影响利润<strong>¥${usageMoney(summary.profitAmount)}</strong></span></div><div class="relation-governance-type-grid"><button type="button" data-governance-type="" class="${!filters.governanceType ? "is-active" : ""}"><span>全部</span><strong>${summary.pendingLinkSkuCount || 0}</strong><small>统一治理入口</small></button>${typeStats}</div><form class="connection-filter-row" data-relation-governance-filters><input name="keyword" value="${escapeHtml(filters.keyword || "")}" placeholder="搜索链接、链接规格或货品编号" /><select name="shopId"><option value="">全部店铺</option>${(model.filterOptions?.shops || []).map((item) => `<option value="${escapeHtml(item.id)}" ${filters.shopId === item.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}</select><input type="number" name="minSales" min="0" step="0.01" value="${escapeHtml(filters.minSales || "")}" placeholder="最低销售额" /><input type="number" name="maxSales" min="0" step="0.01" value="${escapeHtml(filters.maxSales || "")}" placeholder="最高销售额" /><select name="status"><option value="pending" ${filters.status === "pending" ? "selected" : ""}>待治理</option><option value="conflict" ${filters.status === "conflict" ? "selected" : ""}>冲突</option><option value="approved" ${filters.status === "approved" ? "selected" : ""}>已确认</option></select><button type="submit" class="secondary-button">筛选</button><button type="button" class="text-button" data-reset-relation-governance>清除</button></form>${model.loading ? `<div class="empty-state">正在读取销售关系治理数据…</div>` : `<div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>链接规格</th><th>店铺</th><th>候选ERP商品</th><th>治理类型</th><th>销售证据</th><th>影响金额</th><th>状态</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="8">暂无符合条件的待治理关系</td></tr>`}</tbody></table></div>`}<footer><small>候选只来自销售日报精确身份匹配结果，不使用名称或模糊匹配。</small><div><button type="button" class="text-button" data-relation-governance-page="${Math.max(1, Number(model.pagination?.page || 1) - 1)}" ${Number(model.pagination?.page || 1) <= 1 ? "disabled" : ""}>上一页</button><span>${model.pagination?.page || 1} / ${model.pagination?.totalPages || 1}</span><button type="button" class="text-button" data-relation-governance-page="${Number(model.pagination?.page || 1) + 1}" ${Number(model.pagination?.page || 1) >= Number(model.pagination?.totalPages || 1) ? "disabled" : ""}>下一页</button></div></footer>${detail}</section>`;
}

const usageMoney = (value) => Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function renderDataFoundation(importPage = currentImportPage) {
  const isOperations = importPage === "platform-operations";
  const isProfit = importPage === "sales-profit";
  const isOwners = importPage === "owners";
  const allowedTypes = isOperations ? ["platform_link_operations"] : isOwners ? ["connection_owner_assignments"] : ["sales_daily", "sales_daily_preview", "erp_sales", "sales_daily_facts"];
  const matchesType = (type) => allowedTypes.includes(type) || (isProfit && /sales_daily/.test(type || ""));
  const foundation = { ...pageState.foundation, batches: pageState.foundation.batches.filter((item) => matchesType(item.importType)), errors: pageState.foundation.errors.filter((item) => matchesType(item.importType)), templates: pageState.foundation.templates.filter((item) => matchesType(item.dataType)) };
  const types = Object.entries(foundation.definitions).filter(([key]) => matchesType(key));
  const typeLabel = (key) => importTypeText(key, foundation.definitions[key]?.label);
  const preview = isOperations ? foundation.preview : null;
  const previewPanel = preview ? `<section class="connection-import-preview ${preview.blocked ? "is-blocked" : ""}"><header><div><p class="eyebrow">导入预览</p><h3>平台链接经营导入预览</h3></div><span class="status-pill">${preview.blocked ? "已阻断" : preview.batch?.status === "completed" || preview.batch?.status === "completed_with_errors" ? "已导入" : "待确认"}</span></header><div class="connection-import-preview-grid"><span>文件格式<strong>${escapeHtml(preview.preview?.templateName || "—")}</strong></span><span>平台<strong>${escapeHtml(preview.preview?.platform || "—")}</strong></span><span>店铺<strong>${escapeHtml(preview.preview?.shop || "—")}</strong></span><span>数据周期<strong>${escapeHtml(preview.preview?.periodStart && preview.preview?.periodEnd ? `${preview.preview.periodStart} 至 ${preview.preview.periodEnd}` : "多个周期 / 无法汇总")}</strong></span><span>原始行数<strong>${escapeHtml(preview.preview?.rawRows ?? 0)}</strong></span><span>有效经营数据<strong>${escapeHtml(preview.preview?.validOperationRows ?? 0)}</strong></span><span>新增/更新数据<strong>${escapeHtml(preview.preview?.operationFacts ?? 0)}</strong></span><span>已忽略下架Link<strong>${escapeHtml(preview.preview?.ignoredDelistedLinks ?? 0)}</strong></span><span>真正异常<strong>${escapeHtml(preview.preview?.errors ?? 0)}</strong></span></div>${preview.preview?.duplicateGoodsIds?.length ? `<p class="form-error">过滤后商品ID重复：${escapeHtml(preview.preview.duplicateGoodsIds.join("、"))}</p>` : ""}<footer><small>确认前不会创建链接档案或写入经营事实。</small>${canImportBusinessData() && !preview.blocked && !["completed", "completed_with_errors"].includes(preview.batch?.status) ? `<button type="button" class="primary-button" data-confirm-foundation-import="${escapeHtml(preview.batch.id)}">确认导入</button>` : ""}</footer></section>` : "";
  const salesPreview = isProfit ? foundation.salesPreview : null;
  const salesSummary = salesPreview?.summary || {};
  const legacySourceBatchId = salesPreview?.dataSyncBatch?.sourceBatchType === "connection_sales_import" ? salesPreview.importBatch?.id : "";
  const salesPreviewPanel = legacySourceBatchId ? `<section class="connection-import-preview"><header><div><p class="eyebrow">历史归档</p><h3>旧周期利润表记录</h3></div><span class="status-pill">只读</span></header><div class="connection-import-preview-grid"><span>批次编号<strong>${escapeHtml(legacySourceBatchId)}</strong></span><span>文件<strong>${escapeHtml(salesSummary.fileName || "—")}</strong></span><span>历史成功行<strong>${salesSummary.valid || 0}</strong></span><span>历史异常<strong>${salesSummary.exceptionCount || 0}</strong></span><span>周期开始<strong>${escapeHtml(salesSummary.periodStart || "—")}</strong></span><span>周期结束<strong>${escapeHtml(salesSummary.periodEnd || "—")}</strong></span></div><footer><small>旧周期事实仅供历史归档查看；新销售数据统一通过销售日报导入并写入 daily facts。</small></footer></section>` : "";
  const dailyPreview = isProfit ? foundation.dailyPreview : null;
  const dailySummary = dailyPreview?.summary || {};
  const dailyCategory = foundation.dailyCategory || "ready";
  const dailyRows = dailyPreview?.rows || [];
  const dailyCategoryLabels = { ready: "可导入日报", pending_relation: "待确认销售关系", error: "异常" };
  const dailyCoverage = (value) => value === null || value === undefined ? "暂无数据" : `${(Number(value) * 100).toFixed(2)}%`;
  const factCommit = dailySummary.factCommit;
  const dailyPreviewPanel = dailyPreview ? `<section class="connection-import-preview ${dailySummary.errorRows ? "is-blocked" : ""}"><header><div><p class="eyebrow">销售日报预览</p><h3>本次链接利润表检查结果</h3></div><span class="status-pill">第 ${dailySummary.previewRevision || 1} 版</span></header><div class="connection-import-preview-grid"><span>文件<strong>${escapeHtml(dailySummary.fileName || "—")}</strong></span><span>日期范围<strong>${escapeHtml(dailySummary.dateStart && dailySummary.dateEnd ? `${dailySummary.dateStart} 至 ${dailySummary.dateEnd}` : "—")}</strong></span><span>总行数<strong>${dailySummary.totalRows || 0}</strong></span><span>可导入日报<strong>${dailySummary.readyRows || 0}</strong></span><span>待确认关系<strong>${dailySummary.pendingRelationRows || 0}</strong></span><span>异常<strong>${dailySummary.errorRows || 0}</strong></span><span>商品销售额覆盖率<strong>${dailyCoverage(dailySummary.salesAmountCoverage)}</strong></span><span>商品利润覆盖率<strong>${dailyCoverage(dailySummary.profitAmountCoverage)}</strong></span></div>${dailySummary.changes ? `<p class="form-note">本次重算：新增可导入 ${Number(dailySummary.changes.readyRows || 0)} 条，减少待确认 ${Math.max(0, -Number(dailySummary.changes.pendingRelationRows || 0))} 条，异常变化 ${Number(dailySummary.changes.errorRows || 0)} 条。</p>` : ""}${dailySummary.relationRecalculationRequired ? `<p class="form-note">销售关系已更新，此预览需要人工重新计算；不会自动写入日报事实。</p>` : ""}${factCommit ? `<div class="connection-import-preview-grid"><span>新增事实<strong>${factCommit.insertedCount || 0}</strong></span><span>重复数据已跳过<strong>${factCommit.skippedCount || 0}</strong></span><span>待确认更新<strong>${factCommit.updatePendingCount || 0}</strong></span><span>未写入<strong>${factCommit.blockedCount || 0}</strong></span><span>写入销售额<strong>¥${usageMoney(factCommit.insertedSalesAmount)}</strong></span><span>写入利润<strong>¥${usageMoney(factCommit.insertedProfitAmount)}</strong></span></div>` : ""}<nav class="connection-data-center-nav" aria-label="销售日报预览分类">${Object.entries(dailyCategoryLabels).map(([key, label]) => `<button type="button" class="${dailyCategory === key ? "active" : ""}" data-daily-preview-category="${key}">${label}</button>`).join("")}</nav><div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>行号</th><th>店铺</th><th>货品编号</th><th>平台规格编号</th><th>商家编码</th><th>日期</th><th>销售额</th><th>利润</th><th>结果</th></tr></thead><tbody>${dailyRows.map((row) => { const item = row.normalized || {}; return `<tr><td>${escapeHtml(row.rowNumber)}</td><td>${escapeHtml(item.shopName || "—")}</td><td>${escapeHtml(item.platformGoodsId || "—")}</td><td>${escapeHtml(item.platformSkuId || "—")}</td><td>${escapeHtml(item.merchantSkuCode || "—")}</td><td>${escapeHtml(item.saleDate || "—")}</td><td>${item.salesAmount === null || item.salesAmount === undefined ? "暂无数据" : escapeHtml(Number(item.salesAmount).toFixed(2))}</td><td>${item.profitAmount === null || item.profitAmount === undefined ? "暂无数据" : escapeHtml(Number(item.profitAmount).toFixed(2))}</td><td>${escapeHtml(importErrorMessageText(row.errorMessage || dailyCategoryLabels[row.category] || row.category))}</td></tr>`; }).join("") || `<tr><td colspan="9">当前分类暂无数据</td></tr>`}</tbody></table></div><footer><small>${factCommit ? `事实写入已确认于 ${escapeHtml(factCommit.confirmedAt)}` : "覆盖率仅统计商品销售；运费、会计辅助及其他已确认非商品用途不进入分母。确认时会重新执行分类、用途与关系校验。"}</small>${!factCommit && canImportBusinessData() ? `<button type="button" class="primary-button" data-confirm-sales-daily-facts="${escapeHtml(dailyPreview.batch?.id)}" ${foundation.dailyCommitting ? "disabled" : ""}>${foundation.dailyCommitting ? "正在写入…" : "确认导入可用日报"}</button>` : ""}${canImportBusinessData() && !factCommit && (dailySummary.relationRecalculationRequired || Number(dailySummary.previewRevision || 1) > 1) ? `<button type="button" class="secondary-button" data-recalculate-sales-daily-preview="${escapeHtml(dailyPreview.batch?.id)}" ${foundation.dailyLoading ? "disabled" : ""}>${foundation.dailyLoading ? "正在重新计算…" : "重新计算预览"}</button>` : ""}</footer></section>` : "";
  const candidates = pageState.relationCandidates;
  const candidateSummary = candidates.summary || {};
  const selectedCandidate = candidates.selected;
  const selectedCandidateIds = candidates.selectedIds || [];
  const candidatePanel = dailyPreview ? `<section class="connection-foundation-panel">
    <header class="connection-section-heading"><div><p class="eyebrow">销售关系复核</p><h3>待确认销售关系</h3><p>仅单品关系候选可由具备链接管理权限的用户人工确认；组合关系候选保持只读。</p></div></header>
    <div class="connection-import-preview-grid"><span>候选关系<strong>${candidateSummary.total || 0}</strong></span><span>单品候选<strong>${candidateSummary.single || 0}</strong></span><span>组合审核候选<strong>${candidateSummary.combo || 0}</strong></span><span>影响日报行<strong>${candidateSummary.affectedRows || 0}</strong></span><span>影响销售额<strong>${Number(candidateSummary.salesAmount || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}</strong></span><span>影响利润<strong>${Number(candidateSummary.profitAmount || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}</strong></span></div>
    <nav class="connection-data-center-nav" aria-label="销售关系候选类型"><button type="button" class="${!candidates.candidateType ? "active" : ""}" data-relation-candidate-type="">全部</button><button type="button" class="${candidates.candidateType === "single" ? "active" : ""}" data-relation-candidate-type="single">单品</button><button type="button" class="${candidates.candidateType === "combo" ? "active" : ""}" data-relation-candidate-type="combo">组合审核</button>${canManage() && selectedCandidateIds.length ? `<button type="button" class="primary-button" data-confirm-relation-candidate-batch ${candidates.confirming ? "disabled" : ""}>确认所选单品关系（${selectedCandidateIds.length}）</button>` : ""}</nav>
    <div class="connection-table-wrap"><table class="connection-table"><thead><tr>${canManage() ? "<th>选择</th>" : ""}<th>店铺</th><th>链接</th><th>平台规格</th><th>ERP商品编码</th><th>类型</th><th>影响行数</th><th>日期范围</th><th>销售金额</th><th>状态</th><th></th></tr></thead><tbody>${(candidates.items || []).map((item) => `<tr>${canManage() ? `<td>${item.candidateType === "single" && item.status === "pending" ? `<input type="checkbox" data-select-relation-candidate="${escapeHtml(item.id)}" ${selectedCandidateIds.includes(item.id) ? "checked" : ""} aria-label="选择单品关系候选" />` : "—"}</td>` : ""}<td>${escapeHtml(item.shop?.name || "—")}<small>${escapeHtml(item.shop?.platform || "")}</small></td><td>${escapeHtml(item.link?.title || item.link?.platformGoodsId || "—")}</td><td>${escapeHtml(item.platformSku?.specificationName || item.platformSku?.platformSkuId || "—")}</td><td>${escapeHtml(item.erpSku?.merchantSkuCode || "—")}<small>${escapeHtml(item.erpSku?.specificationName || "")}</small></td><td>${item.candidateType === "combo" ? "组合审核" : "单品"}</td><td>${escapeHtml(item.affectedRowCount)}</td><td>${escapeHtml(`${item.affectedDateStart || "—"} 至 ${item.affectedDateEnd || "—"}`)}</td><td>${Number(item.salesAmount || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}</td><td>${dataUpdateStatusText(item.status)}</td><td><button type="button" class="text-button" data-view-relation-candidate="${escapeHtml(item.id)}">查看证据</button></td></tr>`).join("") || `<tr><td colspan="${canManage() ? 11 : 10}">当前没有待确认候选</td></tr>`}</tbody></table></div>
    ${selectedCandidate ? `<article class="connection-import-preview"><header><div><h3>匹配证据</h3><p>${escapeHtml(selectedCandidate.item?.link?.title || "销售关系候选")}</p></div><button type="button" class="text-button" data-close-relation-candidate>关闭</button></header><div class="connection-import-preview-grid"><span>原始店铺<strong>${escapeHtml(selectedCandidate.item?.evidence?.shop?.sourceName || "—")}</strong></span><span>系统店铺<strong>${escapeHtml(selectedCandidate.item?.evidence?.shop?.systemName || "—")}</strong></span><span>平台货品编号<strong>${escapeHtml(selectedCandidate.item?.evidence?.link?.platformGoodsId || "—")}</strong></span><span>平台规格编号<strong>${escapeHtml(selectedCandidate.item?.evidence?.platformSku?.platformSkuId || "—")}</strong></span><span>商家编码<strong>${escapeHtml(selectedCandidate.item?.evidence?.erpSku?.merchantSkuCode || "—")}</strong></span><span>来源文件<strong>${escapeHtml(selectedCandidate.item?.source?.fileName || "—")}</strong></span></div><div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>行号</th><th>日期</th><th>销量</th><th>销售额</th><th>利润</th></tr></thead><tbody>${(selectedCandidate.sourceRows || []).map((row) => `<tr><td>${escapeHtml(row.rowNumber)}</td><td>${escapeHtml(row.normalized?.saleDate || "—")}</td><td>${escapeHtml(row.normalized?.quantity ?? "—")}</td><td>${escapeHtml(row.normalized?.salesAmount ?? "—")}</td><td>${escapeHtml(row.normalized?.profitAmount ?? "—")}</td></tr>`).join("")}</tbody></table></div><footer><small>确认只会创建生效的单品ERP关系，不修改旧字段或销售事实。</small>${canManage() && selectedCandidate.item?.candidateType === "single" && selectedCandidate.item?.status === "pending" ? `<button type="button" class="primary-button" data-confirm-relation-candidate="${escapeHtml(selectedCandidate.item.id)}" ${candidates.confirming ? "disabled" : ""}>确认单品关系</button>` : ""}</footer></article>` : ""}
    <footer><small>组合候选不提供确认入口；所有确认操作均由服务端再次校验权限和当前关系。</small></footer>
  </section>` : "";
  const bulkPreview = isOperations ? foundation.bulkPreview : null;
  const bulkStatusText = { waiting: "排队中", running: "处理中", preview_ready: "待批量确认", preview_ready_with_errors: "待确认 · 有异常", completed: "已完成", completed_with_errors: "已完成 · 有异常", failed: "处理失败" };
  const fileStatusText = { waiting: "等待", running: "解析中", preview_ready: "待确认", already_imported: "历史已导入", blocked: "已阻断", failed: "异常", completed: "已导入", completed_with_errors: "已导入 · 有异常" };
  const bulkPreviewPanel = bulkPreview ? `<section class="connection-import-preview ${bulkPreview.batch?.failedCount ? "is-blocked" : ""}"><header><div><p class="eyebrow">批量导入预览</p><h3>平台链接数据批量预览</h3></div><span class="status-pill">${escapeHtml(bulkStatusText[bulkPreview.batch?.status] || bulkPreview.batch?.status)}</span></header><div class="connection-import-preview-grid"><span>文件总数<strong>${escapeHtml(bulkPreview.batch?.fileCount || 0)}</strong></span><span>已处理<strong>${escapeHtml(bulkPreview.batch?.processedCount || 0)}</strong></span><span>原始行数<strong>${escapeHtml(bulkPreview.summary?.rawRows || 0)}</strong></span><span>有效经营数据<strong>${escapeHtml(bulkPreview.summary?.validOperationRows || 0)}</strong></span><span>新增/更新数据<strong>${escapeHtml(bulkPreview.summary?.operationFacts || 0)}</strong></span><span>已忽略下架Link<strong>${escapeHtml(bulkPreview.summary?.ignoredDelistedLinks || 0)}</strong></span><span>真正异常<strong>${escapeHtml(bulkPreview.summary?.errors || 0)}</strong></span></div><div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>文件</th><th>平台</th><th>店铺</th><th>有效经营数据</th><th>忽略下架Link</th><th>真正异常</th><th>状态</th></tr></thead><tbody>${(bulkPreview.files || []).map((file) => `<tr><td>${escapeHtml(file.fileName)}</td><td>${escapeHtml(file.platform || "识别中")}</td><td>${escapeHtml(file.shop || "—")}</td><td>${escapeHtml(file.summary?.validOperationRows || 0)}</td><td>${escapeHtml(file.summary?.ignoredDelistedLinks || 0)}</td><td>${escapeHtml(file.summary?.errors || 0)}</td><td>${escapeHtml(fileStatusText[file.status] || file.status)}${file.errorMessage ? `<small>${escapeHtml(file.errorMessage)}</small>` : ""}</td></tr>`).join("")}</tbody></table></div><footer><small>后台按文件顺序处理；确认前不创建链接或写入经营事实。</small>${canImportBusinessData() && ["preview_ready", "preview_ready_with_errors"].includes(bulkPreview.batch?.status) ? `<button type="button" class="primary-button" data-confirm-foundation-bulk-import="${escapeHtml(bulkPreview.batch.id)}">批量确认导入</button>` : ""}</footer></section>` : "";
  const businessImportForms = canImportBusinessData() ? `<div class="connection-business-import-grid">
    ${isOperations ? `<form class="connection-foundation-import-form" data-foundation-bulk-import-form><label>平台链接每日数据表（按链接ID和日期识别，可多选）<input type="file" name="files" accept=".xls,.xlsx" multiple required /></label><button type="submit" class="primary-button">上传并检查</button></form>` : ""}
    ${isProfit ? `<form class="connection-foundation-import-form" data-sales-daily-import-form novalidate><label>链接利润表<input type="file" name="file" accept=".xls,.xlsx" ${foundation.dailyLoading ? "disabled" : ""} data-sales-daily-file /></label>${foundation.dailyFileName ? `<small>已选择：${escapeHtml(foundation.dailyFileName)}</small>` : ""}<button type="submit" class="primary-button" ${foundation.dailyLoading ? "disabled aria-busy=\"true\"" : ""}>${foundation.dailyLoading ? "正在生成日报预览…" : "上传并检查"}</button><div class="connection-import-feedback" aria-live="polite">${foundation.dailyError ? `<span class="form-error">${escapeHtml(foundation.dailyError)}</span>` : foundation.dailyMessage ? `<span class="form-success">${escapeHtml(foundation.dailyMessage)}</span>` : ""}</div></form>` : ""}
    ${isOwners ? renderOwnerImportUploader() : ""}
  </div>` : "";
  return `<section class="connection-foundation-page">
    <section class="connection-foundation-panel import-upload-step"><h3><span class="import-step-number">1</span>上传文件</h3>${businessImportForms}<p class="form-note">选择对应类型的Excel文件，上传后先检查，确认前不写入正式业务数据。</p></section>
    <div class="import-review-heading"><h3><span class="import-step-number">2</span>检查并确认</h3><small>只展示本次文件；历史异常在下方单独查看。</small></div>
    ${!dailyPreviewPanel && !bulkPreviewPanel && !previewPanel && (!isOwners || !pageState.ownerImport.result) ? `<section class="connection-foundation-panel import-review-empty">上传文件后，这里显示识别结果、可导入数据和待处理原因。</section>` : ""}
    ${previewPanel}
    ${isOwners ? renderOwnerImport() : ""}
    ${bulkPreviewPanel ? `<details class="connection-preview-fold" ${["waiting", "running", "preview_ready", "preview_ready_with_errors", "failed"].includes(bulkPreview.batch?.status) ? "open" : ""}><summary><strong>平台链接数据导入</strong><span>${escapeHtml(bulkStatusText[bulkPreview.batch?.status] || bulkPreview.batch?.status)} · ${escapeHtml(bulkPreview.batch?.fileCount || 0)} 个文件</span></summary>${bulkPreviewPanel}</details>` : ""}
    ${dailyPreviewPanel ? `<div class="import-current-preview">${renderImportAmountReconciliation(dailySummary)}${dailySummary.pendingRelationRows || dailySummary.errorRows ? `<div class="import-issue-guidance"><strong>本次待处理</strong><p>关系待确认 ${dailySummary.pendingRelationRows || 0} 行 · 真正异常 ${dailySummary.errorRows || 0} 行。可用行仍按现有导入规则确认。</p><button type="button" class="text-button" data-workbench-go="sales-relation-governance">处理正式销售关系 →</button><button type="button" class="text-button" data-workbench-go="sales-data-quality-governance">处理身份和结构异常 →</button></div>` : ""}${dailyPreviewPanel}</div>` : ""}
    ${salesPreviewPanel ? `<details class="connection-preview-fold"><summary><strong>旧周期利润表历史记录</strong><span>${escapeHtml(salesSummary.fileName || "—")}</span></summary>${salesPreviewPanel}</details>` : ""}
    <details class="connection-foundation-panel connection-collapsible-panel"><summary><strong>3 导入历史</strong><span>最近 ${Math.min(foundation.batches.length, 10)} 条</span></summary><div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>文件</th><th>类型</th><th>时间</th><th>成功</th><th>异常</th><th>状态</th></tr></thead><tbody>${foundation.batches.slice(0, 10).map((item) => `<tr><td>${escapeHtml(item.fileName)}</td><td>${escapeHtml(typeLabel(item.importType))}</td><td>${escapeHtml(item.createdAt)}</td><td>${escapeHtml(item.matchedRows)}</td><td>${escapeHtml(item.errorRows)}</td><td>${escapeHtml(dataUpdateStatusText(item.status))}</td></tr>`).join("") || `<tr><td colspan="6">暂无导入记录</td></tr>`}</tbody></table></div></details>
    ${foundation.errors.length ? `<details class="connection-foundation-panel connection-collapsible-panel"><summary><strong>历史导入异常记录</strong><span>已加载 ${foundation.errors.length} 条</span></summary><p class="form-note">这是历史导入记录，不等于当前未解决问题数量，也不等于本次上传异常数量。</p><div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>文件</th><th>行号</th><th>外部标识</th><th>异常类型</th><th>说明</th></tr></thead><tbody>${foundation.errors.slice(0, 50).map((item) => `<tr><td>${escapeHtml(item.fileName)}</td><td>${escapeHtml(item.rowNumber)}</td><td>${escapeHtml(item.externalKey || "—")}</td><td>${escapeHtml(importErrorText(item.errorType))}</td><td>${escapeHtml(importErrorMessageText(item.errorMessage))}</td></tr>`).join("")}</tbody></table></div><small>仅展示最近 50 条，完整记录请在数据中心查看。</small></details>` : ""}
  </section>`;
}

function renderImportAmountReconciliation(summary) {
  const line = (label, source, ready) => source === undefined || ready === undefined ? "" : `<tr><th>${label}</th><td>文件统计 ¥${usageMoney(source)}</td><td>→ 可导入 ¥${usageMoney(ready)}</td><td>→ 未纳入可导入金额 ¥${usageMoney(Number(source) - Number(ready))}</td></tr>`;
  const rows = line("销售额", summary.sourceSalesAmount, summary.readySalesAmount) + line("利润", summary.sourceProfitAmount, summary.readyProfitAmount);
  return rows ? `<section class="connection-foundation-panel import-amount-reconciliation"><h4>本次金额对账</h4><div class="connection-table-wrap"><table class="connection-table"><tbody>${rows}</tbody></table></div><small>金额来自服务端预览；未纳入部分可能包含待确认、异常及辅助核算，不能全部视为数据丢失。负利润下覆盖率不代表完整程度，请同时核对金额。</small></section>` : "";
}

function trendLabel(item) {
  if (item.trend === "better") return { text: "经营向好", className: "better" };
  if (item.trend === "worse") return { text: "需要关注", className: "worse" };
  return { text: "经营平稳", className: "stable" };
}

function trendDetails(item) {
  return [["销售", item.salesGrowth, false], ["流量", item.visitorGrowth, false], ["转化", item.conversionChange, true], ["利润", item.profitGrowth, false]]
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([label, value, points]) => `${label} ${growthText(value, { points })}`).join(" · ") || "尚无可比较变化";
}

function renderMyLinksWorkbench() {
  const workbench = pageState.myWorkbench; const summary = workbench.summary ?? {};
  const table = pageState.myLinkTable;
  const orderedColumns = table.fieldOrder.map((key) => LINK_DATA_COLUMNS.find((item) => item.key === key)).filter(Boolean);
  const visibleFields = table.fieldOrder.filter((key) => table.visibleFields.includes(key));
  const columnSetting = renderUiModule("link_column_setting", { columns: orderedColumns, visibleFields: table.visibleFields, open: table.columnSettingOpen });
  return `<section class="my-links-workbench"><header><div><p class="eyebrow">MY LINK WORKSPACE</p><h2>我的链接</h2><p>关注销售贡献、经营风险与今天需要处理的问题。</p></div></header>
    ${renderUiModule("link_data_status", { state: pageState.linkDataStatus })}
    ${renderUiModule("my_link_summary", { summary, money: coreMoney })}
    ${renderUiModule("link_data_toolbar", { keyword: table.filters.keyword, range: table.range, filters: table.filters,
      platforms: table.filterOptions.platforms, shops: table.filterOptions.shops, columnSettingHtml: columnSetting, dataSource: table.dataSource })}
    ${renderUiModule("link_data_table", { items: table.items.map((item) => ({ ...item, imageUrl: item.mainImage ? resolveAssetUrl(item.mainImage) : "" })),
      pagination: table.pagination, fields: visibleFields, columns: orderedColumns, sort: table.sort, loading: table.loading, showOwner: false })}
  </section>`;
}

function renderWorkbenchLinkCards(items, { emptyText = "暂无链接", limit = 6, showFollow = false } = {}) {
  const visible = items.slice(0, limit);
  if (!visible.length) return `<div class="empty-state compact">${escapeHtml(emptyText)}</div>`;
  return `<div class="connection-workbench-card-grid">${visible.map((item) => { const trend = trendLabel(item); return `<article class="connection-workbench-link-card ${showFollow ? "has-follow" : ""}"><button type="button" data-open-connection="${escapeHtml(item.id)}">${imageHtml(item)}<span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(`${item.platform} · ${shopName(item)}`)}</small><em>销售 ${item.currentPayAmount == null ? "—" : `¥${Number(item.currentPayAmount).toLocaleString("zh-CN")}`} · ${growthText(item.salesGrowth)}</em><i class="my-link-trend is-${trend.className}">${escapeHtml(trend.text)}</i></span></button>${showFollow ? `<button type="button" class="my-link-follow is-followed" data-toggle-connection-follow="${escapeHtml(item.id)}" data-followed="true">★ 已关注</button>` : ""}</article>`; }).join("")}</div>`;
}

function renderConnectionWorkbenchHome() {
  const mine = pageState.myWorkbench; const summary = mine.summary ?? {};
  const followed = mine.items.filter((item) => item.followed); const risks = mine.items.filter((item) => item.trend === "worse");
  const normalCount = mine.items.filter((item) => item.trend === "stable").length;
  return `<section class="connection-workbench-home"><header><p class="eyebrow">运营人员每日统一入口</p><h2>链接经营工作台</h2><span>${mine.isAdmin ? "管理员当前查看全部经营链接。" : "仅展示当前账号负责和关注的经营链接。"}</span></header>
    <div class="connection-workbench-summary"><button type="button" data-workbench-go="my-links"><span>我的链接</span><strong>${summary.total || 0}</strong></button><button type="button" data-workbench-my-filter="worse"><span>需要关注</span><strong>${summary.risk || 0}</strong></button><span><span>经营向好</span><strong>${summary.better || 0}</strong></span></div>
    <section class="connection-workbench-block"><header><div><h3>我的经营</h3><p>风险优先排列当前负责链接</p></div><button type="button" class="text-button" data-workbench-go="my-links">查看全部 →</button></header><div class="connection-workbench-mine-stats"><span>正常 <b>${normalCount}</b></span><span>向好 <b>${summary.better || 0}</b></span><span>风险 <b>${summary.risk || 0}</b></span></div>${renderWorkbenchLinkCards(mine.items, { emptyText: "当前账号暂无负责链接" })}</section>
    <section class="connection-workbench-block is-risk"><header><div><h3>风险链接</h3><p>优先处理经营指标明显下降的连接</p></div><button type="button" class="text-button" data-workbench-my-filter="worse">查看风险链接 →</button></header>${renderWorkbenchLinkCards(risks, { emptyText: "当前没有风险链接", limit: 4 })}</section>
    <section class="connection-workbench-block"><header><div><h3>重点关注</h3><p>当前账号主动收藏的重要链接</p></div><button type="button" class="text-button" data-workbench-my-filter="followed">查看全部关注 →</button></header>${renderWorkbenchLinkCards(followed, { emptyText: "尚未关注链接", limit: 4, showFollow: true })}</section>
    <section class="connection-workbench-block is-all-links"><header><div><h3>全部链接</h3><p>当前经营 ${pageState.operatingSummary.operatingCount || 0} · 历史/退出 ${pageState.operatingSummary.historicalCount || 0} · 历史总数 ${pageState.operatingSummary.historicalAssetCount || 0}</p></div></header>${renderToolbar()}${renderList()}</section>
  </section>`;
}

function renderToolbar() {
  const platforms = [...new Set(pageState.items.map((item) => item.platform).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const shops = [...new Map(pageState.items.map((item) => [item.shopId, { id: item.shopId, name: shopName(item), platform: item.platform }])).values()]
    .map((shop) => ({ ...shop, label: `${businessPlatformLabel(shop.platform)} · ${shop.name}` }))
    .sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
  const owners = [...new Map([...(state.people ?? []).filter((person) => person.status === "active"),
    ...(pageState.managementOverview.owners ?? []).filter((owner) => owner.ownerId !== "unassigned")
      .map((owner) => ({ id: owner.ownerId, name: owner.ownerName, status: "active" }))].map((person) => [person.id, person])).values()];
  const filters = pageState.listFilters;
  return `<div class="connection-list-tools">
    <form class="connection-list-filters" data-connection-list-filters>
      <input name="search" value="${escapeHtml(filters.search)}" placeholder="搜索名称 / 商品ID / 店铺 / 平台 / 产品编码" aria-label="全部链接统一搜索" />
      <select name="platform" aria-label="平台筛选"><option value="">全部平台</option>${platforms.map((platform) => `<option value="${escapeHtml(platform)}" ${filters.platform === platform ? "selected" : ""}>${escapeHtml(platform)}</option>`).join("")}</select>
      <select name="shopId" aria-label="店铺筛选"><option value="">全部店铺</option>${shops.map((shop) => `<option value="${escapeHtml(shop.id)}" ${filters.shopId === shop.id ? "selected" : ""}>${escapeHtml(shop.label)}</option>`).join("")}</select>
      <input name="productCode" value="${escapeHtml(filters.productCode)}" placeholder="筛选产品编码" aria-label="关联产品编码筛选" />
      <select name="ownerId" aria-label="负责人筛选"><option value="">全部负责人</option><option value="unassigned" ${filters.ownerId === "unassigned" ? "selected" : ""}>未分配负责人</option><option value="assigned" ${filters.ownerId === "assigned" ? "selected" : ""}>已分配负责人</option>${owners.map((person) => `<option value="${escapeHtml(person.id)}" ${filters.ownerId === person.id ? "selected" : ""}>${escapeHtml(person.name)}</option>`).join("")}</select>
      <select name="salesStatus" aria-label="销售状态筛选"><option value="">全部销售状态</option><option value="selling" ${filters.salesStatus === "selling" ? "selected" : ""}>有真实销售</option><option value="no_sales" ${filters.salesStatus === "no_sales" ? "selected" : ""}>暂无真实销售</option></select>
      <select name="profitStatus" aria-label="利润状态筛选"><option value="">全部利润状态</option><option value="profit" ${filters.profitStatus === "profit" ? "selected" : ""}>盈利</option><option value="loss" ${filters.profitStatus === "loss" ? "selected" : ""}>亏损</option><option value="unknown" ${filters.profitStatus === "unknown" ? "selected" : ""}>无利润数据</option></select>
      <select name="productRelation" aria-label="产品关联筛选"><option value="">全部产品关联</option><option value="linked" ${filters.productRelation === "linked" ? "selected" : ""}>已关联产品</option><option value="unlinked" ${filters.productRelation === "unlinked" ? "selected" : ""}>未关联产品</option></select>
      <select name="skuCount" aria-label="SKU数量筛选"><option value="">全部SKU数量</option><option value="single" ${filters.skuCount === "single" ? "selected" : ""}>单SKU</option><option value="multiple" ${filters.skuCount === "multiple" ? "selected" : ""}>多SKU</option><option value="none" ${filters.skuCount === "none" ? "selected" : ""}>无SKU</option></select>
      <select name="status" aria-label="状态筛选"><option value="">全部状态</option>${["active", "paused", "archived"].map((status) => `<option value="${status}" ${filters.status === status ? "selected" : ""}>${escapeHtml(statusText(status))}</option>`).join("")}</select>
      <label class="connection-history-toggle"><input type="checkbox" name="includeHistorical" value="true" ${filters.includeHistorical ? "checked" : ""} />显示历史/退出经营链接</label>
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

function renderOwnerContribution(cockpit) {
  const owners = cockpit.ownerOperations ?? [];
  const money = (value) => `¥${Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
  return `<section class="connection-owner-contribution"><header><div><strong>负责人经营贡献</strong><span>按当前所选周期销售额排序</span></div></header>${owners.length ? `<div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>负责人</th><th>当前经营Link</th><th>销售额</th><th>毛利</th><th>毛利率</th><th>较上一同长度周期</th><th>风险链接</th></tr></thead><tbody>${owners.slice(0, 20).map((owner) => `<tr><td><strong>${escapeHtml(owner.ownerName)}</strong></td><td>${owner.connectionCount}</td><td>${money(owner.salesAmount)}</td><td>${money(owner.profitAmount)}</td><td>${corePercent(owner.profitMargin)}</td><td>${growthText(owner.averageGrowth)}</td><td>${owner.riskCount}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state compact">暂无负责人经营数据</div>`}</section>`;
}

function renderConnectionAssets() {
  const table = pageState.businessTable;
  const orderedFields = table.fieldOrder.filter((key) => table.visibleFields.includes(key));
  const indicatorHtml = renderUiModule("link_indicator_setting", { groups: LINK_BUSINESS_COLUMN_GROUPS,
    visibleFields: table.visibleFields, fieldOrder: table.fieldOrder, open: table.indicatorOpen });
  const toolbarHtml = renderUiModule("link_business_toolbar", { range: table.range, filters: table.filters,
    options: table.filterOptions, indicatorHtml, dataSources: table.dataSources });
  const tableHtml = renderUiModule("link_business_table", { items: table.items.map((item) => ({ ...item,
    imageUrl: item.mainImage ? resolveAssetUrl(item.mainImage) : "" })), pagination: table.pagination,
    fields: orderedFields, sort: table.sort, loading: table.loading });
  return `<section class="connection-assets company-links-workspace">
    ${renderUiModule("link_data_status", { state: pageState.linkDataStatus })}
    <section class="link-business-analysis"><header><div><h3>全部链接</h3><p>当前经营 ${table.operatingSummary?.operatingCount || 0} · 历史/退出 ${table.operatingSummary?.historicalCount || 0} · 历史总数 ${table.operatingSummary?.historicalAssetCount || 0}</p></div></header>${toolbarHtml}${tableHtml}</section>
  </section>`;
}

function renderOwnerImportUploader() {
  if (!canManage()) return "";
  const people = (state.people ?? []).filter((person) => person.status === "active");
  return `<form data-connection-owner-import-form class="connection-foundation-import-form">
    <label>链接编号表<input type="file" name="file" accept=".xls,.xlsx" required /><small>表格文件仅需一列：链接编号</small></label>
    <label>匹配负责人<select name="ownerId" required><option value="">请选择负责人</option>${people.map((person) => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.name)}</option>`).join("")}</select></label>
    <button type="submit" class="secondary-button" ${pageState.ownerImport.loading ? "disabled" : ""}>${pageState.ownerImport.loading ? "正在解析…" : "上传并检查"}</button>
  </form>`;
}

function renderOwnerImport() {
  if (!canManage()) return "";
  const result = pageState.ownerImport.result; const preview = result?.preview ?? {}; const rows = pageState.ownerImport.detailRows ?? [];
  if (result && preview.parserVersion !== "connection-owner-v4-link-id-owner-selection") return "";
  const statusText = { matched: "已匹配", unmatched: "未匹配", conflict: "冲突", ignored: "已忽略", success: "已更新" };
  const batchStatus = { validated: "待确认", preview_ready: "待确认", completed: "已完成", partial: "部分完成", cancelled: "已取消" };
  const exceptions = rows.filter((row) => row.status !== "matched" && row.status !== "success");
  const skipped = Number(preview.unchangedRows || 0) + Number(preview.unmatchedRows || 0) + Number(preview.conflictRows || 0) + Number(preview.ignoredRows || 0);
  const changeGroups = preview.ownerChangeGroups || [];
  const canSubmit = canManage() && result?.submission?.canSubmit && !pageState.ownerImport.loading;
  if (result && pageState.ownerImport.showCompletion && ["completed", "partial"].includes(result.batch?.status)) {
    const exceptionCount = Number(preview.unmatchedRows || 0) + Number(preview.conflictRows || 0) + Number(preview.ignoredRows || 0);
    return `<section class="connection-owner-completion"><span class="connection-owner-completion-mark">✓</span><h2>负责人匹配完成</h2>${result.batch.status === "partial" ? `<p class="connection-owner-partial-note">部分数据已成功更新。异常数据未更新，可进入异常中心处理。</p>` : `<p>本次负责人匹配已全部完成。</p>`}<div class="connection-owner-change-summary"><span>首次分配<strong>${result.result?.firstAssigned || 0}</strong></span><span>负责人变更<strong>${result.result?.reassigned || 0}</strong></span><span>保持不变<strong>${result.result?.unchanged || 0}</strong></span><span>异常<strong>${exceptionCount}</strong></span></div><footer><button type="button" class="secondary-button" data-view-owner-import-result>查看本次详情</button><button type="button" class="secondary-button" data-return-connection-center>返回链接中心</button><button type="button" class="primary-button" data-continue-owner-import>继续匹配负责人</button></footer></section>`;
  }
  if (!result) return "";
  return `<details class="connection-foundation-panel connection-owner-import" ${result ? "open" : ""}>
    <summary>负责人匹配结果</summary>
    ${result ? `<section class="connection-import-preview"><header><div><h3>本次负责人匹配</h3><p>${escapeHtml(result.batch?.fileName || "负责人匹配表")}</p></div><span class="status-pill">${batchStatus[result.batch?.status] || result.batch?.status}</span></header>
      <div class="connection-owner-change-summary"><span>文件总行数<strong>${preview.totalRows || 0}</strong></span><span>可匹配链接<strong>${preview.updatableLinks || 0}</strong></span><span>首次分配<strong>${preview.firstAssignmentRows || 0}</strong></span><span>负责人变更<strong>${preview.reassignmentRows || 0}</strong></span><span>保持不变<strong>${preview.unchangedRows || 0}</strong></span><span>异常<strong>${Number(preview.unmatchedRows || 0) + Number(preview.conflictRows || 0) + Number(preview.ignoredRows || 0)}</strong></span></div>
      <div class="connection-import-preview-grid"><span>目标负责人<strong>${escapeHtml(preview.selectedOwnerName || "—")}</strong></span><span>可匹配链接<strong>${preview.updatableLinks || 0}</strong></span><span>涉及平台<strong>${preview.platformCount || 0}</strong></span><span>涉及店铺<strong>${preview.shopCount || 0}</strong></span><span>异常行<strong>${Number(preview.unmatchedRows || 0) + Number(preview.conflictRows || 0)}</strong></span><span>不会更新<strong>${skipped}</strong></span></div>
      <div class="connection-owner-detail-actions"><button type="button" class="secondary-button" data-owner-import-detail="changes">查看匹配明细</button><button type="button" class="secondary-button" data-owner-import-detail="errors">查看异常</button></div>
      ${pageState.ownerImport.detailKind ? `<section class="connection-table-wrap"><table class="connection-table"><thead><tr><th>行</th><th>链接ID</th><th>链接标题</th><th>平台</th><th>店铺</th><th>当前负责人</th><th>新负责人</th><th>状态</th><th>说明</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${row.rowNumber}</td><td>${escapeHtml(row.externalKey || row.rawData?.链接ID || "—")}</td><td>${escapeHtml(row.data?.linkTitle || "—")}</td><td>${escapeHtml(row.data?.platform || "—")}</td><td>${escapeHtml(row.data?.shopName || "—")}</td><td>${escapeHtml(row.data?.currentOwnerName || "未分配")}</td><td>${escapeHtml(row.data?.newOwnerName || "—")}</td><td>${escapeHtml(statusText[row.status] || row.status)}</td><td>${escapeHtml(row.errorMessage || "—")}</td></tr>`).join("")}</tbody></table></section>` : ""}
      <section class="connection-owner-change-groups"><h4>匹配变化</h4>${changeGroups.length ? changeGroups.map((group) => `<details><summary><span>${escapeHtml(group.currentOwnerName)} <b>→</b> ${escapeHtml(group.newOwnerName)}</span><strong>${group.linkCount}条链接</strong></summary><ul>${(group.links || []).map((link) => `<li><strong>${escapeHtml(link.title || link.platformGoodsId || "未命名链接")}</strong><span>${escapeHtml(`${link.platform || "—"} · ${link.shop || "—"} · ${link.platformGoodsId || "—"}`)}</span></li>`).join("")}</ul></details>`).join("") : `<p class="form-note">本次没有负责人变化。</p>`}</section>
      <aside class="connection-owner-overwrite-note"><strong>${preview.reassignmentRows ? `其中 ${preview.reassignmentRows} 个链接已有负责人。` : "所选链接均为首次分配负责人。"}</strong><p>${preview.reassignmentRows ? `确认后将变更为「${escapeHtml(preview.selectedOwnerName || "所选负责人")}」，提交前会再次提醒。` : `确认后将直接分配给「${escapeHtml(preview.selectedOwnerName || "所选负责人")}」，无需覆盖提醒。`}</p><small>不会修改：店铺、链接身份、平台SKU、ERP SKU、库存、销售数据。</small></aside>
      ${!["completed", "partial", "cancelled"].includes(result.batch?.status) ? `<footer><button type="button" class="primary-button" data-confirm-owner-import="${escapeHtml(result.batch.id)}" ${canSubmit ? "" : "disabled"}>确认匹配负责人</button>${!canSubmit && preview.parserVersion === "connection-owner-v4-link-id-owner-selection" ? `<button type="button" class="secondary-button" data-rebuild-owner-import="${escapeHtml(result.batch.id)}">重新校验当前预览</button>` : ""}<button type="button" class="secondary-button" data-cancel-owner-import="${escapeHtml(result.batch.id)}">取消本次预览</button>${canSubmit ? "" : `<span class="form-note">${escapeHtml(result?.submission?.reason || "当前用户没有提交权限。")}</span>`}</footer>` : ""}
    </section>` : ""}
  </details>`;
}

function cockpitSalesPeriodText(summary) {
  const start = String(summary.salesPeriodStart || "").slice(0, 10); const end = String(summary.salesPeriodEnd || "").slice(0, 10);
  if (!start || !end) return "暂无已导入 ERP 销售周期";
  const range = start === end ? start : `${start} 至 ${end}`;
  return summary.salesPeriodAligned ? `统计周期 ${range}` : `各链接最新周期 ${range}（共 ${summary.salesPeriodCount || 0} 个周期）`;
}
function renderGoalHealthCockpit() {
  if (pageState.cockpitGoalHealthLoading) return `<section class="cockpit-panel connection-goal-health-cockpit cockpit-module-skeleton" aria-busy="true"><header><div><h3>链接贡献级别概览</h3><span>正在按需读取评级汇总…</span></div></header><div class="cockpit-skeleton-lines"><i></i><i></i><i></i></div></section>`;
  const model = pageState.goalHealth || {}; const grades = model.gradeSummary || {}; const period = model.evaluationPeriod || {};
  const selectedEnd = pageState.cockpitRange.endDate;
  const periodText = period.periodEnd ? `评级周期 ${period.periodStart} 至 ${period.periodEnd} · 每30天固定评级，不随页面日期变化` : "尚未生成贡献评级";
  const gradeItems = ["S","A","B","C","D","N"].map(k=>[k,`${k}级`]);
  return `<section class="cockpit-panel connection-goal-health-cockpit"><header><div><h3>链接贡献级别概览</h3><span>${escapeHtml(periodText)}</span></div><button type="button" class="text-button" data-goal-health-drill="all">进入链接经营管理 →</button></header>
    <div class="connection-goal-health-coverage"><article><span>当前有效链接</span><strong>${model.totalLinks || 0}</strong></article><article><span>已分级</span><strong>${model.evaluatedLinks || 0}</strong></article><article><span>数据缺失/待评级</span><strong>${model.pendingEvaluationLinks || 0}</strong></article></div>
    <div class="connection-goal-grade-summary"><div><strong>链接贡献级别分布</strong><small>仅统计已评级链接 ${model.evaluatedLinks || 0} 条</small></div>${gradeItems.map(([code,label]) => `<button type="button" data-goal-health-drill="grade" data-evaluation-status="${code}" class="goal-grade-${code}"><span>${label}</span><strong>${grades[code] || 0}</strong></button>`).join("")}</div>
    <div class="connection-goal-positioning-summary">${(model.positioningSummary || []).map((item) => `<article><header><strong>${escapeHtml(item.positioningName)}</strong><small>${item.totalLinks || 0} 条 · 已评级 ${item.evaluatedLinks || 0}</small></header><div>${gradeItems.map(([code,label]) => code === "underperforming" ? `<button type="button" data-goal-health-drill="grade" data-positioning="${escapeHtml(item.positioningType)}" data-evaluation-status="${code}"><span>${label}</span><b>${item[code] || 0}</b></button>` : `<span><em>${label}</em><b>${item[code] || 0}</b></span>`).join("")}</div></article>`).join("")}</div>
  </section>`;
}
function renderCockpitGlobalRange() {
  const range = pageState.cockpitRange || {};
  return `<form class="cockpit-global-range" data-cockpit-global-range><div class="cockpit-global-presets">${LINK_TIME_RANGE_OPTIONS.map(({ value, label }) => `<button type="button" data-cockpit-range-preset="${value}" class="${range.preset === value ? "active" : ""}" ${range.loading ? "disabled" : ""}>${label}</button>`).join("")}</div><div class="cockpit-global-dates"><label><span>开始日期</span><input type="date" name="startDate" value="${escapeHtml(range.startDate || "")}" ${range.loading ? "disabled" : ""} /></label><i>→</i><label><span>结束日期</span><input type="date" name="endDate" value="${escapeHtml(range.endDate || "")}" ${range.loading ? "disabled" : ""} /></label></div>${range.loading ? `<small>正在更新全页面经营数据…</small>` : `<small>全页面统一时间范围</small>`}</form>`;
}
function renderCockpitSkeleton() {
  return `<section class="connection-business-cockpit cockpit-loading-shell" aria-busy="true">
    ${renderCockpitGlobalRange()}
    <section class="cockpit-summary cockpit-summary-skeleton">${Array.from({ length: 4 }, () => `<div><span></span><strong></strong><small></small></div>`).join("")}</section>
    <section class="cockpit-panel cockpit-module-skeleton"><header><h3>店铺经营摘要</h3><span>正在读取当前经营事实…</span></header><div class="cockpit-skeleton-lines"><i></i><i></i><i></i></div></section>
  </section>`;
}
function renderCockpitCoreTrend(cockpit) {
  const rows = (cockpit.trends?.erp ?? []).filter((item) => item.periodType === "day").slice(-14);
  return `<section class="cockpit-panel cockpit-core-trend"><header><div><h3>核心经营趋势</h3><span>最近14个ERP经营日</span></div></header><div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>日期</th><th>销售额</th><th>毛利</th><th>毛利率</th></tr></thead><tbody>${rows.map((item) => `<tr><td>${escapeHtml(item.periodEnd || item.periodStart || "—")}</td><td>${coreMoney(item.salesAmount)}</td><td>${coreMoney(item.profitAmount)}</td><td>${corePercent(item.salesAmount ? Number(item.profitAmount || 0) / Number(item.salesAmount) : null)}</td></tr>`).join("") || `<tr><td colspan="4">当前周期暂无ERP趋势数据</td></tr>`}</tbody></table></div></section>`;
}
function shopOperationTrend(shop, summary) {
  if (!summary.previousPeriodComplete) return { className: "stable", text: "上一周期数据不完整，暂不比较" };
  if (!Number(shop.previousSalesAmount || 0)) {
    return Number(shop.salesAmount || 0)
      ? { className: "better", text: "上期无销售" }
      : { className: "stable", text: "与上期持平" };
  }
  const value = Number(shop.salesTrend || 0);
  return { className: value > 0 ? "better" : value < 0 ? "worse" : "stable", text: growthText(value) };
}
function renderShopOperationCard(shop, summary, { className = "", shareLabel = "", shareValue = 0 } = {}) {
  const trend = shopOperationTrend(shop, summary);
  return `<article class="shop-operation-card${className ? ` ${className}` : ""}"><header><strong>${escapeHtml(`${shop.platform} · ${shop.shopName}`)}</strong><span>${shop.totalLinks || 0} 条当前经营 Link</span></header><div class="shop-operation-metrics"><div><span>当前周期销售额</span><strong>${coreMoney(shop.salesAmount)}</strong><small class="is-${trend.className}">${trend.className === "better" ? "↗" : trend.className === "worse" ? "↘" : "→"} ${escapeHtml(trend.text)}</small></div><div><span>当前周期毛利</span><strong>${coreMoney(shop.profitAmount)}</strong><small>毛利率 ${corePercent(shop.profitMargin)}</small></div></div><div class="shop-operation-grades">${[["S",shop.excellentLinks],["A",shop.goodLinks],["B",shop.bLinks],["C",shop.cLinks],["D",shop.underperformingLinks],["N",shop.nLinks]].map(([grade,count])=>`<span><em>${grade}级</em><b>${count||0}</b></span>`).join("")}</div><footer>${shareLabel ? `${escapeHtml(shareLabel)}占比 ${corePercent(shareValue)} · ` : ""}参与评价 ${shop.evaluatedLinks || 0} / 总链接 ${shop.totalLinks || 0}</footer></article>`;
}
function renderShopOperations(cockpit) {
  const shops = cockpit.shopOperations ?? [];
  const summary = cockpit.summary ?? {};
  const period = summary.salesPeriodStart && summary.salesPeriodEnd
    ? `${summary.salesPeriodStart} 至 ${summary.salesPeriodEnd}`
    : "当前暂无销售周期";
  return `<section class="cockpit-panel shop-operations-panel"><header><div><h3>店铺经营</h3><span>${escapeHtml(period)} · 当前有效店铺 ${shops.length} 家</span></div></header>${shops.length
    ? `<div class="shop-operations-grid">${shops.map((shop) => renderShopOperationCard(shop, summary)).join("")}</div>`
    : `<div class="empty-state compact">暂无当前有效店铺</div>`}</section>`;
}

const shopShareColors = ["#157a5b", "#2e90fa", "#f79009", "#7f56d9", "#e04f67", "#0e9384", "#ee46bc", "#6172f3", "#84ad36", "#f04438", "#4e5ba6", "#dc6803"];
function shopSharePoint(ratio, radius = 116) {
  const angle = ratio * Math.PI * 2 - Math.PI / 2;
  return [140 + Math.cos(angle) * radius, 140 + Math.sin(angle) * radius];
}
function shopShareSector(start, end, color, shop, selected) {
  const middleAngle = ((start + end) / 2) * Math.PI * 2 - Math.PI / 2;
  const transform = selected ? `translate(${(Math.cos(middleAngle) * 8).toFixed(3)} ${(Math.sin(middleAngle) * 8).toFixed(3)})` : "";
  const interaction = `class="shop-share-slice${selected ? " is-selected" : ""}" data-shop-share-slice="${escapeHtml(shop.shopId)}" tabindex="0" role="button" aria-label="查看${escapeHtml(shop.shopName || "未命名店铺")}业绩" transform="${transform}"`;
  const title = `<title>${escapeHtml(`${shop.platform} · ${shop.shopName || "未命名店铺"}`)}：销售额 ${coreMoney(shop.salesAmount)}，毛利 ${coreMoney(shop.profitAmount)}</title>`;
  const share = end - start;
  const labelRadius = share >= 0.1 ? 78 : 91;
  const labelSize = share >= 0.1 ? 7.5 : 6.2;
  const [labelX, labelY] = shopSharePoint((start + end) / 2, labelRadius);
  const label = share >= 0.035 ? `<text class="shop-share-label" x="${labelX.toFixed(3)}" y="${labelY.toFixed(3)}" fill="#fff" stroke="#173f34" stroke-opacity="0.58" stroke-width="1.4" paint-order="stroke" font-size="${labelSize}" font-weight="750" text-anchor="middle" dominant-baseline="middle" pointer-events="none">${(share * 100).toFixed(1)}%</text>` : "";
  if (share >= 0.999999) return `<g ${interaction}>${title}<circle cx="140" cy="140" r="116" fill="${color}" />${label}</g>`;
  const [startX, startY] = shopSharePoint(start);
  const [endX, endY] = shopSharePoint(end);
  const largeArc = share > 0.5 ? 1 : 0;
  return `<g ${interaction}>${title}<path d="M 140 140 L ${startX.toFixed(3)} ${startY.toFixed(3)} A 116 116 0 ${largeArc} 1 ${endX.toFixed(3)} ${endY.toFixed(3)} Z" fill="${color}" stroke="#fff" stroke-width="1.5" />${label}</g>`;
}
function renderShopPerformanceShare(cockpit) {
  const metric = pageState.cockpitShopShareMetric === "profitAmount" ? "profitAmount" : "salesAmount";
  const metricLabel = metric === "profitAmount" ? "毛利" : "销售额";
  const shops = [...(cockpit.shopOperations ?? [])]
    .map((shop) => ({ ...shop, metricValue: Number(shop[metric] || 0) }))
    .sort((left, right) => Math.max(0, right.metricValue) - Math.max(0, left.metricValue));
  const shareTotal = shops.reduce((sum, shop) => sum + Math.max(0, shop.metricValue), 0);
  const netTotal = shops.reduce((sum, shop) => sum + shop.metricValue, 0);
  const selectedShop = shops.find((shop) => shop.shopId === pageState.cockpitShopShareSelectedId) ?? null;
  const selectedShare = selectedShop && shareTotal > 0 ? Math.max(0, selectedShop.metricValue) / shareTotal : 0;
  let consumed = 0;
  const sectors = shops.filter((shop) => shop.metricValue > 0).map((shop, index) => {
    const start = shareTotal ? consumed / shareTotal : 0;
    consumed += shop.metricValue;
    const end = shareTotal ? consumed / shareTotal : 0;
    return shopShareSector(start, end, shopShareColors[index % shopShareColors.length], shop, shop.shopId === selectedShop?.shopId);
  });
  return `<section class="cockpit-panel shop-share-panel"><header><div><h3>店铺业绩占比</h3><span>按当前统一时间范围统计${metric === "profitAmount" ? " · 亏损店铺不计入正向占比" : ""}</span></div><div class="segmented-control shop-share-metric-switch">${[["salesAmount","销售额"],["profitAmount","毛利"]].map(([value,label]) => { const active = metric === value; return `<button type="button" data-shop-share-metric="${value}" class="${active ? "active is-selected" : ""}" aria-pressed="${active}">${label}</button>`; }).join("")}</div></header>${shops.length && shareTotal > 0
    ? `<div class="shop-share-content"><div class="shop-share-visual"><svg class="shop-share-pie" width="560" height="560" viewBox="0 0 280 280" role="img" aria-label="各店铺${metricLabel}占比">${sectors.join("")}</svg><div><span>${escapeHtml(metricLabel)}合计</span><strong>${coreMoney(netTotal)}</strong></div></div>${selectedShop ? renderShopOperationCard(selectedShop, cockpit.summary ?? {}, { className: "shop-share-selected-card", shareLabel: metricLabel, shareValue: selectedShare }) : `<div class="shop-share-selection-hint">点击饼图扇区查看店铺经营卡片</div>`}</div>`
    : `<div class="empty-state compact">当前周期暂无可展示的${escapeHtml(metricLabel)}数据</div>`}</section>`;
}

function renderBusinessCockpit() {
  const renderStartedAt = performance.now(); const moduleTimings = {};
  const measured = (name, callback) => { const startedAt = performance.now(); const value = callback(); moduleTimings[name] = Number((performance.now() - startedAt).toFixed(1)); return value; };
  const cockpit=pageState.cockpit; const summary=cockpit.summary??{}; const ratings=cockpit.ratingSummary??{};
  const totalRatings=Number(ratings.excellentOrGood||0)+Number(ratings.onTarget||0)+Number(ratings.underperforming||0)+Number(ratings.notEvaluated||0);
  const ratingRate=(value)=>totalRatings?`${(Number(value||0)/totalRatings*100).toFixed(1)}%`:"—";
  const linkCard=(item,extra="")=>`<button type="button" class="connection-cockpit-link" data-open-connection="${escapeHtml(item.id)}">${imageHtml(item)}<span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(`${item.platform} · ${item.shopName}`)}</small><em>销售 ${coreMoney(item.erpSales?.salesAmount)} · 利润 ${coreMoney(item.erpSales?.profitAmount)} · 利润率 ${corePercent(item.erpSales?.profitMargin)}</em><i>${escapeHtml(extra||growthText(item.salesGrowth))}</i></span></button>`;
  const trendRows=[...(cockpit.trends?.erp??[]).map((item)=>({...item,visitorCount:null,source:"ERP"})),...(cockpit.trends?.platform??[]).map((item)=>({...item,salesAmount:null,profitAmount:null,source:"平台"}))].filter((item)=>item.periodType===cockpit.periodType).sort((a,b)=>String(a.periodEnd).localeCompare(String(b.periodEnd))||a.source.localeCompare(b.source));
  const salesPeriodText = cockpitSalesPeriodText(summary);
  const windowDays = Number(summary.salesWindowDays || 0);
  const rangeHtml = measured("range", renderCockpitGlobalRange);
  const shopHtml = measured("shops", () => renderShopOperations(cockpit));
  const coreTrendHtml = measured("coreTrend", () => renderCockpitCoreTrend(cockpit));
  const goalHtml = measured("goalHealth", renderGoalHealthCockpit);
  const distributionHtml = measured("salesDistribution", () => renderUiModule("link_sales_distribution", { state: pageState.salesDistribution, canViewCompany: isAdmin(), globalRange: pageState.cockpitRange }));
  const html = `<section class="connection-business-cockpit">
    ${rangeHtml}
    <section class="cockpit-summary"><div><span>当前经营 Link</span><strong>${summary.connectionCount||0}</strong><small>当前资产口径，不随日期变化</small></div><div class="is-sales"><span>当前周期ERP销售额</span><strong>${coreMoney(summary.salesAmount)}</strong><small>${escapeHtml(salesPeriodText)}</small><small>${summary.previousPeriodComplete ? `较上一同长度周期 ${growthText(summary.salesGrowth)}` : `上一同长度周期数据仅${summary.previousPeriodDateCount||0}/${windowDays}天，暂不比较`}</small></div><div><span>当前周期毛利</span><strong>${coreMoney(summary.profitAmount)}</strong><small>毛利率 ${corePercent(summary.profitMargin)}</small></div><div class="is-risk"><span>需要关注</span><strong>${summary.riskCount||0}</strong><small>按所选周期经营变化识别</small></div></section>
    ${shopHtml}
    ${coreTrendHtml}
    <section class="cockpit-health"><header><h3>链接贡献级别分布</h3><span>最近一次公司统一评级</span></header><div>${["S","A","B","C","D","N"].map(k=>`<span>${k}级 <b>${ratings[k]||0}</b></span>`).join("")}<span>数据错误/待评级 <b>${ratings.notEvaluated||0}</b></span></div></section>
    ${goalHtml}
    ${distributionHtml}
    ${pageState.cockpitExpanded ? `
      ${renderOwnerContribution(cockpit)}
      <div class="cockpit-two-columns"><section class="cockpit-panel"><header><h3>核心链接</h3><span>按ERP销售额、利润排序</span></header>${cockpit.coreLinks?.length?cockpit.coreLinks.slice(0,20).map((item)=>linkCard(item,`销量 ${coreNumber(item.erpSales?.shippedQuantity)}`)).join(""):`<div class="empty-state compact">暂无ERP销售事实</div>`}</section>${renderShopPerformanceShare(cockpit)}</div>
      <section class="cockpit-panel"><header><h3>增长链接</h3></header><div class="cockpit-growth-grid">${cockpit.growthLinks?.length?cockpit.growthLinks.slice(0,20).map((item)=>linkCard(item,`最快增长 ${growthText(item.growthMetric)}`)).join(""):`<div class="empty-state compact">尚无可比较的增长链接</div>`}</div></section>
      <section class="cockpit-panel"><header><h3>平台渠道分析</h3><span>ERP销售和利润按平台汇总</span></header><div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>平台</th><th>链接数</th><th>销售额</th><th>利润</th><th>利润率</th><th>优秀/良好率</th></tr></thead><tbody>${cockpit.platforms?.map((item)=>`<tr><td><strong>${escapeHtml(item.platform)}</strong></td><td>${item.connectionCount}</td><td>${coreMoney(item.salesAmount)}</td><td>${coreMoney(item.profitAmount)}</td><td>${corePercent(item.profitMargin)}</td><td>${corePercent(item.excellentOrGoodRate)}</td></tr>`).join("")||`<tr><td colspan="6">暂无平台经营事实</td></tr>`}</tbody></table></div></section>
      <section class="cockpit-panel"><header><h3>产品直接销售渠道</h3><span>仅Single直接销售额；Bundle金额不分摊</span></header>${pageState.cockpitProductChannels.loading ? `<div class="empty-state compact">正在按需读取产品渠道分析…</div>` : pageState.cockpitProductChannels.error ? `<div class="form-error">${escapeHtml(pageState.cockpitProductChannels.error)}</div>` : `<div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>产品编码</th><th>产品</th><th>平台</th><th>链接数</th><th>直接销售额</th><th>占产品直接销售</th></tr></thead><tbody>${cockpit.productChannels?.slice(0,50).map((item)=>`<tr><td><a href="#products/${encodeURIComponent(item.productId)}">${escapeHtml(item.skuCode)}</a></td><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.platform)}</td><td>${item.linkCount}</td><td>${coreMoney(item.directSalesAmount)}</td><td>${corePercent(item.contribution)}</td></tr>`).join("")||`<tr><td colspan="6">暂无产品直接销售事实</td></tr>`}</tbody></table></div>`}</section>
      <section class="cockpit-panel"><header><div><h3>经营趋势</h3><span>ERP销售/利润与平台流量分开呈现</span></div><div class="segmented-control">${[["day","日"],["week","周"],["month","月"]].map(([id,label])=>`<button type="button" data-cockpit-period="${id}" class="${cockpit.periodType===id?"active":""}">${label}</button>`).join("")}</div></header><div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>周期</th><th>来源</th><th>销售额</th><th>利润</th><th>访客</th></tr></thead><tbody>${trendRows.slice(-90).map((item)=>`<tr><td>${escapeHtml(`${item.periodStart} ~ ${item.periodEnd}`)}</td><td>${item.source}</td><td>${item.salesAmount==null?"—":coreMoney(item.salesAmount)}</td><td>${item.profitAmount==null?"—":coreMoney(item.profitAmount)}</td><td>${item.visitorCount==null?"—":coreNumber(item.visitorCount)}</td></tr>`).join("")||`<tr><td colspan="5">当前粒度暂无趋势数据</td></tr>`}</tbody></table></div></section>
      <button class="secondary-button" type="button" data-collapse-cockpit>收起扩展分析</button>
    ` : `<section class="cockpit-panel cockpit-lazy-entry"><button class="primary-button" type="button" data-expand-cockpit>展开负责人、核心链接、渠道与趋势分析</button><p>首屏只渲染当前核心经营判断，扩展分析按需生成。</p></section>`}
  </section>`;
  recordCockpitPerformance("render", { totalMs: Number((performance.now() - renderStartedAt).toFixed(1)), modules: moduleTimings, expanded: pageState.cockpitExpanded, htmlBytes: new TextEncoder().encode(html).byteLength });
  return html;
}

function renderList() {
  if (!pageState.items.length) return `<div class="empty-state"><strong>还没有链接</strong><p>请在数据更新中上传平台货品表，建立第一条链接。</p></div>`;
  const filters = pageState.listFilters;
  const items = [...pageState.items];
  const valueForColumn = (item, key) => ({
    name: item.name || "", platform: item.platform || "", shop: shopName(item), goodsId: item.platformGoodsId || "", erpSales: Number(item.erpSales?.salesAmount || 0), erpProfit: Number(item.erpSales?.profitAmount || 0), relations: Number(item.skuCount || 0), products: productCodes(item),
    period: item.latestPeriodEnd || "", payAmount: Number(item.latestPayAmount || 0), growth: item.salesGrowth == null ? -Infinity : Number(item.salesGrowth),
    profit: Number(item.currentFinance?.netProfit || 0), origin: originText(item.originSource), owner: connectionOwnerName(item), status: statusText(item.status),
  })[key];
  const compareValues = (left, right) => typeof left === "number" || typeof right === "number"
    ? Number(left) - Number(right) : String(left).localeCompare(String(right), "zh-CN", { numeric: true });
  if (!items.length) return `<div class="empty-state"><strong>没有符合条件的连接</strong><p>请调整店铺、产品编码、负责人或状态筛选。</p></div>`;
  if (pageState.view === "cards") {
    return `<div class="connection-card-grid">${items.map((item) => { const anomalies = connectionAnomalies(item); const trend = trendLabel(item); return `<article class="connection-card ${anomalies.length ? "has-anomaly" : ""}"><button type="button" class="connection-card-main" data-open-connection="${escapeHtml(item.id)}">${imageHtml(item)}<span class="connection-card-body"><strong class="connection-card-title">${escapeHtml(item.name)}</strong><small class="connection-card-identity">${escapeHtml(`${item.platform} · ${shopName(item)}`)}</small><span class="connection-v3-card-metrics"><em>销售额 <b>${coreMoney(item.erpSales?.salesAmount)}</b></em><em>利润 <b>${coreMoney(item.erpSales?.profitAmount)}</b></em><em>利润率 <b>${corePercent(item.erpSales?.profitMargin)}</b></em></span><span class="connection-card-state"><em class="connection-trend-pill is-${trend.className}">${trend.className === "better" ? "↗" : trend.className === "worse" ? "↘" : "→"} ${growthText(item.salesGrowth)}</em></span><span class="connection-card-owner">负责人 ${escapeHtml(connectionOwnerName(item))}</span></span></button>${anomalies.length ? `<footer><span>⚠ ${escapeHtml(anomalies.map((problem) => problem.title).join("、"))}</span></footer>` : ""}</article>`; }).join("")}</div>${renderConnectionPagination()}`;
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
    growth: growthText(item.salesGrowth),
    profit: item.currentFinance == null ? "—" : `¥${Number(item.currentFinance.netProfit || 0).toLocaleString("zh-CN")}`,
    origin: escapeHtml(originText(item.originSource)), owner: escapeHtml(connectionOwnerName(item)), status: `<span class="status-pill status-${escapeHtml(item.status)}">${escapeHtml(statusText(item.status))}</span>`,
  })[key];
  return `<div class="connection-table-wrap"><table class="connection-table"><thead><tr>${header}</tr></thead><tbody>${items.map((item) => `<tr tabindex="0" data-open-connection="${escapeHtml(item.id)}">${listColumns.filter((column) => visible.has(column.key)).map((column) => `<td>${cell(item, column.key)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>${renderConnectionPagination()}`;
}

function renderConnectionPagination() {
  const pagination = pageState.pagination;
  return `<nav class="pagination" aria-label="全部链接分页"><button type="button" class="secondary-button" data-connection-page="${pagination.page - 1}" ${pagination.page <= 1 ? "disabled" : ""}>上一页</button><span>第 ${pagination.page} / ${pagination.totalPages} 页 · 共 ${pagination.total} 条</span><button type="button" class="secondary-button" data-connection-page="${pagination.page + 1}" ${pagination.page >= pagination.totalPages ? "disabled" : ""}>下一页</button></nav>`;
}

function renderActions(item) {
  return `<div class="connection-actions-panel">
    ${canManage() ? `<form class="connection-action-form" data-connection-action-form>
      <input name="title" required maxlength="120" placeholder="新增经营动作" />
      <select name="ownerId"><option value="">未设置负责人</option>${(state.people ?? []).filter((person) => person.status === "active").map((person) => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.name)}</option>`).join("")}</select>
      <input name="dueDate" type="date" />
      <button class="primary-button" type="submit">新增</button>
    </form>` : ""}
    <div class="connection-action-list">${pageState.actions.length ? pageState.actions.map((action) => `<article class="connection-action-item"><div><strong>${escapeHtml(action.title)}</strong><p>${escapeHtml(personName(action.ownerId))}${action.dueDate ? ` · ${escapeHtml(action.dueDate)}` : ""}</p></div><div>${canManage() ? `<select data-connection-action-status="${escapeHtml(action.id)}">${[["pending","待处理"],["in_progress","进行中"],["completed","已完成"],["canceled","已取消"]].map(([value,label]) => `<option value="${value}" ${action.status === value ? "selected" : ""}>${label}</option>`).join("")}</select>` : `<span class="status-pill status-${escapeHtml(action.status)}">${escapeHtml(statusText(action.status))}</span>`}${canManage() ? `<button class="text-button danger" type="button" data-delete-connection-action="${escapeHtml(action.id)}">删除</button>` : ""}</div></article>`).join("") : `<div class="empty-state compact">暂无经营动作</div>`}</div>
  </div>`;
}

function coreMoney(value) { return value === null || value === undefined ? "—" : `¥${Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`; }
function coreNumber(value) { return value === null || value === undefined ? "—" : Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 }); }
function corePercent(value) { return value === null || value === undefined ? "—" : `${(Number(value) * 100).toFixed(2)}%`; }
function renderCoreBasic(item, core) {
  const sales = core?.salesOverview ?? item.erpSales ?? {};
  const anomalies = connectionAnomalies(item);
  const skuCodes = [...new Set((core?.skuSales ?? []).map((row) => row.skuCode).filter(Boolean))];
  return `<section class="connection-v3-basic"><h3>链接概况</h3><dl><div><dt>负责人</dt><dd>${escapeHtml(connectionOwnerName(item))}</dd></div><div><dt>商品链接</dt><dd>${item.canonicalUrl ? `<a href="${escapeHtml(item.canonicalUrl)}" target="_blank" rel="noopener noreferrer">打开平台商品</a>` : "—"}</dd></div></dl><section class="connection-v3-metrics"><div><span>销售额</span><strong>${coreMoney(sales.salesAmount)}</strong></div><div><span>利润</span><strong>${coreMoney(sales.profitAmount)}</strong></div><div><span>利润率</span><strong>${corePercent(sales.profitMargin)}</strong></div><div><span>销售趋势</span><strong>${growthText(item.salesGrowth)}</strong></div></section><section class="connection-current-problems"><h3>当前问题</h3>${anomalies.length ? `<div class="connection-health-list">${anomalies.map((problem) => `<article><strong>${escapeHtml(problem.title)}</strong><span>${escapeHtml(problem.value || "需要关注")}</span></article>`).join("")}</div>` : `<div class="empty-state compact">当前未发现经营异常</div>`}</section>${canManage() ? `<form class="connection-action-form" data-connection-profile-form><label>连接名称<input name="name" value="${escapeHtml(item.name)}" required maxlength="120" /></label><label>负责人<select name="ownerId"><option value="">未设置</option>${(state.people ?? []).filter((person) => person.status === "active").map((person) => `<option value="${escapeHtml(person.id)}" ${item.ownerId === person.id ? "selected" : ""}>${escapeHtml(person.name)}</option>`).join("")}</select></label><button type="submit" class="secondary-button">保存档案</button></form>` : ""}<details class="connection-technical-details"><summary>更多信息</summary><dl><div><dt>商品ID</dt><dd>${escapeHtml(item.platformGoodsId || "—")}</dd></div><div><dt>SKU编码</dt><dd>${escapeHtml(skuCodes.join("、") || "—")}</dd></div><div><dt>数据来源</dt><dd>${escapeHtml(originText(item.originSource))}</dd></div><div><dt>识别时间</dt><dd>${escapeHtml(item.identifiedAt || item.createdAt || "—")}</dd></div><div><dt>最近数据日期</dt><dd>${escapeHtml(item.latestPeriodEnd || "—")}</dd></div></dl></details></section>`;
}
function renderCoreOperatingOverview(item, core) {
  const sales = core?.salesOverview ?? item.erpSales ?? {};
  return `<section class="connection-v3-panel"><h3>经营概览</h3><p>核心经营指标来自 ERP 真实销售事实。</p><div class="connection-v3-metrics"><div><span>发货销量</span><strong>${coreNumber(sales.shippedQuantity)}</strong></div><div><span>销售金额</span><strong>${coreMoney(sales.salesAmount)}</strong></div><div><span>成本</span><strong>${coreMoney(sales.costAmount)}</strong></div><div><span>利润</span><strong>${coreMoney(sales.profitAmount)}</strong></div><div><span>利润率</span><strong>${corePercent(sales.profitMargin)}</strong></div></div><small>${sales.periodStart ? escapeHtml(`${sales.periodStart} 至 ${sales.periodEnd}`) : "暂无ERP销售周期"}</small></section>`;
}

function goalMetric(plan, code) { return plan?.metrics?.find((metric) => metric.metricCode === code) ?? null; }
function currentGoalMonth() {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}
function goalModeText(mode) { return ({ system_suggested: "系统建议", manual: "人工设置", hybrid: "人工调整" })[mode] || mode || "—"; }
function goalStatusText(status) { return ({ draft: "待人工设置", pending_confirm: "待确认", active: "生效中", expired: "已到期", cancelled: "已取消" })[status] || status || "—"; }
function goalGradeText(grade) { return ["S","A","B","C","D","N"].includes(grade)?`${grade}级`:"—"; }
function renderConnectionGoalEvaluation(core) {
 const r=core?.businessGoalEvaluation;
 if(!r)return `<div class="empty-state compact">正在读取贡献评级…</div>`;
 if(!r.grade)return `<div class="empty-state compact">${escapeHtml(r.reason||r.loadError||"评级数据缺失")}</div>`;
 return `<div class="connection-positioning-summary"><div><span>贡献级别</span><strong>${escapeHtml(r.grade)}级</strong></div><div><span>评级周期</span><strong>${escapeHtml(`${r.periodStart} 至 ${r.periodEnd}`)}</strong></div><div><span>利润</span><strong>${coreMoney(r.profitAmount)}</strong></div><div><span>公司利润排名</span><strong>${r.companyRank||"—"}</strong></div></div>`;
}
function renderConnectionBusinessGoals(core) {
  const model = core?.businessGoals;
  if (!model) return `<section class="connection-v3-panel connection-positioning-panel"><h3>经营目标</h3><div class="empty-state compact">正在读取经营目标…</div></section>`;
  if (model.loadError) return `<section class="connection-v3-panel connection-positioning-panel"><h3>经营目标</h3><div class="empty-state compact">${escapeHtml(model.loadError)}<button type="button" class="secondary-button" data-retry-connection-goal-module="businessGoals">重试</button></div></section>`;
  const current = model.current;
  const awaiting = model.awaitingConfirmation;
  const history = model.history ?? [];
  const sales = goalMetric(current, "sales_amount");
  const profit = goalMetric(current, "profit_amount");
  const pendingSales = goalMetric(awaiting, "sales_amount");
  const pendingProfit = goalMetric(awaiting, "profit_amount");
  const pendingMarginPercent = awaiting?.suggestedProfitMargin === null || awaiting?.suggestedProfitMargin === undefined ? "" : (Number(awaiting.suggestedProfitMargin) * 100).toFixed(2);
  const targetMonth = awaiting?.targetMonth || currentGoalMonth();
  const period = current?.effectiveFrom ? `${current.effectiveFrom.slice(0, 10)} 至 ${current.effectiveTo.slice(0, 10)}` : "近30天";
  return `<section class="connection-v3-panel connection-positioning-panel"><header><div><h3>经营目标</h3><p>按自然月设置；建议来自最近完整30天销售事实。</p></div>${current ? `<span class="status-pill status-active">生效中</span>` : awaiting ? `<span class="status-pill">${escapeHtml(goalStatusText(awaiting.status))}</span>` : ""}</header>
    ${current ? `<div class="connection-positioning-summary"><div><span>目标月份</span><strong>${escapeHtml(current.targetMonth || period)}</strong></div><div><span>销售目标</span><strong>${coreMoney(sales?.finalTargetValue)}</strong></div><div><span>目标毛利率</span><strong>${corePercent(current.finalProfitMargin)}</strong></div><div><span>利润目标</span><strong>${coreMoney(profit?.finalTargetValue)}</strong></div><div><span>目标来源</span><strong>${escapeHtml(goalModeText(current.targetMode))}</strong></div></div>` : ""}
    ${renderConnectionGoalEvaluation(core)}
    ${awaiting ? `<div class="connection-goal-pending"><div class="connection-positioning-summary"><div><span>状态</span><strong>${escapeHtml(goalStatusText(awaiting.status))}</strong></div><div><span>系统建议销售</span><strong>${coreMoney(pendingSales?.suggestedTargetValue)}</strong></div><div><span>建议毛利率</span><strong>${corePercent(awaiting.suggestedProfitMargin)}</strong></div><div><span>系统建议利润</span><strong>${coreMoney(pendingProfit?.suggestedTargetValue)}</strong></div><div><span>基准周期</span><strong>${awaiting.baselineStart ? escapeHtml(`${awaiting.baselineStart} 至 ${awaiting.baselineEnd}`) : "数据不足30天"}</strong></div></div>
      ${model.permissions?.canEdit ? `<form class="connection-positioning-form connection-goal-confirm-form" data-connection-goal-confirm-form data-plan-id="${escapeHtml(awaiting.id)}"><label>目标月份<input name="targetMonth" type="month" required value="${escapeHtml(targetMonth)}" /></label><label>销售目标<input name="salesAmount" type="number" min="0" step="0.01" required value="${pendingSales?.suggestedTargetValue ?? ""}" /></label><label>目标毛利率<input name="profitMargin" type="number" min="-100" max="100" step="0.01" required value="${escapeHtml(pendingMarginPercent)}" /><small>%</small></label><label>利润目标<input name="profitAmount" data-goal-profit-target type="number" step="0.01" readonly value="${pendingProfit?.suggestedTargetValue ?? ""}" /></label><button type="submit" class="primary-button">确认并生效</button></form>` : `<p class="form-note">等待管理员或当前链接负责人确认。</p>`}</div>` : ""}
    ${!awaiting && model.permissions?.canEdit ? `<button type="button" class="secondary-button" data-create-connection-goal>生成目标建议</button>` : !current && !awaiting ? `<div class="empty-state compact">当前没有目标计划</div>` : ""}
    ${history.length ? `<details class="connection-positioning-history"><summary>目标历史（${history.length}）</summary><div class="connection-template-list">${history.map((plan) => `<article><div><strong>${escapeHtml(`${plan.positioningName} · ${goalStatusText(plan.status)}`)}</strong><span>${escapeHtml(`${plan.targetMonth || "历史周期"} · ${plan.templateName} V${plan.templateVersion} · ${goalModeText(plan.targetMode)}`)}</span><small>销售 ${coreMoney(goalMetric(plan, "sales_amount")?.finalTargetValue ?? goalMetric(plan, "sales_amount")?.suggestedTargetValue)} · 毛利率 ${corePercent(plan.finalProfitMargin ?? plan.suggestedProfitMargin)} · 利润 ${coreMoney(goalMetric(plan, "profit_amount")?.finalTargetValue ?? goalMetric(plan, "profit_amount")?.suggestedTargetValue)}${plan.approvalReason ? ` · ${escapeHtml(plan.approvalReason)}` : ""}</small></div></article>`).join("")}</div></details>` : ""}
  </section>`;
}
function renderCorePlatform(core) {
  const platform = core?.platformPerformance;
  return `<section class="connection-v3-panel"><h3>平台表现</h3>${platform ? `<div class="connection-v3-metrics"><div><span>访客</span><strong>${coreNumber(platform.visitorCount)}</strong></div><div><span>浏览</span><strong>${coreNumber(platform.viewCount)}</strong></div><div><span>点击</span><strong>${coreNumber(platform.metrics?.clickCount)}</strong></div><div><span>收藏</span><strong>${coreNumber(platform.metrics?.favoriteCount)}</strong></div><div><span>加购</span><strong>${coreNumber(platform.cartCount)}</strong></div><div><span>转化率</span><strong>${corePercent(platform.conversionRate)}</strong></div></div>` : `<div class="empty-state compact">暂无平台经营数据</div>`}</section>`;
}
function renderErpSales(core) {
  const rows = (core?.erpTrend ?? []).filter((item) => item.periodType === pageState.salesPeriodType);
  return `<section class="connection-v3-panel"><header><div><h3>ERP真实销售趋势</h3><p>按已导入周期展示发货、销售与利润，不与平台表现混用。</p></div><div class="segmented-control">${[["day","日"],["week","周"],["month","月"]].map(([id,label]) => `<button type="button" data-sales-period-type="${id}" class="${pageState.salesPeriodType===id?"active":""}">${label}</button>`).join("")}</div></header>${rows.length ? `<div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>周期</th><th>发货销量</th><th>销售金额</th><th>成本</th><th>利润</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(`${row.periodStart} ~ ${row.periodEnd}`)}</td><td>${coreNumber(row.shippedQuantity)}</td><td>${coreMoney(row.salesAmount)}</td><td>${coreMoney(row.costAmount)}</td><td>${coreMoney(row.profitAmount)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state">暂无${({day:"日",week:"周",month:"月"})[pageState.salesPeriodType]}粒度ERP销售数据</div>`}</section>`;
}
function renderSkuSales(core) { const rows=core?.skuSales??[]; return `<section class="connection-v3-panel"><h3>SKU销售分析</h3>${rows.length?`<div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>SKU编码</th><th>SKU名称</th><th>ERP组成</th><th>所属产品</th><th>销量</th><th>销售额</th><th>销售占比</th></tr></thead><tbody>${rows.map((row)=>{const erp=(row.erpRelations??[]).map((item)=>`${item.merchantSkuCode||item.erpSkuId}${Number(item.quantity||1)!==1?` ×${coreNumber(item.quantity)}`:""}`).join("、");const products=(row.products??[]).map((item)=>`${item.skuCode||""}${item.name?` · ${item.name}`:""}`).join("、");return `<tr><td><strong>${escapeHtml(row.skuCode)}</strong></td><td>${escapeHtml(row.skuName)}</td><td>${escapeHtml(erp||(row.relationStatus==="pending"?"关系待治理":row.relationStatus==="conflict"?"关系冲突":"未建立V2关系"))}</td><td>${escapeHtml(products||"未关联产品")}</td><td>${coreNumber(row.shippedQuantity)}</td><td>${coreMoney(row.salesAmount)}</td><td>${corePercent(row.salesShare)}</td></tr>`;}).join("")}</tbody></table></div>`:`<div class="empty-state">暂无SKU真实销售数据</div>`}</section>`; }
function renderCoreProducts(core) { const rows=core?.products??[]; return `<section class="connection-v3-panel"><h3>关联产品</h3>${rows.length?`<div class="connection-v3-product-grid">${rows.map((product)=>`<a href="#products/${encodeURIComponent(product.id)}">${product.mainImage?`<img src="${escapeHtml(resolveAssetUrl(product.mainImage))}" alt="" />`:`<span class="connection-cover-empty">无图</span>`}<strong>${escapeHtml(product.name)}</strong><span>产品编码 ${escapeHtml(product.skuCode)}</span><small>${product.skuCount} 个关联SKU</small></a>`).join("")}</div>`:`<div class="empty-state">当前链接未关联产品</div>`}</section>`; }
function renderInventory(core) { const rows=core?.inventory??[]; const risk={out:"缺货",low:"库存偏低",high:"库存偏高",normal:"正常"}; return `<section class="connection-v3-panel"><h3>库存供应</h3>${rows.length?`<div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>SKU</th><th>产品</th><th>当前库存</th><th>可售库存</th><th>销售速度</th><th>库存天数</th><th>风险</th></tr></thead><tbody>${rows.map((row)=>`<tr><td><strong>${escapeHtml(row.skuCode)}</strong><small>${escapeHtml(row.specificationName||"")}</small></td><td>${escapeHtml(row.productName||"未关联产品")}</td><td>${coreNumber(row.currentStock)}</td><td>${coreNumber(row.availableStock)}</td><td>${coreNumber(row.salesVelocity)}</td><td>${row.stockDays==null?"—":`${Number(row.stockDays).toFixed(1)}天`}</td><td><span class="status-pill stock-${row.stockRisk}">${risk[row.stockRisk]}</span></td></tr>`).join("")}</tbody></table></div>`:`<div class="empty-state">暂无关联SKU库存事实</div>`}</section>`; }

function renderConnectionOperationBar(item) {
  const anomalies = connectionAnomalies(item);
  const followed = item.followed || pageState.myWorkbench.items.some((entry) => entry.id === item.id && entry.followed);
  return `<section class="connection-operation-bar"><div><span>当前运营状态</span><strong>${followed ? "关注" : "正常"}</strong><small>${anomalies.length ? escapeHtml(anomalies.map((problem) => problem.title).join("、")) : "当前无已识别异常"}</small></div></section>`;
}

function inspectionDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}

function renderInspectionGradeSummary(inspection) {
  return `<div class="connection-inspection-grades">${["A", "B", "C", "D"].map((grade) => `<div class="grade-${grade.toLowerCase()}"><span>${grade}</span><strong>${Number(inspection?.[`grade${grade}Count`] || 0)}</strong><small>项</small></div>`).join("")}</div>`;
}

function groupInspectionResults(results = []) {
  const groups = [];
  for (const result of results) {
    let group = groups.find((item) => item.code === result.itemCode);
    if (!group) { group = { code: result.itemCode, name: result.itemNameSnapshot, description: result.itemDescriptionSnapshot, sortOrder: result.itemSortOrder, results: [] }; groups.push(group); }
    group.results.push(result);
  }
  return groups.sort((left, right) => left.sortOrder - right.sortOrder);
}

function renderInspectionResults(inspection, editable = false) {
  return `<div class="connection-inspection-groups">${groupInspectionResults(inspection?.results).map((group) => `<section><header><div><h4>${escapeHtml(group.name)}</h4><p>${escapeHtml(group.description)}</p></div></header>${group.results.map((result) => `<div class="connection-inspection-criterion"><div><strong>${escapeHtml(result.criterionNameSnapshot)}</strong>${result.criterionDescriptionSnapshot ? `<small>${escapeHtml(result.criterionDescriptionSnapshot)}</small>` : ""}</div>${editable ? `<fieldset aria-label="${escapeHtml(result.criterionNameSnapshot)}评分">${["A", "B", "C", "D"].map((grade) => `<label class="grade-${grade.toLowerCase()}"><input type="radio" name="grade-${escapeHtml(result.id)}" value="${grade}" ${result.grade === grade ? "checked" : ""} /><span>${grade}</span></label>`).join("")}</fieldset><textarea name="note-${escapeHtml(result.id)}" rows="2" placeholder="备注（选填）">${escapeHtml(result.note || "")}</textarea>` : `<span class="inspection-grade grade-${escapeHtml(String(result.grade || "").toLowerCase())}">${escapeHtml(result.grade || "未评分")}</span><p>${escapeHtml(result.note || "无备注")}</p>`}</div>`).join("")}</section>`).join("")}</div>`;
}

function renderConnectionInspection(item) {
  const stateModel = pageState.inspection;
  if (stateModel.loading) return `<section class="connection-v3-panel connection-inspection-panel"><h3>链接体检</h3><div class="empty-state compact">正在读取链接体检…</div></section>`;
  if (stateModel.error) return `<section class="connection-v3-panel connection-inspection-panel"><h3>链接体检</h3><div class="empty-state compact">${escapeHtml(stateModel.error)}</div></section>`;
  const data = stateModel.data || {};
  const active = stateModel.active;
  if (stateModel.mode === "edit" && active) return `<section class="connection-v3-panel connection-inspection-panel"><header><div><h3>链接体检</h3><p>${escapeHtml(active.templateVersion)} · 10个项目 · 30个核心标准</p></div><button type="button" class="text-button" data-inspection-cancel>返回概览</button></header><form data-connection-inspection-form data-inspection-id="${escapeHtml(active.id)}">${renderInspectionResults(active, true)}<footer class="connection-inspection-form-actions"><button type="button" class="secondary-button" data-inspection-save-draft>保存草稿</button><button type="button" class="primary-button" data-inspection-complete>完成体检</button></footer></form></section>`;
  if (stateModel.historyDetail) return `<section class="connection-v3-panel connection-inspection-panel"><header><div><h3>历史体检</h3><p>${escapeHtml(`${inspectionDate(stateModel.historyDetail.completedAt)} · ${stateModel.historyDetail.inspectorName} · ${stateModel.historyDetail.templateVersion}`)}</p></div><button type="button" class="text-button" data-inspection-history-back>返回概览</button></header>${renderInspectionGradeSummary(stateModel.historyDetail)}${renderInspectionResults(stateModel.historyDetail, false)}</section>`;
  const latest = data.latest;
  const schedule = data.schedule;
  const issues = latest?.issues || [];
  const selected = stateModel.selectedIssues;
  return `<section class="connection-v3-panel connection-inspection-panel"><header><div><h3>链接体检</h3><p>基础建设质量评价，与经营目标评级相互独立。</p></div><div>${canManage() ? `<button type="button" class="primary-button" data-inspection-start>${data.draft ? "继续体检" : "开始体检"}</button>` : ""}<button type="button" class="secondary-button" data-inspection-history-toggle>历史体检</button><button type="button" class="secondary-button" data-inspection-schedule-toggle>定期体检</button></div></header>
    ${latest ? `<div class="connection-inspection-overview">${renderInspectionGradeSummary(latest)}<dl><div><dt>最近体检</dt><dd>${escapeHtml(inspectionDate(latest.completedAt))}</dd></div><div><dt>体检人</dt><dd>${escapeHtml(latest.inspectorName)}</dd></div><div><dt>下次体检</dt><dd>${escapeHtml(schedule?.nextInspectionAt || "未设置")}</dd></div><div><dt>待优化问题</dt><dd>${Number(data.pendingIssueCount || 0)}</dd></div></dl></div>` : `<div class="empty-state compact">尚未完成链接体检</div>`}
    <div class="connection-inspection-schedule" ${stateModel.mode === "schedule" ? "" : "hidden"}><form data-inspection-schedule-form><label>周期<select name="cadenceType"><option value="manual" ${!schedule?.enabled ? "selected" : ""}>不定期</option><option value="days_30" ${schedule?.cadenceType === "days_30" ? "selected" : ""}>每30天</option><option value="days_60" ${schedule?.cadenceType === "days_60" ? "selected" : ""}>每60天</option><option value="days_90" ${schedule?.cadenceType === "days_90" ? "selected" : ""}>每90天</option><option value="custom" ${schedule?.cadenceType === "custom" ? "selected" : ""}>自定义</option></select></label><label>自定义天数<input name="intervalDays" type="number" min="1" max="3650" value="${schedule?.cadenceType === "custom" ? Number(schedule.intervalDays || 30) : 30}" /></label><label>负责人<select name="assigneeId" required>${(state.people ?? []).filter((person) => person.status === "active").map((person) => `<option value="${escapeHtml(person.id)}" ${schedule?.assigneeId === person.id || (!schedule && item.ownerId === person.id) ? "selected" : ""}>${escapeHtml(person.name)}</option>`).join("")}</select></label><button type="submit" class="primary-button">保存定期体检</button></form></div>
    ${issues.length ? `<section class="connection-inspection-issues"><h4>待改善候选问题</h4>${issues.map((issue) => `<label><input type="checkbox" data-inspection-issue value="${escapeHtml(issue.id)}" ${selected.has(issue.id) ? "checked" : ""} ${issue.status !== "candidate" ? "disabled" : ""}/><span><strong>${escapeHtml(`${issue.itemNameSnapshot} · ${issue.criterionNameSnapshot}`)}</strong><small>${escapeHtml(`${issue.gradeSnapshot}${issue.noteSnapshot ? ` · ${issue.noteSnapshot}` : ""}`)}${issue.actionCount ? " · 已发起行动" : ""}</small></span></label>`).join("")}${canManage() ? `<form data-inspection-action-form><input name="title" placeholder="行动名称（不填则自动生成）"/><select name="ownerId"><option value="">沿用Link负责人</option>${(state.people ?? []).filter((person) => person.status === "active").map((person) => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.name)}</option>`).join("")}</select><input name="dueDate" type="date"/><textarea name="description" rows="2" placeholder="行动说明"></textarea><label><input name="createTask" type="checkbox" value="true"/> 同时创建正式任务</label><button type="submit" class="primary-button" ${selected.size ? "" : "disabled"}>发起链接优化行动</button></form>` : ""}</section>` : ""}
    ${stateModel.mode === "history" ? `<section class="connection-inspection-history"><h4>历史体检</h4>${(data.history || []).length ? data.history.map((history) => `<button type="button" data-inspection-history-id="${escapeHtml(history.id)}"><span><strong>${escapeHtml(inspectionDate(history.completedAt))}</strong><small>${escapeHtml(`${history.inspectorName} · ${history.templateVersion} · 问题${history.issueCount}项 · 行动${history.actionCount}个`)}</small></span><em>A ${history.gradeACount} / B ${history.gradeBCount} / C ${history.gradeCCount} / D ${history.gradeDCount}</em></button>`).join("") : `<div class="empty-state compact">暂无历史体检</div>`}</section>` : ""}
  </section>`;
}

function mobileProductUrl(item) {
  const goodsId = String(item?.platformGoodsId || "").trim();
  const platform = String(item?.platform || "").trim().toLowerCase();
  if (goodsId && (platform.includes("淘宝") || platform.includes("天猫") || platform.includes("taobao") || platform.includes("tmall"))) {
    return `https://new.m.taobao.com/detail.htm?id=${encodeURIComponent(goodsId)}`;
  }
  if (goodsId && (platform.includes("京东") || platform.includes("jd"))) {
    return `https://item.m.jd.com/product/${encodeURIComponent(goodsId)}.html`;
  }
  const canonicalUrl = String(item?.canonicalUrl || "").trim();
  if (!canonicalUrl) return "";
  try {
    const parsed = new URL(canonicalUrl);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function renderMobileProductPreview(item) {
  const url = mobileProductUrl(item);
  const platform = String(item?.platform || "").trim().toLowerCase();
  const requiresPhoneScan = platform.includes("淘宝")
    || platform.includes("天猫")
    || platform.includes("taobao")
    || platform.includes("tmall")
    || /(^|\.)taobao\.com$/i.test(url ? new URL(url).hostname : "")
    || /(^|\.)tmall\.com$/i.test(url ? new URL(url).hostname : "");
  const qrCodeUrl = url ? resolveAssetUrl(`/api/util/qr-code?value=${encodeURIComponent(url)}`) : "";
  const preview = !url
    ? `<div class="empty-state compact">当前链接没有可用的商品地址</div>`
    : requiresPhoneScan
      ? `<div class="connection-mobile-qr-card"><img src="${escapeHtml(qrCodeUrl)}" alt="${escapeHtml(`${item.platform || "平台"}商品链接二维码`)}" loading="lazy"/><strong>手机扫码查看商品详情</strong><p>该平台限制网页内嵌，请使用手机相机或平台 App 扫描二维码</p><small>${escapeHtml(url)}</small></div>`
      : `<div class="connection-phone-frame"><div class="connection-phone-speaker"></div><div class="connection-phone-screen"><div class="connection-phone-toolbar"><strong>9:41</strong><span>● ● ●</span></div><div class="connection-phone-address">🔒 <span>${escapeHtml(url)}</span></div><iframe src="${escapeHtml(url)}" title="${escapeHtml(`${item.platform || "平台"}商品手机端详情`)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe><footer>可直接浏览；若平台限制内嵌，请使用“新窗口打开”。</footer></div></div>`;
  return `<aside class="connection-mobile-product" aria-label="手机端商品详情">
    <header><div><h3>手机端商品详情</h3><p>${escapeHtml(`${item.platform || "平台"} · ${shopName(item)}`)}</p></div>${url ? `<a class="secondary-button" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">新窗口打开</a>` : ""}</header>
    ${preview}
  </aside>`;
}

function renderConnectionInspectionWorkspace(item) {
  return `<section class="link-workspace-module connection-inspection-module" data-module-key="link_inspection"><div class="connection-inspection-workspace">${renderConnectionInspection(item)}${renderMobileProductPreview(item)}</div></section>`;
}

function renderDetail() {
  const detailProfile = pageState.coreDetail?.profile;
  const listItem = pageState.items.find((candidate) => candidate.id === pageState.selectedId)
    ?? pageState.myWorkbench.items.find((candidate) => candidate.id === pageState.selectedId)
    ?? pageState.myLinkTable.items.find((candidate) => candidate.id === pageState.selectedId)
    ?? pageState.businessTable.items.find((candidate) => candidate.id === pageState.selectedId)
    ?? (detailProfile ? { ...detailProfile, id: detailProfile.id || pageState.selectedId } : null)
    ?? { id: pageState.selectedId, name: "链接详情", salesLinkTitle: "链接详情", platform: "—", shopName: "—", products: [] };
  const item = detailProfile ? { ...listItem, ...detailProfile,
    products: detailProfile.products ?? pageState.coreDetail?.products ?? listItem.products ?? [] } : listItem;
  const tabs = [["business", "经营概览"], ["sales", "销售分析"], ["inventory", "商品库存"], ["advanced", "高级信息"], ["inspection", "链接体检"]];
  let body = "";
  if (pageState.coreDetailLoading) body = `<div class="empty-state">正在读取链接经营详情…</div>`;
  else if (pageState.detailTab === "business") body = renderUiModule("link_business_summary", {
    metricsHtml: `<section class="connection-v3-panel"><h3>链接贡献级别</h3>${renderConnectionGoalEvaluation(pageState.coreDetail)}</section>${renderActions(item)}${renderCoreOperatingOverview(item, pageState.coreDetail)}`,
    trendHtml: renderCorePlatform(pageState.coreDetail),
    healthHtml: `<section class="connection-v3-panel"><h3>经营趋势</h3><div class="connection-v3-metrics"><div><span>销售趋势</span><strong>${growthText(item.salesGrowth)}</strong></div><div><span>利润趋势</span><strong>${growthText(item.profitGrowth)}</strong></div></div></section>`,
    productHtml: renderCoreProducts(pageState.coreDetail),
  });
  else if (pageState.detailTab === "sales") body = renderUiModule("link_sales_analysis", {
    platformHtml: renderUiModule("link_daily_sales", { data: pageState.dailySales.data, loading: pageState.dailySales.loading, rangePreset: pageState.dailySales.rangePreset, startDate: pageState.dailySales.startDate, endDate: pageState.dailySales.endDate }), erpHtml: `${renderCorePlatform(pageState.coreDetail)}${renderErpSales(pageState.coreDetail)}`, skuHtml: renderSkuSales(pageState.coreDetail),
    trendHtml: pageState.growthAnalysis ? renderCoreOperatingOverview(item, pageState.coreDetail) : `<div class="empty-state compact">正在按需读取经营趋势…</div>`,
  });
  else if (pageState.detailTab === "inventory") body = renderUiModule("link_inventory_summary", { productsHtml: renderCoreProducts(pageState.coreDetail), inventoryHtml: renderInventory(pageState.coreDetail) });
  else if (pageState.detailTab === "inspection") body = renderConnectionInspectionWorkspace(item);
  else body = `<div class="link-workspace-stack">${renderCoreBasic(item, pageState.coreDetail)}${renderBenchmarkPanel(item)}</div>`;
  const header = renderUiModule("link_detail_header", { item, imageHtml: imageHtml(item), channel: `${item.platform} · ${shopName(item)}`, productSummary: pageState.coreDetailLoading ? "正在读取关联产品…" : productNames(item), operationHtml: renderConnectionOperationBar(item) });
  return `<section class="connection-detail link-detail-workspace">${header}<nav class="connection-tabs link-workspace-tabs">${tabs.map(([id, label]) => `<button type="button" class="${pageState.detailTab === id ? "active" : ""}" data-connection-tab="${id}">${label}</button>`).join("")}</nav>${body}</section>`;
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

export function renderConnectionCenterPage() {
  const pageContent = pageState.loading ? "" : pageState.section === "cockpit" ? renderBusinessCockpit() : pageState.section === "my-links" ? renderMyLinksWorkbench() : pageState.section === "goal-management" ? renderGoalManagement() : pageState.section === "data-import" ? renderDataUpdateWorkspace() : pageState.section === "sales-relation-governance" ? renderSalesRelationGovernance() : pageState.section === "sales-data-quality-governance" ? renderSalesDataQualityGovernance() : renderConnectionAssets();
  const loadingContent = pageState.section === "cockpit" ? `${renderSectionNavigation()}${renderCockpitSkeleton()}` : `<div class="empty-state">正在读取链接…</div>`;
  return `<section class="connection-center-page">${pageState.error ? `<div class="form-error">${escapeHtml(pageState.error)}</div>` : ""}${pageState.loading ? loadingContent : pageState.selectedId ? renderDetail() : `${renderSectionNavigation()}${pageContent}`}${renderBenchmarkModal()}</section>`;
}

async function loadMyLinks(render, filter = pageState.myWorkbench.filter) {
  pageState.myWorkbench.loading = !pageState.myWorkbench.loaded; pageState.myLinkTable.loading = true; pageState.error = ""; render();
  try {
    const table = pageState.myLinkTable;
    const summaryPromise = pageState.myWorkbench.loaded ? Promise.resolve(null) : loadMyConnectionWorkbench("all", 1, 20, "");
    const [summaryResult, tableResult] = await Promise.all([summaryPromise, loadLinkDataTable({ scope: "mine", page: table.pagination.page,
      pageSize: table.pagination.pageSize, preset: table.range.preset, startDate: table.range.startDate, endDate: table.range.endDate,
      keyword: table.filters.keyword, platform: table.filters.platform, shopId: table.filters.shopId, archiveStatus: table.filters.archiveStatus,
      sortField: table.sort.field, sortDirection: table.sort.direction, fields: table.visibleFields.join(",") })]);
    if (summaryResult) pageState.myWorkbench = { ...pageState.myWorkbench, ...summaryResult, loading: false, loaded: true };
    pageState.myLinkTable = { ...pageState.myLinkTable, ...tableResult, loading: false, loaded: true,
      range: { ...pageState.myLinkTable.range, ...tableResult.range }, pagination: tableResult.pagination || pageState.myLinkTable.pagination };
  }
  catch (error) { pageState.error = error.message; pageState.myWorkbench.loading = false; pageState.myLinkTable.loading = false; }
  render();
}

async function loadMyLinkDataStatus(render, shopId = pageState.linkDataStatus.shopId || "") {
  pageState.linkDataStatus = { ...pageState.linkDataStatus, shopId, loading: true, error: "" }; render();
  try { pageState.linkDataStatus = { data: await loadLinkDataStatus({ shopId }), shopId, loading: false, loaded: true, error: "" }; }
  catch (error) { pageState.linkDataStatus = { ...pageState.linkDataStatus, loading: false, loaded: true, error: error.message }; }
  render();
}

async function loadSalesDailyQualityPanel(render) {
  pageState.salesDailyQuality = { ...pageState.salesDailyQuality, loading: true, error: "" }; render();
  try { pageState.salesDailyQuality = { data: await loadSalesDailyDataQuality(), loading: false, loaded: true, error: "" }; }
  catch (error) { pageState.salesDailyQuality = { ...pageState.salesDailyQuality, loading: false, loaded: true, error: error.message }; }
  render();
}

async function loadSalesDistribution(render, filters = {}) {
  pageState.salesDistribution = { ...pageState.salesDistribution, ...filters, selectedGroup: 0, selectedRange: null, drillTable: null, loading: true, error: "" }; render();
  try {
    const globalRange = pageState.cockpitRange || {};
    const result = await loadLinkSalesDistribution({
      scope: pageState.salesDistribution.scope,
      preset: globalRange.preset || "30d",
      startDate: globalRange.startDate || "",
      endDate: globalRange.endDate || "",
    });
    const { range: _resolvedRange, ...distribution } = result;
    pageState.salesDistribution = { ...pageState.salesDistribution, ...distribution, loaded: true, loading: false, error: "" };
  } catch (error) { pageState.salesDistribution = { ...pageState.salesDistribution, loaded: true, loading: false, error: error.message }; }
  render();
}

async function loadDistributionRangeTable(render, start, end, ids = []) {
  const distribution = pageState.salesDistribution;
  const connectionIds = ids.length ? ids : distribution.items.filter((item) => item.rank >= start && item.rank <= end).map((item) => item.linkId);
  pageState.salesDistribution = { ...distribution, selectedRange: { start, end }, drillTable: { loading: true, items: [], pagination: {} } }; render();
  try {
    const result = await loadLinkDataTable({ scope: distribution.scope, preset: "custom",
      startDate: pageState.cockpitRange.startDate || "", endDate: pageState.cockpitRange.endDate || "", page: 1, pageSize: 20,
      sortField: "selectedSales", sortDirection: "desc", connectionIds: connectionIds.join(","),
      fields: "image,name,platform,shop,owner,selectedSales,growthStatus" });
    pageState.salesDistribution = { ...pageState.salesDistribution, drillTable: { ...result,
      items: (result.items || []).map((item) => ({ ...item, imageUrl: item.mainImage ? resolveAssetUrl(item.mainImage) : "" })),
      fields: ["image", "name", "platform", "shop", "owner", "selectedSales", "growthStatus"],
      columns: LINK_DATA_COLUMNS, sort: { field: "selectedSales", direction: "desc" }, loading: false, showOwner: distribution.scope === "company" } };
  } catch (error) { pageState.salesDistribution = { ...pageState.salesDistribution, drillTable: null, error: error.message }; }
  render();
}

function applyConnectionAssetData(connections, rankings, managementOverview) {
  const analysisByConnection = new Map((rankings.listMetrics ?? []).map((item) => [item.connectionId, item]));
  pageState.items = (connections.items ?? []).map((item) => {
    const analysis = analysisByConnection.get(item.id);
    return { ...item, salesGrowth: analysis?.salesGrowth ?? null, visitorGrowth: analysis?.visitorGrowth ?? null,
      conversionChange: analysis?.conversionChange ?? null, currentFinance: analysis?.currentFinance ?? null, profitGrowth: analysis?.profitGrowth ?? null };
  });
  pageState.growthRankings = rankings;
  pageState.managementOverview = managementOverview;
  pageState.operatingSummary = connections.operatingSummary || pageState.operatingSummary;
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
      productRelation: pageState.listFilters.productRelation, skuCount: pageState.listFilters.skuCount,
      includeHistorical: pageState.listFilters.includeHistorical, sortField, sortDirection });
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

async function loadLinkBusinessTablePage(render) {
  const table = pageState.businessTable;
  pageState.businessTable = { ...table, loading: true }; pageState.error = ""; render();
  try {
    const result = await loadLinkBusinessTable({ scope: isAdmin() ? "company" : "mine", page: table.pagination.page,
      pageSize: table.pagination.pageSize, preset: table.range.preset, startDate: table.range.startDate, endDate: table.range.endDate,
      keyword: table.filters.keyword, platform: table.filters.platform, shopId: table.filters.shopId, ownerId: table.filters.ownerId,
      minSales: table.filters.minSales, maxSales: table.filters.maxSales, minProfit: table.filters.minProfit, maxProfit: table.filters.maxProfit,
      minProfitMargin: table.filters.minProfitMargin, maxProfitMargin: table.filters.maxProfitMargin,
      growthStatus: table.filters.growthStatus,
      includeHistorical: table.filters.includeHistorical,
      sortField: table.sort.field, sortDirection: table.sort.direction, fields: table.visibleFields.join(",") });
    pageState.businessTable = { ...pageState.businessTable, ...result, loaded: true, loading: false,
      range: { ...pageState.businessTable.range, ...result.range }, pagination: result.pagination || pageState.businessTable.pagination,
      sort: result.sort || pageState.businessTable.sort };
    pageState.loadedSections.add("connections");
  } catch (error) { pageState.error = error.message; pageState.businessTable.loading = false; }
  render();
}

async function loadGoalWorkbenchPage(render, overrides = {}) {
  const current = pageState.goalWorkbench;
  const filters = { ...current.filters, ...(overrides.filters || {}) };
  const pagination = { ...current.pagination, ...(overrides.pagination || {}) };
  pageState.goalWorkbench = { ...current, filters, pagination, loading: true }; pageState.error = ""; render();
  try {
    const result = await loadConnectionGoalWorkbench({ ...filters, page: pagination.page, pageSize: pagination.pageSize });
    pageState.goalWorkbench = { ...pageState.goalWorkbench, ...result, filters, filterOptions: result.filters || { owners: [] },
      selectedIds: new Set(), loading: false, loaded: true, operating: false };
    pageState.loadedSections.add("goal-management");
  } catch (error) { pageState.error = error.message; pageState.goalWorkbench = { ...pageState.goalWorkbench, loading: false, operating: false }; }
  render();
}

async function loadGoalPilotPage(render, overrides = {}) {
  const current = pageState.goalPilot;
  pageState.goalPilot = { ...current, loading: true }; pageState.error = ""; render();
  try {
    const batchResult = await loadConnectionGoalPilotBatches({ page: current.batchPagination.page, pageSize: current.batchPagination.pageSize });
    const selectedBatchId = overrides.selectedBatchId ?? current.selectedBatchId ?? batchResult.items?.[0]?.id ?? "";
    const selectedId = batchResult.items?.some((item) => item.id === selectedBatchId) ? selectedBatchId : batchResult.items?.[0]?.id || "";
    let memberResult = { batch: null, items: [], pagination: current.memberPagination, permissions: batchResult.permissions };
    if (selectedId) memberResult = await loadConnectionGoalPilotMembers(selectedId, { ...current.memberFilters, page: overrides.memberPage || current.memberPagination.page, pageSize: current.memberPagination.pageSize });
    pageState.goalPilot = { ...pageState.goalPilot, batches: batchResult.items || [], batchPagination: batchResult.pagination,
      selectedBatchId: selectedId, batch: memberResult.batch, members: memberResult.items || [], memberPagination: memberResult.pagination,
      permissions: { ...batchResult.permissions, ...memberResult.permissions }, loaded: true, loading: false, operating: false };
    pageState.loadedSections.add("goal-management");
    if (pageState.goalPilot.showCandidates && selectedId) await loadGoalPilotCandidatePage(render, { page: 1, silent: true });
  } catch (error) { pageState.error = error.message; pageState.goalPilot = { ...pageState.goalPilot, loading: false, operating: false }; }
  render();
}

async function loadGoalPilotCandidatePage(render, overrides = {}) {
  const model = pageState.goalPilot;
  if (!model.selectedBatchId) return;
  if (!overrides.silent) { pageState.goalPilot = { ...model, loading: true }; render(); }
  try {
    const page = overrides.page || model.candidatePagination.page;
    const result = await loadConnectionGoalPilotCandidates(model.selectedBatchId, { ...model.candidateFilters, page, pageSize: model.candidatePagination.pageSize });
    pageState.goalPilot = { ...pageState.goalPilot, candidates: result.items || [], candidatePagination: result.pagination,
      filterOptions: result.filters || { owners: [] }, candidateSelectedIds: new Set(), loading: false };
  } catch (error) { pageState.error = error.message; pageState.goalPilot = { ...pageState.goalPilot, loading: false }; }
  if (!overrides.silent) render();
}

async function runGoalPilotOperation(render, operation) {
  pageState.goalPilot = { ...pageState.goalPilot, operating: true }; pageState.error = ""; render();
  try { await operation(); await loadGoalPilotPage(render); }
  catch (error) { pageState.error = error.message; pageState.goalPilot = { ...pageState.goalPilot, operating: false }; render(); }
}

async function runGoalWorkbenchBatch(render, operation) {
  const selectedIds = [...pageState.goalWorkbench.selectedIds];
  if (!selectedIds.length) return;
  pageState.goalWorkbench = { ...pageState.goalWorkbench, operating: true }; pageState.error = ""; render();
  try {
    const result = await operation(selectedIds);
    const completed = result.changedCount ?? result.generatedCount ?? result.confirmedCount ?? 0;
    const skipped = result.skippedCount ?? 0;
    window.alert(`批量操作完成：处理 ${completed} 个，跳过 ${skipped} 个。`);
    await loadGoalWorkbenchPage(render);
  } catch (error) {
    pageState.error = error.message; pageState.goalWorkbench = { ...pageState.goalWorkbench, operating: false }; render();
  }
}

function cockpitRangeRequest() {
  const range = pageState.cockpitRange || { preset: "30d" };
  return { preset: range.preset || "30d", startDate: range.startDate || "", endDate: range.endDate || "" };
}

function recordCockpitFetchResult(kind, result, startedAt) {
  recordCockpitPerformance(kind, { elapsedMs: Number((performance.now() - startedAt).toFixed(1)), ...(result?._clientTiming || {}) });
}

async function loadCockpitSecondaryData(render, request, requestId) {
  const goalStartedAt = performance.now();
  void loadConnectionGoalHealthSummary(request).then((goalHealth) => {
    if (requestId !== cockpitRequestId) return;
    const { selectedRange: _selectedRange, ...goalHealthData } = goalHealth;
    pageState.goalHealth = goalHealthData; pageState.cockpitGoalHealthLoading = false;
    recordCockpitFetchResult("goalHealth", goalHealth, goalStartedAt); render();
  }).catch((error) => {
    if (requestId !== cockpitRequestId) return;
    pageState.cockpitGoalHealthLoading = false; pageState.error = error.message; render();
  });

  const distributionStartedAt = performance.now();
  void loadLinkSalesDistribution({ scope: pageState.salesDistribution.scope || (isAdmin() ? "company" : "mine"), ...request }).then((distribution) => {
    if (requestId !== cockpitRequestId) return;
    const { range: _resolvedRange, ...distributionData } = distribution;
    pageState.salesDistribution = { ...pageState.salesDistribution, ...distributionData, selectedGroup: 0, selectedRange: null,
      drillTable: null, loaded: true, loading: false, error: "" };
    recordCockpitFetchResult("salesDistribution", distribution, distributionStartedAt); render();
  }).catch((error) => {
    if (requestId !== cockpitRequestId) return;
    pageState.salesDistribution = { ...pageState.salesDistribution, loaded: true, loading: false, error: error.message }; render();
  });
}

async function loadCockpitProductChannels(render, requestId = cockpitRequestId) {
  if (pageState.cockpitProductChannels.loading || pageState.cockpitProductChannels.loaded) return;
  const request = cockpitRangeRequest(); const startedAt = performance.now();
  pageState.cockpitProductChannels = { loading: true, loaded: false, error: "" }; render();
  try {
    const result = await loadConnectionBusinessCockpit({ ...request, scope: "product-channels" });
    if (requestId !== cockpitRequestId) return;
    pageState.cockpit = { ...pageState.cockpit, productChannels: result.productChannels || [] };
    pageState.cockpitProductChannels = { loading: false, loaded: true, error: "" };
    recordCockpitFetchResult("productChannels", result, startedAt);
  } catch (error) {
    if (requestId !== cockpitRequestId) return;
    pageState.cockpitProductChannels = { loading: false, loaded: false, error: error.message };
  }
  render();
}

async function loadBusinessCockpitPage(render) {
  const request = cockpitRangeRequest(); const requestId = ++cockpitRequestId; const startedAt = performance.now();
  pageState.cockpitRange = { ...pageState.cockpitRange, loading: true };
  pageState.cockpitProductChannels = { loading: false, loaded: false, error: "" };
  pageState.cockpitGoalHealthLoading = true;
  pageState.salesDistribution = { ...pageState.salesDistribution, loaded: false, loading: true, error: "" };
  render();
  try {
    const cockpit = await loadConnectionBusinessCockpit({ ...request, scope: "core" });
    if (requestId !== cockpitRequestId) return;
    const { range: resolvedRange, ...cockpitData } = cockpit;
    pageState.cockpit = { ...pageState.cockpit, ...cockpitData, productChannels: [] };
    pageState.cockpitRange = { ...(resolvedRange || request), loading: false };
    pageState.error = ""; recordCockpitFetchResult("core", cockpit, startedAt); render();
    scheduleCockpitInteractiveMeasurement("core", startedAt);
    void loadCockpitSecondaryData(render, request, requestId);
    if (pageState.cockpitExpanded) void loadCockpitProductChannels(render, requestId);
  } catch (error) {
    if (requestId !== cockpitRequestId) return;
    pageState.error = error.message; pageState.cockpitRange = { ...pageState.cockpitRange, loading: false };
    pageState.cockpitGoalHealthLoading = false; pageState.salesDistribution = { ...pageState.salesDistribution, loading: false }; render();
  }
}

async function loadPage(render) {
  const requestId = ++cockpitRequestId; const request = cockpitRangeRequest(); const startedAt = performance.now();
  pageState.loading = true; pageState.error = ""; pageState.cockpitGoalHealthLoading = true;
  pageState.salesDistribution = { ...pageState.salesDistribution, loaded: false, loading: true, error: "" };
  render();
  try {
    const cockpit = await loadConnectionBusinessCockpit({ ...request, scope: "core" });
    if (requestId !== cockpitRequestId) return;
    const { range: resolvedRange, ...cockpitData } = cockpit;
    pageState.cockpit = { ...pageState.cockpit, ...cockpitData, productChannels: [] };
    pageState.cockpitRange = { ...(resolvedRange || request), loading: false };
    pageState.loadedSections.add("cockpit"); pageState.loaded = true;
    pageState.loadedUserId = String(getCurrentUser()?.personId ?? getCurrentUser()?.id ?? "");
    pageState.loading = false; recordCockpitFetchResult("core", cockpit, startedAt); render();
    scheduleCockpitInteractiveMeasurement("core", startedAt);
    void loadCockpitSecondaryData(render, request, requestId);
  } catch (error) {
    if (requestId !== cockpitRequestId) return;
    pageState.error = error.message; pageState.loading = false; pageState.cockpitGoalHealthLoading = false;
    pageState.salesDistribution = { ...pageState.salesDistribution, loading: false }; render();
  }
}

function withConnectionDetailTimeout(request, label, timeoutMs = 20000) {
  let timeoutId = null;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(`${label}读取超时，请稍后重试。`)), timeoutMs);
  });
  return Promise.race([request, timeout]).finally(() => window.clearTimeout(timeoutId));
}

const connectionGoalModuleLoaders = Object.freeze({
  businessGoalEvaluation: { label: "经营评价", load: loadConnectionBusinessGoalEvaluation },
});

function connectionGoalLoadError(error, label) {
  if (error?.message === "Failed to fetch") return `${label}暂时无法读取：开发版后端服务未连接。`;
  return error?.message || `${label}暂时无法读取。`;
}

async function loadConnectionGoalModule(id, key, render) {
  const config = connectionGoalModuleLoaders[key];
  if (!config || pageState.selectedId !== id || !pageState.coreDetail) return;
  pageState.coreDetail = { ...pageState.coreDetail, [key]: null };
  render();
  try {
    // 目标管理是轻量读取；单个模块独立完成，不再被其他模块的慢请求阻塞。
    const result = await withConnectionDetailTimeout(config.load(id), config.label, 5000);
    if (pageState.selectedId !== id || !pageState.coreDetail) return;
    pageState.coreDetail = { ...pageState.coreDetail, [key]: result };
  } catch (error) {
    if (pageState.selectedId !== id || !pageState.coreDetail) return;
    pageState.coreDetail = {
      ...pageState.coreDetail,
      [key]: { loadError: connectionGoalLoadError(error, config.label) },
    };
  }
  render();
}

function loadConnectionGoalModules(id, render) {
  Object.keys(connectionGoalModuleLoaders).forEach((key) => {
    void loadConnectionGoalModule(id, key, render);
  });
}

async function reloadConnectionInspection(render) {
  if (!pageState.selectedId) return;
  const data = await loadConnectionInspections(pageState.selectedId);
  pageState.inspection = { ...pageState.inspection, data, active: data.draft || null, loading: false, error: "", selectedIssues: new Set() };
  const actions = await loadConnectionActions(pageState.selectedId);
  pageState.actions = actions.items ?? [];
  render();
}

async function openConnection(id, render, inspectionTaskId = "") {
  const detailHash = `#connectionCenter/${encodeURIComponent(id)}${inspectionTaskId ? `?inspectionTaskId=${encodeURIComponent(inspectionTaskId)}` : ""}`;
  if (window.location.hash !== detailHash) window.history.replaceState(null, "", detailHash);
  pageState.inspectionTaskId = inspectionTaskId;
  const initialDetailTab = inspectionTaskId ? "inspection" : "business";
  pageState.selectedId = id; pageState.detailTab = initialDetailTab; pageState.detailLoaded = new Set([initialDetailTab]); pageState.coreDetail = null; pageState.coreDetailLoading = true; pageState.inspection = { data: null, active: null, historyDetail: null, loading: true, error: "", mode: "summary", selectedIssues: new Set() }; pageState.dailySales = { data: null, loading: false, loaded: false, rangePreset: "30d", startDate: "", endDate: "", error: "" }; pageState.actions = []; pageState.periodSnapshots = []; pageState.growthAnalysis = null; pageState.benchmarks = { items: [], candidates: [], comparison: null, comparisonId: "", loading: false }; render();
  try {
    const detail = await withConnectionDetailTimeout(loadConnectionCoreDetail(id), "链接经营详情");
    if (pageState.selectedId !== id) return;

    // 核心身份、产品关系、销售与库存先完成首屏，不再等待目标管理的附加接口。
    // 任何附加接口超时或失败，都不能让整个链接详情永久停留在加载状态。
    pageState.coreDetail = { ...detail }; pageState.coreDetailLoading = false; pageState.error = ""; render();
    void Promise.all([loadConnectionInspections(id), loadConnectionActions(id)]).then(([inspection, actions]) => {
      if (pageState.selectedId !== id) return;
      pageState.inspection = { ...pageState.inspection, data: inspection, active: inspection.draft || null, loading: false, error: "" };
      pageState.actions = actions.items ?? [];
      render();
    }).catch((error) => {
      if (pageState.selectedId !== id) return;
      pageState.inspection = { ...pageState.inspection, loading: false, error: error.message || "链接体检读取失败。" };
      render();
    });
    if (!detail.profile?.hasBusinessProfile) {
      pageState.coreDetail = {
        ...pageState.coreDetail,
        businessPositioning: { current: null, currentTemplate: null, history: [], options: [], permissions: { canEdit: false } },
        businessGoals: { current: null, awaitingConfirmation: null, history: [], permissions: { canEdit: false } },
        businessGoalEvaluation: { evaluationStatus: "pending", reason: "当前链接尚未进入经营目标管理。" },
      };
      render();
      return;
    }

    loadConnectionGoalModules(id, render);
  }
  catch (error) {
    if (pageState.selectedId !== id) return;
    pageState.error = error.message; pageState.coreDetailLoading = false; render();
  }
}

async function loadDailySales(render, rangePreset = pageState.dailySales.rangePreset, customRange = {}) {
  const days = linkTimeRangeDays(rangePreset);
  const end = new Date();
  const start = new Date(end);
  if (days) start.setDate(start.getDate() - days + 1);
  const startDate = rangePreset === "custom" ? String(customRange.startDate || pageState.dailySales.startDate || "") : start.toISOString().slice(0, 10);
  const endDate = rangePreset === "custom" ? String(customRange.endDate || pageState.dailySales.endDate || "") : end.toISOString().slice(0, 10);
  if (!startDate || !endDate) return;
  pageState.dailySales = { ...pageState.dailySales, loading: true, rangePreset, startDate, endDate, error: "" }; render();
  try {
    const data = await loadConnectionDailySales(pageState.selectedId, { startDate, endDate });
    pageState.dailySales = { data, loading: false, loaded: true, rangePreset, startDate, endDate, error: "" };
  } catch (error) { pageState.dailySales = { ...pageState.dailySales, loading: false, error: error.message || "销售日报读取失败。" }; }
  render();
}

async function loadBenchmarks(render) {
  pageState.benchmarks.loading = true; pageState.error = ""; render();
  try {
    const [benchmarks, candidates] = await Promise.all([loadConnectionBenchmarks(pageState.selectedId), loadConnectionBenchmarkCandidates(pageState.selectedId)]);
    pageState.benchmarks = { ...pageState.benchmarks, ...benchmarks, candidates: candidates.items ?? [], loading: false };
  } catch (error) { pageState.error = error.message; pageState.benchmarks.loading = false; }
  render();
}

async function loadDataFoundation(render) {
  pageState.foundation.loading = true; pageState.error = ""; render();
  try {
    const [loaded, currentSalesPreview, currentDailyPreview, ownerImport] = await Promise.all([loadConnectionDataFoundation(), loadCurrentConnectionSalesFactImport(), loadCurrentConnectionSalesDailyImport(), canManage() ? loadCurrentConnectionOwnerImport() : Promise.resolve(null)]);
    pageState.foundation = { ...loaded, loading: false, preview: pageState.foundation.preview ?? null, bulkPreview: loaded.bulkPreview ?? pageState.foundation.bulkPreview ?? null, salesPreview: pageState.foundation.salesPreview ?? currentSalesPreview ?? null, dailyPreview: pageState.foundation.dailyPreview ?? currentDailyPreview ?? null, dailyLoading: pageState.foundation.dailyLoading ?? false, dailyCommitting: pageState.foundation.dailyCommitting ?? false, dailyError: pageState.foundation.dailyError ?? "", dailyMessage: pageState.foundation.dailyMessage ?? "", dailyFileName: pageState.foundation.dailyFileName ?? "", dailyFile: pageState.foundation.dailyFile ?? null, dailyCategory: pageState.foundation.dailyCategory ?? "ready" };
    pageState.ownerImport.result = ownerImport;
    pageState.loadedSections.add("data-import");
    if (["waiting", "running"].includes(pageState.foundation.bulkPreview?.batch?.status)) window.setTimeout(() => void pollConnectionBulkPreview(pageState.foundation.bulkPreview.batch.id, render), 800);
  }
  catch (error) { pageState.error = error.message; pageState.foundation.loading = false; }
  render();
}

async function loadPlatformGoodsImport(render) {
  if (!canManageAdminDataCenter()) return;
  pageState.platformGoodsImport = { ...pageState.platformGoodsImport, loading: true, error: "" }; render();
  try {
    const overview = await loadDataSyncCenter();
    const task = (overview.tasks || []).find((item) => item.taskCode === "platform_goods_excel_import");
    pageState.platformGoodsImport = {
      ...pageState.platformGoodsImport,
      taskId: task?.id || "",
      loading: false,
      loaded: true,
      error: task ? "" : "平台货品导入任务不存在。",
    };
  } catch (error) {
    pageState.platformGoodsImport = { ...pageState.platformGoodsImport, loading: false, loaded: true, error: error.message || "平台货品导入能力读取失败。" };
  }
  render();
}

async function loadSalesRelationGovernancePage(render, overrides = {}) {
  const model = pageState.relationGovernance;
  pageState.relationGovernance = { ...model, loading: true }; pageState.error = ""; render();
  try {
    const filters = { ...model.filters, ...overrides };
    const result = await loadSalesRelationGovernance({ ...filters, page: overrides.page || model.pagination.page || 1, pageSize: 30 });
    pageState.relationGovernance = { ...model, ...result, filters, selected: model.selected, loading: false, loaded: true };
  } catch (error) { pageState.error = error.message; pageState.relationGovernance.loading = false; }
  render();
}

async function loadSalesDataQualityGovernancePage(render, overrides = {}) {
  const model = pageState.salesDataQualityGovernance;
  pageState.salesDataQualityGovernance = { ...model, loading: true }; pageState.error = ""; render();
  try {
    const filters = { ...model.filters, ...overrides };
    const result = await loadSalesDataQualityAnomalies({ ...filters, page: overrides.page || model.pagination.page || 1, pageSize: 30 });
    pageState.salesDataQualityGovernance = { ...model, ...result, filters, selected: model.selected, loading: false, loaded: true };
  } catch (error) { pageState.error = error.message; pageState.salesDataQualityGovernance.loading = false; }
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
  root.querySelectorAll(".link-data-update-workspace .connection-foundation-import-form").forEach((form) => {
    const input = form.querySelector('input[type="file"]');
    if (!input) return;
    const hint = document.createElement("small");
    hint.className = "import-drop-hint";
    hint.textContent = "可拖拽Excel到此区域，或点击选择文件；选好后点击上传并检查。";
    form.append(hint);
    form.addEventListener("dragover", event => { event.preventDefault(); if (!input.disabled) form.classList.add("is-dragging"); });
    form.addEventListener("dragleave", () => form.classList.remove("is-dragging"));
    form.addEventListener("drop", event => {
      event.preventDefault(); form.classList.remove("is-dragging");
      if (input.disabled || !event.dataTransfer?.files.length) return;
      const files = [...event.dataTransfer.files];
      if (files.some(file => !/\.(xls|xlsx)$/i.test(file.name)) || (!input.multiple && files.length > 1)) {
        hint.textContent = input.multiple ? "请选择Excel文件（.xls或.xlsx）。" : "此类型每次上传一个Excel文件（.xls或.xlsx）。";
        hint.setAttribute("role", "alert"); return;
      }
      input.files = event.dataTransfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      hint.textContent = `已选择：${files.map(file => file.name).join("、")}`;
    });
  });
  const currentUserId = String(getCurrentUser()?.personId ?? getCurrentUser()?.id ?? "");
  if (pageState.loaded && pageState.loadedUserId !== currentUserId) {
    pageState.loaded = false;
    pageState.items = [];
    pageState.myWorkbench = { items: [], summary: { total: 0, better: 0, risk: 0, followed: 0 }, filter: "all", search: "", page: 1, pageSize: 20, isAdmin: false, loading: false, loaded: false };
    pageState.myLinkTable = { ...pageState.myLinkTable, items: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 }, loading: false, loaded: false };
    pageState.businessTable = { ...pageState.businessTable, items: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 }, loading: false, loaded: false };
    pageState.goalWorkbench = { ...pageState.goalWorkbench, summary: {}, items: [], selectedIds: new Set(), loading: false, loaded: false, operating: false };
    pageState.linkDataStatus = { data: null, shopId: "", loading: false, loaded: false, error: "" };
    pageState.salesDailyQuality = { data: null, loading: false, loaded: false, error: "" };
    pageState.cockpitRange = { preset: "30d", startDate: "", endDate: "", loading: false };
    pageState.salesDistribution = { scope: isAdmin() ? "company" : "mine", items: [], summary: {}, selectedGroup: 0, selectedRange: null, drillTable: null, loading: false, loaded: false, error: "" };
    pageState.platformGoodsImport = { taskId: "", preview: null, loading: false, loaded: false, error: "", message: "" };
    pageState.selectedId = "";
    pageState.coreDetail = null;
    pageState.ownerImport = { loading: false, result: null, showCompletion: false };
  }
  if (!pageState.loaded && !pageState.loading) void loadPage(render);
  const route = parseConnectionCenterRoute(window.location.hash);
  if (route.redirectHash) { window.location.hash = route.redirectHash; return; }
  if (route.importPage && currentImportPage !== route.importPage) { currentImportPage = route.importPage; render(); return; }
  const hasDetailRoute = Boolean(route.detailId);
  if (pageState.loaded && hasDetailRoute && (pageState.selectedId !== route.detailId || pageState.inspectionTaskId !== route.inspectionTaskId)) {
    void openConnection(route.detailId, render, route.inspectionTaskId);
  }
  if (!hasDetailRoute) {
    const previousSection = pageState.section; const hadDetail = Boolean(pageState.selectedId);
    const selectedSection = selectConnectionSection(route.section || pageState.section, { updateRoute: true });
    if (previousSection !== selectedSection || hadDetail) { render(); return; }
    if (pageState.loaded) ensureConnectionSectionLoaded(selectedSection, render);
  }
  root.querySelectorAll("[data-connection-section]").forEach((button) => button.addEventListener("click", () => {
    const section = selectConnectionSection(button.dataset.connectionSection); render(); ensureConnectionSectionLoaded(section, render);
  }));
  root.querySelectorAll("[data-import-page]").forEach((button) => button.addEventListener("click", () => {
    currentImportPage = button.dataset.importPage;
    selectConnectionSection("data-import");
    render();
    ensureConnectionSectionLoaded("data-import", render);
  }));
  root.querySelector("[data-link-data-status-shop]")?.addEventListener("change", (event) => {
    void loadMyLinkDataStatus(render, event.currentTarget.value || "");
  });
  root.querySelector("[data-relation-governance-filters]")?.addEventListener("submit", (event) => {
    event.preventDefault(); void loadSalesRelationGovernancePage(render, { ...Object.fromEntries(new FormData(event.currentTarget)), page: 1 });
  });
  root.querySelector("[data-reset-relation-governance]")?.addEventListener("click", () => {
    pageState.relationGovernance.filters = { governanceType: "", shopId: "", keyword: "", minSales: "", maxSales: "", status: "pending" };
    void loadSalesRelationGovernancePage(render, { page: 1 });
  });
  root.querySelectorAll("[data-governance-type]").forEach((button) => button.addEventListener("click", () => {
    void loadSalesRelationGovernancePage(render, { governanceType: button.dataset.governanceType || "", page: 1 });
  }));
  root.querySelectorAll("[data-relation-governance-page]").forEach((button) => button.addEventListener("click", () => {
    void loadSalesRelationGovernancePage(render, { page: Number(button.dataset.relationGovernancePage || 1) });
  }));
  root.querySelectorAll("[data-open-relation-governance]").forEach((button) => button.addEventListener("click", () => {
    pageState.relationGovernance.selected = pageState.relationGovernance.items.find((item) => item.id === button.dataset.openRelationGovernance) || null; render();
  }));
  root.querySelector("[data-close-relation-governance]")?.addEventListener("click", () => { pageState.relationGovernance.selected = null; render(); });
  root.querySelector("[data-quality-anomaly-filters]")?.addEventListener("submit", (event) => {
    event.preventDefault(); void loadSalesDataQualityGovernancePage(render, { ...Object.fromEntries(new FormData(event.currentTarget)), page: 1 });
  });
  root.querySelectorAll("[data-quality-anomaly-type]").forEach((button) => button.addEventListener("click", () => void loadSalesDataQualityGovernancePage(render, { anomalyType: button.dataset.qualityAnomalyType || "", page: 1 })));
  root.querySelectorAll("[data-quality-anomaly-page]").forEach((button) => button.addEventListener("click", () => void loadSalesDataQualityGovernancePage(render, { page: Number(button.dataset.qualityAnomalyPage || 1) })));
  root.querySelectorAll("[data-open-quality-anomaly]").forEach((button) => button.addEventListener("click", () => {
    pageState.salesDataQualityGovernance.selected = pageState.salesDataQualityGovernance.items.find((item) => item.id === button.dataset.openQualityAnomaly) || null; render();
  }));
  root.querySelector("[data-close-quality-anomaly]")?.addEventListener("click", () => { pageState.salesDataQualityGovernance.selected = null; render(); });
  root.querySelector("[data-quality-anomaly-decision]")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const selected = pageState.salesDataQualityGovernance.selected; if (!selected) return;
    pageState.salesDataQualityGovernance.saving = true; pageState.error = ""; render();
    try {
      await submitSalesDataQualityAnomalyDecision(selected.id, Object.fromEntries(new FormData(event.currentTarget)));
      pageState.salesDataQualityGovernance.selected = null;
      await loadSalesDataQualityGovernancePage(render, { page: pageState.salesDataQualityGovernance.pagination.page || 1 });
    } catch (error) { pageState.error = error.message; pageState.salesDataQualityGovernance.saving = false; render(); }
  });
  root.querySelector("[data-enter-relation-review]")?.addEventListener("click", async () => {
    const selected = pageState.relationGovernance.selected; if (!selected) return;
    selectConnectionSection("data-import"); render();
    await loadDataFoundation(render);
    try {
      if (selected.governanceType === "single") pageState.relationCandidates.selected = await loadSalesRelationCandidateDetail(selected.reviewTarget.id);
    } catch (error) { pageState.error = error.message; }
    render();
  });
  root.querySelector("[data-link-distribution-filter]")?.addEventListener("submit", (event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    void loadSalesDistribution(render, { scope: String(data.get("scope") || "mine") });
  });
  root.querySelectorAll("[data-distribution-group]").forEach((element) => element.addEventListener("click", () => {
    pageState.salesDistribution = { ...pageState.salesDistribution, selectedGroup: Number(element.dataset.distributionGroup), selectedRange: null, drillTable: null }; render();
  }));
  root.querySelectorAll("[data-distribution-range]").forEach((element) => element.addEventListener("click", () => {
    const [start, end] = String(element.dataset.distributionRange || "").split("-").map(Number);
    if (!start || !end) return;
    const ids = String(element.dataset.distributionLinkIds || "").split(",").filter(Boolean);
    void loadDistributionRangeTable(render, start, end, ids);
  }));
  let distributionTooltip = document.querySelector(".distribution-link-hover-card");
  if (!distributionTooltip) {
    distributionTooltip = document.createElement("div");
    distributionTooltip.className = "distribution-link-hover-card is-hidden";
    distributionTooltip.innerHTML = `<div class="distribution-link-hover-card-media"><img alt="" hidden /><span>暂无主图</span></div><div class="distribution-link-hover-card-body"><strong></strong><span data-distribution-tooltip-shop></span><div><b data-distribution-tooltip-sales></b><em data-distribution-tooltip-share></em></div><small>点击进入链接详情 →</small></div>`;
    document.body.appendChild(distributionTooltip);
  }
  distributionTooltip.classList.add("is-hidden");
  let distributionTooltipCloseTimer = null;
  const cancelDistributionTooltipClose = () => {
    window.clearTimeout(distributionTooltipCloseTimer);
    distributionTooltipCloseTimer = null;
  };
  const hideDistributionTooltip = () => {
    cancelDistributionTooltipClose();
    distributionTooltip.classList.add("is-hidden");
  };
  const scheduleDistributionTooltipClose = () => {
    cancelDistributionTooltipClose();
    distributionTooltipCloseTimer = window.setTimeout(() => {
      const activeBar = root.querySelector(`[data-distribution-bar][data-open-connection="${CSS.escape(distributionTooltip.dataset.connectionId || "")}"]`);
      if (activeBar?.matches(":hover") || distributionTooltip.matches(":hover")) return;
      hideDistributionTooltip();
    }, 140);
  };
  distributionTooltip.onmouseenter = cancelDistributionTooltipClose;
  distributionTooltip.onmouseleave = scheduleDistributionTooltipClose;
  distributionTooltip.onclick = () => {
    const connectionId = distributionTooltip.dataset.connectionId || "";
    if (!connectionId) return;
    hideDistributionTooltip();
    pageState.detailReturnSection = "cockpit";
    void openConnection(connectionId, render);
  };
  const distributionBarFromEvent = (event) => event.target instanceof Element
    ? event.target.closest("[data-distribution-bar]")
    : null;
  const positionDistributionTooltip = (bar, event) => {
      const barBounds = bar.getBoundingClientRect();
      const clientX = Number.isFinite(event?.clientX) ? event.clientX : barBounds.left + barBounds.width / 2;
      const clientY = Number.isFinite(event?.clientY) ? event.clientY : barBounds.top;
      const margin = 12;
      let left = clientX + 16;
      let top = clientY + 14;
      if (left + distributionTooltip.offsetWidth > window.innerWidth - margin) left = clientX - distributionTooltip.offsetWidth - 16;
      if (top + distributionTooltip.offsetHeight > window.innerHeight - margin) top = clientY - distributionTooltip.offsetHeight - 14;
      distributionTooltip.style.left = `${Math.max(margin, left)}px`;
      distributionTooltip.style.top = `${Math.max(margin, top)}px`;
  };
  const showDistributionTooltip = (bar, event) => {
      cancelDistributionTooltipClose();
      distributionTooltip.dataset.connectionId = bar.dataset.openConnection || "";
      const image = distributionTooltip.querySelector("img");
      const imagePlaceholder = distributionTooltip.querySelector(".distribution-link-hover-card-media span");
      const imageUrl = bar.dataset.linkImage || "";
      image.hidden = !imageUrl;
      imagePlaceholder.hidden = Boolean(imageUrl);
      image.onerror = () => { image.hidden = true; imagePlaceholder.hidden = false; };
      if (imageUrl) image.src = resolveAssetUrl(imageUrl);
      distributionTooltip.querySelector("strong").textContent = bar.dataset.linkName || "未命名链接";
      distributionTooltip.querySelector("[data-distribution-tooltip-shop]").textContent = [bar.dataset.linkPlatform, bar.dataset.linkShop].filter(Boolean).join(" · ") || "店铺信息未设置";
      distributionTooltip.querySelector("[data-distribution-tooltip-sales]").textContent = bar.dataset.salesLabel || "暂无数据";
      distributionTooltip.querySelector("[data-distribution-tooltip-share]").textContent = `第${bar.dataset.linkRank || "—"}名 · 占比 ${bar.dataset.percentageLabel || "暂无数据"}`;
      distributionTooltip.classList.remove("is-hidden");
      positionDistributionTooltip(bar, event);
  };
  root.addEventListener("pointerover", (event) => {
    const bar = distributionBarFromEvent(event);
    if (!bar || bar.contains(event.relatedTarget)) return;
    showDistributionTooltip(bar, event);
  });
  root.addEventListener("pointermove", (event) => {
    const bar = distributionBarFromEvent(event);
    if (!bar) return;
    if (distributionTooltip.dataset.connectionId !== bar.dataset.openConnection || distributionTooltip.classList.contains("is-hidden")) {
      showDistributionTooltip(bar, event);
      return;
    }
    positionDistributionTooltip(bar, event);
  });
  root.addEventListener("pointerout", (event) => {
    const bar = distributionBarFromEvent(event);
    if (!bar || bar.contains(event.relatedTarget)) return;
    scheduleDistributionTooltipClose();
  });
  root.addEventListener("focusin", (event) => {
    const bar = distributionBarFromEvent(event);
    if (bar) showDistributionTooltip(bar, event);
  });
  root.addEventListener("focusout", (event) => {
    if (distributionBarFromEvent(event)) scheduleDistributionTooltipClose();
  });
  root.querySelector("[data-link-business-toolbar]")?.addEventListener("submit", (event) => {
    event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget));
    pageState.businessTable.range = { preset: String(data.preset || "7d"), startDate: String(data.startDate || ""), endDate: String(data.endDate || "") };
    pageState.businessTable.filters = { ...pageState.businessTable.filters, keyword: String(data.keyword || ""), platform: String(data.platform || ""),
      shopId: String(data.shopId || ""), ownerId: String(data.ownerId || ""), minSales: String(data.minSales || ""), maxSales: String(data.maxSales || ""),
      minProfit: String(data.minProfit || ""), maxProfit: String(data.maxProfit || ""), growthStatus: String(data.growthStatus || ""),
      minProfitMargin: String(data.minProfitMargin || ""), maxProfitMargin: String(data.maxProfitMargin || ""),
      includeHistorical: String(data.includeHistorical || "") };
    pageState.businessTable.pagination.page = 1; void loadLinkBusinessTablePage(render);
  });
  root.querySelectorAll("[data-business-preset]").forEach((button) => button.addEventListener("click", () => {
    const preset = button.dataset.businessPreset; pageState.businessTable.range = { ...pageState.businessTable.range, preset };
    if (preset === "custom") render(); else { pageState.businessTable.pagination.page = 1; void loadLinkBusinessTablePage(render); }
  }));
  root.querySelectorAll("[data-link-business-sort]").forEach((button) => button.addEventListener("click", () => {
    const field = button.dataset.linkBusinessSort; pageState.businessTable.sort = pageState.businessTable.sort.field === field
      ? { field, direction: pageState.businessTable.sort.direction === "asc" ? "desc" : "asc" } : { field, direction: "desc" };
    pageState.businessTable.pagination.page = 1; void loadLinkBusinessTablePage(render);
  }));
  root.querySelectorAll("[data-link-business-page]").forEach((button) => button.addEventListener("click", () => {
    const page = Number(button.dataset.linkBusinessPage); if (page < 1 || page > pageState.businessTable.pagination.totalPages) return;
    pageState.businessTable.pagination.page = page; void loadLinkBusinessTablePage(render);
  }));
  root.querySelector("[data-toggle-link-indicators]")?.addEventListener("click", () => { pageState.businessTable.indicatorOpen = true; render(); });
  root.querySelectorAll("[data-close-link-indicators]").forEach((element) => element.addEventListener("click", () => { pageState.businessTable.indicatorOpen = false; render(); }));
  root.querySelectorAll("[data-link-business-field]").forEach((checkbox) => checkbox.addEventListener("change", () => {
    const selected = [...root.querySelectorAll("[data-link-business-field]:checked")].map((item) => item.value);
    if (!selected.length) { checkbox.checked = true; return; }
    pageState.businessTable.visibleFields = pageState.businessTable.fieldOrder.filter((key) => selected.includes(key));
    render();
  }));
  const selectedFieldRows = [...root.querySelectorAll("[data-selected-link-business-field]")];
  let draggedLinkBusinessField = "";
  const clearLinkBusinessDropState = () => selectedFieldRows.forEach((item) => {
    item.classList.remove("is-dragging", "is-drop-before", "is-drop-after"); delete item.dataset.dropPosition;
  });
  selectedFieldRows.forEach((item) => {
    item.addEventListener("dragstart", (event) => {
      draggedLinkBusinessField = item.dataset.selectedLinkBusinessField || ""; item.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", draggedLinkBusinessField);
    });
    item.addEventListener("dragover", (event) => {
      if (!draggedLinkBusinessField || draggedLinkBusinessField === item.dataset.selectedLinkBusinessField) return;
      event.preventDefault(); event.dataTransfer.dropEffect = "move";
      selectedFieldRows.forEach((row) => row.classList.remove("is-drop-before", "is-drop-after"));
      const bounds = item.getBoundingClientRect(); const position = event.clientY >= bounds.top + bounds.height / 2 ? "after" : "before";
      item.dataset.dropPosition = position; item.classList.add(position === "after" ? "is-drop-after" : "is-drop-before");
    });
    item.addEventListener("drop", (event) => {
      event.preventDefault();
      const sourceField = draggedLinkBusinessField || event.dataTransfer.getData("text/plain");
      const next = reorderVisibleLinkBusinessField(pageState.businessTable.fieldOrder, pageState.businessTable.visibleFields,
        sourceField, item.dataset.selectedLinkBusinessField, item.dataset.dropPosition || "before");
      clearLinkBusinessDropState(); draggedLinkBusinessField = "";
      pageState.businessTable.fieldOrder = next.fieldOrder; pageState.businessTable.visibleFields = next.visibleFields; render();
    });
    item.addEventListener("dragend", () => { clearLinkBusinessDropState(); draggedLinkBusinessField = ""; });
  });
  root.querySelector("[data-reset-link-business-fields]")?.addEventListener("click", () => {
    pageState.businessTable.visibleFields = [...DEFAULT_LINK_BUSINESS_FIELDS]; pageState.businessTable.fieldOrder = LINK_BUSINESS_COLUMNS.map((item) => item.key); render();
  });
  root.querySelector("[data-save-link-business-fields]")?.addEventListener("click", () => {
    const selected = [...root.querySelectorAll("[data-link-business-field]:checked")].map((item) => item.value);
    if (selected.length) pageState.businessTable.visibleFields = pageState.businessTable.fieldOrder.filter((key) => selected.includes(key));
    saveLinkBusinessTableConfig(); pageState.businessTable.indicatorOpen = false; void loadLinkBusinessTablePage(render);
  });
  root.querySelector("[data-clear-link-business-filters]")?.addEventListener("click", () => {
    pageState.businessTable.filters = { keyword: "", platform: "", shopId: "", ownerId: "", minSales: "", maxSales: "", minProfit: "", maxProfit: "", minProfitMargin: "", maxProfitMargin: "", growthStatus: "", includeHistorical: "" };
    pageState.businessTable.pagination.page = 1; void loadLinkBusinessTablePage(render);
  });
  root.querySelector("[data-distribution-back]")?.addEventListener("click", (event) => {
    pageState.salesDistribution = { ...pageState.salesDistribution, selectedGroup: event.currentTarget.dataset.distributionBack === "all" ? 0 : pageState.salesDistribution.selectedGroup,
      selectedRange: null, drillTable: null }; render();
  });
  root.querySelectorAll("[data-workbench-go]").forEach((button) => button.addEventListener("click", () => {
    const section = selectConnectionSection(button.dataset.workbenchGo); render(); ensureConnectionSectionLoaded(section, render);
  }));
  root.querySelectorAll("[data-workbench-my-filter]").forEach((button) => button.addEventListener("click", () => {
    selectConnectionSection("my-links"); void loadMyLinks(render, button.dataset.workbenchMyFilter); if (!pageState.linkDataStatus.loaded) void loadMyLinkDataStatus(render);
  }));
  root.querySelectorAll("[data-my-link-filter]").forEach((button) => button.addEventListener("click", () => { void loadMyLinks(render, button.dataset.myLinkFilter); }));
  root.querySelector("[data-link-data-toolbar]")?.addEventListener("submit", (event) => {
    event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
    pageState.myLinkTable.filters = { keyword: String(values.keyword || ""), platform: String(values.platform || ""),
      shopId: String(values.shopId || ""), archiveStatus: String(values.archiveStatus || "") };
    pageState.myLinkTable.range = { preset: String(values.preset || "7d"), startDate: String(values.startDate || ""), endDate: String(values.endDate || "") };
    if (pageState.myLinkTable.range.preset === "custom" && !pageState.myLinkTable.visibleFields.includes("selectedSales")) pageState.myLinkTable.visibleFields.push("selectedSales");
    pageState.myLinkTable.pagination.page = 1; void loadMyLinks(render);
  });
  root.querySelectorAll("[data-link-data-preset]").forEach((button) => button.addEventListener("click", () => {
    const preset = button.dataset.linkDataPreset; pageState.myLinkTable.range = { ...pageState.myLinkTable.range, preset };
    if (preset === "custom") render(); else { pageState.myLinkTable.pagination.page = 1; void loadMyLinks(render); }
  }));
  root.querySelector("[data-clear-link-data-filters]")?.addEventListener("click", () => {
    pageState.myLinkTable.filters = { keyword: "", platform: "", shopId: "", archiveStatus: "" };
    pageState.myLinkTable.range = { preset: "7d", startDate: "", endDate: "" };
    pageState.myLinkTable.pagination.page = 1; void loadMyLinks(render);
  });
  root.querySelectorAll("[data-link-table-sort]").forEach((button) => button.addEventListener("click", () => {
    const field = button.dataset.linkTableSort; const current = pageState.myLinkTable.sort;
    pageState.myLinkTable.sort = { field, direction: current.field === field && current.direction === "desc" ? "asc" : "desc" };
    pageState.myLinkTable.pagination.page = 1; void loadMyLinks(render);
  }));
  root.querySelectorAll("[data-link-table-page]").forEach((button) => button.addEventListener("click", () => {
    const page = Number(button.dataset.linkTablePage); if (page < 1 || page > pageState.myLinkTable.pagination.totalPages) return;
    pageState.myLinkTable.pagination.page = page; void loadMyLinks(render);
  }));
  root.querySelectorAll("[data-link-table-field]").forEach((checkbox) => checkbox.addEventListener("change", () => {
    const selected = [...root.querySelectorAll("[data-link-table-field]:checked")].map((item) => item.value);
    if (!selected.length) { checkbox.checked = true; return; }
    pageState.myLinkTable.visibleFields = selected; pageState.myLinkTable.columnSettingOpen = true; render();
  }));
  root.querySelectorAll("[data-move-link-field]").forEach((button) => button.addEventListener("click", () => {
    const key = button.dataset.moveLinkField; const order = [...pageState.myLinkTable.fieldOrder]; const index = order.indexOf(key);
    const next = button.dataset.direction === "up" ? index - 1 : index + 1;
    if (index < 0 || next < 0 || next >= order.length) return;
    [order[index], order[next]] = [order[next], order[index]]; pageState.myLinkTable.fieldOrder = order; pageState.myLinkTable.columnSettingOpen = true; render();
  }));
  root.querySelector(".link-column-setting-module")?.addEventListener("toggle", (event) => { pageState.myLinkTable.columnSettingOpen = event.currentTarget.open; });
  root.querySelector("[data-save-link-fields]")?.addEventListener("click", () => { saveMyLinkTableConfig(); pageState.myLinkTable.columnSettingOpen = false; render(); });
  root.querySelector("[data-reset-link-fields]")?.addEventListener("click", () => {
    pageState.myLinkTable.visibleFields = [...DEFAULT_MINE_LINK_FIELDS]; pageState.myLinkTable.fieldOrder = LINK_DATA_COLUMNS.map((item) => item.key);
    pageState.myLinkTable.columnSettingOpen = false; saveMyLinkTableConfig(); render();
  });
  root.querySelectorAll("[data-link-image]").forEach((image) => image.addEventListener("error", () => image.closest(".link-image-module")?.classList.add("is-error"), { once: true }));
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
  root.querySelector("[data-open-business-import]")?.addEventListener("click", () => { selectConnectionSection("data-import"); void loadDataFoundation(render); });
  root.querySelector("[data-connection-owner-import-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    pageState.ownerImport.loading = true; pageState.error = ""; render();
    try { pageState.ownerImport.result = await previewConnectionOwnerImport(form.get("file"), form.get("ownerId")); }
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
    const button = event.currentTarget; const preview = pageState.ownerImport.result?.preview || {};
    const requiresOverwrite = Number(preview.reassignmentRows || 0) > 0;
    if (requiresOverwrite && !window.confirm(`其中 ${preview.reassignmentRows} 个链接已有负责人，确认要变更为「${preview.selectedOwnerName || "所选负责人"}」吗？`)) return;
    pageState.ownerImport.loading = true; pageState.error = ""; render();
    try {
      const result = await confirmConnectionOwnerImport(button.dataset.confirmOwnerImport, { confirmOverwrite: requiresOverwrite });
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
  root.querySelector("[data-return-connection-center]")?.addEventListener("click", () => { selectConnectionSection("cockpit"); pageState.ownerImport.showCompletion = false; render(); });
  root.querySelector("[data-continue-owner-import]")?.addEventListener("click", () => { pageState.ownerImport = { loading: false, result: null, showCompletion: false }; render(); });
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
    pageState.listFilters = { search: "", platform: "", shopId: "", productCode: "", ownerId: "", status: "", salesStatus: "", profitStatus: "", productRelation: "", skuCount: "", includeHistorical: "" }; pageState.pagination.page = 1; void loadConnectionAssetsPage(render);
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
  root.querySelector("[data-goal-workbench-filters]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void loadGoalWorkbenchPage(render, { filters: Object.fromEntries(new FormData(event.currentTarget)), pagination: { page: 1 } });
  });
  root.querySelectorAll("[data-goal-workbench-select]").forEach((checkbox) => checkbox.addEventListener("change", () => {
    const selectedIds = new Set(pageState.goalWorkbench.selectedIds);
    if (checkbox.checked) selectedIds.add(checkbox.dataset.goalWorkbenchSelect); else selectedIds.delete(checkbox.dataset.goalWorkbenchSelect);
    pageState.goalWorkbench = { ...pageState.goalWorkbench, selectedIds }; render();
  }));
  root.querySelector("[data-goal-workbench-select-all]")?.addEventListener("change", (event) => {
    const selectedIds = new Set(pageState.goalWorkbench.selectedIds);
    pageState.goalWorkbench.items.filter((item) => item.canManage).forEach((item) => { if (event.currentTarget.checked) selectedIds.add(item.id); else selectedIds.delete(item.id); });
    pageState.goalWorkbench = { ...pageState.goalWorkbench, selectedIds }; render();
  });
  root.querySelectorAll("[data-goal-workbench-page]").forEach((button) => button.addEventListener("click", () => {
    const page = Number(button.dataset.goalWorkbenchPage);
    if (page < 1 || page > pageState.goalWorkbench.pagination.totalPages) return;
    void loadGoalWorkbenchPage(render, { pagination: { page } });
  }));
  root.querySelector("[data-goal-workbench-positioning]")?.addEventListener("submit", (event) => {
    event.preventDefault(); const input = Object.fromEntries(new FormData(event.currentTarget));
    void runGoalWorkbenchBatch(render, (connectionIds) => batchSetConnectionGoalPositioning({ connectionIds, ...input }));
  });
  root.querySelector("[data-goal-workbench-suggest]")?.addEventListener("click", () => {
    if (!window.confirm("为已选链接生成目标建议？建议不会自动生效。")) return;
    void runGoalWorkbenchBatch(render, (connectionIds) => batchGenerateConnectionGoalSuggestions({ connectionIds }));
  });
  root.querySelector("[data-goal-workbench-confirm]")?.addEventListener("click", () => {
    if (!window.confirm("按系统建议批量确认目标并使其生效？仅待确认建议会被处理。")) return;
    void runGoalWorkbenchBatch(render, (connectionIds) => batchConfirmConnectionGoals({ connectionIds, approvalReason: "链接经营管理工作台批量确认" }));
  });
  root.querySelectorAll("[data-contribution-page]").forEach(button=>button.addEventListener("click",()=>{contributionPage=Number(button.dataset.contributionPage);render();}));
  root.querySelector("[data-contribution-rules]")?.addEventListener("submit",async(event)=>{
    event.preventDefault();const form=new FormData(event.currentTarget);
    try{await saveLinkContributionRules({mode:form.get("mode"),firstRatingDate:form.get("firstRatingDate"),thresholds:Object.fromEntries(["S","A","B","C"].map(k=>[k,Number(form.get(k))]))});await loadContributionPage(render);}
    catch(error){contributionError=error.message;render();}
  });
  root.querySelector("[data-contribution-run]")?.addEventListener("click",async(event)=>{
    event.currentTarget.disabled=true;
    try{const result=await runLinkContributions();await loadContributionPage(render);if(result.skipped){contributionError=result.skipped;render();}}
    catch(error){contributionError=error.message;render();}
  });
  root.querySelectorAll("[data-goal-management-tab]").forEach((button) => button.addEventListener("click", () => {
    pageState.goalManagementTab = button.dataset.goalManagementTab;
    if (pageState.goalManagementTab === "pilots") void loadGoalPilotPage(render); else void loadGoalWorkbenchPage(render);
  }));
  root.querySelector("[data-goal-pilot-create]")?.addEventListener("submit", (event) => {
    event.preventDefault(); const input = Object.fromEntries(new FormData(event.currentTarget));
    void runGoalPilotOperation(render, async () => {
      const result = await createConnectionGoalPilotBatch(input); pageState.goalPilot.selectedBatchId = result.item.id;
    });
  });
  root.querySelector("[data-goal-pilot-batch-select]")?.addEventListener("change", (event) => {
    pageState.goalPilot.selectedBatchId = event.currentTarget.value; pageState.goalPilot.memberPagination.page = 1;
    void loadGoalPilotPage(render, { selectedBatchId: event.currentTarget.value, memberPage: 1 });
  });
  root.querySelector("[data-goal-pilot-advance]")?.addEventListener("click", (event) => {
    const status = event.currentTarget.dataset.goalPilotAdvance;
    if (!window.confirm(`确认将批次推进到“${goalPilotBatchStatusLabels[status]}”？批次历史会保留。`)) return;
    void runGoalPilotOperation(render, () => updateConnectionGoalPilotBatch(pageState.goalPilot.selectedBatchId, { status }));
  });
  root.querySelector("[data-goal-pilot-toggle-candidates]")?.addEventListener("click", () => {
    pageState.goalPilot.showCandidates = !pageState.goalPilot.showCandidates; render();
    if (pageState.goalPilot.showCandidates) void loadGoalPilotCandidatePage(render, { page: 1 });
  });
  root.querySelector("[data-goal-pilot-candidate-filter]")?.addEventListener("submit", (event) => {
    event.preventDefault(); pageState.goalPilot.candidateFilters = Object.fromEntries(new FormData(event.currentTarget));
    void loadGoalPilotCandidatePage(render, { page: 1 });
  });
  root.querySelectorAll("[data-goal-pilot-candidate]").forEach((checkbox) => checkbox.addEventListener("change", () => {
    const selected = new Set(pageState.goalPilot.candidateSelectedIds);
    if (checkbox.checked) selected.add(checkbox.dataset.goalPilotCandidate); else selected.delete(checkbox.dataset.goalPilotCandidate);
    pageState.goalPilot.candidateSelectedIds = selected; render();
  }));
  root.querySelector("[data-goal-pilot-add-candidates]")?.addEventListener("click", () => {
    const connectionIds = [...pageState.goalPilot.candidateSelectedIds];
    void runGoalPilotOperation(render, () => addConnectionGoalPilotLinks(pageState.goalPilot.selectedBatchId, connectionIds));
  });
  root.querySelector("[data-goal-pilot-member-filter]")?.addEventListener("submit", (event) => {
    event.preventDefault(); pageState.goalPilot.memberFilters = Object.fromEntries(new FormData(event.currentTarget));
    pageState.goalPilot.memberPagination.page = 1; void loadGoalPilotPage(render, { memberPage: 1 });
  });
  root.querySelectorAll("[data-goal-pilot-member-page]").forEach((button) => button.addEventListener("click", () => {
    const page = Number(button.dataset.goalPilotMemberPage); if (page < 1 || page > pageState.goalPilot.memberPagination.totalPages) return;
    pageState.goalPilot.memberPagination.page = page; void loadGoalPilotPage(render, { memberPage: page });
  }));
  root.querySelectorAll("[data-goal-pilot-candidate-page]").forEach((button) => button.addEventListener("click", () => {
    const page = Number(button.dataset.goalPilotCandidatePage); if (page < 1 || page > pageState.goalPilot.candidatePagination.totalPages) return;
    pageState.goalPilot.candidatePagination.page = page; void loadGoalPilotCandidatePage(render, { page });
  }));
  root.querySelectorAll("[data-goal-pilot-positioning]").forEach((form) => form.addEventListener("submit", (event) => {
    event.preventDefault(); const input = Object.fromEntries(new FormData(event.currentTarget));
    void runGoalPilotOperation(render, () => confirmConnectionGoalPilotPositioning(pageState.goalPilot.selectedBatchId, form.dataset.memberId, input));
  }));
  root.querySelectorAll("[data-goal-pilot-suggestion]").forEach((button) => button.addEventListener("click", () => {
    void runGoalPilotOperation(render, () => createConnectionGoalPilotSuggestion(pageState.goalPilot.selectedBatchId, button.dataset.goalPilotSuggestion));
  }));
  root.querySelectorAll("[data-goal-pilot-target]").forEach((form) => {
    const syncProfitTarget = () => {
      const sales = Number(form.elements.salesAmount?.value);
      const margin = Number(form.elements.profitMargin?.value);
      const target = form.querySelector("[data-goal-pilot-profit-target]");
      if (target) target.value = Number.isFinite(sales) && Number.isFinite(margin) ? (sales * margin / 100).toFixed(2) : "";
    };
    form.querySelectorAll('[name="salesAmount"], [name="profitMargin"]').forEach((input) => input.addEventListener("input", syncProfitTarget));
    form.addEventListener("submit", (event) => {
      event.preventDefault(); const input = { ...Object.fromEntries(new FormData(event.currentTarget)), planId: form.dataset.planId };
      void runGoalPilotOperation(render, () => confirmConnectionGoalPilotTarget(pageState.goalPilot.selectedBatchId, form.dataset.memberId, input));
    });
  });
  root.querySelectorAll("[data-goal-pilot-exclude]").forEach((button) => button.addEventListener("click", () => {
    if (!window.confirm("确认从当前试点范围排除该链接？历史记录仍会保留。")) return;
    void runGoalPilotOperation(render, () => excludeConnectionGoalPilotMember(pageState.goalPilot.selectedBatchId, button.dataset.goalPilotExclude));
  }));
  root.querySelectorAll("[data-open-connection]").forEach((element) => {
    const open = () => { pageState.detailReturnSection = element.dataset.returnSection || pageState.section || "connections"; void openConnection(element.dataset.openConnection, render); };
    element.addEventListener("click", open);
    element.addEventListener("keydown", (event) => { if (["Enter", " "].includes(event.key)) open(); });
  });
  root.querySelector('[data-action="back-connections"]')?.addEventListener("click", () => { selectConnectionSection(pageState.detailReturnSection || "connections"); render(); });
  root.querySelectorAll("[data-retry-connection-goal-module]").forEach((button) => button.addEventListener("click", () => {
    void loadConnectionGoalModule(pageState.selectedId, button.dataset.retryConnectionGoalModule, render);
  }));
  root.querySelector("[data-inspection-start]")?.addEventListener("click", async () => {
    try {
      const result = pageState.inspection.data?.draft || (await startConnectionInspection(pageState.selectedId, {
        taskId: pageState.inspectionTaskId || undefined,
      })).item;
      pageState.inspection = { ...pageState.inspection, active: result, mode: "edit", error: "" }; render();
    } catch (error) { pageState.inspection = { ...pageState.inspection, error: error.message }; render(); }
  });
  root.querySelector("[data-inspection-cancel]")?.addEventListener("click", () => { pageState.inspection = { ...pageState.inspection, mode: "summary" }; render(); });
  root.querySelector("[data-inspection-history-back]")?.addEventListener("click", () => { pageState.inspection = { ...pageState.inspection, historyDetail: null, mode: "history" }; render(); });
  root.querySelector("[data-inspection-history-toggle]")?.addEventListener("click", () => { pageState.inspection = { ...pageState.inspection, mode: pageState.inspection.mode === "history" ? "summary" : "history" }; render(); });
  root.querySelector("[data-inspection-schedule-toggle]")?.addEventListener("click", () => { pageState.inspection = { ...pageState.inspection, mode: pageState.inspection.mode === "schedule" ? "summary" : "schedule" }; render(); });
  root.querySelectorAll("[data-inspection-history-id]").forEach((button) => button.addEventListener("click", async () => {
    try {
      const result = await loadConnectionInspection(pageState.selectedId, button.dataset.inspectionHistoryId);
      pageState.inspection = { ...pageState.inspection, historyDetail: result.item, mode: "history-detail" }; render();
    } catch (error) { pageState.inspection = { ...pageState.inspection, error: error.message }; render(); }
  }));
  const inspectionForm = root.querySelector("[data-connection-inspection-form]");
  const readInspectionAnswers = () => (pageState.inspection.active?.results || []).map((result) => ({
    id: result.id,
    grade: inspectionForm?.querySelector(`input[name="grade-${result.id}"]:checked`)?.value || "",
    note: inspectionForm?.querySelector(`[name="note-${result.id}"]`)?.value || "",
  }));
  root.querySelector("[data-inspection-save-draft]")?.addEventListener("click", async () => {
    try {
      const result = await saveConnectionInspectionDraft(pageState.selectedId, pageState.inspection.active.id, readInspectionAnswers());
      pageState.inspection = { ...pageState.inspection, active: result.item, mode: "edit", error: "" }; render();
    } catch (error) { pageState.inspection = { ...pageState.inspection, error: error.message }; render(); }
  });
  root.querySelector("[data-inspection-complete]")?.addEventListener("click", async () => {
    try {
      const answers = readInspectionAnswers();
      if (answers.some((item) => !item.grade)) throw new Error("完成体检前必须为30个核心标准全部评分。");
      await completeConnectionInspection(pageState.selectedId, pageState.inspection.active.id, answers);
      pageState.inspection = { ...pageState.inspection, active: null, mode: "summary", error: "" };
      await reloadConnectionInspection(render);
    } catch (error) { pageState.inspection = { ...pageState.inspection, error: error.message }; render(); }
  });
  root.querySelectorAll("[data-inspection-issue]").forEach((checkbox) => checkbox.addEventListener("change", () => {
    const selectedIssues = new Set(pageState.inspection.selectedIssues);
    if (checkbox.checked) selectedIssues.add(checkbox.value); else selectedIssues.delete(checkbox.value);
    pageState.inspection = { ...pageState.inspection, selectedIssues }; render();
  }));
  root.querySelector("[data-inspection-action-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const input = Object.fromEntries(new FormData(event.currentTarget));
      input.issueIds = [...pageState.inspection.selectedIssues]; input.createTask = input.createTask === "true";
      await createConnectionInspectionAction(pageState.selectedId, input);
      await reloadConnectionInspection(render);
    } catch (error) { pageState.inspection = { ...pageState.inspection, error: error.message }; render(); }
  });
  root.querySelector("[data-inspection-schedule-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const input = Object.fromEntries(new FormData(event.currentTarget));
      await saveConnectionInspectionSchedule(pageState.selectedId, input);
      pageState.inspection = { ...pageState.inspection, mode: "summary" };
      await reloadConnectionInspection(render);
    } catch (error) { pageState.inspection = { ...pageState.inspection, error: error.message }; render(); }
  });
  root.querySelector("[data-connection-profile-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await updateConnection(pageState.selectedId, Object.fromEntries(new FormData(event.currentTarget)));
      pageState.items = pageState.items.map((item) => item.id === result.item.id ? { ...item, ...result.item } : item);
      pageState.error = ""; render();
    } catch (error) { pageState.error = error.message; render(); }
  });
  root.querySelector("[data-create-connection-goal]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget; button.disabled = true;
    try {
      const result = await createConnectionBusinessGoalSuggestion(pageState.selectedId);
      pageState.coreDetail = { ...pageState.coreDetail, businessGoals: result };
      pageState.error = ""; render();
    } catch (error) { pageState.error = error.message; button.disabled = false; render(); }
  });
  const goalConfirmForm = root.querySelector("[data-connection-goal-confirm-form]");
  const syncGoalProfitTarget = () => {
    if (!goalConfirmForm) return;
    const sales = Number(goalConfirmForm.elements.salesAmount?.value);
    const margin = Number(goalConfirmForm.elements.profitMargin?.value);
    const target = goalConfirmForm.querySelector("[data-goal-profit-target]");
    if (target) target.value = Number.isFinite(sales) && Number.isFinite(margin) ? (sales * margin / 100).toFixed(2) : "";
  };
  goalConfirmForm?.querySelectorAll('[name="salesAmount"], [name="profitMargin"]').forEach((input) => input.addEventListener("input", syncGoalProfitTarget));
  goalConfirmForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget; const button = form.querySelector("button[type='submit']");
    if (button) button.disabled = true;
    try {
      const result = await confirmConnectionBusinessGoal(pageState.selectedId, form.dataset.planId, Object.fromEntries(new FormData(form)));
      const businessGoalEvaluation = await loadConnectionBusinessGoalEvaluation(pageState.selectedId);
      pageState.coreDetail = { ...pageState.coreDetail, businessGoals: result, businessGoalEvaluation };
      pageState.error = ""; render();
    } catch (error) { pageState.error = error.message; if (button) button.disabled = false; render(); }
  });
  root.querySelector("[data-refresh-link-rating]")?.addEventListener("click", async (event) => {
    if (!canRefreshRating()) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const businessGoalEvaluation = await refreshConnectionBusinessGoalEvaluation(pageState.selectedId);
      pageState.coreDetail = { ...pageState.coreDetail, businessGoalEvaluation };
      pageState.error = "";
    } catch (error) {
      pageState.error = error.message;
    }
    render();
  });
  root.querySelectorAll("[data-connection-tab]").forEach((button) => button.addEventListener("click", async () => {
    pageState.detailTab = button.dataset.connectionTab; render();
    if (pageState.detailLoaded.has(pageState.detailTab)) return;
    try {
      if (pageState.detailTab === "sales") { const [snapshots, analysis] = await Promise.all([loadConnectionPeriodSnapshots(pageState.selectedId), loadConnectionGrowthAnalysis(pageState.selectedId), loadDailySales(() => {})]); pageState.periodSnapshots = snapshots.items ?? []; pageState.growthAnalysis = analysis.item; }
      if (pageState.detailTab === "advanced") await loadBenchmarks(() => {});
      pageState.detailLoaded.add(pageState.detailTab); pageState.error = ""; render();
    } catch (error) { pageState.error = error.message; render(); }
  }));
  root.querySelectorAll("[data-sales-period-type]").forEach((button) => button.addEventListener("click", () => { pageState.salesPeriodType = button.dataset.salesPeriodType; render(); }));
  root.querySelectorAll("[data-daily-sales-range]").forEach((button) => button.addEventListener("click", () => {
    const preset = button.dataset.dailySalesRange;
    if (preset === "custom") { pageState.dailySales = { ...pageState.dailySales, rangePreset: preset }; render(); }
    else void loadDailySales(render, preset);
  }));
  root.querySelector("[data-daily-sales-range-form]")?.addEventListener("submit", (event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    void loadDailySales(render, "custom", { startDate: String(data.get("startDate") || ""), endDate: String(data.get("endDate") || "") });
  });
  root.querySelectorAll("[data-cockpit-range-preset]").forEach((button) => button.addEventListener("click", () => {
    pageState.cockpitRange = { ...pageState.cockpitRange, preset: button.dataset.cockpitRangePreset, loading: false };
    if (button.dataset.cockpitRangePreset === "custom") render(); else void loadBusinessCockpitPage(render);
  }));
  root.querySelector("[data-cockpit-global-range]")?.addEventListener("change", (event) => {
    if (!event.target.matches("input[type='date']")) return;
    const data = new FormData(event.currentTarget); const startDate = String(data.get("startDate") || ""); const endDate = String(data.get("endDate") || "");
    if (!startDate || !endDate) return;
    pageState.cockpitRange = { preset: "custom", startDate, endDate, loading: false };
    void loadBusinessCockpitPage(render);
  });
  root.querySelectorAll("[data-cockpit-period]").forEach((button) => button.addEventListener("click", () => { pageState.cockpit.periodType = button.dataset.cockpitPeriod; render(); }));
  root.querySelector("[data-expand-cockpit]")?.addEventListener("click", () => {
    pageState.cockpitExpanded = true; render(); void loadCockpitProductChannels(render);
  });
  root.querySelector("[data-collapse-cockpit]")?.addEventListener("click", () => { pageState.cockpitExpanded = false; render(); });
  root.querySelectorAll("[data-shop-share-metric]").forEach((button) => button.addEventListener("click", () => {
    pageState.cockpitShopShareMetric = button.dataset.shopShareMetric === "profitAmount" ? "profitAmount" : "salesAmount";
    render();
  }));
  root.querySelectorAll("[data-shop-share-slice]").forEach((slice) => {
    const selectShop = () => { pageState.cockpitShopShareSelectedId = slice.dataset.shopShareSlice; render(); };
    slice.addEventListener("click", selectShop);
    slice.addEventListener("keydown", (event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); selectShop(); } });
  });
  root.querySelectorAll("[data-goal-health-drill]").forEach((button) => button.addEventListener("click", () => {
    const filters = { keyword: "", positioning: button.dataset.positioning || "", goalStatus: "", evaluationStatus: "", ownerId: "" };
    if (button.dataset.goalHealthDrill === "goal-pending") filters.goalStatus = "pending";
    if (button.dataset.goalHealthDrill === "grade") filters.evaluationStatus = button.dataset.evaluationStatus || "underperforming";
    selectConnectionSection("goal-management");
    void loadContributionPage(render);
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
  root.querySelector("[data-connection-action-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try { const result = await createConnectionAction(pageState.selectedId, Object.fromEntries(form)); pageState.actions.unshift(result.item); pageState.error = ""; render(); } catch (error) { pageState.error = error.message; render(); }
  });
  root.querySelectorAll("[data-connection-action-status]").forEach((select) => select.addEventListener("change", async () => {
    try {
      const result = await updateConnectionAction(pageState.selectedId, select.dataset.connectionActionStatus, { status: select.value });
      pageState.actions = pageState.actions.map((item) => item.id === result.item.id ? result.item : item);
      await reloadConnectionInspection(render);
    } catch (error) { pageState.error = error.message; render(); }
  }));
  root.querySelectorAll("[data-delete-connection-action]").forEach((button) => button.addEventListener("click", async () => {
    if (!window.confirm("确认删除这条经营动作？")) return;
    try { await removeConnectionAction(pageState.selectedId, button.dataset.deleteConnectionAction); pageState.actions = pageState.actions.filter((item) => item.id !== button.dataset.deleteConnectionAction); render(); } catch (error) { pageState.error = error.message; render(); }
  }));
  root.querySelector("[data-foundation-bulk-import-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const files = event.currentTarget.querySelector('input[name="files"]')?.files; pageState.foundation.loading = true; pageState.error = ""; render();
    try {
      const result = await uploadConnectionFoundationBulkImport(files); pageState.foundation.bulkPreview = result; pageState.foundation.loading = false; render();
      if (result.idempotent && ["completed", "completed_with_errors"].includes(result.batch?.status)) window.alert("该组文件已经完成导入，本次未重复写入。");
      else void pollConnectionBulkPreview(result.batch.id, render);
    } catch (error) { pageState.error = error.message; pageState.foundation.loading = false; render(); }
  });
  root.querySelector("[data-platform-goods-excel-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = event.currentTarget.querySelector('input[name="file"]')?.files?.[0];
    if (!file || !pageState.platformGoodsImport.taskId) return;
    pageState.platformGoodsImport = { ...pageState.platformGoodsImport, loading: true, error: "", message: "" }; render();
    try {
      pageState.platformGoodsImport.preview = await previewPlatformGoodsExcelDataSync(pageState.platformGoodsImport.taskId, { file });
      pageState.platformGoodsImport.message = pageState.platformGoodsImport.preview.duplicateFile ? "检测到相同文件：请查看历史结果，或选择“重新分析”按当前数据状态生成新预览。" : "平台货品资产差异已生成。";
    } catch (error) {
      pageState.platformGoodsImport.error = error.message || "平台货品Excel预览失败。";
    } finally {
      pageState.platformGoodsImport.loading = false; render();
    }
  });
  root.querySelectorAll("[data-view-platform-goods-history]").forEach((button) => button.addEventListener("click", async () => {
    const batchId = button.dataset.viewPlatformGoodsHistory;
    if (!batchId) return;
    pageState.platformGoodsImport = { ...pageState.platformGoodsImport, loading: true, error: "", message: "" }; render();
    try {
      pageState.platformGoodsImport.preview = await loadPlatformGoodsExcelDataSyncPreview(batchId);
      pageState.platformGoodsImport.message = "已显示所选历史分析结果，历史结果不会再次写入资产。";
    } catch (error) { pageState.platformGoodsImport.error = error.message || "历史分析结果读取失败。"; }
    finally { pageState.platformGoodsImport.loading = false; render(); }
  }));
  root.querySelectorAll("[data-reanalyze-platform-goods]").forEach((button) => button.addEventListener("click", async () => {
    const batchId = button.dataset.reanalyzePlatformGoods;
    if (!batchId) return;
    pageState.platformGoodsImport = { ...pageState.platformGoodsImport, loading: true, error: "", message: "" }; render();
    try {
      pageState.platformGoodsImport.preview = await reanalyzePlatformGoodsExcelDataSync(batchId);
      pageState.platformGoodsImport.message = "已重新读取原文件，并按当前数据库状态生成新的差异预览。";
    } catch (error) { pageState.platformGoodsImport.error = error.message || "平台货品资产重新分析失败。"; }
    finally { pageState.platformGoodsImport.loading = false; render(); }
  }));
  root.querySelector("[data-confirm-platform-goods-excel]")?.addEventListener("click", async (event) => {
    const batchId = event.currentTarget.dataset.confirmPlatformGoodsExcel;
    if (!batchId) return;
    pageState.platformGoodsImport = { ...pageState.platformGoodsImport, loading: true, error: "", message: "" }; render();
    try {
      const committed = await commitPlatformGoodsExcelDataSync(batchId);
      pageState.platformGoodsImport.preview = await loadPlatformGoodsExcelDataSyncPreview(batchId);
      invalidateLinkOperatingViews(committed.operatingSet);
      const operatingCount = Number(committed.operatingSet?.operatingCount || 0);
      pageState.platformGoodsImport.message = committed.platformSnapshot?.mode !== "full"
        ? `资产已同步，但该文件被识别为部分文件，不会替换当前经营Link基线。${committed.platformSnapshot?.reason ? `原因：${committed.platformSnapshot.reason}。` : ""}`
        : committed.idempotent
          ? `该完整平台批次已同步完成；当前经营Link已刷新为 ${operatingCount} 个。`
          : `平台货品资产已同步，当前经营Link已刷新为 ${operatingCount} 个；ERP关系候选已进入审核流程。`;
    } catch (error) {
      pageState.platformGoodsImport.error = error.message || "平台货品资产同步失败。";
    } finally {
      pageState.platformGoodsImport.loading = false; render();
    }
  });
  root.querySelector("[data-sales-daily-file]")?.addEventListener("change", (event) => {
    const file = event.currentTarget.files?.[0] || null;
    pageState.foundation.dailyFile = file;
    pageState.foundation.dailyFileName = file?.name || "";
    pageState.foundation.dailyError = "";
    pageState.foundation.dailyMessage = "";
  });
  root.querySelector("[data-sales-daily-import-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (pageState.foundation.dailyLoading) return;
    const file = event.currentTarget.querySelector('input[name="file"]')?.files?.[0] || pageState.foundation.dailyFile;
    if (!file) { pageState.foundation.dailyError = "请先选择销售日报文件。"; render(); return; }
    pageState.foundation.dailyFile = file; pageState.foundation.dailyFileName = file.name; pageState.foundation.dailyLoading = true; pageState.foundation.dailyError = ""; pageState.foundation.dailyMessage = ""; render();
    try {
      const result = await previewConnectionSalesDailyImport(file);
      pageState.foundation.dailyCategory = "ready";
      pageState.foundation.dailyPreview = await loadConnectionSalesDailyPreview(result.batch.id, { category: "ready", page: 1, pageSize: 50 });
      pageState.relationCandidates = { ...pageState.relationCandidates, ...await loadSalesRelationCandidates({ sourceBatchId: result.batch.id, status: "pending", page: 1, pageSize: 50 }), candidateType: "", selected: null, selectedIds: [], loading: false };
      pageState.foundation.dailyMessage = "已按当前链接、商品结构和ERP用途规则重新生成销售日报预览。";
    } catch (error) { pageState.foundation.dailyError = error.message || "销售日报预览失败。"; }
    finally { pageState.foundation.dailyLoading = false; render(); }
  });
  root.querySelectorAll("[data-daily-preview-category]").forEach((button) => button.addEventListener("click", async () => {
    const batchId = pageState.foundation.dailyPreview?.batch?.id;
    if (!batchId) return;
    pageState.foundation.dailyCategory = button.dataset.dailyPreviewCategory; pageState.foundation.dailyLoading = true; render();
    try { pageState.foundation.dailyPreview = await loadConnectionSalesDailyPreview(batchId, { category: pageState.foundation.dailyCategory, page: 1, pageSize: 50 }); }
    catch (error) { pageState.foundation.dailyError = error.message || "日报预览明细读取失败。"; }
    finally { pageState.foundation.dailyLoading = false; render(); }
  }));
  root.querySelector("[data-recalculate-sales-daily-preview]")?.addEventListener("click", async (event) => {
    if (pageState.foundation.dailyLoading || !window.confirm("确认基于原始预览行创建新的预览revision？")) return;
    pageState.foundation.dailyLoading = true; pageState.foundation.dailyError = ""; pageState.foundation.dailyMessage = ""; render();
    try {
      const result = await recalculateConnectionSalesDailyPreview(event.currentTarget.dataset.recalculateSalesDailyPreview);
      pageState.foundation.dailyCategory = "ready";
      pageState.foundation.dailyPreview = await loadConnectionSalesDailyPreview(result.batch.id, { category: "ready", page: 1, pageSize: 50 });
      pageState.relationCandidates = { ...pageState.relationCandidates, ...await loadSalesRelationCandidates({ sourceBatchId: result.batch.id, status: "pending", page: 1, pageSize: 50 }), candidateType: "", selected: null, selectedIds: [], loading: false };
      pageState.foundation.dailyMessage = `预览已重新计算为 第 ${result.summary?.previewRevision || "—"} 版。`;
    } catch (error) { pageState.foundation.dailyError = error.message || "销售日报预览重新计算失败。"; }
    finally { pageState.foundation.dailyLoading = false; render(); }
  });
  root.querySelector("[data-confirm-sales-daily-facts]")?.addEventListener("click", async (event) => {
    if (pageState.foundation.dailyCommitting || !window.confirm("确认重新校验并写入满足条件的销售日报事实？未确认用途、缺失关系和冲突数据不会写入。")) return;
    const batchId = event.currentTarget.dataset.confirmSalesDailyFacts;
    pageState.foundation.dailyCommitting = true; pageState.foundation.dailyError = ""; pageState.foundation.dailyMessage = ""; render();
    try {
      const result = await confirmConnectionSalesDailyFacts(batchId);
      pageState.foundation.dailyPreview = await loadConnectionSalesDailyPreview(batchId, { category: pageState.foundation.dailyCategory, page: 1, pageSize: 50 });
      pageState.foundation.dailyMessage = `日报事实写入完成：新增 ${result.result.insertedCount} 条，跳过 ${result.result.skippedCount} 条，待确认更新 ${result.result.updatePendingCount} 条。`;
      pageState.salesDailyQuality = { data: null, loading: false, loaded: false, error: "" };
      await Promise.all([loadBusinessCockpitPage(render), loadConnectionAssetsPage(render), loadSalesDailyQualityPanel(render)]);
    } catch (error) { pageState.foundation.dailyError = error.message || "销售日报事实写入失败。"; }
    finally { pageState.foundation.dailyCommitting = false; render(); }
  });
  root.querySelectorAll("[data-relation-candidate-type]").forEach((button) => button.addEventListener("click", async () => {
    const batchId = pageState.foundation.dailyPreview?.batch?.id; if (!batchId) return;
    pageState.relationCandidates.candidateType = button.dataset.relationCandidateType || ""; pageState.relationCandidates.loading = true; render();
    try { pageState.relationCandidates = { ...pageState.relationCandidates, ...await loadSalesRelationCandidates({ sourceBatchId: batchId, status: "pending", candidateType: pageState.relationCandidates.candidateType, page: 1, pageSize: 50 }), selected: null, selectedIds: [], loading: false }; }
    catch (error) { pageState.foundation.dailyError = error.message || "销售关系候选读取失败。"; pageState.relationCandidates.loading = false; }
    render();
  }));
  root.querySelectorAll("[data-view-relation-candidate]").forEach((button) => button.addEventListener("click", async () => {
    pageState.relationCandidates.loading = true; render();
    try { pageState.relationCandidates.selected = await loadSalesRelationCandidateDetail(button.dataset.viewRelationCandidate); }
    catch (error) { pageState.foundation.dailyError = error.message || "销售关系候选详情读取失败。"; }
    pageState.relationCandidates.loading = false; render();
  }));
  root.querySelector("[data-close-relation-candidate]")?.addEventListener("click", () => { pageState.relationCandidates.selected = null; render(); });
  root.querySelectorAll("[data-select-relation-candidate]").forEach((input) => input.addEventListener("change", () => {
    const selected = new Set(pageState.relationCandidates.selectedIds || []);
    if (input.checked) selected.add(input.dataset.selectRelationCandidate); else selected.delete(input.dataset.selectRelationCandidate);
    pageState.relationCandidates.selectedIds = [...selected]; render();
  }));
  const reloadRelationCandidates = async () => {
    const batchId = pageState.foundation.dailyPreview?.batch?.id; if (!batchId) return;
    const [candidateResult, previewResult] = await Promise.all([
      loadSalesRelationCandidates({ sourceBatchId: batchId, status: "pending", candidateType: pageState.relationCandidates.candidateType, page: 1, pageSize: 50 }),
      loadConnectionSalesDailyPreview(batchId, { category: pageState.foundation.dailyCategory, page: 1, pageSize: 50 }),
    ]);
    pageState.relationCandidates = { ...pageState.relationCandidates, ...candidateResult, selected: null, selectedIds: [], confirming: false };
    pageState.foundation.dailyPreview = previewResult;
  };
  root.querySelector("[data-confirm-relation-candidate]")?.addEventListener("click", async (event) => {
    if (pageState.relationCandidates.confirming || !window.confirm("确认创建这条单品平台规格—ERP商品编码关系？")) return;
    pageState.relationCandidates.confirming = true; pageState.foundation.dailyError = ""; render();
    try { await confirmSalesRelationCandidate(event.currentTarget.dataset.confirmRelationCandidate); await reloadRelationCandidates(); window.alert("单品关系已确认，日报预览已标记为需要重新计算。"); }
    catch (error) {
      pageState.foundation.dailyError = error.message || "单品关系确认失败。";
      try { await reloadRelationCandidates(); } catch { pageState.relationCandidates.confirming = false; }
    }
    render();
  });
  root.querySelector("[data-confirm-relation-candidate-batch]")?.addEventListener("click", async () => {
    const ids = pageState.relationCandidates.selectedIds || [];
    if (!ids.length || pageState.relationCandidates.confirming || !window.confirm(`确认创建所选 ${ids.length} 条单品关系？`)) return;
    pageState.relationCandidates.confirming = true; pageState.foundation.dailyError = ""; render();
    try { const result = await confirmSalesRelationCandidateBatch(ids); await reloadRelationCandidates(); window.alert(`批量确认完成：新建 ${result.summary?.created || 0} 条，冲突 ${result.summary?.conflicts || 0} 条。`); }
    catch (error) { pageState.foundation.dailyError = error.message || "单品关系批量确认失败。"; pageState.relationCandidates.confirming = false; }
    render();
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
}
