import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import * as XLSX from "xlsx";
import { shouldShowTaskInTaskCenter } from "../shared/taskCenterVisibility.js";
import {
  RectificationGenerationEnabled,
  RectificationWorkTemplate,
  WorkType,
} from "../src/data/modelOptions.js";
import { configureApiCachePolicy } from "./apiCachePolicy.js";
import {
  closeDatabase,
  createResource,
  changeProductSku,
  createProductImportBatch,
  commitProductImportBatch,
  databasePath,
  deleteProcessTemplate,
  deleteProcessTemplateNode,
  findLoginUser,
  findLoginUserById,
  getDatabase,
  getPublicUser,
  initializeDatabase,
  readAllData,
  readResource,
  readResourceItems,
  readProductImportBatch,
  previewProductSkuChange,
  readRouteResource,
  readRouteResourceItem,
  replaceActionProducts,
  replaceAllData,
  touchLastLoginAt,
  updateCurrentUserAvatar,
  updateProductImportBatch,
  updateResource,
  uploadsDir,
} from "./modules/database/index.js";
import {
  createProductFromErpSku,
  createProductsFromErpSkus,
  commitErpV2Import,
  createErpSyncRun,
  hasWangdianConfig,
  listErpSyncRuns,
  listWangdianGoodsSyncLogs,
  listErpFactSnapshots,
  listPendingErpSkus,
  listProductFactSnapshots,
  getProductAutoProfileSettings,
  markPlatformSku,
  parseProductWorkbook,
  parseErpV2Import,
  parseWangdianGoodsImport,
  previewErpV2Import,
  productImportFieldDefinitions,
  readErpFactSnapshot,
  readErpV2Import,
  readErpSyncRun,
  readProductImportStaging,
  recalculateErpSyncRun,
  proposePlatformSkuProductRelation,
  validateProductImport,
  validateErpV2Import,
  updateProductAutoProfileSettings,
} from "./modules/products/index.js";
import {
  createManualDataSyncBatch,
  getDataSyncCenterOverview,
  resolveDataSyncException,
  setDataSyncTaskStatus,
} from "./dataSyncCenterService.js";
import {
  queryDataAssetMapOverview,
  queryDataAssetObjects,
  queryDataAssetSources,
  readDataAssetObject,
  readDataAssetRelationGraph,
  readDataAssetSource,
} from "./dataAssetMapService.js";
import {
  commitErpGoodsDataSync,
  previewErpGoodsDataSync,
  readErpGoodsDataSyncPreview,
  runDueErpGoodsSyncTasks,
} from "./erpGoodsDataSyncAdapter.js";
import {
  commitPlatformGoodsDataSync,
  previewPlatformGoodsDataSync,
  readPlatformGoodsDataSyncPreview,
  runDuePlatformGoodsSyncTasks,
} from "./platformGoodsDataSyncAdapter.js";
import { createWangdianShopDiscoveryBatch, queueWangdianShopDiscoveryBatch, readWangdianShopDiscoveryBatch, resumePendingWangdianShopDiscoveryBatches, resumeWangdianShopDiscoveryBatch, saveWangdianShopMapping } from "./wangdianPlatformGoodsSyncService.js";
import { searchWangdianSuites } from "./wangdianSuiteService.js";
import { runDueWangdianSuiteSyncTasks, syncWangdianSuites } from "./wangdianSuiteDataSyncAdapter.js";
import { queryOperatingErpSet, readOperatingErpSetSummary } from "./operatingErpSetService.js";
import { getErpLifecycleSyncPolicy, listNonOperatingInventoryRisk, queryErpOperatingLifecycle, readErpOperatingLifecycleSummary, simulateErpOperatingLifecycleViews } from "./erpOperatingLifecycleService.js";
import { confirmErpSkuUsageProfile, readErpSkuUsageInventoryGovernance, readUnknownErpUsageConvergence } from "./erpSkuUsageProfileService.js";
import { queryOperatingErpIdentityShadow } from "./operatingErpIdentityShadowService.js";
import { listV3ShadowDifferences, readV3ShadowSummary, scheduleV3ShadowObservation } from "./v3ShadowObservationService.js";
import {
  commitInventoryDataSync,
  previewInventoryDataSync,
  readInventoryDataSyncPreview,
  runDueInventorySyncTasks,
} from "./inventoryDataSyncAdapter.js";
import { readCurrentSalesFactDataSyncPreview, readSalesFactDataSyncPreview } from "./salesFactDataSyncAdapter.js";
import { commitSalesDailyFacts, previewSalesDailyFacts, readCurrentSalesDailyFactPreview, readSalesDailyFactPreview, recalculateSalesDailyFactPreview } from "./salesDailyFactPreviewService.js";
import { confirmSalesRelationCandidate, confirmSalesRelationCandidates, querySalesRelationCandidates, readSalesRelationCandidate } from "./salesRelationCandidateService.js";
import { querySalesRelationGovernance } from "./salesRelationGovernanceService.js";
import {
  listProductStructureApplicationBatches,
  queryProductStructureApplicationQueue,
  readProductStructureApplicationPreview,
  reviewProductStructureApplicationItem,
} from "./productStructureApplicationApprovalService.js";
import { confirmErpSkuProductUsages, confirmErpSkuUsageGovernance, queryErpSkuProductUsageCandidates, queryErpSkuUsageGovernance, readErpSkuUsageGovernance } from "./erpSkuUsageGovernanceService.js";
import { getConnectionDailySalesPerformance } from "./connectionDailySalesService.js";
import { getProductDailySalesPerformance } from "./productDailySalesService.js";
import { queryProductSalesLinks, queryProductSalesSummaries, queryUnmatchedPlatformSkus } from "./productLinkV2ReadService.js";
import { querySalesDailyDataQuality } from "./salesDailyDataQualityService.js";
import {
  assertBusinessBaselineHealthy,
  evaluateDatabaseHealth,
  shouldEnforceBusinessBaseline,
} from "./databaseSafety.js";
import { querySalesDataQualityAnomalies, submitSalesDataQualityAnomalyDecision } from "./salesDataQualityAnomalyGovernanceService.js";
import { getSalesBusinessDashboard } from "./salesBusinessDashboardService.js";
import { queryBusinessAnomalies } from "./capabilities/queryBusinessAnomalies.js";
import { queryBusinessImprovementResult } from "./capabilities/queryBusinessImprovementResult.js";
import { commitPlatformGoodsExcelDataSync, previewPlatformGoodsExcelDataSync, readPlatformGoodsExcelDataSyncPreview, reanalyzePlatformGoodsExcelDataSync } from "./platformGoodsExcelDataSyncAdapter.js";
import {
  confirmConnectionBulkPlatformImport,
  createConnectionBulkPlatformImport,
  listConnectionBulkPlatformImports,
  readConnectionBulkPlatformImport,
  resumeConnectionBulkPlatformImports,
} from "./connectionBulkPlatformImportService.js";
import { normalizeUploadedFileName } from "./uploadFileName.js";
import {
  UploadQuotaExceededError,
  beginUploadAttempt,
  finalizeUploadAttempt,
  getUploadDailyQuotaBytes,
  getUserUploadQuota,
  listUploadAudits,
  recordRejectedUploadAttempt,
  validateUploadContent,
  validateUploadMetadata,
} from "./uploadGovernanceService.js";
import {
  getApiUsageLedger,
  recordApiUsage,
  resolveApiUsageRoute,
  resolveApiUsageSource,
  shouldRecordApiUsage,
} from "./apiUsageLedgerService.js";
import {
  beginReleaseManagedJob,
  finishReleaseManagedJob,
  isReleaseMaintenanceModeActive,
  readReleaseMaintenanceStatus,
} from "./releaseMaintenanceService.js";
import {
  pickGoalCenterBootstrapResources,
  readGoalCenterBootstrap,
} from "./goalCenterBootstrapService.js";
import { buildActiveStoreOptions } from "./storeOptionsService.js";
import { readTemplateCenterUsageSummary } from "./templateCenterBootstrapService.js";
import { readScheduleBoardPage, readWorkResultsInitial, selectLinkedVisualTemplates } from "./workManagementPageService.js";
import { markAllUserNotificationsRead, readNotificationSummary } from "./notificationSummaryService.js";
import {
  createConnectionAction,
  createConnectionDataMapping,
  createConnectionProfile,
  createConnectionProfilesBatch,
  deleteConnectionAction,
  deleteConnectionDataMapping,
  listAvailableSalesLinks,
  listConnectionImportShops,
  listConnectionMappingRepairCandidates,
  listConnectionActions,
  listConnectionDataMappings,
  getMyConnectionWorkbench,
  setConnectionFollow,
  assertConnectionVisible,
  readConnectionProfile,
  updateConnectionProfile,
  updateConnectionDataMapping,
  commitConnectionImportBatch,
  confirmConnectionImportRow,
  createConnectionImportBatch,
  ignoreConnectionImportRow,
  listConnectionImportBatches,
  previewConnectionImportBatch,
  createConnectionPeriodSnapshots,
  listConnectionPeriodSnapshots,
  getConnectionGrowthAnalysis,
  getConnectionManagementOverview,
  listConnectionGrowthRankings,
  getLinkSalesRanking,
  getLinkDataStatus,
  listConnectionBenchmarkTargets,
  listConnectionBenchmarkCandidates,
  createConnectionBenchmarkTarget,
  updateConnectionBenchmarkTarget,
  deleteConnectionBenchmarkTarget,
  getConnectionBenchmarkComparison,
} from "./modules/links/index.js";
import {
  createConnectionImportTemplate,
  confirmConnectionDataImport,
  getConnectionImportDefinitions,
  iterateConnectionImportTemplate,
  listConnectionFoundationBatches,
  listConnectionImportErrors,
  listConnectionImportTemplates,
  previewConnectionDataImport,
} from "./connectionDataFoundationService.js";
import { getConnectionCoreDetail, listConnectionCoreProfiles, listConnectionCoreProfilesPage } from "./connectionCorePageService.js";
import { readConnectionGoalFoundation, setConnectionBusinessPositioning } from "./connectionGoalFoundationService.js";
import { confirmConnectionGoalPlan, createConnectionGoalSuggestion, readConnectionGoalPlans } from "./connectionGoalPlanService.js";
import { evaluateConnectionGoal, readConnectionGoalEvaluation } from "./connectionGoalEvaluationService.js";
import {
  batchConfirmConnectionGoals,
  batchGenerateConnectionGoalSuggestions,
  batchSetConnectionPositioning,
  readConnectionGoalWorkbench,
} from "./connectionGoalWorkbenchService.js";
import { readConnectionGoalCockpitSummary } from "./connectionGoalCockpitService.js";
import {
  addConnectionGoalPilotLinks,
  confirmConnectionGoalPilotPositioning,
  confirmConnectionGoalPilotTarget,
  createConnectionGoalPilotBatch,
  createConnectionGoalPilotSuggestion,
  readConnectionGoalPilotBatches,
  readConnectionGoalPilotCandidates,
  readConnectionGoalPilotMembers,
  updateConnectionGoalPilotBatch,
  updateConnectionGoalPilotMember,
} from "./connectionGoalPilotService.js";
import { queryLinkDataTable } from "./linkDataTableService.js";
import { queryLinkBusinessTable } from "./linkBusinessTableService.js";
import { getLinkSalesDistribution } from "./linkSalesDistributionService.js";
import { cancelConnectionOwnerImport, confirmConnectionOwnerImport, getCurrentConnectionOwnerImport, listConnectionOwnerImportRows, previewConnectionOwnerImport, rebuildConnectionOwnerImportPreview } from "./connectionOwnerImportService.js";
import { getConnectionBusinessCockpit } from "./connectionBusinessCockpitService.js";
import {
  batchLinkProcessInstanceTemplates,
  batchUpdateTaskStatus,
  cancelTaskWave,
  cancelProcessInstance,
  generateEligibleTaskWaves,
  batchLaunchWorkPlans,
  launchWorkPlanWithProcess,
  moveTaskTemplateToValueChain,
  readTaskWaveDetailForTaskIds,
  readTaskWaveRegenerationPreview,
  readTaskWavesForTaskIds,
  regenerateWaitingTaskWaves,
  saveTaskWaveDraft,
  startTaskWave,
  submitTaskWave,
  startProcessInstanceExecution,
  updateProcessTemplateNodeStatus,
} from "./modules/tasks/index.js";
import { updateTaskFromWorkflow } from "./taskProcessReadinessService.js";
import {
  createToken,
  verifyPassword,
  verifyToken,
  canAccessModule,
  canAccessTemplateCenter,
  canLaunchActionTemplate,
  getDataScope,
  hasPermission,
  authorizePersonWrite,
  getTaskWorkflowPermission,
  validatePermissionDependencies,
} from "./modules/auth/index.js";
import { normalizeProductSkuCode, splitProductSkuCodes } from "./modules/common/index.js";
import { getOperationDashboard } from "./operationManagementService.js";
import {
  approveFinanceEntry,
  commitFinanceImportBatch,
  createFinanceImportBatch,
  getFinanceAnalysis,
  getFinanceStatement,
  listFinanceEntries,
  listFinanceImportBatches,
  listFinanceRules,
  readFinanceImportBatch,
  removeFinanceRule,
  saveFinanceRule,
} from "./financeService.js";
import {
  changeProductLifecycle,
  createProductHealthAction,
  createProductImprovementAction,
  evaluateProductHealth,
  getProductImprovementCenter,
  getProductV2Detail,
  getProductV2Overview,
  productLifecycleStatuses,
  recordProductImprovementResult,
} from "./productManagementV2Service.js";
import { getProductBusinessReadModel, getProductHealthAnalysis } from "./productBusinessReadModel.js";
import { getProductSalesDistribution } from "./productSalesDistributionService.js";
import { getProductShopSandbox } from "./productShopSandboxService.js";
import { getProductClearancePlanCenter, saveProductClearancePlan, updateProductClearancePlan } from "./productClearancePlanService.js";
import { getProductNewDevelopmentCenter } from "./productNewDevelopmentService.js";
import { attachProductDiagnosisSummaries, getProductBusinessDiagnosis } from "./productBusinessDiagnosisService.js";
import { getProductInsightCenter, importProductInsights, updateProductInsight } from "./productInsightService.js";
import {
  addProductStrategyStep,
  createProductStrategyAction,
  getProductStrategy,
  saveProductStrategySection,
  updateProductStrategyStep,
} from "./productStrategyService.js";
import {
  createProductProfileForErpSku,
  getProductCenterV2Metadata,
  getProductCenterV2SkuDetail,
  listActionProductOptions,
  listProductCenterV2Skus,
  resolveActionProductOptions,
} from "./productCenterV2Service.js";
import { getSalesObjectComboSkuDetail, listSalesObjectComboSkus } from "./salesObjectComboSkuReadService.js";
import { exportProductMarketingAsset, getProductMarketingAsset, saveProductMarketingAsset } from "./productMarketingAssetService.js";
import { getProductBusinessMigrationReport, getProductBusinessProfile, resolveProductBusinessIdentity, upsertProductBusinessProfile } from "./productBusinessProfileService.js";
import {
  bootstrapTemplateVersions,
  changeTemplateVersionStatus,
  ensureInitialTemplateVersion,
  iterateTemplate,
  listTemplateVersions,
  versionedTemplateResources,
} from "./templateVersionService.js";

const app = express();
configureApiCachePolicy(app);
const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3001);
const applicationVersion = (() => {
  try {
    return JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version ?? "unknown";
  } catch {
    return "unknown";
  }
})();
const imageUploadsDir = path.join(uploadsDir, "images");
const fileUploadsDir = path.join(uploadsDir, "files");
const standardWorkAttachmentsDir = path.join(uploadsDir, "standard-work-attachments");
const productImportUploadsDir = path.join(uploadsDir, "product-import-uploads");
const uploadStagingDir = path.join(path.dirname(databasePath), ".upload-staging");
const uploadContentNoteWorkbook = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (![".xlsx", ".xls", ".csv", ".tsv"].includes(ext)) {
      callback(new Error("只支持 .xlsx、.xls、.csv 或 .tsv 文件。"));
      return;
    }
    callback(null, true);
  },
});
const uploadConnectionWorkbook = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024, files: 20 },
  fileFilter: (_request, file, callback) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (![".xlsx", ".xls"].includes(ext)) {
      callback(new Error("生意参谋导入只支持 .xlsx 或 .xls 文件。"));
      return;
    }
    callback(null, true);
  },
});
const uploadFinanceWorkbook = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (![".xlsx", ".xls", ".csv"].includes(ext)) {
      callback(new Error("财务账单只支持 .xlsx、.xls 或 .csv 文件。"));
      return;
    }
    callback(null, true);
  },
});

if (shouldEnforceBusinessBaseline()) {
  assertBusinessBaselineHealthy(evaluateDatabaseHealth(getDatabase()));
}
initializeDatabase();
const startupDatabaseHealth = evaluateDatabaseHealth(getDatabase());
assertBusinessBaselineHealthy(startupDatabaseHealth);
bootstrapTemplateVersions();
fs.mkdirSync(imageUploadsDir, { recursive: true });
fs.mkdirSync(fileUploadsDir, { recursive: true });
fs.mkdirSync(standardWorkAttachmentsDir, { recursive: true });
fs.mkdirSync(productImportUploadsDir, { recursive: true });
fs.mkdirSync(uploadStagingDir, { recursive: true });

const imageStorage = multer.diskStorage({
  destination: (_request, _file, callback) => {
    callback(null, uploadStagingDir);
  },
  filename: (_request, file, callback) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = [".jpg", ".jpeg", ".png", ".webp"].includes(ext) ? ext : "";
    callback(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safeExt}`);
  },
});
const uploadImage = multer({
  storage: imageStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    const validation = validateUploadMetadata(file, "image");
    if (!validation.valid) {
      callback(new Error(`${validation.reason}只支持 JPG、PNG、WebP 图片。`));
      return;
    }
    callback(null, true);
  },
});

const fileStorage = multer.diskStorage({
  destination: (_request, _file, callback) => {
    callback(null, uploadStagingDir);
  },
  filename: (_request, file, callback) => {
    const ext = path.extname(file.originalname).toLowerCase();
    callback(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`);
  },
});
const uploadFile = multer({
  storage: fileStorage,
  limits: { fileSize: 600 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    const validation = validateUploadMetadata(file, "file");
    if (!validation.valid) {
      callback(new Error(`${validation.reason}只支持图片、PSD、PSB、AI、FIG、PDF、Word、Excel、ZIP、视频和文本文件。`));
      return;
    }
    callback(null, true);
  },
});

const allowedStandardWorkAttachmentExts = new Set([".xlsx", ".xls", ".csv", ".xmind"]);
const spreadsheetStorage = multer.diskStorage({
  destination: (_request, _file, callback) => {
    callback(null, uploadStagingDir);
  },
  filename: (_request, file, callback) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = allowedStandardWorkAttachmentExts.has(ext) ? ext : "";
    callback(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safeExt}`);
  },
});
const uploadSpreadsheet = multer({
  storage: spreadsheetStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    const validation = validateUploadMetadata(file, "spreadsheet");
    if (!validation.valid) {
      callback(new Error(`${validation.reason}只支持 .xlsx、.xls、.csv、.xmind 附件。`));
      return;
    }
    callback(null, true);
  },
});

const productImportStorage = multer.diskStorage({
  destination: (_request, _file, callback) => callback(null, productImportUploadsDir),
  filename: (_request, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    callback(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${extension}`);
  },
});
const uploadProductImport = multer({
  storage: productImportStorage,
  limits: { fileSize: 300 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (!new Set([".xls", ".xlsx"]).has(extension)) {
      callback(new Error("ERP 产品导入仅支持 .xls、.xlsx 文件。"));
      return;
    }
    callback(null, true);
  },
});

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use("/uploads", express.static(uploadsDir));

app.use("/api", (request, response, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    next();
    return;
  }
  const maintenanceToken = beginReleaseManagedJob(`api:${request.method}:${request.path}`);
  if (!maintenanceToken) {
    response.status(503).json({ success: false, code: "release_maintenance", message: "系统正在执行受控发布维护，请稍后重试。" });
    return;
  }
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    finishReleaseManagedJob(maintenanceToken);
  };
  response.once("finish", finish);
  response.once("close", finish);
  next();
});

app.use("/api", (request, response, next) => {
  if (!shouldRecordApiUsage(request)) {
    next();
    return;
  }
  const source = resolveApiUsageSource(request);
  let finalized = false;
  const finalize = (statusCode) => {
    if (finalized) return;
    finalized = true;
    try {
      recordApiUsage(getDatabase(), {
        method: request.method,
        routePattern: resolveApiUsageRoute(request),
        source,
        statusCode,
      });
    } catch (error) {
      console.error("API 使用台账记录失败", error);
    }
  };
  response.once("finish", () => finalize(response.statusCode));
  response.once("close", () => finalize(response.writableFinished ? response.statusCode : 499));
  next();
});

app.get("/api/health", (_request, response) => {
  const statusCode = startupDatabaseHealth.status === "ok" ? 200 : 503;
  response.status(statusCode).json({
    status: startupDatabaseHealth.status,
    database: startupDatabaseHealth.technicalHealth.status === "ok" ? "technically_ok" : "error",
    technicalHealth: startupDatabaseHealth.technicalHealth,
    businessDataHealth: startupDatabaseHealth.businessDataHealth,
    version: applicationVersion,
  });
});

app.get("/api/release-maintenance/status", (_request, response) => {
  response.json({ success: true, ...readReleaseMaintenanceStatus() });
});

function getBearerToken(request) {
  const authorization = request.headers.authorization ?? "";
  if (!authorization.startsWith("Bearer ")) return "";
  return authorization.slice("Bearer ".length).trim();
}

function requireAuth(request, response, next) {
  const tokenPayload = verifyToken(getBearerToken(request));
  if (tokenPayload === null) {
    response.status(401).json({ success: false, message: "请先登录" });
    return;
  }

  const user = findLoginUserById(tokenPayload.sub);
  if (user === undefined || !user.canLogin || user.status !== "active") {
    response.status(401).json({ success: false, message: "登录状态已失效" });
    return;
  }

  request.user = getPublicUser(user);
  next();
}

function requirePermission(permissionPath) {
  return (request, response, next) => {
    if (!hasPermission(request.user, permissionPath)) {
      response.status(403).json({ success: false, message: "你没有权限进行该操作" });
      return;
    }
    next();
  };
}

function requireAnyPermission(...permissionPaths) {
  return (request, response, next) => {
    if (!permissionPaths.some((permissionPath) => hasPermission(request.user, permissionPath))) {
      response.status(403).json({ success: false, message: "你没有权限进行该操作" });
      return;
    }
    next();
  };
}

const requireLinkView = requirePermission("links.view");
const requireLinkManage = requirePermission("links.manage");
const requireLinkImport = requirePermission("links.import");
const requireLinkRating = requirePermission("links.rating");
const requireLinkDiagnosis = requirePermission("links.diagnosis");
const requireLinkImprove = requirePermission("links.improve");
const requireLinkRelations = requirePermission("links.manageRelations");

