import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import * as XLSX from "xlsx";
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
  generateErpFactSnapshot,
  getCapitalOccupationProducts,
  getDataCenterProductDetail,
  getDataCenterSummary,
  getSlowMovingProducts,
  getTrendProducts,
  hasWangdianConfig,
  listErpSyncRuns,
  listErpFactSnapshots,
  listPendingErpSkus,
  listProductFactSnapshots,
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
  removePlatformSkuManualBinding,
  updatePlatformSkuManualBinding,
  validateProductImport,
  validateErpV2Import,
} from "./modules/products/index.js";
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
  listConnectionProfiles,
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
  createConnectionHealthRecord,
  createImprovementAction,
  listAttentionConnectionHealthRecords,
  listConnectionHealthRecords,
  createConnectionImprovement,
  getConnectionImprovementSummary,
  listConnectionImprovements,
  updateConnectionImprovement,
} from "./modules/links/index.js";
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
  updateTaskFromWorkflow,
} from "./modules/tasks/index.js";
import {
  createToken,
  verifyPassword,
  verifyToken,
  canAccessTemplateCenter,
  canLaunchActionTemplate,
  getDataScope,
  hasPermission,
} from "./modules/auth/index.js";
import { normalizeProductSkuCode, splitProductSkuCodes } from "./modules/common/index.js";
import { getOperationDashboard } from "./operationManagementService.js";
import {
  addSupplierProduct,
  createPurchaseOrder,
  createQualityIssue,
  getSupplyChainOverview,
  listSuppliers,
  readSupplier,
  removeSupplierProduct,
  saveSupplier,
  saveSupplierEvaluation,
  updatePurchaseOrder,
  updateQualityIssue,
} from "./supplyChainService.js";
import { addConsumption, addFollowup, addTag, getCustomer, listCustomers, overview as getCustomerOverview, saveCustomer } from "./customerService.js";
import { confirmAnalysis,createAnalysis,createAnalysisAction,listAnalyses,readAnalysis } from "./aiOperationAssistantService.js";
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
  createProductImprovementAction,
  evaluateProductHealth,
  getProductV2Detail,
  getProductV2Overview,
  getProductBusinessAnalysis,
  productLifecycleStatuses,
} from "./productManagementV2Service.js";
import {
  bootstrapTemplateVersions,
  changeTemplateVersionStatus,
  ensureInitialTemplateVersion,
  iterateTemplate,
  listTemplateVersions,
  versionedTemplateResources,
} from "./templateVersionService.js";

const app = express();
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
  limits: { fileSize: 30 * 1024 * 1024 },
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

initializeDatabase();
bootstrapTemplateVersions();
fs.mkdirSync(imageUploadsDir, { recursive: true });
fs.mkdirSync(fileUploadsDir, { recursive: true });
fs.mkdirSync(standardWorkAttachmentsDir, { recursive: true });
fs.mkdirSync(productImportUploadsDir, { recursive: true });

function normalizeUploadedFileName(name = "") {
  const decoded = Buffer.from(name, "latin1").toString("utf8");
  const originalHasCjk = /[\u3400-\u9fff]/.test(name);
  const decodedHasCjk = /[\u3400-\u9fff]/.test(decoded);
  return !originalHasCjk && decodedHasCjk ? decoded : name;
}

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const imageStorage = multer.diskStorage({
  destination: (_request, _file, callback) => {
    callback(null, imageUploadsDir);
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
    if (!allowedImageTypes.has(file.mimetype)) {
      callback(new Error("只支持 JPG、PNG、WebP 图片。"));
      return;
    }
    callback(null, true);
  },
});

const allowedFileTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "text/plain",
  "video/mp4",
  "video/quicktime",
  "video/x-m4v",
  "video/webm",
  "application/illustrator",
  "application/postscript",
]);
const allowedFileExts = new Set([".jpg", ".jpeg", ".png", ".webp", ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".zip", ".txt", ".mp4", ".mov", ".m4v", ".webm", ".psd", ".psb", ".ai", ".fig"]);
const fileStorage = multer.diskStorage({
  destination: (_request, _file, callback) => {
    callback(null, fileUploadsDir);
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
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedFileTypes.has(file.mimetype) && !allowedFileExts.has(ext)) {
      callback(new Error("只支持图片、PSD、PSB、AI、FIG、PDF、Word、Excel、ZIP、视频和文本文件。"));
      return;
    }
    callback(null, true);
  },
});

