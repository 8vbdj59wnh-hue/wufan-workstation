import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { hashPassword } from "./security.js";
import { normalizePermissions, serializePermissions } from "../src/permissions.js";
import {
  categories,
  companies,
  contentSchedules,
  departments,
  executionGroups,
  goals,
  people,
  publishingAccounts,
  positions,
  processInstances,
  processTemplateNodes,
  processTemplates,
  stores,
  taskTemplates,
  tasks,
  templates,
  templateTagCategories,
  templateTags,
  weeklyReportProblems,
  weeklyReports,
  workPlans,
  notifications,
  issuesRequirements,
  standardWorkForms,
} from "../src/data/mockData.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
export const dataDir = path.join(projectRoot, "data");
export const uploadsDir = path.join(projectRoot, "uploads");
export const databasePath = path.join(dataDir, "workstation.db");
const schemaPath = path.join(__dirname, "schema.sql");
const standardWorkValueChainCategories = [
  "基础设施维护",
  "人力资产管理",
  "产品开发与淘汰",
  "供应链管理",
  "品牌营销",
  "渠道销售",
  "客户维护",
];
const standardWorkValueChainModules = [
  { id: "infrastructure_maintenance", name: "基础设施维护" },
  { id: "human_asset_management", name: "人力资产管理" },
  { id: "product_development", name: "产品开发与淘汰" },
  { id: "supply_chain_management", name: "供应链管理" },
  { id: "brand_marketing", name: "品牌营销" },
  { id: "channel_sales", name: "渠道销售" },
  { id: "customer_maintenance", name: "客户维护" },
];
const resourceConfigs = {
  companies: {
    table: "companies",
    columns: ["id", "name", "status", "createdAt", "updatedAt"],
  },
  departments: {
    table: "departments",
    columns: ["id", "companyId", "name", "leaderId", "parentDepartmentId", "sortOrder", "status", "createdAt", "updatedAt"],
  },
  positions: {
    table: "positions",
    columns: ["id", "departmentId", "name", "sortOrder", "status", "createdAt", "updatedAt"],
  },
  people: {
    table: "persons",
    columns: [
      "id",
      "name",
      "account",
      "departmentId",
      "positionId",
      "directManagerId",
      "role",
      "avatarUrl",
      "username",
      "canLogin",
      "authRole",
      "lastLoginAt",
      "mustChangePassword",
      "permissions",
      "status",
      "createdAt",
      "updatedAt",
    ],
    booleanFields: ["canLogin", "mustChangePassword"],
    jsonFields: ["permissions"],
  },
  categories: {
    table: "categories",
    columns: ["id", "type", "name", "sortOrder", "status", "createdAt", "updatedAt"],
  },
  stores: {
    table: "stores",
    columns: ["id", "name", "platform", "brand", "type", "ownerId", "status", "remark", "createdAt", "updatedAt"],
  },
  publishingAccounts: {
    table: "publishing_accounts",
    columns: ["id", "name", "platform", "ownerId", "status", "createdAt", "updatedAt"],
  },
  weeklyReports: {
    table: "weekly_reports",
    columns: [
      "id",
      "weekStart",
      "weekEnd",
      "weekLabel",
      "departmentId",
      "submitterId",
      "relatedGoalIds",
      "goalAlignedWork",
      "workEffectReview",
      "efficiencyReview",
      "status",
      "submittedAt",
      "createdAt",
      "updatedAt",
    ],
    jsonFields: ["relatedGoalIds"],
  },
  weeklyReportProblems: {
    table: "weekly_report_problems",
    columns: [
      "id",
      "weeklyReportId",
      "departmentId",
      "submitterId",
      "relatedGoalId",
      "sourceQuestion",
      "title",
      "description",
      "problemType",
      "impactLevel",
      "status",
      "needSupport",
      "supportNeeded",
      "nextAction",
      "expectedResolveDate",
      "resolvedAt",
      "createdAt",
      "updatedAt",
    ],
    booleanFields: ["needSupport"],
  },
  goals: {
    table: "goals",
    columns: [
      "id",
      "name",
      "level",
      "type",
      "periodType",
      "periodValue",
      "departmentId",
      "ownerId",
      "parentGoalId",
      "metricName",
      "metricUnit",
      "metricDirection",
      "targetValue",
      "currentValue",
      "description",
      "status",
      "createdAt",
      "updatedAt",
    ],
  },
  taskTemplates: {
    table: "task_templates",
    columns: [
      "id",
      "name",
      "categoryId",
      "defaultProcessTemplateId",
      "departmentId",
      "ownerId",
      "description",
      "completionStandard",
      "needAcceptance",
      "accepterId",
      "status",
      "formFields",
      "createdAt",
      "updatedAt",
    ],
    booleanFields: ["needAcceptance"],
    jsonFields: ["formFields"],
  },
  tasks: {
    table: "tasks",
    columns: [
      "id",
      "name",
      "goalId",
      "taskTemplateId",
      "templateId",
      "source",
      "processInstanceId",
      "processNodeId",
      "categoryId",
      "departmentId",
      "ownerId",
      "executorId",
      "initiatorId",
      "description",
      "completionStandard",
      "reviewStandard",
      "outputRequirement",
      "startDate",
      "dueDate",
      "plannedWeek",
      "needAcceptance",
      "accepterId",
      "status",
      "resultText",
      "resultAttachments",
      "customFields",
      "displayTitle",
      "coverImageUrl",
      "submitType",
      "submitDescription",
      "submitFields",
      "submitFormData",
      "submitFiles",
      "submitLinks",
      "submittedAt",
      "submittedBy",
      "cancelReason",
      "executionGroupId",
      "createdAt",
      "updatedAt",
      "completedAt",
    ],
    booleanFields: ["needAcceptance"],
    jsonFields: ["resultAttachments", "customFields", "submitFields", "submitFormData", "submitFiles", "submitLinks"],
  },
  executionGroups: {
    table: "execution_groups",
    columns: [
      "id",
      "name",
      "taskIds",
      "taskTemplateId",
      "standardWorkId",
      "processInstanceIds",
      "ownerId",
      "executorId",
      "status",
      "standardTotalMinutes",
      "startedAt",
      "endedAt",
      "actualTotalMinutes",
      "savedMinutes",
      "createdAt",
      "updatedAt",
    ],
    jsonFields: ["taskIds", "processInstanceIds"],
  },
  processTemplates: {
    table: "process_templates",
    columns: [
      "id",
      "name",
      "categoryId",
      "purpose",
      "applicableDepartmentIds",
      "ownerId",
      "startCondition",
      "completionCondition",
      "overallStandard",
      "status",
      "version",
      "createdAt",
      "updatedAt",
    ],
    jsonFields: ["applicableDepartmentIds"],
  },
  processTemplateNodes: {
    table: "process_template_nodes",
    columns: [
      "id",
      "templateId",
      "stepOrder",
      "departmentId",
      "ownerId",
      "executorId",
      "stageName",
      "stageOrder",
      "nodeOrder",
      "name",
      "ownerRule",
      "ownerDepartmentId",
      "ownerPositionId",
      "defaultOwnerId",
      "durationDays",
      "durationMinutes",
      "description",
      "completionStandard",
      "reviewStandard",
      "defaultImportance",
      "defaultUrgency",
      "needAcceptance",
      "accepterRule",
      "defaultAccepterId",
      "outputRequirement",
      "submitType",
      "submitDescription",
      "submitFields",
      "requireFile",
      "requireLink",
      "status",
      "createdAt",
      "updatedAt",
    ],
    booleanFields: ["needAcceptance", "requireFile", "requireLink"],
    jsonFields: ["submitFields"],
  },
  processInstances: {
    table: "process_instances",
    columns: [
      "id",
      "templateId",
      "taskTemplateId",
      "templateVersion",
      "name",
      "goalId",
      "initiatorId",
      "description",
      "status",
      "startedAt",
      "dueDate",
      "completedAt",
      "stoppedAt",
      "canceledAt",
      "cancelReason",
      "customFields",
      "displayTitle",
      "coverImageUrl",
      "createdAt",
      "updatedAt",
    ],
    jsonFields: ["customFields"],
  },
  methodologies: {
    table: "methodologies",
    columns: [
      "id",
      "title",
      "processTemplateId",
      "processNodeId",
      "standardWorkId",
      "taskTemplateId",
      "description",
      "steps",
      "createdAt",
      "updatedAt",
    ],
    jsonFields: ["steps"],
  },
  templates: {
    table: "templates",
    columns: ["id", "name", "previewImage", "sourceFile", "tags", "fileType", "createdAt", "updatedAt"],
    jsonFields: ["previewImage", "sourceFile", "tags"],
  },
  templateTagCategories: {
    table: "template_tag_categories",
    columns: ["id", "name", "status", "sortOrder", "createdAt", "updatedAt"],
  },
  templateTags: {
    table: "template_tags",
    columns: ["id", "categoryId", "name", "status", "sortOrder", "createdAt", "updatedAt"],
  },
  standardWorkForms: {
    table: "standard_work_forms",
    columns: ["id", "standardWorkId", "formSchema", "createdAt", "updatedAt"],
    jsonFields: ["formSchema"],
  },
  notifications: {
    table: "notifications",
    columns: [
      "id",
      "userId",
      "taskId",
      "processInstanceId",
      "type",
      "title",
      "message",
      "status",
      "severity",
      "dueDate",
      "readAt",
      "createdAt",
      "updatedAt",
    ],
  },
  issuesRequirements: {
    table: "issues_requirements",
    columns: [
      "id",
      "title",
      "type",
      "module",
      "description",
      "attachments",
      "submitterId",
      "status",
      "solution",
      "completedBy",
      "completedAt",
      "latestReply",
      "latestReplyAt",
      "latestReplyBy",
      "replyRecords",
      "createdAt",
      "updatedAt",
    ],
    jsonFields: ["attachments", "replyRecords"],
  },
  contentSchedules: {
    table: "content_schedules",
    columns: [
      "id",
      "publishDate",
      "account",
      "contentType",
      "contentPurpose",
      "targetAudience",
      "product",
      "productImage",
      "title",
      "copywriting",
      "scene",
      "hashtags",
      "status",
      "goalId",
      "templateId",
      "taskId",
      "processInstanceId",
      "workPlanId",
      "createdAt",
      "updatedAt",
    ],
  },
  workPlans: {
    table: "work_plans",
    columns: [
      "id",
      "goalId",
      "departmentId",
      "taskTemplateId",
      "title",
      "customFields",
      "coverImageUrl",
      "workType",
      "status",
      "plannedWeek",
      "dueDate",
      "description",
      "processInstanceId",
      "createdAt",
      "updatedAt",
      "launchedAt",
      "canceledAt",
    ],
    jsonFields: ["customFields"],
  },
};