function getRequestedActionTemplateIds(body = {}) {
  return [
    body?.processInstance?.taskTemplateId ?? body?.processInstance?.standardWorkId,
    body?.workPlan?.taskTemplateId,
    body?.taskTemplateId ?? body?.standardWorkId,
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

function rejectUnauthorizedActionTemplateLaunch(user, body, response, trustedTemplateId = "") {
  const trustedId = String(trustedTemplateId ?? "").trim();
  const requestedIds = [...new Set(getRequestedActionTemplateIds(body))];
  const templateIds = trustedId === "" ? requestedIds : [...new Set([trustedId, ...requestedIds])];
  if (
    templateIds.length === 1 &&
    canLaunchActionTemplate(user, templateIds[0])
  ) return false;
  response.status(403).json({ success: false, message: "你没有权限发起该关键行动" });
  return true;
}

function rejectPausedRectificationLaunch(resource, body, response, trustedTemplateId = "") {
  if (RectificationGenerationEnabled) return false;
  if (!new Set(["work-plans", "process-instances"]).has(resource)) return false;
  const requestedTemplateIds = new Set([
    String(trustedTemplateId ?? "").trim(),
    ...getRequestedActionTemplateIds(body),
  ]);
  const isRectification =
    body?.workType === WorkType.Rectification ||
    body?.workPlan?.workType === WorkType.Rectification ||
    requestedTemplateIds.has(RectificationWorkTemplate.TaskTemplateId);
  if (!isRectification) return false;
  response.status(409).json({
    success: false,
    message: "改善行动生成已暂停，待行动标准确认后再开启。",
  });
  return true;
}

function isAdminUser(user) {
  return user?.role === "admin" || user?.role === "system_admin" || user?.authRole === "admin";
}

function requireAdminUser(request, response, next) {
  if (isAdminUser(request.user)) { next(); return; }
  response.status(403).json({ success: false, message: "仅管理员可以执行旺店通货品同步。" });
}

function requireAdminForWangdianBatch(request, response, next) {
  try {
    const result = readErpV2Import(request.params.id);
    if (result?.batch?.dataSource === "wangdian_api" && !isAdminUser(request.user)) {
      response.status(403).json({ success: false, message: "仅管理员可以访问旺店通同步批次。" });
      return;
    }
    next();
  } catch {
    next();
  }
}

function getUserPersonId(user) {
  return user?.personId ?? user?.id ?? "";
}

function requireVisibleConnection(resolveConnectionId = (request) => request.params.id) {
  return (request, response, next) => {
    try {
      assertConnectionVisible(resolveConnectionId(request), getUserPersonId(request.user), isAdminUser(request.user));
      next();
    } catch (error) {
      response.status(error.statusCode || 404).json({ success: false, message: error.message || "连接档案不存在。" });
    }
  };
}

const requireConnectionAccess = requireVisibleConnection();
const requireBodyConnectionAccess = requireVisibleConnection((request) => request.body?.connectionId);
const requireOptionalBenchmarkConnectionAccess = (request, response, next) => {
  if (request.body?.targetType !== "internal" || !request.body?.internalConnectionId) { next(); return; }
  return requireVisibleConnection((currentRequest) => currentRequest.body.internalConnectionId)(request, response, next);
};
const requireBenchmarkComparisonAccess = (request, response, next) => {
  const target = getDatabase().prepare(`
    SELECT targetType,internalConnectionId FROM connection_benchmark_targets
    WHERE id=? AND connectionId=?
  `).get(request.params.targetId, request.params.id);
  if (!target) { response.status(404).json({ success: false, message: "未找到对标链接。" }); return; }
  if (target.targetType !== "internal" || !target.internalConnectionId) { next(); return; }
  return requireVisibleConnection(() => target.internalConnectionId)(request, response, next);
};

function canEditProcessInstance(user, instance) {
  if (instance === undefined || instance === null) return false;
  if (isAdminUser(user)) return true;
  const userPersonId = getUserPersonId(user);
  return userPersonId !== "" && instance.initiatorId === userPersonId;
}

function belongsToUser(item, user) {
  return [
    item.ownerId,
    item.assigneeId,
    item.executorId,
    item.accepterId,
    item.reviewerId,
    item.creatorId,
    item.personId,
    item.initiatorId,
    item.submittedBy,
    item.submitterId,
  ]
    .filter(Boolean)
    .includes(user.id);
}

function belongsToDepartment(item, user) {
  return item.departmentId !== undefined && item.departmentId !== null && item.departmentId !== "" && item.departmentId === user.departmentId;
}

function filterByScope(items, user) {
  const dataScope = getDataScope(user);
  if (dataScope === "all") return items;
  if (dataScope === "department") return items.filter((item) => belongsToDepartment(item, user) || belongsToUser(item, user));
  return items.filter((item) => belongsToUser(item, user));
}

function readTaskAuthorizationResolver(taskIds = []) {
  const ids = [...new Set(taskIds.map((id) => String(id ?? "").trim()).filter(Boolean))];
  const emptyResolver = { get: () => null, tasks: [] };
  if (ids.length === 0) return emptyResolver;

  const database = getDatabase();
  const taskPlaceholders = ids.map(() => "?").join(", ");
  const tasks = database.prepare(`SELECT * FROM tasks WHERE id IN (${taskPlaceholders})`).all(...ids);
  if (tasks.length === 0) return emptyResolver;

  const processInstanceIds = [...new Set(tasks.map((task) => task.processInstanceId).filter(Boolean))];
  const processNodeIds = [...new Set(tasks.map((task) => task.processNodeId).filter(Boolean))];
  const instances =
    processInstanceIds.length === 0
      ? []
      : database
          .prepare(`SELECT * FROM process_instances WHERE id IN (${processInstanceIds.map(() => "?").join(", ")})`)
          .all(...processInstanceIds);
  const instanceMap = new Map(instances.map((instance) => [instance.id, instance]));
  const nodes =
    processNodeIds.length === 0
      ? []
      : database
          .prepare(`SELECT * FROM process_template_nodes WHERE id IN (${processNodeIds.map(() => "?").join(", ")})`)
          .all(...processNodeIds);
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const actionStandardIds = [
    ...new Set(
      tasks
        .map((task) => task.taskTemplateId || instanceMap.get(task.processInstanceId)?.taskTemplateId)
        .filter(Boolean),
    ),
  ];
  const actionStandards =
    actionStandardIds.length === 0
      ? []
      : database
          .prepare(`SELECT id, ownerId FROM task_templates WHERE id IN (${actionStandardIds.map(() => "?").join(", ")})`)
          .all(...actionStandardIds);
  const actionStandardMap = new Map(actionStandards.map((standard) => [standard.id, standard]));
  const relatedProcessTasks =
    processInstanceIds.length === 0
      ? []
      : database
          .prepare(
            `SELECT id, processInstanceId, taskType, reviewTargetTaskId, executorId, accepterId, reviewerId, ownerId, status
             FROM tasks
             WHERE processInstanceId IN (${processInstanceIds.map(() => "?").join(", ")})`,
          )
          .all(...processInstanceIds);
  const processTasksByProcessId = new Map();
  const reviewTasksByProcessId = new Map();
  const reviewTasksByTargetId = new Map();
  for (const processTask of relatedProcessTasks) {
    const processTasks = processTasksByProcessId.get(processTask.processInstanceId) ?? [];
    processTasks.push(processTask);
    processTasksByProcessId.set(processTask.processInstanceId, processTasks);
    if (processTask.taskType !== "review") continue;
    const reviewTask = processTask;
    const processReviewTasks = reviewTasksByProcessId.get(reviewTask.processInstanceId) ?? [];
    processReviewTasks.push(reviewTask);
    reviewTasksByProcessId.set(reviewTask.processInstanceId, processReviewTasks);
    if (reviewTask.reviewTargetTaskId) {
      const targetTasks = reviewTasksByTargetId.get(reviewTask.reviewTargetTaskId) ?? [];
      targetTasks.push(reviewTask);
      reviewTasksByTargetId.set(reviewTask.reviewTargetTaskId, targetTasks);
    }
  }

  const contextMap = new Map(
    tasks.map((task) => {
      const instance = instanceMap.get(task.processInstanceId) ?? null;
      const node = nodeMap.get(task.processNodeId) ?? null;
      const actionStandardId = task.taskTemplateId || instance?.taskTemplateId;
      return [
        task.id,
        {
          task,
          instance,
          node,
          actionStandard: actionStandardMap.get(actionStandardId) ?? null,
          processTasks: processTasksByProcessId.get(task.processInstanceId) ?? [],
          processReviewTasks: reviewTasksByProcessId.get(task.processInstanceId) ?? [],
          targetReviewTasks: reviewTasksByTargetId.get(task.id) ?? [],
        },
      ];
    }),
  );
  return { get: (taskId) => contextMap.get(taskId) ?? null, tasks };
}

function getTaskActorId(user) {
  return String(getUserPersonId(user) ?? "").trim();
}

function taskAssignmentMatches(task, userId) {
  if (userId === "") return false;
  return [task?.executorId, task?.accepterId, task?.reviewerId].filter(Boolean).includes(userId);
}

function isTaskManager(user, context) {
  if (isAdminUser(user)) return true;
  const userId = getTaskActorId(user);
  if (userId === "") return false;
  return [
    context.task?.ownerId,
    context.node?.ownerId,
    context.actionStandard?.ownerId,
  ]
    .filter(Boolean)
    .includes(userId);
}

function isTaskReviewer(user, context, allowProcessReview = false, includeHistoricalTarget = false) {
  if (isAdminUser(user)) return true;
  const userId = getTaskActorId(user);
  if (userId === "") return false;
  if (context.task?.taskType === "review" && taskAssignmentMatches(context.task, userId)) return true;
  if (context.task?.accepterId === userId || context.task?.reviewerId === userId) return true;
  if (
    context.targetReviewTasks.some(
      (task) =>
        (includeHistoricalTarget || !["done", "canceled"].includes(task.status)) &&
        taskAssignmentMatches(task, userId),
    )
  ) return true;
  return (
    allowProcessReview &&
    context.processReviewTasks.some(
      (task) =>
        !["done", "canceled"].includes(task.status) &&
        taskAssignmentMatches(task, userId),
    )
  );
}

function canViewTask(user, context) {
  if (context === null) return false;
  if (isAdminUser(user)) return true;
  const userId = getTaskActorId(user);
  if (
    [
      context.task?.executorId,
      context.task?.accepterId,
      context.task?.reviewerId,
      context.task?.ownerId,
      context.task?.initiatorId,
    ]
      .filter(Boolean)
      .includes(userId)
  ) return true;
  if (isTaskManager(user, context) || isTaskReviewer(user, context, false, true)) return true;
  const dataScope = getDataScope(user);
  if (dataScope === "all") return true;
  return (
    dataScope === "department" &&
    String(context.task?.departmentId ?? "") !== "" &&
    context.task.departmentId === user.departmentId
  );
}

function filterTasksByScope(tasks, user, data = {}) {
  if (isAdminUser(user) || getDataScope(user) === "all") return tasks;
  const baseVisibleTaskIds = new Set(filterByScope(tasks, user).map((task) => task.id));
  const userId = getTaskActorId(user);
  const instanceMap = new Map((data.processInstances ?? []).map((instance) => [instance.id, instance]));
  const nodeMap = new Map((data.processTemplateNodes ?? []).map((node) => [node.id, node]));
  const actionStandardMap = new Map((data.taskTemplates ?? []).map((standard) => [standard.id, standard]));
  const reviewTargetTaskIds = new Set(
    tasks
      .filter(
        (task) =>
          task.taskType === "review" &&
          task.reviewTargetTaskId &&
          taskAssignmentMatches(task, userId),
      )
      .map((task) => task.reviewTargetTaskId),
  );
  return tasks.filter((task) => {
    if (baseVisibleTaskIds.has(task.id) || reviewTargetTaskIds.has(task.id)) return true;
    const instance = instanceMap.get(task.processInstanceId);
    const actionStandardId = task.taskTemplateId || instance?.taskTemplateId;
    return [
      nodeMap.get(task.processNodeId)?.ownerId,
      actionStandardMap.get(actionStandardId)?.ownerId,
    ]
      .filter(Boolean)
      .includes(userId);
  });
}

function canOperateTask(user, context, action) {
  if (context === null) return false;
  if (isAdminUser(user)) return true;
  const userId = getTaskActorId(user);
  const isExecutor = userId !== "" && context.task?.executorId === userId;
  if (action === "start") return isExecutor && context.task.status === "todo";
  if (action === "submit") return isExecutor && context.task.status === "doing";
  if (["approve", "reject"].includes(action)) {
    return context.task.status === "pending_acceptance" && isTaskReviewer(user, context);
  }
  if (["review_approve", "review_reject"].includes(action)) {
    return (
      context.task.taskType === "review" &&
      ["todo", "doing"].includes(context.task.status) &&
      isTaskReviewer(user, context)
    );
  }
  if (action === "return") return isTaskManager(user, context) || isTaskReviewer(user, context, true);
  if (action === "activate") {
    return (
      context.task.status === "waiting" &&
      (isTaskManager(user, context) ||
        context.processTasks.some((task) => task.executorId === userId))
    );
  }
  if (action === "edit") {
    return (
      !["done", "canceled"].includes(context.task.status) &&
      isTaskManager(user, context)
    );
  }
  if (["cancel", "restore", "batch_cancel"].includes(action)) {
    return isTaskManager(user, context);
  }
  if (action === "batch_done") return isExecutor || isTaskManager(user, context);
  return false;
}

function rejectUnauthorizedTask(response, message = "你没有权限操作该任务") {
  response.status(403).json({ success: false, message });
}

function canUseStoreOptions(user) {
  return (
    hasPermission(user, "systemSettings.manage") ||
    hasPermission(user, "keyActions.launch") ||
    hasPermission(user, "tasks.execute") ||
    hasPermission(user, "actionStandards.manage")
  );
}

function canUsePublishingAccountOptions(user) {
  return (
    hasPermission(user, "actionStandards.manage") ||
    hasPermission(user, "keyActions.launch") ||
    hasPermission(user, "keyActions.launch") ||
    hasPermission(user, "tasks.execute") ||
    hasPermission(user, "contentNotes.view") ||
    hasPermission(user, "contentNotes.manage") ||
    hasPermission(user, "contentNotes.manage")
  );
}

function hasAnyPermission(user, permissions) {
  return permissions.some((permission) => hasPermission(user, permission));
}

function canUseActionStandardOptions(user) {
  return hasAnyPermission(user, [
    "actionStandards.view",
    "actionStandards.manage",
    "actionStandards.view",
    "keyActions.launch",
    "keyActions.launch",
  ]);
}

function canUseTemplateOptions(user) {
  return (
    canAccessTemplateCenter(user) ||
    hasAnyPermission(user, [
      "tasks.view",
      "keyActions.view",
      "keyActions.launch",
      "contentNotes.view",
    ])
  );
}

function permissionRule(permission) {
  return ({ user }) => hasPermission(user, permission);
}

function anyPermissionRule(...permissions) {
  return ({ user }) => hasAnyPermission(user, permissions);
}

function rejectInvalidPermissionConfiguration(resource, body, response) {
  if (!["persons", "people", "permission-templates"].includes(resource)) return false;
  const permissions = body?.permissions;
  if (permissions === undefined) return false;
  const errors = validatePermissionDependencies(permissions, body?.authRole ?? "user");
  if (errors.length === 0) return false;
  response.status(400).json({
    success: false,
    message: "权限配置缺少必要的查看权限。",
    dependencyErrors: errors,
  });
  return true;
}

const resourcePermissions = {
  companies: {
    read: permissionRule("organization.view"),
    write: permissionRule("organization.manage"),
  },
  departments: {
    read: permissionRule("organization.view"),
    write: permissionRule("organization.manage"),
  },
  positions: {
    read: permissionRule("organization.view"),
    write: permissionRule("organization.manage"),
  },
  persons: {
    read: anyPermissionRule("people.view", "permissions.manage"),
    write: ({ user, body }) => authorizePersonWrite(user, body),
    scope: "people",
  },
  people: {
    read: anyPermissionRule("people.view", "permissions.manage"),
    write: ({ user, body }) => authorizePersonWrite(user, body),
    scope: "people",
  },
  "permission-templates": {
    read: permissionRule("permissions.manage"),
    write: permissionRule("permissions.manage"),
  },
  categories: {
    read: permissionRule("systemSettings.manage"),
    write: permissionRule("systemSettings.manage"),
  },
  stores: {
    read: ({ user }) => canUseStoreOptions(user),
    write: permissionRule("systemSettings.manage"),
  },
  "publishing-accounts": {
    read: ({ user }) => canUsePublishingAccountOptions(user),
    write: permissionRule("actionStandards.manage"),
  },
  "weekly-reports": {
    read: permissionRule("workResults.view"),
    write: ({ user, method }) => hasPermission(user, method === "POST" ? "workResults.submit" : "workResults.manage"),
    scope: "dataScope",
  },
  "weekly-report-problems": {
    read: permissionRule("workResults.view"),
    write: permissionRule("workResults.manage"),
    scope: "dataScope",
  },
  goals: {
    read: permissionRule("goals.view"),
    write: ({ user, body, existing }) => {
      const nextStatus = body?.status;
      const statusChanged = existing !== null && nextStatus !== undefined && nextStatus !== existing?.status;
      return hasPermission(user, statusChanged ? "goals.close" : "goals.manage");
    },
    scope: "dataScope",
  },
  "task-templates": {
    read: ({ user }) => canUseActionStandardOptions(user),
    write: ({ user, body, existing }) => {
      const lifecycleWrite = body?.status !== undefined && (existing === null
        ? body.status === "active"
        : body.status !== existing?.status);
      return hasPermission(user, lifecycleWrite ? "actionStandards.publish" : "actionStandards.manage");
    },
  },
  tasks: {
    read: permissionRule("tasks.view"),
    write: ({ user, method, body }) => {
      if (method === "POST" && body.source === "process") return hasPermission(user, "keyActions.launch");
      if (
        body.submitFormData !== undefined ||
        body.submitFiles !== undefined ||
        body.submitLinks !== undefined
      ) {
        return hasPermission(user, "tasks.execute");
      }
      if (body.status === "canceled") return hasPermission(user, "tasks.cancel");
      return hasPermission(user, "tasks.manage");
    },
    scope: "dataScope",
  },
  "process-templates": {
    read: permissionRule("actionStandards.view"),
    write: ({ user, body, existing }) => {
      const lifecycleWrite = body?.status !== undefined && (existing === null
        ? body.status === "active"
        : body.status !== existing?.status);
      return hasPermission(user, lifecycleWrite ? "actionStandards.publish" : "actionStandards.manage");
    },
  },
  "process-template-nodes": {
    read: permissionRule("actionStandards.view"),
    write: permissionRule("actionStandards.manage"),
  },
  "process-instances": {
    read: permissionRule("keyActions.view"),
    write: ({ user, method }) =>
      hasPermission(user, method === "POST" ? "keyActions.launch" : "keyActions.manage"),
    scope: "dataScope",
  },
  methodologies: {
    read: permissionRule("actionStandards.view"),
    write: permissionRule("actionStandards.manage"),
  },
  templates: {
    read: permissionRule("templates.view"),
    write: permissionRule("templates.manage"),
  },
  "template-tag-categories": {
    read: anyPermissionRule("actionStandards.view", "actionStandards.manage"),
    write: permissionRule("actionStandards.manage"),
  },
  "template-tags": {
    read: anyPermissionRule("actionStandards.view", "actionStandards.manage"),
    write: permissionRule("actionStandards.manage"),
  },
  "standard-work-forms": {
    read: ({ user }) => canUseActionStandardOptions(user),
    write: permissionRule("actionStandards.manage"),
  },
  notifications: {
    read: () => true,
    write: ({ user, method, body, existing }) => {
      const userId = String(user.id ?? "");
      if (method === "POST") return String(body.userId ?? "") === userId;
      return (
        String(existing?.userId ?? "") === userId &&
        String(body.userId ?? existing?.userId ?? "") === userId
      );
    },
    scope: "notifications",
  },
  "issues-requirements": {
    read: permissionRule("actionStandards.manage"),
    write: permissionRule("actionStandards.manage"),
    scope: "dataScope",
  },
  "content-schedules": {
    read: permissionRule("contentNotes.view"),
    write: permissionRule("contentNotes.manage"),
    scope: "dataScope",
  },
  "work-plans": {
    read: anyPermissionRule("keyActions.view", "keyActions.launch"),
    write: permissionRule("keyActions.launch"),
    scope: "dataScope",
  },
  products: {
    read: permissionRule("products.view"),
    write: ({ user, body, existing }) => {
      const statusChanged = existing !== null && body?.status !== undefined && body.status !== existing?.status;
      return hasPermission(user, statusChanged ? "products.archive" : "products.manage");
    },
  },
};

function getResourceAuthorizationContext(resource, method, user, body = {}, existing = null) {
  return { resource, method, user, body, existing };
}

function authorizeResourceAction(resource, action, context) {
  const registration = resourcePermissions[resource];
  if (registration === undefined || typeof registration[action] !== "function") return false;
  return registration[action](context) === true;
}

function applyResourceReadScope(resource, items, user) {
  const scope = resourcePermissions[resource]?.scope;
  if (scope === "dataScope") {
    if (resource === "tasks") {
      const data = readAllData();
      return filterTasksByScope(items, user, data);
    }
    return filterByScope(items, user);
  }
  if (scope === "people") {
    const dataScope = getDataScope(user);
    if (dataScope === "all") return items;
    if (dataScope === "department") {
      return items.filter((person) => person.id === user.id || person.departmentId === user.departmentId);
    }
    return items.filter((person) => person.id === user.id);
  }
  if (scope === "notifications") return items.filter((item) => item.userId === user.id);
  return items;
}

function readExistingRouteResourceItem(resource, id) {
  const items = readRouteResource(resource);
  return items.find((item) => item.id === id) ?? null;
}

function filterDataByScope(data, user) {
  const dataScope = getDataScope(user);
  const stores = canUseStoreOptions(user) ? (data.stores ?? []) : [];
  const publishingAccounts = canUsePublishingAccountOptions(user) ? (data.publishingAccounts ?? []) : [];
  const permissionTemplates = hasPermission(user, "permissions.manage") ? (data.permissionTemplates ?? []) : [];
  const products = hasPermission(user, "products.view") ? (data.products ?? []) : [];
  const productImportBatches = hasPermission(user, "products.view") ? (data.productImportBatches ?? []) : [];
  const productV2Data = hasPermission(user, "products.view")
    ? {
        erpGoods: data.erpGoods ?? [],
        productErpMappings: data.productErpMappings ?? [],
        salesShops: data.salesShops ?? [],
        salesShopAliases: data.salesShopAliases ?? [],
        salesLinks: [],
        salesLinkSkus: [],
        erpImportBatches: data.erpImportBatches ?? [],
      }
    : {
        erpGoods: [],
        productErpMappings: [],
        salesShops: [],
        salesShopAliases: [],
        salesLinks: [],
        salesLinkSkus: [],
        erpImportBatches: [],
      };
  const productsWereLoaded = Object.hasOwn(data, "products");
  const visibleProductIds = new Set(products.map((product) => product.id));
  if (dataScope === "all") {
    const actionProducts = productsWereLoaded
      ? (data.actionProducts ?? []).filter((item) => item.erpSkuId || !item.productId || visibleProductIds.has(item.productId))
      : (data.actionProducts ?? []);
    return applyPermissionResourceBoundary(
      { ...data, stores, publishingAccounts, permissionTemplates, products, actionProducts, productImportBatches, ...productV2Data },
      user,
    );
  }

  const scopedTasks = filterTasksByScope(data.tasks ?? [], user, data);
  const scopedWorkPlans = filterByScope(data.workPlans ?? [], user);
  const scopedProcessInstances = filterByScope(data.processInstances ?? [], user);
  const scopedProcessInstanceIds = new Set(scopedProcessInstances.map((instance) => instance.id));
  const scopedActionProducts = (data.actionProducts ?? []).filter((item) =>
    scopedProcessInstanceIds.has(item.actionId) && (!productsWereLoaded || item.erpSkuId || !item.productId || visibleProductIds.has(item.productId))
  );
  const scopedGoals = filterByScope(data.goals ?? [], user);
  const scopedContentSchedules = filterByScope(data.contentSchedules ?? [], user);
  const scopedWeeklyReports = filterByScope(data.weeklyReports ?? [], user);
  const scopedWeeklyReportProblems = filterByScope(data.weeklyReportProblems ?? [], user);
  const scopedPeople =
    dataScope === "department"
      ? (data.people ?? []).filter((person) => person.departmentId === user.departmentId || person.id === user.id)
      : (data.people ?? []).filter((person) => person.id === user.id);

  return applyPermissionResourceBoundary({
    ...data,
    people: scopedPeople,
    stores,
    publishingAccounts,
    permissionTemplates,
    goals: scopedGoals,
    tasks: scopedTasks,
    processInstances: scopedProcessInstances,
    products,
    productImportBatches,
    ...productV2Data,
    actionProducts: scopedActionProducts,
    contentSchedules: scopedContentSchedules,
    workPlans: scopedWorkPlans,
    weeklyReports: scopedWeeklyReports,
    weeklyReportProblems: scopedWeeklyReportProblems,
  }, user);
}

function applyPermissionResourceBoundary(snapshot, user) {
  const next = { ...snapshot };
  const clear = (...keys) => keys.forEach((key) => {
    if (Object.hasOwn(next, key)) next[key] = [];
  });
  if (!hasPermission(user, "goals.view")) clear("goals");
  if (!hasPermission(user, "tasks.view")) clear("tasks", "taskWaves", "taskWaveItems");
  if (!hasPermission(user, "keyActions.view")) clear("processInstances", "workPlans", "actionProducts");
  if (!hasPermission(user, "contentNotes.view")) clear("contentSchedules");
  if (!hasPermission(user, "workResults.view")) clear("weeklyReports", "weeklyReportProblems");
  if (!hasPermission(user, "actionStandards.view")) {
    clear("taskTemplates", "processTemplates", "processTemplateNodes", "standardWorkForms", "methodologies");
  }
  if (!hasPermission(user, "templates.view")) clear("templates", "templateTagCategories", "templateTags");
  return next;
}

function readTaskProductContexts(snapshot) {
  const database = getDatabase();
  const actionIds = [...new Set((snapshot.actionProducts ?? []).map((item) => String(item.actionId ?? "").trim()).filter(Boolean))];
  const directRefs = [];
  const collectDirectRefs = (item, contextId) => {
    const fields = item?.customFields ?? {};
    const erpSkuIds = [item?.erpSkuId, fields.erpSkuId, ...(Array.isArray(fields.erpSkuIds) ? fields.erpSkuIds : [])];
    for (const erpSkuId of erpSkuIds.map((value) => String(value ?? "").trim()).filter(Boolean)) directRefs.push({ contextId, erpSkuId });
  };
  for (const instance of snapshot.processInstances ?? []) collectDirectRefs(instance, instance.id);
  for (const task of snapshot.tasks ?? []) collectDirectRefs(task, task.processInstanceId || task.id);

  const rows = [];
  if (actionIds.length > 0) {
    const placeholders = actionIds.map(() => "?").join(",");
    rows.push(...database.prepare(`
      SELECT a.actionId contextId,a.actionId,a.productId,COALESCE(a.erpSkuId,m.erpSkuId) erpSkuId,
        p.name productName,p.skuCode productSkuCode,p.mainImage productImage,p.status productStatus,
        s.merchantSkuCode erpSkuCode,s.specificationName erpSkuName,s.mainImage erpSkuImage,s.erpStatus,
        g.goodsName erpGoodsName,profile.id businessProfileId,profile.businessStatus
      FROM action_products a
      LEFT JOIN products p ON p.id=a.productId
      LEFT JOIN product_erp_mappings m ON m.productId=a.productId AND m.currentState='active'
      LEFT JOIN erp_skus s ON s.id=COALESCE(a.erpSkuId,m.erpSkuId)
      LEFT JOIN erp_goods g ON g.id=s.erpGoodsId
      LEFT JOIN product_business_profiles profile ON profile.erpSkuId=s.id
      WHERE a.actionId IN (${placeholders})
      ORDER BY a.createdAt,a.id,m.createdAt,m.id
    `).all(...actionIds));
  }
  const uniqueDirectIds = [...new Set(directRefs.map((item) => item.erpSkuId))];
  if (uniqueDirectIds.length > 0) {
    const placeholders = uniqueDirectIds.map(() => "?").join(",");
    const skuById = new Map(database.prepare(`
      SELECT s.id erpSkuId,s.merchantSkuCode erpSkuCode,s.specificationName erpSkuName,s.mainImage erpSkuImage,s.erpStatus,
        g.goodsName erpGoodsName,m.productId,p.name productName,p.skuCode productSkuCode,p.mainImage productImage,p.status productStatus,
        profile.id businessProfileId,profile.businessStatus
      FROM erp_skus s
      LEFT JOIN erp_goods g ON g.id=s.erpGoodsId
      LEFT JOIN product_erp_mappings m ON m.erpSkuId=s.id AND m.currentState='active'
      LEFT JOIN products p ON p.id=m.productId
      LEFT JOIN product_business_profiles profile ON profile.erpSkuId=s.id
      WHERE s.id IN (${placeholders})
    `).all(...uniqueDirectIds).map((row) => [row.erpSkuId, row]));
    for (const reference of directRefs) {
      const sku = skuById.get(reference.erpSkuId);
      if (sku) rows.push({ contextId: reference.contextId, actionId: reference.contextId, ...sku });
    }
  }
  const seen = new Set();
  return rows.filter((row) => {
    const key = `${row.contextId}|${row.productId || ""}|${row.erpSkuId || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function rejectLegacyContentScheduleWrite(resource, response) {
  if (resource !== "content-schedules") return false;
  response.status(410).json({
    success: false,
    message: "历史内容排期已转为只读，请通过“发起发布内容笔记”创建新排期。",
  });
  return true;
}

app.post("/api/auth/login", (request, response) => {
  try {
    const username = String(request.body?.username ?? "").trim();
    const password = String(request.body?.password ?? "");
    const user = username === "" ? undefined : findLoginUser(username);

    if (user === undefined || !verifyPassword(password, user.passwordHash)) {
      response.status(401).json({ success: false, message: "账号或密码错误" });
      return;
    }

    if (user.status !== "active") {
      response.status(403).json({ success: false, message: "该账号已停用" });
      return;
    }

    if (!user.canLogin) {
      response.status(403).json({ success: false, message: "该账号不允许登录" });
      return;
    }

    touchLastLoginAt(user.id);
    const freshUser = findLoginUserById(user.id);
    const publicUser = getPublicUser(freshUser);
    response.json({
      success: true,
      user: publicUser,
      token: createToken(freshUser),
    });
  } catch (error) {
    console.error("登录失败", error);
    response.status(500).json({ success: false, message: "本地数据库服务未启动，请联系管理员" });
  }
});

app.get("/api/auth/me", requireAuth, (request, response) => {
  response.json({ success: true, user: request.user });
});

app.use("/api", requireAuth);

app.get("/api/store-options", (request, response) => {
  if (!canUseStoreOptions(request.user)) {
    response.status(403).json({ success: false, message: "你没有权限读取关键行动的店铺选项。" });
    return;
  }
  try {
    response.json({
      success: true,
      items: buildActiveStoreOptions(readRouteResource("stores")),
    });
  } catch (error) {
    response.status(500).json({ success: false, message: error.message || "店铺选项读取失败。" });
  }
});

function isMultipartUpload(request) {
  return Boolean(request.is("multipart/form-data"));
}

function getUploadedFiles(request) {
  if (request.file !== undefined) return [request.file];
  if (Array.isArray(request.files)) return request.files;
  if (request.files !== null && typeof request.files === "object") {
    return Object.values(request.files).flatMap((files) => Array.isArray(files) ? files : []);
  }
  return [];
}

function getUploadAuditRequestDetails(request) {
  return {
    userId: request.user.id,
    requestPath: String(request.originalUrl ?? request.path ?? "").split("?")[0],
    method: request.method,
    ipAddress: request.ip,
    userAgent: request.get("user-agent") ?? "",
  };
}

app.use("/api", (request, response, next) => {
  if (!isMultipartUpload(request)) {
    next();
    return;
  }

  const details = getUploadAuditRequestDetails(request);
  const quotaLimitBytes = getUploadDailyQuotaBytes();
  try {
    const attempt = beginUploadAttempt(getDatabase(), {
      ...details,
      contentLength: Number(request.get("content-length")),
      quotaLimitBytes,
    });
    request.uploadAuditId = attempt.id;
  } catch (error) {
    const isQuotaError = error instanceof UploadQuotaExceededError;
    const responseStatus = isQuotaError ? 429 : error.code === "UPLOAD_LENGTH_REQUIRED" ? 411 : 500;
    const reasonCode = error.code ?? "UPLOAD_AUDIT_FAILED";
    const reasonMessage = error.message || "上传治理检查失败。";
    try {
      recordRejectedUploadAttempt(getDatabase(), {
        ...details,
        quotaLimitBytes,
        responseStatus,
        reasonCode,
        reasonMessage,
      });
    } catch (auditError) {
      console.error("上传拒绝审计记录失败", auditError);
    }
    response.status(responseStatus).json({
      success: false,
      error: reasonMessage,
      code: reasonCode,
      quota: isQuotaError ? error.snapshot : undefined,
    });
    return;
  }

  let finalized = false;
  const finalize = (aborted = false) => {
    if (finalized) return;
    finalized = true;
    try {
      finalizeUploadAttempt(getDatabase(), {
        id: request.uploadAuditId,
        files: getUploadedFiles(request),
        responseStatus: aborted ? 499 : response.statusCode,
        reasonCode: aborted ? "CLIENT_ABORTED" : request.uploadAuditFailure?.code,
        reasonMessage: aborted ? "客户端在上传完成前中断连接。" : request.uploadAuditFailure?.message,
      });
    } catch (error) {
      console.error("上传审计收尾失败", error);
    }
  };
  response.once("finish", () => finalize(false));
  response.once("close", () => finalize(!response.writableFinished));
  next();
});

app.put("/api/me/avatar", (request, response) => {
  try {
    const avatarUrl = String(request.body?.avatarUrl ?? "").trim();
    if (avatarUrl !== "" && !avatarUrl.startsWith("/uploads/images/")) {
      response.status(400).json({ success: false, message: "头像地址不合法。" });
      return;
    }

    const updatedUser = updateCurrentUserAvatar(request.user.id, avatarUrl);
    response.json({ success: true, user: getPublicUser(updatedUser) });
  } catch (error) {
    console.error("头像保存失败", error);
    response.status(500).json({ success: false, message: "头像保存失败，请检查本地数据库服务。" });
  }
});

app.get("/api/notifications/summary", (request, response) => {
  try {
    const startedAt = performance.now();
    const summary = readNotificationSummary(request.user.id, { limit: request.query.limit });
    response.set("Server-Timing", `database;dur=${(performance.now() - startedAt).toFixed(1)}`);
    response.json({ success: true, ...summary });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "任务提醒摘要读取失败。" });
  }
});

app.post("/api/notifications/read-all", (request, response) => {
  try {
    response.json({ success: true, ...markAllUserNotificationsRead(request.user.id) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "任务提醒批量已读失败。" });
  }
});

app.get("/api/data", (request, response) => {
  try {
    const startedAt = performance.now();
    const snapshot = readAllData({ exclude: ["salesLinks", "salesLinkSkus"] });
    const readCompletedAt = performance.now();
    const scopedSnapshot = filterDataByScope(snapshot, request.user);
    const filterCompletedAt = performance.now();
    response.set(
      "Server-Timing",
      `database;dur=${(readCompletedAt - startedAt).toFixed(1)}, scope;dur=${(filterCompletedAt - readCompletedAt).toFixed(1)}`,
    );
    response.json(scopedSnapshot);
  } catch (error) {
    response.status(500).json({ error: error.message || "读取本地数据库失败。" });
  }
});

app.get("/api/goal-center/bootstrap", requirePermission("goals.view"), (request, response) => {
  try {
    const startedAt = performance.now();
    const snapshot = readGoalCenterBootstrap(readResource);
    const readCompletedAt = performance.now();
    const scopedSnapshot = pickGoalCenterBootstrapResources(filterDataByScope(snapshot, request.user));
    const filterCompletedAt = performance.now();
    response.set(
      "Server-Timing",
      `database;dur=${(readCompletedAt - startedAt).toFixed(1)}, scope;dur=${(filterCompletedAt - readCompletedAt).toFixed(1)}`,
    );
    response.json(scopedSnapshot);
  } catch (error) {
    response.status(500).json({ error: error.message || "读取目标管理数据失败。" });
  }
});

app.get("/api/goal-center/goals/:id/detail", requirePermission("goals.view"), (request, response) => {
  try {
    const startedAt = performance.now();
    const database = getDatabase();
    const goal = database.prepare("SELECT id,departmentId,ownerId FROM goals WHERE id=?").get(request.params.id);
    if (!goal) { response.status(404).json({ success: false, message: "目标不存在。" }); return; }
    const visibleGoal = filterDataByScope({ goals: [goal] }, request.user).goals ?? [];
    if (!isAdminUser(request.user) && getDataScope(request.user) !== "all" && visibleGoal.length === 0) {
      response.status(403).json({ success: false, message: "你没有权限查看该目标。" }); return;
    }
    const page = normalizeTaskListPage(request.query.page, 1);
    const pageSize = normalizeTaskListPage(request.query.pageSize, 50, 100);
    const instanceRows = database.prepare("SELECT id FROM process_instances WHERE goalId=? ORDER BY createdAt DESC,id DESC LIMIT ? OFFSET ?")
      .all(goal.id, pageSize, (page - 1) * pageSize);
    const instanceIds = instanceRows.map((row) => row.id);
    const taskIds = database.prepare("SELECT id FROM tasks WHERE goalId=? ORDER BY COALESCE(dueDate,'9999-12-31'),id LIMIT ? OFFSET ?")
      .all(goal.id, pageSize, (page - 1) * pageSize).map((row) => row.id);
    const workPlanIds = database.prepare("SELECT id FROM work_plans WHERE goalId=? ORDER BY createdAt DESC,id DESC LIMIT ? OFFSET ?")
      .all(goal.id, pageSize, (page - 1) * pageSize).map((row) => row.id);
    const actionProductIds = instanceIds.length === 0 ? [] : database.prepare(`SELECT id FROM action_products WHERE actionId IN (${instanceIds.map(() => "?").join(",")})`).all(...instanceIds).map((row) => row.id);
    const scoped = filterDataByScope({
      tasks: readResourceItems("tasks", taskIds),
      processInstances: readResourceItems("processInstances", instanceIds),
      workPlans: readResourceItems("workPlans", workPlanIds),
      actionProducts: readResourceItems("actionProducts", actionProductIds),
    }, request.user);
    const totals = {
      tasks: Number(database.prepare("SELECT COUNT(*) count FROM tasks WHERE goalId=?").get(goal.id)?.count || 0),
      processInstances: Number(database.prepare("SELECT COUNT(*) count FROM process_instances WHERE goalId=?").get(goal.id)?.count || 0),
      workPlans: Number(database.prepare("SELECT COUNT(*) count FROM work_plans WHERE goalId=?").get(goal.id)?.count || 0),
    };
    const payload = { success: true, page, pageSize, totals, data: scoped };
    const text = JSON.stringify(payload);
    response.set("Server-Timing", `goal-detail;dur=${(performance.now() - startedAt).toFixed(1)}`);
    response.type("application/json").send(text);
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "目标详情读取失败。" });
  }
});

app.get("/api/bootstrap", (request, response) => {
  try {
    const startedAt = performance.now();
    const moduleName = String(request.query.module ?? "dashboard");
    const defaultCommon = ["companies", "departments", "positions", "people", "permissionTemplates", "categories", "stores", "publishingAccounts",
      "taskTemplates", "processTemplates", "processTemplateNodes", "templates", "templateTagCategories", "templateTags", "issuesRequirements", "standardWorkForms"];
    const taskCommon = ["companies", "departments", "positions", "people", "permissionTemplates", "categories", "stores", "publishingAccounts",
      "taskTemplates", "processTemplates", "processTemplateNodes", "standardWorkForms"];
    const settingsCommon = ["companies", "departments", "positions", "people", "permissionTemplates", "categories", "stores", "publishingAccounts",
      "taskTemplates", "templateTagCategories", "templateTags", "issuesRequirements", "standardWorkForms"];
    const templateCenterCommon = ["templates", "templateTagCategories", "templateTags"];
    const processesCommon = ["categories", "departments", "goals", "methodologies", "people", "positions", "processTemplateNodes", "processTemplates", "taskTemplates"];
    // The schedule board also launches and batch-imports actions. Its editors need
    // the latest form, managed account directory, and process nodes. Omitting these
    // resources makes saved fields look empty or a valid flow look unconfigured.
    const scheduleBoardCommon = [
      "categories", "departments", "people", "stores", "publishingAccounts",
      "taskTemplates", "processTemplates", "processTemplateNodes", "standardWorkForms",
    ];
    const workResultsCommon = ["departments", "people", "positions", "goals", "taskTemplates"];
    const moduleResources = {
      dashboard: [],
      dashboardManagement: ["goals", "weeklyReports", "weeklyReportProblems"],
      products: [],
      connectionCenter: ["goals", "taskTemplates", "processTemplates", "processTemplateNodes"],
      tasks: ["goals"],
      "task-list": ["goals"],
      scheduleBoard: ["goals"],
      processes: [],
      templateCenter: [],
      settings: [],
      financeCenter: [],
      adminDataCenter: [],
    };
    if (!(moduleName in moduleResources)) { response.status(400).json({ success: false, message: "该模块尚未接入轻量启动。" }); return; }
    const permissionModule = moduleName === "task-list" ? "tasks" : moduleName === "dashboardManagement" ? "dashboard" : moduleName;
    if (!canAccessModule(request.user, permissionModule)) {
      response.status(403).json({ success: false, message: "你没有权限访问该模块。" });
      return;
    }
    const common = ["tasks", "task-list"].includes(moduleName)
      ? taskCommon
      : moduleName === "scheduleBoard"
        ? scheduleBoardCommon
      : moduleName === "dashboardManagement"
        ? workResultsCommon
      : moduleName === "settings"
        ? settingsCommon
        : moduleName === "templateCenter"
          ? templateCenterCommon
          : moduleName === "processes"
            ? processesCommon
          : defaultCommon;
    const keys = [...new Set([...common, ...moduleResources[moduleName]])];
    const snapshot = Object.fromEntries(keys.map((key) => [key, readResource(key)]));
    const readCompletedAt = performance.now();
    const scoped = filterDataByScope(snapshot, request.user);
    const scopeCompletedAt = performance.now();
    if (moduleName === "scheduleBoard") scoped.taskProductContexts = readTaskProductContexts(scoped);
    if (moduleName === "processes") scoped.templateCenterUsageSummary = readTemplateCenterUsageSummary();
    response.set("Server-Timing", `database;dur=${(readCompletedAt - startedAt).toFixed(1)}, scope;dur=${(scopeCompletedAt - readCompletedAt).toFixed(1)}, extras;dur=${(performance.now() - scopeCompletedAt).toFixed(1)}`);
    response.json(scoped);
  } catch (error) { response.status(400).json({ success: false, message: error.message || "轻量启动数据读取失败。" }); }
});

app.get("/api/schedule-board/page", requirePermission("keyActions.view"), (request, response) => {
  try {
    const startedAt = performance.now();
    const dataScope = getDataScope(request.user);
    const page = readScheduleBoardPage({
      ...request.query,
      actorId: isAdminUser(request.user) || dataScope === "all" ? "" : getUserPersonId(request.user),
      departmentId: request.user?.departmentId,
      scope: dataScope,
    });
    const scoped = filterDataByScope(page.data, request.user);
    // A linked visual template is part of the visible action detail. Return only
    // those referenced assets even when the user cannot browse the template center.
    scoped.templates = selectLinkedVisualTemplates(scoped, page.data.templates);
    scoped.taskProductContexts = readTaskProductContexts(scoped);
    const payload = { success: true, ...page, data: scoped };
    const text = JSON.stringify(payload);
    response.set("Server-Timing", `schedule-page;dur=${(performance.now() - startedAt).toFixed(1)}`);
    response.type("application/json").send(text);
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "关键行动排期读取失败。" });
  }
});

app.get("/api/work-results/initial", requirePermission("workResults.view"), (request, response) => {
  try {
    const startedAt = performance.now();
    const result = readWorkResultsInitial({ days: request.query.days });
    result.data = filterDataByScope(result.data, request.user);
    const payload = { success: true, ...result };
    const text = JSON.stringify(payload);
    response.set("Server-Timing", `work-results;dur=${(performance.now() - startedAt).toFixed(1)}`);
    response.type("application/json").send(text);
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "工作结果摘要读取失败。" });
  }
});

app.get("/api/template-center/library", (request, response) => {
  try {
    const startedAt = performance.now();
    const category = String(request.query.category ?? "action");
    const categoryResources = {
      action: ["taskTemplates", "processTemplates", "processTemplateNodes", "standardWorkForms"],
      form: ["taskTemplates", "standardWorkForms"],
      standard: ["taskTemplates", "processTemplates", "processTemplateNodes", "methodologies"],
    };
    const requiredPermission = category === "action" || category === "standard" ? "actionStandards.view" : "templates.view";
    if (!hasPermission(request.user, requiredPermission)) {
      response.status(403).json({ success: false, message: "你没有权限查看该模板分类。" });
      return;
    }
    if (!(category in categoryResources)) {
      response.status(400).json({ success: false, message: "未知模板分类。" });
      return;
    }
    const snapshot = Object.fromEntries(categoryResources[category].map((key) => [key, readResource(key)]));
    const readCompletedAt = performance.now();
    const scoped = filterDataByScope(snapshot, request.user);
    const scopeCompletedAt = performance.now();
    scoped.templateCenterUsageSummary = readTemplateCenterUsageSummary();
    const payload = { success: true, category, data: scoped };
    const payloadText = JSON.stringify(payload);
    const serializedAt = performance.now();
    response.set("Server-Timing", `database;dur=${(readCompletedAt - startedAt).toFixed(1)}, scope;dur=${(scopeCompletedAt - readCompletedAt).toFixed(1)}, usage;dur=${(serializedAt - scopeCompletedAt).toFixed(1)}`);
    response.type("application/json").send(payloadText);
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "模板分类读取失败。" });
  }
});

function normalizeTaskListPage(value, fallback, maximum = Number.POSITIVE_INFINITY) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function parseTaskListFilters(value) {
  if (value === undefined || value === null || value === "") return {};
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return {}; }
}

function isTaskListDone(task) {
  return ["done", "completed"].includes(String(task?.status ?? ""));
}

function isTaskListCanceled(task) {
  return ["canceled", "cancelled"].includes(String(task?.status ?? ""));
}

function isTaskListOverdue(task, today = getTaskListBusinessDate()) {
  const dueDate = getTaskListDatePart(task?.dueDate);
  return dueDate !== "" && dueDate < today && !isTaskListDone(task) && !isTaskListCanceled(task);
}

function getTaskListDatePart(value) {
  const normalizedValue = String(value ?? "").trim();
  if (normalizedValue === "") return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) return normalizedValue;
  const parsed = new Date(normalizedValue);
  if (Number.isNaN(parsed.getTime())) return normalizedValue.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
}

function getTaskListBusinessDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function matchesTaskListSourceFilter(task, source) {
  const normalizedSource = String(source ?? "").trim();
  if (normalizedSource === "") return true;
  if (normalizedSource === "process") return task.source === "process";
  if (["direct", "normal", "manual"].includes(normalizedSource)) return task.source !== "process";
  return task.source === normalizedSource;
}

function getLinkedTaskTemplateIds(item) {
  const linkedTemplateIds = item?.customFields?.linkedTemplateIds;
  return Array.isArray(linkedTemplateIds)
    ? linkedTemplateIds.map((id) => String(id ?? "").trim()).filter(Boolean)
    : [];
}

function createTaskListSummary(task) {
  const customFields = task.customFields ?? {};
  return {
    id: task.id,
    taskId: task.id,
    businessCode: task.businessCode,
    taskType: task.taskType,
    name: task.name,
    status: task.status,
    source: task.source,
    executorId: task.executorId,
    ownerId: task.ownerId,
    departmentId: task.departmentId,
    initiatorId: task.initiatorId,
    accepterId: task.accepterId,
    reviewerId: task.reviewerId,
    startDate: task.startDate,
    readyAt: task.readyAt,
    dueDate: task.dueDate,
    completedAt: task.completedAt,
    goalId: task.goalId,
    categoryId: task.categoryId,
    taskTemplateId: task.taskTemplateId,
    templateId: task.templateId,
    processInstanceId: task.processInstanceId,
    processNodeId: task.processNodeId,
    reviewTargetTaskId: task.reviewTargetTaskId,
    reviewStatus: task.reviewStatus,
    displayTitle: task.displayTitle,
    coverImageUrl: task.coverImageUrl,
    customFields: {
      linkedObjectType: customFields.linkedObjectType,
      linkedObjectId: customFields.linkedObjectId,
      linkedObjectName: customFields.linkedObjectName,
      actionCode: customFields.actionCode,
      assessmentOverdueRecordedAt: customFields.assessmentOverdueRecordedAt,
      assessmentOverdueDueDate: customFields.assessmentOverdueDueDate,
    },
    listVisibilityConfirmed: true,
    listOverdue: isTaskListOverdue(task),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

app.get("/api/task-center/tasks", (request, response) => {
  if (!hasPermission(request.user, "tasks.view")) {
    rejectUnauthorizedTask(response, "你没有权限查看任务列表。");
    return;
  }
  try {
    const startedAt = performance.now();
    const page = normalizeTaskListPage(request.query.page, 1);
    const pageSize = normalizeTaskListPage(request.query.pageSize, 50, 100);
    const view = ["today", "mine", "overdue", "all"].includes(String(request.query.view)) ? String(request.query.view) : "today";
    const keyword = String(request.query.keyword ?? "").trim().toLowerCase();
    const filters = parseTaskListFilters(request.query.filters);
    const sort = String(request.query.sort ?? "remaining");
    const database = getDatabase();
    const actorId = String(request.user?.personId ?? request.user?.id ?? "");
    const today = getTaskListBusinessDate();
    const conditions = [
      "t.source <> 'clearance'",
      "COALESCE(tt.name,'') <> '库存清仓'",
      "COALESCE(pi.name,'') NOT LIKE '%库存清仓%'",
      "COALESCE(pi.displayTitle,'') NOT LIKE '%库存清仓%'",
    ];
    const params = { actorId, departmentId: String(request.user?.departmentId ?? ""), today, keyword: `%${keyword}%`, keywordExact: keyword };
    const specialSearch = keyword === "" ? "" : `(
      lower(COALESCE(t.businessCode,''))=@keywordExact OR lower(COALESCE(pi.businessCode,''))=@keywordExact
      OR EXISTS (SELECT 1 FROM templates svt WHERE lower(COALESCE(svt.businessCode,'')) LIKE @keyword AND (
        EXISTS (SELECT 1 FROM json_each(COALESCE(pi.customFields,'{}'),'$.linkedTemplateIds') WHERE value=svt.id)
        OR EXISTS (SELECT 1 FROM work_plans ssw,json_each(COALESCE(ssw.customFields,'{}'),'$.linkedTemplateIds') WHERE ssw.processInstanceId=t.processInstanceId AND value=svt.id)
      ))
    )`;
    const dataScope = getDataScope(request.user);
    if (!isAdminUser(request.user) && dataScope !== "all") {
      const owned = "(@actorId IN (t.ownerId,t.executorId,t.accepterId,t.reviewerId,t.initiatorId,t.submittedBy) OR pn.ownerId=@actorId OR tt.ownerId=@actorId OR EXISTS (SELECT 1 FROM tasks rt WHERE rt.taskType='review' AND rt.reviewTargetTaskId=t.id AND @actorId IN (rt.executorId,rt.accepterId,rt.reviewerId)))";
      conditions.push(dataScope === "department" ? `(t.departmentId=@departmentId OR ${owned})` : owned);
    }
    if (filters.showImprovementTasks !== true) conditions.push("NOT EXISTS (SELECT 1 FROM work_plans iw WHERE iw.processInstanceId=t.processInstanceId AND iw.workType='rectification')");
    if (!(filters.showDone || filters.status === "done")) conditions.push(specialSearch ? `(${specialSearch} OR t.status NOT IN ('done','completed'))` : "t.status NOT IN ('done','completed')");
    if (!(filters.showCanceled || filters.status === "canceled")) conditions.push(specialSearch ? `(${specialSearch} OR t.status NOT IN ('canceled','cancelled'))` : "t.status NOT IN ('canceled','cancelled')");
    if (filters.status) { conditions.push("t.status=@status"); params.status = filters.status; }
    if (filters.source) {
      if (["direct", "normal", "manual"].includes(filters.source)) conditions.push("t.source <> 'process'");
      else { conditions.push("t.source=@source"); params.source = filters.source === "process" ? "process" : filters.source; }
    }
    for (const field of ["departmentId", "ownerId", "executorId"]) if (filters[field]) { conditions.push(`t.${field}=@filter_${field}`); params[`filter_${field}`] = filters[field]; }
    const dueBusinessDate = "date(COALESCE(t.dueDate,t.startDate),'+8 hours')";
    const terminalBusinessDate = "date(COALESCE(t.completedAt,t.updatedAt),'+8 hours')";
    const overdue = `${dueBusinessDate}<@today AND t.status NOT IN ('done','completed','canceled','cancelled')`;
    if (view === "mine") conditions.push(specialSearch ? `(${specialSearch} OR t.executorId=@actorId)` : "t.executorId=@actorId");
    if (view === "overdue") conditions.push(specialSearch ? `(${specialSearch} OR ${overdue})` : overdue);
    if (view === "today") {
      const todayCondition = `(${dueBusinessDate}=@today OR t.status='doing' OR ${terminalBusinessDate}=@today)`;
      conditions.push(specialSearch ? `(${specialSearch} OR ${todayCondition})` : todayCondition);
    }
    if (filters.overdue === "yes") conditions.push(overdue);
    if (filters.overdue === "no") conditions.push(`NOT (${overdue})`);
    if (keyword !== "") conditions.push(`(
      lower(COALESCE(t.name,'')) LIKE @keyword OR lower(COALESCE(t.businessCode,'')) LIKE @keyword
      OR lower(COALESCE(json_extract(t.customFields,'$.actionCode'),'')) LIKE @keyword
      OR lower(COALESCE(pi.businessCode,'')) LIKE @keyword OR lower(COALESCE(pi.displayTitle,'')) LIKE @keyword OR lower(COALESCE(pi.name,'')) LIKE @keyword
      OR lower(COALESCE(tt.businessCode,'')) LIKE @keyword OR lower(COALESCE(tt.name,'')) LIKE @keyword
      OR lower(COALESCE(g.businessCode,'')) LIKE @keyword OR lower(COALESCE(g.name,'')) LIKE @keyword
      OR lower(COALESCE(d.name,'')) LIKE @keyword OR lower(COALESCE(po.name,'')) LIKE @keyword OR lower(COALESCE(pe.name,'')) LIKE @keyword
      OR EXISTS (SELECT 1 FROM templates vt WHERE lower(COALESCE(vt.businessCode,'')) LIKE @keyword AND (
        EXISTS (SELECT 1 FROM json_each(COALESCE(pi.customFields,'{}'),'$.linkedTemplateIds') WHERE value=vt.id)
        OR EXISTS (SELECT 1 FROM work_plans sw,json_each(COALESCE(sw.customFields,'{}'),'$.linkedTemplateIds') WHERE sw.processInstanceId=t.processInstanceId AND value=vt.id)
      ))
    )`);
    const fromSql = `FROM tasks t
      LEFT JOIN process_instances pi ON pi.id=t.processInstanceId
      LEFT JOIN task_templates tt ON tt.id=COALESCE(t.taskTemplateId,pi.taskTemplateId)
      LEFT JOIN process_template_nodes pn ON pn.id=t.processNodeId
      LEFT JOIN goals g ON g.id=t.goalId LEFT JOIN departments d ON d.id=t.departmentId
      LEFT JOIN persons po ON po.id=t.ownerId LEFT JOIN persons pe ON pe.id=t.executorId`;
    const whereSql = conditions.join(" AND ");
    const scopeCompletedAt = performance.now();
    const total = Number(database.prepare(`SELECT COUNT(*) total ${fromSql} WHERE ${whereSql}`).get(params)?.total || 0);
    const countCompletedAt = performance.now();
    const orderSql = sort === "name" ? "t.name COLLATE NOCASE,t.id" : "COALESCE(t.dueDate,'9999-12-31'),t.id";
    const pageIds = database.prepare(`SELECT t.id ${fromSql} WHERE ${whereSql} ORDER BY ${orderSql} LIMIT @pageSize OFFSET @offset`)
      .all({ ...params, pageSize, offset: (page - 1) * pageSize }).map((row) => row.id);
    const pageQueryCompletedAt = performance.now();
    const pageItems = readResourceItems("tasks", pageIds);
    const hydrationCompletedAt = performance.now();
    const processInstanceIds = new Set(pageItems.map((item) => item.processInstanceId).filter(Boolean));
    const processIds = [...processInstanceIds];
    const processInstances = readResourceItems("processInstances", processIds);
    const workPlanIds = processIds.length === 0 ? [] : database.prepare(`SELECT id FROM work_plans WHERE processInstanceId IN (${processIds.map(() => "?").join(",")})`).all(...processIds).map((row) => row.id);
    const workPlans = readResourceItems("workPlans", workPlanIds);
    const actionProductIds = processIds.length === 0 ? [] : database.prepare(`SELECT id FROM action_products WHERE actionId IN (${processIds.map(() => "?").join(",")})`).all(...processIds).map((row) => row.id);
    const actionProducts = readResourceItems("actionProducts", actionProductIds);
    const taskProductContexts = readTaskProductContexts({
      tasks: pageItems,
      processInstances,
      workPlans,
      actionProducts,
    });
    const waveItems = readTaskWavesForTaskIds(pageItems.map((item) => item.id));
    const contextCompletedAt = performance.now();
    const payload = {
      success: true,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      items: pageItems.map(createTaskListSummary),
      context: { processInstances, workPlans, taskProductContexts, taskWaves: waveItems },
    };
    const payloadText = JSON.stringify(payload);
    const serializationCompletedAt = performance.now();
    response.set("Server-Timing", [
      `scope;dur=${(scopeCompletedAt - startedAt).toFixed(1)}`,
      `count;dur=${(countCompletedAt - scopeCompletedAt).toFixed(1)}`,
      `query;dur=${(pageQueryCompletedAt - countCompletedAt).toFixed(1)}`,
      `hydrate;dur=${(hydrationCompletedAt - pageQueryCompletedAt).toFixed(1)}`,
      `context;dur=${(contextCompletedAt - hydrationCompletedAt).toFixed(1)}`,
      `serialize;dur=${(serializationCompletedAt - contextCompletedAt).toFixed(1)}`,
    ].join(", "));
    response.type("application/json").send(payloadText);
  } catch (error) {
    console.error("任务中心分页读取失败", error);
    response.status(400).json({ success: false, message: error.message || "任务列表读取失败。" });
  }
});

app.get("/api/task-center/tasks/:id/detail", (request, response) => {
  if (!hasPermission(request.user, "tasks.view")) {
    rejectUnauthorizedTask(response, "你没有权限查看任务详情。");
    return;
  }
  try {
    const authorization = readTaskAuthorizationResolver([request.params.id]).get(request.params.id);
    if (authorization === null) { response.status(404).json({ success: false, message: "未找到任务。" }); return; }
    if (!canViewTask(request.user, authorization)) { rejectUnauthorizedTask(response, "你没有权限查看该任务。"); return; }
    const task = readRouteResourceItem("tasks", request.params.id);
    const processTasks = task.processInstanceId
      ? readResource("tasks").filter((item) => item.processInstanceId === task.processInstanceId)
      : [task];
    const processInstances = task.processInstanceId
      ? readResource("processInstances").filter((item) => item.id === task.processInstanceId)
      : [];
    const workPlans = task.processInstanceId
      ? readResource("workPlans").filter((item) => item.processInstanceId === task.processInstanceId || item.id === processInstances[0]?.workPlanId)
      : [];
    const processInstanceIds = new Set(processInstances.map((item) => item.id));
    const actionProducts = readResource("actionProducts").filter((item) => processInstanceIds.has(item.actionId));
    const contextSnapshot = { tasks: processTasks, processInstances, workPlans, actionProducts };
    const linkedTemplateIds = new Set([...processInstances, ...workPlans].flatMap((item) => {
      const ids = item?.customFields?.linkedTemplateIds;
      return Array.isArray(ids) ? ids : [];
    }));
    const templates = readResource("templates").filter((item) => linkedTemplateIds.has(item.id));
    response.json({ success: true, task, context: { processTasks, processInstances, workPlans, templates, taskProductContexts: readTaskProductContexts(contextSnapshot), taskWaves: readTaskWavesForTaskIds([task.id]) } });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "任务详情读取失败。" });
  }
});

app.post("/api/data", requirePermission("permissions.manage"), (request, response) => {
  try {
    const fullSnapshotSaveAllowed =
      request.get("x-wufan-full-data-save") === "true" && request.body?.__confirmFullSnapshotReplace === true;
    if (!fullSnapshotSaveAllowed) {
      response.status(409).json({
        success: false,
        message: "全量覆盖保存已停用，请使用单条资源保存接口，避免刷新或局部状态覆盖数据库。",
      });
      return;
    }

    const { __confirmFullSnapshotReplace: _confirm, ...snapshot } = request.body ?? {};
    replaceAllData(snapshot);
    response.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (error) {
    response.status(500).json({ error: error.message || "保存本地数据库失败。" });
  }
});

function readUploadHeader(filePath, maxBytes = 8192) {
  const descriptor = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = fs.readSync(descriptor, buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    fs.closeSync(descriptor);
  }
}

function removeStagedUpload(filePath) {
  const resolvedFilePath = path.resolve(filePath);
  const resolvedStagingDir = `${path.resolve(uploadStagingDir)}${path.sep}`;
  if (resolvedFilePath.startsWith(resolvedStagingDir)) fs.rmSync(resolvedFilePath, { force: true });
}

function rejectInvalidStoredUpload(request, response, policyKey) {
  if (request.file === undefined) return false;
  let validation;
  try {
    validation = validateUploadContent(request.file, readUploadHeader(request.file.path), policyKey);
  } catch {
    validation = { valid: false, reason: "文件内容无法读取或已损坏。" };
  }
  if (validation.valid) return false;

  removeStagedUpload(request.file.path);
  request.uploadAuditFailure = { code: "UPLOAD_CONTENT_MISMATCH", message: validation.reason };
  response.status(400).json({ error: validation.reason, code: "UPLOAD_CONTENT_MISMATCH" });
  return true;
}

function promoteValidatedUpload(request, response, destinationDirectory) {
  const destinationPath = path.join(destinationDirectory, request.file.filename);
  try {
    if (fs.existsSync(destinationPath)) throw new Error("目标文件名冲突。");
    fs.renameSync(request.file.path, destinationPath);
    request.file.path = destinationPath;
    return false;
  } catch (error) {
    removeStagedUpload(request.file.path);
    console.error("已校验上传文件入库失败", error);
    const message = "文件保存失败，请稍后重试。";
    request.uploadAuditFailure = { code: "UPLOAD_PROMOTION_FAILED", message };
    response.status(500).json({ error: message, code: "UPLOAD_PROMOTION_FAILED" });
    return true;
  }
}

app.get("/api/uploads/quota", (request, response) => {
  response.json({
    success: true,
    quota: getUserUploadQuota(getDatabase(), request.user.id),
  });
});

app.get("/api/uploads/audits", requirePermission("permissions.manage"), (request, response) => {
  response.json({
    success: true,
    audits: listUploadAudits(getDatabase(), {
      userId: request.query.userId,
      status: request.query.status,
      limit: request.query.limit,
    }),
  });
});

app.post("/api/uploads/image", requirePermission("uploads.image"), (request, response) => {
  uploadImage.single("image")(request, response, (error) => {
    if (error !== undefined) {
      const message =
        error.code === "LIMIT_FILE_SIZE" ? "图片大小不能超过 10MB。" : error.message || "图片上传失败。";
      request.uploadAuditFailure = { code: error.code ?? "UPLOAD_IMAGE_REJECTED", message };
      response.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: message });
      return;
    }

    if (request.file === undefined) {
      request.uploadAuditFailure = { code: "UPLOAD_FILE_REQUIRED", message: "请选择要上传的图片。" };
      response.status(400).json({ error: "请选择要上传的图片。" });
      return;
    }
    if (rejectInvalidStoredUpload(request, response, "image")) return;
    if (promoteValidatedUpload(request, response, imageUploadsDir)) return;

    response.json({
      url: `/uploads/images/${request.file.filename}`,
      filename: request.file.filename,
    });
  });
});

app.post("/api/uploads/file", requirePermission("uploads.file"), (request, response) => {
  uploadFile.single("file")(request, response, (error) => {
    if (error !== undefined) {
      const message =
        error.code === "LIMIT_FILE_SIZE" ? "源文件超过上传限制，请压缩后上传，当前限制为600MB。" : error.message || "文件上传失败。";
      request.uploadAuditFailure = { code: error.code ?? "UPLOAD_FILE_REJECTED", message };
      response.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: message });
      return;
    }

    if (request.file === undefined) {
      request.uploadAuditFailure = { code: "UPLOAD_FILE_REQUIRED", message: "请选择要上传的文件。" };
      response.status(400).json({ error: "请选择要上传的文件。" });
      return;
    }
    if (rejectInvalidStoredUpload(request, response, "file")) return;
    if (promoteValidatedUpload(request, response, fileUploadsDir)) return;

    response.json({
      url: `/uploads/files/${request.file.filename}`,
      filename: request.file.filename,
      originalName: normalizeUploadedFileName(request.file.originalname),
      size: request.file.size,
      mimeType: request.file.mimetype,
    });
  });
});

app.post("/api/uploads/standard-work-attachment", requirePermission("uploads.standardWorkAttachment"), (request, response) => {
  uploadSpreadsheet.single("file")(request, response, (error) => {
    if (error !== undefined) {
      const message =
        error.code === "LIMIT_FILE_SIZE" ? "附件大小不能超过 20MB。" : error.message || "附件上传失败。";
      request.uploadAuditFailure = { code: error.code ?? "UPLOAD_ATTACHMENT_REJECTED", message };
      response.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: message });
      return;
    }

    if (request.file === undefined) {
      request.uploadAuditFailure = { code: "UPLOAD_FILE_REQUIRED", message: "请选择要上传的附件。" };
      response.status(400).json({ error: "请选择要上传的附件。" });
      return;
    }
    if (rejectInvalidStoredUpload(request, response, "spreadsheet")) return;
    if (promoteValidatedUpload(request, response, standardWorkAttachmentsDir)) return;

    response.json({
      url: `/uploads/standard-work-attachments/${request.file.filename}`,
      filePath: `/uploads/standard-work-attachments/${request.file.filename}`,
      filename: request.file.filename,
      originalName: normalizeUploadedFileName(request.file.originalname),
      size: request.file.size,
      mimeType: request.file.mimetype,
      ext: path.extname(normalizeUploadedFileName(request.file.originalname)).toLowerCase(),
      uploadedAt: new Date().toISOString(),
    });
  });
});

app.use("/api/products/import", requirePermission("products.import"), (_request, response) => {
  response.status(410).json({
    success: false,
    message: "旧货品信息导入入口已停用，请使用产品中心 ERP V2 的“导入货品信息”。",
    redirectTo: "/api/products/erp-v2/parse",
  });
});

app.post("/api/products/import/parse", requirePermission("products.import"), (request, response) => {
  uploadProductImport.single("file")(request, response, async (error) => {
    if (error !== undefined) {
      const message = error.code === "LIMIT_FILE_SIZE" ? "ERP Excel 大小不能超过 300MB。" : error.message || "Excel 上传失败。";
      response.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ success: false, message });
      return;
    }
    if (request.file === undefined) {
      response.status(400).json({ success: false, message: "请选择 ERP Excel 文件。" });
      return;
    }

    const now = new Date().toISOString();
    const batchId = `product-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fileName = normalizeUploadedFileName(request.file.originalname);
    const sourceSystem = String(request.body?.sourceSystem ?? "ERP").trim() || "ERP";
    let batch = createProductImportBatch({
      id: batchId,
      fileName,
      sourceSystem,
      sheetName: "",
      status: "parsing",
      headers: [],
      mappingConfig: {},
      summary: {},
      createdBy: getUserPersonId(request.user),
      validatedAt: null,
      committedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    try {
      const parsed = await parseProductWorkbook(request.file.path, batchId, fileName);
      const existingProducts = readAllData().products ?? [];
      const validation = validateProductImport(parsed.staging, parsed.mapping, existingProducts, batchId, sourceSystem);
      batch = updateProductImportBatch(batchId, {
        ...batch,
        sheetName: parsed.staging.sheetName,
        status: "parsed",
        headers: parsed.staging.headers,
        mappingConfig: parsed.mapping,
        summary: validation.summary,
        updatedAt: new Date().toISOString(),
      });
      response.json({
        success: true,
        batch,
        fieldDefinitions: productImportFieldDefinitions,
        preview: validation.rows.slice(0, 20),
      });
    } catch (parseError) {
      updateProductImportBatch(batchId, {
        ...batch,
        status: "failed",
        summary: { message: parseError.message || "Excel 解析失败。" },
        updatedAt: new Date().toISOString(),
      });
      console.error("ERP 产品 Excel 解析失败", parseError);
      response.status(400).json({ success: false, message: parseError.message || "Excel 解析失败。" });
    } finally {
      fs.rmSync(request.file.path, { force: true });
    }
  });
});

app.post("/api/products/import/:id/validate", requirePermission("products.import"), (request, response) => {
  try {
    const batch = readProductImportBatch(request.params.id);
    if (batch === null) {
      response.status(404).json({ success: false, message: "导入记录不存在。" });
      return;
    }
    if (batch.status === "committed") {
      response.status(409).json({ success: false, message: "该批次已经完成导入。" });
      return;
    }
    const staging = readProductImportStaging(batch.id);
    const mapping = Object.fromEntries(staging.headers.map((header) => [header, String(request.body?.mapping?.[header] ?? "rawSourceData")]));
    const allowedTargets = new Set(["rawSourceData", ...productImportFieldDefinitions.map((definition) => definition.key)]);
    if (Object.values(mapping).some((target) => !allowedTargets.has(target))) {
      response.status(400).json({ success: false, message: "字段映射中包含未知系统字段。" });
      return;
    }
    const validation = validateProductImport(staging, mapping, readAllData().products ?? [], batch.id, batch.sourceSystem);
    const now = new Date().toISOString();
    const nextBatch = updateProductImportBatch(batch.id, {
      ...batch,
      status: validation.valid ? "validated" : "parsed",
      mappingConfig: mapping,
      summary: validation.summary,
      validatedAt: validation.valid ? now : null,
      updatedAt: now,
    });
    response.json({ success: true, valid: validation.valid, batch: nextBatch, preview: validation.rows.slice(0, 100) });
  } catch (validationError) {
    console.error("ERP 产品导入校验失败", validationError);
    response.status(400).json({ success: false, message: validationError.message || "导入校验失败。" });
  }
});

app.post("/api/products/import/:id/commit", requirePermission("products.import"), (request, response) => {
  try {
    const batch = readProductImportBatch(request.params.id);
    if (batch === null) {
      response.status(404).json({ success: false, message: "导入记录不存在。" });
      return;
    }
    if (batch.status === "committed") {
      response.json({ success: true, idempotent: true, batch, data: filterDataByScope(readAllData(), request.user) });
      return;
    }
    const staging = readProductImportStaging(batch.id);
    const validation = validateProductImport(staging, batch.mappingConfig ?? {}, readAllData().products ?? [], batch.id, batch.sourceSystem);
    if (!validation.valid) {
      response.status(409).json({ success: false, message: "导入数据已变化或校验未通过，请重新校验。", summary: validation.summary });
      return;
    }
    if (validation.summary.update > 0 && !hasPermission(request.user, "products.import")) {
      response.status(403).json({ success: false, message: "本批次包含 SKU 更新，你没有编辑产品权限。" });
      return;
    }
    const committedAt = new Date().toISOString();
    const result = commitProductImportBatch(
      batch.id,
      validation.rows.map((row) => row.product),
      { ...validation.summary, committedBy: getUserPersonId(request.user), committedAt },
      committedAt,
    );
    response.json({
      success: true,
      idempotent: result.idempotent,
      batch: result.batch,
      products: result.products,
      data: filterDataByScope(readAllData(), request.user),
    });
  } catch (commitError) {
    console.error("ERP 产品确认导入失败", commitError);
    response.status(400).json({ success: false, message: commitError.message || "确认导入失败。" });
  }
});

app.post("/api/products/erp-v2/parse", requirePermission("products.import"), (request, response) => {
  uploadProductImport.single("file")(request, response, async (error) => {
    if (error !== undefined) {
      response.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
        success: false,
        message: error.code === "LIMIT_FILE_SIZE" ? "ERP Excel 大小不能超过 300MB。" : error.message || "Excel 上传失败。",
      });
      return;
    }
    if (request.file === undefined) {
      response.status(400).json({ success: false, message: "请选择 ERP Excel 文件。" });
      return;
    }
    try {
      const result = await parseErpV2Import({
        filePath: request.file.path,
        originalFilename: normalizeUploadedFileName(request.file.originalname),
        importType: String(request.body?.importType ?? ""),
        importMode: String(request.body?.importMode ?? ""),
        syncRunId: String(request.body?.syncRunId ?? ""),
        createdBy: getUserPersonId(request.user),
      });
      response.json({ success: true, ...result });
    } catch (parseError) {
      console.error("产品中心 V2 ERP解析失败", parseError);
      response.status(400).json({ success: false, message: parseError.message || "ERP文件解析失败。" });
    } finally {
      fs.rmSync(request.file.path, { force: true });
    }
  });
});

app.get("/api/products/erp-sync-runs", requirePermission("products.view"), (request, response) => {
  try {
    const runs = listErpSyncRuns({
      businessDate: String(request.query.businessDate ?? ""),
      includeHistorical: String(request.query.includeHistorical ?? "true") !== "false",
    });
    response.json({
      success: true,
      runs: isAdminUser(request.user) ? runs : runs.filter((run) => run.dataSource !== "wangdian_api"),
    });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "ERP每日同步列表读取失败。" });
  }
});

