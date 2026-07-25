import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import {
  closeDatabase,
  createResource,
  batchLinkProcessInstanceTemplates,
  batchUpdateTaskStatus,
  cancelExecutionGroup,
  cancelProcessInstance,
  completeExecutionGroup,
  createExecutionGroup,
  databasePath,
  deleteProcessTemplate,
  deleteProcessTemplateNode,
  findLoginUser,
  findLoginUserById,
  getPublicUser,
  initializeDatabase,
  launchWorkPlanWithProcess,
  moveTaskTemplateToValueChain,
  readAllData,
  readRouteResource,
  replaceActionProducts,
  replaceAllData,
  touchLastLoginAt,
  updateCurrentUserAvatar,
  startProcessInstanceExecution,
  startExecutionGroup,
  updateProcessTemplateNodeStatus,
  updateResource,
  updateTaskFromWorkflow,
  uploadsDir,
} from "./db.js";
import { createToken, verifyPassword, verifyToken } from "./security.js";
import { canLaunchActionTemplate, getDataScope, hasPermission } from "../src/permissions.js";
import { getProcessInstanceOwner } from "../src/data/processInstanceSelectors.js";

const app = express();
const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3001);
const imageUploadsDir = path.join(uploadsDir, "images");
const fileUploadsDir = path.join(uploadsDir, "files");
const standardWorkAttachmentsDir = path.join(uploadsDir, "standard-work-attachments");

initializeDatabase();
fs.mkdirSync(imageUploadsDir, { recursive: true });
fs.mkdirSync(fileUploadsDir, { recursive: true });
fs.mkdirSync(standardWorkAttachmentsDir, { recursive: true });

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

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use("/uploads", express.static(uploadsDir));

