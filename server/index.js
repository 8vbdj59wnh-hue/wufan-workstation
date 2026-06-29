import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import {
  closeDatabase,
  createResource,
  cancelProcessInstance,
  databasePath,
  findLoginUser,
  findLoginUserById,
  getPublicUser,
  initializeDatabase,
  readAllData,
  readRouteResource,
  replaceAllData,
  touchLastLoginAt,
  updateResource,
  uploadsDir,
} from "./db.js";
import { createToken, verifyPassword, verifyToken } from "./security.js";
import { getDataScope, hasPermission } from "../src/permissions.js";

const app = express();
const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3001);
const imageUploadsDir = path.join(uploadsDir, "images");
const fileUploadsDir = path.join(uploadsDir, "files");

initializeDatabase();
fs.mkdirSync(imageUploadsDir, { recursive: true });
fs.mkdirSync(fileUploadsDir, { recursive: true });

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
  limits: { fileSize: 5 * 1024 * 1024 },
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
  "video/webm",
]);
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
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    if (!allowedFileTypes.has(file.mimetype)) {
      callback(new Error("只支持图片、PDF、Word、Excel、ZIP 和文本文件。"));
      return;
    }
    callback(null, true);
  },
});

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use("/uploads", express.static(uploadsDir));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, databasePath });
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
      response.status(403).json({ success: false, message: "你没有权限执行该操作" });
      return;
    }
    next();
  };
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

function filterDataByScope(data, user) {
  const dataScope = getDataScope(user);
  if (dataScope === "all") return data;

  const scopedTasks = filterByScope(data.tasks ?? [], user);
  const scopedWorkPlans = filterByScope(data.workPlans ?? [], user);
  const scopedProcessInstances = filterByScope(data.processInstances ?? [], user);
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
    goals: scopedGoals,
    tasks: scopedTasks,
    processInstances: scopedProcessInstances,
    contentSchedules: scopedContentSchedules,
    workPlans: scopedWorkPlans,
    weeklyReports: scopedWeeklyReports,
    weeklyReportProblems: scopedWeeklyReportProblems,
  };
}

function getResourceWritePermission(resource, method, body = {}) {
  if (resource === "goals") return method === "POST" ? "goals.create" : "goals.edit";
  if (resource === "work-plans") return body.launchedAt ? "workPlans.launch" : "workPlans.editFuture";
  if (resource === "tasks") {
    if (body.submitFormData !== undefined || body.submitFiles !== undefined || body.submitLinks !== undefined) return "tasks.submitResult";
    if (body.status !== undefined) return "tasks.changeStatus";
    return "tasks.changeStatus";
  }
  if (resource === "task-templates") {
    if (body.formFields !== undefined) return "settings.editStandardWorkForms";
    return "settings.editStandardWorks";
  }
  if (resource === "process-templates") return "processes.editTemplates";
  if (resource === "process-template-nodes") return ["processes.editSteps", "processes.sortSteps"];
  if (resource === "methodologies") return method === "POST" ? "methods.create" : "methods.edit";
  if (resource === "persons" || resource === "people") return "settings.editPeople";
  if (resource === "departments" || resource === "positions") return "settings.editOrg";
  if (resource === "categories") return "settings.editCategories";
  if (resource === "stores") return "settings.editStores";
  if (resource === "weekly-reports") return method === "POST" ? "assessment.fillWeeklyReport" : "assessment.editWeeklyReport";
  if (resource === "weekly-report-problems") return method === "POST" ? "assessment.updateProblems" : "assessment.updateProblems";
  if (resource === "content-schedules") return method === "POST" ? "contentSchedules.create" : "contentSchedules.edit";
  return null;
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

app.get("/api/data", (request, response) => {
  try {
    response.json(filterDataByScope(readAllData(), request.user));
  } catch (error) {
    response.status(500).json({ error: error.message || "读取本地数据库失败。" });
  }
});

app.post("/api/data", requirePermission("settings.managePermissions"), (request, response) => {
  try {
    replaceAllData(request.body ?? {});
    response.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (error) {
    response.status(500).json({ error: error.message || "保存本地数据库失败。" });
  }
});

app.post("/api/uploads/image", (request, response) => {
  uploadImage.single("image")(request, response, (error) => {
    if (error !== undefined) {
      const message =
        error.code === "LIMIT_FILE_SIZE" ? "图片大小不能超过 5MB。" : error.message || "图片上传失败。";
      response.status(400).json({ error: message });
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
        error.code === "LIMIT_FILE_SIZE" ? "文件大小不能超过 20MB。" : error.message || "文件上传失败。";
      response.status(400).json({ error: message });
      return;
    }

    if (request.file === undefined) {
      response.status(400).json({ error: "请选择要上传的文件。" });
      return;
    }

    response.json({
      url: `/uploads/files/${request.file.filename}`,
      filename: request.file.filename,
      originalName: request.file.originalname,
      size: request.file.size,
      mimeType: request.file.mimetype,
    });
  });
});

app.post("/api/process-instances/:id/cancel", requirePermission("processes.editInstances"), (request, response) => {
  try {
    cancelProcessInstance(request.params.id, request.body?.cancelReason ?? "");
    response.json({ success: true, data: filterDataByScope(readAllData(), request.user) });
  } catch (error) {
    console.error("取消流程失败", error);
    response.status(400).json({ success: false, message: error.message || "取消流程失败，请检查本地数据库服务。" });
  }
});

app.get("/api/:resource", (request, response) => {
  try {
    response.json(readRouteResource(request.params.resource));
  } catch (error) {
    response.status(404).json({ error: error.message });
  }
});

app.post("/api/:resource", (request, response) => {
  try {
    const permission = getResourceWritePermission(request.params.resource, "POST", request.body ?? {});
    const allowed = Array.isArray(permission)
      ? permission.some((item) => hasPermission(request.user, item))
      : permission === null || hasPermission(request.user, permission);
    if (!allowed) {
      response.status(403).json({ success: false, message: "你没有权限执行该操作" });
      return;
    }
    response.status(201).json(createResource(request.params.resource, request.body));
  } catch (error) {
    response.status(404).json({ error: error.message });
  }
});

app.put("/api/:resource/:id", (request, response) => {
  try {
    const permission = getResourceWritePermission(request.params.resource, "PUT", request.body ?? {});
    const allowed = Array.isArray(permission)
      ? permission.some((item) => hasPermission(request.user, item))
      : permission === null || hasPermission(request.user, permission);
    if (!allowed) {
      response.status(403).json({ success: false, message: "你没有权限执行该操作" });
      return;
    }
    response.json(updateResource(request.params.resource, request.params.id, request.body));
  } catch (error) {
    response.status(404).json({ error: error.message });
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