app.get("/api/products/erp-sync-runs/:id", requirePermission("products.view"), (request, response) => {
  const syncRun = readErpSyncRun(request.params.id);
  if (!syncRun) {
    response.status(404).json({ success: false, message: "ERP每日同步批次不存在。" });
    return;
  }
  if (syncRun.dataSource === "wangdian_api" && !isAdminUser(request.user)) {
    response.status(403).json({ success: false, message: "仅管理员可以访问旺店通同步批次。" });
    return;
  }
  response.json({ success: true, syncRun });
});

app.post("/api/products/erp-sync-runs", requirePermission("products.import"), (request, response) => {
  try {
    if (String(request.body?.dataSource ?? "") === "wangdian_api" && !isAdminUser(request.user)) {
      response.status(403).json({ success: false, message: "仅管理员可以创建旺店通同步。" });
      return;
    }
    response.json({
      success: true,
      syncRun: createErpSyncRun({
        businessDate: request.body?.businessDate,
        syncType: request.body?.syncType,
        dataSource: request.body?.dataSource,
        createdBy: getUserPersonId(request.user),
      }),
    });
  } catch (error) {
    response.status(error.code === "ERP_SYNC_ACTIVE_EXISTS" ? 409 : 400).json({
      success: false,
      message: error.message || "ERP每日同步创建失败。",
      syncRun: error.syncRun ? readErpSyncRun(error.syncRun.id) : undefined,
    });
  }
});