const routeResourceMap = {
  companies: "companies",
  departments: "departments",
  positions: "positions",
  persons: "people",
  people: "people",
  categories: "categories",
  stores: "stores",
  "publishing-accounts": "publishingAccounts",
  "weekly-reports": "weeklyReports",
  "weekly-report-problems": "weeklyReportProblems",
  goals: "goals",
  "task-templates": "taskTemplates",
  tasks: "tasks",
  "execution-groups": "executionGroups",
  "process-templates": "processTemplates",
  "process-template-nodes": "processTemplateNodes",
  "process-instances": "processInstances",
  methodologies: "methodologies",
  templates: "templates",
  "template-tag-categories": "templateTagCategories",
  "template-tags": "templateTags",
  "standard-work-forms": "standardWorkForms",
  notifications: "notifications",
  "issues-requirements": "issuesRequirements",
  "content-schedules": "contentSchedules",
  "work-plans": "workPlans",
};

const seedData = {
  companies,
  departments,
  positions,
  people,
  categories,
  stores,
  publishingAccounts,
  weeklyReports,
  weeklyReportProblems,
  goals,
  taskTemplates,
  templates,
  templateTagCategories,
  templateTags,
  tasks,
  executionGroups,
  processTemplates,
  processTemplateNodes: processTemplateNodes.map((node) => ({
    reviewStandard: "按步骤完成标准和输出要求进行审核。",
    ...node,
  })),
  processInstances,
  methodologies: [],
  notifications,
  issuesRequirements,
  standardWorkForms,
  contentSchedules,
  workPlans,
};

let db;