const allowedSpreadsheetExts = new Set([".xlsx", ".xls", ".csv"]);
const spreadsheetStorage = multer.diskStorage({
  destination: (_request, _file, callback) => {
    callback(null, standardWorkAttachmentsDir);
  },
  filename: (_request, file, callback) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = allowedSpreadsheetExts.has(ext) ? ext : "";
    callback(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safeExt}`);
  },
});
const uploadSpreadsheet = multer({
  storage: spreadsheetStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedSpreadsheetExts.has(ext)) {
      callback(new Error("只支持 .xlsx、.xls、.csv 表格附件。"));
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

app.get("/api/health", (_request, response) => {
  try {
    getDatabase().prepare("SELECT 1").get();
    response.json({
      status: "ok",
      database: "ok",
      version: applicationVersion,
    });
  } catch {
    response.status(500).json({
      status: "error",
      database: "error",
      version: applicationVersion,
    });
  }
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

const requireLinkView = requireAnyPermission("links.view", "products.view");
const requireLinkManage = requireAnyPermission("links.manage", "products.edit");
const requireLinkImport = requireAnyPermission("links.import", "products.edit");
const requireLinkHealth = requireAnyPermission("links.health", "products.view");
const requireLinkHealthManage = requireAnyPermission("links.health", "products.edit");
const requireLinkImprove = requireAnyPermission("links.improve", "products.edit");
const requireSupplyView = requireAnyPermission("supplyChain.view", "products.view");
const requireSupplyManage = requireAnyPermission("supplyChain.manage", "products.edit");
const requireSupplyPurchase = requireAnyPermission("supplyChain.purchase", "products.edit");
const requireSupplyQuality = requireAnyPermission("supplyChain.quality", "products.edit");
const requireCustomerView = requirePermission("customers.view");
const requireCustomerManage = requirePermission("customers.manage");
const requireCustomerMaintain = requirePermission("customers.maintain");
const requireAiView = requirePermission("aiAssistant.view");
const requireAiAnalyze = requirePermission("aiAssistant.analyze");
const requireAiConfirm = requirePermission("aiAssistant.confirm");
const requireAiAction = requirePermission("aiAssistant.createAction");
function customerScope(user,query={}){const scope=getDataScope(user);if(scope==="self")return{...query,ownerId:user.id};if(scope==="department")return{...query,departmentId:user.departmentId};return query;}
function assertCustomerAccess(user,customerId){if(!listCustomers(customerScope(user,{id:customerId}),true).length)throw new Error("你无权操作该客户。");}

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

function isAdminUser(user) {
  return user?.role === "admin" || user?.role === "system_admin" || user?.authRole === "admin";
}

function getUserPersonId(user) {
  return user?.personId ?? user?.id ?? "";
}

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
    hasPermission(user, "settings.viewStores") ||
    hasPermission(user, "settings.editStores") ||
    hasPermission(user, "workPlans.launch") ||
    hasPermission(user, "goals.addWork")
  );
}

function canUsePublishingAccountOptions(user) {
  return (
    hasPermission(user, "settings.editStandardWorkForms") ||
    hasPermission(user, "workPlans.launch") ||
    hasPermission(user, "goals.addWork") ||
    hasPermission(user, "contentSchedules.view") ||
    hasPermission(user, "contentSchedules.create") ||
    hasPermission(user, "contentSchedules.edit")
  );
}

function hasAnyPermission(user, permissions) {
  return permissions.some((permission) => hasPermission(user, permission));
}

function canUseActionStandardOptions(user) {
  return hasAnyPermission(user, [
    "settings.viewStandardWorks",
    "settings.editStandardWorks",
    "processes.viewTemplates",
    "workPlans.launch",
    "goals.addWork",
  ]);
}

function canUseTemplateOptions(user) {
  return (
    canAccessTemplateCenter(user) ||
    hasAnyPermission(user, [
      "tasks.view",
      "processes.viewInstances",
      "workPlans.launch",
      "contentSchedules.view",
    ])
  );
}

function permissionRule(permission) {
  return ({ user }) => hasPermission(user, permission);
}

function anyPermissionRule(...permissions) {
  return ({ user }) => hasAnyPermission(user, permissions);
}

const resourcePermissions = {
  companies: {
    read: anyPermissionRule("settings.viewOrg", "settings.editOrg"),
    write: permissionRule("settings.editOrg"),
  },
  departments: {
    read: anyPermissionRule("settings.viewOrg", "settings.editOrg"),
    write: permissionRule("settings.editOrg"),
  },
  positions: {
    read: anyPermissionRule("settings.viewOrg", "settings.editOrg"),
    write: permissionRule("settings.editOrg"),
  },
  persons: {
    read: anyPermissionRule("settings.viewPeople", "settings.editPeople", "settings.managePermissions"),
    write: ({ user, body }) =>
      hasPermission(
        user,
        ["permissions", "permissionTemplateId", "permissionOverrides"].some((key) =>
          Object.prototype.hasOwnProperty.call(body, key),
        )
          ? "settings.managePermissions"
          : "settings.editPeople",
      ),
    scope: "people",
  },
  people: {
    read: anyPermissionRule("settings.viewPeople", "settings.editPeople", "settings.managePermissions"),
    write: ({ user, body }) =>
      hasPermission(
        user,
        ["permissions", "permissionTemplateId", "permissionOverrides"].some((key) =>
          Object.prototype.hasOwnProperty.call(body, key),
        )
          ? "settings.managePermissions"
          : "settings.editPeople",
      ),
    scope: "people",
  },
  "permission-templates": {
    read: permissionRule("settings.managePermissions"),
    write: permissionRule("settings.managePermissions"),
  },
  categories: {
    read: permissionRule("settings.editCategories"),
    write: permissionRule("settings.editCategories"),
  },
  stores: {
    read: ({ user }) => canUseStoreOptions(user),
    write: permissionRule("settings.editStores"),
  },
  "publishing-accounts": {
    read: ({ user }) => canUsePublishingAccountOptions(user),
    write: permissionRule("settings.editStandardWorkForms"),
  },
  "weekly-reports": {
    read: permissionRule("assessment.view"),
    write: ({ user, method }) =>
      hasPermission(user, method === "POST" ? "assessment.fillWeeklyReport" : "assessment.editWeeklyReport"),
    scope: "dataScope",
  },
  "weekly-report-problems": {
    read: permissionRule("assessment.viewProblems"),
    write: permissionRule("assessment.updateProblems"),
    scope: "dataScope",
  },
  goals: {
    read: permissionRule("goals.view"),
    write: ({ user, method }) => hasPermission(user, method === "POST" ? "goals.create" : "goals.edit"),
    scope: "dataScope",
  },
  "task-templates": {
    read: ({ user }) => canUseActionStandardOptions(user),
    write: ({ user, body }) =>
      hasPermission(
        user,
        body.formFields !== undefined ? "settings.editStandardWorkForms" : "settings.editStandardWorks",
      ),
  },
  tasks: {
    read: permissionRule("tasks.view"),
    write: ({ user, method, body }) => {
      if (method === "POST" && body.source === "process") return hasPermission(user, "workPlans.launch");
      if (
        body.submitFormData !== undefined ||
        body.submitFiles !== undefined ||
        body.submitLinks !== undefined
      ) {
        return hasPermission(user, "tasks.submitResult");
      }
      return hasPermission(user, "tasks.changeStatus");
    },
    scope: "dataScope",
  },
  "process-templates": {
    read: anyPermissionRule("processes.viewTemplates", "settings.viewStandardWorks"),
    write: permissionRule("processes.editTemplates"),
  },
  "process-template-nodes": {
    read: anyPermissionRule("processes.viewTemplates", "settings.viewStandardWorks"),
    write: anyPermissionRule("processes.editSteps", "processes.sortSteps"),
  },
  "process-instances": {
    read: permissionRule("processes.viewInstances"),
    write: ({ user, method }) =>
      hasPermission(user, method === "POST" ? "workPlans.launch" : "processes.editInstances"),
    scope: "dataScope",
  },
  methodologies: {
    read: permissionRule("methods.view"),
    write: ({ user, method }) => hasPermission(user, method === "POST" ? "methods.create" : "methods.edit"),
  },
  templates: {
    read: ({ user }) => canUseTemplateOptions(user),
    write: ({ user }) => canAccessTemplateCenter(user),
  },
  "template-tag-categories": {
    read: anyPermissionRule("settings.viewStandardWorks", "settings.editStandardWorkForms"),
    write: permissionRule("settings.editStandardWorkForms"),
  },
  "template-tags": {
    read: anyPermissionRule("settings.viewStandardWorks", "settings.editStandardWorkForms"),
    write: permissionRule("settings.editStandardWorkForms"),
  },
  "standard-work-forms": {
    read: ({ user }) => canUseActionStandardOptions(user),
    write: permissionRule("settings.editStandardWorkForms"),
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
    read: permissionRule("settings.editStandardWorkForms"),
    write: permissionRule("settings.editStandardWorkForms"),
    scope: "dataScope",
  },
  "content-schedules": {
    read: permissionRule("contentSchedules.view"),
    write: ({ user, method }) =>
      hasPermission(user, method === "POST" ? "contentSchedules.create" : "contentSchedules.edit"),
    scope: "dataScope",
  },
  "work-plans": {
    read: anyPermissionRule("processes.viewInstances", "workPlans.launch"),
    write: permissionRule("workPlans.launch"),
    scope: "dataScope",
  },
  products: {
    read: permissionRule("products.view"),
    write: ({ user, method, body }) =>
      hasPermission(
        user,
        method === "POST"
          ? "products.create"
          : body.status === "已归档"
            ? "products.archive"
            : "products.edit",
      ),
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
  const permissionTemplates = hasPermission(user, "settings.managePermissions") ? (data.permissionTemplates ?? []) : [];
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
        platformSkuManualBindings: data.platformSkuManualBindings ?? [],
      }
    : {
        erpGoods: [],
        productErpMappings: [],
        salesShops: [],
        salesShopAliases: [],
        salesLinks: [],
        salesLinkSkus: [],
        erpImportBatches: [],
        platformSkuManualBindings: [],
      };
  const visibleProductIds = new Set(products.map((product) => product.id));
  if (dataScope === "all") {
    const actionProducts = (data.actionProducts ?? []).filter((item) => visibleProductIds.has(item.productId));
    return { ...data, stores, publishingAccounts, permissionTemplates, products, actionProducts, productImportBatches, ...productV2Data };
  }

  const scopedTasks = filterTasksByScope(data.tasks ?? [], user, data);
  const scopedWorkPlans = filterByScope(data.workPlans ?? [], user);
  const scopedProcessInstances = filterByScope(data.processInstances ?? [], user);
  const scopedProcessInstanceIds = new Set(scopedProcessInstances.map((instance) => instance.id));
  const scopedActionProducts = (data.actionProducts ?? []).filter(
    (item) => scopedProcessInstanceIds.has(item.actionId) && visibleProductIds.has(item.productId),
  );
  const scopedGoals = filterByScope(data.goals ?? [], user);
  const scopedContentSchedules = filterByScope(data.contentSchedules ?? [], user);
  const scopedWeeklyReports = filterByScope(data.weeklyReports ?? [], user);
  const scopedWeeklyReportProblems = filterByScope(data.weeklyReportProblems ?? [], user);
  const scopedPeople =
    dataScope === "department"
      ? (data.people ?? []).filter((person) => person.departmentId === user.departmentId || person.id === user.id)
      : (data.people ?? []).filter((person) => person.id === user.id);

  return {
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
  };
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

app.post("/api/data", requirePermission("settings.managePermissions"), (request, response) => {
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

app.post("/api/uploads/image", (request, response) => {
  uploadImage.single("image")(request, response, (error) => {
    if (error !== undefined) {
      const message =
        error.code === "LIMIT_FILE_SIZE" ? "图片大小不能超过 10MB。" : error.message || "图片上传失败。";
      response.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: message });
      return;
    }

    if (request.file === undefined) {
      response.status(400).json({ error: "请选择要上传的图片。" });
      return;
    }

    response.json({
      url: `/uploads/images/${request.file.filename}`,
      filename: request.file.filename,
    });
  });
});

app.post("/api/uploads/file", (request, response) => {
  uploadFile.single("file")(request, response, (error) => {
    if (error !== undefined) {
      const message =
        error.code === "LIMIT_FILE_SIZE" ? "源文件超过上传限制，请压缩后上传，当前限制为600MB。" : error.message || "文件上传失败。";
      response.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: message });
      return;
    }

    if (request.file === undefined) {
      response.status(400).json({ error: "请选择要上传的文件。" });
      return;
    }

    response.json({
      url: `/uploads/files/${request.file.filename}`,
      filename: request.file.filename,
      originalName: normalizeUploadedFileName(request.file.originalname),
      size: request.file.size,
      mimeType: request.file.mimetype,
    });
  });
});

app.post("/api/uploads/standard-work-attachment", (request, response) => {
  uploadSpreadsheet.single("file")(request, response, (error) => {
    if (error !== undefined) {
      const message =
        error.code === "LIMIT_FILE_SIZE" ? "表格附件大小不能超过 20MB。" : error.message || "表格附件上传失败。";
      response.status(400).json({ error: message });
      return;
    }

    if (request.file === undefined) {
      response.status(400).json({ error: "请选择要上传的表格附件。" });
      return;
    }

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

app.use("/api/products/import", requirePermission("products.create"), (_request, response) => {
  response.status(410).json({
    success: false,
    message: "旧货品信息导入入口已停用，请使用产品中心 ERP V2 的“导入货品信息”。",
    redirectTo: "/api/products/erp-v2/parse",
  });
});

app.post("/api/products/import/parse", requirePermission("products.create"), (request, response) => {
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

app.post("/api/products/import/:id/validate", requirePermission("products.create"), (request, response) => {
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

app.post("/api/products/import/:id/commit", requirePermission("products.create"), (request, response) => {
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
    if (validation.summary.update > 0 && !hasPermission(request.user, "products.edit")) {
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

app.post("/api/products/erp-v2/parse", requirePermission("products.create"), (request, response) => {
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
    response.json({
      success: true,
      runs: listErpSyncRuns({
        businessDate: String(request.query.businessDate ?? ""),
        includeHistorical: String(request.query.includeHistorical ?? "true") !== "false",
      }),
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
  response.json({ success: true, syncRun });
});

app.post("/api/products/erp-sync-runs", requirePermission("products.create"), (request, response) => {
  try {
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

app.get("/api/products/wangdian/status", requirePermission("products.view"), (request, response) => {
  response.json({ success: true, configured: hasWangdianConfig() });
});

app.post("/api/products/erp-sync-runs/:id/wangdian/preview", requirePermission("products.create"), async (request, response) => {
  try {
    const result = await parseWangdianGoodsImport({
      syncRunId: request.params.id,
      query: request.body ?? {},
      importMode: request.body?.importMode,
      createdBy: getUserPersonId(request.user),
    });
    response.json({ success: true, ...result });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "旺店通货品读取失败。" });
  }
});

app.post("/api/products/erp-sync-runs/:id/recalculate-status", requirePermission("products.create"), (request, response) => {
  try {
    const syncRun = recalculateErpSyncRun(request.params.id);
    response.json({ success: true, syncRun: readErpSyncRun(syncRun.id) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "ERP每日同步状态刷新失败。" });
  }
});

app.post("/api/products/erp-sync-runs/:id/generate-snapshot", requirePermission("products.create"), (request, response) => {
  try {
    const result = generateErpFactSnapshot(request.params.id);
    response.json({ success: true, ...result, syncRun: readErpSyncRun(request.params.id) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "ERP历史快照生成失败。" });
  }
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

app.get("/api/data-center/summary", requirePermission("dataCenter.view"), (_request, response) => {
  try {
    response.json({ success: true, summary: getDataCenterSummary() });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "数据中心概览读取失败。" });
  }
});

app.get("/api/operation-dashboard", requirePermission("dataCenter.view"), (_request, response) => {
  try {
    response.json({ success: true, dashboard: getOperationDashboard() });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "经营驾驶舱读取失败。" });
  }
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

app.post("/api/finance/import-batches", requirePermission("finance.manage"), uploadFinanceWorkbook.single("file"), (request, response) => {
  try { response.status(201).json({ success: true, batch: createFinanceImportBatch(request.file, request.user.id) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "账单解析失败。" }); }
});

app.get("/api/finance/import-batches/:id", requirePermission("finance.view"), (request, response) => {
  try { response.json({ success: true, batch: readFinanceImportBatch(request.params.id) }); }
  catch (error) { response.status(404).json({ success: false, message: error.message || "账单批次不存在。" }); }
});

app.post("/api/finance/import-batches/:id/commit", requirePermission("finance.manage"), (request, response) => {
  try { response.json({ success: true, ...commitFinanceImportBatch(request.params.id, request.body, request.user.id) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "账单确认失败。" }); }
});

app.get("/api/finance/rules", requirePermission("finance.view"), (_request, response) => {
  try { response.json({ success: true, items: listFinanceRules() }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "财务规则读取失败。" }); }
});

app.post("/api/finance/rules", requirePermission("finance.manage"), (request, response) => {
  try { response.status(201).json({ success: true, item: saveFinanceRule(request.body, request.user.id) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "财务规则保存失败。" }); }
});

app.put("/api/finance/rules/:id", requirePermission("finance.manage"), (request, response) => {
  try { response.json({ success: true, item: saveFinanceRule(request.body, request.user.id, request.params.id) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "财务规则更新失败。" }); }
});

app.delete("/api/finance/rules/:id", requirePermission("finance.manage"), (request, response) => {
  try { removeFinanceRule(request.params.id); response.json({ success: true }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "财务规则删除失败。" }); }
});

app.get("/api/supply-chain/overview", requireSupplyView, (request, response) => {
  try {
    const scoped = filterDataByScope(readAllData({ exclude: ["salesLinks", "salesLinkSkus"] }), request.user);
    response.json({ success: true, ...getSupplyChainOverview(), moduleData: {
      products: scoped.products ?? [], productErpMappings: scoped.productErpMappings ?? [],
    } });
  }
  catch (error) { response.status(400).json({ success: false, message: error.message || "供应链概览读取失败。" }); }
});

app.get("/api/supply-chain/suppliers", requireSupplyView, (request, response) => {
  try { response.json({ success: true, items: listSuppliers(request.query) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "供应商列表读取失败。" }); }
});

app.get("/api/supply-chain/suppliers/:id", requireSupplyView, (request, response) => {
  try { response.json({ success: true, detail: readSupplier(request.params.id) }); }
  catch (error) { response.status(404).json({ success: false, message: error.message || "供应商不存在。" }); }
});

app.post("/api/supply-chain/suppliers", requireSupplyManage, (request, response) => {
  try { response.status(201).json({ success: true, item: saveSupplier(request.body, request.user.id) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "供应商创建失败。" }); }
});

app.put("/api/supply-chain/suppliers/:id", requireSupplyManage, (request, response) => {
  try { response.json({ success: true, item: saveSupplier(request.body, request.user.id, request.params.id) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "供应商更新失败。" }); }
});

app.post("/api/supply-chain/suppliers/:id/products", requireSupplyManage, (request, response) => {
  try { response.status(201).json({ success: true, item: addSupplierProduct(request.params.id, request.body) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "供应产品关联失败。" }); }
});

app.delete("/api/supply-chain/suppliers/:id/products/:relationId", requireSupplyManage, (request, response) => {
  try { response.json(removeSupplierProduct(request.params.id, request.params.relationId)); }
  catch (error) { response.status(404).json({ success: false, message: error.message || "供应产品关系删除失败。" }); }
});

app.post("/api/supply-chain/purchases", requireSupplyPurchase, (request, response) => {
  try { response.status(201).json({ success: true, item: createPurchaseOrder(request.body, request.user.id) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "采购记录创建失败。" }); }
});

app.put("/api/supply-chain/purchases/:id", requireSupplyPurchase, (request, response) => {
  try { response.json({ success: true, item: updatePurchaseOrder(request.params.id, request.body) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "采购状态更新失败。" }); }
});

app.post("/api/supply-chain/quality-issues", requireSupplyQuality, (request, response) => {
  try { response.status(201).json({ success: true, item: createQualityIssue(request.body) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "品质问题创建失败。" }); }
});

app.put("/api/supply-chain/quality-issues/:id", requireSupplyQuality, (request, response) => {
  try { response.json({ success: true, item: updateQualityIssue(request.params.id, request.body) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "品质问题更新失败。" }); }
});

app.post("/api/supply-chain/evaluations", requireSupplyManage, (request, response) => {
  try { response.status(201).json({ success: true, item: saveSupplierEvaluation(request.body, request.user.id) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "供应商评价保存失败。" }); }
});

app.get("/api/customer-center/overview", requireCustomerView, (request,response)=>{try{response.json({success:true,...getCustomerOverview(customerScope(request.user))});}catch(error){response.status(400).json({success:false,message:error.message||"客户概览读取失败。"});}});
app.get("/api/customer-center/customers", requireCustomerView, (request,response)=>{try{response.json({success:true,items:listCustomers(customerScope(request.user,request.query),hasPermission(request.user,"customers.manage"))});}catch(error){response.status(400).json({success:false,message:error.message||"客户列表读取失败。"});}});
app.get("/api/customer-center/customers/:id", requireCustomerView, (request,response)=>{try{if(!listCustomers(customerScope(request.user,{id:request.params.id}),true).length)return response.status(403).json({success:false,message:"你无权查看该客户。"});response.json({success:true,detail:getCustomer(request.params.id,hasPermission(request.user,"customers.manage"))});}catch(error){response.status(404).json({success:false,message:error.message||"客户不存在。"});}});
app.post("/api/customer-center/customers", requireCustomerManage, (request,response)=>{try{const payload={...request.body,ownerId:request.body?.ownerId||request.user.id};response.status(201).json({success:true,item:saveCustomer(payload,request.user.id)});}catch(error){response.status(400).json({success:false,message:error.message||"客户创建失败。"});}});
app.put("/api/customer-center/customers/:id", requireCustomerManage, (request,response)=>{try{assertCustomerAccess(request.user,request.params.id);const current=getCustomer(request.params.id,true).customer;response.json({success:true,item:saveCustomer({...request.body,ownerId:request.body?.ownerId||current.ownerId},request.user.id,request.params.id)});}catch(error){response.status(400).json({success:false,message:error.message||"客户更新失败。"});}});
app.post("/api/customer-center/customers/:id/consumptions", requireCustomerManage, (request,response)=>{try{assertCustomerAccess(request.user,request.params.id);response.status(201).json({success:true,item:addConsumption(request.params.id,request.body)});}catch(error){response.status(400).json({success:false,message:error.message||"消费记录保存失败。"});}});
app.post("/api/customer-center/customers/:id/tags", requireCustomerMaintain, (request,response)=>{try{assertCustomerAccess(request.user,request.params.id);response.status(201).json({success:true,item:addTag(request.params.id,request.body,request.user.id)});}catch(error){response.status(400).json({success:false,message:error.message||"客户标签保存失败。"});}});
app.post("/api/customer-center/customers/:id/followups", requireCustomerMaintain, (request,response)=>{try{assertCustomerAccess(request.user,request.params.id);response.status(201).json({success:true,item:addFollowup(request.params.id,request.body,request.user.id)});}catch(error){response.status(400).json({success:false,message:error.message||"跟进记录保存失败。"});}});

function aiEnterpriseKnowledge(){const db=getDatabase();const safe=(sql)=>{try{return db.prepare(sql).all();}catch{return[];}};return{actionStandards:safe("SELECT id,name FROM task_templates WHERE status='active' AND defaultProcessTemplateId IS NOT NULL ORDER BY updatedAt DESC LIMIT 30"),effectiveImprovements:[...safe("SELECT id,title,resultSummary,'connection' AS objectType FROM connection_improvements WHERE status='effective' ORDER BY updatedAt DESC LIMIT 15"),...safe("SELECT id,title,resultSummary,'product' AS objectType FROM product_improvements WHERE status='effective' ORDER BY updatedAt DESC LIMIT 15")]};}
function aiEvidence(request){const type=String(request.body?.analysisType||"");let evidence;if(type==="company"){if(!hasPermission(request.user,"dataCenter.view"))throw new Error("没有经营驾驶舱权限。");evidence=getOperationDashboard();}else if(type==="product"){if(!hasPermission(request.user,"products.view"))throw new Error("没有产品数据权限。");const scoped=filterDataByScope(readAllData({exclude:["salesLinks","salesLinkSkus"]}),request.user);if(!scoped.products?.some(item=>item.id===request.body?.objectId))throw new Error("无权分析该产品。");evidence=getProductBusinessAnalysis(request.body.objectId);}else if(type==="connection"){if(!hasPermission(request.user,"links.view")&&!hasPermission(request.user,"products.view"))throw new Error("没有连接数据权限。");evidence=getConnectionGrowthAnalysis(request.body.objectId);}else if(type==="finance"){if(!hasPermission(request.user,"finance.view"))throw new Error("没有财务数据权限。");evidence=getFinanceStatement(request.body||{});}else if(type==="supply"){if(!hasPermission(request.user,"supplyChain.view")&&!hasPermission(request.user,"products.view"))throw new Error("没有供应链数据权限。");evidence=getSupplyChainOverview();}else if(type==="customer"){if(!hasPermission(request.user,"customers.view"))throw new Error("没有客户数据权限。");evidence=getCustomerOverview(customerScope(request.user));}else throw new Error("分析类型无效。");return{...evidence,knowledge:aiEnterpriseKnowledge()};}
app.get("/api/ai-operation/analyses",requireAiView,(request,response)=>{try{response.json({success:true,items:listAnalyses(request.user.id,getDataScope(request.user)==="all")});}catch(error){response.status(400).json({success:false,message:error.message||"分析记录读取失败。"});}});
app.get("/api/ai-operation/analyses/:id",requireAiView,(request,response)=>{try{const item=readAnalysis(request.params.id);if(getDataScope(request.user)!=="all"&&item.generatedBy!==request.user.id)return response.status(403).json({success:false,message:"无权查看该分析。"});response.json({success:true,item});}catch(error){response.status(404).json({success:false,message:error.message||"分析不存在。"});}});
app.post("/api/ai-operation/analyses",requireAiAnalyze,(request,response)=>{try{response.status(201).json({success:true,item:createAnalysis(request.body,request.user.id,aiEvidence(request))});}catch(error){response.status(400).json({success:false,message:error.message||"经营分析失败。"});}});
app.post("/api/ai-operation/analyses/:id/confirm",requireAiConfirm,(request,response)=>{try{const item=readAnalysis(request.params.id);if(getDataScope(request.user)!=="all"&&item.generatedBy!==request.user.id)return response.status(403).json({success:false,message:"无权确认该分析。"});response.json({success:true,item:confirmAnalysis(item.id,request.user.id)});}catch(error){response.status(400).json({success:false,message:error.message||"分析确认失败。"});}});
app.post("/api/ai-operation/analyses/:id/action",requireAiAction,(request,response)=>{try{const item=readAnalysis(request.params.id);if(getDataScope(request.user)!=="all"&&item.generatedBy!==request.user.id)return response.status(403).json({success:false,message:"无权转化该分析。"});response.status(201).json({success:true,...createAnalysisAction(item.id,request.body,request.user.id)});}catch(error){response.status(400).json({success:false,message:error.message||"改善行动创建失败。"});}});

app.get("/api/product-management/overview", requirePermission("products.view"), (request, response) => {
  try {
    const scoped = filterDataByScope(readAllData({ exclude: ["salesLinks", "salesLinkSkus"] }), request.user);
    response.json({ success: true, overview: getProductV2Overview(), lifecycleStatuses: productLifecycleStatuses,
      moduleData: { products: scoped.products ?? [], actionProducts: scoped.actionProducts ?? [], erpGoods: scoped.erpGoods ?? [],
        productErpMappings: scoped.productErpMappings ?? [], salesShops: scoped.salesShops ?? [], salesShopAliases: scoped.salesShopAliases ?? [],
        productImportBatches: scoped.productImportBatches ?? [], erpImportBatches: scoped.erpImportBatches ?? [],
        platformSkuManualBindings: scoped.platformSkuManualBindings ?? [] } });
  }
  catch (error) { response.status(400).json({ success: false, message: error.message || "产品经营概览读取失败。" }); }
});

app.get("/api/product-management/products/:id", requirePermission("products.view"), (request, response) => {
  try { response.json({ success: true, detail: getProductV2Detail(request.params.id), lifecycleStatuses: productLifecycleStatuses }); }
  catch (error) { response.status(404).json({ success: false, message: error.message || "产品经营详情读取失败。" }); }
});

app.post("/api/product-management/products/:id/lifecycle", requirePermission("products.edit"), (request, response) => {
  try { response.json({ success: true, event: changeProductLifecycle(request.params.id, request.body, request.user.id) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "产品生命周期更新失败。" }); }
});

app.post("/api/product-management/products/:id/evaluate", requirePermission("products.edit"), (request, response) => {
  try { response.json({ success: true, healthRecord: evaluateProductHealth(request.params.id) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "产品经营评价失败。" }); }
});

app.post("/api/product-management/issues/:id/improvement-action", requirePermission("products.edit"), (request, response) => {
  try { response.status(201).json({ success: true, ...createProductImprovementAction(request.params.id, request.body, request.user.id) }); }
  catch (error) { response.status(400).json({ success: false, message: error.message || "产品改善行动创建失败。" }); }
});

app.get("/api/data-center/trends", requirePermission("dataCenter.view"), (request, response) => {
  try {
    response.json({ success: true, ...getTrendProducts(request.query) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "产品趋势读取失败。" });
  }
});

app.get("/api/data-center/slow-moving", requirePermission("dataCenter.view"), (request, response) => {
  try {
    response.json({ success: true, ...getSlowMovingProducts(request.query) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "长期滞销分析读取失败。" });
  }
});

app.get("/api/data-center/capital-occupation", requirePermission("dataCenter.view"), (request, response) => {
  try {
    response.json({ success: true, ...getCapitalOccupationProducts(request.query) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "资金占用分析读取失败。" });
  }
});

app.get("/api/data-center/products/:productId", requirePermission("dataCenter.view"), (request, response) => {
  try {
    const detail = getDataCenterProductDetail(request.params.productId, String(request.query.source ?? "trends"));
    if (!detail) {
      response.status(404).json({ success: false, message: "该产品没有正式历史快照。" });
      return;
    }
    response.json({ success: true, detail });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "产品分析详情读取失败。" });
  }
});

app.get("/api/connections", requireLinkView, (_request, response) => {
  try {
    response.json({ success: true, items: listConnectionProfiles() });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "连接列表读取失败。" });
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

app.get("/api/connection-data-mappings/repair-candidates", requireLinkManage, (_request, response) => {
  try {
    response.json({ success: true, items: listConnectionMappingRepairCandidates() });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "异常映射修复清单读取失败。" });
  }
});

app.get("/api/connections/:id", requireLinkView, (request, response) => {
  try {
    response.json({ success: true, item: readConnectionProfile(request.params.id) });
  } catch (error) {
    response.status(404).json({ success: false, message: error.message || "连接档案不存在。" });
  }
});

app.put("/api/connections/:id", requireLinkManage, (request, response) => {
  try {
    response.json({ success: true, item: updateConnectionProfile(request.params.id, request.body) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "连接档案更新失败。" });
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

app.get("/api/connections/:id/actions", requireLinkView, (request, response) => {
  try {
    response.json({ success: true, items: listConnectionActions(request.params.id) });
  } catch (error) {
    response.status(404).json({ success: false, message: error.message || "经营动作读取失败。" });
  }
});

app.post("/api/connections/:id/actions", requireLinkManage, (request, response) => {
  try {
    response.status(201).json({ success: true, item: createConnectionAction(request.params.id, request.body, request.user?.id) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "经营动作创建失败。" });
  }
});

app.delete("/api/connections/:id/actions/:actionId", requireLinkManage, (request, response) => {
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

app.post("/api/connection-data-mappings", requireLinkManage, (request, response) => {
  try {
    response.status(201).json({ success: true, item: createConnectionDataMapping(request.body, request.user?.id) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "外部数据映射创建失败。" });
  }
});

app.put("/api/connection-data-mappings/:id", requireLinkManage, (request, response) => {
  try {
    response.json({ success: true, item: updateConnectionDataMapping(request.params.id, request.body, request.user?.id) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "外部数据映射更新失败。" });
  }
});

app.delete("/api/connection-data-mappings/:id", requireLinkManage, (request, response) => {
  try {
    response.json(deleteConnectionDataMapping(request.params.id, request.user?.id));
  } catch (error) {
    response.status(404).json({ success: false, message: error.message || "外部数据映射删除失败。" });
  }
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

app.get("/api/connections/:id/period-snapshots", requireLinkView, (request, response) => {
  try {
    response.json({ success: true, items: listConnectionPeriodSnapshots(request.params.id) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "连接经营趋势读取失败。" });
  }
});

app.get("/api/connections/:id/growth-analysis", requireLinkView, (request, response) => {
  try {
    response.json({ success: true, item: getConnectionGrowthAnalysis(request.params.id) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "连接成长分析读取失败。" });
  }
});

app.get("/api/connection-growth-rankings", requireLinkView, (request, response) => {
  try {
    response.json({ success: true, ...listConnectionGrowthRankings(request.query.sort, request.query.limit) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "连接成长排行读取失败。" });
  }
});

app.get("/api/connection-management/overview", requireLinkView, (_request, response) => {
  try {
    response.json({ success: true, ...getConnectionManagementOverview() });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "链接经营概览读取失败。" });
  }
});

app.get("/api/connections/:id/health-records", requireLinkHealth, (request, response) => {
  try {
    response.json({ success: true, items: listConnectionHealthRecords(request.params.id) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "连接体检记录读取失败。" });
  }
});

app.post("/api/connections/:id/health-records", requireLinkHealthManage, (request, response) => {
  try {
    response.status(201).json({ success: true, ...createConnectionHealthRecord(request.params.id, request.body?.snapshotId) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "连接体检生成失败。" });
  }
});

app.get("/api/connection-health-records/attention", requireLinkHealth, (_request, response) => {
  try {
    response.json({ success: true, ...listAttentionConnectionHealthRecords() });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "待关注连接读取失败。" });
  }
});

app.post("/api/connection-health-records/:id/improvement-action", requireLinkImprove, (request, response) => {
  if (!hasPermission(request.user, "workPlans.launch")) {
    response.status(403).json({ success: false, message: "你没有权限创建改善行动。" });
    return;
  }
  try {
    response.status(201).json({ success: true, ...createImprovementAction(request.params.id, request.body, request.user?.id) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "改善行动创建失败。" });
  }
});

app.get("/api/connection-improvements", requireLinkView, (request, response) => {
  try {
    response.json({ success: true, items: listConnectionImprovements(request.query) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "连接改善记录读取失败。" });
  }
});

app.get("/api/connection-improvements/summary", requireLinkView, (_request, response) => {
  try {
    response.json({ success: true, summary: getConnectionImprovementSummary() });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "连接改善概览读取失败。" });
  }
});

app.post("/api/connection-improvements", requireLinkImprove, (request, response) => {
  try {
    response.status(201).json({ success: true, ...createConnectionImprovement(request.body ?? {}, request.user?.id) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "连接改善项目创建失败。" });
  }
});

app.put("/api/connection-improvements/:id", requireLinkImprove, (request, response) => {
  try {
    response.json({ success: true, item: updateConnectionImprovement(request.params.id, request.body ?? {}) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "连接改善结果保存失败。" });
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

app.post("/api/products/erp-v2/:id/validate", requirePermission("products.create"), (request, response) => {
  try {
    response.json({ success: true, ...validateErpV2Import(request.params.id, request.body ?? {}) });
  } catch (error) {
    console.error("产品中心 V2 ERP校验失败", error);
    response.status(400).json({ success: false, message: error.message || "ERP导入校验失败。" });
  }
});

app.get("/api/products/erp-v2/:id", requirePermission("products.create"), (request, response) => {
  try {
    response.json({ success: true, ...readErpV2Import(request.params.id) });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "ERP导入批次读取失败。" });
  }
});

app.post("/api/products/erp-v2/:id/preview", requirePermission("products.create"), (request, response) => {
  try {
    response.json({ success: true, ...previewErpV2Import(request.params.id, request.body ?? {}) });
  } catch (error) {
    console.error("产品中心 V2 ERP预览读取失败", error);
    response.status(400).json({ success: false, message: error.message || "ERP导入预览读取失败。" });
  }
});

app.post("/api/products/erp-v2/:id/commit", requirePermission("products.create"), (request, response) => {
  try {
    const result = commitErpV2Import(request.params.id, request.body ?? {});
    response.json({ success: true, ...result, data: filterDataByScope(readAllData(), request.user) });
  } catch (error) {
    console.error("产品中心 V2 ERP提交失败", error);
    response.status(400).json({ success: false, message: error.message || "ERP导入提交失败。" });
  }
});

app.get("/api/products/platform-skus/unmatched", requirePermission("products.view"), (request, response) => {
  try {
    const database = getDatabase();
    const query = String(request.query.query ?? "").trim();
    const limit = Math.min(200, Math.max(20, Number(request.query.limit) || 100));
    const offset = Math.max(0, Number(request.query.offset) || 0);
    const search = `%${query}%`;
    const where = `
      x.productId IS NULL
      AND x.currentState='active'
      AND l.currentState='active'
      AND x.matchStatus NOT IN ('ignored','combination')
      AND (? = '' OR x.platformSkuCode LIKE ? OR x.platformSkuId LIKE ? OR x.specificationName LIKE ?
        OR l.title LIKE ? OR l.platformGoodsCode LIKE ? OR l.platformGoodsId LIKE ?)
    `;
    const params = [query, search, search, search, search, search, search];
    const total = database.prepare(`
      SELECT COUNT(*) AS total
      FROM sales_link_skus x
      JOIN sales_links l ON l.id=x.salesLinkId
      WHERE ${where}
    `).get(...params).total;
    const rows = database.prepare(`
      SELECT
        x.*, l.shopId, l.platformGoodsId, l.platformGoodsCode, l.title, l.rawUrl, l.canonicalUrl,
        s.platform, s.shopName, s.displayName,
        g.id AS possibleErpGoodsId, g.goodsCode AS possibleErpGoodsCode, g.goodsName AS possibleErpGoodsName
      FROM sales_link_skus x
      JOIN sales_links l ON l.id=x.salesLinkId
      JOIN sales_shops s ON s.id=l.shopId
      LEFT JOIN erp_goods g ON lower(g.goodsCode)=lower(l.platformGoodsCode)
      WHERE ${where}
      ORDER BY s.platform, s.displayName, l.title, x.platformSkuCode
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
    response.json({ success: true, rows, pagination: { total, limit, offset } });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "未匹配平台SKU读取失败。" });
  }
});