app.get("/api/products/wangdian/status", requirePermission("products.view"), requireAdminUser, (request, response) => {
  response.json({ success: true, configured: hasWangdianConfig() });
});

app.get("/api/products/wangdian/sync-logs", requirePermission("products.view"), requireAdminUser, (request, response) => {
  response.json({ success: true, items: listWangdianGoodsSyncLogs(request.query.limit) });
});

app.get("/api/products/wangdian/suites/search", requirePermission("products.view"), requireAdminUser, async (request, response) => {
  try {
    response.json({ success: true, ...(await searchWangdianSuites(request.query)) });
  } catch (error) {
    const permissionRequired = /接口权限不足.*goods\.Suite\.search/iu.test(error.message ?? "");
    response.status(permissionRequired ? 403 : 400).json({
      success: false,
      code: permissionRequired ? "wangdian_suite_permission_required" : "wangdian_suite_search_failed",
      message: permissionRequired
        ? "旺店通API账号尚未开通组合装查询的品牌权限。"
        : error.message || "旺店通组合装读取失败。",
    });
  }
});

app.post("/api/data-sync-center/tasks/:id/wangdian-suites/sync", requirePermission("dataCenter.run"), requireAdminUser, async (request, response) => {
  try {
    const result = await syncWangdianSuites({
      taskId: request.params.id,
      syncMode: request.body?.syncMode,
      requestStart: request.body?.requestStart,
      requestEnd: request.body?.requestEnd,
      suiteNo: request.body?.suiteNo,
      createdBy: getUserPersonId(request.user),
    });
    response.status(201).json({ success: true, ...result });
    scheduleV3ShadowObservation({ type: "wangdian_suite_sync", objectId: result.dataSyncBatch?.id || request.params.id });
  } catch (error) {
    const permissionRequired = /接口权限不足.*goods\.Suite\.search/iu.test(error.message ?? "");
    response.status(permissionRequired ? 403 : 400).json({
      success: false,
      code: permissionRequired ? "wangdian_suite_permission_required" : "wangdian_suite_sync_failed",
      message: permissionRequired ? "旺店通API账号尚未开通组合装查询权限。" : error.message || "旺店通组合装同步失败。",
    });
  }
});

app.post("/api/products/erp-sync-runs/:id/wangdian/preview", requirePermission("products.import"), requireAdminUser, async (request, response) => {
  try {
    const result = await parseWangdianGoodsImport({
      syncRunId: request.params.id,
      query: request.body ?? {},
      importMode: request.body?.importMode,
      createdBy: getUserPersonId(request.user),
    });
    response.json({ success: true, ...result });
    scheduleV3ShadowObservation({ type: "wangdian_goods_sync", objectId: request.params.id });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "旺店通货品读取失败。" });
  }
});

app.post("/api/products/erp-sync-runs/:id/recalculate-status", requirePermission("products.import"), (request, response) => {
  try {
    const syncRun = recalculateErpSyncRun(request.params.id);
    response.json({ success: true, syncRun: readErpSyncRun(syncRun.id) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "ERP每日同步状态刷新失败。" });
  }
});

app.post("/api/products/erp-sync-runs/:id/generate-snapshot", requirePermission("products.import"), (request, response) => {
  response.status(410).json({ success: false, code: "legacy_snapshot_retired", message: "旧经营快照生成已停止；产品经营统一读取销售日报、Sales Object和库存事实。", migratedTo: "/api/product-management/business-dashboard" });
});

app.get("/api/products/erp-snapshots", requirePermission("products.view"), (request, response) => {
  try {
    response.json({
      success: true,
      snapshots: listErpFactSnapshots({
        businessDate: String(request.query.businessDate ?? "").trim(),
        currentOnly: String(request.query.currentOnly ?? "false") === "true",
      }),
    });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "ERP历史快照列表读取失败。" });
  }
});

app.get("/api/products/erp-snapshots/:id", requirePermission("products.view"), (request, response) => {
  const snapshot = readErpFactSnapshot(request.params.id, {
    includeDetails: String(request.query.includeDetails ?? "false") === "true",
  });
  if (!snapshot) {
    response.status(404).json({ success: false, message: "ERP历史快照不存在。" });
    return;
  }
  response.json({ success: true, snapshot });
});

app.get("/api/products/:id/snapshots", requirePermission("products.view"), (request, response) => {
  try {
    response.json({ success: true, productId: request.params.id, snapshots: listProductFactSnapshots(request.params.id) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "产品历史快照读取失败。" });
  }
});

app.get("/api/data-asset-map/overview", requirePermission("dataAssets.view"), (_request, response) => {
  const startedAt = performance.now();
  const payload = queryDataAssetMapOverview();
  response.set("Server-Timing", `data-asset-map;dur=${(performance.now() - startedAt).toFixed(1)}`);
  response.json(payload);
});

app.get("/api/data-asset-map/sources", requirePermission("dataAssets.view"), (request, response) => {
  response.json(queryDataAssetSources(request.query));
});

app.get("/api/data-asset-map/sources/:id", requirePermission("dataAssets.view"), (request, response) => {
  const payload = readDataAssetSource(request.params.id);
  if (!payload) return response.status(404).json({ message: "数据源不存在。" });
  response.json(payload);
});

app.get("/api/data-asset-map/objects", requirePermission("dataAssets.view"), (request, response) => {
  response.json(queryDataAssetObjects(request.query));
});

app.get("/api/data-asset-map/objects/:id", requirePermission("dataAssets.view"), (request, response) => {
  const payload = readDataAssetObject(request.params.id);
  if (!payload) return response.status(404).json({ message: "业务对象不存在。" });
  response.json(payload);
});

app.get("/api/data-asset-map/graphs/:id", requirePermission("dataAssets.view"), (request, response) => {
  const payload = readDataAssetRelationGraph(request.params.id);
  if (!payload) return response.status(404).json({ message: "关系地图不存在。" });
  response.json(payload);
});

app.get("/api/admin/api-usage", requirePermission("dataCenter.view"), requireAdminUser, (request, response) => {
  response.json({
    success: true,
    ...getApiUsageLedger(getDatabase(), {
      method: request.query.method,
      route: request.query.route,
      source: request.query.source,
      limit: request.query.limit,
    }),
  });
});

app.get("/api/data-sync-center", requirePermission("dataCenter.view"), requireAdminUser, (request, response) => {
  try {
    response.json({ success: true, ...getDataSyncCenterOverview(request.query ?? {}) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "数据同步中心读取失败。" });
  }
});

app.get("/api/data-sync-center/operating-erp-set", requirePermission("dataCenter.view"), requireAdminUser, (request, response) => {
  try {
    response.json({ success: true, ...queryOperatingErpSet(request.query ?? {}) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "经营ERP对象集合读取失败。" });
  }
});

app.get("/api/data-sync-center/operating-erp-set/summary", requirePermission("dataCenter.view"), requireAdminUser, (request, response) => {
  try {
    response.json({ success: true, ...readOperatingErpSetSummary() });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "经营ERP对象集合摘要读取失败。" });
  }
});

app.get("/api/product-center-v2/erp-operating-lifecycle", requirePermission("products.view"), (request, response) => {
  try { response.json({ success: true, ...queryErpOperatingLifecycle(request.query ?? {}) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "ERP经营生命周期读取失败。" }); }
});