function ensureDataDir() {
  fs.mkdirSync(dataDir, { recursive: true });
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergePatchValue(existingValue, patchValue) {
  if (patchValue === undefined) return existingValue;
  if (isPlainObject(existingValue) && isPlainObject(patchValue)) {
    const merged = { ...existingValue };
    for (const key of Object.keys(patchValue)) {
      merged[key] = mergePatchValue(existingValue[key], patchValue[key]);
    }
    return merged;
  }
  return patchValue;
}

function mergeExistingItem(resourceKey, id, patch) {
  const existing = readExistingItem(resourceKey, id);
  if (existing === null) throw new Error("未找到要更新的数据。");
  const merged = { ...existing, id };
  for (const key of Object.keys(patch ?? {})) {
    if (key === "id") continue;
    merged[key] = mergePatchValue(existing[key], patch[key]);
  }
  return merged;
}

const legacyPriorityDefaults = { importance: "normal", urgency: "normal" };
const legacyPriorityColumnDefaults = {
  task_templates: legacyPriorityDefaults,
  tasks: legacyPriorityDefaults,
  work_plans: legacyPriorityDefaults,
  process_template_nodes: { defaultImportance: "normal", defaultUrgency: "normal" },
};
const legacyPriorityTables = new Set(Object.keys(legacyPriorityColumnDefaults));
const tableColumnCache = new Map();

function getTableColumnNames(table) {
  if (!tableColumnCache.has(table)) {
    const columns = getDatabase()
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((item) => item.name);
    tableColumnCache.set(table, new Set(columns));
  }
  return tableColumnCache.get(table);
}

function getWritableColumns(config) {
  const actualColumns = getTableColumnNames(config.table);
  const columns = config.columns.filter((column) => actualColumns.has(column));
  const legacyDefaults = legacyPriorityColumnDefaults[config.table] ?? {};
  if (legacyPriorityTables.has(config.table)) {
    for (const column of Object.keys(legacyDefaults)) {
      if (actualColumns.has(column) && !columns.includes(column)) columns.push(column);
    }
  }
  return columns;
}

function encodeItem(item, config, columns = config.columns) {
  const jsonFields = new Set(config.jsonFields ?? []);
  const booleanFields = new Set(config.booleanFields ?? []);
  const encoded = {};

  for (const column of columns) {
    let value = item[column] ?? null;
    if (config.table === "work_plans" && column === "workType" && (value === null || value === "")) {
      value = "normal";
    }
    const legacyDefaults = legacyPriorityColumnDefaults[config.table] ?? {};
    if (legacyPriorityTables.has(config.table) && Object.prototype.hasOwnProperty.call(legacyDefaults, column) && (value === null || value === "")) {
      value = legacyDefaults[column];
    }
    if (jsonFields.has(column)) value = JSON.stringify(value ?? (column.endsWith("s") ? [] : {}));
    if (booleanFields.has(column)) value = value ? 1 : 0;
    encoded[column] = value;
  }

  return encoded;
}

function decodeRow(row, config) {
  const jsonFields = new Set(config.jsonFields ?? []);
  const booleanFields = new Set(config.booleanFields ?? []);
  const decoded = { ...row };
  const jsonFallbacks = {
    applicableDepartmentIds: [],
    formFields: [],
    resultAttachments: [],
    customFields: {},
    submitFields: [],
    submitFormData: {},
    submitFiles: [],
    submitLinks: [],
    permissions: null,
    relatedGoalIds: [],
    steps: [],
    previewImage: {},
    sourceFile: {},
    tags: {},
    replyRecords: [],
  };

  for (const field of jsonFields) {
    const fallback = jsonFallbacks[field] ?? {};
    try {
      decoded[field] = row[field] === null || row[field] === "" ? fallback : JSON.parse(row[field]);
    } catch {
      decoded[field] = fallback;
    }
  }

  for (const field of booleanFields) {
    decoded[field] = Boolean(row[field]);
  }
  if (config.table === "work_plans" && (decoded.workType === null || decoded.workType === "" || decoded.workType === undefined)) {
    decoded.workType = "normal";
  }

  return decoded;
}

function hasTemplateTags(tags) {
  if (Array.isArray(tags)) return tags.length > 0;
  if (tags === null || tags === undefined || typeof tags !== "object") return false;
  return Object.values(tags).some((value) => Array.isArray(value) && value.length > 0);
}

function validateTemplateItem(item) {
  const previewImage = item.previewImage;
  const sourceFile = item.sourceFile;
  if (String(item.id ?? "").trim() === "") throw new Error("模板 id 不能为空。");
  if (String(item.name ?? "").trim() === "") throw new Error("模板名称不能为空。");
  if (previewImage === null || typeof previewImage !== "object" || String(previewImage.fileUrl ?? "").trim() === "") {
    throw new Error("模板预览图不能为空。");
  }
  if (sourceFile === null || typeof sourceFile !== "object" || String(sourceFile.fileUrl ?? "").trim() === "") {
    throw new Error("模板源文件不能为空。");
  }
  if (!hasTemplateTags(item.tags)) throw new Error("模板标签不能为空。");
}

function insertItem(resourceKey, item) {
  const config = resourceConfigs[resourceKey];
  if (resourceKey === "templates") validateTemplateItem(item);
  const columns = getWritableColumns(config);
  const encoded = encodeItem(item, config, columns);
  const placeholders = columns.map((column) => `@${column}`).join(", ");
  const sql = `INSERT OR REPLACE INTO ${config.table} (${columns.join(", ")}) VALUES (${placeholders})`;
  getDatabase().prepare(sql).run(encoded);

  if (resourceKey === "people" && typeof item.password === "string" && item.password !== "") {
    getDatabase()
      .prepare("UPDATE persons SET passwordHash = @passwordHash WHERE id = @id")
      .run({ id: item.id, passwordHash: hashPassword(item.password) });
  }
  if (resourceKey === "people" && item.password === undefined && typeof item.passwordHash === "string") {
    getDatabase()
      .prepare("UPDATE persons SET passwordHash = @passwordHash WHERE id = @id")
      .run({ id: item.id, passwordHash: item.passwordHash });
  }
  if (resourceKey === "processTemplateNodes") {
    ensureMethodologyForProcessNode(item);
  }
}

const preservedCustomFieldKeys = ["standardWorkAttachments"];

function readExistingItem(resourceKey, id) {
  const config = resourceConfigs[resourceKey];
  if (config === undefined || !config.columns.includes("id")) return null;
  const row = getDatabase().prepare(`SELECT * FROM ${config.table} WHERE id = @id LIMIT 1`).get({ id });
  return row === undefined ? null : decodeRow(row, config);
}

function mergePreservedCustomFields(resourceKey, id, item) {
  if (!["tasks", "processInstances"].includes(resourceKey)) return item;
  if (item.customFields === undefined || item.customFields === null || typeof item.customFields !== "object" || Array.isArray(item.customFields)) return item;

  const existing = readExistingItem(resourceKey, id);
  const existingCustomFields = existing?.customFields;
  if (existingCustomFields === null || existingCustomFields === undefined || typeof existingCustomFields !== "object" || Array.isArray(existingCustomFields)) return item;

  const customFields = { ...item.customFields };
  for (const key of preservedCustomFieldKeys) {
    if (!Object.prototype.hasOwnProperty.call(customFields, key) && Object.prototype.hasOwnProperty.call(existingCustomFields, key)) {
      customFields[key] = existingCustomFields[key];
    }
  }

  return { ...item, customFields };
}

function parseComparableTime(value) {
  const rawValue = String(value ?? "").trim();
  if (rawValue === "") return null;
  const parsed = new Date(rawValue.length === 10 ? `${rawValue}T23:59:59+08:00` : rawValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function formatBusinessMinuteIsoFromDate(date) {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return `${shifted.toISOString().slice(0, 16)}:00+08:00`;
}

function parseBusinessDateTime(value) {
  if (value instanceof Date) return value;
  const rawValue = String(value ?? "").trim();
  if (rawValue === "") return new Date();
  const parsed = new Date(rawValue.length === 10 ? `${rawValue}T00:00:00+08:00` : rawValue);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function addMinutesToBusinessDateTime(value, minutes) {
  const baseDate = parseBusinessDateTime(value);
  const durationMinutes = Number(minutes);
  const nextDate = new Date(baseDate.getTime() + (Number.isFinite(durationMinutes) ? durationMinutes : 0) * 60 * 1000);
  return formatBusinessMinuteIsoFromDate(nextDate);
}

function getCurrentWeek(date = new Date()) {
  const targetDate = new Date(date);
  const firstDay = new Date(targetDate.getFullYear(), 0, 1);
  const pastDays = Math.floor((targetDate - firstDay) / 86400000);
  return `${targetDate.getFullYear()}-W${String(Math.ceil((pastDays + firstDay.getDay() + 1) / 7)).padStart(2, "0")}`;
}

function markTaskOverdueOnce(task) {
  if (task === null || task === undefined || task.status === "canceled" || task.dueDate === null) return task;
  const dueTime = parseComparableTime(task.dueDate);
  if (dueTime === null) return task;
  const completedTime = parseComparableTime(task.completedAt);
  const referenceTime = completedTime ?? Date.now();
  if (referenceTime <= dueTime) return task;

  const customFields =
    task.customFields !== null && typeof task.customFields === "object" && !Array.isArray(task.customFields)
      ? { ...task.customFields }
      : {};
  if (customFields.assessmentOverdueRecordedAt) return task;

  return {
    ...task,
    customFields: {
      ...customFields,
      assessmentOverdueRecordedAt: new Date().toISOString(),
      assessmentOverdueDueDate: task.dueDate,
    },
  };
}

function getProcessNodeStepOrder(node) {
  return Number(node?.stepOrder ?? node?.stageOrder ?? node?.nodeOrder ?? 9999);
}

function getOrderedProcessInstanceTasks(processInstanceId) {
  return readResource("tasks")
    .filter((task) => task.processInstanceId === processInstanceId && task.status !== "canceled")
    .sort((left, right) => {
      const leftNode = readExistingItem("processTemplateNodes", left.processNodeId);
      const rightNode = readExistingItem("processTemplateNodes", right.processNodeId);
      const stepDifference = getProcessNodeStepOrder(leftNode ?? left) - getProcessNodeStepOrder(rightNode ?? right);
      if (stepDifference !== 0) return stepDifference;
      return String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? ""));
    });
}

const currentProcessTaskStatusRank = {
  doing: 1,
  todo: 2,
  pending_acceptance: 3,
  waiting: 4,
};

function getCurrentProcessTaskInTransaction(processInstanceId) {
  return getOrderedProcessInstanceTasks(processInstanceId)
    .filter((task) => !["done", "completed", "canceled", "cancelled"].includes(task.status))
    .sort((left, right) => {
      const statusDifference = (currentProcessTaskStatusRank[left.status] ?? 99) - (currentProcessTaskStatusRank[right.status] ?? 99);
      if (statusDifference !== 0) return statusDifference;
      return 0;
    })[0] ?? null;
}

function includesSubmitPart(submitType, part) {
  if (submitType === "none") return false;
  return String(submitType ?? "").split("_").includes(part);
}

function getTaskSubmitRequirement(task) {
  const node = task?.processNodeId ? readExistingItem("processTemplateNodes", task.processNodeId) : null;
  return {
    submitType: task?.submitType || node?.submitType || "none",
    submitFields: Array.isArray(task?.submitFields) ? task.submitFields : Array.isArray(node?.submitFields) ? node.submitFields : [],
    submitFormData: task?.submitFormData && typeof task.submitFormData === "object" && !Array.isArray(task.submitFormData) ? task.submitFormData : {},
    submitFiles: Array.isArray(task?.submitFiles) ? task.submitFiles : [],
    submitLinks: Array.isArray(task?.submitLinks) ? task.submitLinks : [],
  };
}

function validateExecutionGroupTaskSubmission(task) {
  const requirement = getTaskSubmitRequirement(task);
  if (requirement.submitType === "none") return "";
  if (includesSubmitPart(requirement.submitType, "form")) {
    for (const field of requirement.submitFields) {
      if (field?.required !== true) continue;
      const value = requirement.submitFormData[field.key];
      const isEmpty = Array.isArray(value) ? value.length === 0 : String(value ?? "").trim() === "";
      if (isEmpty) return `请先填写${field.label ?? field.key}`;
    }
  }
  if (includesSubmitPart(requirement.submitType, "file") && requirement.submitFiles.length === 0) return "请先上传提交文件";
  if (includesSubmitPart(requirement.submitType, "link") && requirement.submitLinks.length === 0) return "请先填写提交链接";
  return "";
}

function activateWaitingProcessTaskInTransaction(task, startAt) {
  const now = new Date().toISOString();
  const startDate = String(startAt ?? "").slice(0, 10) || now.slice(0, 10);
  const node = task.processNodeId ? readExistingItem("processTemplateNodes", task.processNodeId) : null;
  const updatedTask = {
    ...task,
    status: "todo",
    startDate: startAt,
    dueDate: addMinutesToBusinessDateTime(startAt, getTaskDurationMinutes(task)),
    plannedWeek: task.plannedWeek ?? getCurrentWeek(new Date(`${startDate}T00:00:00+08:00`)),
    updatedAt: now,
  };
  if (node === null) updatedTask.dueDate = task.dueDate ?? null;
  insertItem("tasks", updatedTask);
  return updatedTask;
}

function refreshProcessTaskReadinessInTransaction(processInstanceId, referenceAt = new Date().toISOString()) {
  const instance = readExistingItem("processInstances", processInstanceId);
  if (instance === null || instance.status !== "running") return null;

  const orderedTasks = getOrderedProcessInstanceTasks(instance.id);
  const nextTask = orderedTasks.find((task) => task.status !== "done");
  if (nextTask !== undefined) {
    const nextIndex = orderedTasks.findIndex((task) => task.id === nextTask.id);
    const previousTasksDone = nextIndex > 0 && orderedTasks.slice(0, nextIndex).every((task) => task.status === "done");
    if (nextTask.status === "waiting" && previousTasksDone) {
      const previousTask = orderedTasks[nextIndex - 1];
      return activateWaitingProcessTaskInTransaction(nextTask, previousTask?.completedAt ?? referenceAt);
    }
    return null;
  }

  if (orderedTasks.length > 0 && orderedTasks.every((task) => task.status === "done")) {
    const updatedInstance = { ...instance, status: "done", completedAt: referenceAt, updatedAt: referenceAt };
    insertItem("processInstances", updatedInstance);
    const workPlans = readResource("workPlans").filter((workPlan) => workPlan.processInstanceId === updatedInstance.id);
    for (const workPlan of workPlans) {
      if (workPlan.status === "canceled") continue;
      insertItem("workPlans", { ...workPlan, status: "done", updatedAt: referenceAt });
    }
  }
  return null;
}

function ensureExecutionGroupTaskCanComplete(task, completedTaskIds, groupTaskIds = new Set()) {
  if (task === null) throw new Error("执行组成员任务不存在。");
  if (task.status === "canceled") throw new Error(`${task.name}：已取消，不能完成执行组。`);
  if (task.status === "done" || task.status === "pending_acceptance") return task;
  if (task.status === "waiting") {
    const orderedTasks = getOrderedProcessInstanceTasks(task.processInstanceId);
    const taskIndex = orderedTasks.findIndex((item) => item.id === task.id);
    if (taskIndex === -1) throw new Error(`${task.name}：未找到对应的流程顺序，不能完成执行组。`);
    const previousTasksDone = orderedTasks
      .slice(0, taskIndex)
      .every((item) => item.status === "done" || completedTaskIds.has(item.id) || groupTaskIds.has(item.id));
    if (!previousTasksDone) throw new Error(`${task.name}：前置步骤未完成，当前步骤暂不能处理。`);
  }
  const submitError = validateExecutionGroupTaskSubmission(task);
  if (submitError !== "") throw new Error(`${task.name}：${submitError}。`);
  return task;
}

function getMethodologyTitle(nodeName) {
  return `${String(nodeName ?? "").replaceAll("+", "").trim()}操作说明`;
}

function ensureMethodologyForProcessNode(node) {
  if (!node?.id || !node?.templateId) return;
  const database = getDatabase();
  const existing = database.prepare("SELECT id FROM methodologies WHERE processNodeId = @processNodeId LIMIT 1").get({ processNodeId: node.id });
  if (existing !== undefined) return;
  const standardWork = database.prepare("SELECT id FROM task_templates WHERE defaultProcessTemplateId = @templateId LIMIT 1").get({ templateId: node.templateId });
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO methodologies (
        id, title, processTemplateId, processNodeId, standardWorkId, taskTemplateId, description, steps, createdAt, updatedAt
      ) VALUES (
        @id, @title, @processTemplateId, @processNodeId, @standardWorkId, @taskTemplateId, @description, @steps, @createdAt, @updatedAt
      )`,
    )
    .run({
      id: `methodology-${node.id}`,
      title: getMethodologyTitle(node.name),
      processTemplateId: node.templateId,
      processNodeId: node.id,
      standardWorkId: standardWork?.id ?? "",
      taskTemplateId: standardWork?.id ?? "",
      description: "",
      steps: "[]",
      createdAt: now,
      updatedAt: now,
    });
}

function backfillMethodologiesForProcessNodes() {
  const nodes = getDatabase().prepare("SELECT id, templateId, name FROM process_template_nodes").all();
  for (const node of nodes) ensureMethodologyForProcessNode(node);
}

function clearAllTables() {
  const database = getDatabase();
  Object.values(resourceConfigs)
    .slice()
    .reverse()
    .forEach((config) => database.prepare(`DELETE FROM ${config.table}`).run());
}

function seedInitialData() {
  const database = getDatabase();
  const seed = database.transaction(() => {
    for (const [resourceKey, items] of Object.entries(seedData)) {
      for (const item of items) insertItem(resourceKey, cloneJson(item));
    }
  });
  seed();
}

function insertMissingSeedItem(resourceKey, item) {
  const config = resourceConfigs[resourceKey];
  const exists = getDatabase()
    .prepare(`SELECT id FROM ${config.table} WHERE id = @id LIMIT 1`)
    .get({ id: item.id });
  if (exists === undefined) insertItem(resourceKey, cloneJson(item));
}

function ensureDefaultTemplateTags() {
  const database = getDatabase();
  const ensureDefaults = database.transaction(() => {
    for (const category of templateTagCategories) insertMissingSeedItem("templateTagCategories", category);
    for (const tag of templateTags) insertMissingSeedItem("templateTags", tag);
  });
  ensureDefaults();
}

function ensureDefaultPublishingAccounts() {
  const database = getDatabase();
  const ensureDefaults = database.transaction(() => {
    for (const account of publishingAccounts) insertMissingSeedItem("publishingAccounts", account);
  });
  ensureDefaults();
}

function isDatabaseEmpty() {
  return Object.values(resourceConfigs).every((config) => {
    const result = getDatabase().prepare(`SELECT COUNT(*) AS count FROM ${config.table}`).get();
    return result.count === 0;
  });
}

function ensureColumn(table, column, definition) {
  const hasColumn = getDatabase()
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((item) => item.name === column);

  if (!hasColumn) getDatabase().exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function ensureStandardWorkValueChainCategories() {
  const database = getDatabase();
  const now = new Date().toISOString();
  const legacyProductCategory = database
    .prepare("SELECT id FROM categories WHERE type = 'task' AND name = '产品研发' LIMIT 1")
    .get();
  const previousProductCategory = database
    .prepare("SELECT id FROM categories WHERE type = 'task' AND name = '产品开发' LIMIT 1")
    .get();
  const canonicalProductCategory = database
    .prepare("SELECT id FROM categories WHERE type = 'task' AND name = '产品开发与淘汰' LIMIT 1")
    .get();

  if (legacyProductCategory !== undefined && canonicalProductCategory === undefined) {
    database
      .prepare("UPDATE categories SET name = '产品开发与淘汰', updatedAt = @updatedAt WHERE id = @id")
      .run({ id: legacyProductCategory.id, updatedAt: now });
  } else if (previousProductCategory !== undefined && canonicalProductCategory === undefined) {
    database
      .prepare("UPDATE categories SET name = '产品开发与淘汰', updatedAt = @updatedAt WHERE id = @id")
      .run({ id: previousProductCategory.id, updatedAt: now });
  } else if (legacyProductCategory !== undefined && canonicalProductCategory !== undefined) {
    database
      .prepare("UPDATE task_templates SET categoryId = @canonicalId, updatedAt = @updatedAt WHERE categoryId = @legacyId")
      .run({ canonicalId: canonicalProductCategory.id, legacyId: legacyProductCategory.id, updatedAt: now });
    database
      .prepare("UPDATE categories SET status = 'inactive', updatedAt = @updatedAt WHERE id = @id")
      .run({ id: legacyProductCategory.id, updatedAt: now });
  }
  if (previousProductCategory !== undefined && canonicalProductCategory !== undefined) {
    database
      .prepare("UPDATE task_templates SET categoryId = @canonicalId, updatedAt = @updatedAt WHERE categoryId = @previousId")
      .run({ canonicalId: canonicalProductCategory.id, previousId: previousProductCategory.id, updatedAt: now });
    database
      .prepare("UPDATE categories SET status = 'inactive', updatedAt = @updatedAt WHERE id = @id")
      .run({ id: previousProductCategory.id, updatedAt: now });
  }

  const insertCategory = database.prepare(
    `INSERT INTO categories (id, type, name, sortOrder, status, createdAt, updatedAt)
     VALUES (@id, 'task', @name, @sortOrder, 'active', @createdAt, @updatedAt)`,
  );
  const findCategory = database.prepare("SELECT id FROM categories WHERE type = 'task' AND name = @name LIMIT 1");

  standardWorkValueChainCategories.forEach((name, index) => {
    if (findCategory.get({ name }) !== undefined) return;
    insertCategory.run({
      id: `cat-task-value-chain-${index + 1}`,
      name,
      sortOrder: index + 1,
      createdAt: now,
      updatedAt: now,
    });
  });

  const activeTaskCategories = database
    .prepare("SELECT id, name FROM categories WHERE type = 'task' AND status <> 'inactive'")
    .all();
  const deactivateCategory = database.prepare("UPDATE categories SET status = 'inactive', updatedAt = @updatedAt WHERE id = @id");
  for (const category of activeTaskCategories) {
    if (!standardWorkValueChainCategories.includes(category.name)) {
      deactivateCategory.run({ id: category.id, updatedAt: now });
    }
  }
}

function getOrCreateStandardWorkValueChainCategory(categoryName) {
  const name = String(categoryName ?? "").trim();
  const categoryIndex = standardWorkValueChainCategories.indexOf(name);
  if (categoryIndex === -1) throw new Error("关键行动价值链分类无效。");

  const database = getDatabase();
  const existingCategory = database.prepare("SELECT id FROM categories WHERE type = 'task' AND name = @name LIMIT 1").get({ name });
  if (existingCategory !== undefined) return existingCategory;

  const now = new Date().toISOString();
  const createdCategory = {
    id: `cat-task-value-chain-${categoryIndex + 1}`,
    name,
    sortOrder: categoryIndex + 1,
    createdAt: now,
    updatedAt: now,
  };
  database
    .prepare(
      `INSERT INTO categories (id, type, name, sortOrder, status, createdAt, updatedAt)
       VALUES (@id, 'task', @name, @sortOrder, 'active', @createdAt, @updatedAt)`,
    )
    .run(createdCategory);
  return createdCategory;
}

function resolveStandardWorkValueChainCategory(categoryName, categoryId = "") {
  const id = String(categoryId ?? "").trim();
  if (id !== "") {
    const category = getDatabase()
      .prepare("SELECT id, name FROM categories WHERE id = @id AND type = 'task' AND status <> 'inactive' LIMIT 1")
      .get({ id });
    if (category === undefined) throw new Error("关键行动价值链分类不存在。");
    return category;
  }

  return getOrCreateStandardWorkValueChainCategory(categoryName);
}

function resolveStandardWorkValueChainCategoryFromPayload(categoryName = "", categoryId = "", valueChainId = "") {
  const id = String(categoryId ?? "").trim();
  if (id !== "") return resolveStandardWorkValueChainCategory(categoryName, id);

  const moduleId = String(valueChainId ?? "").trim();
  if (moduleId !== "") {
    const module = standardWorkValueChainModules.find((item) => item.id === moduleId);
    if (module === undefined) {
      return resolveStandardWorkValueChainCategory(categoryName, moduleId);
    }
    return getOrCreateStandardWorkValueChainCategory(module.name);
  }

  return resolveStandardWorkValueChainCategory(categoryName, "");
}

function readTaskTemplateCategoryId(templateId) {
  const row = getDatabase()
    .prepare("SELECT categoryId FROM task_templates WHERE id = @id LIMIT 1")
    .get({ id: templateId });
  return row?.categoryId ?? null;
}

function runLightweightMigrations() {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS stores (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      platform TEXT,
      brand TEXT,
      type TEXT,
      ownerId TEXT,
      status TEXT NOT NULL,
      remark TEXT,
      createdAt TEXT,
      updatedAt TEXT
    )
  `);
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS publishing_accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      platform TEXT,
      ownerId TEXT,
      status TEXT NOT NULL,
      createdAt TEXT,
      updatedAt TEXT
    )
  `);
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS methodologies (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      processTemplateId TEXT,
      processNodeId TEXT,
      standardWorkId TEXT,
      taskTemplateId TEXT,
      description TEXT,
      steps TEXT,
      createdAt TEXT,
      updatedAt TEXT
    )
  `);
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      previewImage TEXT NOT NULL,
      sourceFile TEXT NOT NULL,
      tags TEXT NOT NULL,
      fileType TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT
    )
  `);
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS template_tag_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      sortOrder INTEGER,
      createdAt TEXT,
      updatedAt TEXT
    )
  `);
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS template_tags (
      id TEXT PRIMARY KEY,
      categoryId TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      sortOrder INTEGER,
      createdAt TEXT,
      updatedAt TEXT
    )
  `);
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      taskId TEXT,
      processInstanceId TEXT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT,
      status TEXT NOT NULL,
      severity TEXT,
      dueDate TEXT,
      readAt TEXT,
      createdAt TEXT,
      updatedAt TEXT
    )
  `);
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS standard_work_forms (
      id TEXT PRIMARY KEY,
      standardWorkId TEXT NOT NULL,
      formSchema TEXT,
      createdAt TEXT,
      updatedAt TEXT
    )
  `);
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS issues_requirements (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      module TEXT,
      description TEXT,
      attachments TEXT,
      submitterId TEXT,
      status TEXT NOT NULL,
      solution TEXT,
      completedBy TEXT,
      completedAt TEXT,
      latestReply TEXT,
      latestReplyAt TEXT,
      latestReplyBy TEXT,
      replyRecords TEXT,
      createdAt TEXT,
      updatedAt TEXT
    )
  `);
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS weekly_reports (
      id TEXT PRIMARY KEY,
      weekStart TEXT NOT NULL,
      weekEnd TEXT NOT NULL,
      weekLabel TEXT NOT NULL,
      departmentId TEXT,
      submitterId TEXT,
      relatedGoalIds TEXT,
      goalAlignedWork TEXT,
      workEffectReview TEXT,
      efficiencyReview TEXT,
      status TEXT NOT NULL,
      submittedAt TEXT,
      createdAt TEXT,
      updatedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS weekly_report_problems (
      id TEXT PRIMARY KEY,
      weeklyReportId TEXT,
      departmentId TEXT,
      submitterId TEXT,
      relatedGoalId TEXT,
      sourceQuestion TEXT,
      title TEXT NOT NULL,
      description TEXT,
      problemType TEXT,
      impactLevel TEXT,
      status TEXT NOT NULL,
      needSupport INTEGER NOT NULL DEFAULT 0,
      supportNeeded TEXT,
      nextAction TEXT,
      expectedResolveDate TEXT,
      resolvedAt TEXT,
      createdAt TEXT,
      updatedAt TEXT
    )
  `);
  ensureColumn("departments", "parentDepartmentId", "TEXT");
  ensureColumn("task_templates", "defaultProcessTemplateId", "TEXT");
  ensureColumn("process_template_nodes", "stepOrder", "INTEGER");
  ensureColumn("process_template_nodes", "departmentId", "TEXT");
  ensureColumn("process_template_nodes", "ownerId", "TEXT");
  ensureColumn("process_template_nodes", "executorId", "TEXT");
  ensureColumn("process_template_nodes", "durationMinutes", "INTEGER");
  ensureColumn("process_template_nodes", "submitType", "TEXT");
  ensureColumn("process_template_nodes", "submitDescription", "TEXT");
  ensureColumn("process_template_nodes", "submitFields", "TEXT");
  ensureColumn("process_template_nodes", "requireFile", "INTEGER DEFAULT 0");
  ensureColumn("process_template_nodes", "requireLink", "INTEGER DEFAULT 0");
  ensureColumn("tasks", "submitType", "TEXT");
  ensureColumn("tasks", "submitDescription", "TEXT");
  ensureColumn("tasks", "submitFields", "TEXT");
  ensureColumn("tasks", "submitFormData", "TEXT");
  ensureColumn("tasks", "submitFiles", "TEXT");
  ensureColumn("tasks", "submitLinks", "TEXT");
  ensureColumn("tasks", "submittedAt", "TEXT");
  ensureColumn("tasks", "submittedBy", "TEXT");
  ensureColumn("tasks", "cancelReason", "TEXT");
  ensureColumn("tasks", "templateId", "TEXT");
  ensureColumn("tasks", "executionGroupId", "TEXT");
  ensureColumn("notifications", "severity", "TEXT");
  ensureColumn("process_instances", "dueDate", "TEXT");
  ensureColumn("process_instances", "canceledAt", "TEXT");
  ensureColumn("process_instances", "cancelReason", "TEXT");
  ensureColumn("content_schedules", "workPlanId", "TEXT");
  ensureColumn("content_schedules", "templateId", "TEXT");
  ensureColumn("work_plans", "departmentId", "TEXT");
  ensureColumn("work_plans", "workType", "TEXT DEFAULT 'normal'");
  ensureColumn("issues_requirements", "latestReply", "TEXT");
  ensureColumn("issues_requirements", "latestReplyAt", "TEXT");
  ensureColumn("issues_requirements", "latestReplyBy", "TEXT");
  ensureColumn("issues_requirements", "replyRecords", "TEXT");
  ensureColumn("persons", "username", "TEXT");
  ensureColumn("persons", "passwordHash", "TEXT");
  ensureColumn("persons", "canLogin", "INTEGER DEFAULT 0");
  ensureColumn("persons", "authRole", "TEXT DEFAULT 'user'");
  ensureColumn("persons", "lastLoginAt", "TEXT");
  ensureColumn("persons", "mustChangePassword", "INTEGER DEFAULT 0");
  ensureColumn("persons", "permissions", "TEXT");
  ensureColumn("persons", "avatarUrl", "TEXT");
  ensureStandardWorkValueChainCategories();
}

function publicUser(row) {
  if (row === undefined) return null;
  const role = row.authRole ?? "user";
  return {
    id: row.id,
    name: row.name,
    departmentId: row.departmentId,
    username: row.username,
    avatarUrl: row.avatarUrl ?? "",
    role,
    canLogin: Boolean(row.canLogin),
    mustChangePassword: Boolean(row.mustChangePassword),
    lastLoginAt: row.lastLoginAt ?? null,
    permissions: normalizePermissions(row.permissions, role),
  };
}

function ensureDefaultAdmin() {
  const database = getDatabase();
  const loginUserCount = database
    .prepare(
      "SELECT COUNT(*) AS count FROM persons WHERE canLogin = 1 AND username IS NOT NULL AND username <> '' AND passwordHash IS NOT NULL AND passwordHash <> ''",
    )
    .get().count;

  if (loginUserCount > 0) return;

  const now = new Date().toISOString();
  const existingAdmin = database.prepare("SELECT id FROM persons WHERE id = 'person-001'").get();
  const admin = {
    id: "person-001",
    name: "系统管理员",
    account: "admin",
    departmentId: "",
    positionId: "",
    directManagerId: null,
    role: "system_admin",
    status: "active",
    username: "admin",
    passwordHash: hashPassword("admin123456"),
    canLogin: 1,
    authRole: "admin",
    lastLoginAt: null,
    mustChangePassword: 1,
    permissions: serializePermissions(normalizePermissions(null, "admin")),
    createdAt: now,
    updatedAt: now,
  };

  if (existingAdmin === undefined) {
    database
      .prepare(
        `INSERT INTO persons (
          id, name, account, departmentId, positionId, directManagerId, role, status,
          username, passwordHash, canLogin, authRole, lastLoginAt, mustChangePassword, permissions, createdAt, updatedAt
        ) VALUES (
          @id, @name, @account, @departmentId, @positionId, @directManagerId, @role, @status,
          @username, @passwordHash, @canLogin, @authRole, @lastLoginAt, @mustChangePassword, @permissions, @createdAt, @updatedAt
        )`,
      )
      .run(admin);
    return;
  }

  database
    .prepare(
      `UPDATE persons
       SET username = @username,
           passwordHash = @passwordHash,
           canLogin = @canLogin,
           authRole = @authRole,
           mustChangePassword = @mustChangePassword,
           permissions = COALESCE(permissions, @permissions),
           updatedAt = @updatedAt
       WHERE id = @id`,
    )
    .run(admin);
}

export function getDatabase() {
  if (db === undefined) {
    ensureDataDir();
    db = new Database(databasePath);
  }

  return db;
}

export function initializeDatabase({ reset = false } = {}) {
  if (reset && fs.existsSync(databasePath)) {
    if (db !== undefined) {
      db.close();
      db = undefined;
    }
    fs.unlinkSync(databasePath);
  }

  const existedBeforeOpen = fs.existsSync(databasePath);
  const database = getDatabase();
  database.exec(fs.readFileSync(schemaPath, "utf8"));
  runLightweightMigrations();
  backfillMethodologiesForProcessNodes();

  if (!existedBeforeOpen || isDatabaseEmpty()) {
    clearAllTables();
    seedInitialData();
    runLightweightMigrations();
    backfillMethodologiesForProcessNodes();
  }

  ensureDefaultTemplateTags();
  ensureDefaultPublishingAccounts();
  ensureDefaultAdmin();
}

export function readResource(resourceKey) {
  const config = resourceConfigs[resourceKey];
  if (config === undefined) throw new Error(`Unknown resource: ${resourceKey}`);
  const columns = config.columns.join(", ");
  const orderBy =
    resourceKey === "categories"
      ? " ORDER BY sortOrder ASC, name ASC, id ASC"
      : resourceKey === "publishingAccounts"
        ? " ORDER BY platform ASC, name ASC, id ASC"
      : resourceKey === "templateTagCategories"
        ? " ORDER BY sortOrder ASC, name ASC, id ASC"
      : resourceKey === "templateTags"
        ? " ORDER BY categoryId ASC, sortOrder ASC, name ASC, id ASC"
      : resourceKey === "templates"
        ? " ORDER BY createdAt DESC, id DESC"
        : resourceKey === "standardWorkForms"
          ? " ORDER BY updatedAt DESC, createdAt DESC, id DESC"
        : resourceKey === "issuesRequirements"
          ? " ORDER BY createdAt DESC, id DESC"
        : resourceKey === "executionGroups"
          ? " ORDER BY createdAt DESC, id DESC"
        : "";
  return getDatabase()
    .prepare(`SELECT ${columns} FROM ${config.table}${orderBy}`)
    .all()
    .map((row) => decodeRow(row, config));
}

export function readAllData() {
  return Object.fromEntries(Object.keys(resourceConfigs).map((resourceKey) => [resourceKey, readResource(resourceKey)]));
}

function getTaskStandardWorkId(task) {
  if (task === null || task === undefined) return "";
  const instance =
    task.processInstanceId === undefined || task.processInstanceId === null || task.processInstanceId === ""
      ? null
      : readExistingItem("processInstances", task.processInstanceId);
  return instance?.taskTemplateId ?? instance?.standardWorkId ?? task.taskTemplateId ?? task.standardWorkId ?? "";
}

function getTaskDurationMinutes(task) {
  if (task?.processNodeId === undefined || task.processNodeId === null || task.processNodeId === "") return 0;
  const node = readExistingItem("processTemplateNodes", task.processNodeId);
  const durationMinutes = Number(node?.durationMinutes);
  if (Number.isFinite(durationMinutes) && durationMinutes > 0) return Math.round(durationMinutes);
  const durationDays = Number(node?.durationDays);
  if (Number.isFinite(durationDays) && durationDays > 0) return Math.round(durationDays * 1440);
  return 0;
}

function validateExecutionGroupTasks(taskIds) {
  if (!Array.isArray(taskIds) || taskIds.length < 2) throw new Error("请至少选择 2 个任务创建执行组。");
  const uniqueTaskIds = [...new Set(taskIds.map((id) => String(id ?? "").trim()).filter(Boolean))];
  if (uniqueTaskIds.length < 2) throw new Error("请至少选择 2 个不同任务创建执行组。");

  const tasksToGroup = uniqueTaskIds.map((taskId) => readExistingItem("tasks", taskId));
  const missingTaskIds = uniqueTaskIds.filter((_taskId, index) => tasksToGroup[index] === null);
  if (missingTaskIds.length > 0) throw new Error(`未找到任务：${missingTaskIds.join("、")}`);

  const invalidStatusTasks = tasksToGroup.filter((task) => ["done", "canceled"].includes(task.status));
  if (invalidStatusTasks.length > 0) throw new Error(`已完成或已取消的任务不能加入执行组：${invalidStatusTasks.map((task) => task.name).join("、")}`);

  const groupedTasks = tasksToGroup.filter((task) => String(task.executionGroupId ?? "").trim() !== "");
  if (groupedTasks.length > 0) throw new Error(`任务已加入执行组，不能重复加入：${groupedTasks.map((task) => task.name).join("、")}`);

  const standardWorkIds = new Set(tasksToGroup.map(getTaskStandardWorkId).filter(Boolean));
  if (standardWorkIds.size !== 1) throw new Error("只有同一关键行动的任务才能创建执行组。");

  const ownerIds = new Set(tasksToGroup.map((task) => task.ownerId).filter(Boolean));
  if (ownerIds.size !== 1) throw new Error("只有同一负责人的任务才能创建执行组。");

  const executorIds = new Set(tasksToGroup.map((task) => task.executorId).filter(Boolean));
  if (executorIds.size !== 1) throw new Error("只有同一执行人的任务才能创建执行组。");

  const missingDurationTasks = tasksToGroup.filter((task) => getTaskDurationMinutes(task) <= 0);
  if (missingDurationTasks.length > 0) throw new Error(`以下任务缺少有效规定时长：${missingDurationTasks.map((task) => task.name).join("、")}`);

  return tasksToGroup;
}

function updateExecutionGroupTaskLinks(taskIds, executionGroupId) {
  const database = getDatabase();
  const now = new Date().toISOString();
  const updateTask = database.prepare("UPDATE tasks SET executionGroupId = @executionGroupId, updatedAt = @updatedAt WHERE id = @id");
  for (const taskId of taskIds) updateTask.run({ id: taskId, executionGroupId, updatedAt: now });
}

const batchTaskStatuses = new Set(["done", "canceled"]);

function getSortedBatchTasks(tasks) {
  return [...tasks].sort((left, right) => {
    const leftInstance = left.processInstanceId ?? "";
    const rightInstance = right.processInstanceId ?? "";
    if (leftInstance !== rightInstance) return leftInstance.localeCompare(rightInstance);
    const leftNode = left.processNodeId ? readExistingItem("processTemplateNodes", left.processNodeId) : null;
    const rightNode = right.processNodeId ? readExistingItem("processTemplateNodes", right.processNodeId) : null;
    const stepDifference = getProcessNodeStepOrder(leftNode ?? left) - getProcessNodeStepOrder(rightNode ?? right);
    if (stepDifference !== 0) return stepDifference;
    return String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? ""));
  });
}

function ensureBatchTaskCanBeDone(task, completedTaskIds) {
  if (task.status === "done") return;
  if (task.status === "canceled") throw new Error(`${task.name}：已取消，不能批量完成。`);
  if (task.status === "pending_acceptance") return;
  if (task.status === "waiting") {
    const orderedTasks = getOrderedProcessInstanceTasks(task.processInstanceId);
    const taskIndex = orderedTasks.findIndex((item) => item.id === task.id);
    if (taskIndex === -1) throw new Error(`${task.name}：未找到对应的流程顺序，不能批量完成。`);
    const previousTasksDone = orderedTasks.slice(0, taskIndex).every((item) => item.status === "done" || completedTaskIds.has(item.id));
    if (!previousTasksDone) throw new Error(`${task.name}：前置步骤未完成，当前步骤暂不能处理。`);
  }
  const submitError = validateExecutionGroupTaskSubmission(task);
  if (submitError !== "") throw new Error(`${task.name}：${submitError}。`);
}

export function batchUpdateTaskStatus(payload = {}) {
  const database = getDatabase();
  const updateBatch = database.transaction(() => {
    const status = String(payload.status ?? "").trim();
    if (!batchTaskStatuses.has(status)) throw new Error("批量任务状态不合法。");

    const taskIds = [...new Set((Array.isArray(payload.taskIds) ? payload.taskIds : []).map((id) => String(id ?? "").trim()).filter(Boolean))];
    if (taskIds.length === 0) throw new Error("请选择需要批量处理的任务。");

    const tasksToUpdate = taskIds.map((taskId) => readExistingItem("tasks", taskId));
    const missingTaskIds = taskIds.filter((_taskId, index) => tasksToUpdate[index] === null);
    if (missingTaskIds.length > 0) throw new Error(`未找到任务：${missingTaskIds.join("、")}`);

    const now = payload.updatedAt || new Date().toISOString();
    const sortedTasks = getSortedBatchTasks(tasksToUpdate);
    const completedTaskIds = new Set(readResource("tasks").filter((task) => task.status === "done").map((task) => task.id));
    const affectedProcessInstanceIds = new Set();
    const changedTaskIds = [];

    for (const selectedTask of sortedTasks) {
      let task = readExistingItem("tasks", selectedTask.id);
      if (task === null) throw new Error(`未找到任务：${selectedTask.id}`);
      if (status === "done") {
        ensureBatchTaskCanBeDone(task, completedTaskIds);
        if (task.status === "done") {
          if (task.processInstanceId) affectedProcessInstanceIds.add(task.processInstanceId);
          continue;
        }
        if (task.status === "waiting") {
          const orderedTasks = getOrderedProcessInstanceTasks(task.processInstanceId);
          const taskIndex = orderedTasks.findIndex((item) => item.id === task.id);
          const previousTask = orderedTasks[taskIndex - 1];
          task = activateWaitingProcessTaskInTransaction(task, previousTask?.completedAt ?? now);
        }
      } else if (task.status === "canceled") {
        continue;
      }

      const updatedTask = markTaskOverdueOnce({
        ...task,
        status,
        completedAt: status === "done" ? now : null,
        updatedAt: now,
      });
      insertItem("tasks", updatedTask);
      changedTaskIds.push(updatedTask.id);
      if (updatedTask.processInstanceId) affectedProcessInstanceIds.add(updatedTask.processInstanceId);
      if (updatedTask.status === "done") completedTaskIds.add(updatedTask.id);
    }

    if (status === "done") {
      for (const processInstanceId of affectedProcessInstanceIds) {
        refreshProcessTaskReadinessInTransaction(processInstanceId, now);
      }
    }

    return {
      status,
      taskIds,
      changedTaskIds,
      updatedAt: now,
    };
  });
  return updateBatch();
}

export function createExecutionGroup(payload = {}) {
  const database = getDatabase();
  const createGroup = database.transaction(() => {
    const tasksToGroup = validateExecutionGroupTasks(payload.taskIds);
    const taskIds = tasksToGroup.map((task) => task.id);
    const standardWorkId = getTaskStandardWorkId(tasksToGroup[0]);
    const standardWork = readExistingItem("taskTemplates", standardWorkId);
    const executorId = tasksToGroup[0].executorId;
    const ownerId = tasksToGroup[0].ownerId;
    const now = new Date().toISOString();
    const standardTotalMinutes = tasksToGroup.reduce((total, task) => total + getTaskDurationMinutes(task), 0);
    const processInstanceIds = [...new Set(tasksToGroup.map((task) => task.processInstanceId).filter(Boolean))];
    const group = {
      id: payload.id || `execution-group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: String(payload.name ?? "").trim() || `执行组：${standardWork?.name ?? "关键行动"} - ${now.slice(0, 10)}`,
      taskIds,
      taskTemplateId: standardWorkId,
      standardWorkId,
      processInstanceIds,
      ownerId,
      executorId,
      status: "created",
      standardTotalMinutes,
      startedAt: null,
      endedAt: null,
      actualTotalMinutes: null,
      savedMinutes: null,
      createdAt: now,
      updatedAt: now,
    };
    insertItem("executionGroups", group);
    updateExecutionGroupTaskLinks(taskIds, group.id);
    return group;
  });
  return createGroup();
}