app.get("/api/health", (_request, response) => {
  try {
    fs.accessSync(databasePath, fs.constants.R_OK | fs.constants.W_OK);
    fs.accessSync(uploadsDir, fs.constants.R_OK | fs.constants.W_OK);
    const data = readAllData();
    response.json({
      ok: true,
      databasePath,
      databaseWritable: true,
      uploadsDir,
      uploadsWritable: true,
      counts: {
        goals: data.goals?.length ?? 0,
        workPlans: data.workPlans?.length ?? 0,
        tasks: data.tasks?.length ?? 0,
        processTemplates: data.processTemplates?.length ?? 0,
        processTemplateNodes: data.processTemplateNodes?.length ?? 0,
        taskTemplates: data.taskTemplates?.length ?? 0,
      },
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      databasePath,
      uploadsDir,
      message: error.message || "本地数据库或上传目录不可用。",
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
  return [item.ownerId, item.assigneeId, item.executorId, item.creatorId, item.personId, item.initiatorId, item.submittedBy, item.submitterId]
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
    hasPermission(user, "contentSchedules.view") ||
    hasPermission(user, "contentSchedules.create") ||
    hasPermission(user, "contentSchedules.edit")
  );
}

function canReadResource(resource, user) {
  if (resource === "products" || resource === "action-products") return hasPermission(user, "products.view");
  if (resource === "permission-templates") return hasPermission(user, "settings.managePermissions");
  if (resource === "stores") return canUseStoreOptions(user);
  if (resource === "publishing-accounts") return canUsePublishingAccountOptions(user);
  return true;
}

function filterDataByScope(data, user) {
  const dataScope = getDataScope(user);
  const stores = canUseStoreOptions(user) ? (data.stores ?? []) : [];
  const publishingAccounts = canUsePublishingAccountOptions(user) ? (data.publishingAccounts ?? []) : [];
  const permissionTemplates = hasPermission(user, "settings.managePermissions") ? (data.permissionTemplates ?? []) : [];
  const products = hasPermission(user, "products.view") ? (data.products ?? []) : [];
  const visibleProductIds = new Set(products.map((product) => product.id));
  if (dataScope === "all") {
    const actionProducts = (data.actionProducts ?? []).filter((item) => visibleProductIds.has(item.productId));
    return { ...data, stores, publishingAccounts, permissionTemplates, products, actionProducts };
  }

  const scopedTasks = filterByScope(data.tasks ?? [], user);
  const scopedTaskIds = new Set(scopedTasks.map((task) => task.id));
  const scopedExecutionGroups = (data.executionGroups ?? []).filter((group) =>
    (Array.isArray(group.taskIds) ? group.taskIds : []).some((taskId) => scopedTaskIds.has(taskId)),
  );
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
    executionGroups: scopedExecutionGroups,
    processInstances: scopedProcessInstances,
    products,
    actionProducts: scopedActionProducts,
    contentSchedules: scopedContentSchedules,
    workPlans: scopedWorkPlans,
    weeklyReports: scopedWeeklyReports,
    weeklyReportProblems: scopedWeeklyReportProblems,
  };
}

function getResourceWritePermission(resource, method, body = {}) {
  if (resource === "products") {
    if (method === "POST") return "products.create";
    return body.status === "已归档" ? "products.archive" : "products.edit";
  }
  if (resource === "action-products") return "products.__managedRelation";
  if (resource === "goals") return method === "POST" ? "goals.create" : "goals.edit";
  if (resource === "work-plans") return "workPlans.launch";
  if (resource === "tasks") {
    if (method === "POST" && body.source === "process") return "workPlans.launch";
    if (body.submitFormData !== undefined || body.submitFiles !== undefined || body.submitLinks !== undefined) return "tasks.submitResult";
    if (body.status !== undefined) return "tasks.changeStatus";
    return "tasks.changeStatus";
  }
  if (resource === "execution-groups") return "tasks.batchComplete";
  if (resource === "task-templates") {
    if (body.formFields !== undefined) return "settings.editStandardWorkForms";
    return "settings.editStandardWorks";
  }
  if (resource === "process-templates") return "processes.editTemplates";
  if (resource === "process-template-nodes") return ["processes.editSteps", "processes.sortSteps"];
  if (resource === "process-instances") return method === "POST" ? "workPlans.launch" : "processes.editInstances";
  if (resource === "methodologies") return method === "POST" ? "methods.create" : "methods.edit";
  if (resource === "persons" || resource === "people") {
    const writesPermissions = ["permissions", "permissionTemplateId", "permissionOverrides"].some((key) =>
      Object.prototype.hasOwnProperty.call(body, key),
    );
    return writesPermissions ? "settings.managePermissions" : "settings.editPeople";
  }
  if (resource === "permission-templates") return "settings.managePermissions";
  if (resource === "departments" || resource === "positions") return "settings.editOrg";
  if (resource === "categories") return "settings.editCategories";
  if (resource === "stores") return "settings.editStores";
  if (resource === "publishing-accounts") return "settings.editStandardWorkForms";
  if (resource === "weekly-reports") return method === "POST" ? "assessment.fillWeeklyReport" : "assessment.editWeeklyReport";
  if (resource === "weekly-report-problems") return method === "POST" ? "assessment.updateProblems" : "assessment.updateProblems";
  if (resource === "content-schedules") return method === "POST" ? "contentSchedules.create" : "contentSchedules.edit";
  if (resource === "standard-work-forms") return "settings.editStandardWorkForms";
  if (resource === "template-tag-categories" || resource === "template-tags") return "settings.editStandardWorkForms";
  if (resource === "issues-requirements") return "settings.editStandardWorkForms";
  return null;
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
    response.json(filterDataByScope(readAllData(), request.user));
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
  try {
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
    const userPersonId = getUserPersonId(request.user);
    const processOwnerId = getProcessInstanceOwner(instance.id, data).userId;
    const processNode = data.processTemplateNodes.find((item) => item.id === task.processNodeId);
    const stepOwnerId = processNode === undefined ? task.ownerId : processNode.ownerId;
    const canChangeExecutor =
      isAdminUser(request.user) ||
      (userPersonId !== "" && (userPersonId === processOwnerId || userPersonId === stepOwnerId));
    if (!canChangeExecutor) {
      response.status(403).json({ success: false, message: "只有管理员、关键行动负责人或标准步骤负责人可以调整任务执行人。" });
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
    launchWorkPlanWithProcess(request.params.id, request.body ?? {});
    response.json({ success: true, data: filterDataByScope(readAllData(), request.user) });
  } catch (error) {
    console.error("发起关键行动失败", error);
    response.status(400).json({ success: false, message: error.message || "发起关键行动失败，请检查本地数据库服务。" });
  }
});

app.post("/api/execution-groups/create", requirePermission("tasks.batchComplete"), (request, response) => {
  try {
    createExecutionGroup(request.body ?? {});
    response.json({ success: true, data: filterDataByScope(readAllData(), request.user) });
  } catch (error) {
    console.error("执行组创建失败", error);
    response.status(400).json({ success: false, message: error.message || "执行组创建失败，请检查本地数据库服务。" });
  }
});

app.post("/api/execution-groups/:id/start", requirePermission("tasks.batchComplete"), (request, response) => {
  try {
    startExecutionGroup(request.params.id);
    response.json({ success: true, data: filterDataByScope(readAllData(), request.user) });
  } catch (error) {
    console.error("执行组开始失败", error);
    response.status(400).json({ success: false, message: error.message || "执行组开始失败，请检查本地数据库服务。" });
  }
});

app.post("/api/execution-groups/:id/cancel", requirePermission("tasks.batchComplete"), (request, response) => {
  try {
    cancelExecutionGroup(request.params.id);
    response.json({ success: true, data: filterDataByScope(readAllData(), request.user) });
  } catch (error) {
    console.error("执行组取消失败", error);
    response.status(400).json({ success: false, message: error.message || "执行组取消失败，请检查本地数据库服务。" });
  }
});

app.post("/api/execution-groups/:id/complete", requirePermission("tasks.batchComplete"), (request, response) => {
  try {
    completeExecutionGroup(request.params.id, request.body ?? {});
    response.json({ success: true, data: filterDataByScope(readAllData(), request.user) });
  } catch (error) {
    console.error("执行组完成失败", error);
    response.status(400).json({ success: false, message: error.message || "执行组完成失败，请检查本地数据库服务。" });
  }
});

app.post("/api/tasks/batch-status", (request, response) => {
  const status = String(request.body?.status ?? "").trim();
  const permission = status === "canceled" ? "tasks.batchCancel" : "tasks.batchComplete";
  if (!hasPermission(request.user, permission)) {
    response.status(403).json({ success: false, message: "你没有权限进行该操作" });
    return;
  }
  try {
    const result = batchUpdateTaskStatus(request.body ?? {});
    response.json({ success: true, result, data: filterDataByScope(readAllData(), request.user) });
  } catch (error) {
    console.error("批量任务状态保存失败", error);
    response.status(400).json({ success: false, message: error.message || "批量任务状态保存失败，请检查本地数据库服务。" });
  }
});

app.post("/api/tasks/:id/workflow", (request, response) => {
  const action = String(request.body?.action ?? "").trim();
  const permission = action === "submit" ? "tasks.submitResult" : "tasks.changeStatus";
  if (!hasPermission(request.user, permission)) {
    response.status(403).json({ success: false, message: "你没有权限进行该任务流程操作" });
    return;
  }
  try {
    const task = updateTaskFromWorkflow(request.params.id, action, request.body?.item ?? {});
    response.json({ success: true, task });
  } catch (error) {
    console.error("任务流程操作失败", error);
    response.status(400).json({ success: false, message: error.message || "任务流程操作失败，请检查本地数据库服务。" });
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

app.get("/api/:resource", (request, response) => {
  try {
    if (!canReadResource(request.params.resource, request.user)) {
      response.status(403).json({ success: false, message: "你没有权限查看该数据" });
      return;
    }
    response.json(readRouteResource(request.params.resource));
  } catch (error) {
    response.status(404).json({ error: error.message });
  }
});

app.post("/api/:resource", (request, response) => {
  try {
    if (rejectLegacyContentScheduleWrite(request.params.resource, response)) return;
    const permission = getResourceWritePermission(request.params.resource, "POST", request.body ?? {});
    const allowed = Array.isArray(permission)
      ? permission.some((item) => hasPermission(request.user, item))
      : permission === null || hasPermission(request.user, permission);
    if (!allowed) {
      response.status(403).json({ success: false, message: "你没有权限进行该操作" });
      return;
    }
    if (
      new Set(["work-plans", "process-instances"]).has(request.params.resource) &&
      rejectUnauthorizedActionTemplateLaunch(request.user, request.body ?? {}, response)
    ) return;
    response.status(201).json(createResource(request.params.resource, request.body));
  } catch (error) {
    response.status(404).json({ error: error.message });
  }
});

app.put("/api/:resource/:id", (request, response) => {
  try {
    if (rejectLegacyContentScheduleWrite(request.params.resource, response)) return;
    if (request.params.resource === "tasks" && request.body?.status !== undefined) {
      const task = readAllData().tasks.find((item) => item.id === request.params.id);
      if (task === undefined) {
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
    const permission = getResourceWritePermission(request.params.resource, "PUT", request.body ?? {});
    const allowed = Array.isArray(permission)
      ? permission.some((item) => hasPermission(request.user, item))
      : permission === null || hasPermission(request.user, permission);
    if (!allowed) {
      response.status(403).json({ success: false, message: "你没有权限进行该操作" });
      return;
    }
    response.json(updateResource(request.params.resource, request.params.id, request.body));
  } catch (error) {
    response.status(404).json({ error: error.message });
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