app.get("/api/product-center-v2/erp-operating-lifecycle/summary", requirePermission("products.view"), (_request, response) => {
  try { response.json({ success: true, summary: readErpOperatingLifecycleSummary(), impact: simulateErpOperatingLifecycleViews(), syncPolicy: getErpLifecycleSyncPolicy() }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "ERP经营生命周期摘要读取失败。" }); }
});

app.get("/api/product-center-v2/non-operating-inventory", requirePermission("products.view"), (request, response) => {
  try { response.json({ success: true, ...listNonOperatingInventoryRisk(request.query ?? {}) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "非经营库存风险读取失败。" }); }
});

app.get("/api/product-center-v2/erp-usage-inventory-governance", requirePermission("products.view"), (request, response) => {
  try { response.json({ success: true, ...readErpSkuUsageInventoryGovernance(request.query ?? {}) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "ERP用途与库存治理读取失败。" }); }
});

app.get("/api/product-center-v2/erp-usage-unknown-governance", requirePermission("dataCenter.manage"), requireAdminUser, (request, response) => {
  try { response.json({ success: true, ...readUnknownErpUsageConvergence(request.query ?? {}) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "Unknown ERP用途治理读取失败。" }); }
});

app.post("/api/product-center-v2/erp-usage-profiles/:id/confirm", requirePermission("dataCenter.manage"), requireAdminUser, (request, response) => {
  try { response.json({ success: true, ...confirmErpSkuUsageProfile(request.params.id, request.body ?? {}, { confirmedBy: getUserPersonId(request.user) }) }); }
  catch (error) { response.status(/不存在/.test(error.message || "") ? 404 : /冲突/.test(error.message || "") ? 409 : 400).json({ success: false, message: error.message || "ERP用途确认失败。" }); }
});

app.get("/api/data-sync-center/operating-erp-identities", requirePermission("dataCenter.view"), requireAdminUser, (request, response) => {
  try {
    response.json({ success: true, ...queryOperatingErpIdentityShadow(request.query) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "经营ERP身份影子结果读取失败。" });
  }
});

app.get("/api/data-sync-center/v3-shadow", requirePermission("dataCenter.view"), requireAdminUser, (_request, response) => {
  try { response.json({ success: true, ...readV3ShadowSummary() }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "V3 Shadow摘要读取失败。" }); }
});

app.get("/api/data-sync-center/v3-shadow/differences", requirePermission("dataCenter.view"), requireAdminUser, (request, response) => {
  try { response.json({ success: true, ...listV3ShadowDifferences(request.query) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "V3 Shadow差异读取失败。" }); }
});

app.post("/api/data-sync-center/tasks/:id/status", requirePermission("dataCenter.manage"), requireAdminUser, (request, response) => {
  try {
    response.json({ success: true, task: setDataSyncTaskStatus(request.params.id, String(request.body?.status ?? "")) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "同步任务状态更新失败。" });
  }
});

app.post("/api/data-sync-center/tasks/:id/run", requirePermission("dataCenter.run"), requireAdminUser, (request, response) => {
  try {
    response.status(201).json({ success: true, batch: createManualDataSyncBatch(request.params.id, {
      syncMode: request.body?.syncMode,
      requestStart: request.body?.requestStart,
      requestEnd: request.body?.requestEnd,
      createdBy: getUserPersonId(request.user),
    }) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "手动同步批次创建失败。" });
  }
});

app.post("/api/data-sync-center/tasks/:id/erp-goods/preview", requirePermission("dataCenter.run"), requireAdminUser, async (request, response) => {
  try {
    const result = await previewErpGoodsDataSync({
      taskId: request.params.id,
      resumeBatchId: request.body?.resumeBatchId,
      syncMode: request.body?.syncMode,
      requestStart: request.body?.requestStart,
      requestEnd: request.body?.requestEnd,
      createdBy: getUserPersonId(request.user),
    });
    response.status(201).json({ success: true, ...result });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "ERP货品同步预览失败。" });
  }
});

app.post("/api/data-sync-center/batches/:id/erp-goods/commit", requirePermission("dataCenter.run"), requireAdminUser, (request, response) => {
  try {
    response.json({ success: true, ...commitErpGoodsDataSync(request.params.id) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "ERP货品同步提交失败。" });
  }
});

app.get("/api/data-sync-center/batches/:id/erp-goods/preview", requirePermission("dataCenter.view"), requireAdminUser, (request, response) => {
  try {
    response.json({ success: true, ...readErpGoodsDataSyncPreview(request.params.id) });
  } catch (error) {
    response.status(404).json({ success: false, message: error.message || "ERP货品同步预览读取失败。" });
  }
});

app.post("/api/data-sync-center/shop-mappings", requirePermission("dataCenter.manage"), requireAdminUser, (request, response) => {
  try {
    response.json({ success: true, mapping: saveWangdianShopMapping(request.body, getUserPersonId(request.user)) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "旺店通店铺映射保存失败。" });
  }
});

app.post("/api/data-sync-center/shop-mappings/discover", requirePermission("dataCenter.manage"), requireAdminUser, (request, response) => {
  try {
    const batch = createWangdianShopDiscoveryBatch({ startTime: request.body?.startTime, endTime: request.body?.endTime, shopId: request.body?.shopId, createdBy: getUserPersonId(request.user) });
    queueWangdianShopDiscoveryBatch(batch.id);
    response.status(202).json({ success: true, batch });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "旺店通店铺识别失败。" });
  }
});

app.get("/api/data-sync-center/shop-discovery-batches/:id", requirePermission("dataCenter.view"), requireAdminUser, (request, response) => {
  try {
    response.json({ success: true, batch: readWangdianShopDiscoveryBatch(request.params.id) });
  } catch (error) {
    response.status(404).json({ success: false, message: error.message || "店铺识别批次不存在。" });
  }
});

app.post("/api/data-sync-center/shop-discovery-batches/:id/resume", requirePermission("dataCenter.run"), requireAdminUser, (request, response) => {
  try {
    response.json({ success: true, batch: resumeWangdianShopDiscoveryBatch(request.params.id) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "店铺识别批次恢复失败。" });
  }
});

app.post("/api/data-sync-center/tasks/:id/platform-goods/preview", requirePermission("dataCenter.run"), requireAdminUser, async (request, response) => {
  try {
    const result = await previewPlatformGoodsDataSync({ taskId: request.params.id, resumeBatchId: request.body?.resumeBatchId, syncMode: request.body?.syncMode, requestStart: request.body?.requestStart, requestEnd: request.body?.requestEnd, scope: request.body?.scope, createdBy: getUserPersonId(request.user) });
    response.status(201).json({ success: true, ...result });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "平台SKU关系同步预览失败。" });
  }
});

app.get("/api/data-sync-center/batches/:id/platform-goods/preview", requirePermission("dataCenter.view"), requireAdminUser, (request, response) => {
  try {
    response.json({ success: true, ...readPlatformGoodsDataSyncPreview(request.params.id) });
  } catch (error) {
    response.status(404).json({ success: false, message: error.message || "平台SKU关系同步预览读取失败。" });
  }
});

app.post("/api/data-sync-center/batches/:id/platform-goods/commit", requirePermission("dataCenter.run"), requireAdminUser, (request, response) => {
  try {
    response.json({ success: true, ...commitPlatformGoodsDataSync(request.params.id) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "平台SKU关系同步提交失败。" });
  }
});

app.post("/api/data-sync-center/tasks/:id/inventory/preview", requirePermission("dataCenter.run"), requireAdminUser, async (request, response) => {
  try {
    const result = await previewInventoryDataSync({ taskId: request.params.id, resumeBatchId: request.body?.resumeBatchId, syncMode: request.body?.syncMode, requestStart: request.body?.requestStart, requestEnd: request.body?.requestEnd, businessDate: request.body?.businessDate, scope: request.body?.scope, createdBy: getUserPersonId(request.user) });
    response.status(201).json({ success: true, ...result });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "库存同步预览失败。" });
  }
});

app.get("/api/data-sync-center/batches/:id/inventory/preview", requirePermission("dataCenter.view"), requireAdminUser, (request, response) => {
  try {
    response.json({ success: true, ...readInventoryDataSyncPreview(request.params.id) });
  } catch (error) {
    response.status(404).json({ success: false, message: error.message || "库存同步预览读取失败。" });
  }
});

app.post("/api/data-sync-center/batches/:id/inventory/commit", requirePermission("dataCenter.run"), requireAdminUser, (request, response) => {
  try {
    response.json({ success: true, ...commitInventoryDataSync(request.params.id) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "库存同步提交失败。" });
  }
});

app.post("/api/data-sync-center/tasks/:id/sales-facts/preview", requirePermission("dataCenter.run"), requireAdminUser, (request, response) => {
  response.status(410).json({ success: false, code: "sales_import_entry_moved", message: "链接利润表上传已迁移至链接中心的数据更新页面。" });
});

app.get("/api/data-sync-center/batches/:id/sales-facts/preview", requirePermission("dataCenter.view"), requireAdminUser, (request, response) => {
  try { response.json({ success: true, ...readSalesFactDataSyncPreview(request.params.id) }); }
  catch (error) { response.status(404).json({ success: false, message: error.message || "真实销售导入预览读取失败。" }); }
});

app.post("/api/data-sync-center/batches/:id/sales-facts/commit", requirePermission("dataCenter.run"), requireAdminUser, (request, response) => {
  response.status(410).json({ success: false, code: "sales_import_entry_moved", message: "链接利润表确认已迁移至链接中心的数据更新页面。" });
});

app.post("/api/data-sync-center/tasks/:id/platform-goods-excel/preview", requirePermission("dataCenter.run"), requireAdminUser, (request, response) => {
  uploadConnectionWorkbook.single("file")(request, response, (error) => {
    if (error) { response.status(400).json({ success: false, message: error.message || "平台货品Excel上传失败。" }); return; }
    try {
      const result = previewPlatformGoodsExcelDataSync({
        taskId: request.params.id,
        buffer: request.file?.buffer,
        fileName: normalizeUploadedFileName(request.file?.originalname),
        createdBy: getUserPersonId(request.user),
      });
      response.status(result.idempotent ? 200 : 201).json({ success: true, ...result });
    } catch (uploadError) { response.status(400).json({ success: false, message: uploadError.message || "平台货品资产差异分析失败。" }); }
  });
});

app.get("/api/data-sync-center/batches/:id/platform-goods-excel/preview", requirePermission("dataCenter.view"), requireAdminUser, (request, response) => {
  try { response.json({ success: true, ...readPlatformGoodsExcelDataSyncPreview(request.params.id) }); }
  catch (error) { response.status(404).json({ success: false, message: error.message || "平台货品资产预览读取失败。" }); }
});

app.post("/api/data-sync-center/batches/:id/platform-goods-excel/reanalyze", requirePermission("dataCenter.run"), requireAdminUser, (request, response) => {
  try { response.status(201).json({ success: true, ...reanalyzePlatformGoodsExcelDataSync(request.params.id, { createdBy: getUserPersonId(request.user) }) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "平台货品资产重新分析失败。" }); }
});

app.post("/api/data-sync-center/batches/:id/platform-goods-excel/commit", requirePermission("dataCenter.run"), requireAdminUser, (request, response) => {
  try {
    const result = commitPlatformGoodsExcelDataSync(request.params.id);
    response.json({ success: true, ...result });
    scheduleV3ShadowObservation({ type: result.idempotent ? "platform_goods_repeat" : "platform_goods_import", objectId: request.params.id, batchId: request.params.id });
  }
  catch (error) { response.status(400).json({ success: false, message: error.message || "平台货品资产同步失败。" }); }
});

app.post("/api/data-sync-center/exceptions/:id/resolve", requirePermission("dataCenter.manage"), requireAdminUser, (request, response) => {
  try {
    response.json({ success: true, exception: resolveDataSyncException(request.params.id, { note: request.body?.note, resolvedBy: getUserPersonId(request.user) }) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "同步异常处理失败。" });
  }
});

app.get("/api/operation-dashboard", requirePermission("cockpit.view"), (_request, response) => {
  try {
    response.json({ success: true, dashboard: getOperationDashboard() });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "经营驾驶舱读取失败。" });
  }
});

app.get("/api/sales-business-dashboard", requirePermission("cockpit.view"), (request, response) => {
  try { response.json({ success: true, dashboard: getSalesBusinessDashboard(request.query) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "销售经营驾驶舱读取失败。" }); }
});

app.get("/api/business-anomalies", requirePermission("cockpit.view"), (request, response) => {
  try { response.json({ success: true, anomalies: queryBusinessAnomalies(request.query) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "经营异常读取失败。" }); }
});

app.get("/api/business-improvement-result/:keyActionId", requirePermission("keyActions.view"), (request, response) => {
  try { response.json({ success: true, result: queryBusinessImprovementResult({ keyActionId: request.params.keyActionId }) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "经营改善结果读取失败。" }); }
});

app.get("/api/finance/statement", requirePermission("finance.view"), (request, response) => {
  try { response.json({ success: true, statement: getFinanceStatement(request.query) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "利润表读取失败。" }); }
});

app.get("/api/finance/analysis", requirePermission("finance.view"), (request, response) => {
  try { response.json({ success: true, analysis: getFinanceAnalysis(request.query) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "财务分析读取失败。" }); }
});

app.get("/api/finance/entries", requirePermission("finance.view"), (request, response) => {
  try { response.json({ success: true, items: listFinanceEntries(request.query) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "财务记录读取失败。" }); }
});

app.post("/api/finance/entries/:id/approve", requirePermission("finance.approve"), (request, response) => {
  try { approveFinanceEntry(request.params.id, request.user.id); response.json({ success: true }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "财务记录审核失败。" }); }
});

app.get("/api/finance/import-batches", requirePermission("finance.view"), (_request, response) => {
  try { response.json({ success: true, items: listFinanceImportBatches() }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "账单批次读取失败。" }); }
});

app.post("/api/finance/import-batches", requirePermission("finance.maintain"), uploadFinanceWorkbook.single("file"), (request, response) => {
  try { response.status(201).json({ success: true, batch: createFinanceImportBatch(request.file, request.user.id) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "账单解析失败。" }); }
});

app.get("/api/finance/import-batches/:id", requirePermission("finance.view"), (request, response) => {
  try { response.json({ success: true, batch: readFinanceImportBatch(request.params.id) }); }
  catch (error) { response.status(404).json({ success: false, message: error.message || "账单批次不存在。" }); }
});

app.post("/api/finance/import-batches/:id/commit", requirePermission("finance.maintain"), (request, response) => {
  try { response.json({ success: true, ...commitFinanceImportBatch(request.params.id, request.body, request.user.id) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "账单确认失败。" }); }
});

app.get("/api/finance/rules", requirePermission("finance.view"), (_request, response) => {
  try { response.json({ success: true, items: listFinanceRules() }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "财务规则读取失败。" }); }
});

app.post("/api/finance/rules", requirePermission("finance.configureRules"), (request, response) => {
  try { response.status(201).json({ success: true, item: saveFinanceRule(request.body, request.user.id) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "财务规则保存失败。" }); }
});

app.put("/api/finance/rules/:id", requirePermission("finance.configureRules"), (request, response) => {
  try { response.json({ success: true, item: saveFinanceRule(request.body, request.user.id, request.params.id) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "财务规则更新失败。" }); }
});

app.delete("/api/finance/rules/:id", requirePermission("finance.configureRules"), (request, response) => {
  try { removeFinanceRule(request.params.id); response.json({ success: true }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "财务规则删除失败。" }); }
});

app.get("/api/product-management/overview", requirePermission("products.view"), (request, response) => {
  try {
    response.set("Deprecation", "true").set("Link", "</api/product-management/business-dashboard>; rel=successor-version");
    const scoped = filterDataByScope(readAllData({ exclude: ["salesLinks", "salesLinkSkus"] }), request.user);
    response.json({ success: true, overview: getProductV2Overview(), lifecycleStatuses: productLifecycleStatuses,
      moduleData: { products: scoped.products ?? [], actionProducts: scoped.actionProducts ?? [], erpGoods: scoped.erpGoods ?? [],
        productErpMappings: scoped.productErpMappings ?? [], salesShops: scoped.salesShops ?? [], salesShopAliases: scoped.salesShopAliases ?? [],
        productImportBatches: scoped.productImportBatches ?? [], erpImportBatches: scoped.erpImportBatches ?? [] } });
  }
  catch (error) { response.status(400).json({ success: false, message: error.message || "产品经营概览读取失败。" }); }
});

app.get("/api/product-center-v2/skus", requirePermission("skus.view"), (request, response) => {
  try {
    const startedAt = performance.now();
    const result = listProductCenterV2Skus(request.query);
    const queriedAt = performance.now();
    const text = JSON.stringify({ success: true, ...result });
    response.set("Server-Timing", `product-list;dur=${(queriedAt - startedAt).toFixed(1)}, serialize;dur=${(performance.now() - queriedAt).toFixed(1)}`);
    response.type("application/json").send(text);
  }
  catch (error) { response.status(400).json({ success: false, message: error.message || "ERP SKU列表读取失败。" }); }
});

app.get("/api/product-center-v2/metadata", requirePermission("products.view"), (request, response) => {
  try { response.json({ success: true, ...getProductCenterV2Metadata() }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "ERP SKU筛选摘要读取失败。" }); }
});

app.get("/api/key-actions/product-options", requirePermission("keyActions.view"), (request, response) => {
  try { response.json({ success: true, ...listActionProductOptions(request.query) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "ERP SKU关联选项读取失败。" }); }
});

app.get("/api/product-center-v2/combo-skus", requirePermission("combos.view"), (request, response) => {
  try { response.json({ success: true, ...listSalesObjectComboSkus(request.query) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "组合SKU列表读取失败。" }); }
});

app.get("/api/product-center-v2/combo-skus/:id", requirePermission("combos.view"), (request, response) => {
  try { response.json({ success: true, detail: getSalesObjectComboSkuDetail(request.params.id) }); }
  catch (error) { response.status(error.code === "sales_object_bundle_not_found" ? 404 : 400).json({ success: false, message: error.message || "组合SKU详情读取失败。" }); }
});

app.get("/api/product-center-v2/skus/:id", requirePermission("skus.view"), (request, response) => {
  try { response.json({ success: true, detail: getProductCenterV2SkuDetail(request.params.id, { scope: request.query.scope }) }); }
  catch (error) { response.status(404).json({ success: false, message: error.message || "ERP SKU详情读取失败。" }); }
});

app.get("/api/product-center-v2/skus/:id/business-profile", requirePermission("products.view"), (request, response) => {
  try { response.json({ success: true, ...getProductBusinessProfile(request.params.id) }); }
  catch (error) { response.status(404).json({ success: false, message: error.message || "产品经营资料读取失败。" }); }
});

app.put("/api/product-center-v2/skus/:id/business-profile", requirePermission("products.manage"), (request, response) => {
  try { response.json({ success: true, ...upsertProductBusinessProfile(request.params.id, request.body, getUserPersonId(request.user)) }); }
  catch (error) { response.status(error.statusCode || 400).json({ success: false, message: error.message || "产品经营资料保存失败。" }); }
});

app.get("/api/product-center-v2/business-extension-migration-report", requirePermission("products.view"), (_request, response) => {
  try { response.json({ success: true, report: getProductBusinessMigrationReport() }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "经营扩展迁移报告读取失败。" }); }
});

app.post("/api/product-center-v2/skus/:id/product-profile", requirePermission("skus.manage"), (request, response) => {
  try { response.status(201).json({ success: true, ...createProductProfileForErpSku(request.params.id) }); }
  catch (error) {
    const message = error.message || "产品档案创建失败。";
    response.status(message.includes("已存在") || message.includes("占用") ? 409 : 400).json({ success: false, message });
  }
});

app.get("/api/product-management/business-dashboard", requirePermission("products.view"), (request, response) => {
  try {
    const readModel = getProductBusinessReadModel(request.query, {
      includeInventoryCost: hasPermission(request.user, "finance.view"),
      bypassCache: ["1", "true"].includes(String(request.query.refresh || "").toLowerCase()),
    });
    response.json({
      success: true,
      readModel: attachProductDiagnosisSummaries(readModel),
    });
  }
  catch (error) { response.status(error.statusCode || 400).json({ success: false, message: error.message || "产品经营看板读取失败。" }); }
});

app.get("/api/product-management/sales-distribution", requirePermission("products.view"), (request, response) => {
  try {
    response.json({
      success: true,
      ...getProductSalesDistribution(request.query, { bypassCache: ["1", "true"].includes(String(request.query.refresh || "").toLowerCase()) }),
    });
  } catch (error) {
    response.status(error.statusCode || 400).json({ success: false, message: error.message || "产品销售结构读取失败。" });
  }
});

app.get("/api/product-management/shop-sandbox", requirePermission("products.view"), (request, response) => {
  try {
    response.json({
      success: true,
      ...getProductShopSandbox(request.query, { bypassCache: ["1", "true"].includes(String(request.query.refresh || "").toLowerCase()) }),
    });
  } catch (error) {
    response.status(error.statusCode || 400).json({ success: false, message: error.message || "产品沙盘读取失败。" });
  }
});

app.get("/api/product-management/clearance-plans", requirePermission("products.view"), (request, response) => {
  try {
    response.json({ success: true, center: getProductClearancePlanCenter(request.query) });
  } catch (error) { response.status(error.statusCode || 400).json({ success: false, message: error.message || "清仓计划读取失败。" }); }
});

app.get("/api/product-management/new-product-actions", requirePermission("products.view"), (request, response) => {
  try {
    const snapshot = {
      processInstances: readResource("processInstances"),
      workPlans: readResource("workPlans"),
      tasks: readResource("tasks"),
      taskTemplates: readResource("taskTemplates"),
      processTemplates: readResource("processTemplates"),
      people: readResource("people"),
      goals: readResource("goals"),
      products: readResource("products"),
      actionProducts: readResource("actionProducts"),
    };
    const scoped = filterDataByScope(snapshot, request.user);
    const productOptions = resolveActionProductOptions(scoped.actionProducts ?? []);
    response.json({ success: true, center: getProductNewDevelopmentCenter({ ...scoped, productOptions }) });
  } catch (error) {
    response.status(error.statusCode || 400).json({ success: false, message: error.message || "新品开发行动读取失败。" });
  }
});

app.post("/api/product-management/products/:id/clearance-plan", requirePermission("products.manage"), (request, response) => {
  try { requireScopedProduct(request, request.params.id); response.status(201).json({ success: true, plan: saveProductClearancePlan(request.params.id, request.body, getUserPersonId(request.user)) }); }
  catch (error) { response.status(error.statusCode || 400).json({ success: false, message: error.message || "清仓计划保存失败。" }); }
});

app.put("/api/product-management/clearance-plans/:id", requirePermission("products.manage"), (request, response) => {
  try {
    const plan = getDatabase().prepare("SELECT productId,erpSkuId FROM product_clearance_plans WHERE id=?").get(request.params.id);
    if (!plan) throw new Error("清仓计划不存在。");
    requireScopedProduct(request, plan.erpSkuId || plan.productId);
    response.json({ success: true, plan: updateProductClearancePlan(request.params.id, request.body) });
  } catch (error) { response.status(error.statusCode || 400).json({ success: false, message: error.message || "清仓计划更新失败。" }); }
});

app.get("/api/product-management/products/:id", requirePermission("products.view"), (request, response) => {
  try { response.json({ success: true, detail: getProductV2Detail(request.params.id,{includeInventoryCost:hasPermission(request.user,"finance.view")}), lifecycleStatuses: productLifecycleStatuses }); }
  catch (error) { response.status(404).json({ success: false, message: error.message || "产品经营详情读取失败。" }); }
});

app.get("/api/product-management/products/:id/daily-sales", requirePermission("products.view"), (request, response) => {
  try { response.json({ success: true, ...getProductDailySalesPerformance({ productId: request.params.id, startDate: request.query.startDate, endDate: request.query.endDate }) }); }
  catch (error) { response.status(/不存在/.test(error.message || "") ? 404 : 400).json({ success: false, message: error.message || "产品销售日报读取失败。" }); }
});

app.get("/api/product-management/products/:id/marketing-asset", requirePermission("products.view"), (request, response) => {
  try { response.json({ success: true, ...getProductMarketingAsset(request.params.id) }); }
  catch (error) { response.status(404).json({ success: false, message: error.message || "产品营销资产读取失败。" }); }
});

app.put("/api/product-management/products/:id/marketing-asset", requirePermission("products.manage"), (request, response) => {
  try { response.json({ success: true, asset: saveProductMarketingAsset(request.params.id, request.body, request.user.id) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "产品营销资产保存失败。" }); }
});

app.get("/api/product-management/products/:id/marketing-asset/export", requirePermission("products.view"), (request, response) => {
  try { response.json({ success: true, export: exportProductMarketingAsset(request.params.id) }); }
  catch (error) { response.status(404).json({ success: false, message: error.message || "AI资料导出失败。" }); }
});

app.get("/api/product-management/products/:id/health-analysis", requirePermission("products.view"), (request, response) => {
  try {
    response.json({ success: true, analysis: getProductHealthAnalysis(request.params.id, {
      includeInventoryCost: hasPermission(request.user, "finance.view"),
    }) });
  }
  catch (error) { response.status(error.statusCode || 400).json({ success: false, message: error.message || "产品健康分析读取失败。" }); }
});

app.get("/api/product-management/products/:id/business-diagnosis", requirePermission("products.view"), (request, response) => {
  try {
    response.json({ success: true, diagnosis: getProductBusinessDiagnosis(request.params.id, {
      includeInventoryCost: hasPermission(request.user, "finance.view"),
    }) });
  } catch (error) { response.status(error.statusCode || 400).json({ success: false, message: error.message || "产品经营诊断读取失败。" }); }
});

app.get("/api/product-management/products/:id/improvement-center", requirePermission("products.view"), (request, response) => {
  try {
    const options = { includeInventoryCost: false };
    const healthAnalysis = getProductHealthAnalysis(request.params.id, options);
    response.json({ success: true, center: getProductImprovementCenter(request.params.id, healthAnalysis) });
  }
  catch (error) { response.status(error.statusCode || 400).json({ success: false, message: error.message || "产品经营改善读取失败。" }); }
});

app.post("/api/product-management/products/:id/lifecycle", requirePermission("products.archive"), (request, response) => {
  try { response.json({ success: true, event: changeProductLifecycle(request.params.id, request.body, request.user.id) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "产品生命周期更新失败。" }); }
});

app.post("/api/product-management/products/:id/evaluate", requirePermission("products.manage"), (request, response) => {
  try { response.json({ success: true, healthRecord: evaluateProductHealth(request.params.id,{includeInventoryCost:false}) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "产品经营评价失败。" }); }
});