export function startExecutionGroup(groupId) {
  const database = getDatabase();
  const startGroup = database.transaction(() => {
    const group = readExistingItem("executionGroups", groupId);
    if (group === null) throw new Error("未找到执行组。");
    if (group.status !== "created") throw new Error("只有已创建的执行组可以开始执行。");
    const now = new Date().toISOString();
    const updatedGroup = { ...group, status: "doing", startedAt: now, updatedAt: now };
    insertItem("executionGroups", updatedGroup);
    return updatedGroup;
  });
  return startGroup();
}

export function cancelExecutionGroup(groupId) {
  const database = getDatabase();
  const cancelGroup = database.transaction(() => {
    const group = readExistingItem("executionGroups", groupId);
    if (group === null) throw new Error("未找到执行组。");
    if (group.status === "done") throw new Error("已完成的执行组不能取消。");
    if (group.status === "canceled") return group;
    const now = new Date().toISOString();
    const updatedGroup = { ...group, status: "canceled", updatedAt: now };
    insertItem("executionGroups", updatedGroup);
    updateExecutionGroupTaskLinks(group.taskIds ?? [], null);
    return updatedGroup;
  });
  return cancelGroup();
}

export function completeExecutionGroup(groupId, payload = {}) {
  const database = getDatabase();
  const completeGroup = database.transaction(() => {
    const group = readExistingItem("executionGroups", groupId);
    if (group === null) throw new Error("未找到执行组。");
    if (group.status === "done") return group;
    if (group.status === "canceled") throw new Error("已取消的执行组不能完成。");
    if (group.status !== "doing") throw new Error("只有执行中的执行组可以完成。");
    if (group.startedAt === null || group.startedAt === undefined || group.startedAt === "") throw new Error("执行组尚未记录开始时间，不能完成。");

    const taskIds = Array.isArray(group.taskIds) ? group.taskIds : [];
    if (taskIds.length < 2) throw new Error("执行组成员任务不足，不能完成。");

    const linkedTasks = readResource("tasks").filter((task) => task.executionGroupId === group.id);
    const linkedTaskIds = new Set(linkedTasks.map((task) => task.id));
    const groupTaskIds = new Set(taskIds);
    const mismatchedTaskIds = [
      ...taskIds.filter((taskId) => !linkedTaskIds.has(taskId)),
      ...linkedTasks.map((task) => task.id).filter((taskId) => !groupTaskIds.has(taskId)),
    ];
    if (mismatchedTaskIds.length > 0) throw new Error(`执行组成员关联不一致：${[...new Set(mismatchedTaskIds)].join("、")}`);

    const tasksInGroup = taskIds.map((taskId) => readExistingItem("tasks", taskId));
    const missingTaskIds = taskIds.filter((_taskId, index) => tasksInGroup[index] === null);
    if (missingTaskIds.length > 0) throw new Error(`未找到执行组成员任务：${missingTaskIds.join("、")}`);

    const standardWorkIds = new Set(tasksInGroup.map(getTaskStandardWorkId).filter(Boolean));
    if (standardWorkIds.size !== 1) throw new Error("执行组成员不再属于同一关键行动，不能完成。");
    const ownerIds = new Set(tasksInGroup.map((task) => task.ownerId).filter(Boolean));
    if (ownerIds.size !== 1 || ownerIds.values().next().value !== group.ownerId) throw new Error("执行组成员负责人不一致，不能完成。");
    const executorIds = new Set(tasksInGroup.map((task) => task.executorId).filter(Boolean));
    if (executorIds.size !== 1 || executorIds.values().next().value !== group.executorId) throw new Error("执行组成员执行人不一致，不能完成。");

    const standardTotalMinutes = tasksInGroup.reduce((total, task) => total + getTaskDurationMinutes(task), 0);
    if (standardTotalMinutes <= 0) throw new Error("执行组成员缺少有效规定时长，不能完成。");

    const endedAt = payload.endedAt || new Date().toISOString();
    const actualTotalMinutes = Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(group.startedAt).getTime()) / 60000));
    const completedTaskIds = new Set(tasksInGroup.filter((task) => task.status === "done").map((task) => task.id));
    const sortedTasks = [...tasksInGroup].sort((left, right) => {
      const leftInstance = left.processInstanceId ?? "";
      const rightInstance = right.processInstanceId ?? "";
      if (leftInstance !== rightInstance) return leftInstance.localeCompare(rightInstance);
      const leftNode = left.processNodeId ? readExistingItem("processTemplateNodes", left.processNodeId) : null;
      const rightNode = right.processNodeId ? readExistingItem("processTemplateNodes", right.processNodeId) : null;
      const stepDifference = getProcessNodeStepOrder(leftNode ?? left) - getProcessNodeStepOrder(rightNode ?? right);
      if (stepDifference !== 0) return stepDifference;
      return String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? ""));
    });
    const affectedProcessInstanceIds = new Set(sortedTasks.map((task) => task.processInstanceId).filter(Boolean));

    for (const selectedTask of sortedTasks) {
      let task = readExistingItem("tasks", selectedTask.id);
      ensureExecutionGroupTaskCanComplete(task, completedTaskIds, groupTaskIds);
      if (task.status === "done" || task.status === "pending_acceptance") continue;
      if (task.status === "waiting") {
        const orderedTasks = getOrderedProcessInstanceTasks(task.processInstanceId);
        const taskIndex = orderedTasks.findIndex((item) => item.id === task.id);
        const previousTask = orderedTasks[taskIndex - 1];
        task = activateWaitingProcessTaskInTransaction(task, previousTask?.completedAt ?? endedAt);
      }

      const requirement = getTaskSubmitRequirement(task);
      const shouldMarkSubmitted = requirement.submitType !== "none";
      const nextStatus = task.needAcceptance ? "pending_acceptance" : "done";
      const updatedTask = markTaskOverdueOnce({
        ...task,
        status: nextStatus,
        submittedAt: shouldMarkSubmitted ? task.submittedAt ?? endedAt : task.submittedAt,
        submittedBy: shouldMarkSubmitted ? task.submittedBy ?? task.ownerId : task.submittedBy,
        completedAt: nextStatus === "done" ? endedAt : null,
        updatedAt: endedAt,
      });
      insertItem("tasks", updatedTask);
      if (updatedTask.status === "done") {
        completedTaskIds.add(updatedTask.id);
      }
    }

    for (const processInstanceId of affectedProcessInstanceIds) {
      refreshProcessTaskReadinessInTransaction(processInstanceId, endedAt);
    }

    const updatedGroup = {
      ...group,
      status: "done",
      endedAt,
      standardTotalMinutes,
      actualTotalMinutes,
      savedMinutes: standardTotalMinutes - actualTotalMinutes,
      updatedAt: endedAt,
    };
    insertItem("executionGroups", updatedGroup);
    return updatedGroup;
  });
  return completeGroup();
}

