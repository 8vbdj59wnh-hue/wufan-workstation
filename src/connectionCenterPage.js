import {
  commitConnectionImport,
  confirmConnectionFoundationImport,
  confirmConnectionFoundationBulkImport,
  confirmConnectionSalesFactImport,
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
  previewConnectionSalesDailyImport,
  loadCurrentConnectionSalesDailyImport,
  loadSalesDailyDataQuality,
  loadConnectionSalesDailyPreview,
  recalculateConnectionSalesDailyPreview,
  confirmConnectionSalesDailyFacts,
  loadSalesRelationCandidates,
  loadSalesRelationGovernance,
  loadSalesDataQualityAnomalies,
  submitSalesDataQualityAnomalyDecision,
  loadSalesRelationCandidateDetail,
  confirmSalesRelationCandidate,
  confirmSalesRelationCandidateBatch,
  generatePendingComboReviews,
  loadComboReviews,
  loadComboReviewDetail,
  searchComboReviewErpSkus,
  saveComboReviewDraft,
  confirmComboReviewGroup,
  loadComboReviewAnomalyDates,
  loadComboReviewSourceRows,
  confirmConnectionOwnerImport,
  rebuildConnectionOwnerImportPreview,
  cancelConnectionOwnerImport,
  loadConnectionCoreDetail,
  loadConnectionBusinessPositioning,
  loadConnectionBusinessGoals,
  loadConnectionBusinessGoalEvaluation,
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
  ignoreConnectionImportRow,
  updateConnectionDataMapping,
  updateConnection,
  updateConnectionBusinessPositioning,
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
  updateConnectionImprovement,
  updateConnectionFollow,
  uploadConnectionImport,
  uploadConnectionFoundationImport,
  uploadConnectionFoundationBulkImport,
  createConnectionFoundationTemplate,
  iterateConnectionFoundationTemplate,
  resolveAssetUrl,
} from "./services/connectionCenterService.js";
import { getCurrentUser, state } from "./appState.js";
import { hasPermission } from "./permissions.js";
import { escapeHtml } from "./utils/html.js";
import { CONNECTION_CENTER_SECTIONS, connectionCenterSectionHash, parseConnectionCenterRoute } from "./utils/connectionCenterRoute.js";
import { renderUiModule } from "./uiModuleRegistry.js";
import "./uiModules/linkSalesDistribution.js";
import "./uiModules/linkDataStatus.js";
import "./uiModules/salesDailyDataQuality.js";
import "./uiModules/myLinkSummary.js";
import "./uiModules/linkHospitalTodo.js";
import "./uiModules/linkList.js";
import "./uiModules/linkWorkspaceModules.js";
import "./uiModules/linkDailySales.js";
import "./uiModules/linkImage.js";
import "./uiModules/linkColumnSetting.js";
import "./uiModules/linkDataToolbar.js";
import { LINK_DATA_COLUMNS, DEFAULT_MINE_LINK_FIELDS } from "./uiModules/linkDataTable.js";
import { reorderVisibleLinkBusinessField } from "./uiModules/linkIndicatorSetting.js";
import "./uiModules/linkBusinessToolbar.js";
import { LINK_BUSINESS_COLUMN_GROUPS, LINK_BUSINESS_COLUMNS, DEFAULT_LINK_BUSINESS_FIELDS } from "./uiModules/linkBusinessTable.js";

const connectionSectionStorageKey = "connection-center-section-v1";

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
  detailReturnSection: "connections",
  view: "list",
  sort: "default",
  columnSort: { key: "", direction: "asc" },
  listFilters: { search: "", platform: "", shopId: "", productCode: "", ownerId: "", healthStatus: "", status: "", salesStatus: "", profitStatus: "", productRelation: "", skuCount: "" },
  visibleColumns: ["image", "name", "platform", "shop", "erpSales", "erpProfit", "health", "owner", "status"],
  fieldSettingsOpen: false,
  detailTab: "business",
  detailLoaded: new Set(),
  actions: [],
  periodSnapshots: [],
  growthAnalysis: null,
  growthRankings: { topGrowth: [], risks: [] },
  managementOverview: { summary: {}, owners: [] },
  cockpit: { summary: {}, health: {}, coreLinks: [], riskLinks: [], growthLinks: [], platforms: [], productChannels: [], trends: { erp: [], platform: [] }, periodType: "month" },
  goalHealth: { totalLinks: 0, positionedLinks: 0, unpositionedLinks: 0, activeGoalLinks: 0, pendingGoalLinks: 0, evaluatedLinks: 0, pendingEvaluationLinks: 0, gradeSummary: {}, positioningSummary: [], evaluationPeriod: {} },
  healthRecords: [],
  healthAttention: { items: [], counts: { risk: 0, attention: 0, traffic: 0, conversion: 0, sales: 0 } },
  healthModalId: "",
  improvements: [],
  improvementSummary: { total: 0, effective: 0, observing: 0, failed: 0 },
  section: initialConnectionSection(),
  dataCenterTab: "data-foundation",
  myWorkbench: { items: [], summary: { total: 0, better: 0, risk: 0, followed: 0 }, pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 }, serverPaged: true, filter: "all", search: "", isAdmin: false, loading: false, loaded: false },
  myLinkTable: { items: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 }, range: { preset: "7d", startDate: "", endDate: "" },
    filters: { keyword: "", platform: "", shopId: "", archiveStatus: "" }, sort: { field: "default", direction: "desc" },
    visibleFields: [...DEFAULT_MINE_LINK_FIELDS], fieldOrder: LINK_DATA_COLUMNS.map((item) => item.key), filterOptions: { platforms: [], shops: [] },
    dataSource: {}, columnSettingOpen: false, loading: false, loaded: false },
  businessTable: { items: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 }, range: { preset: "7d", startDate: "", endDate: "" },
    filters: { keyword: "", platform: "", shopId: "", ownerId: "", minSales: "", maxSales: "", minProfit: "", maxProfit: "", growthStatus: "", healthStatus: "", hospitalStatus: "", expanded: false },
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
  salesDistribution: { scope: "company", range: { preset: "7d" }, items: [], summary: {}, selectedGroup: 0, selectedRange: null, drillTable: null, loading: false, loaded: false, error: "" },
  hospital: { zones: { diagnosis: [], treatment: [], observation: [] }, counts: { diagnosis: 0, treatment: 0, observation: 0 }, stage: "diagnosis", loading: false, loaded: false },
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
  foundation: { definitions: {}, templates: [], batches: [], errors: [], loading: false, preview: null, bulkPreview: null, salesPreview: null, salesLoading: false, salesError: "", salesMessage: "", salesFileName: "", salesFile: null, dailyPreview: null, dailyLoading: false, dailyCommitting: false, dailyError: "", dailyMessage: "", dailyFileName: "", dailyFile: null, dailyCategory: "ready" },
  relationCandidates: { items: [], summary: {}, pagination: {}, filterOptions: {}, candidateType: "", loading: false, confirming: false, selected: null, selectedIds: [] },
  relationGovernance: { items: [], summary: { byType: {} }, pagination: {}, filterOptions: {}, filters: { governanceType: "", shopId: "", keyword: "", minSales: "", maxSales: "", status: "pending" }, selected: null, loading: false, loaded: false },
  salesDataQualityGovernance: { items: [], summary: { byType: {} }, pagination: {}, filters: { anomalyType: "", keyword: "" }, selected: null, loading: false, saving: false, loaded: false },
  comboReviews: { items: [], summary: {}, pagination: {}, filterOptions: {}, filters: { shopId: "", platform: "", componentCount: "", stability: "", sourceBatchId: "" }, loading: false, generating: false, selected: null, anomalies: { items: [], pagination: {} }, sourceRows: { items: [], pagination: {} }, editing: false, draft: null, erpSearch: { keyword: "", items: [], loading: false }, saving: false, confirming: false },
  coreDetail: null,
  coreDetailLoading: false,
  dailySales: { data: null, loading: false, loaded: false, rangePreset: "30d", error: "" },
  ownerImport: { loading: false, result: null, showCompletion: false, detailKind: "", detailRows: [], detailPagination: null },
  salesPeriodType: "month",
  error: "",
};
let connectionListRequestId = 0;
let connectionSearchTimer = 0;

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

function canOpenConnectionSection(section) {
  if (section === "hospital") return canViewHealth();
  if (["sales-relation-governance", "sales-data-quality-governance"].includes(section)) return canImportBusinessData();
  return CONNECTION_CENTER_SECTIONS.has(section);
}