app.get("/api/products/sales-summary", requirePermission("products.view"), (request, response) => {
  try {
    const database = getDatabase();
    const rows = database.prepare(`
      SELECT
        x.productId,
        COUNT(DISTINCT x.salesLinkId) AS linkCount,
        COUNT(DISTINCT l.shopId) AS shopCount,
        COUNT(DISTINCT s.platform) AS platformCount,
        json_group_array(DISTINCT s.platform) AS platformsJson
      FROM sales_link_skus x
      JOIN sales_links l ON l.id=x.salesLinkId
      JOIN sales_shops s ON s.id=l.shopId
      WHERE x.productId IS NOT NULL
        AND x.currentState='active'
        AND l.currentState='active'
        AND x.matchStatus IN ('matched_auto','matched_manual')
      GROUP BY x.productId
    `).all().map((row) => ({
      productId: row.productId,
      linkCount: Number(row.linkCount) || 0,
      shopCount: Number(row.shopCount) || 0,
      platformCount: Number(row.platformCount) || 0,
      platforms: JSON.parse(row.platformsJson || "[]").filter(Boolean),
    }));
    response.json({ success: true, rows });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "产品销售汇总读取失败。" });
  }
});

app.get("/api/products/pending-skus", requirePermission("products.view"), (request, response) => {
  try {
    response.json({
      success: true,
      rows: listPendingErpSkus(request.query.search),
    });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "待建立SKU读取失败。" });
  }
});