export function moveTaskTemplateToValueChain(templateId, categoryName = "", categoryId = "", valueChainId = "") {
  const database = getDatabase();
  const template = database.prepare("SELECT id FROM task_templates WHERE id = @id LIMIT 1").get({ id: templateId });
  if (template === undefined) throw new Error("未找到该关键行动。");

  const category = resolveStandardWorkValueChainCategoryFromPayload(categoryName, categoryId, valueChainId);
  const updatedAt = new Date().toISOString();
  database
    .prepare("UPDATE task_templates SET categoryId = @categoryId, updatedAt = @updatedAt WHERE id = @id")
    .run({ id: templateId, categoryId: category.id, updatedAt });
  const savedCategoryId = readTaskTemplateCategoryId(templateId);
  if (savedCategoryId !== category.id) throw new Error("关键行动分类保存失败。");
  return database.prepare("SELECT * FROM task_templates WHERE id = @id LIMIT 1").get({ id: templateId });
}

export function updateProcessTemplateNodeStatus(nodeId, status) {
  const nextStatus = String(status ?? "").trim();
  if (!["active", "inactive"].includes(nextStatus)) throw new Error("标准节点状态无效。");

  const database = getDatabase();
  const node = database.prepare("SELECT id FROM process_template_nodes WHERE id = @id LIMIT 1").get({ id: nodeId });
  if (node === undefined) throw new Error("未找到该标准节点。");

  const updatedAt = new Date().toISOString();
  database
    .prepare("UPDATE process_template_nodes SET status = @status, updatedAt = @updatedAt WHERE id = @id")
    .run({ id: nodeId, status: nextStatus, updatedAt });
  return database.prepare("SELECT * FROM process_template_nodes WHERE id = @id LIMIT 1").get({ id: nodeId });
}