app.post("/api/product-management/products/:id/health-action", requirePermission("products.manage"), (request, response) => {
  try {
    const analysis = getProductHealthAnalysis(request.params.id, { includeInventoryCost: false });
    if (!analysis.recommendations.some((item) => item.code === String(request.body?.recommendationCode ?? "").trim())) throw new Error("该改善建议已不适用，请刷新健康分析。");
    response.status(201).json({ success: true, ...createProductHealthAction(request.params.id, request.body, request.user.id, analysis) });
  }
  catch (error) { response.status(400).json({ success: false, message: error.message || "产品健康改善行动创建失败。" }); }
});

app.post("/api/product-management/issues/:id/improvement-action", requirePermission("products.manage"), (request, response) => {
  try { response.status(201).json({ success: true, ...createProductImprovementAction(request.params.id, request.body, request.user.id) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "产品改善行动创建失败。" }); }
});

app.put("/api/product-management/improvements/:id/result", requirePermission("products.manage"), (request, response) => {
  try {
    response.json({ success: true, improvement: recordProductImprovementResult(request.params.id, request.body) });
  }
  catch (error) { response.status(error.statusCode || 400).json({ success: false, message: error.message || "产品改善结果保存失败。" }); }
});

function requireScopedProduct(request, productId) {
  const scoped = filterDataByScope(readAllData({ exclude: ["salesLinks", "salesLinkSkus"] }), request.user);
  const identity = resolveProductBusinessIdentity(productId);
  if (identity.legacyProductId && !(scoped.products ?? []).some((product) => product.id === identity.legacyProductId)) { const error = new Error("无权操作该产品。"); error.statusCode = 403; throw error; }
  return { ...scoped, productIdentity: identity };
}

app.get("/api/product-management/products/:id/user-insights", requirePermission("products.view"), (request, response) => {
  try {
    requireScopedProduct(request, request.params.id);
    response.json({ success: true, center: getProductInsightCenter(request.params.id) });
  } catch (error) { response.status(error.statusCode || 400).json({ success: false, message: error.message || "用户洞察读取失败。" }); }
});

app.post("/api/product-management/products/:id/user-insights", requirePermission("products.manage"), (request, response) => {
  try { requireScopedProduct(request, request.params.id); response.status(201).json({ success: true, items: importProductInsights(request.params.id, request.body?.items ?? request.body, request.user.id) }); }
  catch (error) { response.status(error.statusCode || 400).json({ success: false, message: error.message || "用户洞察保存失败。" }); }
});

app.put("/api/product-management/products/:id/user-insights/:insightId", requirePermission("products.manage"), (request, response) => {
  try { requireScopedProduct(request, request.params.id); response.json({ success: true, item: updateProductInsight(request.params.id, request.params.insightId, request.body, request.user.id) }); }
  catch (error) { response.status(error.statusCode || 400).json({ success: false, message: error.message || "用户洞察更新失败。" }); }
});

app.get("/api/product-management/products/:id/strategy", requirePermission("products.view"), (request, response) => {
  try {
    requireScopedProduct(request, request.params.id);
    response.json({ success: true, strategy: getProductStrategy(request.params.id) });
  } catch (error) { response.status(error.statusCode || 400).json({ success: false, message: error.message || "产品战略读取失败。" }); }
});

app.put("/api/product-management/products/:id/strategy/:section", requirePermission("products.manage"), (request, response) => {
  try { requireScopedProduct(request, request.params.id); response.json({ success: true, current: saveProductStrategySection(request.params.id, request.params.section, request.body, request.user.id) }); }
  catch (error) { response.status(error.statusCode || 400).json({ success: false, message: error.message || "产品战略保存失败。" }); }
});

app.post("/api/product-management/products/:id/strategy/next-steps", requirePermission("products.manage"), (request, response) => {
  try { requireScopedProduct(request, request.params.id); response.status(201).json({ success: true, current: addProductStrategyStep(request.params.id, request.body, request.user.id) }); }
  catch (error) { response.status(error.statusCode || 400).json({ success: false, message: error.message || "下一步策略新增失败。" }); }
});

app.put("/api/product-management/products/:id/strategy/next-steps/:itemId", requirePermission("products.manage"), (request, response) => {
  try { requireScopedProduct(request, request.params.id); response.json({ success: true, current: updateProductStrategyStep(request.params.id, request.params.itemId, request.body, request.user.id) }); }
  catch (error) { response.status(error.statusCode || 400).json({ success: false, message: error.message || "下一步策略更新失败。" }); }
});

app.post("/api/product-management/products/:id/strategy/next-steps/:itemId/action", requirePermission("products.manage"), (request, response) => {
  try { requireScopedProduct(request, request.params.id); response.status(201).json({ success: true, ...createProductStrategyAction(request.params.id, request.params.itemId, request.body, request.user.id) }); }
  catch (error) { response.status(error.statusCode || 400).json({ success: false, message: error.message || "战略关键行动创建失败。" }); }
});

app.get("/api/connections", requireLinkView, (request, response) => {
  try {
    const startedAt = performance.now();
    const page = listConnectionCoreProfilesPage(request.query, getUserPersonId(request.user), isAdminUser(request.user));
    response.set("Server-Timing", `connection-list;dur=${(performance.now() - startedAt).toFixed(1)}`);
    response.json({ success: true, ...page });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "连接列表读取失败。" });
  }
});

app.get("/api/connection-assets", requireLinkView, (request, response) => {
  try {
    const startedAt = performance.now();
    const page = listConnectionCoreProfilesPage(request.query, getUserPersonId(request.user), isAdminUser(request.user));
    response.set("Server-Timing", `connection-list;dur=${(performance.now() - startedAt).toFixed(1)}`);
    response.json({ success: true, ...page });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "链接资产读取失败。" });
  }
});

app.post("/api/connection-assets/owner-imports/preview", requireLinkManage, (request, response) => {
  uploadConnectionWorkbook.single("file")(request, response, (error) => {
    if (error) { response.status(400).json({ success: false, message: error.message || "负责人匹配文件上传失败。" }); return; }
    try {
      const result = previewConnectionOwnerImport({
        buffer: request.file?.buffer,
        fileName: normalizeUploadedFileName(request.file?.originalname),
        userId: getUserPersonId(request.user),
        ownerId: request.body?.ownerId,
      });
      response.status(result.idempotent ? 200 : 201).json({ success: true, ...result });
    } catch (uploadError) {
      response.status(400).json({ success: false, message: uploadError.message || "负责人匹配预览失败。" });
    }
  });
});

app.get("/api/connection-assets/owner-imports/current", requireLinkManage, (request, response) => {
  try { response.json({ success: true, result: getCurrentConnectionOwnerImport(getUserPersonId(request.user)) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "负责人匹配预览读取失败。" }); }
});

app.get("/api/connection-assets/owner-imports/:id/changes", requireLinkManage, (request, response) => {
  try { response.json({ success: true, ...listConnectionOwnerImportRows(request.params.id, getUserPersonId(request.user), { ...request.query, kind: "changes" }) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "负责人变更明细读取失败。" }); }
});

app.get("/api/connection-assets/owner-imports/:id/errors", requireLinkManage, (request, response) => {
  try { response.json({ success: true, ...listConnectionOwnerImportRows(request.params.id, getUserPersonId(request.user), { ...request.query, kind: "errors" }) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "负责人异常明细读取失败。" }); }
});

app.post("/api/connection-assets/owner-imports/:id/confirm", requireLinkManage, (request, response) => {
  try { response.json({ success: true, ...confirmConnectionOwnerImport(request.params.id, getUserPersonId(request.user), { confirmOverwrite: request.body?.confirmOverwrite === true }) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "负责人批量更新失败。" }); }
});

app.post("/api/connection-assets/owner-imports/:id/rebuild-preview", requireLinkManage, (request, response) => {
  try { response.json({ success: true, ...rebuildConnectionOwnerImportPreview(request.params.id, getUserPersonId(request.user)) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "负责人匹配预览重新校验失败。" }); }
});

app.post("/api/connection-assets/owner-imports/:id/cancel", requireLinkManage, (request, response) => {
  try { response.json({ success: true, ...cancelConnectionOwnerImport(request.params.id, getUserPersonId(request.user)) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "负责人匹配预览取消失败。" }); }
});

app.get("/api/connections/:id/core-detail", requireLinkView, requireConnectionAccess, (request, response) => {
  try { response.json({ success: true, ...getConnectionCoreDetail(request.params.id, getUserPersonId(request.user), isAdminUser(request.user)) }); }
  catch (error) { response.status(error.message?.includes("只能查看") ? 403 : 404).json({ success: false, message: error.message || "链接经营详情读取失败。" }); }
});

app.get("/api/connections/:id/business-positioning", requireLinkView, requireConnectionAccess, (request, response) => {
  try {
    response.json({ success: true, ...readConnectionGoalFoundation(request.params.id, {
      userId: getUserPersonId(request.user),
      isAdmin: isAdminUser(request.user),
    }) });
  } catch (error) {
    response.status(error.statusCode || 400).json({ success: false, message: error.message || "链接经营定位读取失败。" });
  }
});

app.put("/api/connections/:id/business-positioning", requireLinkManage, requireConnectionAccess, (request, response) => {
  try {
    response.json({ success: true, ...setConnectionBusinessPositioning(request.params.id, request.body, {
      userId: getUserPersonId(request.user),
      isAdmin: isAdminUser(request.user),
    }) });
  } catch (error) {
    response.status(error.statusCode || (/不存在/.test(error.message || "") ? 404 : 400))
      .json({ success: false, message: error.message || "链接经营定位修改失败。" });
  }
});

app.get("/api/connections/:id/business-goals", requireLinkView, requireConnectionAccess, (request, response) => {
  try {
    response.json({ success: true, ...readConnectionGoalPlans(request.params.id, {
      userId: getUserPersonId(request.user),
      isAdmin: isAdminUser(request.user),
    }) });
  } catch (error) {
    response.status(error.statusCode || 400).json({ success: false, message: error.message || "链接经营目标读取失败。" });
  }
});

app.post("/api/connections/:id/business-goals/suggest", requireLinkManage, requireConnectionAccess, (request, response) => {
  try {
    response.json({ success: true, ...createConnectionGoalSuggestion(request.params.id, {
      userId: getUserPersonId(request.user),
      isAdmin: isAdminUser(request.user),
    }) });
  } catch (error) {
    response.status(error.statusCode || 400).json({ success: false, message: error.message || "经营目标建议生成失败。" });
  }
});

app.post("/api/connections/:id/business-goals/:planId/confirm", requireLinkManage, requireConnectionAccess, (request, response) => {
  try {
    response.json({ success: true, ...confirmConnectionGoalPlan(request.params.id, request.params.planId, request.body, {
      userId: getUserPersonId(request.user),
      isAdmin: isAdminUser(request.user),
    }) });
  } catch (error) {
    response.status(error.statusCode || 400).json({ success: false, message: error.message || "经营目标确认失败。" });
  }
});

app.get("/api/connections/:id/business-goal-evaluation", requireLinkView, requireConnectionAccess, (request, response) => {
  try {
    response.json({ success: true, ...readConnectionGoalEvaluation(request.params.id) });
  } catch (error) {
    response.status(error.statusCode || 400).json({ success: false, message: error.message || "经营目标评价读取失败。" });
  }
});

app.post("/api/connections/:id/business-goal-evaluation/refresh", requireLinkRating, requireConnectionAccess, (request, response) => {
  try {
    response.json({ success: true, ...evaluateConnectionGoal(request.params.id) });
  } catch (error) {
    response.status(error.statusCode || 400).json({ success: false, message: error.message || "经营目标评价刷新失败。" });
  }
});

app.get("/api/connection-goal-workbench", requireLinkView, (request, response) => {
  try {
    response.json({ success: true, ...readConnectionGoalWorkbench(request.query, {
      userId: getUserPersonId(request.user), isAdmin: isAdminUser(request.user),
    }) });
  } catch (error) {
    response.status(error.statusCode || 400).json({ success: false, message: error.message || "链接经营管理工作台读取失败。" });
  }
});

app.get("/api/connection-goal-health-summary", requireLinkView, (request, response) => {
  try {
    response.json({ success: true, ...readConnectionGoalCockpitSummary(request.query, {
      userId: getUserPersonId(request.user), isAdmin: isAdminUser(request.user),
    }) });
  } catch (error) {
    response.status(error.statusCode || 400).json({ success: false, message: error.message || "链接评级概览读取失败。" });
  }
});

app.post("/api/connection-goal-workbench/positioning", requireLinkManage, (request, response) => {
  try {
    response.json({ success: true, ...batchSetConnectionPositioning(request.body, {
      userId: getUserPersonId(request.user), isAdmin: isAdminUser(request.user),
    }) });
  } catch (error) {
    response.status(error.statusCode || 400).json({ success: false, message: error.message || "批量设置定位失败。" });
  }
});

app.post("/api/connection-goal-workbench/suggestions", requireLinkManage, (request, response) => {
  try {
    response.json({ success: true, ...batchGenerateConnectionGoalSuggestions(request.body, {
      userId: getUserPersonId(request.user), isAdmin: isAdminUser(request.user),
    }) });
  } catch (error) {
    response.status(error.statusCode || 400).json({ success: false, message: error.message || "批量生成目标建议失败。" });
  }
});

app.post("/api/connection-goal-workbench/confirm", requireLinkManage, (request, response) => {
  try {
    response.json({ success: true, ...batchConfirmConnectionGoals(request.body, {
      userId: getUserPersonId(request.user), isAdmin: isAdminUser(request.user),
    }) });
  } catch (error) {
    response.status(error.statusCode || 400).json({ success: false, message: error.message || "批量确认目标失败。" });
  }
});

app.get("/api/connection-goal-pilots", requireLinkView, (request, response) => {
  try { response.json({ success: true, ...readConnectionGoalPilotBatches(request.query, {
    userId: getUserPersonId(request.user), isAdmin: isAdminUser(request.user),
  }) }); }
  catch (error) { response.status(error.statusCode || 400).json({ success: false, message: error.message || "经营试点批次读取失败。" }); }
});

app.post("/api/connection-goal-pilots", requireLinkManage, (request, response) => {
  try { response.json({ success: true, ...createConnectionGoalPilotBatch(request.body, {
    userId: getUserPersonId(request.user), isAdmin: isAdminUser(request.user),
  }) }); }
  catch (error) { response.status(error.statusCode || 400).json({ success: false, message: error.message || "经营试点批次创建失败。" }); }
});

app.patch("/api/connection-goal-pilots/:batchId", requireLinkManage, (request, response) => {
  try { response.json({ success: true, ...updateConnectionGoalPilotBatch(request.params.batchId, request.body, {
    userId: getUserPersonId(request.user), isAdmin: isAdminUser(request.user),
  }) }); }
  catch (error) { response.status(error.statusCode || 400).json({ success: false, message: error.message || "经营试点批次推进失败。" }); }
});

app.get("/api/connection-goal-pilots/:batchId/candidates", requireLinkView, (request, response) => {
  try { response.json({ success: true, ...readConnectionGoalPilotCandidates({ ...request.query, batchId: request.params.batchId }, {
    userId: getUserPersonId(request.user), isAdmin: isAdminUser(request.user),
  }) }); }
  catch (error) { response.status(error.statusCode || 400).json({ success: false, message: error.message || "试点候选链接读取失败。" }); }
});

app.post("/api/connection-goal-pilots/:batchId/links", requireLinkManage, (request, response) => {
  try { response.json({ success: true, ...addConnectionGoalPilotLinks(request.params.batchId, request.body, {
    userId: getUserPersonId(request.user), isAdmin: isAdminUser(request.user),
  }) }); }
  catch (error) { response.status(error.statusCode || 400).json({ success: false, message: error.message || "试点候选链接加入失败。" }); }
});

app.get("/api/connection-goal-pilots/:batchId/links", requireLinkView, (request, response) => {
  try { response.json({ success: true, ...readConnectionGoalPilotMembers(request.params.batchId, request.query, {
    userId: getUserPersonId(request.user), isAdmin: isAdminUser(request.user),
  }) }); }
  catch (error) { response.status(error.statusCode || 400).json({ success: false, message: error.message || "试点链接读取失败。" }); }
});

app.patch("/api/connection-goal-pilots/:batchId/links/:memberId", requireLinkManage, (request, response) => {
  try { response.json({ success: true, ...updateConnectionGoalPilotMember(request.params.batchId, request.params.memberId, request.body, {
    userId: getUserPersonId(request.user), isAdmin: isAdminUser(request.user),
  }) }); }
  catch (error) { response.status(error.statusCode || 400).json({ success: false, message: error.message || "试点链接状态修改失败。" }); }
});

app.post("/api/connection-goal-pilots/:batchId/links/:memberId/positioning", requireLinkManage, (request, response) => {
  try { response.json({ success: true, ...confirmConnectionGoalPilotPositioning(request.params.batchId, request.params.memberId, request.body, {
    userId: getUserPersonId(request.user), isAdmin: isAdminUser(request.user),
  }) }); }
  catch (error) { response.status(error.statusCode || 400).json({ success: false, message: error.message || "试点链接定位确认失败。" }); }
});

app.post("/api/connection-goal-pilots/:batchId/links/:memberId/suggestion", requireLinkManage, (request, response) => {
  try { response.json({ success: true, ...createConnectionGoalPilotSuggestion(request.params.batchId, request.params.memberId, {
    userId: getUserPersonId(request.user), isAdmin: isAdminUser(request.user),
  }) }); }
  catch (error) { response.status(error.statusCode || 400).json({ success: false, message: error.message || "试点目标建议生成失败。" }); }
});

app.post("/api/connection-goal-pilots/:batchId/links/:memberId/confirm", requireLinkManage, (request, response) => {
  try { response.json({ success: true, ...confirmConnectionGoalPilotTarget(request.params.batchId, request.params.memberId, request.body, {
    userId: getUserPersonId(request.user), isAdmin: isAdminUser(request.user),
  }) }); }
  catch (error) { response.status(error.statusCode || 400).json({ success: false, message: error.message || "试点目标确认失败。" }); }
});

app.get("/api/connections/:id/daily-sales", requireLinkView, requireConnectionAccess, (request, response) => {
  try {
    response.json({ success: true, ...getConnectionDailySalesPerformance({
      connectionId: request.params.id,
      startDate: request.query.startDate,
      endDate: request.query.endDate,
    }) });
  } catch (error) {
    response.status(/不存在/.test(error.message || "") ? 404 : 400).json({ success: false, message: error.message || "链接销售日报读取失败。" });
  }
});

app.get("/api/connections-workbench/mine", requireLinkView, (request, response) => {
  try {
    if (request.query.page && String(request.query.filter ?? "all") === "all") {
      const page = listConnectionCoreProfilesPage(request.query, getUserPersonId(request.user), isAdminUser(request.user));
      const workbench = getMyConnectionWorkbench(getUserPersonId(request.user), isAdminUser(request.user), "all");
      response.json({ success: true, ...page, isAdmin: workbench.isAdmin, summary: workbench.summary });
      return;
    }
    response.json({ success: true, ...getMyConnectionWorkbench(getUserPersonId(request.user), isAdminUser(request.user), String(request.query.filter ?? "all")) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "我的链接读取失败。" });
  }
});

app.get("/api/link-sales-ranking", requireLinkView, (request, response) => {
  try {
    response.json({ success: true, ...getLinkSalesRanking(request.query, getUserPersonId(request.user), isAdminUser(request.user)) });
  } catch (error) {
    response.status(error.statusCode || 400).json({ success: false, message: error.message || "链接销售额排行读取失败。" });
  }
});

app.get("/api/link-sales-distribution", requireLinkView, (request, response) => {
  try {
    response.json({ success: true, ...getLinkSalesDistribution(request.query, getUserPersonId(request.user), isAdminUser(request.user)) });
  } catch (error) {
    response.status(error.statusCode || 400).json({ success: false, message: error.message || "链接销售额分布读取失败。" });
  }
});

app.get("/api/link-data-table", requireLinkView, (request, response) => {
  try {
    response.json({ success: true, ...queryLinkDataTable(request.query, getUserPersonId(request.user), isAdminUser(request.user)) });
  } catch (error) {
    response.status(error.statusCode || 400).json({ success: false, message: error.message || "链接经营数据读取失败。" });
  }
});

app.get("/api/link-business-table", requireLinkView, (request, response) => {
  try {
    response.json({ success: true, ...queryLinkBusinessTable(request.query, getUserPersonId(request.user), isAdminUser(request.user)) });
  } catch (error) {
    response.status(error.statusCode || 400).json({ success: false, message: error.message || "链接经营分析读取失败。" });
  }
});

app.get("/api/link-data-status", requireLinkView, (request, response) => {
  try {
    response.json({ success: true, ...getLinkDataStatus({ includeDetails: isAdminUser(request.user), shopId: request.query.shopId || "" }) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "链接数据更新状态读取失败。" });
  }
});

app.put("/api/connections-workbench/:id/follow", requireLinkManage, (request, response) => {
  try {
    response.json({ success: true, item: setConnectionFollow(request.params.id, getUserPersonId(request.user), request.body?.followed === true, isAdminUser(request.user)) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "链接关注状态更新失败。" });
  }
});

app.get("/api/connections/available-sales-links", requireLinkView, (request, response) => {
  try {
    response.json({ success: true, ...listAvailableSalesLinks(request.query) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "可建立连接读取失败。" });
  }
});

app.get("/api/connections/import-shops", requireLinkView, (_request, response) => {
  try {
    response.json({ success: true, items: listConnectionImportShops() });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "生意参谋店铺读取失败。" });
  }
});

app.get("/api/connection-data-mappings/repair-candidates", requireLinkRelations, (_request, response) => {
  try {
    response.json({ success: true, items: listConnectionMappingRepairCandidates() });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "异常映射修复清单读取失败。" });
  }
});

app.get("/api/connections/:id", requireLinkView, requireConnectionAccess, (request, response) => {
  try {
    response.json({ success: true, item: readConnectionProfile(request.params.id) });
  } catch (error) {
    response.status(404).json({ success: false, message: error.message || "连接档案不存在。" });
  }
});

app.put("/api/connections/:id", requireLinkManage, requireConnectionAccess, (request, response) => {
  try {
    response.json({ success: true, item: updateConnectionProfile(request.params.id, request.body) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "连接档案更新失败。" });
  }
});

app.get("/api/connections/:id/benchmarks", requireLinkView, requireConnectionAccess, (request, response) => {
  try {
    response.json({ success: true, items: listConnectionBenchmarkTargets(request.params.id) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "对标链接读取失败。" });
  }
});

app.get("/api/connections/:id/benchmark-candidates", requireLinkView, requireConnectionAccess, (request, response) => {
  try {
    response.json({ success: true, items: listConnectionBenchmarkCandidates(request.params.id, getUserPersonId(request.user), isAdminUser(request.user)) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "竞品候选读取失败。" });
  }
});

app.post("/api/connections/:id/benchmarks", requireLinkManage, requireConnectionAccess, requireOptionalBenchmarkConnectionAccess, (request, response) => {
  try {
    response.status(201).json({ success: true, item: createConnectionBenchmarkTarget(request.params.id, request.body, getUserPersonId(request.user)) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "对标链接保存失败。" });
  }
});

app.put("/api/connections/:id/benchmarks/:targetId", requireLinkManage, requireConnectionAccess, requireOptionalBenchmarkConnectionAccess, (request, response) => {
  try {
    response.json({ success: true, item: updateConnectionBenchmarkTarget(request.params.id, request.params.targetId, request.body) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "对标链接更新失败。" });
  }
});

app.delete("/api/connections/:id/benchmarks/:targetId", requireLinkManage, requireConnectionAccess, (request, response) => {
  try {
    response.json(deleteConnectionBenchmarkTarget(request.params.id, request.params.targetId));
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "对标链接删除失败。" });
  }
});

app.get("/api/connections/:id/benchmarks/:targetId/comparison", requireLinkView, requireConnectionAccess, requireBenchmarkComparisonAccess, (request, response) => {
  try {
    response.json({ success: true, ...getConnectionBenchmarkComparison(request.params.id, request.params.targetId) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "竞品对比读取失败。" });
  }
});

app.post("/api/connections", requireLinkManage, (request, response) => {
  try {
    response.status(201).json({ success: true, item: createConnectionProfile(request.body, request.user?.id) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "连接档案创建失败。" });
  }
});

app.post("/api/connections/batch", requireLinkManage, (request, response) => {
  try {
    response.status(201).json({ success: true, ...createConnectionProfilesBatch(request.body, request.user?.id) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "连接档案批量创建失败。" });
  }
});

app.get("/api/connections/:id/actions", requireLinkView, requireConnectionAccess, (request, response) => {
  try {
    response.json({ success: true, items: listConnectionActions(request.params.id) });
  } catch (error) {
    response.status(404).json({ success: false, message: error.message || "经营动作读取失败。" });
  }
});

app.post("/api/connections/:id/actions", requireLinkManage, requireConnectionAccess, (request, response) => {
  try {
    response.status(201).json({ success: true, item: createConnectionAction(request.params.id, request.body, request.user?.id) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "经营动作创建失败。" });
  }
});

app.delete("/api/connections/:id/actions/:actionId", requireLinkManage, requireConnectionAccess, (request, response) => {
  try {
    response.json(deleteConnectionAction(request.params.id, request.params.actionId));
  } catch (error) {
    response.status(404).json({ success: false, message: error.message || "经营动作删除失败。" });
  }
});

app.get("/api/connection-data-mappings", requireLinkView, (request, response) => {
  try {
    response.json({ success: true, items: listConnectionDataMappings(request.query) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "外部数据映射读取失败。" });
  }
});

app.post("/api/connection-data-mappings", requireLinkRelations, (request, response) => {
  try {
    response.status(201).json({ success: true, item: createConnectionDataMapping(request.body, request.user?.id) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "外部数据映射创建失败。" });
  }
});

app.put("/api/connection-data-mappings/:id", requireLinkRelations, (request, response) => {
  try {
    response.json({ success: true, item: updateConnectionDataMapping(request.params.id, request.body, request.user?.id) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "外部数据映射更新失败。" });
  }
});

app.delete("/api/connection-data-mappings/:id", requireLinkRelations, (request, response) => {
  try {
    response.json(deleteConnectionDataMapping(request.params.id, request.user?.id));
  } catch (error) {
    response.status(404).json({ success: false, message: error.message || "外部数据映射删除失败。" });
  }
});

app.get("/api/connection-data-foundation/definitions", requireLinkView, (_request, response) => {
  response.json({ success: true, definitions: getConnectionImportDefinitions() });
});