app.post("/api/products/pending-skus/batch-create-products", requirePermission("products.create"), (request, response) => {
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

app.post("/api/products/pending-skus/:id/create-product", requirePermission("products.create"), (request, response) => {
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
    const rows = database.prepare(`
      SELECT
        x.*, l.shopId, l.platformGoodsId, l.platformGoodsCode, l.title, l.rawUrl, l.canonicalUrl,
        l.status AS linkStatus, l.activityStatus, l.category, l.identityStrength,
        s.platform, s.shopName, s.displayName
      FROM sales_link_skus x
      JOIN sales_links l ON l.id=x.salesLinkId
      JOIN sales_shops s ON s.id=l.shopId
      WHERE x.productId=?
        AND x.currentState='active'
        AND l.currentState='active'
        AND x.matchStatus IN ('matched_auto','matched_manual')
      ORDER BY s.platform, s.displayName, l.title, x.platformSkuCode
    `).all(request.params.id);
    response.json({ success: true, productId: request.params.id, rows });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "产品销售链接读取失败。" });
  }
});

app.post("/api/products/platform-skus/:id/bind", requirePermission("products.edit"), (request, response) => {
  try {
    updatePlatformSkuManualBinding(request.params.id, String(request.body?.productId ?? ""), getUserPersonId(request.user));
    response.json({ success: true });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "人工绑定失败。" });
  }
});