export function replaceAllData(data) {
  const database = getDatabase();
  const peopleItems = data.people ?? data.persons ?? [];
  const existingPeopleAuth = new Map(
    database
      .prepare("SELECT id, passwordHash FROM persons")
      .all()
      .map((person) => [person.id, person.passwordHash]),
  );
  const usernames = new Map();

  for (const person of peopleItems) {
    const username = String(person.username ?? "").trim();
    if (username === "") continue;
    const normalizedUsername = username.toLowerCase();
    if (usernames.has(normalizedUsername) && usernames.get(normalizedUsername) !== person.id) {
      throw new Error("登录账号不能重复。");
    }
    usernames.set(normalizedUsername, person.id);

    if (person.canLogin && !existingPeopleAuth.get(person.id) && !person.password) {
      throw new Error("允许登录的账号必须设置密码。");
    }
  }

  const permissionAdminCount = peopleItems.filter((person) => {
    if (!person.canLogin || person.status !== "active") return false;
    return normalizePermissions(person.permissions, person.authRole).settings.managePermissions === true;
  }).length;
  if (permissionAdminCount < 1) throw new Error("系统至少需要保留一个权限管理员。");

  const replace = database.transaction(() => {
    clearAllTables();
    for (const resourceKey of Object.keys(resourceConfigs)) {
      const items = resourceKey === "people" ? data.people ?? data.persons ?? [] : data[resourceKey] ?? [];
      for (const item of items) {
        const nextItem =
          resourceKey === "people" && item.password === undefined
            ? { ...item, passwordHash: existingPeopleAuth.get(item.id) ?? null }
            : item;
        insertItem(resourceKey, nextItem);
      }
    }
  });
  replace();
}