app.get("/api/connection-data-foundation/templates", requireLinkView, (_request, response) => {
  try { response.json({ success: true, items: listConnectionImportTemplates() }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "导入模板读取失败。" }); }
});

app.post("/api/connection-data-foundation/templates", requireLinkImport, (request, response) => {
  try { response.status(201).json({ success: true, item: createConnectionImportTemplate(request.body, request.user?.id) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "导入模板创建失败。" }); }
});

app.post("/api/connection-data-foundation/templates/:id/versions", requireLinkImport, (request, response) => {
  try { response.status(201).json({ success: true, item: iterateConnectionImportTemplate(request.params.id, request.body, request.user?.id) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "导入模板迭代失败。" }); }
});

app.get("/api/connection-data-foundation/batches", requireLinkView, (_request, response) => {
  try { response.json({ success: true, items: listConnectionFoundationBatches() }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "导入记录读取失败。" }); }
});

app.get("/api/connection-data-foundation/errors", requireLinkView, (request, response) => {
  try { response.json({ success: true, items: listConnectionImportErrors(request.query.batchId) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "导入异常读取失败。" }); }
});

app.post("/api/connection-data-foundation/imports/preview", requireLinkImport, (request, response) => {
  uploadConnectionWorkbook.single("file")(request, response, (error) => {
    if (error) { response.status(400).json({ success: false, message: error.message || "链接数据文件上传失败。" }); return; }
    try {
      const result = previewConnectionDataImport({ buffer: request.file?.buffer, fileName: normalizeUploadedFileName(request.file?.originalname), importType: request.body?.importType,
        templateVersionId: request.body?.templateVersionId, userId: request.user?.id });
      response.status(result.idempotent ? 200 : 201).json({ success: true, ...result });
    } catch (uploadError) { response.status(400).json({ success: false, message: uploadError.message || "链接数据预览失败。" }); }
  });
});

app.get("/api/connection-data-foundation/platform-links/bulk", requireLinkView, (request, response) => {
  try { response.json({ success: true, items: listConnectionBulkPlatformImports(request.query.limit) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "批量导入记录读取失败。" }); }
});

app.post("/api/connection-data-foundation/platform-links/bulk", requireLinkImport, (request, response) => {
  uploadConnectionWorkbook.array("files", 20)(request, response, (error) => {
    if (error) { response.status(400).json({ success: false, message: error.message || "平台链接批量文件上传失败。" }); return; }
    try {
      const result = createConnectionBulkPlatformImport({ files: request.files || [], createdBy: request.user?.id });
      response.status(result.idempotent ? 200 : 202).json({ success: true, ...result });
    } catch (uploadError) { response.status(400).json({ success: false, message: uploadError.message || "批量导入任务创建失败。" }); }
  });
});

app.get("/api/connection-data-foundation/platform-links/bulk/:id", requireLinkView, (request, response) => {
  try { response.json({ success: true, ...readConnectionBulkPlatformImport(request.params.id) }); }
  catch (error) { response.status(404).json({ success: false, message: error.message || "批量导入批次不存在。" }); }
});

app.post("/api/connection-data-foundation/platform-links/bulk/:id/confirm", requireLinkImport, (request, response) => {
  try { response.json({ success: true, ...confirmConnectionBulkPlatformImport(request.params.id) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "批量确认失败。" }); }
});

app.post("/api/connection-data-foundation/imports/:id/confirm", requireLinkImport, (request, response) => {
  try { response.json({ success: true, ...confirmConnectionDataImport(request.params.id) }); }
  catch (error) { response.status(400).json({ success: false, code: error.code || null, message: error.message || "链接数据确认导入失败。" }); }
});

app.post("/api/connection-data-foundation/sales-facts/preview", requireLinkImport, (request, response) => {
  response.status(410).json({ success: false, code: "sales_import_entry_moved", message: "旧利润表上传入口已停用，请使用销售日报事实预览入口。" });
});

app.get("/api/connection-data-foundation/sales-facts/current", requireLinkImport, (request, response) => {
  try { response.json({ success: true, preview: readCurrentSalesFactDataSyncPreview() }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "最近利润表预览读取失败。" }); }
});

app.get("/api/connection-data-foundation/sales-facts/:id", requireLinkImport, (request, response) => {
  try { response.json({ success: true, ...readSalesFactDataSyncPreview(request.params.id) }); }
  catch (error) { response.status(404).json({ success: false, message: error.message || "链接利润表预览读取失败。" }); }
});

app.post("/api/connection-data-foundation/sales-facts/:id/confirm", requireLinkImport, (request, response) => {
  response.status(410).json({ success: false, code: "sales_import_entry_moved", message: "旧利润表确认入口已停用，请使用销售日报事实确认入口。" });
});

app.post("/api/connection-data-foundation/sales-daily/preview", requireLinkImport, (request, response) => {
  uploadConnectionWorkbook.single("file")(request, response, (error) => {
    if (error) { response.status(400).json({ success: false, message: error.message || "销售日报上传失败。" }); return; }
    try {
      const result = previewSalesDailyFacts({ buffer: request.file?.buffer, fileName: normalizeUploadedFileName(request.file?.originalname), createdBy: getUserPersonId(request.user) });
      response.status(result.idempotent ? 200 : 201).json({ success: true, ...result });
    } catch (uploadError) {
      console.error("[sales-daily-preview]", uploadError);
      response.status(400).json({ success: false, message: uploadError.message || "销售日报预览失败。" });
    }
  });
});

app.get("/api/connection-data-foundation/sales-daily/current", requireLinkImport, (request, response) => {
  try { response.json({ success: true, preview: readCurrentSalesDailyFactPreview(request.query) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "最近销售日报预览读取失败。" }); }
});

app.get("/api/connection-data-foundation/sales-daily-quality", requireLinkView, (request, response) => {
  try { response.json({ success: true, ...querySalesDailyDataQuality() }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "销售日报数据质量读取失败。" }); }
});

app.get("/api/connection-data-foundation/sales-daily/:id", requireLinkImport, (request, response) => {
  try { response.json({ success: true, ...readSalesDailyFactPreview(request.params.id, request.query) }); }
  catch (error) { response.status(404).json({ success: false, message: error.message || "销售日报预览读取失败。" }); }
});

app.post("/api/connection-data-foundation/sales-daily/:id/recalculate", requireLinkImport, (request, response) => {
  try { response.status(201).json({ success: true, ...recalculateSalesDailyFactPreview(request.params.id, { createdBy: getUserPersonId(request.user) }) }); }
  catch (error) {
    const status = error.code === "preview_not_found" ? 404 : error.code === "no_approved_relation" ? 409 : 400;
    response.status(status).json({ success: false, message: error.message || "销售日报预览重新计算失败。" });
  }
});

app.post("/api/connection-data-foundation/sales-daily/:id/confirm", requireLinkImport, (request, response) => {
  try {
    response.json({ success: true, ...commitSalesDailyFacts(request.params.id, { confirmedBy: getUserPersonId(request.user) }) });
    scheduleV3ShadowObservation({ type: "sales_daily_import", objectId: request.params.id });
  }
  catch (error) {
    const status = error.code === "preview_not_found" ? 404 : error.code === "preview_not_ready" ? 409 : 400;
    response.status(status).json({ success: false, message: error.message || "销售日报事实写入失败。" });
  }
});

app.get("/api/connection-data-foundation/erp-sku-usages", requireLinkRelations, (request, response) => {
  try { response.json({ success: true, ...queryErpSkuUsageGovernance(request.query) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "ERP SKU用途治理列表读取失败。" }); }
});

app.get("/api/connection-data-foundation/erp-sku-usage-candidates", requireLinkRelations, (request, response) => {
  try { response.json({ success: true, ...queryErpSkuProductUsageCandidates(request.query) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "ERP SKU商品用途候选读取失败。" }); }
});

app.post("/api/connection-data-foundation/erp-sku-usages/confirm-batch", requireLinkRelations, (request, response) => {
  try { response.json({ success: true, result: confirmErpSkuProductUsages(request.body, { reviewedBy: getUserPersonId(request.user) }) }); }
  catch (error) { response.status(/不存在/.test(error.message || "") ? 404 : /冲突/.test(error.message || "") ? 409 : 400).json({ success: false, message: error.message || "ERP SKU商品用途批量确认失败。" }); }
});

app.get("/api/connection-data-foundation/erp-sku-usages/:id", requireLinkRelations, (request, response) => {
  try { response.json({ success: true, ...readErpSkuUsageGovernance(request.params.id, request.query) }); }
  catch (error) { response.status(/不存在/.test(error.message || "") ? 404 : 400).json({ success: false, message: error.message || "ERP SKU用途治理详情读取失败。" }); }
});

app.post("/api/connection-data-foundation/erp-sku-usages/:id/confirm", requireLinkRelations, (request, response) => {
  try { response.json({ success: true, result: confirmErpSkuUsageGovernance(request.params.id, request.body, { reviewedBy: getUserPersonId(request.user) }) }); }
  catch (error) { response.status(/不存在/.test(error.message || "") ? 404 : /冲突/.test(error.message || "") ? 409 : 400).json({ success: false, message: error.message || "ERP SKU用途确认失败。" }); }
});

app.get("/api/connection-data-foundation/sales-relation-candidates", requireLinkImport, (request, response) => {
  try { response.json({ success: true, ...querySalesRelationCandidates(request.query) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "销售关系候选读取失败。" }); }
});

app.get("/api/connection-data-foundation/sales-relation-governance", requireLinkImport, (request, response) => {
  try { response.json({ success: true, ...querySalesRelationGovernance(request.query) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "销售关系治理工作台读取失败。" }); }
});

app.get("/api/connection-data-foundation/sales-data-quality-anomalies", requireLinkImport, (request, response) => {
  try { response.json({ success: true, ...querySalesDataQualityAnomalies(request.query) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "销售数据异常队列读取失败。" }); }
});

app.post("/api/connection-data-foundation/sales-data-quality-anomalies/:id/decision", requireLinkRelations, (request, response) => {
  try { response.json({ success: true, result: submitSalesDataQualityAnomalyDecision(request.params.id, request.body, { reviewedBy: getUserPersonId(request.user) }) }); }
  catch (error) { response.status(/不存在/.test(error.message || "") ? 404 : /不允许|变化/.test(error.message || "") ? 409 : 400).json({ success: false, message: error.message || "销售数据异常处理失败。" }); }
});

app.get("/api/connection-data-foundation/product-structure-applications", requireLinkRelations, (request, response) => {
  try { response.json({ success: true, items: listProductStructureApplicationBatches() }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "货品结构应用批次读取失败。" }); }
});

app.get("/api/connection-data-foundation/product-structure-applications/:batchId/items", requireLinkRelations, (request, response) => {
  try { response.json({ success: true, ...queryProductStructureApplicationQueue(request.params.batchId, request.query) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "货品结构审批队列读取失败。" }); }
});

app.get("/api/connection-data-foundation/product-structure-application-items/:id", requireLinkRelations, (request, response) => {
  try { response.json({ success: true, preview: readProductStructureApplicationPreview(request.params.id) }); }
  catch (error) { response.status(/不存在/.test(error.message || "") ? 404 : 400).json({ success: false, message: error.message || "货品结构应用预览读取失败。" }); }
});

app.post("/api/connection-data-foundation/product-structure-application-items/:id/review", requireLinkRelations, (request, response) => {
  try { response.json({ success: true, result: reviewProductStructureApplicationItem(request.params.id, { ...request.body, reviewedBy: getUserPersonId(request.user) }) }); }
  catch (error) { response.status(/不存在/.test(error.message || "") ? 404 : /状态|分类/.test(error.message || "") ? 409 : 400).json({ success: false, message: error.message || "货品结构应用审批失败。" }); }
});

app.get("/api/connection-data-foundation/sales-relation-candidates/:id", requireLinkImport, (request, response) => {
  try { response.json({ success: true, ...readSalesRelationCandidate(request.params.id) }); }
  catch (error) { response.status(404).json({ success: false, message: error.message || "销售关系候选详情读取失败。" }); }
});

app.post("/api/connection-data-foundation/sales-relation-candidates/confirm-batch", requireLinkRelations, (request, response) => {
  try { response.json({ success: true, ...confirmSalesRelationCandidates(request.body?.candidateIds, { reviewedBy: getUserPersonId(request.user) }) }); }
  catch (error) { response.status(error.code === "combo_not_allowed" ? 400 : 409).json({ success: false, message: error.message || "销售单品关系批量确认失败。" }); }
});

app.post("/api/connection-data-foundation/sales-relation-candidates/:id/confirm", requireLinkRelations, (request, response) => {
  try {
    const result = confirmSalesRelationCandidate(request.params.id, { reviewedBy: getUserPersonId(request.user) });
    response.status(result.result?.outcome === "conflict" ? 409 : 200).json({ success: result.result?.outcome !== "conflict", ...result });
  } catch (error) { response.status(error.code === "combo_not_allowed" ? 400 : 409).json({ success: false, message: error.message || "销售单品关系确认失败。" }); }
});

app.get("/api/connection-import-batches", requireLinkView, (_request, response) => {
  try {
    response.json({ success: true, items: listConnectionImportBatches() });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "经营数据导入批次读取失败。" });
  }
});

app.post("/api/connection-import-batches", requireLinkImport, (request, response) => {
  uploadConnectionWorkbook.single("file")(request, response, (error) => {
    if (error) {
      response.status(400).json({ success: false, message: error.message || "生意参谋文件上传失败。" });
      return;
    }
    try {
      const result = createConnectionImportBatch({ buffer: request.file?.buffer, fileName: normalizeUploadedFileName(request.file?.originalname),
        businessDate: request.body?.businessDate, externalShopId: request.body?.externalShopId, userId: request.user?.id });
      response.status(201).json({ success: true, ...result });
    } catch (uploadError) {
      response.status(400).json({ success: false, message: uploadError.message || "生意参谋文件解析失败。" });
    }
  });
});

app.get("/api/connection-import-batches/:id/preview", requireLinkView, (request, response) => {
  try {
    response.json({ success: true, ...previewConnectionImportBatch(request.params.id) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "经营数据匹配预览读取失败。" });
  }
});

app.post("/api/connection-import-batches/:id/commit", requireLinkImport, (request, response) => {
  try {
    response.json({ success: true, ...commitConnectionImportBatch(request.params.id, request.user?.id) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "自动匹配确认失败。" });
  }
});

app.post("/api/connection-import-batches/:id/period-snapshots", requireLinkImport, (request, response) => {
  try {
    response.status(201).json({ success: true, ...createConnectionPeriodSnapshots(request.params.id, request.body ?? {}) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "经营周期快照生成失败。" });
  }
});

app.get("/api/connections/:id/period-snapshots", requireLinkView, requireConnectionAccess, (request, response) => {
  try {
    response.json({ success: true, items: listConnectionPeriodSnapshots(request.params.id) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "连接经营趋势读取失败。" });
  }
});

app.get("/api/connections/:id/growth-analysis", requireLinkView, requireConnectionAccess, (request, response) => {
  try {
    response.json({ success: true, item: getConnectionGrowthAnalysis(request.params.id) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "连接成长分析读取失败。" });
  }
});

app.get("/api/connection-growth-rankings", requireLinkView, (request, response) => {
  try {
    response.json({ success: true, ...listConnectionGrowthRankings(request.query.sort, request.query.limit, getUserPersonId(request.user), isAdminUser(request.user)) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "连接成长排行读取失败。" });
  }
});

app.get("/api/connection-management/overview", requireLinkView, (request, response) => {
  try {
    response.json({ success: true, ...getConnectionManagementOverview(getUserPersonId(request.user), isAdminUser(request.user)) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "链接经营概览读取失败。" });
  }
});

app.get("/api/connection-business-cockpit", requireLinkView, (request, response) => {
  try {
    const startedAt = performance.now();
    const result = getConnectionBusinessCockpit(getUserPersonId(request.user), isAdminUser(request.user), request.query);
    const computedAt = performance.now();
    const payloadText = JSON.stringify({ success: true, ...result });
    const serializedAt = performance.now();
    const stages = Object.entries(result._timings ?? {})
      .map(([name, duration]) => `${name.replaceAll(/[^a-zA-Z0-9_-]/g, "-")};dur=${Number(duration).toFixed(1)}`);
    stages.push(`service;dur=${(computedAt - startedAt).toFixed(1)}`, `serialize;dur=${(serializedAt - computedAt).toFixed(1)}`);
    response.set("Server-Timing", stages.join(", "));
    response.type("application/json").send(payloadText);
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "链接经营驾驶舱读取失败。" });
  }
});

app.post("/api/connection-import-batches/:id/rows/:externalId/confirm", requireLinkImport, (request, response) => {
  try {
    response.status(201).json({ success: true, item: confirmConnectionImportRow(request.params.id, request.params.externalId, request.body, request.user?.id) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "人工匹配确认失败。" });
  }
});

app.post("/api/connection-import-batches/:id/rows/:externalId/ignore", requireLinkImport, (request, response) => {
  try {
    response.status(201).json({ success: true, item: ignoreConnectionImportRow(request.params.id, request.params.externalId, request.user?.id) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "外部商品忽略失败。" });
  }
});

app.post("/api/products/erp-v2/:id/validate", requirePermission("products.import"), requireAdminForWangdianBatch, (request, response) => {
  try {
    response.json({ success: true, ...validateErpV2Import(request.params.id, request.body ?? {}) });
  } catch (error) {
    console.error("产品中心 V2 ERP校验失败", error);
    response.status(400).json({ success: false, message: error.message || "ERP导入校验失败。" });
  }
});

app.get("/api/products/erp-v2/:id", requirePermission("products.import"), requireAdminForWangdianBatch, (request, response) => {
  try {
    response.json({ success: true, ...readErpV2Import(request.params.id) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "ERP导入批次读取失败。" });
  }
});

app.post("/api/products/erp-v2/:id/preview", requirePermission("products.import"), requireAdminForWangdianBatch, (request, response) => {
  try {
    response.json({ success: true, ...previewErpV2Import(request.params.id, request.body ?? {}) });
  } catch (error) {
    console.error("产品中心 V2 ERP预览读取失败", error);
    response.status(400).json({ success: false, message: error.message || "ERP导入预览读取失败。" });
  }
});

app.post("/api/products/erp-v2/:id/commit", requirePermission("products.import"), requireAdminForWangdianBatch, (request, response) => {
  try {
    const result = commitErpV2Import(request.params.id, request.body ?? {});
    response.json({ success: true, ...result, data: filterDataByScope(readAllData(), request.user) });
  } catch (error) {
    console.error("产品中心 V2 ERP提交失败", error);
    response.status(400).json({ success: false, message: error.message || "ERP导入提交失败。" });
  }
});

app.get("/api/products/platform-skus/unmatched", requirePermission("skus.view"), (request, response) => {
  try {
    response.json({ success: true, ...queryUnmatchedPlatformSkus(request.query) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "未匹配平台SKU读取失败。" });
  }
});

app.get("/api/products/sales-summary", requirePermission("products.view"), (request, response) => {
  try {
    response.json({ success: true, rows: queryProductSalesSummaries() });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "产品销售汇总读取失败。" });
  }
});

app.get("/api/products/pending-skus", requirePermission("skus.view"), (request, response) => {
  try {
    response.json({
      success: true,
      rows: listPendingErpSkus(request.query.search),
    });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "待建立SKU读取失败。" });
  }
});

app.get("/api/products/auto-profile-settings", requirePermission("skus.view"), (request, response) => {
  try {
    response.json({ success: true, settings: getProductAutoProfileSettings() });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "自动建档设置读取失败。" });
  }
});

app.put("/api/products/auto-profile-settings", requirePermission("skus.manage"), requireAdminUser, (request, response) => {
  try {
    const updatedBy = request.user?.id || request.user?.account || request.user?.name || "admin";
    response.json({ success: true, settings: updateProductAutoProfileSettings({ enabled: request.body?.enabled }, updatedBy) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "自动建档设置保存失败。" });
  }
});

app.post("/api/products/pending-skus/batch-create-products", requirePermission("skus.manage"), (request, response) => {
  try {
    response.status(201).json({
      success: true,
      ...createProductsFromErpSkus(request.body?.erpSkuIds),
    });
  } catch (error) {
    const message = error.message || "产品批量创建失败。";
    const conflict = message.includes("已存在") || message.includes("占用") || message.includes("重复");
    response.status(conflict ? 409 : 400).json({ success: false, message });
  }
});

app.post("/api/products/pending-skus/:id/create-product", requirePermission("skus.manage"), (request, response) => {
  try {
    response.status(201).json({
      success: true,
      ...createProductFromErpSku(request.params.id),
    });
  } catch (error) {
    const message = error.message || "产品创建失败。";
    const conflict = message.includes("已存在") || message.includes("占用") || message.includes("重复");
    response.status(conflict ? 409 : 400).json({ success: false, message });
  }
});

app.get("/api/products/:id/sales-links", requirePermission("products.view"), (request, response) => {
  try {
    const database = getDatabase();
    const product = database.prepare("SELECT id FROM products WHERE id=?").get(request.params.id);
    if (!product) {
      response.status(404).json({ success: false, message: "产品不存在。" });
      return;
    }
    const rows = queryProductSalesLinks(request.params.id, { database });
    response.json({ success: true, productId: request.params.id, rows });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "产品销售链接读取失败。" });
  }
});

app.post("/api/products/platform-skus/:id/bind", requirePermission("skus.manage"), (request, response) => {
  try {
    const result = proposePlatformSkuProductRelation(request.params.id, String(request.body?.productId ?? ""), getUserPersonId(request.user));
    response.json({ success: true, result });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "人工绑定失败。" });
  }
});

app.delete("/api/products/platform-skus/:id/bind", requirePermission("skus.manage"), (request, response) => {
  response.status(410).json({
    success: false,
    code: "legacy_manual_binding_retired",
    message: "旧人工绑定已退役；已审核的Sales Object关系必须通过正式关系审批流程变更。",
  });
});

app.post("/api/products/platform-skus/:id/mark", requirePermission("skus.manage"), (request, response) => {
  try {
    markPlatformSku(request.params.id, String(request.body?.status ?? ""));
    response.json({ success: true });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "标记失败。" });
  }
});

app.post("/api/process-instances/:id/cancel", requirePermission("keyActions.manage"), (request, response) => {
  try {
    cancelProcessInstance(request.params.id, request.body?.cancelReason ?? "");
    response.json({ success: true, data: filterDataByScope(readAllData(), request.user) });
  } catch (error) {
    console.error("取消关键行动失败", error);
    response.status(400).json({ success: false, message: error.message || "取消关键行动失败，请检查本地数据库服务。" });
  }
});

app.post("/api/process-instances/:id/start", requirePermission("keyActions.manage"), (request, response) => {
  try {
    startProcessInstanceExecution(request.params.id, {
      userId: getUserPersonId(request.user),
      isAdmin: isAdminUser(request.user),
      dueDate: request.body?.dueDate,
    });
    response.json({ success: true, data: filterDataByScope(readAllData(), request.user) });
  } catch (error) {
    console.error("开始执行关键行动失败", error);
    const message = error.message || "开始执行关键行动失败，请检查本地数据库服务。";
    response.status(message.includes("没有权限") ? 403 : 400).json({ success: false, message });
  }
});

app.put("/api/process-instances/:id/products", requirePermission("keyActions.manage"), requirePermission("products.view"), (request, response) => {
  try {
    const instance = readAllData().processInstances.find((item) => item.id === request.params.id);
    if (instance === undefined) {
      response.status(404).json({ success: false, message: "未找到该关键行动。" });
      return;
    }
    if (!canEditProcessInstance(request.user, instance)) {
      response.status(403).json({ success: false, message: "只有管理员或关键行动发起人可以编辑关联产品。" });
      return;
    }
    replaceActionProducts(instance.id, request.body?.productIds ?? []);
    response.json({ success: true, data: filterDataByScope(readAllData(), request.user) });
  } catch (error) {
    console.error("关键行动关联产品保存失败", error);
    response.status(400).json({ success: false, message: error.message || "关联产品保存失败。" });
  }
});

app.post("/api/process-instances/batch-link-templates", requirePermission("keyActions.manage"), requirePermission("templates.view"), (request, response) => {
  try {
    const processInstanceIds = [...new Set((request.body?.processInstanceIds ?? []).map((id) => String(id ?? "").trim()).filter(Boolean))];
    if (processInstanceIds.length === 0) {
      response.status(400).json({ success: false, message: "请选择需要关联模板的关键行动。" });
      return;
    }
    const instanceMap = new Map(readAllData().processInstances.map((instance) => [instance.id, instance]));
    const instances = processInstanceIds.map((id) => instanceMap.get(id));
    if (instances.some((instance) => instance === undefined)) {
      response.status(404).json({ success: false, message: "存在未找到的关键行动。" });
      return;
    }
    if (instances.some((instance) => !canEditProcessInstance(request.user, instance))) {
      response.status(403).json({ success: false, message: "只有管理员或关键行动发起人可以关联模板。" });
      return;
    }
    const result = batchLinkProcessInstanceTemplates({
      processInstanceIds,
      templateIds: request.body?.templateIds,
    });
    response.json({ success: true, result, data: filterDataByScope(readAllData(), request.user) });
  } catch (error) {
    console.error("批量关联关键行动模板失败", error);
    response.status(400).json({ success: false, message: error.message || "批量关联模板失败，请检查本地数据库服务。" });
  }
});

app.put("/api/process-instances/:id/tasks/:taskId/executor", (request, response) => {
  if (!hasPermission(request.user, "tasks.manage")) {
    rejectUnauthorizedTask(response, "你没有权限调整任务执行人。");
    return;
  }
  try {
    const authorization = readTaskAuthorizationResolver([request.params.taskId]).get(request.params.taskId);
    if (authorization === null || authorization.task.processInstanceId !== request.params.id) {
      response.status(404).json({ success: false, message: "未找到该关键行动下的任务。" });
      return;
    }
    if (!canOperateTask(request.user, authorization, "edit")) {
      rejectUnauthorizedTask(response, "只有管理员、任务负责人、关键行动负责人或标准步骤负责人可以调整任务执行人。");
      return;
    }
    const data = readAllData();
    const instance = data.processInstances.find((item) => item.id === request.params.id);
    if (instance === undefined) {
      response.status(404).json({ success: false, message: "未找到该关键行动。" });
      return;
    }
    const task = data.tasks.find(
      (item) => item.id === request.params.taskId && item.processInstanceId === instance.id,
    );
    if (task === undefined) {
      response.status(404).json({ success: false, message: "未找到该关键行动下的任务。" });
      return;
    }
    if (!new Set(["waiting", "todo", "doing"]).has(task.status)) {
      response.status(400).json({ success: false, message: "当前任务状态不允许调整执行人。" });
      return;
    }
    const executorId = String(request.body?.executorId ?? "").trim();
    const executor = data.people.find((person) => person.id === executorId && person.status !== "inactive");
    if (executor === undefined) {
      response.status(400).json({ success: false, message: "请选择有效的执行人。" });
      return;
    }
    const updatedTask = updateResource("tasks", task.id, {
      executorId,
      updatedAt: new Date().toISOString(),
    });
    response.json({
      success: true,
      task: updatedTask,
    });
  } catch (error) {
    console.error("调整关键行动任务执行人失败", error);
    response.status(400).json({ success: false, message: error.message || "任务执行人保存失败，请检查本地数据库服务。" });
  }
});