app.delete("/api/products/platform-skus/:id/bind", requirePermission("products.edit"), (request, response) => {
  try {
    removePlatformSkuManualBinding(request.params.id);
    response.json({ success: true });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "取消绑定失败。" });
  }
});

app.post("/api/products/platform-skus/:id/mark", requirePermission("products.edit"), (request, response) => {
  try {
    markPlatformSku(request.params.id, String(request.body?.status ?? ""));
    response.json({ success: true });
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "标记失败。" });
  }
});

app.post("/api/process-instances/:id/cancel", requirePermission("processes.editInstances"), (request, response) => {
  try {
    cancelProcessInstance(request.params.id, request.body?.cancelReason ?? "");
    response.json({ success: true, data: filterDataByScope(readAllData(), request.user) });
  } catch (error) {
    console.error("取消关键行动失败", error);
    response.status(400).json({ success: false, message: error.message || "取消关键行动失败，请检查本地数据库服务。" });
  }
});

app.post("/api/process-instances/:id/start", (request, response) => {
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

app.put("/api/process-instances/:id/products", requirePermission("products.view"), (request, response) => {
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

app.post("/api/process-instances/batch-link-templates", (request, response) => {
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
  if (!hasPermission(request.user, "tasks.changeStatus")) {
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

app.post("/api/work-plans/:id/launch", requirePermission("workPlans.launch"), (request, response) => {
  try {
    if ((request.body?.productIds ?? []).length > 0 && !hasPermission(request.user, "products.view")) {
      response.status(403).json({ success: false, message: "你没有权限关联产品。" });
      return;
    }
    const existingWorkPlan = readAllData().workPlans.find((item) => item.id === request.params.id);
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

app.post("/api/work-plans/batch-launch", requirePermission("workPlans.launch"), (request, response) => {
  try {
    const rows = Array.isArray(request.body?.rows) ? request.body.rows : [];
    if (!hasPermission(request.user, "products.view") && rows.some((row) => (row?.productIds ?? []).length > 0)) {
      response.status(403).json({ success: false, message: "你没有权限关联产品。" });
      return;
    }
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
  requirePermission("workPlans.launch"),
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
  const permission = status === "canceled" ? "tasks.batchCancel" : "tasks.batchComplete";
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
    response.json({ success: true, result, data: filterDataByScope(readAllData(), request.user) });
  } catch (error) {
    console.error("批量任务状态保存失败", error);
    response.status(400).json({ success: false, message: error.message || "批量任务状态保存失败，请检查本地数据库服务。" });
  }
});

app.get("/api/tasks/:id", (request, response) => {
  if (!hasPermission(request.user, "tasks.viewDetail")) {
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
  const permission = action === "submit" ? "tasks.submitResult" : "tasks.changeStatus";
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
    const task = updateTaskFromWorkflow(request.params.id, action, request.body?.item ?? {});
    response.json({ success: true, task });
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
  const visibleTaskIds = getVisibleTaskIds(request.user);
  const visibleTaskIdSet = new Set(visibleTaskIds);
  response.json(
    readTaskWavesForTaskIds(visibleTaskIds).filter((wave) =>
      wave.taskIds.every((taskId) => visibleTaskIdSet.has(taskId)),
    ),
  );
});

app.get("/api/task-waves-regeneration/preview", (request, response) => {
  if (!isAdminUser(request.user) && !hasPermission(request.user, "processes.editSteps")) {
    response.status(403).json({ success: false, message: "你没有权限重新生成任务波次。" });
    return;
  }
  response.json({ success: true, preview: readTaskWaveRegenerationPreview() });
});

app.post("/api/task-waves-regeneration/run", (request, response) => {
  if (!isAdminUser(request.user) && !hasPermission(request.user, "processes.editSteps")) {
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
      hasPermission(request.user, "tasks.batchCancel") &&
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
  if (!hasPermission(request.user, "tasks.changeStatus")) {
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
  if (!hasPermission(request.user, "tasks.submitResult")) {
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
  if (!hasPermission(request.user, "tasks.submitResult")) {
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
  if (!isAdminUser(request.user) && !hasPermission(request.user, "tasks.batchCancel")) {
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
  if (!isAdminUser(request.user) && !hasPermission(request.user, "processes.editSteps")) {
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

app.put("/api/task-templates/:id/value-chain", requirePermission("settings.editStandardWorks"), (request, response) => {
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

app.patch("/api/process-template-nodes/:id/status", requirePermission("processes.editSteps"), (request, response) => {
  try {
    updateProcessTemplateNodeStatus(request.params.id, request.body?.status ?? "");
    response.json({ success: true, data: filterDataByScope(readAllData(), request.user) });
  } catch (error) {
    console.error("标准节点状态保存失败", error);
    response.status(400).json({ success: false, message: error.message || "标准节点状态保存失败，请检查本地数据库服务。" });
  }
});

const templateVersionResourceByType = { visual: "templates", action: "task-templates", form: "standard-work-forms", manual: "methodologies" };

function canWriteTemplateVersion(request, assetType, assetId, body = {}) {
  const resource = templateVersionResourceByType[assetType];
  if (!resource) return false;
  const existing = readRouteResourceItem(resource, assetId);
  const context = getResourceAuthorizationContext(resource, "PUT", request.user, body, existing);
  return authorizeResourceAction(resource, "write", context);
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
  if (!canWriteTemplateVersion(request, request.params.assetType, request.params.assetId, request.body?.content ?? {})) {
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
  if (!canWriteTemplateVersion(request, request.params.assetType, request.params.assetId)) {
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
    if (
      new Set(["work-plans", "process-instances"]).has(request.params.resource) &&
      rejectUnauthorizedActionTemplateLaunch(request.user, request.body ?? {}, response)
    ) return;
    const created = versionedTemplateResources.has(request.params.resource)
      ? getDatabase().transaction(() => {
          const item = createResource(request.params.resource, request.body);
          ensureInitialTemplateVersion(request.params.resource, item, request.user.id);
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

app.post("/api/products/:id/change-sku/preview", requirePermission("products.archive"), (request, response) => {
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

app.post("/api/products/:id/change-sku", requirePermission("products.archive"), (request, response) => {
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

app.delete("/api/process-templates/:id", requirePermission("processes.editTemplates"), (request, response) => {
  try {
    response.json(deleteProcessTemplate(request.params.id));
  } catch (error) {
    response.status(400).json({ success: false, message: error.message || "删除标准失败，请检查本地数据库服务。" });
  }
});

app.delete("/api/process-template-nodes/:id", requirePermission("processes.editSteps"), (request, response) => {
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
});

const keepAliveTimer = setInterval(() => {}, 60_000);

function shutdown() {
  clearInterval(keepAliveTimer);
  server.close(() => {
    closeDatabase();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