export function deleteProcessTemplate(templateId) {
  const database = getDatabase();
  const template = database.prepare("SELECT id, name FROM process_templates WHERE id = @id LIMIT 1").get({ id: templateId });
  if (template === undefined) throw new Error("未找到要删除的标准。");

  const boundStandardWork = database
    .prepare("SELECT id, name FROM task_templates WHERE defaultProcessTemplateId = @id LIMIT 1")
    .get({ id: templateId });
  if (boundStandardWork !== undefined) {
    throw new Error("该关键行动已绑定关键行动，请先停用标准，不要删除。");
  }

  const launchedInstance = database
    .prepare("SELECT id FROM process_instances WHERE templateId = @id LIMIT 1")
    .get({ id: templateId });
  if (launchedInstance !== undefined) {
    throw new Error("该关键行动已有发起记录，为保留历史数据不能删除，请使用停用标准。");
  }

  const remove = database.transaction(() => {
    database.prepare("DELETE FROM methodologies WHERE processTemplateId = @id").run({ id: templateId });
    database.prepare(
      `DELETE FROM methodologies
       WHERE processNodeId IN (SELECT id FROM process_template_nodes WHERE templateId = @id)`,
    ).run({ id: templateId });
    database.prepare("DELETE FROM process_template_nodes WHERE templateId = @id").run({ id: templateId });
    database.prepare("DELETE FROM process_templates WHERE id = @id").run({ id: templateId });
  });
  remove();

  return { success: true, id: templateId };
}

export function deleteProcessTemplateNode(nodeId) {
  const database = getDatabase();
  const node = database.prepare("SELECT id, name FROM process_template_nodes WHERE id = @id LIMIT 1").get({ id: nodeId });
  if (node === undefined) throw new Error("未找到要删除的标准节点。");

  const generatedTask = database.prepare("SELECT id FROM tasks WHERE processNodeId = @id LIMIT 1").get({ id: nodeId });
  if (generatedTask !== undefined) {
    throw new Error("该标准节点已经生成过任务，为保留历史数据不能删除，请使用停用节点。");
  }

  const remove = database.transaction(() => {
    database
      .prepare("UPDATE process_template_nodes SET status = 'deleted', updatedAt = @updatedAt WHERE id = @id")
      .run({ id: nodeId, updatedAt: new Date().toISOString() });
  });
  remove();

  return { success: true, id: nodeId };
}