app.post("/api/work-plans/:id/launch", requirePermission("keyActions.launch"), (request, response) => {
  try {
    if ((request.body?.productIds ?? []).length > 0 && !hasPermission(request.user, "products.view")) {
      response.status(403).json({ success: false, message: "你没有权限关联产品。" });
      return;
    }
    const existingWorkPlan = readAllData().workPlans.find((item) => item.id === request.params.id);
    if (
      rejectPausedRectificationLaunch(
        "work-plans",
        request.body ?? {},
        response,
        existingWorkPlan?.taskTemplateId ?? "",
      )
    ) return;
    if (
      rejectUnauthorizedActionTemplateLaunch(
        request.user,
        request.body ?? {},
        response,
        existingWorkPlan?.taskTemplateId ?? "",
      )
    ) return;
    launchWorkPlanWithProcess(request.params.id, {
      ...(request.body ?? {}),
      initiatorId: getUserPersonId(request.user),
    });
    response.json({ success: true, data: filterDataByScope(readAllData(), request.user) });
  } catch (error) {
    console.error("发起关键行动失败", error);
    response.status(400).json({ success: false, message: error.message || "发起关键行动失败，请检查本地数据库服务。" });
  }
});

app.post("/api/work-plans/batch-launch", requirePermission("keyActions.launch"), (request, response) => {
  try {
    const rows = Array.isArray(request.body?.rows) ? request.body.rows : [];
    if (!hasPermission(request.user, "products.view") && rows.some((row) => (row?.productIds ?? []).length > 0)) {
      response.status(403).json({ success: false, message: "你没有权限关联产品。" });
      return;
    }
    if (
      rows.some((row) =>
        rejectPausedRectificationLaunch(
          "work-plans",
          row?.workPlan ?? {},
          response,
          row?.workPlan?.taskTemplateId ?? "",
        ),
      )
    ) return;
    if (
      rows.some((row) =>
        rejectUnauthorizedActionTemplateLaunch(
          request.user,
          row?.workPlan ?? {},
          response,
          row?.workPlan?.taskTemplateId ?? "",
        ),
      )
    ) return;
    const results = batchLaunchWorkPlans(rows, { userId: getUserPersonId(request.user) });
    response.json({ success: true, results, data: filterDataByScope(readAllData(), request.user) });
  } catch (error) {
    console.error("批量发起发布内容笔记失败", error);
    response.status(400).json({ success: false, message: error.message || "批量发起失败，请检查本地数据库服务。" });
  }
});

app.post(
  "/api/content-note-import/parse",
  requirePermission("keyActions.launch"),
  (request, response, next) => {
    if (!hasPermission(request.user, "products.view")) {
      response.status(403).json({ success: false, message: "你没有产品中心查看权限，无法匹配产品编码。" });
      return;
    }
    next();
  },
  uploadContentNoteWorkbook.single("file"),
  (request, response) => {
    try {
      if (!request.file?.buffer?.length) {
        response.status(400).json({ success: false, message: "请选择要导入的 Excel 或表格文件。" });
        return;
      }
      const workbook = XLSX.read(request.file.buffer, { type: "buffer", cellDates: false });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new Error("工作簿中没有可读取的工作表。");
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1,
        defval: "",
        raw: false,
        blankrows: false,
      });
      const productColumnIndex = (rows[0] ?? []).findIndex((value) => String(value ?? "").trim() === "产品编码");
      const rawProductValues = productColumnIndex < 0
        ? []
        : rows.slice(2).map((row) => row[productColumnIndex]).filter((value) => String(value ?? "") !== "");
      const productDiagnostics = rawProductValues.flatMap((rawValue) =>
        splitProductSkuCodes(rawValue).map((code) => ({
          rawValue: String(rawValue ?? ""),
          code,
          length: code.length,
          utf8Hex: Buffer.from(code, "utf8").toString("hex"),
          trimmedValue: String(code).trim(),
          normalizedCode: normalizeProductSkuCode(code),
        })),
      );
      const requestedCodes = [...new Set(productDiagnostics.map((item) => item.normalizedCode).filter(Boolean))];
      const requestedCodeSet = new Set(requestedCodes);
      const productIndex = new Map();
      for (const product of getDatabase().prepare("SELECT * FROM products").all()) {
        const normalizedCode = normalizeProductSkuCode(product.skuCode);
        if (!requestedCodeSet.has(normalizedCode)) continue;
        const matches = productIndex.get(normalizedCode) ?? [];
        matches.push({
          id: product.id,
          skuCode: product.skuCode,
          name: product.name,
          status: product.status,
          mainImage: product.mainImage,
        });
        productIndex.set(normalizedCode, matches);
      }
      const productMatches = requestedCodes.map((normalizedCode) => ({
        normalizedCode,
        matches: productIndex.get(normalizedCode) ?? [],
      }));
      response.json({ success: true, sheetName, rows, productMatches, productDiagnostics });
    } catch (error) {
      console.error("发布内容笔记导入文件解析失败", error);
      response.status(400).json({ success: false, message: error.message || "Excel 文件解析失败。" });
    }
  },
);

app.post("/api/tasks/batch-status", (request, response) => {
  const status = String(request.body?.status ?? "").trim();
  const permission = status === "canceled" ? "tasks.cancel" : "tasks.manage";
  if (!hasPermission(request.user, permission)) {
    response.status(403).json({ success: false, message: "你没有权限进行该操作" });
    return;
  }
  try {
    const taskIds = [
      ...new Set(
        (Array.isArray(request.body?.taskIds) ? request.body.taskIds : [])
          .map((id) => String(id ?? "").trim())
          .filter(Boolean),
      ),
    ];
    const resolver = readTaskAuthorizationResolver(taskIds);
    const objectAction = status === "canceled" ? "batch_cancel" : "batch_done";
    const unauthorizedTaskIds = taskIds.filter(
      (taskId) => !canOperateTask(request.user, resolver.get(taskId), objectAction),
    );
    if (unauthorizedTaskIds.length > 0) {
      rejectUnauthorizedTask(
        response,
        `批量操作已整体拒绝，无权操作任务：${unauthorizedTaskIds.join("、")}`,
      );
      return;
    }
    const result = batchUpdateTaskStatus(request.body ?? {});
    response.json({ success: true, result });
  } catch (error) {
    console.error("批量任务状态保存失败", error);
    response.status(400).json({ success: false, message: error.message || "批量任务状态保存失败，请检查本地数据库服务。" });
  }
});

app.get("/api/tasks/:id", (request, response) => {
  if (!hasPermission(request.user, "tasks.view")) {
    rejectUnauthorizedTask(response, "你没有权限查看任务详情。");
    return;
  }
  const authorization = readTaskAuthorizationResolver([request.params.id]).get(request.params.id);
  if (authorization === null) {
    response.status(404).json({ success: false, message: "未找到任务。" });
    return;
  }
  if (!canViewTask(request.user, authorization)) {
    rejectUnauthorizedTask(response, "你没有权限查看该任务。");
    return;
  }
  response.json(readRouteResourceItem("tasks", request.params.id));
});

app.post("/api/tasks/:id/workflow", (request, response) => {
  const action = String(request.body?.action ?? "").trim();
  const permission = getTaskWorkflowPermission(action);
  if (permission === undefined) {
    response.status(400).json({ success: false, message: "未知的任务流程操作" });
    return;
  }
  if (!hasPermission(request.user, permission)) {
    response.status(403).json({ success: false, message: "你没有权限进行该任务流程操作" });
    return;
  }
  try {
    const authorization = readTaskAuthorizationResolver([request.params.id]).get(request.params.id);
    if (authorization === null) {
      response.status(404).json({ success: false, message: "未找到任务。" });
      return;
    }
    if (!canOperateTask(request.user, authorization, action)) {
      rejectUnauthorizedTask(response, "你没有权限对该任务执行此操作。");
      return;
    }
    const result = updateTaskFromWorkflow(request.params.id, action, request.body?.item ?? {});
    response.json({ success: true, ...result });
  } catch (error) {
    console.error("任务流程操作失败", error);
    response.status(400).json({ success: false, message: error.message || "任务流程操作失败，请检查本地数据库服务。" });
  }
});

function getVisibleTaskIds(user) {
  const data = readAllData();
  return filterTasksByScope(data.tasks ?? [], user, data).map((task) => task.id);
}

app.get("/api/task-waves", (request, response) => {
  if (!hasPermission(request.user, "tasks.view")) {
    response.status(403).json({ success: false, message: "你没有权限查看任务波次。" });
    return;
  }
  generateEligibleTaskWaves();
  const visibleTaskIds = getVisibleTaskIds(request.user);
  const visibleTaskIdSet = new Set(visibleTaskIds);
  response.json(
    readTaskWavesForTaskIds(visibleTaskIds).filter((wave) =>
      wave.taskIds.every((taskId) => visibleTaskIdSet.has(taskId)),
    ),
  );
});

app.get("/api/task-waves-regeneration/preview", (request, response) => {
  if (!isAdminUser(request.user) && !hasPermission(request.user, "actionStandards.manage")) {
    response.status(403).json({ success: false, message: "你没有权限重新生成任务波次。" });
    return;
  }
  response.json({ success: true, preview: readTaskWaveRegenerationPreview() });
});

app.post("/api/task-waves-regeneration/run", (request, response) => {
  if (!isAdminUser(request.user) && !hasPermission(request.user, "actionStandards.manage")) {
    response.status(403).json({ success: false, message: "你没有权限重新生成任务波次。" });
    return;
  }
  try {
    response.json({
      success: true,
      result: regenerateWaitingTaskWaves({ userId: getUserPersonId(request.user) }),
    });
  } catch (error) {
    console.error("重新生成待执行波次失败", error);
    response.status(400).json({ success: false, message: error.message || "重新生成待执行波次失败。" });
  }
});

app.get("/api/task-waves/:id", (request, response) => {
  if (!hasPermission(request.user, "tasks.view")) {
    response.status(403).json({ success: false, message: "你没有权限查看任务波次。" });
    return;
  }
  const wave = readTaskWaveDetailForTaskIds(request.params.id, getVisibleTaskIds(request.user));
  if (wave === null || wave.items.length !== Number(wave.taskCount)) {
    response.status(404).json({ success: false, message: "未找到可查看的任务波次。" });
    return;
  }
  response.json(wave);
});

function getTaskWaveOperationContext(request, action) {
  const wave = readTaskWaveDetailForTaskIds(request.params.id, getVisibleTaskIds(request.user));
  if (wave === null || wave.items.length !== Number(wave.taskCount)) {
    return {
      allowed: false,
      status: 403,
      message: "未找到可操作的任务波次，或波次包含超出当前数据范围的任务。",
    };
  }
  const userId = getUserPersonId(request.user);
  if (isAdminUser(request.user)) {
    return { allowed: true, wave, options: { userId, canManage: true } };
  }
  if (action === "cancel") {
    const resolver = readTaskAuthorizationResolver(wave.items.map((item) => item.taskId));
    const canManage =
      hasPermission(request.user, "tasks.cancel") &&
      wave.items.every((item) => canOperateTask(request.user, resolver.get(item.taskId), "batch_cancel"));
    return canManage
      ? { allowed: true, wave, options: { userId, canManage: true } }
      : { allowed: false, status: 403, message: "你没有权限取消该任务波次。" };
  }
  return wave.executorId === userId
    ? { allowed: true, wave, options: { userId, canManage: false } }
    : { allowed: false, status: 403, message: "只有波次执行人可以执行该操作。" };
}

app.post("/api/task-waves/:id/start", (request, response) => {
  if (!hasPermission(request.user, "tasks.execute")) {
    response.status(403).json({ success: false, message: "你没有权限开始任务波次。" });
    return;
  }
  try {
    const context = getTaskWaveOperationContext(request, "start");
    if (!context.allowed) {
      response.status(context.status).json({ success: false, message: context.message });
      return;
    }
    const { options } = context;
    response.json({ success: true, wave: startTaskWave(request.params.id, options) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "任务波次开始失败。" });
  }
});

app.put("/api/task-waves/:id/draft", (request, response) => {
  if (!hasPermission(request.user, "tasks.execute")) {
    response.status(403).json({ success: false, message: "你没有权限保存任务波次结果。" });
    return;
  }
  try {
    const context = getTaskWaveOperationContext(request, "draft");
    if (!context.allowed) {
      response.status(context.status).json({ success: false, message: context.message });
      return;
    }
    const { options } = context;
    response.json({ success: true, result: saveTaskWaveDraft(request.params.id, request.body?.drafts ?? [], options) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "任务波次草稿保存失败。" });
  }
});

app.post("/api/task-waves/:id/submit", (request, response) => {
  if (!hasPermission(request.user, "tasks.execute")) {
    response.status(403).json({ success: false, message: "你没有权限提交任务波次。" });
    return;
  }
  try {
    const context = getTaskWaveOperationContext(request, "submit");
    if (!context.allowed) {
      response.status(context.status).json({ success: false, message: context.message });
      return;
    }
    const { options } = context;
    response.json({ success: true, result: submitTaskWave(request.params.id, request.body?.drafts ?? [], options) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "任务波次提交失败。" });
  }
});

app.post("/api/task-waves/:id/cancel", (request, response) => {
  if (!isAdminUser(request.user) && !hasPermission(request.user, "tasks.cancel")) {
    response.status(403).json({ success: false, message: "你没有权限取消任务波次。" });
    return;
  }
  try {
    const context = getTaskWaveOperationContext(request, "cancel");
    if (!context.allowed) {
      response.status(context.status).json({ success: false, message: context.message });
      return;
    }
    const { options } = context;
    response.json({ success: true, wave: cancelTaskWave(request.params.id, request.body?.cancelReason ?? "", { ...options, canManage: true }) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "任务波次取消失败。" });
  }
});

app.post("/api/task-waves/generate", (request, response) => {
  if (!isAdminUser(request.user) && !hasPermission(request.user, "actionStandards.manage")) {
    response.status(403).json({ success: false, message: "你没有权限执行任务波次补扫。" });
    return;
  }
  try {
    response.json({ success: true, result: generateEligibleTaskWaves() });
  } catch (error) {
    console.error("任务波次补扫失败", error);
    response.status(400).json({ success: false, message: error.message || "任务波次补扫失败。" });
  }
});

app.put("/api/task-templates/:id/value-chain", requirePermission("actionStandards.manage"), (request, response) => {
  try {
    moveTaskTemplateToValueChain(
      request.params.id,
      request.body?.categoryName ?? "",
      request.body?.categoryId ?? "",
      request.body?.valueChainId ?? "",
    );
    response.json({ success: true, data: filterDataByScope(readAllData(), request.user) });
  } catch (error) {
    console.error("关键行动分类保存失败", error);
    response.status(400).json({ success: false, message: error.message || "关键行动分类保存失败，请检查本地数据库服务。" });
  }
});

app.patch("/api/process-template-nodes/:id/status", requirePermission("actionStandards.publish"), (request, response) => {
  try {
    updateProcessTemplateNodeStatus(request.params.id, request.body?.status ?? "");
    response.json({ success: true, data: filterDataByScope(readAllData(), request.user) });
  } catch (error) {
    console.error("标准节点状态保存失败", error);
    response.status(400).json({ success: false, message: error.message || "标准节点状态保存失败，请检查本地数据库服务。" });
  }
});

function templateVersionPermission(assetType, operation) {
  if (assetType === "visual") return operation === "status" ? "templates.publish" : "templates.manage";
  if (["action", "form", "manual"].includes(assetType)) {
    return operation === "status" ? "actionStandards.publish" : "actionStandards.manage";
  }
  return null;
}

app.get("/api/template-assets/versions", (request, response) => {
  if (!canAccessTemplateCenter(request.user)) {
    response.status(403).json({ success: false, message: "你没有权限查看模板版本。" });
    return;
  }
  try {
    response.json({ success: true, items: listTemplateVersions(String(request.query.assetType ?? ""), String(request.query.assetId ?? "")) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "模板版本读取失败。" });
  }
});

app.post("/api/template-assets/:assetType/:assetId/iterate", (request, response) => {
  const permission = templateVersionPermission(request.params.assetType, "iterate");
  if (permission === null || !hasPermission(request.user, permission)) {
    response.status(403).json({ success: false, message: "你没有权限迭代该模板。" });
    return;
  }
  try {
    response.status(201).json({ success: true, ...iterateTemplate(request.params.assetType, request.params.assetId, request.body ?? {}, request.user.id) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "模板迭代失败。" });
  }
});

app.post("/api/template-assets/:assetType/:assetId/versions/:versionId/:action", (request, response) => {
  const permission = templateVersionPermission(request.params.assetType, "status");
  if (permission === null || !hasPermission(request.user, permission)) {
    response.status(403).json({ success: false, message: "你没有权限管理该模板版本。" });
    return;
  }
  try {
    response.json({ success: true, items: changeTemplateVersionStatus(request.params.assetType, request.params.assetId, request.params.versionId, request.params.action, request.user.id) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "模板版本状态更新失败。" });
  }
});

app.get("/api/:resource", (request, response) => {
  try {
    const context = getResourceAuthorizationContext(
      request.params.resource,
      "GET",
      request.user,
    );
    if (!authorizeResourceAction(request.params.resource, "read", context)) {
      response.status(403).json({ success: false, message: "你没有权限查看该数据" });
      return;
    }
    const items = readRouteResource(request.params.resource);
    response.json(applyResourceReadScope(request.params.resource, items, request.user));
  } catch (error) {
    response.status(404).json({ error: error.message });
  }
});

app.post("/api/:resource", (request, response) => {
  try {
    if (rejectLegacyContentScheduleWrite(request.params.resource, response)) return;
    if (rejectPausedRectificationLaunch(request.params.resource, request.body ?? {}, response)) return;
    const context = getResourceAuthorizationContext(
      request.params.resource,
      "POST",
      request.user,
      request.body ?? {},
    );
    if (!authorizeResourceAction(request.params.resource, "write", context)) {
      response.status(403).json({ success: false, message: "你没有权限进行该操作" });
      return;
    }
    if (rejectInvalidPermissionConfiguration(request.params.resource, request.body ?? {}, response)) return;
    if (
      new Set(["work-plans", "process-instances"]).has(request.params.resource) &&
      rejectUnauthorizedActionTemplateLaunch(request.user, request.body ?? {}, response)
    ) return;
    const created = versionedTemplateResources.has(request.params.resource)
      ? getDatabase().transaction(() => {
          const item = createResource(request.params.resource, request.body);
          const publishPermission = request.params.resource === "templates"
            ? "templates.publish"
            : "actionStandards.publish";
          ensureInitialTemplateVersion(request.params.resource, item, request.user.id, {
            activate: hasPermission(request.user, publishPermission),
          });
          return item;
        })()
      : createResource(request.params.resource, request.body);
    response.status(201).json(created);
  } catch (error) {
    response.status(404).json({ error: error.message });
  }
});

app.put("/api/:resource/:id", (request, response) => {
  try {
    if (rejectLegacyContentScheduleWrite(request.params.resource, response)) return;
    if (versionedTemplateResources.has(request.params.resource)) {
      response.status(409).json({ success: false, message: "模板内容不能直接覆盖，请使用迭代生成新版本。" });
      return;
    }
    const registration = resourcePermissions[request.params.resource];
    if (registration === undefined || typeof registration.write !== "function") {
      response.status(403).json({ success: false, message: "你没有权限进行该操作" });
      return;
    }
    const taskAuthorization =
      request.params.resource === "tasks"
        ? readTaskAuthorizationResolver([request.params.id]).get(request.params.id)
        : null;
    const existing =
      request.params.resource === "tasks"
        ? taskAuthorization?.task ?? null
        : readExistingRouteResourceItem(request.params.resource, request.params.id);
    const context = getResourceAuthorizationContext(
      request.params.resource,
      "PUT",
      request.user,
      request.body ?? {},
      existing,
    );
    if (
      request.params.resource === "products"
      && existing !== null
      && Object.prototype.hasOwnProperty.call(request.body ?? {}, "skuCode")
      && String(request.body.skuCode ?? "").trim() !== String(existing.skuCode ?? "").trim()
    ) {
      response.status(400).json({
        success: false,
        message: "SKU编码属于ERP关联关键字段，请使用SKU修改流程。",
      });
      return;
    }
    if (!authorizeResourceAction(request.params.resource, "write", context)) {
      response.status(403).json({ success: false, message: "你没有权限进行该操作" });
      return;
    }
    if (rejectInvalidPermissionConfiguration(request.params.resource, request.body ?? {}, response)) return;
    if (request.params.resource === "tasks") {
      if (taskAuthorization === null) {
        response.status(404).json({ success: false, message: "未找到任务" });
        return;
      }
      const updatesSubmission = [
        "resultText",
        "resultAttachments",
        "submitFormData",
        "submitFiles",
        "submitLinks",
        "submittedAt",
      ].some((key) => Object.prototype.hasOwnProperty.call(request.body ?? {}, key));
      const objectAction = updatesSubmission ? "submit" : "edit";
      if (!canOperateTask(request.user, taskAuthorization, objectAction)) {
        rejectUnauthorizedTask(response, "你没有权限修改该任务。");
        return;
      }
    }
    if (request.params.resource === "tasks" && request.body?.status !== undefined) {
      const task = readRouteResourceItem("tasks", request.params.id);
      if (task === null) {
        response.status(404).json({ success: false, message: "未找到任务" });
        return;
      }
      if (request.body.status !== task.status) {
        response.status(400).json({ success: false, message: "任务状态不能直接编辑，请使用对应流程操作" });
        return;
      }
    }
    if (request.params.resource === "process-instances") {
      const instance = readAllData().processInstances.find((item) => item.id === request.params.id);
      if (instance === undefined) {
        response.status(404).json({ success: false, message: "未找到该已发起关键行动" });
        return;
      }
      if (!canEditProcessInstance(request.user, instance)) {
        response.status(403).json({ success: false, message: "只有管理员或关键行动发起人可以编辑该关键行动" });
        return;
      }
      response.json(updateResource(request.params.resource, request.params.id, request.body));
      return;
    }
    response.json(updateResource(request.params.resource, request.params.id, request.body));
  } catch (error) {
    response.status(404).json({ error: error.message });
  }
});

app.post("/api/products/:id/change-sku/preview", requirePermission("skus.manage"), (request, response) => {
  try {
    const impact = previewProductSkuChange(request.params.id, request.body?.newSkuCode);
    if (
      request.body?.oldSkuCode !== undefined
      && String(request.body.oldSkuCode ?? "").trim() !== String(impact.oldSkuCode ?? "").trim()
    ) {
      response.status(409).json({ success: false, message: "产品SKU已发生变化，请刷新后重新确认。" });
      return;
    }
    response.json({ success: true, impact });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "SKU修改影响检查失败。" });
  }
});

app.post("/api/products/:id/change-sku", requirePermission("skus.manage"), (request, response) => {
  try {
    const result = changeProductSku(request.params.id, {
      oldSkuCode: request.body?.oldSkuCode,
      newSkuCode: request.body?.newSkuCode,
      reason: request.body?.reason,
      changedBy: getUserPersonId(request.user),
    });
    response.json({ success: true, ...result });
  } catch (error) {
    const message = error.message || "SKU修改失败。";
    const status = /已发生变化|已被|冲突/.test(message) ? 409 : 400;
    response.status(status).json({ success: false, message });
  }
});

app.delete("/api/process-templates/:id", requirePermission("actionStandards.publish"), (request, response) => {
  try {
    response.json(deleteProcessTemplate(request.params.id));
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "删除标准失败，请检查本地数据库服务。" });
  }
});

app.delete("/api/process-template-nodes/:id", requirePermission("actionStandards.manage"), (request, response) => {
  try {
    response.json(deleteProcessTemplateNode(request.params.id));
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "删除标准节点失败，请检查本地数据库服务。" });
  }
});

app.delete("/api/:resource/:id", (_request, response) => {
  response.status(405).json({ error: "当前系统不支持真实删除，请使用停用、取消或终止。" });
});

const server = app.listen(port, host, () => {
  console.log(`Local API server running at http://${host}:${port}`);
  console.log(`Local access: http://127.0.0.1:${port}`);
  console.log(`SQLite database: ${databasePath}`);
  if (!isReleaseMaintenanceModeActive()) scheduleV3ShadowObservation({ type: "service_restart", objectId: process.pid });
});

if (!isReleaseMaintenanceModeActive()) {
  resumePendingWangdianShopDiscoveryBatches();
  resumeConnectionBulkPlatformImports();
}

const taskWaveCollectionTimer = setInterval(() => {
  const maintenanceToken = beginReleaseManagedJob("task_wave_collection");
  if (!maintenanceToken) return;
  try {
    generateEligibleTaskWaves();
  } catch (error) {
    console.error("任务波次自动收集失败", error);
  } finally {
    finishReleaseManagedJob(maintenanceToken);
  }
}, 60_000);
taskWaveCollectionTimer.unref();

let dataSyncSchedulerRunning = false;
const dataSyncSchedulerTimer = setInterval(async () => {
  if (dataSyncSchedulerRunning) return;
  const maintenanceToken = beginReleaseManagedJob("data_sync_scheduler");
  if (!maintenanceToken) return;
  dataSyncSchedulerRunning = true;
  try {
    const results = [...await runDueErpGoodsSyncTasks(), ...await runDueWangdianSuiteSyncTasks(), ...await runDuePlatformGoodsSyncTasks(), ...await runDueInventorySyncTasks()];
    for (const result of results.filter((item) => !item.success)) console.error("ERP货品自动同步失败", result.error);
    if (results.some((item) => item.success)) scheduleV3ShadowObservation({ type: "scheduled_data_sync", objectId: new Date().toISOString() });
  } catch (error) {
    console.error("数据同步中心调度失败", error);
  } finally {
    dataSyncSchedulerRunning = false;
    finishReleaseManagedJob(maintenanceToken);
  }
}, 60_000);
dataSyncSchedulerTimer.unref();

function shutdown() {
  clearInterval(taskWaveCollectionTimer);
  clearInterval(dataSyncSchedulerTimer);
  server.close(() => {
    closeDatabase();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