function selectConnectionSection(section, { updateRoute = true } = {}) {
  const normalized = canOpenConnectionSection(section) ? section : "cockpit";
  pageState.section = normalized; pageState.selectedId = ""; pageState.coreDetail = null;
  try { window.localStorage.setItem(connectionSectionStorageKey, normalized); } catch { /* Browser preferences are optional. */ }
  if (updateRoute) {
    const nextHash = connectionCenterSectionHash(normalized);
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
    if (pageState.goalManagementTab === "pilots" && !pageState.goalPilot.loaded && !pageState.goalPilot.loading) void loadGoalPilotPage(render);
    if (pageState.goalManagementTab !== "pilots" && !pageState.goalWorkbench.loaded && !pageState.goalWorkbench.loading) void loadGoalWorkbenchPage(render);
  }
  if (section === "my-links") {
    if (!pageState.myLinkTable.loaded && !pageState.myLinkTable.loading) void loadMyLinks(render);
    if (!pageState.linkDataStatus.loaded && !pageState.linkDataStatus.loading) void loadMyLinkDataStatus(render);
  }
  if (section === "hospital" && !pageState.hospital.loaded && !pageState.hospital.loading) void loadHospital(render);
  if (section === "data-import") {
    if (!pageState.linkDataStatus.loaded && !pageState.linkDataStatus.loading) void loadMyLinkDataStatus(render);
    if (!pageState.salesDailyQuality.loaded && !pageState.salesDailyQuality.loading) void loadSalesDailyQualityPanel(render);
    if (canImportBusinessData() && !pageState.loadedSections.has("data-import") && !pageState.foundation.loading) void loadDataFoundation(render);
  }
  if (section === "sales-relation-governance" && canImportBusinessData()
    && !pageState.relationGovernance.loaded && !pageState.relationGovernance.loading) void loadSalesRelationGovernancePage(render, { page: 1 });
  if (section === "sales-data-quality-governance" && canImportBusinessData()
    && !pageState.salesDataQualityGovernance.loaded && !pageState.salesDataQualityGovernance.loading) void loadSalesDataQualityGovernancePage(render, { page: 1 });
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
  missing_field: "必填字段缺失", missing_link: "链接未匹配", missing_period: "数据日期缺失",
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

function parserVersionText(version) {
  if (version === "sales-fact-v3-v2-relation-resolution") return "第3版·新版ERP关系解析";
  if (String(version || "").startsWith("sales-fact-v2")) return "第2版·销售事实解析";
  return version ? "历史解析版本" : "—";
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
    <button type="button" class="${pageState.section === "connections" ? "active" : ""}" data-connection-section="connections">全部链接</button>
    <button type="button" class="${pageState.section === "goal-management" ? "active" : ""}" data-connection-section="goal-management">链接经营管理</button>
    ${canViewHealth() ? `<button type="button" class="${pageState.section === "hospital" ? "active" : ""}" data-connection-section="hospital">链接医院</button>` : ""}
    <button type="button" class="${["data-import", "sales-relation-governance", "sales-data-quality-governance"].includes(pageState.section) ? "active" : ""}" data-connection-section="data-import">数据更新</button>
  </nav>`;
}

function renderDataUpdateWorkspace() {
  return `<section class="link-data-update-workspace">${canImportBusinessData() ? renderDataFoundation() : ""}${renderUiModule("link_data_status", { state: pageState.linkDataStatus, showDailyCompleteness: true })}${renderUiModule("sales_daily_data_quality", { state: pageState.salesDailyQuality, showGovernanceEntry: canImportBusinessData() })}${canImportBusinessData() ? "" : `<div class="empty-state compact"><strong>数据由管理员统一更新</strong><p>当前账号可查看最新数据状态；如有异常，请联系数据管理员处理。</p></div>`}</section>`;
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
  if (item.goalStatus !== "active") return batch.status === "target_confirm" ? `<form class="goal-pilot-inline-form goal-pilot-target-form" data-goal-pilot-target data-member-id="${escapeHtml(item.id)}" data-plan-id="${escapeHtml(item.goalPlanId)}"><label>销售<input type="number" name="salesAmount" min="0" step="0.01" required value="${item.salesSuggested ?? ""}" /></label><label>利润<input type="number" name="profitAmount" step="0.01" required value="${item.profitSuggested ?? ""}" /></label><input name="approvalReason" maxlength="500" placeholder="调整时填写原因" /><button type="submit" class="primary-button">确认目标</button></form>` : `<small>等待进入目标确认阶段</small>`;
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
  return `<section class="goal-management-shell"><nav class="goal-management-tabs"><button type="button" class="${pageState.goalManagementTab === "workbench" ? "active" : ""}" data-goal-management-tab="workbench">经营管理</button><button type="button" class="${pageState.goalManagementTab === "pilots" ? "active" : ""}" data-goal-management-tab="pilots">经营试点</button></nav>${pageState.goalManagementTab === "pilots" ? renderGoalPilot() : renderGoalWorkbench()}</section>`;
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

function renderDataFoundation() {
  const foundation = pageState.foundation; const types = Object.entries(foundation.definitions);
  const typeLabel = (key) => importTypeText(key, foundation.definitions[key]?.label);
  const preview = foundation.preview;
  const previewPanel = preview ? `<section class="connection-import-preview ${preview.blocked ? "is-blocked" : ""}"><header><div><p class="eyebrow">导入预览</p><h3>平台链接经营导入预览</h3></div><span class="status-pill">${preview.blocked ? "已阻断" : preview.batch?.status === "completed" || preview.batch?.status === "completed_with_errors" ? "已导入" : "待确认"}</span></header><div class="connection-import-preview-grid"><span>识别模板<strong>${escapeHtml(preview.preview?.templateName || "—")}</strong></span><span>平台<strong>${escapeHtml(preview.preview?.platform || "—")}</strong></span><span>店铺<strong>${escapeHtml(preview.preview?.shop || "—")}</strong></span><span>数据周期<strong>${escapeHtml(preview.preview?.periodStart && preview.preview?.periodEnd ? `${preview.preview.periodStart} 至 ${preview.preview.periodEnd}` : "多个周期 / 无法汇总")}</strong></span><span>原始行数<strong>${escapeHtml(preview.preview?.rawRows ?? 0)}</strong></span><span>过滤后行数<strong>${escapeHtml(preview.preview?.filteredRows ?? 0)}</strong></span><span>新增链接<strong>${escapeHtml(preview.preview?.newLinks ?? 0)}</strong></span><span>更新链接<strong>${escapeHtml(preview.preview?.updatedLinks ?? 0)}</strong></span><span>经营事实<strong>${escapeHtml(preview.preview?.operationFacts ?? 0)}</strong></span><span>异常数量<strong>${escapeHtml(preview.preview?.errors ?? 0)}</strong></span></div>${preview.preview?.duplicateGoodsIds?.length ? `<p class="form-error">过滤后商品ID重复：${escapeHtml(preview.preview.duplicateGoodsIds.join("、"))}</p>` : ""}<footer><small>确认前不会创建链接档案或写入经营事实。</small>${canImportBusinessData() && !preview.blocked && !["completed", "completed_with_errors"].includes(preview.batch?.status) ? `<button type="button" class="primary-button" data-confirm-foundation-import="${escapeHtml(preview.batch.id)}">确认导入</button>` : ""}</footer></section>` : "";
  const salesPreview = foundation.salesPreview;
  const salesSummary = salesPreview?.summary || {};
  const salesBatchStatus = salesPreview?.dataSyncBatch?.status;
  const salesStatusText = salesPreview?.blocked ? "无可写入数据" : salesPreview?.isCurrent ? "待确认" : ["succeeded", "partial"].includes(salesBatchStatus) ? "已导入" : "历史预览";
  const salesPreviewPanel = salesPreview ? `<section class="connection-import-preview ${salesPreview.blocked ? "is-blocked" : ""}"><header><div><p class="eyebrow">利润表预览</p><h3>链接利润表预览</h3></div><span class="status-pill">${salesStatusText}</span></header><div class="connection-import-preview-grid"><span>批次编号<strong>${escapeHtml(salesPreview.dataSyncBatch?.id || "—")}</strong></span><span>文件<strong>${escapeHtml(salesSummary.fileName || "—")}</strong></span><span>解析版本<strong>${escapeHtml(parserVersionText(salesSummary.parserVersion))}</strong></span><span>总行数<strong>${salesSummary.total || 0}</strong></span><span>有效候选<strong>${salesSummary.valid || 0}</strong></span><span>异常<strong>${salesSummary.exceptionCount || 0}</strong></span><span>周期开始<strong>${escapeHtml(salesSummary.periodStart || "—")}</strong></span><span>周期结束<strong>${escapeHtml(salesSummary.periodEnd || "—")}</strong></span></div>${salesPreview.idempotent ? `<p class="form-note">该文件已有导入记录，现已展示原有结果，不会重复创建。</p>` : ""}<footer><small>复用统一真实销售导入任务；确认前不会写入销售事实。</small>${canImportBusinessData() && salesPreview.isCurrent && !salesPreview.blocked ? `<button type="button" class="primary-button" data-confirm-sales-fact-import="${escapeHtml(salesPreview.dataSyncBatch?.id)}">确认导入链接利润表</button>` : ""}</footer></section>` : "";
  const dailyPreview = foundation.dailyPreview;
  const dailySummary = dailyPreview?.summary || {};
  const dailyCategory = foundation.dailyCategory || "ready";
  const dailyRows = dailyPreview?.rows || [];
  const dailyCategoryLabels = { ready: "可导入日报", pending_relation: "待确认销售关系", error: "异常" };
  const dailyCoverage = (value) => value === null || value === undefined ? "暂无数据" : `${(Number(value) * 100).toFixed(2)}%`;
  const factCommit = dailySummary.factCommit;
  const dailyPreviewPanel = dailyPreview ? `<section class="connection-import-preview ${dailySummary.errorRows ? "is-blocked" : ""}"><header><div><p class="eyebrow">销售日报预览</p><h3>销售日报导入预览</h3></div><span class="status-pill">第 ${dailySummary.previewRevision || 1} 版</span></header><div class="connection-import-preview-grid"><span>文件<strong>${escapeHtml(dailySummary.fileName || "—")}</strong></span><span>日期范围<strong>${escapeHtml(dailySummary.dateStart && dailySummary.dateEnd ? `${dailySummary.dateStart} 至 ${dailySummary.dateEnd}` : "—")}</strong></span><span>总行数<strong>${dailySummary.totalRows || 0}</strong></span><span>可导入日报<strong>${dailySummary.readyRows || 0}</strong></span><span>待确认关系<strong>${dailySummary.pendingRelationRows || 0}</strong></span><span>异常<strong>${dailySummary.errorRows || 0}</strong></span><span>销售额覆盖率<strong>${dailyCoverage(dailySummary.salesAmountCoverage)}</strong></span><span>利润覆盖率<strong>${dailyCoverage(dailySummary.profitAmountCoverage)}</strong></span></div>${dailySummary.changes ? `<p class="form-note">本次重算：新增可导入 ${Number(dailySummary.changes.readyRows || 0)} 条，减少待确认 ${Math.max(0, -Number(dailySummary.changes.pendingRelationRows || 0))} 条，异常变化 ${Number(dailySummary.changes.errorRows || 0)} 条。</p>` : ""}${dailySummary.relationRecalculationRequired ? `<p class="form-note">销售关系已更新，此预览需要人工重新计算；不会自动写入日报事实。</p>` : ""}${factCommit ? `<div class="connection-import-preview-grid"><span>新增事实<strong>${factCommit.insertedCount || 0}</strong></span><span>重复数据已跳过<strong>${factCommit.skippedCount || 0}</strong></span><span>待确认更新<strong>${factCommit.updatePendingCount || 0}</strong></span><span>未写入<strong>${factCommit.blockedCount || 0}</strong></span><span>写入销售额<strong>¥${usageMoney(factCommit.insertedSalesAmount)}</strong></span><span>写入利润<strong>¥${usageMoney(factCommit.insertedProfitAmount)}</strong></span></div>` : ""}<nav class="connection-data-center-nav" aria-label="销售日报预览分类">${Object.entries(dailyCategoryLabels).map(([key, label]) => `<button type="button" class="${dailyCategory === key ? "active" : ""}" data-daily-preview-category="${key}">${label}</button>`).join("")}</nav><div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>行号</th><th>店铺</th><th>货品编号</th><th>平台规格编号</th><th>商家编码</th><th>日期</th><th>销售额</th><th>利润</th><th>结果</th></tr></thead><tbody>${dailyRows.map((row) => { const item = row.normalized || {}; return `<tr><td>${escapeHtml(row.rowNumber)}</td><td>${escapeHtml(item.shopName || "—")}</td><td>${escapeHtml(item.platformGoodsId || "—")}</td><td>${escapeHtml(item.platformSkuId || "—")}</td><td>${escapeHtml(item.merchantSkuCode || "—")}</td><td>${escapeHtml(item.saleDate || "—")}</td><td>${item.salesAmount === null || item.salesAmount === undefined ? "暂无数据" : escapeHtml(Number(item.salesAmount).toFixed(2))}</td><td>${item.profitAmount === null || item.profitAmount === undefined ? "暂无数据" : escapeHtml(Number(item.profitAmount).toFixed(2))}</td><td>${escapeHtml(importErrorMessageText(row.errorMessage || dailyCategoryLabels[row.category] || row.category))}</td></tr>`; }).join("") || `<tr><td colspan="9">当前分类暂无数据</td></tr>`}</tbody></table></div><footer><small>${factCommit ? `事实写入已确认于 ${escapeHtml(factCommit.confirmedAt)}` : "确认时会重新执行分类、用途与关系校验。"}</small>${!factCommit && canImportBusinessData() ? `<button type="button" class="primary-button" data-confirm-sales-daily-facts="${escapeHtml(dailyPreview.batch?.id)}" ${foundation.dailyCommitting ? "disabled" : ""}>${foundation.dailyCommitting ? "正在写入…" : "确认写入日报事实"}</button>` : ""}${canImportBusinessData() && !factCommit && (dailySummary.relationRecalculationRequired || Number(dailySummary.previewRevision || 1) > 1) ? `<button type="button" class="secondary-button" data-recalculate-sales-daily-preview="${escapeHtml(dailyPreview.batch?.id)}" ${foundation.dailyLoading ? "disabled" : ""}>${foundation.dailyLoading ? "正在重新计算…" : "重新计算预览"}</button>` : ""}</footer></section>` : "";
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
  const comboReviews = pageState.comboReviews;
  const comboSummary = comboReviews.summary || {};
  const comboFilters = comboReviews.filters || {};
  const comboStabilityLabel = { stable: "稳定", changing: "存在变化", insufficient: "证据不足" };
  const comboSelected = comboReviews.selected;
  const comboPagination = comboReviews.pagination || {};
  const comboDraft = comboReviews.draft;
  const comboIncluded = (comboSelected?.components || []).filter((component) => component.status === "included");
  const comboReadyToConfirm = comboIncluded.length >= 2 && comboIncluded.every((component) => component.quantity !== null && Number(component.quantity) > 0 && component.quantitySource === "manual_confirmation");
  const comboEditor = comboSelected && canManage() && comboSelected.item?.status === "pending" ? `${comboReviews.editing ? `<article class="connection-import-preview"><header><div><h3>编辑组合关系审核草稿</h3><p>数量只能由人工填写；留空表示待确认。保存后仍为待审核。</p></div><button type="button" class="text-button" data-cancel-combo-draft>取消</button></header><div class="connection-template-list">${(comboDraft?.components || []).map((component, index) => `<article><div><strong>${escapeHtml(component.erpSku?.specificationName || component.erpSku?.merchantSkuCode || "ERP商品编码")}</strong><span>商家编码：${escapeHtml(component.erpSku?.merchantSkuCode || "—")} · ${component.sourceType === "manual_added" ? "人工添加" : "系统发现"}</span></div><label>组件数量<input type="number" min="0.000001" step="any" value="${component.quantity ?? ""}" placeholder="待人工确认" data-combo-draft-quantity="${index}" /></label><label><input type="checkbox" data-combo-draft-included="${index}" ${component.status === "included" ? "checked" : ""} />保留组件</label></article>`).join("")}</div><form class="connection-filter-row" data-combo-erp-search><input name="keyword" value="${escapeHtml(comboReviews.erpSearch?.keyword || "")}" placeholder="搜索商家编码或ERP商品名称" /><button type="submit" class="secondary-button">搜索ERP商品</button></form>${(comboReviews.erpSearch?.items || []).length ? `<div class="connection-template-list">${comboReviews.erpSearch.items.map((item) => `<article><div><strong>${escapeHtml(item.specificationName || item.merchantSkuCode)}</strong><span>${escapeHtml(item.merchantSkuCode)}</span></div><button type="button" class="text-button" data-add-combo-erp-sku="${escapeHtml(item.id)}">添加</button></article>`).join("")}</div>` : ""}<label class="field-stack"><span>审核备注</span><textarea rows="4" data-combo-review-note placeholder="记录本次草稿调整说明">${escapeHtml(comboDraft?.reviewNote || "")}</textarea></label><footer><small>保存草稿不会批准组合关系、不会生成正式关系、不会写入销售日报事实。</small><button type="button" class="primary-button" data-save-combo-draft ${comboReviews.saving ? "disabled" : ""}>${comboReviews.saving ? "正在保存…" : "保存草稿"}</button></footer></article>` : `<div class="connection-section-actions"><button type="button" class="secondary-button" data-edit-combo-draft>编辑草稿</button><button type="button" class="primary-button" data-confirm-combo-group ${!comboReadyToConfirm || comboReviews.confirming ? "disabled" : ""}>${comboReviews.confirming ? "正在确认…" : "确认整组关系"}</button>${!comboReadyToConfirm ? "<small>所有保留组件填写人工确认数量后方可确认。</small>" : ""}</div>`}` : "";
  const comboPanel = dailyPreview ? `<section class="connection-foundation-panel">
    <header class="connection-section-heading"><div><p class="eyebrow">组合关系审核</p><h3>组合关系审核</h3><p>系统只整理平台规格与候选ERP商品组件证据，正式组件数量由后续人工审核定义。</p></div>${canImportBusinessData() ? `<button type="button" class="secondary-button" data-generate-combo-reviews ${comboReviews.generating ? "disabled" : ""}>${comboReviews.generating ? "正在整理…" : "整理组合关系审核草稿"}</button>` : ""}</header>
    <div class="connection-import-preview-grid"><span>待审核组合关系<strong>${comboSummary.pendingGroups || 0}</strong></span><span>平台规格<strong>${comboSummary.platformSkuCount || 0}</strong></span><span>影响日报行<strong>${comboSummary.affectedRowCount || 0}</strong></span><span>影响销售额<strong>${Number(comboSummary.salesAmount || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}</strong></span><span>影响利润<strong>${Number(comboSummary.profitAmount || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}</strong></span></div>
    <form class="connection-filter-row" data-combo-review-filters><select name="shopId"><option value="">全部店铺</option>${(comboReviews.filterOptions?.shops || []).map((item) => `<option value="${escapeHtml(item.id)}" ${comboFilters.shopId === item.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}</select><select name="platform"><option value="">全部平台</option>${(comboReviews.filterOptions?.platforms || []).map((item) => `<option value="${escapeHtml(item)}" ${comboFilters.platform === item ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}</select><select name="componentCount"><option value="">全部组件数</option>${(comboReviews.filterOptions?.componentCounts || []).map((item) => `<option value="${item}" ${String(comboFilters.componentCount) === String(item) ? "selected" : ""}>${item}个组件</option>`).join("")}</select><select name="stability"><option value="">全部稳定性</option>${Object.entries(comboStabilityLabel).map(([key, label]) => `<option value="${key}" ${comboFilters.stability === key ? "selected" : ""}>${label}</option>`).join("")}</select><select name="sourceBatchId"><option value="">全部来源批次</option>${(comboReviews.filterOptions?.sourceBatches || []).map((item) => `<option value="${escapeHtml(item.id)}" ${comboFilters.sourceBatchId === item.id ? "selected" : ""}>${escapeHtml(item.fileName || "销售日报")}</option>`).join("")}</select><button type="submit" class="secondary-button">筛选</button><button type="button" class="text-button" data-reset-combo-review-filters>清除</button></form>
    <div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>店铺</th><th>平台规格</th><th>链接</th><th>候选组件</th><th>日期范围</th><th>销售额</th><th>利润</th><th>稳定性</th><th>状态</th><th></th></tr></thead><tbody>${(comboReviews.items || []).map((item) => `<tr><td>${escapeHtml(item.shop?.name || "—")}<small>${escapeHtml(item.shop?.platform || "")}</small></td><td>${escapeHtml(item.platformSku?.specificationName || item.platformSku?.platformSkuId || "—")}</td><td>${escapeHtml(item.link?.title || "—")}</td><td>${item.componentCount}</td><td>${escapeHtml(`${item.affectedDateStart || "—"} 至 ${item.affectedDateEnd || "—"}`)}</td><td>${Number(item.salesAmount || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}</td><td>${Number(item.profitAmount || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}</td><td>${escapeHtml(comboStabilityLabel[item.stability] || "证据不足")}</td><td>${escapeHtml(item.statusLabel || "待审核")}</td><td><button type="button" class="text-button" data-view-combo-review="${escapeHtml(item.id)}">查看证据</button></td></tr>`).join("") || `<tr><td colspan="10">暂无组合关系审核草稿</td></tr>`}</tbody></table></div>
    <footer><small>列表按平台SKU服务端分页；不会返回全部候选原始记录。</small><div><button type="button" class="text-button" data-combo-review-page="${Math.max(1, Number(comboPagination.page || 1) - 1)}" ${Number(comboPagination.page || 1) <= 1 ? "disabled" : ""}>上一页</button><span>${comboPagination.page || 1} / ${comboPagination.totalPages || 1}</span><button type="button" class="text-button" data-combo-review-page="${Number(comboPagination.page || 1) + 1}" ${Number(comboPagination.page || 1) >= Number(comboPagination.totalPages || 1) ? "disabled" : ""}>下一页</button></div></footer>
    ${comboSelected ? `<article class="connection-import-preview"><header><div><h3>${escapeHtml(comboSelected.item?.platformSku?.specificationName || comboSelected.item?.link?.title || "组合关系审核证据")}</h3><p>${escapeHtml(comboSelected.item?.shop?.name || "—")} · ${escapeHtml(comboSelected.item?.link?.title || "—")}</p></div><button type="button" class="text-button" data-close-combo-review>关闭</button></header><div class="connection-import-preview-grid"><span>平台货品编号<strong>${escapeHtml(comboSelected.item?.link?.platformGoodsId || "—")}</strong></span><span>平台规格编号<strong>${escapeHtml(comboSelected.item?.platformSku?.platformSkuId || "—")}</strong></span><span>总销售日期<strong>${comboSelected.item?.stabilityEvidence?.totalSalesDates || 0}</strong></span><span>多组件日期<strong>${comboSelected.item?.stabilityEvidence?.multiComponentDates || 0}</strong></span><span>单组件异常日期<strong>${comboSelected.item?.stabilityEvidence?.singleComponentDates || 0}</strong></span><span>组件集合变化日期<strong>${comboSelected.item?.stabilityEvidence?.componentSetChangeDates || 0}</strong></span></div><h4>候选ERP商品组件</h4><p class="form-note">${escapeHtml(comboSelected.notice || "销售日报组件数量仅供审核参考，不等于正式组合数量。")}</p><div class="connection-template-list">${(comboSelected.components || []).map((component) => `<article><div><strong>${escapeHtml(component.erpSku?.specificationName || component.erpSku?.merchantSkuCode || "ERP商品编码")}</strong><span>商家编码：${escapeHtml(component.erpSku?.merchantSkuCode || "—")} · ${escapeHtml(component.quantityLabel)} · 出现${component.evidence?.occurrenceDays || 0}天/${component.evidence?.occurrenceCount || 0}次 · 日报数量范围 ${component.evidence?.dailyQuantityMin ?? "—"}～${component.evidence?.dailyQuantityMax ?? "—"}</span></div><span>${escapeHtml(component.statusLabel)}</span></article>`).join("")}</div><h4>异常日期</h4><div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>日期</th><th>当天ERP商品组件与日报数量</th><th>销售额</th><th>利润</th></tr></thead><tbody>${(comboReviews.anomalies?.items || []).map((item) => `<tr><td>${escapeHtml(item.date)}</td><td>${item.components.map((component) => `${escapeHtml(component.merchantSkuCode || "—")} × ${escapeHtml(component.quantity ?? "—")}`).join("<br>")}</td><td>${Number(item.salesAmount || 0).toFixed(2)}</td><td>${Number(item.profitAmount || 0).toFixed(2)}</td></tr>`).join("") || `<tr><td colspan="4">未发现异常日期</td></tr>`}</tbody></table></div><h4>来源销售记录</h4><div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>行号</th><th>日期</th><th>商家编码</th><th>日报数量</th><th>销售额</th><th>利润</th></tr></thead><tbody>${(comboReviews.sourceRows?.items || []).map((row) => `<tr><td>${row.rowNumber}</td><td>${escapeHtml(row.saleDate || "—")}</td><td>${escapeHtml(row.merchantSkuCode || "—")}</td><td>${escapeHtml(row.quantity ?? "—")}</td><td>${row.salesAmount === null ? "暂无数据" : Number(row.salesAmount).toFixed(2)}</td><td>${row.profitAmount === null ? "暂无数据" : Number(row.profitAmount).toFixed(2)}</td></tr>`).join("")}</tbody></table></div><footer><small>当前仅保存审核草稿；不会批准或生成正式关系。</small></footer></article><div class="connection-pagination"><span>异常日期 ${comboReviews.anomalies?.pagination?.page || 1}/${comboReviews.anomalies?.pagination?.totalPages || 1}</span><button type="button" class="text-button" data-combo-anomaly-page="${Math.max(1, Number(comboReviews.anomalies?.pagination?.page || 1) - 1)}" ${Number(comboReviews.anomalies?.pagination?.page || 1) <= 1 ? "disabled" : ""}>异常上一页</button><button type="button" class="text-button" data-combo-anomaly-page="${Number(comboReviews.anomalies?.pagination?.page || 1) + 1}" ${Number(comboReviews.anomalies?.pagination?.page || 1) >= Number(comboReviews.anomalies?.pagination?.totalPages || 1) ? "disabled" : ""}>异常下一页</button><span>来源记录 ${comboReviews.sourceRows?.pagination?.page || 1}/${comboReviews.sourceRows?.pagination?.totalPages || 1}</span><button type="button" class="text-button" data-combo-source-page="${Math.max(1, Number(comboReviews.sourceRows?.pagination?.page || 1) - 1)}" ${Number(comboReviews.sourceRows?.pagination?.page || 1) <= 1 ? "disabled" : ""}>记录上一页</button><button type="button" class="text-button" data-combo-source-page="${Number(comboReviews.sourceRows?.pagination?.page || 1) + 1}" ${Number(comboReviews.sourceRows?.pagination?.page || 1) >= Number(comboReviews.sourceRows?.pagination?.totalPages || 1) ? "disabled" : ""}>记录下一页</button></div>` : ""}
    ${comboEditor}
  </section>` : "";
  const bulkPreview = foundation.bulkPreview;
  const bulkStatusText = { waiting: "排队中", running: "处理中", preview_ready: "待批量确认", preview_ready_with_errors: "待确认 · 有异常", completed: "已完成", completed_with_errors: "已完成 · 有异常", failed: "处理失败" };
  const fileStatusText = { waiting: "等待", running: "解析中", preview_ready: "待确认", already_imported: "历史已导入", blocked: "已阻断", failed: "异常", completed: "已导入", completed_with_errors: "已导入 · 有异常" };
  const bulkPreviewPanel = bulkPreview ? `<section class="connection-import-preview ${bulkPreview.batch?.failedCount ? "is-blocked" : ""}"><header><div><p class="eyebrow">批量导入预览</p><h3>平台链接数据批量预览</h3></div><span class="status-pill">${escapeHtml(bulkStatusText[bulkPreview.batch?.status] || bulkPreview.batch?.status)}</span></header><div class="connection-import-preview-grid"><span>文件总数<strong>${escapeHtml(bulkPreview.batch?.fileCount || 0)}</strong></span><span>已处理<strong>${escapeHtml(bulkPreview.batch?.processedCount || 0)}</strong></span><span>原始行数<strong>${escapeHtml(bulkPreview.summary?.rawRows || 0)}</strong></span><span>过滤后行数<strong>${escapeHtml(bulkPreview.summary?.filteredRows || 0)}</strong></span><span>新增链接<strong>${escapeHtml(bulkPreview.summary?.newLinks || 0)}</strong></span><span>更新链接<strong>${escapeHtml(bulkPreview.summary?.updatedLinks || 0)}</strong></span><span>经营事实<strong>${escapeHtml(bulkPreview.summary?.operationFacts || 0)}</strong></span><span>异常数量<strong>${escapeHtml(bulkPreview.summary?.errors || 0)}</strong></span></div><div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>文件</th><th>平台</th><th>店铺</th><th>有效行</th><th>异常</th><th>状态</th></tr></thead><tbody>${(bulkPreview.files || []).map((file) => `<tr><td>${escapeHtml(file.fileName)}</td><td>${escapeHtml(file.platform || "识别中")}</td><td>${escapeHtml(file.shop || "—")}</td><td>${escapeHtml(file.summary?.filteredRows || 0)}</td><td>${escapeHtml(file.summary?.errors || 0)}</td><td>${escapeHtml(fileStatusText[file.status] || file.status)}${file.errorMessage ? `<small>${escapeHtml(file.errorMessage)}</small>` : ""}</td></tr>`).join("")}</tbody></table></div><footer><small>后台按文件顺序处理；确认前不创建链接或写入经营事实。</small>${canImportBusinessData() && ["preview_ready", "preview_ready_with_errors"].includes(bulkPreview.batch?.status) ? `<button type="button" class="primary-button" data-confirm-foundation-bulk-import="${escapeHtml(bulkPreview.batch.id)}">批量确认导入</button>` : ""}</footer></section>` : "";
  return `<section class="connection-foundation-page">
    <header class="connection-section-heading"><div><h2>业务数据导入</h2></div></header>
    ${canImportBusinessData() ? `<div class="connection-business-import-grid"><form class="connection-foundation-import-form" data-foundation-bulk-import-form><label>平台链接数据表（可多选）<input type="file" name="files" accept=".xls,.xlsx" multiple required /></label><button type="submit" class="primary-button">批量上传并后台预览</button></form><form class="connection-foundation-import-form" data-sales-fact-import-form novalidate><label>链接利润表<input type="file" name="file" accept=".xls,.xlsx" ${foundation.salesLoading ? "disabled" : ""} data-sales-fact-file /></label>${foundation.salesFileName ? `<small>已选择：${escapeHtml(foundation.salesFileName)}</small>` : ""}<button type="submit" class="primary-button" ${foundation.salesLoading ? "disabled aria-busy=\"true\"" : ""}>${foundation.salesLoading ? "正在上传并解析…" : "上传利润表并解析"}</button><div class="connection-import-feedback" aria-live="polite">${foundation.salesError ? `<span class="form-error">${escapeHtml(foundation.salesError)}</span>` : foundation.salesMessage ? `<span class="form-success">${escapeHtml(foundation.salesMessage)}</span>` : ""}</div></form><form class="connection-foundation-import-form" data-sales-daily-import-form novalidate><label>销售日报利润表<input type="file" name="file" accept=".xls,.xlsx" ${foundation.dailyLoading ? "disabled" : ""} data-sales-daily-file /></label>${foundation.dailyFileName ? `<small>已选择：${escapeHtml(foundation.dailyFileName)}</small>` : ""}<button type="submit" class="secondary-button" ${foundation.dailyLoading ? "disabled aria-busy=\"true\"" : ""}>${foundation.dailyLoading ? "正在生成日报预览…" : "生成销售日报预览"}</button><div class="connection-import-feedback" aria-live="polite">${foundation.dailyError ? `<span class="form-error">${escapeHtml(foundation.dailyError)}</span>` : foundation.dailyMessage ? `<span class="form-success">${escapeHtml(foundation.dailyMessage)}</span>` : ""}</div></form>${renderOwnerImportUploader()}</div>` : ""}
    ${isAdmin() ? `<p class="form-note">未识别店铺已迁移至管理员店铺治理。请在<a href="#products">产品中心</a>的平台货品导入中确认店铺名称或别名。</p>` : ""}
    ${renderOwnerImport()}
    ${bulkPreviewPanel ? `<details class="connection-preview-fold" ${["waiting", "running", "preview_ready", "preview_ready_with_errors", "failed"].includes(bulkPreview.batch?.status) ? "open" : ""}><summary><strong>平台链接数据导入</strong><span>${escapeHtml(bulkStatusText[bulkPreview.batch?.status] || bulkPreview.batch?.status)} · ${escapeHtml(bulkPreview.batch?.fileCount || 0)} 个文件</span></summary>${bulkPreviewPanel}</details>` : ""}
    ${salesPreviewPanel ? `<details class="connection-preview-fold" ${salesPreview.isCurrent || salesPreview.blocked ? "open" : ""}><summary><strong>链接利润表导入</strong><span>${escapeHtml(salesStatusText)} · ${escapeHtml(salesSummary.fileName || "—")}</span></summary>${salesPreviewPanel}</details>` : ""}
    ${dailyPreviewPanel ? `<details class="connection-preview-fold" ${!factCommit || dailySummary.relationRecalculationRequired ? "open" : ""}><summary><strong>销售日报导入</strong><span>${escapeHtml(dailySummary.dateStart && dailySummary.dateEnd ? `${dailySummary.dateStart} 至 ${dailySummary.dateEnd}` : dailySummary.fileName || "—")} · 待确认 ${dailySummary.pendingRelationRows || 0} · 异常 ${dailySummary.errorRows || 0}</span></summary>${dailyPreviewPanel}</details>` : ""}
    ${canManage() ? `<details class="connection-foundation-panel connection-collapsible-panel"><summary><strong>管理员解析模板</strong><span>${foundation.templates.length} 个模板</span></summary><form data-foundation-template-form class="connection-foundation-template-form"><input name="name" placeholder="模板名称" required /><select name="dataType">${types.map(([key, definition]) => `<option value="${escapeHtml(key)}">${escapeHtml(typeLabel(key))}</option>`).join("")}</select><input name="sourcePlatform" placeholder="来源平台" /><textarea name="fieldMappingsJson" placeholder='字段映射，例如 {"商品ID":"platformGoodsId"}' required></textarea><input name="changeNote" placeholder="版本说明" /><button type="submit" class="secondary-button">新增模板第1版</button></form><div class="connection-template-list">${foundation.templates.map((item) => `<article><div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(typeLabel(item.dataType))} · 第${escapeHtml(item.version)}版 · ${escapeHtml(dataUpdateStatusText(item.status))}</span></div><button type="button" class="text-button" data-iterate-foundation-template="${escapeHtml(item.id)}">迭代版本</button></article>`).join("") || "<p>暂无解析模板。</p>"}</div></details>` : ""}
    <details class="connection-foundation-panel connection-collapsible-panel"><summary><strong>导入记录</strong><span>最近 ${Math.min(foundation.batches.length, 10)} 条</span></summary><div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>文件</th><th>类型</th><th>时间</th><th>成功</th><th>异常</th><th>状态</th></tr></thead><tbody>${foundation.batches.slice(0, 10).map((item) => `<tr><td>${escapeHtml(item.fileName)}</td><td>${escapeHtml(typeLabel(item.importType))}</td><td>${escapeHtml(item.createdAt)}</td><td>${escapeHtml(item.matchedRows)}</td><td>${escapeHtml(item.errorRows)}</td><td>${escapeHtml(dataUpdateStatusText(item.status))}</td></tr>`).join("") || `<tr><td colspan="6">暂无导入记录</td></tr>`}</tbody></table></div></details>
    ${foundation.errors.length ? `<details class="connection-foundation-panel connection-collapsible-panel"><summary><strong>导入异常明细</strong><span>${foundation.errors.length} 条</span></summary><div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>文件</th><th>行号</th><th>外部标识</th><th>异常类型</th><th>说明</th></tr></thead><tbody>${foundation.errors.slice(0, 50).map((item) => `<tr><td>${escapeHtml(item.fileName)}</td><td>${escapeHtml(item.rowNumber)}</td><td>${escapeHtml(item.externalKey || "—")}</td><td>${escapeHtml(importErrorText(item.errorType))}</td><td>${escapeHtml(importErrorMessageText(item.errorMessage))}</td></tr>`).join("")}</tbody></table></div><small>仅展示最近 50 条，完整记录请在数据中心查看。</small></details>` : ""}
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
  const overviewHtml = `<header><div><p class="eyebrow">LINK HOSPITAL WORKSPACE</p><h2>链接医院</h2><p>沿用现有健康、诊断和改善规则，集中处理经营问题。</p></div></header><div class="connection-hospital-zones">${Object.entries(meta).map(([id, [label]]) => `<button type="button" class="${stage === id ? "is-active" : ""}" data-hospital-stage="${id}"><span>${label}</span><strong>${hospital.counts?.[id] || 0}</strong></button>`).join("")}</div>`;
  const listHtml = hospital.loading ? `<div class="empty-state">正在读取链接健康状态…</div>` : items.length ? `<div class="connection-hospital-grid">${items.map(card).join("")}</div>` : `<div class="empty-state"><strong>${escapeHtml(meta[stage][0])}暂无链接</strong></div>`;
  return `<section class="connection-hospital">${renderUiModule("link_hospital_overview", { overviewHtml, listHtml })}</section>`;
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
  const table = pageState.myLinkTable;
  const orderedColumns = table.fieldOrder.map((key) => LINK_DATA_COLUMNS.find((item) => item.key === key)).filter(Boolean);
  const visibleFields = table.fieldOrder.filter((key) => table.visibleFields.includes(key));
  const columnSetting = renderUiModule("link_column_setting", { columns: orderedColumns, visibleFields: table.visibleFields, open: table.columnSettingOpen });
  const pendingIssues = Object.values(pageState.hospital.counts || {}).reduce((total, value) => total + Number(value || 0), 0);
  return `<section class="my-links-workbench"><header><div><p class="eyebrow">MY LINK WORKSPACE</p><h2>我的链接</h2><p>关注销售贡献、经营风险与今天需要处理的问题。</p></div></header>
    ${renderUiModule("link_data_status", { state: pageState.linkDataStatus })}
    ${renderUiModule("my_link_summary", { summary: { ...summary, pendingIssues }, money: coreMoney })}
    ${renderUiModule("link_hospital_todo", { items: issues.map((item) => ({ ...item, stageLabel: stageText[item.stage] })), counts: pageState.hospital.counts })}
    ${renderUiModule("link_data_toolbar", { keyword: table.filters.keyword, range: table.range, filters: table.filters,
      platforms: table.filterOptions.platforms, shops: table.filterOptions.shops, columnSettingHtml: columnSetting, dataSource: table.dataSource })}
    ${renderUiModule("link_data_table", { items: table.items.map((item) => ({ ...item, imageUrl: item.mainImage ? resolveAssetUrl(item.mainImage) : "" })),
      pagination: table.pagination, fields: visibleFields, columns: orderedColumns, sort: table.sort, loading: table.loading, showOwner: false })}
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

function renderOwnerContribution() {
  const owners = pageState.managementOverview.owners ?? [];
  const money = (value) => `¥${Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
  return `<section class="connection-owner-contribution"><header><div><strong>负责人经营贡献</strong><span>按最近经营周期销售额排序</span></div></header>${owners.length ? `<div class="connection-table-wrap"><table class="connection-table"><thead><tr><th>负责人</th><th>连接数</th><th>销售额</th><th>净利润</th><th>平均增长</th><th>风险连接</th><th>有效改善</th></tr></thead><tbody>${owners.slice(0, 20).map((owner) => `<tr><td><strong>${escapeHtml(owner.ownerName)}</strong></td><td>${owner.connectionCount}</td><td>${money(owner.salesAmount)}</td><td>${money(owner.netProfit)}</td><td>${growthText(owner.averageGrowth)}</td><td>${owner.riskCount}</td><td>${owner.effectiveImprovements}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state compact">暂无负责人经营数据</div>`}</section>`;
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
    <section class="link-business-analysis"><header><div><h3>全部链接经营数据表</h3></div></header>${toolbarHtml}${tableHtml}</section>
  </section>`;
}

function renderOwnerImportUploader() {
  if (!canManage()) return "";
  const people = (state.people ?? []).filter((person) => person.status === "active");
  return `<form data-connection-owner-import-form class="connection-foundation-import-form">
    <label>链接编号表<input type="file" name="file" accept=".xls,.xlsx" required /><small>表格文件仅需一列：链接编号</small></label>
    <label>匹配负责人<select name="ownerId" required><option value="">请选择负责人</option>${people.map((person) => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.name)}</option>`).join("")}</select></label>
    <button type="submit" class="secondary-button" ${pageState.ownerImport.loading ? "disabled" : ""}>${pageState.ownerImport.loading ? "正在解析…" : "读取链接并预览"}</button>
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

function cockpitStageText(stage) { return ({ normal:"正常",diagnosis:"诊断中",treatment:"治疗中",observation:"观察中" })[stage] ?? stage; }
function cockpitSalesPeriodText(summary) {
  const start = String(summary.salesPeriodStart || "").slice(0, 10); const end = String(summary.salesPeriodEnd || "").slice(0, 10);
  if (!start || !end) return "暂无已导入 ERP 销售周期";
  const range = start === end ? start : `${start} 至 ${end}`;
  return summary.salesPeriodAligned ? `统计周期 ${range}` : `各链接最新周期 ${range}（共 ${summary.salesPeriodCount || 0} 个周期）`;
}
function renderGoalHealthCockpit() {
  const model = pageState.goalHealth || {}; const grades = model.gradeSummary || {}; const period = model.evaluationPeriod || {};
  const periodText = period.periodEnd ? `滚动30天 · 数据截止 ${period.periodEnd}${Number(period.periodCount || 0) > 1 ? ` · ${period.periodCount}个评价周期` : ""}` : "滚动30天 · 暂无已完成评价";
  const gradeItems = [["excellent","优秀"],["good","良好"],["on_target","达标"],["underperforming","不达标"]];
  return `<section class="cockpit-panel connection-goal-health-cockpit"><header><div><h3>链接经营健康度</h3><span>${escapeHtml(periodText)}</span></div><button type="button" class="text-button" data-goal-health-drill="all">进入链接经营管理 →</button></header>
    <div class="connection-goal-health-coverage"><article><span>管理覆盖</span><strong>${model.totalLinks || 0}</strong><small>已设置定位 ${model.positionedLinks || 0} · 未设置 ${model.unpositionedLinks || 0}</small></article><article><span>目标覆盖</span><strong>${model.activeGoalLinks || 0}</strong><small>待设置 ${model.pendingGoalLinks || 0}</small><button type="button" class="text-button" data-goal-health-drill="goal-pending">查看待设置目标</button></article><article><span>评价覆盖</span><strong>${model.evaluatedLinks || 0}</strong><small>待评价 ${model.pendingEvaluationLinks || 0}</small></article></div>
    <div class="connection-goal-grade-summary"><div><strong>评级分布</strong><small>仅统计已评价链接 ${model.evaluatedLinks || 0} 条</small></div>${gradeItems.map(([code,label]) => `<button type="button" data-goal-health-drill="grade" data-evaluation-status="${code}" class="goal-grade-${code}"><span>${label}</span><strong>${grades[code] || 0}</strong></button>`).join("")}</div>
    <div class="connection-goal-positioning-summary">${(model.positioningSummary || []).map((item) => `<article><header><strong>${escapeHtml(item.positioningName)}</strong><small>${item.totalLinks || 0} 条 · 已评价 ${item.evaluatedLinks || 0}</small></header><div>${gradeItems.map(([code,label]) => code === "underperforming" ? `<button type="button" data-goal-health-drill="grade" data-positioning="${escapeHtml(item.positioningType)}" data-evaluation-status="${code}"><span>${label}</span><b>${item[code] || 0}</b></button>` : `<span><em>${label}</em><b>${item[code] || 0}</b></span>`).join("")}</div></article>`).join("")}</div>
  </section>`;
}
function renderBusinessCockpit() {
  const cockpit=pageState.cockpit; const summary=cockpit.summary??{}; const health=cockpit.health??{};
  const totalHealth=Number(health.healthy||0)+Number(health.attention||0)+Number(health.risk||0)+Number(health.noData||0);
  const healthRate=(value)=>totalHealth?`${(Number(value||0)/totalHealth*100).toFixed(1)}%`:"—";
  const linkCard=(item,extra="")=>`<button type="button" class="connection-cockpit-link" data-open-connection="${escapeHtml(item.id)}">${imageHtml(item)}<span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(`${item.platform} · ${item.shopName}`)}</small><em>销售 ${coreMoney(item.erpSales?.salesAmount)} · 利润 ${coreMoney(item.erpSales?.profitAmount)} · 利润率 ${corePercent(item.erpSales?.profitMargin)}</em><i>${escapeHtml(healthText(item.healthStatus))} · ${escapeHtml(extra||growthText(item.salesGrowth))}</i></span></button>`;
  const trendRows=[...(cockpit.trends?.erp??[]).map((item)=>({...item,visitorCount:null,source:"ERP"})),...(cockpit.trends?.platform??[]).map((item)=>({...item,salesAmount:null,profitAmount:null,source:"平台"}))].filter((item)=>item.periodType===cockpit.periodType).sort((a,b)=>String(a.periodEnd).localeCompare(String(b.periodEnd))||a.source.localeCompare(b.source));
  const salesPeriodText = cockpitSalesPeriodText(summary);
  return `<section class="connection-business-cockpit"><header><div><h2>经营链接驾驶舱</h2></div></header>
    ${renderUiModule("link_sales_distribution", { state: pageState.salesDistribution, canViewCompany: isAdmin() })}
    <section class="cockpit-summary"><div><span>链接数量</span><strong>${summary.connectionCount||0}</strong><small>正常经营 ${summary.normalCount||0}</small></div><div class="is-sales"><span>ERP销售额</span><strong>${coreMoney(summary.salesAmount)}</strong><small>${escapeHtml(salesPeriodText)}</small><small>较各链接上一周期 ${growthText(summary.salesGrowth)}</small></div><div><span>利润</span><strong>${coreMoney(summary.profitAmount)}</strong><small>利润率 ${corePercent(summary.profitMargin)}</small></div><div class="is-risk"><span>风险链接</span><strong>${summary.riskCount||0}</strong><small>需要管理关注</small></div><div class="is-diagnosis"><span>诊断中</span><strong>${summary.diagnosisCount||0}</strong><small>等待定位问题</small></div><div class="is-treatment"><span>治疗中</span><strong>${summary.treatmentCount||0}</strong><small>正在推进改善</small></div></section>
    <section class="cockpit-health"><header><h3>健康状态</h3><span>高利润链接 ${summary.highProfitCount||0} · 利润风险 ${summary.profitRiskCount||0}</span></header><div><span>健康 <b>${health.healthy||0}</b><em>${healthRate(health.healthy)}</em></span><span>关注 <b>${health.attention||0}</b><em>${healthRate(health.attention)}</em></span><span>异常 <b>${health.risk||0}</b><em>${healthRate(health.risk)}</em></span><span>待积累数据 <b>${health.noData||0}</b><em>${healthRate(health.noData)}</em></span></div></section>
    ${renderGoalHealthCockpit()}
    ${renderOwnerContribution()}
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

function renderConnectionBusinessPositioning(core) {
  const model = core?.businessPositioning;
  if (!model) return `<section class="connection-v3-panel"><h3>经营定位</h3><div class="empty-state compact">正在读取经营定位…</div></section>`;
  const current = model.current;
  const template = model.currentTemplate;
  const metrics = template?.metrics ?? [];
  const history = model.history ?? [];
  const metricText = metrics.map((metric) => `${metric.metricName} ${Math.round(Number(metric.weight || 0) * 100)}%`).join(" · ");
  return `<section class="connection-v3-panel connection-positioning-panel"><header><div><h3>经营定位</h3><p>定位由人工确认，系统不会根据销售数据自动判断。</p></div>${current ? `<span class="status-pill">${escapeHtml(current.positioningName)}</span>` : `<span class="status-pill">未设置</span>`}</header>
    <div class="connection-positioning-summary"><div><span>当前定位</span><strong>${escapeHtml(current?.positioningName || "未设置")}</strong></div><div><span>目标模板</span><strong>${escapeHtml(template?.name || "设置定位后自动关联")}</strong><small>${template ? `${template.windowDays}天 · V${template.version}` : "—"}</small></div><div><span>指标权重</span><strong>${escapeHtml(metricText || "—")}</strong></div></div>
    ${model.permissions?.canEdit ? `<form class="connection-positioning-form" data-connection-positioning-form><label>经营定位<select name="positioningType" required><option value="">请选择</option>${model.options.map((option) => `<option value="${escapeHtml(option.value)}" ${current?.positioningType === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select></label><label>修改原因<textarea name="decisionReason" rows="2" maxlength="500" required placeholder="说明本次人工判断依据"></textarea></label><button type="submit" class="primary-button">保存定位</button></form>` : `<p class="form-note">普通运营可查看定位；仅管理员或当前链接负责人可以修改。</p>`}
    ${history.length ? `<details class="connection-positioning-history"><summary>定位历史（${history.length}）</summary><div class="connection-template-list">${history.map((row) => `<article><div><strong>${escapeHtml(row.positioningName)}</strong><span>${escapeHtml(row.status === "active" ? "当前生效" : `${row.effectiveFrom} 至 ${row.effectiveTo || "—"}`)}</span><small>${escapeHtml(row.decisionReason)} · ${escapeHtml(row.decidedByName || "未知操作人")}</small></div></article>`).join("")}</div></details>` : ""}
  </section>`;
}
function goalMetric(plan, code) { return plan?.metrics?.find((metric) => metric.metricCode === code) ?? null; }
function goalModeText(mode) { return ({ system_suggested: "系统建议", manual: "人工设置", hybrid: "人工调整" })[mode] || mode || "—"; }
function goalStatusText(status) { return ({ draft: "待人工设置", pending_confirm: "待确认", active: "生效中", expired: "已到期", cancelled: "已取消" })[status] || status || "—"; }
function goalGradeText(grade) { return ({ excellent: "优秀", good: "良好", on_target: "达标", underperforming: "不达标" })[grade] || "—"; }
function renderConnectionGoalEvaluation(core) {
  const evaluation = core?.businessGoalEvaluation;
  if (!evaluation) return `<div class="empty-state compact">正在计算近30天目标达成…</div>`;
  if (evaluation.evaluationStatus !== "evaluated") {
    const dataPeriod = evaluation.periodStart ? ` · 数据周期 ${evaluation.periodStart} 至 ${evaluation.periodEnd}` : "";
    return `<div class="connection-goal-evaluation pending"><strong>待评价</strong><span>${escapeHtml(evaluation.reason || "暂不满足评价条件")}${escapeHtml(dataPeriod)}</span></div>`;
  }
  return `<div class="connection-goal-evaluation"><header><div><strong>近30天目标达成</strong><small>${escapeHtml(`${evaluation.periodStart} 至 ${evaluation.periodEnd}`)}</small></div><span class="status-pill goal-grade-${escapeHtml(evaluation.grade)}">${escapeHtml(goalGradeText(evaluation.grade))}</span></header><div class="connection-goal-evaluation-grid"><div><span>销售目标</span><strong>${coreMoney(evaluation.salesTarget)}</strong><small>实际 ${coreMoney(evaluation.salesActual)} · 完成 ${corePercent(evaluation.salesAchievement)}</small></div><div><span>利润目标</span><strong>${coreMoney(evaluation.profitTarget)}</strong><small>实际 ${coreMoney(evaluation.profitActual)} · 完成 ${corePercent(evaluation.profitAchievement)}</small></div><div><span>综合完成率</span><strong>${corePercent(evaluation.totalAchievement)}</strong><small>销售权重 ${corePercent(evaluation.salesWeight)} · 利润权重 ${corePercent(evaluation.profitWeight)}</small></div></div></div>`;
}
function renderConnectionBusinessGoals(core) {
  const model = core?.businessGoals;
  if (!model) return `<section class="connection-v3-panel connection-positioning-panel"><h3>经营目标</h3><div class="empty-state compact">正在读取经营目标…</div></section>`;
  const current = model.current;
  const awaiting = model.awaitingConfirmation;
  const history = model.history ?? [];
  const sales = goalMetric(current, "sales_amount");
  const profit = goalMetric(current, "profit_amount");
  const pendingSales = goalMetric(awaiting, "sales_amount");
  const pendingProfit = goalMetric(awaiting, "profit_amount");
  const period = current?.effectiveFrom ? `${current.effectiveFrom.slice(0, 10)} 至 ${current.effectiveTo.slice(0, 10)}` : "近30天";
  return `<section class="connection-v3-panel connection-positioning-panel"><header><div><h3>经营目标</h3><p>目标建议来自销售日报事实的完整30天窗口，不计算完成率或评级。</p></div>${current ? `<span class="status-pill status-active">生效中</span>` : awaiting ? `<span class="status-pill">${escapeHtml(goalStatusText(awaiting.status))}</span>` : ""}</header>
    ${current ? `<div class="connection-positioning-summary"><div><span>目标周期</span><strong>${escapeHtml(period)}</strong></div><div><span>销售目标</span><strong>${coreMoney(sales?.finalTargetValue)}</strong></div><div><span>利润目标</span><strong>${coreMoney(profit?.finalTargetValue)}</strong></div><div><span>目标来源</span><strong>${escapeHtml(goalModeText(current.targetMode))}</strong></div></div>` : ""}
    ${renderConnectionGoalEvaluation(core)}
    ${awaiting ? `<div class="connection-goal-pending"><div class="connection-positioning-summary"><div><span>状态</span><strong>${escapeHtml(goalStatusText(awaiting.status))}</strong></div><div><span>系统建议销售</span><strong>${coreMoney(pendingSales?.suggestedTargetValue)}</strong></div><div><span>系统建议利润</span><strong>${coreMoney(pendingProfit?.suggestedTargetValue)}</strong></div><div><span>基准周期</span><strong>${awaiting.baselineStart ? escapeHtml(`${awaiting.baselineStart} 至 ${awaiting.baselineEnd}`) : "数据不足30天"}</strong></div></div>
      ${model.permissions?.canEdit ? `<form class="connection-positioning-form connection-goal-confirm-form" data-connection-goal-confirm-form data-plan-id="${escapeHtml(awaiting.id)}"><label>销售目标<input name="salesAmount" type="number" min="0" step="0.01" required value="${pendingSales?.suggestedTargetValue ?? ""}" /></label><label>利润目标<input name="profitAmount" type="number" step="0.01" required value="${pendingProfit?.suggestedTargetValue ?? ""}" /></label><label>调整原因<textarea name="approvalReason" rows="2" maxlength="500" placeholder="按建议确认可留空；修改建议必须填写"></textarea></label><button type="submit" class="primary-button">确认并生效</button></form>` : `<p class="form-note">等待管理员或当前链接负责人确认。</p>`}</div>` : ""}
    ${!awaiting && model.permissions?.canEdit ? `<button type="button" class="secondary-button" data-create-connection-goal>生成目标建议</button>` : !current && !awaiting ? `<div class="empty-state compact">当前没有目标计划</div>` : ""}
    ${history.length ? `<details class="connection-positioning-history"><summary>目标历史（${history.length}）</summary><div class="connection-template-list">${history.map((plan) => `<article><div><strong>${escapeHtml(`${plan.positioningName} · ${goalStatusText(plan.status)}`)}</strong><span>${escapeHtml(`${plan.templateName} V${plan.templateVersion} · ${goalModeText(plan.targetMode)}`)}</span><small>销售 ${coreMoney(goalMetric(plan, "sales_amount")?.finalTargetValue ?? goalMetric(plan, "sales_amount")?.suggestedTargetValue)} · 利润 ${coreMoney(goalMetric(plan, "profit_amount")?.finalTargetValue ?? goalMetric(plan, "profit_amount")?.suggestedTargetValue)}${plan.approvalReason ? ` · ${escapeHtml(plan.approvalReason)}` : ""}</small></div></article>`).join("")}</div></details>` : ""}
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
    ?? pageState.myWorkbench.items.find((candidate) => candidate.id === pageState.selectedId)
    ?? pageState.myLinkTable.items.find((candidate) => candidate.id === pageState.selectedId)
    ?? pageState.businessTable.items.find((candidate) => candidate.id === pageState.selectedId);
  if (!item) return "";
  const tabs = [["business", "经营概览"], ["diagnosis", "问题诊断"], ["sales", "销售分析"], ["inventory", "商品库存"], ["advanced", "高级信息"]];
  let body = "";
  if (pageState.coreDetailLoading) body = `<div class="empty-state">正在读取链接经营详情…</div>`;
  else if (pageState.detailTab === "business") body = renderUiModule("link_business_summary", {
    metricsHtml: `${renderConnectionBusinessPositioning(pageState.coreDetail)}${renderConnectionBusinessGoals(pageState.coreDetail)}${renderCoreOperatingOverview(item, pageState.coreDetail)}`,
    trendHtml: renderCorePlatform(pageState.coreDetail),
    healthHtml: `<section class="connection-v3-panel"><h3>健康状态</h3><div class="connection-v3-metrics"><div><span>健康分</span><strong>${item.healthScore == null ? "—" : Number(item.healthScore)}</strong></div><div><span>经营状态</span><strong>${escapeHtml(healthText(item.healthStatus || "no_data"))}</strong></div><div><span>销售趋势</span><strong>${growthText(item.salesGrowth)}</strong></div><div><span>利润趋势</span><strong>${growthText(item.profitGrowth)}</strong></div></div></section>`,
    productHtml: renderCoreProducts(pageState.coreDetail),
  });
  else if (pageState.detailTab === "diagnosis") body = renderUiModule("link_hospital_overview", {
    overviewHtml: canViewHealth() ? renderHealthReport() : "",
    listHtml: renderConnectionHospitalDetail(item),
    actionsHtml: `${renderImprovements()}${renderActions(item)}`,
  });
  else if (pageState.detailTab === "sales") body = renderUiModule("link_sales_analysis", {
    platformHtml: renderUiModule("link_daily_sales", { data: pageState.dailySales.data, loading: pageState.dailySales.loading, rangePreset: pageState.dailySales.rangePreset }), erpHtml: `${renderCorePlatform(pageState.coreDetail)}${renderErpSales(pageState.coreDetail)}`, skuHtml: renderSkuSales(pageState.coreDetail),
    trendHtml: pageState.growthAnalysis ? renderCoreOperatingOverview(item, pageState.coreDetail) : `<div class="empty-state compact">正在按需读取经营趋势…</div>`,
  });
  else if (pageState.detailTab === "inventory") body = renderUiModule("link_inventory_summary", { productsHtml: renderCoreProducts(pageState.coreDetail), inventoryHtml: renderInventory(pageState.coreDetail) });
  else body = `<div class="link-workspace-stack">${renderCoreBasic(item, pageState.coreDetail)}${renderBenchmarkPanel(item)}</div>`;
  const header = renderUiModule("link_detail_header", { item, imageHtml: imageHtml(item), channel: `${item.platform} · ${shopName(item)}`, productSummary: productNames(item), operationHtml: renderConnectionOperationBar(item) });
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

function renderDiagnosisModal() {
  if (!pageState.diagnosisModalId) return "";
  const item = pageState.items.find((candidate) => candidate.id === pageState.diagnosisModalId)
    ?? pageState.myWorkbench.items.find((candidate) => candidate.id === pageState.diagnosisModalId)
    ?? pageState.myLinkTable.items.find((candidate) => candidate.id === pageState.diagnosisModalId);
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
  const pageContent = pageState.section === "cockpit" ? renderBusinessCockpit() : pageState.section === "hospital" ? renderConnectionHospital() : pageState.section === "my-links" ? renderMyLinksWorkbench() : pageState.section === "goal-management" ? renderGoalManagement() : pageState.section === "data-import" ? renderDataUpdateWorkspace() : pageState.section === "sales-relation-governance" ? renderSalesRelationGovernance() : pageState.section === "sales-data-quality-governance" ? renderSalesDataQualityGovernance() : renderConnectionAssets();
  return `<section class="connection-center-page">${pageState.error ? `<div class="form-error">${escapeHtml(pageState.error)}</div>` : ""}${pageState.loading ? `<div class="empty-state">正在读取连接…</div>` : pageState.selectedId ? renderDetail() : `${renderSectionNavigation()}${pageContent}`}${renderMappingModal()}${renderImprovementModal()}${renderBenchmarkModal()}${renderDiagnosisModal()}</section>`;
}

async function loadHospital(render) {
  pageState.hospital.loading = true; pageState.error = ""; render();
  try { const result = await loadConnectionHospital(); pageState.hospital = { ...pageState.hospital, ...result, loading: false, loaded: true }; }
  catch (error) { pageState.error = error.message; pageState.hospital.loading = false; }
  render();
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
    const result = await loadLinkSalesDistribution({
      scope: pageState.salesDistribution.scope,
      preset: pageState.salesDistribution.range?.preset || "7d",
      startDate: pageState.salesDistribution.range?.startDate || "",
      endDate: pageState.salesDistribution.range?.endDate || "",
    });
    pageState.salesDistribution = { ...pageState.salesDistribution, ...result, loaded: true, loading: false, error: "" };
  } catch (error) { pageState.salesDistribution = { ...pageState.salesDistribution, loaded: true, loading: false, error: error.message }; }
  render();
}

async function loadDistributionRangeTable(render, start, end, ids = []) {
  const distribution = pageState.salesDistribution;
  const connectionIds = ids.length ? ids : distribution.items.filter((item) => item.rank >= start && item.rank <= end).map((item) => item.linkId);
  pageState.salesDistribution = { ...distribution, selectedRange: { start, end }, drillTable: { loading: true, items: [], pagination: {} } }; render();
  try {
    const result = await loadLinkDataTable({ scope: distribution.scope, preset: distribution.range?.preset || "7d",
      startDate: distribution.range?.startDate || "", endDate: distribution.range?.endDate || "", page: 1, pageSize: 20,
      sortField: "selectedSales", sortDirection: "desc", connectionIds: connectionIds.join(","),
      fields: "image,name,platform,shop,owner,selectedSales,growthStatus,healthStatus,hospitalStatus" });
    pageState.salesDistribution = { ...pageState.salesDistribution, drillTable: { ...result,
      items: (result.items || []).map((item) => ({ ...item, imageUrl: item.mainImage ? resolveAssetUrl(item.mainImage) : "" })),
      fields: ["image", "name", "platform", "shop", "owner", "selectedSales", "growthStatus", "healthStatus", "hospitalStatus"],
      columns: LINK_DATA_COLUMNS, sort: { field: "selectedSales", direction: "desc" }, loading: false, showOwner: distribution.scope === "company" } };
  } catch (error) { pageState.salesDistribution = { ...pageState.salesDistribution, drillTable: null, error: error.message }; }
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

async function loadLinkBusinessTablePage(render) {
  const table = pageState.businessTable;
  pageState.businessTable = { ...table, loading: true }; pageState.error = ""; render();
  try {
    const result = await loadLinkBusinessTable({ scope: isAdmin() ? "company" : "mine", page: table.pagination.page,
      pageSize: table.pagination.pageSize, preset: table.range.preset, startDate: table.range.startDate, endDate: table.range.endDate,
      keyword: table.filters.keyword, platform: table.filters.platform, shopId: table.filters.shopId, ownerId: table.filters.ownerId,
      minSales: table.filters.minSales, maxSales: table.filters.maxSales, minProfit: table.filters.minProfit, maxProfit: table.filters.maxProfit,
      growthStatus: table.filters.growthStatus, healthStatus: table.filters.healthStatus, hospitalStatus: table.filters.hospitalStatus,
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

async function loadBusinessCockpitPage(render) {
  try {
    const [cockpit, managementOverview, goalHealth] = await Promise.all([loadConnectionBusinessCockpit(), loadConnectionManagementOverview(), loadConnectionGoalHealthSummary()]);
    pageState.cockpit = { ...pageState.cockpit, ...cockpit }; pageState.managementOverview = managementOverview; pageState.goalHealth = goalHealth; pageState.error = "";
  }
  catch (error) { pageState.error = error.message; }
  render();
}

async function loadPage(render) {
  pageState.loading = true; pageState.error = ""; render();
  try {
    const [cockpit, managementOverview, distribution, goalHealth] = await Promise.all([loadConnectionBusinessCockpit(), loadConnectionManagementOverview(), loadLinkSalesDistribution({ scope: isAdmin() ? "company" : "mine", preset: "7d" }), loadConnectionGoalHealthSummary()]);
    pageState.cockpit = { ...pageState.cockpit, ...cockpit };
    pageState.managementOverview = managementOverview;
    pageState.goalHealth = goalHealth;
    pageState.salesDistribution = { ...pageState.salesDistribution, ...distribution, loaded: true, loading: false, error: "" };
    pageState.loadedSections.add("cockpit");
    pageState.loaded = true;
    pageState.loadedUserId = String(getCurrentUser()?.personId ?? getCurrentUser()?.id ?? "");
  } catch (error) { pageState.error = error.message; }
  pageState.loading = false; render();
}

async function openConnection(id, render) {
  if (window.location.hash !== `#connectionCenter/${encodeURIComponent(id)}`) window.history.replaceState(null, "", `#connectionCenter/${encodeURIComponent(id)}`);
  pageState.selectedId = id; pageState.detailTab = "business"; pageState.detailLoaded = new Set(["business"]); pageState.coreDetail = null; pageState.coreDetailLoading = true; pageState.dailySales = { data: null, loading: false, loaded: false, rangePreset: "30d", error: "" }; pageState.actions = []; pageState.periodSnapshots = []; pageState.growthAnalysis = null; pageState.healthRecords = []; pageState.healthModalId = ""; pageState.improvements = []; pageState.benchmarks = { items: [], candidates: [], comparison: null, comparisonId: "", loading: false }; render();
  try {
    const [detail, businessPositioning, businessGoals, businessGoalEvaluation] = await Promise.all([loadConnectionCoreDetail(id), loadConnectionBusinessPositioning(id), loadConnectionBusinessGoals(id), loadConnectionBusinessGoalEvaluation(id)]);
    pageState.coreDetail = { ...detail, businessPositioning, businessGoals, businessGoalEvaluation }; pageState.error = "";
  }
  catch (error) { pageState.error = error.message; }
  pageState.coreDetailLoading = false; render();
}

async function loadDailySales(render, rangePreset = pageState.dailySales.rangePreset) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - (rangePreset === "7d" ? 6 : 29));
  pageState.dailySales = { ...pageState.dailySales, loading: true, rangePreset, error: "" }; render();
  try {
    const data = await loadConnectionDailySales(pageState.selectedId, { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) });
    pageState.dailySales = { data, loading: false, loaded: true, rangePreset, error: "" };
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
    const [loaded, currentSalesPreview, currentDailyPreview, ownerImport] = await Promise.all([loadConnectionDataFoundation(), loadCurrentConnectionSalesFactImport(), loadCurrentConnectionSalesDailyImport(), canManage() ? loadCurrentConnectionOwnerImport() : Promise.resolve(null)]);
    pageState.foundation = { ...loaded, loading: false, preview: pageState.foundation.preview ?? null, bulkPreview: loaded.bulkPreview ?? pageState.foundation.bulkPreview ?? null, salesPreview: pageState.foundation.salesPreview ?? currentSalesPreview ?? null, salesLoading: pageState.foundation.salesLoading ?? false, salesError: pageState.foundation.salesError ?? "", salesMessage: pageState.foundation.salesMessage ?? "", salesFileName: pageState.foundation.salesFileName ?? "", salesFile: pageState.foundation.salesFile ?? null, dailyPreview: pageState.foundation.dailyPreview ?? currentDailyPreview ?? null, dailyLoading: pageState.foundation.dailyLoading ?? false, dailyCommitting: pageState.foundation.dailyCommitting ?? false, dailyError: pageState.foundation.dailyError ?? "", dailyMessage: pageState.foundation.dailyMessage ?? "", dailyFileName: pageState.foundation.dailyFileName ?? "", dailyFile: pageState.foundation.dailyFile ?? null, dailyCategory: pageState.foundation.dailyCategory ?? "ready" };
    pageState.ownerImport.result = ownerImport;
    pageState.loadedSections.add("data-import");
    if (["waiting", "running"].includes(pageState.foundation.bulkPreview?.batch?.status)) window.setTimeout(() => void pollConnectionBulkPreview(pageState.foundation.bulkPreview.batch.id, render), 800);
  }
  catch (error) { pageState.error = error.message; pageState.foundation.loading = false; }
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
    pageState.salesDistribution = { scope: isAdmin() ? "company" : "mine", range: { preset: "7d" }, items: [], summary: {}, selectedGroup: 0, selectedRange: null, drillTable: null, loading: false, loaded: false, error: "" };
    pageState.selectedId = "";
    pageState.coreDetail = null;
    pageState.ownerImport = { loading: false, result: null, showCompletion: false };
  }
  if (!pageState.loaded && !pageState.loading) void loadPage(render);
  const route = parseConnectionCenterRoute(window.location.hash);
  if (route.redirectHash) { window.location.hash = route.redirectHash; return; }
  const hasDetailRoute = Boolean(route.detailId);
  if (pageState.loaded && hasDetailRoute && pageState.selectedId !== route.detailId) void openConnection(route.detailId, render);
  if (!hasDetailRoute) {
    const previousSection = pageState.section; const hadDetail = Boolean(pageState.selectedId);
    const selectedSection = selectConnectionSection(route.section || pageState.section, { updateRoute: true });
    if (previousSection !== selectedSection || hadDetail) { render(); return; }
    if (pageState.loaded) ensureConnectionSectionLoaded(selectedSection, render);
  }
  root.querySelectorAll("[data-connection-section]").forEach((button) => button.addEventListener("click", () => {
    const section = selectConnectionSection(button.dataset.connectionSection); render(); ensureConnectionSectionLoaded(section, render);
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
      if (selected.governanceType === "combo" && selected.reviewTarget?.id) {
        pageState.comboReviews.selected = await loadComboReviewDetail(selected.reviewTarget.id);
        pageState.comboReviews.anomalies = await loadComboReviewAnomalyDates(selected.reviewTarget.id, { page: 1, pageSize: 10 });
        pageState.comboReviews.sourceRows = await loadComboReviewSourceRows(selected.reviewTarget.id, { page: 1, pageSize: 20 });
      }
    } catch (error) { pageState.error = error.message; }
    render();
  });
  root.querySelector("[data-link-distribution-filter]")?.addEventListener("submit", (event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget); const preset = String(data.get("preset") || "7d");
    void loadSalesDistribution(render, { scope: String(data.get("scope") || "mine"), range: { preset,
      startDate: String(data.get("startDate") || ""), endDate: String(data.get("endDate") || "") } });
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
  root.querySelector("[data-link-business-toolbar]")?.addEventListener("submit", (event) => {
    event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget));
    pageState.businessTable.range = { preset: String(data.preset || "7d"), startDate: String(data.startDate || ""), endDate: String(data.endDate || "") };
    pageState.businessTable.filters = { ...pageState.businessTable.filters, keyword: String(data.keyword || ""), platform: String(data.platform || ""),
      shopId: String(data.shopId || ""), ownerId: String(data.ownerId || ""), minSales: String(data.minSales || ""), maxSales: String(data.maxSales || ""),
      minProfit: String(data.minProfit || ""), maxProfit: String(data.maxProfit || ""), growthStatus: String(data.growthStatus || ""),
      healthStatus: String(data.healthStatus || ""), hospitalStatus: String(data.hospitalStatus || "") };
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
    pageState.businessTable.filters = { keyword: "", platform: "", shopId: "", ownerId: "", minSales: "", maxSales: "", minProfit: "", maxProfit: "", growthStatus: "", healthStatus: "", hospitalStatus: "", expanded: false };
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
  root.querySelectorAll("[data-workbench-hospital]").forEach((button) => button.addEventListener("click", () => {
    selectConnectionSection("hospital"); pageState.hospital.stage = button.dataset.workbenchHospital; void loadHospital(render);
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
      selectConnectionSection("hospital"); pageState.hospital.stage = "diagnosis"; render(); }
    catch (error) { pageState.error = error.message; render(); }
  });
  root.querySelectorAll("[data-my-link-filter]").forEach((button) => button.addEventListener("click", () => { void loadMyLinks(render, button.dataset.myLinkFilter); }));
  root.querySelector("[data-link-data-toolbar]")?.addEventListener("submit", (event) => {
    event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
    pageState.myLinkTable.filters = { keyword: String(values.keyword || ""), platform: String(values.platform || ""),
      shopId: String(values.shopId || ""), archiveStatus: String(values.archiveStatus || "") };
    pageState.myLinkTable.range = { preset: String(values.preset || "7d"), startDate: String(values.startDate || ""), endDate: String(values.endDate || "") };
    if (pageState.myLinkTable.range.preset === "custom" && !pageState.myLinkTable.visibleFields.includes("selectedSales")) pageState.myLinkTable.visibleFields.push("selectedSales");
    pageState.myLinkTable.pagination.page = 1; void loadMyLinks(render);
  });
  root.querySelector('[data-link-data-toolbar] [name="preset"]')?.addEventListener("change", (event) => {
    pageState.myLinkTable.range.preset = event.currentTarget.value; render();
  });
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
  root.querySelectorAll("[data-goal-pilot-target]").forEach((form) => form.addEventListener("submit", (event) => {
    event.preventDefault(); const input = { ...Object.fromEntries(new FormData(event.currentTarget)), planId: form.dataset.planId };
    void runGoalPilotOperation(render, () => confirmConnectionGoalPilotTarget(pageState.goalPilot.selectedBatchId, form.dataset.memberId, input));
  }));
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
  root.querySelector("[data-connection-profile-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await updateConnection(pageState.selectedId, Object.fromEntries(new FormData(event.currentTarget)));
      pageState.items = pageState.items.map((item) => item.id === result.item.id ? { ...item, ...result.item } : item);
      pageState.error = ""; render();
    } catch (error) { pageState.error = error.message; render(); }
  });
  root.querySelector("[data-connection-positioning-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget; const button = form.querySelector("button[type='submit']");
    if (button) button.disabled = true;
    try {
      const result = await updateConnectionBusinessPositioning(pageState.selectedId, Object.fromEntries(new FormData(form)));
      const businessGoalEvaluation = await loadConnectionBusinessGoalEvaluation(pageState.selectedId);
      pageState.coreDetail = { ...pageState.coreDetail, businessPositioning: result, businessGoalEvaluation };
      pageState.error = ""; render();
    } catch (error) { pageState.error = error.message; if (button) button.disabled = false; render(); }
  });
  root.querySelector("[data-create-connection-goal]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget; button.disabled = true;
    try {
      const result = await createConnectionBusinessGoalSuggestion(pageState.selectedId);
      pageState.coreDetail = { ...pageState.coreDetail, businessGoals: result };
      pageState.error = ""; render();
    } catch (error) { pageState.error = error.message; button.disabled = false; render(); }
  });
  root.querySelector("[data-connection-goal-confirm-form]")?.addEventListener("submit", async (event) => {
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
  root.querySelectorAll("[data-connection-tab]").forEach((button) => button.addEventListener("click", async () => {
    pageState.detailTab = button.dataset.connectionTab; render();
    if (pageState.detailLoaded.has(pageState.detailTab)) return;
    try {
      if (pageState.detailTab === "diagnosis") {
        const [actions, improvements, records, analysis, hospital] = await Promise.all([loadConnectionActions(pageState.selectedId), loadConnectionImprovements({ connectionId: pageState.selectedId }), canViewHealth() ? loadConnectionHealthRecords(pageState.selectedId) : Promise.resolve({ items: [] }), loadConnectionGrowthAnalysis(pageState.selectedId), loadConnectionHospital()]);
        pageState.actions = actions.items ?? []; pageState.improvements = improvements.items ?? []; pageState.healthRecords = records.items ?? []; pageState.growthAnalysis = analysis.item; pageState.hospital = { ...pageState.hospital, ...hospital, loading: false };
      }
      if (pageState.detailTab === "sales") { const [snapshots, analysis] = await Promise.all([loadConnectionPeriodSnapshots(pageState.selectedId), loadConnectionGrowthAnalysis(pageState.selectedId), loadDailySales(() => {})]); pageState.periodSnapshots = snapshots.items ?? []; pageState.growthAnalysis = analysis.item; }
      if (pageState.detailTab === "advanced") await loadBenchmarks(() => {});
      pageState.detailLoaded.add(pageState.detailTab); pageState.error = ""; render();
    } catch (error) { pageState.error = error.message; render(); }
  }));
  root.querySelectorAll("[data-sales-period-type]").forEach((button) => button.addEventListener("click", () => { pageState.salesPeriodType = button.dataset.salesPeriodType; render(); }));
  root.querySelectorAll("[data-daily-sales-range]").forEach((button) => button.addEventListener("click", () => void loadDailySales(render, button.dataset.dailySalesRange)));
  root.querySelectorAll("[data-cockpit-period]").forEach((button) => button.addEventListener("click", () => { pageState.cockpit.periodType = button.dataset.cockpitPeriod; render(); }));
  root.querySelectorAll("[data-goal-health-drill]").forEach((button) => button.addEventListener("click", () => {
    const filters = { keyword: "", positioning: button.dataset.positioning || "", goalStatus: "", evaluationStatus: "", ownerId: "" };
    if (button.dataset.goalHealthDrill === "goal-pending") filters.goalStatus = "pending";
    if (button.dataset.goalHealthDrill === "grade") filters.evaluationStatus = button.dataset.evaluationStatus || "underperforming";
    selectConnectionSection("goal-management");
    void loadGoalWorkbenchPage(render, { filters, pagination: { page: 1 } });
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
  root.querySelectorAll("[data-view-mapping-connection]").forEach((button) => button.addEventListener("click", () => { selectConnectionSection("connections"); void openConnection(button.dataset.viewMappingConnection, render); }));
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
    if (!file) { pageState.foundation.salesError = "请先选择链接利润表文件。"; render(); return; }
    pageState.foundation.salesLoading = true; pageState.error = ""; render();
    try {
      const result = await previewConnectionSalesFactImport(file);
      pageState.foundation.salesPreview = result;
      pageState.foundation.salesMessage = result.idempotent
        ? `已找到该文件的历史导入批次，现已展示已有结果，不会重复处理。`
        : `上传解析成功（HTTP ${result.httpStatus}），已进入待确认预览。`;
    }
    catch (error) { pageState.foundation.salesError = error.message || "链接利润表上传解析失败。"; }
    finally { pageState.foundation.salesLoading = false; render(); }
  });
  root.querySelector("[data-confirm-sales-fact-import]")?.addEventListener("click", async (event) => {
    pageState.foundation.loading = true; pageState.error = ""; render();
    try {
      pageState.foundation.salesPreview = await confirmConnectionSalesFactImport(event.currentTarget.dataset.confirmSalesFactImport);
      await Promise.all([loadDataFoundation(render), loadBusinessCockpitPage(render), loadConnectionAssetsPage(render)]);
    }
    catch (error) { pageState.error = error.message; }
    pageState.foundation.loading = false; render();
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
      pageState.foundation.dailyMessage = result.idempotent ? "已展示该文件已有的日报预览，未重复创建批次。" : "销售日报解析与身份匹配预览已生成。";
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
  const reloadComboReviews = async (page = 1) => {
    const batchId = pageState.foundation.dailyPreview?.batch?.id; if (!batchId) return;
    const filters = { ...pageState.comboReviews.filters };
    pageState.comboReviews = { ...pageState.comboReviews, ...await loadComboReviews({ ...filters, status: "pending", page, pageSize: 20 }), filters, loading: false };
  };
  root.querySelector("[data-generate-combo-reviews]")?.addEventListener("click", async () => {
    const batchId = pageState.foundation.dailyPreview?.batch?.id; if (!batchId || pageState.comboReviews.generating) return;
    pageState.comboReviews.generating = true; pageState.foundation.dailyError = ""; render();
    try { await generatePendingComboReviews(batchId); await reloadComboReviews(1); }
    catch (error) { pageState.foundation.dailyError = error.message || "组合关系审核草稿生成失败。"; }
    pageState.comboReviews.generating = false; render();
  });
  root.querySelector("[data-combo-review-filters]")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const values = new FormData(event.currentTarget);
    pageState.comboReviews.filters = { ...pageState.comboReviews.filters, shopId: String(values.get("shopId") || ""), platform: String(values.get("platform") || ""), componentCount: String(values.get("componentCount") || ""), stability: String(values.get("stability") || ""), sourceBatchId: String(values.get("sourceBatchId") || "") };
    pageState.comboReviews.loading = true; render();
    try { await reloadComboReviews(1); } catch (error) { pageState.foundation.dailyError = error.message || "组合关系审核筛选失败。"; pageState.comboReviews.loading = false; render(); }
  });
  root.querySelector("[data-reset-combo-review-filters]")?.addEventListener("click", async () => {
    pageState.comboReviews.filters = { shopId: "", platform: "", componentCount: "", stability: "", sourceBatchId: "" };
    pageState.comboReviews.loading = true; render();
    try { await reloadComboReviews(1); } catch (error) { pageState.foundation.dailyError = error.message || "组合关系审核列表读取失败。"; pageState.comboReviews.loading = false; render(); }
  });
  root.querySelectorAll("[data-combo-review-page]").forEach((button) => button.addEventListener("click", async () => {
    pageState.comboReviews.loading = true; render();
    try { await reloadComboReviews(Number(button.dataset.comboReviewPage || 1)); } catch (error) { pageState.foundation.dailyError = error.message || "组合关系审核分页读取失败。"; pageState.comboReviews.loading = false; render(); }
  }));
  root.querySelectorAll("[data-view-combo-review]").forEach((button) => button.addEventListener("click", async () => {
    pageState.comboReviews.loading = true; render();
    try {
      const groupId = button.dataset.viewComboReview;
      const [selected, anomalies, sourceRows] = await Promise.all([loadComboReviewDetail(groupId), loadComboReviewAnomalyDates(groupId, { page: 1, pageSize: 10 }), loadComboReviewSourceRows(groupId, { page: 1, pageSize: 20 })]);
      pageState.comboReviews = { ...pageState.comboReviews, selected, anomalies, sourceRows, loading: false, editing: false, draft: null, erpSearch: { keyword: "", items: [], loading: false } };
    } catch (error) { pageState.foundation.dailyError = error.message || "组合关系审核证据读取失败。"; pageState.comboReviews.loading = false; }
    render();
  }));
  root.querySelectorAll("[data-combo-anomaly-page]").forEach((button) => button.addEventListener("click", async () => {
    const groupId = pageState.comboReviews.selected?.item?.id; if (!groupId) return;
    try { pageState.comboReviews.anomalies = await loadComboReviewAnomalyDates(groupId, { page: Number(button.dataset.comboAnomalyPage || 1), pageSize: 10 }); }
    catch (error) { pageState.foundation.dailyError = error.message || "组合关系异常日期分页读取失败。"; }
    render();
  }));
  root.querySelectorAll("[data-combo-source-page]").forEach((button) => button.addEventListener("click", async () => {
    const groupId = pageState.comboReviews.selected?.item?.id; if (!groupId) return;
    try { pageState.comboReviews.sourceRows = await loadComboReviewSourceRows(groupId, { page: Number(button.dataset.comboSourcePage || 1), pageSize: 20 }); }
    catch (error) { pageState.foundation.dailyError = error.message || "组合关系来源记录分页读取失败。"; }
    render();
  }));
  root.querySelector("[data-edit-combo-draft]")?.addEventListener("click", () => {
    const selected = pageState.comboReviews.selected;
    pageState.comboReviews.editing = true;
    pageState.comboReviews.draft = { reviewNote: selected?.item?.reviewNote || "", components: (selected?.components || []).map((component) => ({ erpSku: { ...component.erpSku }, erpSkuId: component.erpSku?.id, quantity: component.quantity, status: component.status, sourceType: component.sourceType, decisionNote: "" })) };
    render();
  });
  root.querySelector("[data-cancel-combo-draft]")?.addEventListener("click", () => { pageState.comboReviews.editing = false; pageState.comboReviews.draft = null; pageState.comboReviews.erpSearch = { keyword: "", items: [], loading: false }; render(); });
  root.querySelectorAll("[data-combo-draft-quantity]").forEach((input) => input.addEventListener("input", () => {
    const component = pageState.comboReviews.draft?.components?.[Number(input.dataset.comboDraftQuantity)]; if (component) component.quantity = input.value;
  }));
  root.querySelectorAll("[data-combo-draft-included]").forEach((input) => input.addEventListener("change", () => {
    const component = pageState.comboReviews.draft?.components?.[Number(input.dataset.comboDraftIncluded)]; if (component) component.status = input.checked ? "included" : "excluded";
  }));
  root.querySelector("[data-combo-erp-search]")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const keyword = String(new FormData(event.currentTarget).get("keyword") || "").trim();
    pageState.comboReviews.erpSearch = { keyword, items: [], loading: true }; render();
    try { const result = await searchComboReviewErpSkus(keyword); pageState.comboReviews.erpSearch = { keyword, items: result.items || [], loading: false }; }
    catch (error) { pageState.foundation.dailyError = error.message || "ERP SKU搜索失败。"; pageState.comboReviews.erpSearch.loading = false; }
    render();
  });
  root.querySelectorAll("[data-add-combo-erp-sku]").forEach((button) => button.addEventListener("click", () => {
    const item = (pageState.comboReviews.erpSearch?.items || []).find((entry) => entry.id === button.dataset.addComboErpSku); const components = pageState.comboReviews.draft?.components || [];
    if (!item || components.some((component) => component.erpSkuId === item.id)) return;
    components.push({ erpSku: { ...item }, erpSkuId: item.id, quantity: null, status: "included", sourceType: "manual_added", decisionNote: "" }); render();
  }));
  root.querySelector("[data-save-combo-draft]")?.addEventListener("click", async () => {
    const groupId = pageState.comboReviews.selected?.item?.id; const draft = pageState.comboReviews.draft; if (!groupId || !draft || pageState.comboReviews.saving) return;
    draft.reviewNote = String(root.querySelector("[data-combo-review-note]")?.value || ""); pageState.comboReviews.saving = true; pageState.foundation.dailyError = ""; render();
    try {
      await saveComboReviewDraft(groupId, { reviewNote: draft.reviewNote, components: draft.components.map((component) => ({ erpSkuId: component.erpSkuId, quantity: component.quantity, status: component.status, decisionNote: component.decisionNote })) });
      pageState.comboReviews.selected = await loadComboReviewDetail(groupId); pageState.comboReviews.editing = false; pageState.comboReviews.draft = null; pageState.comboReviews.erpSearch = { keyword: "", items: [], loading: false }; await reloadComboReviews(Number(pageState.comboReviews.pagination?.page || 1));
    } catch (error) { pageState.foundation.dailyError = error.message || "组合关系审核草稿保存失败。"; }
    pageState.comboReviews.saving = false; render();
  });
  root.querySelector("[data-confirm-combo-group]")?.addEventListener("click", async () => {
    const groupId = pageState.comboReviews.selected?.item?.id; if (!groupId || pageState.comboReviews.confirming) return;
    if (!globalThis.confirm("确认后将整组生成正式商品结构关系。此操作不会写入销售日报事实，是否继续？")) return;
    pageState.comboReviews.confirming = true; pageState.foundation.dailyError = ""; render();
    try {
      await confirmComboReviewGroup(groupId, pageState.comboReviews.selected?.item?.reviewNote || "");
      pageState.comboReviews.selected = await loadComboReviewDetail(groupId); await reloadComboReviews(1);
      pageState.foundation.dailyMessage = "商品结构关系已确认，销售日报预览需要重新计算。";
    } catch (error) { pageState.foundation.dailyError = error.message || "组合关系整组确认失败。"; }
    pageState.comboReviews.confirming = false; render();
  });
  root.querySelector("[data-close-combo-review]")?.addEventListener("click", () => { pageState.comboReviews.selected = null; pageState.comboReviews.anomalies = { items: [], pagination: {} }; pageState.comboReviews.sourceRows = { items: [], pagination: {} }; pageState.comboReviews.editing = false; pageState.comboReviews.draft = null; render(); });
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