export function findLoginUser(username) {
  return getDatabase()
    .prepare("SELECT * FROM persons WHERE lower(username) = lower(@username) LIMIT 1")
    .get({ username });
}

export function findLoginUserById(id) {
  return getDatabase().prepare("SELECT * FROM persons WHERE id = @id LIMIT 1").get({ id });
}

export function getPublicUser(row) {
  return publicUser(row);
}

export function touchLastLoginAt(id) {
  const lastLoginAt = new Date().toISOString();
  getDatabase().prepare("UPDATE persons SET lastLoginAt = @lastLoginAt WHERE id = @id").run({ id, lastLoginAt });
}

export function updateCurrentUserAvatar(id, avatarUrl) {
  const updatedAt = new Date().toISOString();
  getDatabase()
    .prepare("UPDATE persons SET avatarUrl = @avatarUrl, updatedAt = @updatedAt WHERE id = @id")
    .run({ id, avatarUrl, updatedAt });
  return findLoginUserById(id);
}

export function cancelProcessInstance(instanceId, cancelReason = "") {
  const database = getDatabase();
  const instance = database.prepare("SELECT * FROM process_instances WHERE id = @id LIMIT 1").get({ id: instanceId });
  if (instance === undefined) throw new Error("未找到该已发起关键行动。");
  if (["done", "completed"].includes(instance.status)) throw new Error("已完成关键行动不能取消。");
  if (["canceled", "stopped"].includes(instance.status)) throw new Error("该关键行动已取消或已终止。");

  const now = new Date().toISOString();
  const reason = String(cancelReason ?? "").trim() || null;
  const cancel = database.transaction(() => {
    database
      .prepare(
        `UPDATE process_instances
         SET status = 'canceled',
             canceledAt = @now,
             cancelReason = @reason,
             updatedAt = @now
         WHERE id = @id`,
      )
      .run({ id: instanceId, reason, now });

    database
      .prepare(
        `UPDATE tasks
         SET status = 'canceled',
             cancelReason = COALESCE(@reason, cancelReason),
             updatedAt = @now
         WHERE processInstanceId = @id
           AND status NOT IN ('done', 'completed', 'canceled')`,
      )
      .run({ id: instanceId, reason, now });

    database
      .prepare(
        `UPDATE work_plans
         SET status = 'canceled',
             canceledAt = @now,
             updatedAt = @now
         WHERE processInstanceId = @id
           AND status <> 'canceled'`,
      )
      .run({ id: instanceId, now });
  });
  cancel();
}

export function startProcessInstanceExecution(instanceId, { userId = "", isAdmin = false, dueDate } = {}) {
  const database = getDatabase();
  const start = database.transaction(() => {
    const instance = readExistingItem("processInstances", instanceId);
    if (instance === null) throw new Error("未找到该关键行动。");
    if (["done", "completed"].includes(instance.status)) throw new Error("已完成关键行动不能开始执行。");
    if (["canceled", "cancelled", "stopped", "terminated"].includes(instance.status)) throw new Error("已取消或已终止关键行动不能开始执行。");

    const currentTask = getCurrentProcessTaskInTransaction(instance.id);
    if (currentTask === null) throw new Error("该关键行动没有可开始执行的当前任务。");
    if (currentTask.status !== "todo") throw new Error("只有待处理任务可以开始执行。");

    const normalizedUserId = String(userId ?? "").trim();
    const canStart =
      isAdmin === true ||
      (normalizedUserId !== "" && [currentTask.ownerId, currentTask.executorId].includes(normalizedUserId));
    if (!canStart) throw new Error("你没有权限开始执行该关键行动。");

    const now = new Date().toISOString();
    const hasDueDate = dueDate !== undefined;
    const normalizedDueDate = hasDueDate ? String(dueDate ?? "").trim() || null : undefined;
    insertItem("tasks", {
      ...currentTask,
      status: "doing",
      startDate: now,
      updatedAt: now,
    });
    insertItem("processInstances", {
      ...instance,
      ...(hasDueDate ? { dueDate: normalizedDueDate } : {}),
      startedAt: instance.startedAt || now,
      updatedAt: now,
    });
    if (hasDueDate) {
      database
        .prepare(
          `UPDATE work_plans
           SET dueDate = @dueDate,
               updatedAt = @now
           WHERE processInstanceId = @instanceId`,
        )
        .run({ dueDate: normalizedDueDate, now, instanceId: instance.id });
    }

    return { processInstanceId: instance.id, taskId: currentTask.id, startedAt: now, dueDate: hasDueDate ? normalizedDueDate : instance.dueDate ?? null };
  });
  return start();
}

export function launchWorkPlanWithProcess(workPlanId, { processInstance, tasks: generatedTasks = [], workPlan: launchedWorkPlan }) {
  const database = getDatabase();
  const existingWorkPlan = readExistingItem("workPlans", workPlanId);
  const incomingWorkPlan = launchedWorkPlan?.id === workPlanId ? launchedWorkPlan : null;
  const baseWorkPlan = existingWorkPlan ?? incomingWorkPlan;
  if (baseWorkPlan === null) throw new Error("未找到该待发起工作计划。");
  if (baseWorkPlan.processInstanceId || baseWorkPlan.status === "launched") throw new Error("该工作已经发起，不能重复发起。");
  if (!["future", "this_week"].includes(baseWorkPlan.status)) throw new Error("只有待发起工作计划可以发起。");
  if (!processInstance?.id) throw new Error("缺少已发起关键行动数据。");
  if (!Array.isArray(generatedTasks) || generatedTasks.length === 0) throw new Error("缺少标准步骤任务。");
  if (generatedTasks.some((task) => task.processInstanceId !== processInstance.id)) throw new Error("任务与已发起关键行动不匹配。");

  const now = new Date().toISOString();
  const syncedDueDate = processInstance.dueDate ?? launchedWorkPlan?.dueDate ?? baseWorkPlan.dueDate ?? null;
  const nextProcessInstance = {
    ...processInstance,
    dueDate: syncedDueDate,
    updatedAt: now,
  };
  const nextWorkPlan = {
    ...baseWorkPlan,
    ...(launchedWorkPlan ?? {}),
    id: workPlanId,
    workType: launchedWorkPlan?.workType ?? baseWorkPlan.workType ?? "normal",
    status: "launched",
    processInstanceId: processInstance.id,
    dueDate: syncedDueDate,
    launchedAt: launchedWorkPlan?.launchedAt ?? now,
    updatedAt: now,
  };
  const sourceTaskId = nextWorkPlan.workType === "rectification" ? nextWorkPlan.customFields?.sourceTaskId ?? null : null;
  const sourceProcessInstanceId = nextWorkPlan.workType === "rectification" ? nextWorkPlan.customFields?.sourceProcessInstanceId ?? null : null;
  const sourceType = nextWorkPlan.workType === "rectification" ? nextWorkPlan.customFields?.sourceType ?? null : null;
  if ((sourceTaskId !== null && sourceTaskId !== "") || (sourceProcessInstanceId !== null && sourceProcessInstanceId !== "" && sourceType !== null && sourceType !== "")) {
    const duplicatedRectification = database
      .prepare(
        `SELECT wp.id
         FROM work_plans wp
         LEFT JOIN process_instances pi ON pi.id = wp.processInstanceId
         WHERE wp.id <> @workPlanId
           AND wp.workType = 'rectification'
           AND COALESCE(wp.status, '') <> 'canceled'
           AND (
             (@sourceTaskId <> '' AND json_extract(wp.customFields, '$.sourceTaskId') = @sourceTaskId)
             OR (
               @sourceProcessInstanceId <> ''
               AND @sourceType <> ''
               AND json_extract(wp.customFields, '$.sourceProcessInstanceId') = @sourceProcessInstanceId
               AND json_extract(wp.customFields, '$.sourceType') = @sourceType
             )
           )
           AND COALESCE(pi.status, '') NOT IN ('done', 'stopped', 'canceled')
         LIMIT 1`,
      )
      .get({ workPlanId, sourceTaskId: sourceTaskId ?? "", sourceProcessInstanceId: sourceProcessInstanceId ?? "", sourceType: sourceType ?? "" });
    if (duplicatedRectification !== undefined) throw new Error("该来源任务已存在未完成的改善工作，不能重复发起。");
  }

  const launch = database.transaction(() => {
    insertItem("processInstances", nextProcessInstance);
    for (const task of generatedTasks) insertItem("tasks", task);
    insertItem("workPlans", nextWorkPlan);
  });
  launch();

  return { instance: nextProcessInstance, workPlan: nextWorkPlan, tasks: generatedTasks };
}

export function createResource(routeResource, item) {
  const resourceKey = routeResourceMap[routeResource];
  if (resourceKey === undefined) throw new Error(`Unknown resource: ${routeResource}`);
  insertItem(resourceKey, item);
  return item;
}

export function updateResource(routeResource, id, item) {
  const resourceKey = routeResourceMap[routeResource];
  if (resourceKey === undefined) throw new Error(`Unknown resource: ${routeResource}`);
  const mergedItem = mergeExistingItem(resourceKey, id, item);
  const preservedItem = mergePreservedCustomFields(resourceKey, id, mergedItem);
  const nextItem = resourceKey === "tasks" ? markTaskOverdueOnce(preservedItem) : preservedItem;
  insertItem(resourceKey, nextItem);
  return nextItem;
}

export function readRouteResource(routeResource) {
  const resourceKey = routeResourceMap[routeResource];
  if (resourceKey === undefined) throw new Error(`Unknown resource: ${routeResource}`);
  return readResource(resourceKey);
}

export function closeDatabase() {
  if (db !== undefined) {
    db.close();
    db = undefined;
  }
}
