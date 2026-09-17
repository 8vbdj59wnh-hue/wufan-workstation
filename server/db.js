import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { ensureSalesDailyIdentityLookupIndexes } from "./performanceIndexes.js";
import { ensureSalesAnomalyActionStandards } from "./capabilities/salesAnomalyActionStandards.js";
import { hashPassword } from "./security.js";
import {
  assertDatabaseCanOpen,
  assertDatabaseResetAllowed,
  resolveDatabasePath,
} from "./databaseSafety.js";
import { resolveUploadsDirectory } from "./runtimePaths.js";
import { createEmptyPermissions, mergePermissionSources, normalizePermissions, serializePermissions } from "../shared/permissions.js";
import {
  categories,
  companies,
  contentSchedules,
  departments,
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
export const databasePath = resolveDatabasePath({ projectRoot });
export const dataDir = path.dirname(databasePath);
export const uploadsDir = resolveUploadsDirectory({ projectRoot });
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
    columns: ["id", "name", "companySlogan", "status", "createdAt", "updatedAt"],
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
      "permissionTemplateId",
      "permissionOverrides",
      "status",
      "createdAt",
      "updatedAt",
    ],
    booleanFields: ["canLogin", "mustChangePassword"],
    jsonFields: ["permissions", "permissionOverrides"],
  },
  permissionTemplates: {
    table: "permission_templates",
    columns: ["id", "name", "description", "permissions", "status", "createdAt", "updatedAt"],
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
      "businessCode",
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
      "businessCode",
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
      "businessCode",
      "taskType",
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
      "readyAt",
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
      "reviewTargetTaskId",
      "reviewTargetSnapshot",
      "returnToNodeId",
      "reviewStatus",
      "reviewComment",
      "reviewedAt",
      "reviewerId",
      "requireRejectionReason",
      "createdAt",
      "updatedAt",
      "completedAt",
    ],
    booleanFields: ["needAcceptance", "requireRejectionReason"],
    jsonFields: ["resultAttachments", "customFields", "submitFields", "submitFormData", "submitFiles", "submitLinks", "reviewTargetSnapshot"],
  },
  processTemplates: {
    table: "process_templates",
    columns: [
      "id",
      "businessCode",
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
      "stepType",
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
      "reviewerId",
      "reviewTargetType",
      "returnToNodeId",
      "requireRejectionReason",
      "waveEnabled",
      "waveSize",
      "waveUnlimited",
      "waveTemplatePriority",
      "status",
      "createdAt",
      "updatedAt",
    ],
    booleanFields: ["needAcceptance", "requireFile", "requireLink", "requireRejectionReason", "waveEnabled", "waveUnlimited", "waveTemplatePriority"],
    jsonFields: ["submitFields"],
  },
  processInstances: {
    table: "process_instances",
    columns: [
      "id",
      "businessCode",
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
    columns: ["id", "businessCode", "name", "previewImage", "sourceFile", "tags", "fileType", "createdAt", "updatedAt"],
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
  products: {
    table: "products",
    columns: [
      "id", "skuCode", "name", "mainImage", "galleryImages", "brand", "category", "series", "material",
      "color", "specification", "status", "ownerId", "remark", "skuName", "weightKg", "lengthCm", "widthCm",
      "heightCm", "volumeCm3", "productType", "style", "warehouseInfo", "tags", "priceInfo",
      "shelfLifeDays", "pointsInfo", "unitInfo", "placement", "grade", "sourceCreatedAt", "sourceUpdatedAt",
      "supplierInfo", "preSaleInfo", "erpStatusRaw", "erpAttributes", "identifiers", "rawSourceData",
      "sourceSystem", "lastImportedAt", "createdAt", "updatedAt",
    ],
    jsonFields: [
      "galleryImages", "warehouseInfo", "tags", "priceInfo", "pointsInfo", "unitInfo", "supplierInfo",
      "preSaleInfo", "erpAttributes", "identifiers", "rawSourceData",
    ],
  },
  actionProducts: {
    table: "action_products",
    columns: ["id", "actionId", "productId", "erpSkuId", "createdAt"],
  },
  productImportBatches: {
    table: "product_import_batches",
    columns: [
      "id", "fileName", "sourceSystem", "sheetName", "status", "headers", "mappingConfig", "summary",
      "createdBy", "validatedAt", "committedAt", "createdAt", "updatedAt",
    ],
    jsonFields: ["headers", "mappingConfig", "summary"],
  },
  erpGoods: {
    table: "erp_goods",
    columns: [
      "id", "goodsCode", "goodsName", "shortName", "brand", "category", "productType",
      "primarySupplier", "supplierGoodsCode", "sourceCreatedAt", "lastImportedAt",
      "lastSeenBatchId", "currentState", "missingAt", "createdAt", "updatedAt",
    ],
  },
  productErpMappings: {
    table: "product_erp_mappings",
    columns: [
      "id", "productId", "erpGoodsId", "erpSkuId", "merchantSkuCode", "specificationName", "unit", "barcode", "erpStatus",
      "matchMethod", "sourceBatchId", "latestStateJson", "currentState", "missingAt",
      "lastSeenInventoryBatchId", "inventoryCurrentState", "inventoryMissingAt", "createdAt", "updatedAt",
    ],
    jsonFields: ["latestStateJson"],
  },
  salesShops: {
    table: "sales_shops",
    columns: [
      "id", "platform", "shopName", "normalizedShopName", "displayName", "rawShopName",
      "status", "notes", "createdAt", "updatedAt",
    ],
  },
  salesShopAliases: {
    table: "sales_shop_aliases",
    columns: ["id", "shopId", "rawName", "createdAt"],
  },
  salesLinks: {
    table: "sales_links",
    columns: [
      "id", "shopId", "platformGoodsId", "platformGoodsCode", "title", "canonicalUrl",
      "status", "activityStatus", "category", "identityStrength", "originSource", "enrichmentStatus",
      "lastModifiedAt",
      "currentState", "missingAt", "lastImportedAt", "createdAt", "updatedAt",
    ],
  },
  salesLinkSkus: {
    table: "sales_link_skus",
    columns: [
      "id", "salesLinkId", "platformSkuId", "platformSkuCode", "normalizedPlatformSkuCode",
      "specificationName", "normalizedSpecificationName", "price", "platformStock", "occupiedStock",
      "systemGoodsType", "syncEnabled", "lastSyncedStock", "lastSyncedAt", "stopSyncReason",
      "matchStatus", "matchMethod", "matchReason", "currentState", "missingAt", "createdAt", "updatedAt",
    ],
    booleanFields: ["syncEnabled"],
  },
  erpImportBatches: {
    table: "erp_import_batches",
    columns: [
      "id", "importType", "originalFilename", "fileHash", "status", "totalRows", "createdCount",
      "updatedCount", "unchangedCount", "matchedCount", "unmatchedCount", "errorCount", "summaryJson",
      "createdBy", "createdAt", "completedAt",
    ],
    jsonFields: ["summaryJson"],
  },
};

const routeResourceMap = {
  companies: "companies",
  departments: "departments",
  positions: "positions",
  persons: "people",
  people: "people",
  "permission-templates": "permissionTemplates",
  categories: "categories",
  stores: "stores",
  "publishing-accounts": "publishingAccounts",
  "weekly-reports": "weeklyReports",
  "weekly-report-problems": "weeklyReportProblems",
  goals: "goals",
  "task-templates": "taskTemplates",
  tasks: "tasks",
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
  products: "products",
  "action-products": "actionProducts",
  "product-import-batches": "productImportBatches",
  "erp-goods": "erpGoods",
  "product-erp-mappings": "productErpMappings",
  "sales-shops": "salesShops",
  "sales-shop-aliases": "salesShopAliases",
  "sales-links": "salesLinks",
  "sales-link-skus": "salesLinkSkus",
  "erp-import-batches": "erpImportBatches",
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
  products: [],
  actionProducts: [],
  productImportBatches: [],
  erpGoods: [],
  productErpMappings: [],
  salesShops: [],
  salesShopAliases: [],
  salesLinks: [],
  salesLinkSkus: [],
  erpImportBatches: [],
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
    if (config.table === "process_template_nodes" && column === "stepType" && (value === null || value === "")) {
      value = "execution";
    }
    if (config.table === "tasks" && column === "taskType" && (value === null || value === "")) {
      value = "execution";
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
    permissionOverrides: {},
    relatedGoalIds: [],
    steps: [],
    previewImage: {},
    sourceFile: {},
    tags: {},
    replyRecords: [],
    galleryImages: [],
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
  if (config.table === "process_template_nodes" && !decoded.stepType) decoded.stepType = "execution";
  if (config.table === "process_template_nodes") {
    if (decoded.waveEnabled === null || decoded.waveEnabled === undefined) decoded.waveEnabled = false;
    if (!Number.isInteger(Number(decoded.waveSize))) decoded.waveSize = 10;
    if (decoded.waveUnlimited === null || decoded.waveUnlimited === undefined) decoded.waveUnlimited = false;
    if (decoded.waveTemplatePriority === null || decoded.waveTemplatePriority === undefined) decoded.waveTemplatePriority = true;
  }
  if (config.table === "tasks" && !decoded.taskType) decoded.taskType = "execution";

  return decoded;
}

function hasTemplateTags(tags) {
  if (Array.isArray(tags)) return tags.length > 0;
  if (tags === null || tags === undefined || typeof tags !== "object") return false;
  return Object.values(tags).some((value) => Array.isArray(value) && value.length > 0);
}

function validateTemplateItem(item) {
  const previewImage = item.previewImage;
  if (String(item.id ?? "").trim() === "") throw new Error("模板 id 不能为空。");
  if (String(item.name ?? "").trim() === "") throw new Error("模板名称不能为空。");
  if (previewImage === null || typeof previewImage !== "object" || String(previewImage.fileUrl ?? "").trim() === "") {
    throw new Error("模板预览图不能为空。");
  }
  if (!hasTemplateTags(item.tags)) throw new Error("模板标签不能为空。");
}

const businessIdentifierConfigs = {
  goals: { table: "goals", prefix: "GOAL" },
  taskTemplates: { table: "task_templates", prefix: "AS" },
  processInstances: { table: "process_instances", prefix: "KA" },
  tasks: { table: "tasks", prefix: "TASK" },
  processTemplates: { table: "process_templates", prefix: "TPL" },
  templates: { table: "templates", prefix: "MB" },
};

function getBusinessIdentifierMonth(value) {
  const rawValue = String(value ?? "").trim();
  const date = new Date(rawValue);
  if (!Number.isNaN(date.getTime())) {
    const businessDate = new Date(date.getTime() + 8 * 60 * 60 * 1000);
    return `${businessDate.getUTCFullYear()}${String(businessDate.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  const matchedMonth = rawValue.match(/^(\d{4})-(\d{2})/);
  if (matchedMonth !== null) return `${matchedMonth[1]}${matchedMonth[2]}`;

  const businessNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return `${businessNow.getUTCFullYear()}${String(businessNow.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getNextBusinessIdentifier(config, month) {
  const prefix = `${config.prefix}-${month}-`;
  const rows = getDatabase()
    .prepare(`SELECT businessCode FROM ${config.table} WHERE businessCode LIKE @pattern`)
    .all({ pattern: `${prefix}%` });
  const highestSerial = rows.reduce((highest, row) => {
    const rawSerial = String(row.businessCode ?? "").slice(prefix.length);
    return /^\d+$/.test(rawSerial) ? Math.max(highest, Number(rawSerial)) : highest;
  }, 0);
  return `${prefix}${String(highestSerial + 1).padStart(4, "0")}`;
}

function applyBusinessIdentifier(resourceKey, item) {
  const config = businessIdentifierConfigs[resourceKey];
  if (config === undefined) return;

  const existing = getDatabase()
    .prepare(`SELECT businessCode FROM ${config.table} WHERE id = @id LIMIT 1`)
    .get({ id: item.id });
  if (String(existing?.businessCode ?? "").trim() !== "") {
    item.businessCode = existing.businessCode;
    return;
  }

  item.businessCode = getNextBusinessIdentifier(config, getBusinessIdentifierMonth(item.createdAt));
}

function insertItem(resourceKey, item) {
  const config = resourceConfigs[resourceKey];
  if (resourceKey === "templates") validateTemplateItem(item);
  applyBusinessIdentifier(resourceKey, item);
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

function validateTaskSubmission(task) {
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
    readyAt: now,
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
  let nextTask = orderedTasks.find((task) => task.status !== "done");
  if (nextTask?.status === "pending_acceptance") {
    const targetIndex = orderedTasks.findIndex((task) => task.id === nextTask.id);
    const reviewTask = orderedTasks[targetIndex + 1];
    if (
      reviewTask?.taskType === "review" &&
      reviewTask.reviewTargetTaskId === nextTask.id &&
      reviewTask.status !== "done"
    ) {
      nextTask = reviewTask;
    }
  }
  if (nextTask !== undefined) {
    const nextIndex = orderedTasks.findIndex((task) => task.id === nextTask.id);
    const previousTasksDone =
      nextIndex > 0 &&
      orderedTasks.slice(0, nextIndex).every((task) => {
        if (
          nextTask.taskType === "review" &&
          task.id === nextTask.reviewTargetTaskId &&
          task.status === "pending_acceptance"
        ) {
          return true;
        }
        return task.status === "done";
      });
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

  if (!hasColumn) {
    getDatabase().exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`[db:migrate] added ${table}.${column}`);
  }
}

function tableExists(table) {
  return Boolean(getDatabase().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

const productBusinessDualIdentityTables = Object.freeze([
  "product_marketing_assets", "action_products", "product_lifecycle_events", "product_health_records",
  "product_issues", "product_improvements", "product_strategy_versions", "product_insights", "product_clearance_plans",
]);

function productBusinessErpBackfillExpression(alias = "legacy") {
  return `COALESCE(${alias}.erpSkuId,(SELECT mapping.erpSkuId FROM product_erp_mappings mapping
    WHERE mapping.productId=${alias}.productId AND mapping.currentState='active'
      AND (SELECT COUNT(*) FROM product_erp_mappings product_mapping WHERE product_mapping.productId=${alias}.productId AND product_mapping.currentState='active')=1
      AND (SELECT COUNT(*) FROM product_erp_mappings erp_mapping WHERE erp_mapping.erpSkuId=mapping.erpSkuId AND erp_mapping.currentState='active')=1
    ORDER BY mapping.updatedAt DESC,mapping.id DESC LIMIT 1))`;
}

function rebuildProductBusinessDualIdentityTables() {
  const database = getDatabase();
  for (const table of productBusinessDualIdentityTables) if (tableExists(table)) ensureColumn(table, "erpSkuId", "TEXT");
  const needsRebuild = productBusinessDualIdentityTables.some((table) => tableExists(table)
    && database.prepare(`PRAGMA table_info(${table})`).all().some((column) => column.name === "productId" && Number(column.notnull) === 1));
  if (!needsRebuild) return;
  const erp = productBusinessErpBackfillExpression();
  database.pragma("foreign_keys = OFF");
  try {
    database.transaction(() => {
      database.exec(`
        DROP TABLE IF EXISTS product_marketing_assets_phase_b;
        CREATE TABLE product_marketing_assets_phase_b (
          id TEXT PRIMARY KEY,productId TEXT,erpSkuId TEXT,positioning TEXT,targetAudience TEXT,
          usageScenariosJson TEXT NOT NULL DEFAULT '[]',sellingPointsJson TEXT NOT NULL DEFAULT '[]',productStory TEXT,
          keywordsJson TEXT NOT NULL DEFAULT '[]',createdBy TEXT,updatedBy TEXT,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,
          FOREIGN KEY(productId) REFERENCES products(id),FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id),
          FOREIGN KEY(createdBy) REFERENCES persons(id),FOREIGN KEY(updatedBy) REFERENCES persons(id)
        );
        INSERT INTO product_marketing_assets_phase_b
          SELECT id,productId,${erp},positioning,targetAudience,usageScenariosJson,sellingPointsJson,productStory,keywordsJson,createdBy,updatedBy,createdAt,updatedAt FROM product_marketing_assets legacy;

        DROP TABLE IF EXISTS action_products_phase_b;
        CREATE TABLE action_products_phase_b (
          id TEXT PRIMARY KEY,actionId TEXT NOT NULL,productId TEXT,erpSkuId TEXT,createdAt TEXT,
          UNIQUE(actionId,productId),FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id)
        );
        INSERT INTO action_products_phase_b SELECT id,actionId,productId,${erp},createdAt FROM action_products legacy;

        DROP TABLE IF EXISTS product_lifecycle_events_phase_b;
        CREATE TABLE product_lifecycle_events_phase_b (
          id TEXT PRIMARY KEY,productId TEXT,erpSkuId TEXT,fromStatus TEXT,toStatus TEXT NOT NULL,reason TEXT,changedBy TEXT,changedAt TEXT NOT NULL,
          FOREIGN KEY(productId) REFERENCES products(id),FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id),FOREIGN KEY(changedBy) REFERENCES persons(id)
        );
        INSERT INTO product_lifecycle_events_phase_b SELECT id,productId,${erp},fromStatus,toStatus,reason,changedBy,changedAt FROM product_lifecycle_events legacy;

        DROP TABLE IF EXISTS product_health_records_phase_b;
        CREATE TABLE product_health_records_phase_b (
          id TEXT PRIMARY KEY,productId TEXT,erpSkuId TEXT,snapshotKey TEXT NOT NULL,healthScore REAL,healthStatus TEXT NOT NULL,
          metricsJson TEXT NOT NULL DEFAULT '{}',problemsJson TEXT NOT NULL DEFAULT '[]',suggestionsJson TEXT NOT NULL DEFAULT '[]',createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,
          FOREIGN KEY(productId) REFERENCES products(id),FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id),UNIQUE(productId,snapshotKey)
        );
        INSERT INTO product_health_records_phase_b SELECT id,productId,${erp},snapshotKey,healthScore,healthStatus,metricsJson,problemsJson,suggestionsJson,createdAt,updatedAt FROM product_health_records legacy;

        DROP TABLE IF EXISTS product_issues_phase_b;
        CREATE TABLE product_issues_phase_b (
          id TEXT PRIMARY KEY,productId TEXT,erpSkuId TEXT,healthRecordId TEXT NOT NULL,issueType TEXT NOT NULL,title TEXT NOT NULL,severity TEXT NOT NULL,
          detailJson TEXT NOT NULL DEFAULT '{}',status TEXT NOT NULL DEFAULT 'open',createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,
          FOREIGN KEY(productId) REFERENCES products(id),FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id),FOREIGN KEY(healthRecordId) REFERENCES product_health_records(id),UNIQUE(healthRecordId,issueType)
        );
        INSERT INTO product_issues_phase_b SELECT id,productId,${erp},healthRecordId,issueType,title,severity,detailJson,status,createdAt,updatedAt FROM product_issues legacy;

        DROP TABLE IF EXISTS product_improvements_phase_b;
        CREATE TABLE product_improvements_phase_b (
          id TEXT PRIMARY KEY,productId TEXT,erpSkuId TEXT,issueId TEXT NOT NULL,actionId TEXT NOT NULL,title TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'planned',
          beforeMetricsJson TEXT NOT NULL DEFAULT '{}',afterMetricsJson TEXT NOT NULL DEFAULT '{}',improvementMeasures TEXT,resultSummary TEXT,completedAt TEXT,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,
          FOREIGN KEY(productId) REFERENCES products(id),FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id),FOREIGN KEY(issueId) REFERENCES product_issues(id),FOREIGN KEY(actionId) REFERENCES process_instances(id),UNIQUE(issueId,actionId)
        );
        INSERT INTO product_improvements_phase_b SELECT id,productId,${erp},issueId,actionId,title,status,beforeMetricsJson,afterMetricsJson,improvementMeasures,resultSummary,completedAt,createdAt,updatedAt FROM product_improvements legacy;

        DROP TABLE IF EXISTS product_strategy_versions_phase_b;
        CREATE TABLE product_strategy_versions_phase_b (
          id TEXT PRIMARY KEY,productId TEXT,erpSkuId TEXT,version INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'current',effectiveAt TEXT NOT NULL,endedAt TEXT,changedBy TEXT,
          contentJson TEXT NOT NULL DEFAULT '{}',createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,UNIQUE(productId,version),
          FOREIGN KEY(productId) REFERENCES products(id),FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id)
        );
        INSERT INTO product_strategy_versions_phase_b SELECT id,productId,${erp},version,status,effectiveAt,endedAt,changedBy,contentJson,createdAt,updatedAt FROM product_strategy_versions legacy;

        DROP TABLE IF EXISTS product_insights_phase_b;
        CREATE TABLE product_insights_phase_b (
          id TEXT PRIMARY KEY,productId TEXT,erpSkuId TEXT,insightType TEXT NOT NULL,content TEXT NOT NULL,source TEXT NOT NULL,importance INTEGER,description TEXT,frequencyText TEXT,note TEXT,
          impactLevel TEXT,handlingStatus TEXT,opportunityType TEXT,priority TEXT,status TEXT,relatedStrategyVersionId TEXT,relatedImprovementId TEXT,relatedActionId TEXT,
          providerId TEXT NOT NULL DEFAULT 'manual',createdBy TEXT,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,
          FOREIGN KEY(productId) REFERENCES products(id),FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id),FOREIGN KEY(relatedStrategyVersionId) REFERENCES product_strategy_versions(id),
          FOREIGN KEY(relatedImprovementId) REFERENCES product_improvements(id),FOREIGN KEY(relatedActionId) REFERENCES process_instances(id)
        );
        INSERT INTO product_insights_phase_b SELECT id,productId,${erp},insightType,content,source,importance,description,frequencyText,note,impactLevel,handlingStatus,opportunityType,priority,status,relatedStrategyVersionId,relatedImprovementId,relatedActionId,providerId,createdBy,createdAt,updatedAt FROM product_insights legacy;

        DROP TABLE IF EXISTS product_clearance_plans_phase_b;
        CREATE TABLE product_clearance_plans_phase_b (
          id TEXT PRIMARY KEY,productId TEXT,erpSkuId TEXT,status TEXT NOT NULL DEFAULT 'active',startDate TEXT NOT NULL,targetDays INTEGER NOT NULL,targetEndDate TEXT NOT NULL,
          initialInventoryQuantity REAL,targetInventoryQuantity REAL NOT NULL DEFAULT 0,note TEXT,createdBy TEXT,completedAt TEXT,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,
          FOREIGN KEY(productId) REFERENCES products(id),FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id),FOREIGN KEY(createdBy) REFERENCES persons(id)
        );
        INSERT INTO product_clearance_plans_phase_b SELECT id,productId,${erp},status,startDate,targetDays,targetEndDate,initialInventoryQuantity,targetInventoryQuantity,note,createdBy,completedAt,createdAt,updatedAt FROM product_clearance_plans legacy;

        DROP TABLE product_insights; DROP TABLE product_improvements; DROP TABLE product_issues; DROP TABLE product_health_records;
        DROP TABLE product_strategy_versions; DROP TABLE product_marketing_assets; DROP TABLE product_lifecycle_events; DROP TABLE product_clearance_plans; DROP TABLE action_products;
        ALTER TABLE product_health_records_phase_b RENAME TO product_health_records;
        ALTER TABLE product_issues_phase_b RENAME TO product_issues;
        ALTER TABLE product_improvements_phase_b RENAME TO product_improvements;
        ALTER TABLE product_strategy_versions_phase_b RENAME TO product_strategy_versions;
        ALTER TABLE product_insights_phase_b RENAME TO product_insights;
        ALTER TABLE product_marketing_assets_phase_b RENAME TO product_marketing_assets;
        ALTER TABLE product_lifecycle_events_phase_b RENAME TO product_lifecycle_events;
        ALTER TABLE product_clearance_plans_phase_b RENAME TO product_clearance_plans;
        ALTER TABLE action_products_phase_b RENAME TO action_products;
      `);
    })();
  } finally {
    database.pragma("foreign_keys = ON");
  }
  console.log("[db:migrate] product business extension tables now support ERP SKU identity");
}

function backfillProductBusinessProfiles() {
  const database = getDatabase();
  const timestamp = new Date().toISOString();
  database.prepare(`INSERT INTO product_business_profiles
      (id,erpSkuId,businessStatus,lifecycle,ownerId,brandOverride,categoryOverride,displayNameOverride,createdAt,updatedAt)
    SELECT 'product-business-profile-' || lower(hex(randomblob(16))),mapping.erpSkuId,
      CASE product.status WHEN '已归档' THEN 'archived' WHEN '清仓' THEN 'clearance' WHEN '停售' THEN 'paused' ELSE 'active' END,
      product.status,product.ownerId,
      CASE WHEN trim(COALESCE(product.brand,''))<>'' AND trim(COALESCE(product.brand,''))<>trim(COALESCE(goods.brand,'')) THEN product.brand END,
      CASE WHEN trim(COALESCE(product.category,''))<>'' AND trim(COALESCE(product.category,''))<>trim(COALESCE(goods.category,'')) THEN product.category END,
      CASE WHEN trim(COALESCE(product.name,''))<>'' AND trim(COALESCE(product.name,'')) NOT IN (trim(COALESCE(goods.goodsName,'')),trim(COALESCE(sku.specificationName,'')),trim(COALESCE(sku.merchantSkuCode,''))) THEN product.name END,
      COALESCE(product.createdAt,?),COALESCE(product.updatedAt,?)
    FROM products product JOIN product_erp_mappings mapping ON mapping.productId=product.id AND mapping.currentState='active'
    JOIN erp_skus sku ON sku.id=mapping.erpSkuId LEFT JOIN erp_goods goods ON goods.id=sku.erpGoodsId
    WHERE (SELECT COUNT(*) FROM product_erp_mappings value WHERE value.productId=product.id AND value.currentState='active')=1
      AND (SELECT COUNT(*) FROM product_erp_mappings value WHERE value.erpSkuId=mapping.erpSkuId AND value.currentState='active')=1
    ON CONFLICT(erpSkuId) DO NOTHING`).run(timestamp, timestamp);
}

function ensureProductBusinessLegacyIndexes() {
  getDatabase().exec(`
    CREATE INDEX IF NOT EXISTS idx_product_marketing_assets_product
      ON product_marketing_assets(productId);
    CREATE INDEX IF NOT EXISTS idx_action_products_action ON action_products(actionId);
    CREATE INDEX IF NOT EXISTS idx_action_products_product ON action_products(productId);
    CREATE INDEX IF NOT EXISTS idx_product_lifecycle_events_product_time
      ON product_lifecycle_events(productId, changedAt DESC);
    CREATE INDEX IF NOT EXISTS idx_product_health_records_status_time
      ON product_health_records(healthStatus, updatedAt DESC);
    CREATE INDEX IF NOT EXISTS idx_product_issues_product_status
      ON product_issues(productId, status, updatedAt DESC);
    CREATE INDEX IF NOT EXISTS idx_product_improvements_product_status
      ON product_improvements(productId, status, updatedAt DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_product_strategy_current
      ON product_strategy_versions(productId) WHERE status='current';
    CREATE INDEX IF NOT EXISTS idx_product_strategy_history
      ON product_strategy_versions(productId, version DESC);
    CREATE INDEX IF NOT EXISTS idx_product_insights_product_type
      ON product_insights(productId, insightType, updatedAt DESC);
    CREATE INDEX IF NOT EXISTS idx_product_insights_improvement
      ON product_insights(relatedImprovementId) WHERE relatedImprovementId IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_product_insights_action
      ON product_insights(relatedActionId) WHERE relatedActionId IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_product_clearance_plans_active
      ON product_clearance_plans(productId) WHERE status='active';
    CREATE INDEX IF NOT EXISTS idx_product_clearance_plans_status_end
      ON product_clearance_plans(status, targetEndDate, updatedAt DESC);
  `);
}

export function runProductBusinessExtensionMigration() {
  rebuildProductBusinessDualIdentityTables();
  for (const table of productBusinessDualIdentityTables) if (tableExists(table)) ensureColumn(table, "erpSkuId", "TEXT");
  const database = getDatabase();
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_product_marketing_assets_erp_sku ON product_marketing_assets(erpSkuId) WHERE erpSkuId IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_action_products_erp_sku ON action_products(actionId,erpSkuId) WHERE erpSkuId IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_product_lifecycle_events_erp_sku_time ON product_lifecycle_events(erpSkuId,changedAt DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_product_health_records_erp_snapshot ON product_health_records(erpSkuId,snapshotKey) WHERE erpSkuId IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_product_issues_erp_sku_status ON product_issues(erpSkuId,status,updatedAt DESC);
    CREATE INDEX IF NOT EXISTS idx_product_improvements_erp_sku_status ON product_improvements(erpSkuId,status,updatedAt DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_product_strategy_current_erp_sku ON product_strategy_versions(erpSkuId) WHERE status='current' AND erpSkuId IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_product_strategy_history_erp_sku ON product_strategy_versions(erpSkuId,version) WHERE erpSkuId IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_product_insights_erp_sku_type ON product_insights(erpSkuId,insightType,updatedAt DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_product_clearance_plans_active_erp_sku ON product_clearance_plans(erpSkuId) WHERE status='active' AND erpSkuId IS NOT NULL;
  `);
  // The Phase B table rebuild drops indexes together with the replaced tables.
  // Restore the Legacy productId compatibility indexes in the same initialization
  // pass so the first and every subsequent migration produce identical schemas.
  ensureProductBusinessLegacyIndexes();
  backfillProductBusinessProfiles();
}

function migrateConnectionProfilesIntoSalesLinksV1() {
  const database = getDatabase();
  if (!tableExists("connection_profiles")) return;
  if (tableExists("legacy_connection_profiles")) {
    throw new Error("Link资产经营档案迁移状态冲突：新旧档案表同时存在。");
  }

  const dependentTables = database.prepare(`
    SELECT name,sql FROM sqlite_master
    WHERE type='table' AND name<>'connection_profiles' AND sql LIKE '%REFERENCES connection_profiles(id)%'
    ORDER BY name
  `).all();
  database.pragma("foreign_keys = OFF");
  try {
    database.transaction(() => {
      database.exec(`
        UPDATE sales_links
        SET displayName=(SELECT c.name FROM connection_profiles c WHERE c.salesLinkId=sales_links.id),
            ownerId=(SELECT c.ownerId FROM connection_profiles c WHERE c.salesLinkId=sales_links.id),
            managementStatus=COALESCE((SELECT c.status FROM connection_profiles c WHERE c.salesLinkId=sales_links.id),'active'),
            managementNotes=(SELECT c.notes FROM connection_profiles c WHERE c.salesLinkId=sales_links.id),
            mainImage=(SELECT c.mainImage FROM connection_profiles c WHERE c.salesLinkId=sales_links.id),
            imageSource=(SELECT c.imageSource FROM connection_profiles c WHERE c.salesLinkId=sales_links.id),
            managementLevel=COALESCE((SELECT c.level FROM connection_profiles c WHERE c.salesLinkId=sales_links.id),'new'),
            managementOriginSource=COALESCE((SELECT c.originSource FROM connection_profiles c WHERE c.salesLinkId=sales_links.id),'asset_native'),
            managementOriginImportBatchId=(SELECT c.originImportBatchId FROM connection_profiles c WHERE c.salesLinkId=sales_links.id),
            managementIdentifiedAt=(SELECT c.identifiedAt FROM connection_profiles c WHERE c.salesLinkId=sales_links.id),
            managementCreatedBy=(SELECT c.createdBy FROM connection_profiles c WHERE c.salesLinkId=sales_links.id)
        WHERE EXISTS (SELECT 1 FROM connection_profiles c WHERE c.salesLinkId=sales_links.id);
      `);

      for (const table of dependentTables) {
        const foreignColumns = database.prepare(`PRAGMA foreign_key_list("${table.name}")`).all()
          .filter((item) => item.table === "connection_profiles").map((item) => item.from);
        for (const column of foreignColumns) {
          database.exec(`
            UPDATE "${table.name}"
            SET "${column}"=COALESCE((SELECT c.salesLinkId FROM connection_profiles c WHERE c.id="${table.name}"."${column}"),"${column}")
            WHERE "${column}" IS NOT NULL;
          `);
        }

        const relatedSchema = database.prepare(`
          SELECT type,name,sql FROM sqlite_master
          WHERE tbl_name=? AND type IN ('index','trigger') AND sql IS NOT NULL
          ORDER BY type,name
        `).all(table.name);
        const temporaryName = `__link_asset_${table.name}`;
        const createSql = String(table.sql)
          .replace(new RegExp(`^CREATE TABLE\\s+(?:IF NOT EXISTS\\s+)?[\\\"\\\x60]?${table.name}[\\\"\\\x60]?`, "i"), `CREATE TABLE "${temporaryName}"`)
          .replaceAll("REFERENCES connection_profiles(id)", "REFERENCES sales_links(id)");
        database.exec(createSql);
        const columns = database.prepare(`PRAGMA table_info("${table.name}")`).all().map((item) => `"${item.name}"`).join(",");
        database.exec(`INSERT INTO "${temporaryName}" (${columns}) SELECT ${columns} FROM "${table.name}"`);
        database.exec(`DROP TABLE "${table.name}"`);
        database.exec(`ALTER TABLE "${temporaryName}" RENAME TO "${table.name}"`);
        for (const schemaItem of relatedSchema) database.exec(schemaItem.sql);
      }

      database.exec(`ALTER TABLE connection_profiles RENAME TO legacy_connection_profiles`);
    })();
  } finally {
    database.pragma("foreign_keys = ON");
  }
  const violations = database.pragma("foreign_key_check");
  if (violations.length) throw new Error(`Link资产经营档案迁移后存在 ${violations.length} 条外键异常。`);
}

function migrateProductErpMappingsV2() {
  const database = getDatabase();
  const columns = database.prepare("PRAGMA table_info(product_erp_mappings)").all();
  const foreignKeys = database.prepare("PRAGMA foreign_key_list(product_erp_mappings)").all();
  const hasErpSkuId = columns.some((item) => item.name === "erpSkuId");
  const hasErpSkuForeignKey = foreignKeys.some((item) => item.from === "erpSkuId" && item.table === "erp_skus");
  if (!hasErpSkuId || !hasErpSkuForeignKey) {
    const unmatched = database.prepare(`
      SELECT COUNT(*) total
      FROM product_erp_mappings m
      LEFT JOIN erp_skus s ON LOWER(TRIM(s.merchantSkuCode))=LOWER(TRIM(m.merchantSkuCode))
      WHERE s.id IS NULL
    `).get().total;
    if (Number(unmatched) > 0) {
      throw new Error(`product_erp_mappings V2 migration requires exact ERP SKU matches; unmatched=${unmatched}`);
    }
    database.pragma("foreign_keys = OFF");
    try {
      database.transaction(() => {
        database.exec("DROP TABLE IF EXISTS product_erp_mappings_v2");
        database.exec(`
          CREATE TABLE product_erp_mappings_v2 (
            id TEXT PRIMARY KEY,
            productId TEXT NOT NULL UNIQUE,
            erpGoodsId TEXT NOT NULL,
            erpSkuId TEXT,
            merchantSkuCode TEXT NOT NULL COLLATE NOCASE UNIQUE,
            specificationName TEXT,
            unit TEXT,
            barcode TEXT,
            erpStatus TEXT,
            matchMethod TEXT NOT NULL,
            sourceBatchId TEXT,
            latestStateJson TEXT,
            currentState TEXT NOT NULL DEFAULT 'active',
            missingAt TEXT,
            lastSeenInventoryBatchId TEXT,
            inventoryCurrentState TEXT NOT NULL DEFAULT 'active',
            inventoryMissingAt TEXT,
            createdAt TEXT,
            updatedAt TEXT,
            FOREIGN KEY(productId) REFERENCES products(id),
            FOREIGN KEY(erpGoodsId) REFERENCES erp_goods(id),
            FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id)
          );
        `);
        database.exec(`
          INSERT INTO product_erp_mappings_v2 (
            id,productId,erpGoodsId,erpSkuId,merchantSkuCode,specificationName,unit,barcode,erpStatus,
            matchMethod,sourceBatchId,latestStateJson,currentState,missingAt,lastSeenInventoryBatchId,
            inventoryCurrentState,inventoryMissingAt,createdAt,updatedAt
          )
          SELECT m.id,m.productId,m.erpGoodsId,
            (SELECT s.id FROM erp_skus s WHERE LOWER(TRIM(s.merchantSkuCode))=LOWER(TRIM(m.merchantSkuCode)) LIMIT 1),
            m.merchantSkuCode,m.specificationName,m.unit,m.barcode,m.erpStatus,m.matchMethod,m.sourceBatchId,
            m.latestStateJson,m.currentState,m.missingAt,m.lastSeenInventoryBatchId,m.inventoryCurrentState,
            m.inventoryMissingAt,m.createdAt,m.updatedAt
          FROM product_erp_mappings m;
        `);
        database.exec("DROP TABLE product_erp_mappings");
        database.exec("ALTER TABLE product_erp_mappings_v2 RENAME TO product_erp_mappings");
      })();
    } finally {
      database.pragma("foreign_keys = ON");
    }
    console.log("[db:migrate] upgraded product_erp_mappings with erpSkuId foreign key");
  }
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_product_erp_mappings_erp_sku
      ON product_erp_mappings(erpSkuId) WHERE erpSkuId IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_product_erp_mappings_current_seen
      ON product_erp_mappings(currentState,sourceBatchId);
    CREATE INDEX IF NOT EXISTS idx_product_erp_mappings_inventory_seen
      ON product_erp_mappings(inventoryCurrentState,lastSeenInventoryBatchId);
  `);
}

export function migrateConnectionSkuSalesDailyFactsV1() {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS connection_sku_sales_daily_facts (
      id TEXT PRIMARY KEY,
      salesLinkId TEXT NOT NULL,
      salesLinkSkuId TEXT NOT NULL,
      erpSkuId TEXT NOT NULL,
      saleDate TEXT NOT NULL,
      quantity REAL,
      salesAmount REAL,
      costAmount REAL,
      profitAmount REAL,
      incomeAmount REAL,
      refundAmount REAL,
      returnAmount REAL,
      postageIncomeAmount REAL,
      goodsCostAmount REAL,
      returnCostAmount REAL,
      postageCostAmount REAL,
      otherAdjustmentAmount REAL,
      feeAmount REAL,
      receivedAmount REAL,
      factType TEXT NOT NULL DEFAULT 'normal',
      sourceBatchId TEXT NOT NULL,
      sourceRowNumber INTEGER NOT NULL,
      rawDataJson TEXT NOT NULL DEFAULT '{}',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY(salesLinkId) REFERENCES sales_links(id),
      FOREIGN KEY(salesLinkSkuId) REFERENCES sales_link_skus(id),
      FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id),
      FOREIGN KEY(sourceBatchId) REFERENCES connection_import_batches(id),
      UNIQUE(salesLinkSkuId,erpSkuId,saleDate),
      CHECK(factType IN ('normal','combo_component')),
      CHECK(length(saleDate)=10 AND saleDate GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      CHECK(sourceRowNumber > 0)
    );
    CREATE INDEX IF NOT EXISTS idx_connection_sku_sales_daily_link_date
      ON connection_sku_sales_daily_facts(salesLinkId,saleDate);
    CREATE INDEX IF NOT EXISTS idx_connection_sku_sales_daily_erp_date
      ON connection_sku_sales_daily_facts(erpSkuId,saleDate);
    CREATE INDEX IF NOT EXISTS idx_connection_sku_sales_daily_date
      ON connection_sku_sales_daily_facts(saleDate);
    CREATE INDEX IF NOT EXISTS idx_connection_sku_sales_daily_batch
      ON connection_sku_sales_daily_facts(sourceBatchId);
  `);
}

export function migrateSalesRelationCandidatesV1() {
  const database = getDatabase();
  database.exec(`
    CREATE TABLE IF NOT EXISTS sales_link_sku_erp_mapping_candidates (
      id TEXT PRIMARY KEY,
      salesLinkSkuId TEXT NOT NULL,
      erpSkuId TEXT NOT NULL,
      candidateType TEXT NOT NULL,
      suggestedQuantity REAL NOT NULL DEFAULT 1,
      sourceType TEXT NOT NULL,
      sourceBatchId TEXT NOT NULL,
      sourceFileHash TEXT NOT NULL,
      sourceRowNumber INTEGER NOT NULL,
      evidenceJson TEXT NOT NULL DEFAULT '{}',
      affectedRowCount INTEGER NOT NULL DEFAULT 0,
      affectedDateStart TEXT,
      affectedDateEnd TEXT,
      salesAmount REAL,
      profitAmount REAL,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewedBy TEXT,
      reviewedAt TEXT,
      decisionNote TEXT,
      mappingId TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY(salesLinkSkuId) REFERENCES sales_link_skus(id),
      FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id),
      FOREIGN KEY(sourceBatchId) REFERENCES connection_import_batches(id),
      FOREIGN KEY(reviewedBy) REFERENCES persons(id),
      UNIQUE(salesLinkSkuId,erpSkuId,sourceBatchId),
      CHECK(candidateType IN ('single','combo')),
      CHECK(status IN ('pending','approved','rejected','superseded','conflict')),
      CHECK(suggestedQuantity > 0),
      CHECK(sourceRowNumber > 0),
      CHECK(affectedRowCount > 0)
    );
    CREATE INDEX IF NOT EXISTS idx_sales_relation_candidates_status_type
      ON sales_link_sku_erp_mapping_candidates(status,candidateType,createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_sales_relation_candidates_batch
      ON sales_link_sku_erp_mapping_candidates(sourceBatchId,status);
    CREATE INDEX IF NOT EXISTS idx_sales_relation_candidates_link_sku
      ON sales_link_sku_erp_mapping_candidates(salesLinkSkuId,status);
    CREATE INDEX IF NOT EXISTS idx_sales_relation_candidates_erp_sku
      ON sales_link_sku_erp_mapping_candidates(erpSkuId,status);
  `);
  const tableSql = String(database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='sales_link_sku_erp_mapping_candidates'").get()?.sql || "");
  if (/REFERENCES\s+sales_link_sku_erp_mappings/i.test(tableSql)) {
    database.pragma("foreign_keys = OFF");
    database.transaction(() => database.exec(`
      CREATE TABLE sales_link_sku_erp_mapping_candidates_v2 (
        id TEXT PRIMARY KEY,
        salesLinkSkuId TEXT NOT NULL,
        erpSkuId TEXT NOT NULL,
        candidateType TEXT NOT NULL,
        suggestedQuantity REAL NOT NULL DEFAULT 1,
        sourceType TEXT NOT NULL,
        sourceBatchId TEXT NOT NULL,
        sourceFileHash TEXT NOT NULL,
        sourceRowNumber INTEGER NOT NULL,
        evidenceJson TEXT NOT NULL DEFAULT '{}',
        affectedRowCount INTEGER NOT NULL DEFAULT 0,
        affectedDateStart TEXT,
        affectedDateEnd TEXT,
        salesAmount REAL,
        profitAmount REAL,
        status TEXT NOT NULL DEFAULT 'pending',
        reviewedBy TEXT,
        reviewedAt TEXT,
        decisionNote TEXT,
        mappingId TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY(salesLinkSkuId) REFERENCES sales_link_skus(id),
        FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id),
        FOREIGN KEY(sourceBatchId) REFERENCES connection_import_batches(id),
        FOREIGN KEY(reviewedBy) REFERENCES persons(id),
        UNIQUE(salesLinkSkuId,erpSkuId,sourceBatchId),
        CHECK(candidateType IN ('single','combo')),
        CHECK(status IN ('pending','approved','rejected','superseded','conflict')),
        CHECK(suggestedQuantity > 0),
        CHECK(sourceRowNumber > 0),
        CHECK(affectedRowCount > 0)
      );
      INSERT INTO sales_link_sku_erp_mapping_candidates_v2 SELECT * FROM sales_link_sku_erp_mapping_candidates;
      DROP TABLE sales_link_sku_erp_mapping_candidates;
      ALTER TABLE sales_link_sku_erp_mapping_candidates_v2 RENAME TO sales_link_sku_erp_mapping_candidates;
      CREATE INDEX idx_sales_relation_candidates_status_type ON sales_link_sku_erp_mapping_candidates(status,candidateType,createdAt DESC);
      CREATE INDEX idx_sales_relation_candidates_batch ON sales_link_sku_erp_mapping_candidates(sourceBatchId,status);
      CREATE INDEX idx_sales_relation_candidates_link_sku ON sales_link_sku_erp_mapping_candidates(salesLinkSkuId,status);
      CREATE INDEX idx_sales_relation_candidates_erp_sku ON sales_link_sku_erp_mapping_candidates(erpSkuId,status);
    `))();
    database.pragma("foreign_keys = ON");
  }
}

export function migrateSalesObjectsV1() {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS sales_objects (
      id TEXT PRIMARY KEY,
      objectCode TEXT NOT NULL,
      normalizedObjectCode TEXT NOT NULL UNIQUE,
      objectType TEXT NOT NULL,
      source TEXT NOT NULL,
      sourceType TEXT NOT NULL,
      sourceCode TEXT NOT NULL,
      sourceBatchId TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      blockedReason TEXT,
      firstSeenAt TEXT NOT NULL,
      lastSeenAt TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      CHECK(objectType IN ('single','bundle')),
      CHECK(status IN ('active','inactive','blocked','superseded'))
    );
    CREATE INDEX IF NOT EXISTS idx_sales_objects_status_type
      ON sales_objects(status,objectType,updatedAt DESC);
    CREATE INDEX IF NOT EXISTS idx_sales_objects_source_code
      ON sales_objects(source,normalizedObjectCode);

    CREATE TABLE IF NOT EXISTS sales_link_sku_sales_object_relations (
      id TEXT PRIMARY KEY,
      linkSkuId TEXT NOT NULL,
      salesObjectId TEXT NOT NULL,
      effectiveFrom TEXT NOT NULL,
      effectiveTo TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      sourceType TEXT NOT NULL,
      sourceBatchId TEXT,
      sourceReferenceJson TEXT NOT NULL DEFAULT '{}',
      reviewedBy TEXT,
      reviewedAt TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY(linkSkuId) REFERENCES sales_link_skus(id),
      FOREIGN KEY(salesObjectId) REFERENCES sales_objects(id),
      FOREIGN KEY(reviewedBy) REFERENCES persons(id),
      CHECK(status IN ('active','inactive','superseded','conflict')),
      CHECK((status='active' AND effectiveTo IS NULL) OR status<>'active')
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_link_sku_sales_object_one_active
      ON sales_link_sku_sales_object_relations(linkSkuId) WHERE status='active';
    CREATE INDEX IF NOT EXISTS idx_sales_link_sku_sales_object_object
      ON sales_link_sku_sales_object_relations(salesObjectId,status);

    CREATE TABLE IF NOT EXISTS sales_object_structures (
      id TEXT PRIMARY KEY,
      salesObjectId TEXT NOT NULL,
      version INTEGER NOT NULL,
      structureHash TEXT NOT NULL,
      effectiveFrom TEXT NOT NULL,
      effectiveTo TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      sourceType TEXT NOT NULL,
      sourceBatchId TEXT,
      sourceReferenceJson TEXT NOT NULL DEFAULT '{}',
      validityBasis TEXT NOT NULL DEFAULT 'unknown',
      sourceState TEXT NOT NULL DEFAULT 'active',
      sourceUpdatedAt TEXT,
      lastVerifiedAt TEXT,
      syncedAt TEXT,
      supersedesStructureId TEXT,
      reviewedBy TEXT,
      reviewedAt TEXT,
      activatedAt TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY(salesObjectId) REFERENCES sales_objects(id),
      FOREIGN KEY(supersedesStructureId) REFERENCES sales_object_structures(id),
      FOREIGN KEY(reviewedBy) REFERENCES persons(id),
      UNIQUE(id,salesObjectId),
      UNIQUE(salesObjectId,version),
      UNIQUE(salesObjectId,structureHash),
      CHECK(version>0),
      CHECK(validityBasis IN ('exact','inferred','legacy_evidence','unknown')),
      CHECK(sourceState IN ('active','source_removed')),
      CHECK(status IN ('draft','pending_review','active','superseded','blocked')),
      CHECK((status='active' AND effectiveTo IS NULL AND reviewedBy IS NOT NULL AND reviewedAt IS NOT NULL AND activatedAt IS NOT NULL) OR status<>'active')
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_object_structures_one_active
      ON sales_object_structures(salesObjectId) WHERE status='active';
    CREATE INDEX IF NOT EXISTS idx_sales_object_structures_status
      ON sales_object_structures(status,updatedAt DESC);

    CREATE TABLE IF NOT EXISTS sales_object_structure_effective_periods (
      id TEXT PRIMARY KEY,
      structureId TEXT NOT NULL,
      salesObjectId TEXT NOT NULL,
      validFrom TEXT NOT NULL,
      validTo TEXT,
      sourceState TEXT NOT NULL DEFAULT 'active',
      validityBasis TEXT NOT NULL DEFAULT 'unknown',
      sourceUpdatedAt TEXT,
      firstVerifiedAt TEXT NOT NULL,
      lastVerifiedAt TEXT NOT NULL,
      syncedAt TEXT NOT NULL,
      sourceReferenceJson TEXT NOT NULL DEFAULT '{}',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY(structureId,salesObjectId) REFERENCES sales_object_structures(id,salesObjectId),
      FOREIGN KEY(salesObjectId) REFERENCES sales_objects(id),
      CHECK(validTo IS NULL OR validTo>=validFrom),
      CHECK(sourceState IN ('active','source_removed')),
      CHECK(validityBasis IN ('exact','inferred','legacy_evidence','unknown'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_object_structure_period_one_open
      ON sales_object_structure_effective_periods(salesObjectId) WHERE validTo IS NULL AND sourceState='active';
    CREATE INDEX IF NOT EXISTS idx_sales_object_structure_period_lookup
      ON sales_object_structure_effective_periods(salesObjectId,validFrom,validTo);

    CREATE TABLE IF NOT EXISTS sales_object_structure_components (
      id TEXT PRIMARY KEY,
      structureId TEXT NOT NULL,
      salesObjectId TEXT NOT NULL,
      erpSkuId TEXT NOT NULL,
      quantity REAL NOT NULL,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      sourceType TEXT NOT NULL,
      sourceReferenceJson TEXT NOT NULL DEFAULT '{}',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY(structureId,salesObjectId) REFERENCES sales_object_structures(id,salesObjectId),
      FOREIGN KEY(salesObjectId) REFERENCES sales_objects(id),
      FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id),
      UNIQUE(structureId,erpSkuId),
      CHECK(quantity>0),
      CHECK(status IN ('active','invalid'))
    );
    CREATE INDEX IF NOT EXISTS idx_sales_object_components_object
      ON sales_object_structure_components(salesObjectId,status);
    CREATE INDEX IF NOT EXISTS idx_sales_object_components_erp
      ON sales_object_structure_components(erpSkuId,status);

    CREATE TABLE IF NOT EXISTS v3_relation_shadow_runs (
      id TEXT PRIMARY KEY,
      triggerType TEXT NOT NULL,
      triggerObjectId TEXT,
      sourceBatchId TEXT,
      status TEXT NOT NULL,
      startedAt TEXT NOT NULL,
      completedAt TEXT,
      durationMs REAL,
      metricsJson TEXT NOT NULL DEFAULT '{}',
      protectedBeforeJson TEXT NOT NULL DEFAULT '{}',
      protectedAfterJson TEXT NOT NULL DEFAULT '{}',
      errorMessage TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      CHECK(status IN ('running','completed','failed'))
    );
    CREATE INDEX IF NOT EXISTS idx_v3_shadow_runs_time
      ON v3_relation_shadow_runs(startedAt DESC,status);

    CREATE TABLE IF NOT EXISTS v3_relation_shadow_differences (
      id TEXT PRIMARY KEY,
      objectType TEXT NOT NULL,
      objectId TEXT NOT NULL,
      normalizedCode TEXT,
      differenceType TEXT NOT NULL,
      currentResultJson TEXT NOT NULL DEFAULT '{}',
      v3ResultJson TEXT NOT NULL DEFAULT '{}',
      firstSeenAt TEXT NOT NULL,
      lastSeenAt TEXT NOT NULL,
      occurrenceCount INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      lastRunId TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY(lastRunId) REFERENCES v3_relation_shadow_runs(id) ON DELETE SET NULL,
      UNIQUE(objectType,objectId,differenceType),
      CHECK(occurrenceCount>0),
      CHECK(status IN ('active','resolved'))
    );
    CREATE INDEX IF NOT EXISTS idx_v3_shadow_differences_active
      ON v3_relation_shadow_differences(status,differenceType,lastSeenAt DESC);

    CREATE TRIGGER IF NOT EXISTS trg_sales_object_structure_activate_components
      BEFORE UPDATE OF status ON sales_object_structures
      WHEN NEW.status='active' AND NOT EXISTS (
        SELECT 1 FROM sales_object_structure_components c
        WHERE c.structureId=NEW.id AND c.salesObjectId=NEW.salesObjectId AND c.status='active'
      )
      BEGIN
        SELECT RAISE(ABORT,'sales object structure cannot be active without components');
      END;
    CREATE TRIGGER IF NOT EXISTS trg_sales_object_structure_insert_active
      BEFORE INSERT ON sales_object_structures
      WHEN NEW.status='active'
      BEGIN
        SELECT RAISE(ABORT,'sales object structure must be created before activation');
      END;
    CREATE TRIGGER IF NOT EXISTS trg_sales_object_structure_single_shape
      BEFORE UPDATE OF status ON sales_object_structures
      WHEN NEW.status='active'
        AND (SELECT objectType FROM sales_objects WHERE id=NEW.salesObjectId)='single'
        AND (SELECT COUNT(*) FROM sales_object_structure_components c WHERE c.structureId=NEW.id AND c.status='active')<>1
      BEGIN
        SELECT RAISE(ABORT,'single sales object requires exactly one component');
      END;
    CREATE TRIGGER IF NOT EXISTS trg_sales_object_structure_single_quantity
      BEFORE UPDATE OF status ON sales_object_structures
      WHEN NEW.status='active'
        AND (SELECT objectType FROM sales_objects WHERE id=NEW.salesObjectId)='single'
        AND EXISTS (SELECT 1 FROM sales_object_structure_components c WHERE c.structureId=NEW.id AND c.status='active' AND c.quantity<>1)
      BEGIN
        SELECT RAISE(ABORT,'single sales object component quantity must equal one');
      END;
    CREATE TRIGGER IF NOT EXISTS trg_sales_object_component_protect_active_structure_insert
      BEFORE INSERT ON sales_object_structure_components
      WHEN (SELECT status FROM sales_object_structures WHERE id=NEW.structureId)='active'
      BEGIN
        SELECT RAISE(ABORT,'active sales object structure components are immutable');
      END;
    CREATE TRIGGER IF NOT EXISTS trg_sales_object_component_protect_active_structure_update
      BEFORE UPDATE ON sales_object_structure_components
      WHEN (SELECT status FROM sales_object_structures WHERE id=OLD.structureId)='active'
        OR (SELECT status FROM sales_object_structures WHERE id=NEW.structureId)='active'
      BEGIN
        SELECT RAISE(ABORT,'active sales object structure components are immutable');
      END;
    CREATE TRIGGER IF NOT EXISTS trg_sales_object_component_protect_active_structure_delete
      BEFORE DELETE ON sales_object_structure_components
      WHEN (SELECT status FROM sales_object_structures WHERE id=OLD.structureId)='active'
      BEGIN
        SELECT RAISE(ABORT,'active sales object structure components are immutable');
      END;
  `);
  ensureColumn("sales_object_structures", "validityBasis", "TEXT NOT NULL DEFAULT 'unknown'");
  ensureColumn("sales_object_structures", "sourceState", "TEXT NOT NULL DEFAULT 'active'");
  ensureColumn("sales_object_structures", "sourceUpdatedAt", "TEXT");
  ensureColumn("sales_object_structures", "lastVerifiedAt", "TEXT");
  ensureColumn("sales_object_structures", "syncedAt", "TEXT");
}

export function migrateSalesDailyAnomalyGovernanceV1() {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS sales_daily_anomaly_governance_decisions (
      id TEXT PRIMARY KEY,
      sourceBatchId TEXT NOT NULL,
      sourceRowNumber INTEGER NOT NULL,
      anomalyType TEXT NOT NULL,
      action TEXT NOT NULL,
      status TEXT NOT NULL,
      salesLinkSkuId TEXT,
      erpSkuId TEXT,
      decisionNote TEXT NOT NULL,
      snapshotJson TEXT NOT NULL,
      routeJson TEXT NOT NULL,
      reviewedBy TEXT NOT NULL,
      reviewedAt TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY(sourceBatchId) REFERENCES connection_import_batches(id),
      FOREIGN KEY(salesLinkSkuId) REFERENCES sales_link_skus(id),
      FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id),
      FOREIGN KEY(reviewedBy) REFERENCES persons(id),
      UNIQUE(sourceBatchId,sourceRowNumber),
      CHECK(anomalyType IN ('identity_error','missing_relation','relation_conflict','incomplete_structure')),
      CHECK(action IN ('add','replace','ignore')),
      CHECK(status IN ('pending_formal_approval','reviewed_ignore'))
    );
    CREATE INDEX IF NOT EXISTS idx_sales_daily_anomaly_governance_queue
      ON sales_daily_anomaly_governance_decisions(sourceBatchId,anomalyType,status,updatedAt DESC);
  `);
}

export function migrateProductStructureApplicationApprovalsV1() {
  const database = getDatabase();
  const itemSql = String(database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='product_structure_application_items'").get()?.sql || "");
  const auditSql = String(database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='product_structure_application_audits'").get()?.sql || "");
  const needsRebuild = /REFERENCES\s+sales_link_sku_product_structures/i.test(itemSql)
    || /REFERENCES\s+sales_link_sku_product_structures/i.test(auditSql)
    || /\bproductStructureId\b/i.test(itemSql)
    || /\bproductStructureId\b/i.test(auditSql)
    || (itemSql && !/salesObjectStructureId/i.test(itemSql))
    || (auditSql && !/salesObjectStructureId/i.test(auditSql));

  if (needsRebuild) {
    database.pragma("foreign_keys = OFF");
    database.transaction(() => {
      database.exec(`
        DROP TABLE IF EXISTS product_structure_application_items_v2;
        DROP TABLE IF EXISTS product_structure_application_audits_v2;
        CREATE TABLE product_structure_application_items_v2 (
          id TEXT PRIMARY KEY,
          applicationBatchId TEXT NOT NULL,
          salesObjectStructureId TEXT,
          structureVersion INTEGER,
          salesLinkSkuId TEXT NOT NULL,
          classification TEXT NOT NULL,
          approvalStatus TEXT NOT NULL DEFAULT 'pending',
          relationshipShape TEXT,
          sourceTypesJson TEXT NOT NULL DEFAULT '[]',
          currentMappingsJson TEXT NOT NULL DEFAULT '[]',
          targetComponentsJson TEXT NOT NULL DEFAULT '[]',
          componentDiffJson TEXT NOT NULL DEFAULT '{}',
          impactSalesAmount REAL,
          impactProfitAmount REAL,
          reviewedBy TEXT,
          reviewedAt TEXT,
          reviewNote TEXT,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL,
          FOREIGN KEY(applicationBatchId) REFERENCES product_structure_application_batches(id),
          FOREIGN KEY(salesObjectStructureId) REFERENCES sales_object_structures(id),
          FOREIGN KEY(salesLinkSkuId) REFERENCES sales_link_skus(id),
          FOREIGN KEY(reviewedBy) REFERENCES persons(id),
          UNIQUE(applicationBatchId,salesLinkSkuId),
          CHECK(classification IN ('already_consistent','ready_to_apply','structure_upgrade','conflict','incomplete')),
          CHECK(approvalStatus IN ('pending','approved','rejected','blocked','not_required')),
          CHECK(approvalStatus <> 'approved' OR classification IN ('ready_to_apply','structure_upgrade')),
          CHECK(approvalStatus NOT IN ('approved','rejected') OR (reviewedBy IS NOT NULL AND reviewedAt IS NOT NULL))
        );
        INSERT INTO product_structure_application_items_v2
          (id,applicationBatchId,salesObjectStructureId,structureVersion,salesLinkSkuId,classification,approvalStatus,relationshipShape,sourceTypesJson,currentMappingsJson,targetComponentsJson,componentDiffJson,impactSalesAmount,impactProfitAmount,reviewedBy,reviewedAt,reviewNote,createdAt,updatedAt)
        SELECT id,applicationBatchId,salesObjectStructureId,structureVersion,salesLinkSkuId,classification,approvalStatus,relationshipShape,sourceTypesJson,currentMappingsJson,targetComponentsJson,componentDiffJson,impactSalesAmount,impactProfitAmount,reviewedBy,reviewedAt,reviewNote,createdAt,updatedAt
        FROM product_structure_application_items;
        CREATE TABLE product_structure_application_audits_v2 (
          id TEXT PRIMARY KEY,
          applicationItemId TEXT NOT NULL,
          salesObjectStructureId TEXT,
          structureVersion INTEGER,
          executionMode TEXT NOT NULL,
          outcome TEXT NOT NULL,
          oldMappingsSnapshotJson TEXT NOT NULL,
          generatedMappingsJson TEXT NOT NULL,
          errorMessage TEXT,
          appliedBy TEXT,
          appliedAt TEXT NOT NULL,
          createdAt TEXT NOT NULL,
          FOREIGN KEY(applicationItemId) REFERENCES product_structure_application_items_v2(id),
          FOREIGN KEY(salesObjectStructureId) REFERENCES sales_object_structures(id),
          FOREIGN KEY(appliedBy) REFERENCES persons(id),
          CHECK(executionMode IN ('isolated_simulation','production')),
          CHECK(outcome IN ('applied','idempotent','failed','rolled_back'))
        );
        INSERT INTO product_structure_application_audits_v2
          (id,applicationItemId,salesObjectStructureId,structureVersion,executionMode,outcome,oldMappingsSnapshotJson,generatedMappingsJson,errorMessage,appliedBy,appliedAt,createdAt)
        SELECT id,applicationItemId,salesObjectStructureId,structureVersion,executionMode,outcome,oldMappingsSnapshotJson,generatedMappingsJson,errorMessage,appliedBy,appliedAt,createdAt
        FROM product_structure_application_audits;
        DROP TABLE product_structure_application_audits;
        DROP TABLE product_structure_application_items;
        ALTER TABLE product_structure_application_items_v2 RENAME TO product_structure_application_items;
        ALTER TABLE product_structure_application_audits_v2 RENAME TO product_structure_application_audits;
      `);
    })();
    database.pragma("foreign_keys = ON");
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS product_structure_application_batches (
      id TEXT PRIMARY KEY,
      batchCode TEXT NOT NULL UNIQUE,
      sourceType TEXT NOT NULL,
      sourceFileHashesJson TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'preview',
      createdBy TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY(createdBy) REFERENCES persons(id),
      CHECK(status IN ('preview','pending_review','partially_reviewed','reviewed','closed'))
    );
    CREATE TABLE IF NOT EXISTS product_structure_application_items (
      id TEXT PRIMARY KEY,
      applicationBatchId TEXT NOT NULL,
      salesObjectStructureId TEXT,
      structureVersion INTEGER,
      salesLinkSkuId TEXT NOT NULL,
      classification TEXT NOT NULL,
      approvalStatus TEXT NOT NULL DEFAULT 'pending',
      relationshipShape TEXT,
      sourceTypesJson TEXT NOT NULL DEFAULT '[]',
      currentMappingsJson TEXT NOT NULL DEFAULT '[]',
      targetComponentsJson TEXT NOT NULL DEFAULT '[]',
      componentDiffJson TEXT NOT NULL DEFAULT '{}',
      impactSalesAmount REAL,
      impactProfitAmount REAL,
      reviewedBy TEXT,
      reviewedAt TEXT,
      reviewNote TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY(applicationBatchId) REFERENCES product_structure_application_batches(id),
      FOREIGN KEY(salesObjectStructureId) REFERENCES sales_object_structures(id),
      FOREIGN KEY(salesLinkSkuId) REFERENCES sales_link_skus(id),
      FOREIGN KEY(reviewedBy) REFERENCES persons(id),
      UNIQUE(applicationBatchId,salesLinkSkuId),
      CHECK(classification IN ('already_consistent','ready_to_apply','structure_upgrade','conflict','incomplete')),
      CHECK(approvalStatus IN ('pending','approved','rejected','blocked','not_required')),
      CHECK(approvalStatus <> 'approved' OR classification IN ('ready_to_apply','structure_upgrade')),
      CHECK(approvalStatus NOT IN ('approved','rejected') OR (reviewedBy IS NOT NULL AND reviewedAt IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS idx_product_structure_application_items_queue
      ON product_structure_application_items(applicationBatchId,approvalStatus,classification,impactSalesAmount DESC);
    CREATE INDEX IF NOT EXISTS idx_product_structure_application_items_sku
      ON product_structure_application_items(salesLinkSkuId,createdAt DESC);
    CREATE TABLE IF NOT EXISTS product_structure_application_audits (
      id TEXT PRIMARY KEY,
      applicationItemId TEXT NOT NULL,
      salesObjectStructureId TEXT,
      structureVersion INTEGER,
      executionMode TEXT NOT NULL,
      outcome TEXT NOT NULL,
      oldMappingsSnapshotJson TEXT NOT NULL,
      generatedMappingsJson TEXT NOT NULL,
      errorMessage TEXT,
      appliedBy TEXT,
      appliedAt TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY(applicationItemId) REFERENCES product_structure_application_items(id),
      FOREIGN KEY(salesObjectStructureId) REFERENCES sales_object_structures(id),
      FOREIGN KEY(appliedBy) REFERENCES persons(id),
      CHECK(executionMode IN ('isolated_simulation','production')),
      CHECK(outcome IN ('applied','idempotent','failed','rolled_back'))
    );
    CREATE INDEX IF NOT EXISTS idx_product_structure_application_audits_item
      ON product_structure_application_audits(applicationItemId,appliedAt DESC);
  `);

  database.exec(`
    UPDATE product_structure_application_items
    SET salesObjectStructureId=(
      SELECT s.id FROM sales_link_sku_sales_object_relations r
      JOIN sales_object_structures s ON s.salesObjectId=r.salesObjectId AND s.status='active'
      WHERE r.linkSkuId=product_structure_application_items.salesLinkSkuId AND r.status='active'
      ORDER BY s.version DESC,s.id DESC LIMIT 1
    ),
    structureVersion=(
      SELECT s.version FROM sales_link_sku_sales_object_relations r
      JOIN sales_object_structures s ON s.salesObjectId=r.salesObjectId AND s.status='active'
      WHERE r.linkSkuId=product_structure_application_items.salesLinkSkuId AND r.status='active'
      ORDER BY s.version DESC,s.id DESC LIMIT 1
    )
    WHERE salesObjectStructureId IS NULL;
    UPDATE product_structure_application_audits
    SET salesObjectStructureId=(SELECT i.salesObjectStructureId FROM product_structure_application_items i WHERE i.id=product_structure_application_audits.applicationItemId),
        structureVersion=(SELECT i.structureVersion FROM product_structure_application_items i WHERE i.id=product_structure_application_audits.applicationItemId)
    WHERE salesObjectStructureId IS NULL;
  `);
}

export function migrateErpSkuBusinessUsagesV1() {
  const database = getDatabase();
  database.exec(`
    CREATE TABLE IF NOT EXISTS erp_sku_business_usages (
      id TEXT PRIMARY KEY,
      erpSkuId TEXT NOT NULL,
      usageType TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed',
      sourceType TEXT NOT NULL,
      reviewedBy TEXT,
      reviewedAt TEXT,
      decisionNote TEXT,
      supersedesUsageId TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id),
      FOREIGN KEY(reviewedBy) REFERENCES persons(id),
      FOREIGN KEY(supersedesUsageId) REFERENCES erp_sku_business_usages(id),
      CHECK(usageType IN ('product','accounting_auxiliary','shipping_adjustment','other_adjustment')),
      CHECK(status IN ('proposed','active','inactive','superseded','conflict')),
      CHECK(sourceType IN ('manual_confirmation','system_suggestion','system_migration','erp_import')),
      CHECK(status <> 'active' OR (reviewedBy IS NOT NULL AND reviewedAt IS NOT NULL))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_sku_business_usages_one_active
      ON erp_sku_business_usages(erpSkuId) WHERE status='active';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_sku_business_usages_open_suggestion
      ON erp_sku_business_usages(erpSkuId,usageType,sourceType) WHERE status='proposed';
    CREATE INDEX IF NOT EXISTS idx_erp_sku_business_usages_status_updated
      ON erp_sku_business_usages(status,updatedAt DESC);
    CREATE TRIGGER IF NOT EXISTS trg_erp_sku_usage_supersedes_insert
      BEFORE INSERT ON erp_sku_business_usages
      WHEN NEW.supersedesUsageId IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM erp_sku_business_usages previous
          WHERE previous.id=NEW.supersedesUsageId AND previous.erpSkuId=NEW.erpSkuId
        )
      BEGIN
        SELECT RAISE(ABORT,'superseded ERP SKU usage must belong to the same ERP SKU');
      END;
    CREATE TRIGGER IF NOT EXISTS trg_erp_sku_usage_supersedes_update
      BEFORE UPDATE OF supersedesUsageId,erpSkuId ON erp_sku_business_usages
      WHEN NEW.supersedesUsageId IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM erp_sku_business_usages previous
          WHERE previous.id=NEW.supersedesUsageId AND previous.erpSkuId=NEW.erpSkuId
        )
      BEGIN
        SELECT RAISE(ABORT,'superseded ERP SKU usage must belong to the same ERP SKU');
      END;
  `);
}

function backfillConnectionProfileOrigins() {
  const database = getDatabase();
  database.exec(`
    UPDATE connection_profiles
    SET originSource=CASE
          WHEN EXISTS (
            SELECT 1 FROM connection_data_mappings mapping
            WHERE mapping.connectionId=connection_profiles.id
              AND mapping.sourceType='business_advisor'
              AND mapping.deletedAt IS NULL
          ) THEN 'legacy_business_advisor_supported'
          ELSE 'legacy_bulk_initialized'
        END,
        identifiedAt=COALESCE(NULLIF(identifiedAt,''),createdAt),
        originImportBatchId=COALESCE(originImportBatchId,(
          SELECT snapshot.importBatchId
          FROM connection_period_snapshots snapshot
          JOIN connection_data_mappings mapping ON mapping.id=snapshot.mappingId
          WHERE mapping.connectionId=connection_profiles.id
            AND mapping.sourceType='business_advisor'
          ORDER BY snapshot.createdAt,snapshot.id LIMIT 1
        ))
    WHERE originSource IS NULL OR originSource='' OR originSource='legacy_unknown'
  `);
}

function migrateLegacyConnectionBenchmarks() {
  const database = getDatabase();
  const legacyTable = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='connection_benchmarks'").get();
  if (!legacyTable) return;
  database.exec(`
    INSERT OR IGNORE INTO connection_benchmark_targets (
      id,connectionId,targetType,internalConnectionId,targetUrl,platform,title,mainImage,notes,createdBy,createdAt,updatedAt
    )
    SELECT b.id,b.connectionId,'internal',b.benchmarkConnectionId,l.canonicalUrl,s.platform,
           COALESCE(c.name,l.title,'历史系统内对标链接'),c.mainImage,
           '由旧版系统内竞品关系兼容迁移',b.createdBy,b.createdAt,b.updatedAt
    FROM connection_benchmarks b
    JOIN connection_profiles c ON c.id=b.benchmarkConnectionId
    JOIN sales_links l ON l.id=c.salesLinkId
    JOIN sales_shops s ON s.id=l.shopId
  `);
}

function backfillBusinessIdentifiers() {
  const database = getDatabase();
  const backfill = database.transaction(() => {
    for (const config of Object.values(businessIdentifierConfigs)) {
      const rows = database
        .prepare(
          `SELECT id, businessCode, createdAt
           FROM ${config.table}
           ORDER BY COALESCE(createdAt, '') ASC, id ASC`,
        )
        .all();
      const usedSerialsByMonth = new Map();

      for (const row of rows) {
        const existingCode = String(row.businessCode ?? "").trim();
        const existingMatch = existingCode.match(
          new RegExp(`^${config.prefix}-(\\d{6})-(\\d+)$`),
        );
        if (existingMatch !== null) {
          const month = existingMatch[1];
          const serial = Number(existingMatch[2]);
          if (!usedSerialsByMonth.has(month)) usedSerialsByMonth.set(month, new Set());
          usedSerialsByMonth.get(month).add(serial);
        }
      }

      for (const row of rows) {
        if (String(row.businessCode ?? "").trim() !== "") continue;
        const month = getBusinessIdentifierMonth(row.createdAt);
        if (!usedSerialsByMonth.has(month)) usedSerialsByMonth.set(month, new Set());
        const usedSerials = usedSerialsByMonth.get(month);
        let serial = 1;
        while (usedSerials.has(serial)) serial += 1;
        const businessCode = `${config.prefix}-${month}-${String(serial).padStart(4, "0")}`;
        database
          .prepare(`UPDATE ${config.table} SET businessCode = @businessCode WHERE id = @id`)
          .run({ id: row.id, businessCode });
        usedSerials.add(serial);
      }
    }
  });
  backfill();

  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_goals_business_code ON goals(businessCode);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_task_templates_business_code ON task_templates(businessCode);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_process_instances_business_code ON process_instances(businessCode);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_business_code ON tasks(businessCode);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_process_templates_business_code ON process_templates(businessCode);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_business_code ON templates(businessCode);
  `);
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

const retiredCustomerAndSupplyChainTables = [
  "customer_tag_relations",
  "customer_followups",
  "customer_consumptions",
  "customer_tags",
  "customers",
  "supplier_quality_issues",
  "purchase_order_items",
  "supplier_evaluations",
  "supplier_products",
  "purchase_orders",
  "suppliers",
];

function withoutRetiredModulePermissions(value) {
  if (typeof value !== "string" || value.trim() === "") return value;
  let permissions;
  try { permissions = JSON.parse(value); }
  catch { return value; }
  if (permissions === null || typeof permissions !== "object" || Array.isArray(permissions)) return value;
  let changed = false;
  for (const key of ["supplyChain", "customers", "aiAssistant"]) {
    if (Object.hasOwn(permissions, key)) {
      delete permissions[key];
      changed = true;
    }
    if (permissions.modules !== null && typeof permissions.modules === "object" && Object.hasOwn(permissions.modules, key)) {
      delete permissions.modules[key];
      changed = true;
    }
  }
  return changed ? JSON.stringify(permissions) : value;
}

function retireCustomerAndSupplyChainV1() {
  const database = getDatabase();
  database.transaction(() => {
    for (const table of retiredCustomerAndSupplyChainTables) database.exec(`DROP TABLE IF EXISTS ${table}`);
  })();
}

function retireAiOperationAssistantV1() {
  const database = getDatabase();
  database.transaction(() => {
    if (tableExists("ai_analysis_records")) {
      const historicalRecordCount = Number(database.prepare("SELECT COUNT(*) count FROM ai_analysis_records").get().count);
      if (historicalRecordCount === 0) database.exec("DROP TABLE ai_analysis_records");
    }
  })();
}

function retireStoredModulePermissionsV1() {
  const database = getDatabase();
  database.transaction(() => {
    for (const table of ["permission_templates", "persons"]) {
      if (!tableExists(table)) continue;
      const availableColumns = new Set(database.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
      const columns = (table === "persons" ? ["permissions", "permissionOverrides"] : ["permissions"])
        .filter((column) => availableColumns.has(column));
      if (!availableColumns.has("id") || columns.length === 0) continue;
      const rows = database.prepare(`SELECT id,${columns.join(",")} FROM ${table}`).all();
      for (const row of rows) {
        const updates = Object.fromEntries(columns.map((column) => [column, withoutRetiredModulePermissions(row[column])]));
        if (columns.every((column) => updates[column] === row[column])) continue;
        database.prepare(`UPDATE ${table} SET ${columns.map((column) => `${column}=@${column}`).join(",")} WHERE id=@id`)
          .run({ id: row.id, ...updates });
      }
    }
  })();
}

export function retireLinkCenterLegacyRelationsPhase2() {
  const database = getDatabase();
  const columnsFor = (table) => tableExists(table)
    ? new Set(database.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name))
    : new Set();
  const rowCount = (table, where = "1=1") => tableExists(table)
    ? Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get()?.count || 0)
    : 0;

  const skuColumns = columnsFor("sales_link_skus");
  const mappingColumns = columnsFor("sales_link_sku_erp_mappings");
  const needsSkuRebuild = skuColumns.has("productId") || skuColumns.has("erpSkuId");
  const needsMappingRebuild = mappingColumns.has("comboGroupId");
  const legacyTables = [
    "sales_link_sku_combo_group_components",
    "sales_link_sku_combo_groups",
    "platform_sku_manual_bindings",
  ].filter(tableExists);

  if (!needsSkuRebuild && !needsMappingRebuild && legacyTables.length === 0) {
    return { changed: false, rebuiltTables: 0, retiredTables: 0 };
  }

  const unsafeLegacyData = {
    comboGroupMappings: mappingColumns.has("comboGroupId")
      ? rowCount("sales_link_sku_erp_mappings", "comboGroupId IS NOT NULL")
      : 0,
    comboGroups: rowCount("sales_link_sku_combo_groups"),
    comboComponents: rowCount("sales_link_sku_combo_group_components"),
    manualBindings: rowCount("platform_sku_manual_bindings"),
  };
  const populatedLegacyObjects = Object.entries(unsafeLegacyData).filter(([, count]) => count > 0);
  if (populatedLegacyObjects.length > 0) {
    throw new Error(`链接中心Phase 2退役中止：旧结构仍有数据 ${JSON.stringify(Object.fromEntries(populatedLegacyObjects))}`);
  }

  const foreignKeysEnabled = Number(database.pragma("foreign_keys", { simple: true })) === 1;
  if (foreignKeysEnabled) database.pragma("foreign_keys = OFF");
  try {
    database.transaction(() => {
      if (needsSkuRebuild) {
        database.exec(`
          DROP TABLE IF EXISTS sales_link_skus_phase2_clean;
          CREATE TABLE sales_link_skus_phase2_clean (
            id TEXT PRIMARY KEY,
            salesLinkId TEXT NOT NULL,
            platformSkuId TEXT,
            platformSkuCode TEXT,
            normalizedPlatformSkuCode TEXT,
            specificationName TEXT,
            normalizedSpecificationName TEXT,
            price REAL,
            platformStock REAL,
            occupiedStock REAL,
            systemGoodsType TEXT,
            syncEnabled INTEGER NOT NULL DEFAULT 0,
            lastSyncedStock REAL,
            lastSyncedAt TEXT,
            stopSyncReason TEXT,
            matchStatus TEXT NOT NULL,
            matchMethod TEXT,
            matchReason TEXT,
            currentState TEXT NOT NULL DEFAULT 'active',
            missingAt TEXT,
            createdAt TEXT,
            updatedAt TEXT,
            FOREIGN KEY(salesLinkId) REFERENCES sales_links(id)
          );
          INSERT INTO sales_link_skus_phase2_clean (
            id,salesLinkId,platformSkuId,platformSkuCode,normalizedPlatformSkuCode,
            specificationName,normalizedSpecificationName,price,platformStock,occupiedStock,
            systemGoodsType,syncEnabled,lastSyncedStock,lastSyncedAt,stopSyncReason,
            matchStatus,matchMethod,matchReason,currentState,missingAt,createdAt,updatedAt
          ) SELECT
            id,salesLinkId,platformSkuId,platformSkuCode,normalizedPlatformSkuCode,
            specificationName,normalizedSpecificationName,price,platformStock,occupiedStock,
            systemGoodsType,syncEnabled,lastSyncedStock,lastSyncedAt,stopSyncReason,
            matchStatus,matchMethod,matchReason,currentState,missingAt,createdAt,updatedAt
          FROM sales_link_skus;
          DROP TABLE sales_link_skus;
          ALTER TABLE sales_link_skus_phase2_clean RENAME TO sales_link_skus;
          CREATE UNIQUE INDEX idx_sales_link_skus_platform_id
            ON sales_link_skus(salesLinkId,platformSkuId)
            WHERE platformSkuId IS NOT NULL AND platformSkuId<>'';
          CREATE UNIQUE INDEX idx_sales_link_skus_fallback
            ON sales_link_skus(salesLinkId,normalizedPlatformSkuCode,normalizedSpecificationName)
            WHERE platformSkuId IS NULL OR platformSkuId='';
          CREATE INDEX idx_sales_link_skus_current_state
            ON sales_link_skus(currentState);
          CREATE INDEX idx_sales_link_skus_link_state
            ON sales_link_skus(salesLinkId,currentState);
        `);
      }

      if (needsMappingRebuild) {
        database.exec(`
          DROP TABLE IF EXISTS sales_link_sku_erp_mappings_phase2_clean;
          CREATE TABLE sales_link_sku_erp_mappings_phase2_clean (
            id TEXT PRIMARY KEY,
            salesLinkSkuId TEXT NOT NULL,
            erpSkuId TEXT NOT NULL,
            mappingType TEXT NOT NULL DEFAULT 'single',
            quantity REAL NOT NULL DEFAULT 1,
            currentState TEXT NOT NULL DEFAULT 'active',
            sourceType TEXT NOT NULL DEFAULT 'legacy_migration',
            sourceBatchId TEXT,
            createdAt TEXT NOT NULL,
            updatedAt TEXT NOT NULL,
            invalidatedAt TEXT,
            productStructureId TEXT REFERENCES sales_link_sku_product_structures(id),
            FOREIGN KEY(salesLinkSkuId) REFERENCES sales_link_skus(id),
            FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id),
            UNIQUE(salesLinkSkuId,erpSkuId),
            CHECK(mappingType IN ('single','combo')),
            CHECK(quantity > 0),
            CHECK(currentState IN ('active','inactive'))
          );
          INSERT INTO sales_link_sku_erp_mappings_phase2_clean (
            id,salesLinkSkuId,erpSkuId,mappingType,quantity,currentState,sourceType,
            sourceBatchId,createdAt,updatedAt,invalidatedAt,productStructureId
          ) SELECT
            id,salesLinkSkuId,erpSkuId,mappingType,quantity,currentState,sourceType,
            sourceBatchId,createdAt,updatedAt,invalidatedAt,productStructureId
          FROM sales_link_sku_erp_mappings;
          DROP TABLE sales_link_sku_erp_mappings;
          ALTER TABLE sales_link_sku_erp_mappings_phase2_clean RENAME TO sales_link_sku_erp_mappings;
          CREATE INDEX idx_sales_link_sku_erp_mapping_link_state
            ON sales_link_sku_erp_mappings(salesLinkSkuId,currentState);
          CREATE INDEX idx_sales_link_sku_erp_mapping_erp_state
            ON sales_link_sku_erp_mappings(erpSkuId,currentState);
          CREATE INDEX idx_sales_link_sku_erp_mapping_batch
            ON sales_link_sku_erp_mappings(sourceBatchId);
          CREATE INDEX idx_sales_link_sku_erp_mapping_product_structure
            ON sales_link_sku_erp_mappings(productStructureId) WHERE productStructureId IS NOT NULL;
        `);
      }

      database.exec(`
        DROP TABLE IF EXISTS platform_sku_manual_bindings;
        DROP TABLE IF EXISTS sales_link_sku_combo_group_components;
        DROP TABLE IF EXISTS sales_link_sku_combo_groups;
      `);
      const foreignKeyViolations = database.pragma("foreign_key_check");
      if (foreignKeyViolations.length > 0) {
        throw new Error(`链接中心Phase 2退役后外键检查失败：${JSON.stringify(foreignKeyViolations.slice(0, 10))}`);
      }
    })();
  } finally {
    if (foreignKeysEnabled) database.pragma("foreign_keys = ON");
  }

  console.log("[db:migrate] retired Link Center Phase 2 legacy relation fields and empty models");
  return {
    changed: true,
    rebuiltTables: Number(needsSkuRebuild) + Number(needsMappingRebuild),
    retiredTables: legacyTables.length,
  };
}

function canonicalizeRetiredRawUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:spm|scm|utm_|share|source|track)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return raw;
  }
}

export function retireLinkCenterLegacyStructuresPhase3() {
  const database = getDatabase();
  const objectExists = (name, type = null) => Boolean(database.prepare(`SELECT 1 FROM sqlite_master
    WHERE name=? ${type ? "AND type=?" : ""}`).get(...(type ? [name, type] : [name])));
  const columnsFor = (table) => objectExists(table, "table")
    ? new Set(database.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name))
    : new Set();
  const count = (table) => objectExists(table, "table")
    ? Number(database.prepare(`SELECT COUNT(*) count FROM ${table}`).get()?.count || 0)
    : 0;
  // Phase 3 originally required this retired runtime table to be empty. One historic
  // health snapshot can exist in older databases, so preserve it as a read-only
  // Legacy archive before applying the original empty-table retirement gate.
  if (objectExists("connection_health_records", "table") && count("connection_health_records") > 0) {
    if (objectExists("legacy_connection_health_records", "table")) {
      throw new Error("链接中心Phase 3退役中止：健康记录运行表与Legacy归档表同时存在。");
    }
    database.exec("ALTER TABLE connection_health_records RENAME TO legacy_connection_health_records");
    createLegacyArchiveReadOnlyTriggers(database, "legacy_connection_health_records");
  } else if (objectExists("legacy_connection_health_records", "table")) {
    createLegacyArchiveReadOnlyTriggers(database, "legacy_connection_health_records");
  }
  const linkColumns = columnsFor("sales_links");
  const skuColumns = columnsFor("sales_link_skus");
  const needsLinks = linkColumns.has("lastSeenBatchId") || linkColumns.has("rawUrl");
  const needsSkus = skuColumns.has("lastSeenBatchId");
  const emptyOnlyTables = ["connection_sku_inventory_facts", "platform_link_shop_mappings",
    "platform_link_shop_mapping_import_batches", "platform_link_shop_mapping_import_rows",
    "connection_health_records", "connection_improvements"];
  const populated = Object.fromEntries(emptyOnlyTables.filter((table) => objectExists(table, "table") && count(table) > 0)
    .map((table) => [table, count(table)]));
  if (Object.keys(populated).length) throw new Error(`链接中心Phase 3退役中止：应为空的旧结构仍有数据 ${JSON.stringify(populated)}`);

  if (linkColumns.has("rawUrl")) {
    const update = database.prepare("UPDATE sales_links SET canonicalUrl=? WHERE id=?");
    for (const row of database.prepare(`SELECT id,rawUrl FROM sales_links
      WHERE (canonicalUrl IS NULL OR trim(canonicalUrl)='') AND rawUrl IS NOT NULL AND trim(rawUrl)<>''`).all()) {
      update.run(canonicalizeRetiredRawUrl(row.rawUrl), row.id);
    }
  }

  const foreignKeysEnabled = Number(database.pragma("foreign_keys", { simple: true })) === 1;
  if (foreignKeysEnabled) database.pragma("foreign_keys = OFF");
  try {
    database.transaction(() => {
      database.exec(`
        DROP VIEW IF EXISTS connection_profiles;
        DROP TRIGGER IF EXISTS legacy_connection_profiles_read_only_insert;
        DROP TRIGGER IF EXISTS legacy_connection_profiles_read_only_update;
        DROP TRIGGER IF EXISTS legacy_connection_profiles_read_only_delete;
      `);
      for (const index of database.prepare(`SELECT name FROM sqlite_master
        WHERE type='index' AND tbl_name='legacy_connection_profiles' AND name NOT LIKE 'sqlite_autoindex_%'`).all()) {
        database.exec(`DROP INDEX IF EXISTS "${String(index.name).replaceAll('"', '""')}"`);
      }
      if (objectExists("connection_diagnosis_entries", "table")) {
        if (objectExists("legacy_connection_diagnosis_entries", "table")) throw new Error("旧诊断归档表已存在，无法安全合并。");
        database.exec("ALTER TABLE connection_diagnosis_entries RENAME TO legacy_connection_diagnosis_entries");
      }
      for (const table of emptyOnlyTables) database.exec(`DROP TABLE IF EXISTS ${table}`);

      if (needsLinks) database.exec(`
        DROP TABLE IF EXISTS sales_links_phase3_clean;
        CREATE TABLE sales_links_phase3_clean (
          id TEXT PRIMARY KEY,shopId TEXT NOT NULL,platformGoodsId TEXT,platformGoodsCode TEXT,title TEXT,canonicalUrl TEXT,
          status TEXT,activityStatus TEXT,category TEXT,displayName TEXT,ownerId TEXT,managementStatus TEXT NOT NULL DEFAULT 'active',
          managementNotes TEXT,mainImage TEXT,imageSource TEXT,managementLevel TEXT NOT NULL DEFAULT 'new',
          managementOriginSource TEXT NOT NULL DEFAULT 'asset_native',managementOriginImportBatchId TEXT,managementIdentifiedAt TEXT,
          managementCreatedBy TEXT,identityStrength TEXT NOT NULL,originSource TEXT NOT NULL DEFAULT 'legacy_unknown',
          enrichmentStatus TEXT NOT NULL DEFAULT 'complete',lastModifiedAt TEXT,currentState TEXT NOT NULL DEFAULT 'active',
          missingAt TEXT,lastImportedAt TEXT,createdAt TEXT,updatedAt TEXT,
          FOREIGN KEY(shopId) REFERENCES sales_shops(id),FOREIGN KEY(ownerId) REFERENCES persons(id),
          FOREIGN KEY(managementOriginImportBatchId) REFERENCES connection_import_batches(id),
          FOREIGN KEY(managementCreatedBy) REFERENCES persons(id)
        );
        INSERT INTO sales_links_phase3_clean (
          id,shopId,platformGoodsId,platformGoodsCode,title,canonicalUrl,status,activityStatus,category,displayName,ownerId,
          managementStatus,managementNotes,mainImage,imageSource,managementLevel,managementOriginSource,
          managementOriginImportBatchId,managementIdentifiedAt,managementCreatedBy,identityStrength,originSource,enrichmentStatus,
          lastModifiedAt,currentState,missingAt,lastImportedAt,createdAt,updatedAt
        ) SELECT id,shopId,platformGoodsId,platformGoodsCode,title,canonicalUrl,status,activityStatus,category,displayName,ownerId,
          managementStatus,managementNotes,mainImage,imageSource,managementLevel,managementOriginSource,
          managementOriginImportBatchId,managementIdentifiedAt,managementCreatedBy,identityStrength,originSource,enrichmentStatus,
          lastModifiedAt,currentState,missingAt,lastImportedAt,createdAt,updatedAt FROM sales_links;
        DROP TABLE sales_links;
        ALTER TABLE sales_links_phase3_clean RENAME TO sales_links;
        CREATE UNIQUE INDEX idx_sales_links_goods_identity ON sales_links(shopId,platformGoodsId)
          WHERE platformGoodsId IS NOT NULL AND platformGoodsId<>'';
        CREATE UNIQUE INDEX idx_sales_links_url_identity ON sales_links(shopId,canonicalUrl)
          WHERE (platformGoodsId IS NULL OR platformGoodsId='') AND canonicalUrl IS NOT NULL AND canonicalUrl<>'';
        CREATE INDEX idx_sales_links_current_state ON sales_links(currentState);
        CREATE INDEX idx_sales_links_owner_management_status ON sales_links(ownerId,managementStatus);
      `);
      if (needsSkus) database.exec(`
        DROP TABLE IF EXISTS sales_link_skus_phase3_clean;
        CREATE TABLE sales_link_skus_phase3_clean (
          id TEXT PRIMARY KEY,salesLinkId TEXT NOT NULL,platformSkuId TEXT,platformSkuCode TEXT,normalizedPlatformSkuCode TEXT,
          specificationName TEXT,normalizedSpecificationName TEXT,price REAL,platformStock REAL,occupiedStock REAL,
          systemGoodsType TEXT,syncEnabled INTEGER NOT NULL DEFAULT 0,lastSyncedStock REAL,lastSyncedAt TEXT,stopSyncReason TEXT,
          matchStatus TEXT NOT NULL,matchMethod TEXT,matchReason TEXT,currentState TEXT NOT NULL DEFAULT 'active',missingAt TEXT,
          createdAt TEXT,updatedAt TEXT,FOREIGN KEY(salesLinkId) REFERENCES sales_links(id)
        );
        INSERT INTO sales_link_skus_phase3_clean SELECT id,salesLinkId,platformSkuId,platformSkuCode,normalizedPlatformSkuCode,
          specificationName,normalizedSpecificationName,price,platformStock,occupiedStock,systemGoodsType,syncEnabled,
          lastSyncedStock,lastSyncedAt,stopSyncReason,matchStatus,matchMethod,matchReason,currentState,missingAt,createdAt,updatedAt
          FROM sales_link_skus;
        DROP TABLE sales_link_skus;
        ALTER TABLE sales_link_skus_phase3_clean RENAME TO sales_link_skus;
        CREATE UNIQUE INDEX idx_sales_link_skus_platform_id ON sales_link_skus(salesLinkId,platformSkuId)
          WHERE platformSkuId IS NOT NULL AND platformSkuId<>'';
        CREATE UNIQUE INDEX idx_sales_link_skus_fallback ON sales_link_skus(salesLinkId,normalizedPlatformSkuCode,normalizedSpecificationName)
          WHERE platformSkuId IS NULL OR platformSkuId='';
        CREATE INDEX idx_sales_link_skus_current_state ON sales_link_skus(currentState);
        CREATE INDEX idx_sales_link_skus_link_state ON sales_link_skus(salesLinkId,currentState);
      `);
    })();
  } finally {
    if (foreignKeysEnabled) database.pragma("foreign_keys = ON");
  }
  const violations = database.pragma("foreign_key_check");
  if (violations.length) throw new Error(`链接中心Phase 3退役后外键检查失败：${JSON.stringify(violations.slice(0, 10))}`);
  console.log("[db:migrate] retired Link Center Phase 3 legacy fields and runtime models");
  return { changed: needsLinks || needsSkus, rebuiltTables: Number(needsLinks) + Number(needsSkus), retiredTables: emptyOnlyTables.length,
    archivedTables: Number(objectExists("legacy_connection_diagnosis_entries", "table"))
      + Number(objectExists("legacy_connection_health_records", "table")) };
}

function createLegacyArchiveReadOnlyTriggers(database, tableName) {
  const safeTable = String(tableName).replace(/[^a-zA-Z0-9_]/g, "");
  if (!safeTable) throw new Error("Legacy归档表名无效");
  database.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_${safeTable}_archive_insert
      BEFORE INSERT ON ${safeTable} BEGIN SELECT RAISE(ABORT,'legacy archive is read only'); END;
    CREATE TRIGGER IF NOT EXISTS trg_${safeTable}_archive_update
      BEFORE UPDATE ON ${safeTable} BEGIN SELECT RAISE(ABORT,'legacy archive is read only'); END;
    CREATE TRIGGER IF NOT EXISTS trg_${safeTable}_archive_delete
      BEFORE DELETE ON ${safeTable} BEGIN SELECT RAISE(ABORT,'legacy archive is read only'); END;
  `);
}

export function archiveLinkCenterLegacyStructuresPhase4() {
  const database = getDatabase();
  const objectExists = (name, type = null) => Boolean(database.prepare(`SELECT 1 FROM sqlite_master
    WHERE name=? ${type ? "AND type=?" : ""}`).get(...(type ? [name, type] : [name])));
  const columnsFor = (table) => objectExists(table, "table")
    ? new Set(database.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name))
    : new Set();
  const rowCount = (table) => objectExists(table, "table")
    ? Number(database.prepare(`SELECT COUNT(*) count FROM ${table}`).get()?.count || 0)
    : 0;
  const oldStructuresExist = objectExists("sales_link_sku_product_structures", "table");
  const oldComponentsExist = objectExists("sales_link_sku_product_structure_components", "table");
  const oldFactsExist = objectExists("connection_sku_sales_facts", "table");
  const archivedStructuresExist = objectExists("legacy_link_product_structures", "table");
  const archivedComponentsExist = objectExists("legacy_link_product_structure_components", "table");
  const archivedFactsExist = objectExists("legacy_connection_sku_sales_facts", "table");
  if (oldStructuresExist !== oldComponentsExist) throw new Error("链接中心Phase 4归档中止：旧Structure主表与组件表不完整。");
  if (oldStructuresExist && (archivedStructuresExist || archivedComponentsExist)) {
    throw new Error("链接中心Phase 4归档中止：运行表与归档表同时存在，需人工核对。");
  }
  if (oldFactsExist && archivedFactsExist) throw new Error("链接中心Phase 4归档中止：旧周期事实运行表与归档表同时存在。");

  const mappingColumns = columnsFor("sales_link_sku_erp_mappings");
  const mappingsExist = objectExists("sales_link_sku_erp_mappings", "table");
  const needsMappingRebuild = mappingsExist
    && (mappingColumns.has("productStructureId") || !mappingColumns.has("salesObjectStructureId"));
  const before = {
    oldStructures: rowCount(oldStructuresExist ? "sales_link_sku_product_structures" : "legacy_link_product_structures"),
    oldComponents: rowCount(oldComponentsExist ? "sales_link_sku_product_structure_components" : "legacy_link_product_structure_components"),
    oldFacts: rowCount(oldFactsExist ? "connection_sku_sales_facts" : "legacy_connection_sku_sales_facts"),
    mappings: rowCount("sales_link_sku_erp_mappings"),
  };
  const changed = oldStructuresExist || oldFactsExist || needsMappingRebuild;
  const foreignKeysEnabled = Number(database.pragma("foreign_keys", { simple: true })) === 1;
  if (foreignKeysEnabled) database.pragma("foreign_keys = OFF");
  try {
    database.transaction(() => {
      if (oldStructuresExist || archivedStructuresExist || needsMappingRebuild) database.exec(`
        CREATE TABLE IF NOT EXISTS legacy_link_product_structure_sales_object_map (
          legacyStructureId TEXT PRIMARY KEY,
          salesLinkSkuId TEXT NOT NULL,
          salesObjectRelationId TEXT NOT NULL,
          salesObjectId TEXT NOT NULL,
          salesObjectStructureId TEXT NOT NULL,
          salesObjectStructureVersion INTEGER NOT NULL,
          archivedAt TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_legacy_structure_map_link_sku
          ON legacy_link_product_structure_sales_object_map(salesLinkSkuId);
      `);
      if (oldStructuresExist) {
        database.exec(`
          INSERT OR IGNORE INTO legacy_link_product_structure_sales_object_map (
            legacyStructureId,salesLinkSkuId,salesObjectRelationId,salesObjectId,
            salesObjectStructureId,salesObjectStructureVersion,archivedAt
          )
          SELECT legacy.id,legacy.salesLinkSkuId,relation.id,relation.salesObjectId,
            structure.id,structure.version,datetime('now')
          FROM sales_link_sku_product_structures legacy
          JOIN sales_link_sku_sales_object_relations relation
            ON relation.linkSkuId=legacy.salesLinkSkuId AND relation.status='active'
          JOIN sales_object_structures structure
            ON structure.salesObjectId=relation.salesObjectId AND structure.status='active';
        `);
        const mapped = rowCount("legacy_link_product_structure_sales_object_map");
        if (mapped !== before.oldStructures) {
          throw new Error(`链接中心Phase 4归档中止：旧Structure对照不完整 ${mapped}/${before.oldStructures}`);
        }
      }

      if (needsMappingRebuild) {
        const unresolvedMappings = mappingColumns.has("productStructureId")
          ? Number(database.prepare(`SELECT COUNT(*) count FROM sales_link_sku_erp_mappings mapping
              LEFT JOIN legacy_link_product_structure_sales_object_map archived
                ON archived.legacyStructureId=mapping.productStructureId
              LEFT JOIN sales_link_sku_sales_object_relations relation
                ON relation.linkSkuId=mapping.salesLinkSkuId AND relation.status='active'
              LEFT JOIN sales_object_structures structure
                ON structure.salesObjectId=relation.salesObjectId AND structure.status='active'
              WHERE COALESCE(archived.salesObjectStructureId,structure.id) IS NULL`).get()?.count || 0)
          : 0;
        if (unresolvedMappings) throw new Error(`链接中心Phase 4归档中止：${unresolvedMappings}条Mapping无法迁移到Sales Object Structure。`);
        const structureExpression = mappingColumns.has("productStructureId")
          ? `COALESCE((SELECT archived.salesObjectStructureId FROM legacy_link_product_structure_sales_object_map archived
                WHERE archived.legacyStructureId=sales_link_sku_erp_mappings.productStructureId),
              (SELECT structure.id FROM sales_link_sku_sales_object_relations relation
                JOIN sales_object_structures structure ON structure.salesObjectId=relation.salesObjectId AND structure.status='active'
                WHERE relation.linkSkuId=sales_link_sku_erp_mappings.salesLinkSkuId AND relation.status='active'
                ORDER BY structure.version DESC,structure.id DESC LIMIT 1))`
          : "salesObjectStructureId";
        database.exec(`
          DROP TABLE IF EXISTS sales_link_sku_erp_mappings_phase4_clean;
          CREATE TABLE sales_link_sku_erp_mappings_phase4_clean (
            id TEXT PRIMARY KEY,
            salesLinkSkuId TEXT NOT NULL,
            erpSkuId TEXT NOT NULL,
            mappingType TEXT NOT NULL DEFAULT 'single',
            quantity REAL NOT NULL DEFAULT 1,
            currentState TEXT NOT NULL DEFAULT 'active',
            sourceType TEXT NOT NULL DEFAULT 'legacy_migration',
            sourceBatchId TEXT,
            createdAt TEXT NOT NULL,
            updatedAt TEXT NOT NULL,
            invalidatedAt TEXT,
            salesObjectStructureId TEXT NOT NULL,
            FOREIGN KEY(salesLinkSkuId) REFERENCES sales_link_skus(id),
            FOREIGN KEY(erpSkuId) REFERENCES erp_skus(id),
            FOREIGN KEY(salesObjectStructureId) REFERENCES sales_object_structures(id),
            UNIQUE(salesLinkSkuId,erpSkuId),
            CHECK(mappingType IN ('single','combo')),
            CHECK(quantity > 0),
            CHECK(currentState IN ('active','inactive'))
          );
          INSERT INTO sales_link_sku_erp_mappings_phase4_clean (
            id,salesLinkSkuId,erpSkuId,mappingType,quantity,currentState,sourceType,
            sourceBatchId,createdAt,updatedAt,invalidatedAt,salesObjectStructureId
          ) SELECT id,salesLinkSkuId,erpSkuId,mappingType,quantity,currentState,sourceType,
            sourceBatchId,createdAt,updatedAt,invalidatedAt,${structureExpression}
          FROM sales_link_sku_erp_mappings;
          DROP TABLE sales_link_sku_erp_mappings;
          ALTER TABLE sales_link_sku_erp_mappings_phase4_clean RENAME TO sales_link_sku_erp_mappings;
          CREATE INDEX idx_sales_link_sku_erp_mapping_link_state
            ON sales_link_sku_erp_mappings(salesLinkSkuId,currentState);
          CREATE INDEX idx_sales_link_sku_erp_mapping_erp_state
            ON sales_link_sku_erp_mappings(erpSkuId,currentState);
          CREATE INDEX idx_sales_link_sku_erp_mapping_batch
            ON sales_link_sku_erp_mappings(sourceBatchId);
          CREATE INDEX idx_sales_link_sku_erp_mapping_sales_object_structure
            ON sales_link_sku_erp_mappings(salesObjectStructureId);
        `);
      }

      if (oldStructuresExist) {
        database.exec(`
          DROP TRIGGER IF EXISTS trg_product_structure_activation_insert;
          DROP TRIGGER IF EXISTS trg_product_structure_activation_update;
          DROP INDEX IF EXISTS idx_sales_link_sku_product_structures_one_active;
          DROP INDEX IF EXISTS idx_sales_link_sku_product_structures_batch_sku_hash;
          DROP INDEX IF EXISTS idx_sales_link_sku_product_structures_status_updated;
          DROP INDEX IF EXISTS idx_sales_link_sku_product_structure_components_order;
          DROP INDEX IF EXISTS idx_sales_link_sku_product_structure_components_erp;
          ALTER TABLE sales_link_sku_product_structures RENAME TO legacy_link_product_structures;
          ALTER TABLE sales_link_sku_product_structure_components RENAME TO legacy_link_product_structure_components;
        `);
      }
      if (oldFactsExist) {
        database.exec(`
          DROP INDEX IF EXISTS idx_connection_sku_sales_link_period;
          DROP INDEX IF EXISTS idx_connection_sku_sales_erp_period;
          DROP INDEX IF EXISTS idx_connection_sku_sales_v2_identity;
          DROP INDEX IF EXISTS idx_connection_sku_sales_legacy_identity;
          ALTER TABLE connection_sku_sales_facts RENAME TO legacy_connection_sku_sales_facts;
        `);
      }
      for (const table of [
        "legacy_link_product_structures",
        "legacy_link_product_structure_components",
        "legacy_link_product_structure_sales_object_map",
        "legacy_connection_sku_sales_facts",
        "legacy_connection_profiles",
        "legacy_connection_diagnosis_entries",
      ]) {
        if (objectExists(table, "table")) createLegacyArchiveReadOnlyTriggers(database, table);
      }
    })();
  } finally {
    if (foreignKeysEnabled) database.pragma("foreign_keys = ON");
  }
  const after = {
    oldStructures: rowCount("legacy_link_product_structures"),
    oldComponents: rowCount("legacy_link_product_structure_components"),
    oldFacts: rowCount("legacy_connection_sku_sales_facts"),
    mappings: rowCount("sales_link_sku_erp_mappings"),
  };
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    throw new Error(`链接中心Phase 4归档数量不一致：${JSON.stringify({ before, after })}`);
  }
  const violations = database.pragma("foreign_key_check");
  if (violations.length) throw new Error(`链接中心Phase 4归档后外键检查失败：${JSON.stringify(violations.slice(0, 10))}`);
  if (changed) console.log("[db:migrate] archived Link Center Phase 4 legacy structures and period facts");
  return { changed, archivedTables: Number(oldStructuresExist) * 2 + Number(oldFactsExist), before, after };
}

function runLightweightMigrations() {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS task_waves (
      id TEXT PRIMARY KEY,
      businessCode TEXT NOT NULL UNIQUE,
      taskTemplateId TEXT NOT NULL,
      processTemplateId TEXT NOT NULL,
      processNodeId TEXT NOT NULL,
      executorId TEXT NOT NULL,
      templateGroupKey TEXT NOT NULL,
      waveType TEXT NOT NULL,
      taskCount INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'waiting',
      acceptingTasks INTEGER NOT NULL DEFAULT 0,
      collectUntil TEXT,
      lockedAt TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      startedAt TEXT,
      unitDurationMinutes INTEGER,
      waveDurationMinutes INTEGER,
      deadlineAt TEXT,
      submittedAt TEXT,
      completedAt TEXT,
      canceledAt TEXT,
      cancelReason TEXT,
      supersededAt TEXT,
      supersededByGenerationId TEXT,
      supersededByUserId TEXT,
      supersedeReason TEXT,
      generationMaxTaskCount INTEGER
    );
    CREATE TABLE IF NOT EXISTS task_wave_items (
      id TEXT PRIMARY KEY,
      waveId TEXT NOT NULL,
      taskId TEXT NOT NULL,
      processInstanceId TEXT NOT NULL,
      linkedTemplateIds TEXT NOT NULL DEFAULT '[]',
      primaryTemplateId TEXT,
      sortOrder INTEGER NOT NULL,
      joinedAt TEXT NOT NULL,
      removedAt TEXT,
      removeReason TEXT,
      isActive INTEGER NOT NULL DEFAULT 1,
      resultDraft TEXT NOT NULL DEFAULT '{}',
      updatedAt TEXT,
      submittedAt TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_task_waves_process_node ON task_waves(processNodeId);
    CREATE INDEX IF NOT EXISTS idx_task_waves_executor ON task_waves(executorId);
    CREATE INDEX IF NOT EXISTS idx_task_waves_status ON task_waves(status);
    CREATE INDEX IF NOT EXISTS idx_task_wave_items_wave ON task_wave_items(waveId);
    CREATE INDEX IF NOT EXISTS idx_task_wave_items_task ON task_wave_items(taskId);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_task_wave_items_active_task ON task_wave_items(taskId) WHERE isActive = 1;
    CREATE TABLE IF NOT EXISTS wave_regeneration_runs (
      id TEXT PRIMARY KEY,
      createdBy TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      completedAt TEXT,
      status TEXT NOT NULL,
      replacedWaveCount INTEGER NOT NULL DEFAULT 0,
      sourceTaskCount INTEGER NOT NULL DEFAULT 0,
      unassignedNewTaskCount INTEGER NOT NULL DEFAULT 0,
      generatedWaveCount INTEGER NOT NULL DEFAULT 0,
      remainingTaskCount INTEGER NOT NULL DEFAULT 0,
      generatedWaveIds TEXT NOT NULL DEFAULT '[]',
      errorSummary TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_wave_regeneration_runs_created ON wave_regeneration_runs(createdAt);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_wave_regeneration_runs_active ON wave_regeneration_runs(status) WHERE status = 'running';
  `);
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      skuCode TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      mainImage TEXT,
      galleryImages TEXT,
      brand TEXT,
      category TEXT,
      series TEXT,
      material TEXT,
      color TEXT,
      specification TEXT,
      status TEXT NOT NULL,
      ownerId TEXT,
      remark TEXT,
      createdAt TEXT,
      updatedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS action_products (
      id TEXT PRIMARY KEY,
      actionId TEXT NOT NULL,
      productId TEXT NOT NULL,
      createdAt TEXT,
      UNIQUE(actionId, productId)
    );
    CREATE INDEX IF NOT EXISTS idx_action_products_action ON action_products(actionId);
    CREATE INDEX IF NOT EXISTS idx_action_products_product ON action_products(productId);
    CREATE TABLE IF NOT EXISTS product_import_batches (
      id TEXT PRIMARY KEY,
      fileName TEXT NOT NULL,
      sourceSystem TEXT,
      sheetName TEXT,
      status TEXT NOT NULL,
      headers TEXT,
      mappingConfig TEXT,
      summary TEXT,
      createdBy TEXT,
      validatedAt TEXT,
      committedAt TEXT,
      createdAt TEXT,
      updatedAt TEXT
    )
  `);
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
      businessCode TEXT UNIQUE,
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
  ensureColumn("assistant_device_sessions", "accessProfile", "TEXT NOT NULL DEFAULT 'read_only'");
  ensureColumn("goals", "businessCode", "TEXT");
  ensureColumn("task_templates", "businessCode", "TEXT");
  ensureColumn("process_instances", "businessCode", "TEXT");
  ensureColumn("tasks", "businessCode", "TEXT");
  ensureColumn("tasks", "executorId", "TEXT");
  ensureColumn("tasks", "readyAt", "TEXT");
  ensureColumn("tasks", "taskType", "TEXT NOT NULL DEFAULT 'execution'");
  ensureColumn("tasks", "reviewTargetTaskId", "TEXT");
  ensureColumn("tasks", "reviewTargetSnapshot", "TEXT");
  ensureColumn("tasks", "returnToNodeId", "TEXT");
  ensureColumn("tasks", "reviewStatus", "TEXT");
  ensureColumn("tasks", "reviewComment", "TEXT");
  ensureColumn("tasks", "reviewedAt", "TEXT");
  ensureColumn("tasks", "reviewerId", "TEXT");
  ensureColumn("tasks", "requireRejectionReason", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("process_templates", "businessCode", "TEXT");
  ensureColumn("templates", "businessCode", "TEXT");
  ensureColumn("task_templates", "defaultProcessTemplateId", "TEXT");
  ensureColumn("process_template_nodes", "stepOrder", "INTEGER");
  ensureColumn("process_template_nodes", "stepType", "TEXT NOT NULL DEFAULT 'execution'");
  ensureColumn("process_template_nodes", "departmentId", "TEXT");
  ensureColumn("process_template_nodes", "ownerId", "TEXT");
  ensureColumn("process_template_nodes", "executorId", "TEXT");
  ensureColumn("process_template_nodes", "durationMinutes", "INTEGER");
  ensureColumn("process_template_nodes", "submitType", "TEXT");
  ensureColumn("process_template_nodes", "submitDescription", "TEXT");
  ensureColumn("process_template_nodes", "submitFields", "TEXT");
  ensureColumn("process_template_nodes", "requireFile", "INTEGER DEFAULT 0");
  ensureColumn("process_template_nodes", "requireLink", "INTEGER DEFAULT 0");
  ensureColumn("process_template_nodes", "reviewerId", "TEXT");
  ensureColumn("process_template_nodes", "reviewTargetType", "TEXT");
  ensureColumn("process_template_nodes", "returnToNodeId", "TEXT");
  ensureColumn("process_template_nodes", "requireRejectionReason", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("process_template_nodes", "waveEnabled", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("process_template_nodes", "waveSize", "INTEGER NOT NULL DEFAULT 10");
  ensureColumn("process_template_nodes", "waveUnlimited", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("process_template_nodes", "waveTemplatePriority", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("task_waves", "generationMaxTaskCount", "INTEGER");
  ensureColumn("task_waves", "acceptingTasks", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("task_waves", "collectUntil", "TEXT");
  ensureColumn("task_waves", "lockedAt", "TEXT");
  getDatabase()
    .prepare(
      `UPDATE task_waves
       SET status = 'waiting', acceptingTasks = 1
       WHERE status = 'waiting_collect'`,
    )
    .run();
  ensureColumn("task_wave_items", "resultDraft", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn("task_wave_items", "updatedAt", "TEXT");
  ensureColumn("task_wave_items", "submittedAt", "TEXT");
  ensureColumn("product_erp_mappings", "specificationName", "TEXT");
  ensureColumn("product_erp_mappings", "unit", "TEXT");
  ensureColumn("product_erp_mappings", "barcode", "TEXT");
  ensureColumn("product_erp_mappings", "erpStatus", "TEXT");
  ensureColumn("erp_import_batches", "syncRunId", "TEXT");
  ensureColumn("erp_import_batches", "businessDate", "TEXT");
  ensureColumn("erp_import_batches", "importMode", "TEXT");
  ensureColumn("erp_import_batches", "dataSource", "TEXT NOT NULL DEFAULT 'excel'");
  ensureColumn("erp_sync_runs", "snapshotId", "TEXT");
  ensureColumn("erp_sync_runs", "snapshotStatus", "TEXT NOT NULL DEFAULT 'pending'");
  ensureColumn("erp_sync_runs", "snapshotCompletedAt", "TEXT");
  ensureColumn("erp_sync_runs", "snapshotError", "TEXT");
  ensureColumn("erp_sync_runs", "reconciliationStatus", "TEXT NOT NULL DEFAULT 'pending'");
  ensureColumn("erp_sync_runs", "reconciledAt", "TEXT");
  ensureColumn("erp_sync_runs", "reconciliationError", "TEXT");
  ensureColumn("erp_sync_runs", "reconciliationSummaryJson", "TEXT");
  ensureColumn("erp_sync_runs", "syncType", "TEXT NOT NULL DEFAULT 'legacy_combined'");
  ensureColumn("erp_sync_runs", "dataSource", "TEXT NOT NULL DEFAULT 'excel'");
  ensureColumn("erp_goods", "lastSeenBatchId", "TEXT");
  ensureColumn("erp_goods", "currentState", "TEXT NOT NULL DEFAULT 'active'");
  ensureColumn("erp_goods", "missingAt", "TEXT");
  ensureColumn("erp_goods", "sourceUpdatedAt", "TEXT");
  ensureColumn("erp_goods", "rawSourceData", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn("product_erp_mappings", "currentState", "TEXT NOT NULL DEFAULT 'active'");
  ensureColumn("product_erp_mappings", "missingAt", "TEXT");
  ensureColumn("product_erp_mappings", "lastSeenInventoryBatchId", "TEXT");
  ensureColumn("product_erp_mappings", "inventoryCurrentState", "TEXT NOT NULL DEFAULT 'active'");
  ensureColumn("product_erp_mappings", "inventoryMissingAt", "TEXT");
  ensureColumn("sales_links", "currentState", "TEXT NOT NULL DEFAULT 'active'");
  ensureColumn("sales_links", "missingAt", "TEXT");
  ensureColumn("sales_link_skus", "currentState", "TEXT NOT NULL DEFAULT 'active'");
  ensureColumn("sales_link_skus", "missingAt", "TEXT");
  ensureColumn("erp_skus", "mainImage", "TEXT");
  ensureColumn("erp_skus", "galleryImages", "TEXT");
  ensureColumn("erp_skus", "sourceUpdatedAt", "TEXT");
  ensureColumn("erp_skus", "rawSourceData", "TEXT NOT NULL DEFAULT '{}'");
  migrateProductErpMappingsV2();
  migrateConnectionSkuSalesDailyFactsV1();
  migrateSalesRelationCandidatesV1();
  migrateSalesObjectsV1();
  migrateProductStructureApplicationApprovalsV1();
  migrateSalesDailyAnomalyGovernanceV1();
  migrateErpSkuBusinessUsagesV1();
  retireCustomerAndSupplyChainV1();
  retireAiOperationAssistantV1();
  retireStoredModulePermissionsV1();
  ensureColumn("wangdian_goods_sync_logs", "importBatchId", "TEXT");
  ensureColumn("wangdian_goods_sync_logs", "successCount", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("wangdian_goods_sync_logs", "failedCount", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("data_sync_batches", "scopeJson", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn("data_sync_batches", "progressJson", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn("data_sync_batches", "fileName", "TEXT");
  ensureColumn("data_sync_batches", "fileHash", "TEXT");
  ensureColumn("data_sync_batches", "periodStart", "TEXT");
  ensureColumn("data_sync_batches", "periodEnd", "TEXT");
  ensureColumn("data_sync_exceptions", "status", "TEXT NOT NULL DEFAULT 'open'");
  ensureColumn("data_sync_exceptions", "resolvedAt", "TEXT");
  ensureColumn("data_sync_exceptions", "resolvedReason", "TEXT");
  ensureColumn("data_sync_exceptions", "resolutionType", "TEXT");
  ensureColumn("connection_import_rows", "resolvedAt", "TEXT");
  ensureColumn("connection_import_rows", "resolvedReason", "TEXT");
  ensureColumn("connection_import_rows", "resolutionType", "TEXT");
  ensureColumn("connection_import_rows", "resolutionNote", "TEXT");
  ensureColumn("platform_goods_excel_import_rows", "resolutionType", "TEXT");
  ensureColumn("platform_goods_excel_import_rows", "resolutionNote", "TEXT");
  ensureColumn("platform_goods_excel_import_rows", "resolvedAt", "TEXT");
  ensureColumn("platform_goods_excel_import_rows", "shopAction", "TEXT");
  ensureColumn("platform_goods_excel_import_rows", "shopId", "TEXT");
  ensureColumn("platform_goods_excel_import_rows", "platform", "TEXT");
  ensureColumn("platform_goods_excel_import_rows", "linkAction", "TEXT");
  ensureColumn("platform_goods_excel_import_rows", "skuAction", "TEXT");
  ensureColumn("platform_goods_excel_import_rows", "relationAction", "TEXT");
  getDatabase().exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_data_sync_batches_task_file_hash ON data_sync_batches(taskId,fileHash) WHERE fileHash IS NOT NULL AND fileHash<>''");
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS wangdian_shop_discovery_batches (
      id TEXT PRIMARY KEY,
      targetShopId TEXT NOT NULL,
      requestStart TEXT NOT NULL,
      requestEnd TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting',
      currentPage INTEGER NOT NULL DEFAULT 0,
      totalPages INTEGER,
      totalRows INTEGER,
      readRows INTEGER NOT NULL DEFAULT 0,
      errorMessage TEXT,
      createdBy TEXT,
      createdAt TEXT NOT NULL,
      startedAt TEXT,
      completedAt TEXT,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY(targetShopId) REFERENCES sales_shops(id)
    );
    CREATE INDEX IF NOT EXISTS idx_wangdian_shop_discovery_status ON wangdian_shop_discovery_batches(status,updatedAt DESC);
    CREATE TABLE IF NOT EXISTS wangdian_shop_discovery_candidates (
      batchId TEXT NOT NULL,
      shopNo TEXT NOT NULL COLLATE NOCASE,
      returnedRows INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(batchId,shopNo),
      FOREIGN KEY(batchId) REFERENCES wangdian_shop_discovery_batches(id)
    );
    CREATE TABLE IF NOT EXISTS wangdian_shop_discovery_goods (
      batchId TEXT NOT NULL,
      shopNo TEXT NOT NULL COLLATE NOCASE,
      platformGoodsId TEXT NOT NULL,
      matched INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(batchId,shopNo,platformGoodsId),
      FOREIGN KEY(batchId) REFERENCES wangdian_shop_discovery_batches(id)
    );
    CREATE INDEX IF NOT EXISTS idx_wangdian_shop_discovery_goods_match ON wangdian_shop_discovery_goods(batchId,matched,shopNo);
  `);
  getDatabase().prepare("UPDATE data_sync_tasks SET taskCode='sales_fact_excel_import',syncType='sales_fact_excel_import',name='真实销售导入',executionMode='manual',updatedAt=datetime('now') WHERE id='sync-task-real-sales' AND (taskCode<>'sales_fact_excel_import' OR syncType<>'sales_fact_excel_import')").run();
  getDatabase().exec(`
    INSERT OR IGNORE INTO data_sync_tasks
      (id,taskCode,name,syncType,sourceType,sourceMethod,transportType,executionMode,defaultSyncMode,scheduleCron,scheduleDescription,status,configJson,createdAt,updatedAt)
    VALUES
      ('sync-task-wangdian-suites','wangdian_suites','旺店通组合装同步','wangdian_suites','wangdian_api','goods.Suite.search','api','both','incremental','15 2 * * *','每天02:15','paused','{"baseline":"combo_master_excel"}',datetime('now'),datetime('now')),
      ('sync-task-platform-goods-excel','platform_goods_excel_import','平台货品关系导入','platform_goods_excel_import','excel',NULL,'excel','manual','full',NULL,NULL,'enabled','{}',datetime('now'),datetime('now'));
    CREATE TABLE IF NOT EXISTS platform_goods_excel_import_rows (
      batchId TEXT NOT NULL,
      rowNumber INTEGER NOT NULL,
      sourceShopName TEXT,
      shopId TEXT,
      platform TEXT,
      platformGoodsId TEXT,
      platformSkuId TEXT,
      merchantSkuCode TEXT,
      systemGoodsType TEXT,
      salesLinkId TEXT,
      salesLinkSkuId TEXT,
      erpSkuId TEXT,
      action TEXT NOT NULL,
      shopAction TEXT,
      linkAction TEXT,
      skuAction TEXT,
      relationAction TEXT,
      exceptionType TEXT,
      message TEXT,
      rawDataJson TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY(batchId,rowNumber),
      FOREIGN KEY(batchId) REFERENCES data_sync_batches(id)
    );
    CREATE INDEX IF NOT EXISTS idx_platform_goods_excel_rows_action ON platform_goods_excel_import_rows(batchId,action);
    CREATE TABLE IF NOT EXISTS platform_goods_excel_source_files (
      sourceFileHash TEXT PRIMARY KEY,
      fileName TEXT NOT NULL,
      contentBlob BLOB NOT NULL,
      firstUploadedAt TEXT NOT NULL,
      lastUploadedAt TEXT NOT NULL,
      uploadedBy TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_platform_goods_excel_source_files_time
      ON platform_goods_excel_source_files(lastUploadedAt DESC);
  `);
  ensureColumn("wangdian_inventory_sync_batches", "dataSyncBatchId", "TEXT");
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS erp_skus (
      id TEXT PRIMARY KEY,
      merchantSkuCode TEXT NOT NULL COLLATE NOCASE UNIQUE,
      erpGoodsId TEXT NOT NULL,
      specificationName TEXT,
      barcode TEXT,
      unit TEXT,
      erpStatus TEXT,
      mainImage TEXT,
      galleryImages TEXT,
      firstSeenBatchId TEXT NOT NULL,
      lastSeenBatchId TEXT NOT NULL,
      currentState TEXT NOT NULL DEFAULT 'active',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY(erpGoodsId) REFERENCES erp_goods(id)
    );
    CREATE INDEX IF NOT EXISTS idx_erp_skus_current_code
      ON erp_skus(currentState,merchantSkuCode);
    CREATE INDEX IF NOT EXISTS idx_erp_skus_goods
      ON erp_skus(erpGoodsId);
    CREATE TABLE IF NOT EXISTS erp_sync_runs (
      id TEXT PRIMARY KEY,
      syncCode TEXT NOT NULL UNIQUE,
      businessDate TEXT NOT NULL,
      version INTEGER NOT NULL,
      syncType TEXT NOT NULL DEFAULT 'legacy_combined',
      dataSource TEXT NOT NULL DEFAULT 'excel',
      status TEXT NOT NULL,
      goodsInfoBatchId TEXT,
      inventoryBatchId TEXT,
      platformGoodsBatchId TEXT,
      supersedesRunId TEXT,
      goodsInfoExportedAt TEXT,
      inventoryExportedAt TEXT,
      platformGoodsExportedAt TEXT,
      createdBy TEXT,
      createdAt TEXT NOT NULL,
      startedAt TEXT,
      completedAt TEXT,
      failedAt TEXT,
      errorSummary TEXT,
      snapshotId TEXT,
      snapshotStatus TEXT NOT NULL DEFAULT 'pending',
      snapshotCompletedAt TEXT,
      snapshotError TEXT,
      reconciliationStatus TEXT NOT NULL DEFAULT 'pending',
      reconciledAt TEXT,
      reconciliationError TEXT,
      reconciliationSummaryJson TEXT,
      updatedAt TEXT NOT NULL,
      UNIQUE(businessDate, version)
    );
    CREATE INDEX IF NOT EXISTS idx_erp_import_batches_sync_run
      ON erp_import_batches(syncRunId, importType, createdAt);
    CREATE INDEX IF NOT EXISTS idx_erp_sync_runs_business_date
      ON erp_sync_runs(businessDate, version);
    CREATE INDEX IF NOT EXISTS idx_erp_sync_runs_status
      ON erp_sync_runs(status, updatedAt);
    DROP INDEX IF EXISTS idx_erp_sync_runs_one_active_date;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_sync_runs_one_active_type_date
      ON erp_sync_runs(syncType,businessDate)
      WHERE status IN ('draft','processing','syncing','partial');
    CREATE TABLE IF NOT EXISTS erp_fact_snapshots (
      id TEXT PRIMARY KEY,
      syncRunId TEXT NOT NULL UNIQUE,
      businessDate TEXT NOT NULL,
      version INTEGER NOT NULL,
      status TEXT NOT NULL,
      isCurrent INTEGER NOT NULL DEFAULT 0,
      supersedesSnapshotId TEXT,
      productCount INTEGER NOT NULL DEFAULT 0,
      inventoryRowCount INTEGER NOT NULL DEFAULT 0,
      salesLinkCount INTEGER NOT NULL DEFAULT 0,
      platformSkuCount INTEGER NOT NULL DEFAULT 0,
      productShopRelationCount INTEGER NOT NULL DEFAULT 0,
      contentHash TEXT,
      createdAt TEXT NOT NULL,
      completedAt TEXT,
      errorSummary TEXT,
      FOREIGN KEY(syncRunId) REFERENCES erp_sync_runs(id),
      FOREIGN KEY(supersedesSnapshotId) REFERENCES erp_fact_snapshots(id),
      UNIQUE(businessDate, version)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_fact_snapshots_current
      ON erp_fact_snapshots(businessDate) WHERE isCurrent = 1 AND status = 'completed';
    CREATE TABLE IF NOT EXISTS product_daily_snapshots (
      snapshotId TEXT NOT NULL,businessDate TEXT NOT NULL,productId TEXT NOT NULL,skuCode TEXT,productName TEXT,
      erpGoodsCount INTEGER NOT NULL DEFAULT 0,totalStock REAL,availableStock REAL,shippableStock REAL,
      purchaseInTransit REAL,pendingShipment REAL,sales7d REAL,sales30d REAL,sales90d REAL,sales180d REAL,
      totalSales REAL,platformCount INTEGER NOT NULL DEFAULT 0,shopCount INTEGER NOT NULL DEFAULT 0,
      salesLinkCount INTEGER NOT NULL DEFAULT 0,platformSkuCount INTEGER NOT NULL DEFAULT 0,
      productStatus TEXT,erpStatus TEXT,createdAt TEXT NOT NULL,
      PRIMARY KEY(snapshotId,productId),
      FOREIGN KEY(snapshotId) REFERENCES erp_fact_snapshots(id),
      FOREIGN KEY(productId) REFERENCES products(id)
    );
    CREATE TABLE IF NOT EXISTS product_erp_daily_snapshots (
      snapshotId TEXT NOT NULL,businessDate TEXT NOT NULL,productId TEXT NOT NULL,mappingId TEXT NOT NULL,
      erpGoodsId TEXT NOT NULL,goodsCode TEXT,merchantCode TEXT,specificationName TEXT,barcode TEXT,unit TEXT,
      erpStatus TEXT,unitCost REAL,stock REAL,shippableStock REAL,availableStock REAL,actualStock REAL,actualShippableStock REAL,
      purchaseInTransit REAL,pendingShipment REAL,sales7d REAL,sales30d REAL,sales90d REAL,sales180d REAL,
      totalSales REAL,sourceBatchId TEXT,createdAt TEXT NOT NULL,
      PRIMARY KEY(snapshotId,mappingId),
      FOREIGN KEY(snapshotId) REFERENCES erp_fact_snapshots(id),
      FOREIGN KEY(productId) REFERENCES products(id)
    );
    CREATE TABLE IF NOT EXISTS sales_link_daily_snapshots (
      snapshotId TEXT NOT NULL,businessDate TEXT NOT NULL,salesLinkId TEXT NOT NULL,shopId TEXT NOT NULL,
      platform TEXT,platformGoodsId TEXT,canonicalUrl TEXT,goodsTitle TEXT,linkStatus TEXT,price REAL,
      platformStock REAL,occupiedStock REAL,firstSeenAt TEXT,lastSeenBatchId TEXT,sourceBatchId TEXT,
      createdAt TEXT NOT NULL,PRIMARY KEY(snapshotId,salesLinkId),
      FOREIGN KEY(snapshotId) REFERENCES erp_fact_snapshots(id)
    );
    CREATE TABLE IF NOT EXISTS sales_link_sku_daily_snapshots (
      snapshotId TEXT NOT NULL,businessDate TEXT NOT NULL,salesLinkSkuId TEXT NOT NULL,salesLinkId TEXT NOT NULL,
      platformSkuId TEXT,merchantCode TEXT,skuName TEXT,matchStatus TEXT,productId TEXT,manualBindingId TEXT,
      combinationFlag INTEGER NOT NULL DEFAULT 0,platformPrice REAL,platformStock REAL,occupiedStock REAL,
      sourceBatchId TEXT,createdAt TEXT NOT NULL,PRIMARY KEY(snapshotId,salesLinkSkuId),
      FOREIGN KEY(snapshotId) REFERENCES erp_fact_snapshots(id)
    );
    CREATE TABLE IF NOT EXISTS product_shop_daily_snapshots (
      snapshotId TEXT NOT NULL,businessDate TEXT NOT NULL,productId TEXT NOT NULL,shopId TEXT NOT NULL,
      platform TEXT,salesLinkCount INTEGER NOT NULL DEFAULT 0,platformSkuCount INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,PRIMARY KEY(snapshotId,productId,shopId),
      FOREIGN KEY(snapshotId) REFERENCES erp_fact_snapshots(id)
    );
    CREATE INDEX IF NOT EXISTS idx_product_daily_snapshots_product_date
      ON product_daily_snapshots(productId,businessDate);
    CREATE INDEX IF NOT EXISTS idx_product_erp_daily_snapshots_product_date
      ON product_erp_daily_snapshots(productId,businessDate);
    CREATE INDEX IF NOT EXISTS idx_sales_link_daily_snapshots_link_date
      ON sales_link_daily_snapshots(salesLinkId,businessDate);
    CREATE INDEX IF NOT EXISTS idx_sales_link_sku_daily_snapshots_product_date
      ON sales_link_sku_daily_snapshots(productId,businessDate);
    CREATE INDEX IF NOT EXISTS idx_product_shop_daily_snapshots_product_date
      ON product_shop_daily_snapshots(productId,businessDate);
    CREATE INDEX IF NOT EXISTS idx_erp_goods_current_seen
      ON erp_goods(currentState,lastSeenBatchId);
    CREATE INDEX IF NOT EXISTS idx_product_erp_mappings_current_seen
      ON product_erp_mappings(currentState,sourceBatchId);
    CREATE INDEX IF NOT EXISTS idx_product_erp_mappings_inventory_seen
      ON product_erp_mappings(inventoryCurrentState,lastSeenInventoryBatchId);
    CREATE INDEX IF NOT EXISTS idx_sales_links_current_state
      ON sales_links(currentState);
    CREATE INDEX IF NOT EXISTS idx_sales_link_skus_current_state
      ON sales_link_skus(currentState);
  `);
  ensureColumn("product_erp_daily_snapshots", "unitCost", "REAL");
  ensureColumn("task_waves", "unitDurationMinutes", "INTEGER");
  ensureColumn("task_waves", "waveDurationMinutes", "INTEGER");
  ensureColumn("task_waves", "deadlineAt", "TEXT");
  ensureColumn("task_waves", "submittedAt", "TEXT");
  ensureColumn("task_waves", "supersededAt", "TEXT");
  ensureColumn("task_waves", "supersededByGenerationId", "TEXT");
  ensureColumn("task_waves", "supersededByUserId", "TEXT");
  ensureColumn("task_waves", "supersedeReason", "TEXT");
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
  ensureColumn("companies", "companySlogan", "TEXT");
  ensureColumn("process_instances", "dueDate", "TEXT");
  ensureColumn("process_instances", "canceledAt", "TEXT");
  ensureColumn("process_instances", "cancelReason", "TEXT");
  ensureColumn("content_schedules", "workPlanId", "TEXT");
  ensureColumn("content_schedules", "templateId", "TEXT");
  ensureColumn("work_plans", "departmentId", "TEXT");
  ensureColumn("work_plans", "workType", "TEXT DEFAULT 'normal'");
  ensureColumn("products", "skuName", "TEXT");
  ensureColumn("products", "weightKg", "REAL");
  ensureColumn("products", "lengthCm", "REAL");
  ensureColumn("products", "widthCm", "REAL");
  ensureColumn("products", "heightCm", "REAL");
  ensureColumn("products", "volumeCm3", "REAL");
  ensureColumn("products", "productType", "TEXT");
  ensureColumn("products", "style", "TEXT");
  ensureColumn("products", "warehouseInfo", "TEXT");
  ensureColumn("products", "tags", "TEXT");
  ensureColumn("products", "priceInfo", "TEXT");
  ensureColumn("products", "shelfLifeDays", "INTEGER");
  ensureColumn("products", "pointsInfo", "TEXT");
  ensureColumn("products", "unitInfo", "TEXT");
  ensureColumn("products", "placement", "TEXT");
  ensureColumn("products", "grade", "TEXT");
  ensureColumn("products", "sourceCreatedAt", "TEXT");
  ensureColumn("products", "sourceUpdatedAt", "TEXT");
  ensureColumn("products", "supplierInfo", "TEXT");
  ensureColumn("products", "preSaleInfo", "TEXT");
  ensureColumn("products", "erpStatusRaw", "TEXT");
  ensureColumn("products", "erpAttributes", "TEXT");
  ensureColumn("products", "identifiers", "TEXT");
  ensureColumn("products", "rawSourceData", "TEXT");
  ensureColumn("products", "sourceSystem", "TEXT");
  ensureColumn("products", "lastImportedAt", "TEXT");
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
  ensureColumn("persons", "permissionTemplateId", "TEXT");
  ensureColumn("persons", "permissionOverrides", "TEXT");
  ensureColumn("persons", "avatarUrl", "TEXT");
  ensureColumn("connection_import_batches", "periodStart", "TEXT");
  ensureColumn("connection_import_batches", "periodEnd", "TEXT");
  ensureColumn("connection_import_batches", "periodType", "TEXT");
  ensureColumn("connection_import_batches", "importType", "TEXT");
  ensureColumn("connection_import_batches", "templateVersionId", "TEXT");
  ensureColumn("connection_import_batches", "sourcePlatform", "TEXT");
  ensureColumn("connection_import_batches", "previewSummaryJson", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn("connection_import_batches", "completedAt", "TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_connection_import_batches_type_hash ON connection_import_batches(importType,fileHash) WHERE importType IS NOT NULL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS connection_bulk_platform_import_batches (
      id TEXT PRIMARY KEY,batchHash TEXT NOT NULL UNIQUE,status TEXT NOT NULL DEFAULT 'waiting',fileCount INTEGER NOT NULL DEFAULT 0,
      processedCount INTEGER NOT NULL DEFAULT 0,completedCount INTEGER NOT NULL DEFAULT 0,failedCount INTEGER NOT NULL DEFAULT 0,
      createdBy TEXT,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,completedAt TEXT,
      FOREIGN KEY(createdBy) REFERENCES persons(id)
    );
    CREATE TABLE IF NOT EXISTS connection_bulk_platform_import_files (
      id TEXT PRIMARY KEY,bulkBatchId TEXT NOT NULL,sequenceNo INTEGER NOT NULL,fileName TEXT NOT NULL,fileHash TEXT NOT NULL,contentBlob BLOB,
      status TEXT NOT NULL DEFAULT 'waiting',foundationBatchId TEXT,platform TEXT,shopId TEXT,shop TEXT,summaryJson TEXT NOT NULL DEFAULT '{}',
      idempotent INTEGER NOT NULL DEFAULT 0,errorMessage TEXT,startedAt TEXT,completedAt TEXT,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,
      FOREIGN KEY(bulkBatchId) REFERENCES connection_bulk_platform_import_batches(id),FOREIGN KEY(foundationBatchId) REFERENCES connection_import_batches(id),
      UNIQUE(bulkBatchId,sequenceNo)
    );
    CREATE INDEX IF NOT EXISTS idx_connection_bulk_platform_files_queue ON connection_bulk_platform_import_files(status,createdAt,sequenceNo);
  `);
  // A platform goods id can legitimately repeat across shops. The sales link already
  // carries the stable platform + shop + goods identity, so period facts key by link.
  db.exec("DROP INDEX IF EXISTS idx_connection_period_snapshots_external_period");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_connection_period_snapshots_link_period ON connection_period_snapshots(sourceType,salesLinkId,periodStart,periodEnd)");
  ensureColumn("sales_links", "originSource", "TEXT NOT NULL DEFAULT 'legacy_unknown'");
  ensureColumn("sales_links", "enrichmentStatus", "TEXT NOT NULL DEFAULT 'complete'");
  ensureColumn("sales_links", "displayName", "TEXT");
  ensureColumn("sales_links", "ownerId", "TEXT");
  ensureColumn("sales_links", "managementStatus", "TEXT NOT NULL DEFAULT 'active'");
  ensureColumn("sales_links", "managementNotes", "TEXT");
  ensureColumn("sales_links", "mainImage", "TEXT");
  ensureColumn("sales_links", "imageSource", "TEXT");
  ensureColumn("sales_links", "managementLevel", "TEXT NOT NULL DEFAULT 'new'");
  ensureColumn("sales_links", "managementOriginSource", "TEXT NOT NULL DEFAULT 'asset_native'");
  ensureColumn("sales_links", "managementOriginImportBatchId", "TEXT");
  ensureColumn("sales_links", "managementIdentifiedAt", "TEXT");
  ensureColumn("sales_links", "managementCreatedBy", "TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_sales_links_owner_management_status ON sales_links(ownerId,managementStatus)");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_status_due ON tasks(status,dueDate,id);
    CREATE INDEX IF NOT EXISTS idx_tasks_executor_status_due ON tasks(executorId,status,dueDate,id);
    CREATE INDEX IF NOT EXISTS idx_tasks_department_status_due ON tasks(departmentId,status,dueDate,id);
    CREATE INDEX IF NOT EXISTS idx_tasks_process_instance ON tasks(processInstanceId,id);
    CREATE INDEX IF NOT EXISTS idx_tasks_goal ON tasks(goalId,id);
    CREATE INDEX IF NOT EXISTS idx_tasks_template_usage ON tasks(taskTemplateId,updatedAt,id);
    CREATE INDEX IF NOT EXISTS idx_tasks_process_node_usage ON tasks(processNodeId,updatedAt,id);
    CREATE INDEX IF NOT EXISTS idx_process_instances_goal_created ON process_instances(goalId,createdAt DESC,id);
    CREATE INDEX IF NOT EXISTS idx_process_instances_task_template ON process_instances(taskTemplateId,createdAt,id);
    CREATE INDEX IF NOT EXISTS idx_process_instances_template ON process_instances(templateId,createdAt,id);
    CREATE INDEX IF NOT EXISTS idx_work_plans_process_type ON work_plans(processInstanceId,workType,id);
  `);
  ensureColumn("product_improvements", "improvementMeasures", "TEXT");
  ensureColumn("product_improvements", "completedAt", "TEXT");
  runProductBusinessExtensionMigration();
  if (tableExists("connection_profiles")) {
    ensureColumn("connection_profiles", "mainImage", "TEXT");
    ensureColumn("connection_profiles", "imageSource", "TEXT");
    ensureColumn("connection_profiles", "level", "TEXT NOT NULL DEFAULT 'new'");
    ensureColumn("connection_profiles", "originSource", "TEXT NOT NULL DEFAULT 'legacy_unknown'");
    ensureColumn("connection_profiles", "originImportBatchId", "TEXT");
    ensureColumn("connection_profiles", "identifiedAt", "TEXT");
    backfillConnectionProfileOrigins();
    migrateLegacyConnectionBenchmarks();
    migrateConnectionProfilesIntoSalesLinksV1();
  }
  backfillBusinessIdentifiers();
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS permission_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      permissions TEXT NOT NULL,
      status TEXT NOT NULL,
      createdAt TEXT,
      updatedAt TEXT
    )
  `);
  ensureStandardWorkValueChainCategories();
  retireLinkCenterLegacyRelationsPhase2();
  retireLinkCenterLegacyStructuresPhase3();
  archiveLinkCenterLegacyStructuresPhase4();
  // Link Center Phase 3 may rebuild sales_links and therefore drops its indexes.
  // Install the lookup indexes only after every table-rebuilding migration.
  ensureSalesDailyIdentityLookupIndexes(getDatabase());
}

function getPermissionTemplateById(templateId) {
  if (templateId === null || templateId === undefined || templateId === "") return null;
  const config = resourceConfigs.permissionTemplates;
  const row = getDatabase()
    .prepare("SELECT * FROM permission_templates WHERE id = @id LIMIT 1")
    .get({ id: templateId });
  return row === undefined ? null : decodeRow(row, config);
}

function resolvePersonPermissionView(person) {
  const role = person.authRole ?? "user";
  if (["admin", "system_admin"].includes(role)) {
    return {
      ...person,
      permissions: normalizePermissions(null, "admin"),
      permissionOverrides: {},
    };
  }
  const template = getPermissionTemplateById(person.permissionTemplateId);
  if (template === null || template.status === "inactive") {
    return {
      ...person,
      permissionOverrides: person.permissionOverrides ?? {},
      permissions: normalizePermissions(person.permissions, role),
    };
  }
  return {
    ...person,
    permissionOverrides: person.permissionOverrides ?? {},
    permissions: mergePermissionSources(template.permissions, person.permissionOverrides, role),
  };
}

function publicUser(row) {
  if (row === undefined) return null;
  const person = resolvePersonPermissionView(decodeRow(row, resourceConfigs.people));
  const role = person.authRole ?? "user";
  return {
    id: person.id,
    name: person.name,
    departmentId: person.departmentId,
    username: person.username,
    avatarUrl: person.avatarUrl ?? "",
    role,
    canLogin: Boolean(person.canLogin),
    mustChangePassword: Boolean(person.mustChangePassword),
    lastLoginAt: person.lastLoginAt ?? null,
    permissions: person.permissions,
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
    assertDatabaseCanOpen(databasePath);
    ensureDataDir();
    db = new Database(databasePath);
  }

  return db;
}

export function initializeDatabase({ reset = false } = {}) {
  if (reset) assertDatabaseResetAllowed(databasePath);
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
  ensureSalesAnomalyActionStandards(database);
  reconcileAllCanceledProcessInstances();
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
        : "";
  const items = getDatabase()
    .prepare(`SELECT ${columns} FROM ${config.table}${orderBy}`)
    .all()
    .map((row) => decodeRow(row, config));
  return resourceKey === "people" ? items.map(resolvePersonPermissionView) : items;
}

export function readResourceItems(resourceKey, ids = []) {
  const config = resourceConfigs[resourceKey];
  if (config === undefined) throw new Error(`Unknown resource: ${resourceKey}`);
  const normalizedIds = [...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean))];
  if (normalizedIds.length === 0) return [];
  const columns = config.columns.join(", ");
  const rows = getDatabase()
    .prepare(`SELECT ${columns} FROM ${config.table} WHERE id IN (${normalizedIds.map(() => "?").join(", ")})`)
    .all(...normalizedIds)
    .map((row) => decodeRow(row, config));
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const ordered = normalizedIds.map((id) => rowById.get(id)).filter(Boolean);
  return resourceKey === "people" ? ordered.map(resolvePersonPermissionView) : ordered;
}

export function readAllData({ exclude = [] } = {}) {
  const excludedResources = new Set(exclude);
  return Object.fromEntries(
    Object.keys(resourceConfigs).map((resourceKey) => [
      resourceKey,
      excludedResources.has(resourceKey) ? [] : readResource(resourceKey),
    ]),
  );
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

function getTaskDurationSnapshotMinutes(task) {
  const dueTime = parseComparableTime(task?.dueDate);
  for (const startValue of [task?.startDate, task?.readyAt]) {
    const startTime = parseComparableTime(startValue);
    if (startTime !== null && dueTime !== null && dueTime > startTime) {
      return Math.max(1, Math.round((dueTime - startTime) / 60000));
    }
  }
  const configuredMinutes = getTaskDurationMinutes(task);
  return configuredMinutes > 0 ? configuredMinutes : null;
}

function resolveTaskWaveUnitDurationMinutes(wave, tasks) {
  const savedMinutes = Number(wave?.unitDurationMinutes);
  if (Number.isInteger(savedMinutes) && savedMinutes > 0) return savedMinutes;
  for (const task of tasks) {
    const taskMinutes = getTaskDurationSnapshotMinutes(task);
    if (taskMinutes !== null) return taskMinutes;
  }
  return null;
}

function getTaskWaveTiming(wave, tasks, referenceAt = new Date().toISOString()) {
  const activeTaskCount = tasks.length;
  const unitDurationMinutes = resolveTaskWaveUnitDurationMinutes(wave, tasks);
  const savedWaveDurationMinutes = Number(wave?.waveDurationMinutes);
  const waveDurationMinutes =
    Number.isInteger(savedWaveDurationMinutes) && savedWaveDurationMinutes > 0
      ? savedWaveDurationMinutes
      : unitDurationMinutes === null
        ? null
        : unitDurationMinutes * activeTaskCount;
  const deadlineAt =
    String(wave?.deadlineAt ?? "").trim() ||
    (String(wave?.startedAt ?? "").trim() !== "" && waveDurationMinutes !== null
      ? addMinutesToBusinessDateTime(wave.startedAt, waveDurationMinutes)
      : null);
  const inferredSubmittedAt = ["pending_acceptance", "done"].includes(wave?.status)
    ? tasks
        .map((task) => String(task?.submittedAt ?? "").trim())
        .filter((value) => parseComparableTime(value) !== null)
        .sort()
        .at(-1) ?? null
    : null;
  const executionEndedAt = String(wave?.submittedAt ?? "").trim() || inferredSubmittedAt;
  const comparisonAt =
    executionEndedAt ??
    (["doing", "pending_acceptance", "done"].includes(wave?.status) ? referenceAt : null);
  const deadlineTime = parseComparableTime(deadlineAt);
  const comparisonTime = parseComparableTime(comparisonAt);
  const executionOverdue =
    deadlineTime !== null && comparisonTime !== null ? comparisonTime > deadlineTime : false;
  const executionOverdueMinutes =
    executionOverdue ? Math.max(0, Math.ceil((comparisonTime - deadlineTime) / 60000)) : 0;
  return {
    unitDurationMinutes,
    waveDurationMinutes,
    deadlineAt,
    submittedAt: executionEndedAt,
    executionOverdue,
    executionOverdueMinutes,
  };
}

function normalizeLinkedTemplateIds(value) {
  let candidate = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      candidate = [];
    }
  }
  if (!Array.isArray(candidate)) return [];
  return [...new Set(candidate.map((item) => String(item ?? "").trim()).filter(Boolean))];
}

function getTaskWaveTemplateBoundaryKey(linkedTemplateIds) {
  const normalizedIds = normalizeLinkedTemplateIds(linkedTemplateIds).sort((left, right) => left.localeCompare(right));
  return normalizedIds.length === 0 ? "none" : normalizedIds.join("\u001e");
}

function getTaskWaveQueueKey(task) {
  return [task.waveTaskTemplateId, task.waveProcessTemplateId, task.processNodeId, task.executorId].join("\u001f");
}

export function splitTaskWaveGroupSizes(taskCount, maxTaskCount = null) {
  const total = Number(taskCount);
  if (!Number.isInteger(total) || total < 2) return [];
  if (maxTaskCount === null || maxTaskCount === undefined) return [total];
  const maximum = Number(maxTaskCount);
  if (!Number.isInteger(maximum) || maximum < 2 || maximum > 100) {
    throw new Error("波次任务数量上限必须是 2—100 的整数，或设置为不限。");
  }
  if (maximum === 2) return Array(Math.floor(total / 2)).fill(2);
  const waveCount = Math.ceil(total / maximum);
  const baseSize = Math.floor(total / waveCount);
  const largerWaveCount = total % waveCount;
  return Array.from({ length: waveCount }, (_, index) => baseSize + (index < largerWaveCount ? 1 : 0));
}

function getTaskWaveSortTime(task) {
  return String(task.readyAt ?? task.startDate ?? task.createdAt ?? task.updatedAt ?? "");
}

function compareTaskWaveCandidates(left, right) {
  return (
    getTaskWaveSortTime(left).localeCompare(getTaskWaveSortTime(right)) ||
    String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")) ||
    String(left.id).localeCompare(String(right.id))
  );
}

function getNextTaskWaveBusinessCode(database, now) {
  const businessDay = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10).replaceAll("-", "");
  const prefix = `WAVE-${businessDay}-`;
  const highestSerial = database
    .prepare("SELECT businessCode FROM task_waves WHERE businessCode LIKE @pattern")
    .all({ pattern: `${prefix}%` })
    .reduce((highest, row) => {
      const serial = String(row.businessCode ?? "").slice(prefix.length);
      return /^\d+$/.test(serial) ? Math.max(highest, Number(serial)) : highest;
    }, 0);
  return `${prefix}${String(highestSerial + 1).padStart(4, "0")}`;
}

function classifyTaskWaveBatch(tasks) {
  const templateGroupKey = getTaskWaveTemplateBoundaryKey(tasks[0]?.linkedTemplateIds);
  return {
    waveType: templateGroupKey === "none" ? "no_template" : "same_template",
    templateGroupKey,
  };
}

const TASK_WAVE_MIN_TASK_COUNT = 2;
const TASK_WAVE_COLLECT_WINDOW_MINUTES = Math.max(
  1,
  Number.parseInt(process.env.TASK_WAVE_COLLECT_WINDOW_MINUTES ?? "30", 10) || 30,
);

function getTaskWaveCollectUntil(createdAt) {
  return new Date(new Date(createdAt).getTime() + TASK_WAVE_COLLECT_WINDOW_MINUTES * 60_000).toISOString();
}

function lockExpiredCollectingTaskWavesInTransaction(database, referenceAt) {
  return database
    .prepare(
      `UPDATE task_waves
       SET acceptingTasks = 0, collectUntil = NULL, lockedAt = @referenceAt, updatedAt = @referenceAt
       WHERE status = 'waiting'
         AND acceptingTasks = 1
         AND collectUntil IS NOT NULL
         AND collectUntil <= @referenceAt`,
    )
    .run({ referenceAt }).changes;
}

function createTaskWaveInTransaction(database, queue, tasks, createdAt) {
  if (tasks.length < TASK_WAVE_MIN_TASK_COUNT) throw new Error("一个任务波次至少需要 2 项任务。");
  if (queue.maxTaskCount !== null && tasks.length > queue.maxTaskCount) {
    throw new Error(`任务波次成员数量不能超过配置上限 ${queue.maxTaskCount}。`);
  }
  const expectedTemplateKey = getTaskWaveTemplateBoundaryKey(tasks[0]?.linkedTemplateIds);
  const invalidTask = tasks.find(
    (task) =>
      task.waveTaskTemplateId !== queue.taskTemplateId ||
      task.waveProcessTemplateId !== queue.processTemplateId ||
      task.processNodeId !== queue.processNodeId ||
      task.executorId !== queue.executorId ||
      getTaskWaveTemplateBoundaryKey(task.linkedTemplateIds) !== expectedTemplateKey,
  );
  if (invalidTask !== undefined) {
    throw new Error("任务波次成员必须属于同一行动标准、流程模板、关联模板、步骤节点和执行人。");
  }
  const { waveType, templateGroupKey } = classifyTaskWaveBatch(tasks);
  const waveId = `task-wave-${crypto.randomUUID()}`;
  const businessCode = getNextTaskWaveBusinessCode(database, new Date(createdAt));
  const unitDurationMinutes = resolveTaskWaveUnitDurationMinutes(null, tasks);
  const reachesMaximum = queue.maxTaskCount !== null && tasks.length >= queue.maxTaskCount;
  const status = "waiting";
  const acceptingTasks = reachesMaximum ? 0 : 1;
  const collectUntil = reachesMaximum ? null : getTaskWaveCollectUntil(createdAt);
  const lockedAt = reachesMaximum ? createdAt : null;
  database
    .prepare(
      `INSERT INTO task_waves (
         id, businessCode, taskTemplateId, processTemplateId, processNodeId, executorId,
         templateGroupKey, waveType, taskCount, status, acceptingTasks, collectUntil, lockedAt,
         unitDurationMinutes, waveDurationMinutes, generationMaxTaskCount, createdAt, updatedAt
       ) VALUES (
         @id, @businessCode, @taskTemplateId, @processTemplateId, @processNodeId, @executorId,
         @templateGroupKey, @waveType, @taskCount, @status, @acceptingTasks, @collectUntil, @lockedAt,
         @unitDurationMinutes, @waveDurationMinutes, @generationMaxTaskCount, @createdAt, @createdAt
       )`,
    )
    .run({
      id: waveId,
      businessCode,
      taskTemplateId: queue.taskTemplateId,
      processTemplateId: queue.processTemplateId,
      processNodeId: queue.processNodeId,
      executorId: queue.executorId,
      templateGroupKey,
      waveType,
      taskCount: tasks.length,
      status,
      acceptingTasks,
      collectUntil,
      lockedAt,
      unitDurationMinutes,
      waveDurationMinutes: unitDurationMinutes === null ? null : unitDurationMinutes * tasks.length,
      generationMaxTaskCount: queue.maxTaskCount,
      createdAt,
    });
  const insertWaveItem = database.prepare(
    `INSERT INTO task_wave_items (
       id, waveId, taskId, processInstanceId, linkedTemplateIds, primaryTemplateId,
       sortOrder, joinedAt, isActive
     ) VALUES (
       @id, @waveId, @taskId, @processInstanceId, @linkedTemplateIds, @primaryTemplateId,
       @sortOrder, @joinedAt, 1
     )`,
  );
  tasks.forEach((task, index) => {
    insertWaveItem.run({
      id: `task-wave-item-${crypto.randomUUID()}`,
      waveId,
      taskId: task.id,
      processInstanceId: task.processInstanceId,
      linkedTemplateIds: JSON.stringify(task.linkedTemplateIds),
      primaryTemplateId: task.primaryTemplateId,
      sortOrder: index + 1,
      joinedAt: createdAt,
    });
  });
  return { id: waveId, businessCode, waveType, templateGroupKey, taskCount: tasks.length, status, acceptingTasks, collectUntil };
}

function appendTasksToCollectingWaveInTransaction(database, wave, tasks, joinedAt) {
  if (tasks.length === 0) return [];
  const currentCount = Number(wave.taskCount);
  const maximum = wave.generationMaxTaskCount === null ? null : Number(wave.generationMaxTaskCount);
  const available = maximum === null ? tasks.length : Math.max(0, maximum - currentCount);
  const selected = tasks.slice(0, available);
  if (selected.length === 0) return [];
  const insertWaveItem = database.prepare(
    `INSERT INTO task_wave_items (
       id, waveId, taskId, processInstanceId, linkedTemplateIds, primaryTemplateId,
       sortOrder, joinedAt, isActive
     ) VALUES (
       @id, @waveId, @taskId, @processInstanceId, @linkedTemplateIds, @primaryTemplateId,
       @sortOrder, @joinedAt, 1
     )`,
  );
  selected.forEach((task, index) => {
    insertWaveItem.run({
      id: `task-wave-item-${crypto.randomUUID()}`,
      waveId: wave.id,
      taskId: task.id,
      processInstanceId: task.processInstanceId,
      linkedTemplateIds: JSON.stringify(task.linkedTemplateIds),
      primaryTemplateId: task.primaryTemplateId,
      sortOrder: currentCount + index + 1,
      joinedAt,
    });
  });
  const taskCount = currentCount + selected.length;
  const reachesMaximum = maximum !== null && taskCount >= maximum;
  database
    .prepare(
      `UPDATE task_waves
       SET taskCount = @taskCount,
           waveDurationMinutes = CASE WHEN unitDurationMinutes IS NULL THEN NULL ELSE unitDurationMinutes * @taskCount END,
           acceptingTasks = CASE WHEN @reachesMaximum = 1 THEN 0 ELSE acceptingTasks END,
           lockedAt = CASE WHEN @reachesMaximum = 1 THEN @joinedAt ELSE lockedAt END,
           collectUntil = CASE WHEN @reachesMaximum = 1 THEN NULL ELSE collectUntil END,
           updatedAt = @joinedAt
       WHERE id = @id AND status = 'waiting' AND acceptingTasks = 1`,
    )
    .run({ id: wave.id, taskCount, reachesMaximum: reachesMaximum ? 1 : 0, joinedAt });
  return selected;
}

function readEligibleTaskWaveCandidates(database, includeWaitingAssigned = false) {
  return database
    .prepare(
      `SELECT
         t.*,
         pi.taskTemplateId AS waveTaskTemplateId,
         pi.templateId AS waveProcessTemplateId,
         pi.customFields AS processInstanceCustomFields,
         ptn.waveSize AS configuredWaveSize,
         ptn.waveUnlimited AS configuredWaveUnlimited
       FROM tasks t
       JOIN process_instances pi ON pi.id = t.processInstanceId
       JOIN process_template_nodes ptn ON ptn.id = t.processNodeId
       JOIN task_templates tt ON tt.id = pi.taskTemplateId
       JOIN process_templates pt ON pt.id = pi.templateId
       LEFT JOIN task_wave_items twi ON twi.taskId = t.id AND twi.isActive = 1
       LEFT JOIN task_waves existingWave ON existingWave.id = twi.waveId
       WHERE t.status = 'todo'
         AND COALESCE(t.processInstanceId, '') <> ''
         AND COALESCE(t.processNodeId, '') <> ''
         AND COALESCE(t.executorId, '') <> ''
         AND COALESCE(t.taskType, 'execution') <> 'review'
         AND COALESCE(ptn.stepType, 'execution') = 'execution'
         AND ptn.waveEnabled = 1
         AND COALESCE(ptn.status, 'active') <> 'deleted'
         AND COALESCE(pi.status, '') NOT IN ('done', 'completed', 'canceled', 'cancelled', 'stopped', 'terminated')
         AND COALESCE(tt.status, 'active') <> 'deleted'
         AND COALESCE(pt.status, 'active') <> 'deleted'
         AND (twi.taskId IS NULL OR (@includeWaitingAssigned = 1 AND existingWave.status IN ('waiting_collect', 'waiting')))`,
    )
    .all({ includeWaitingAssigned: includeWaitingAssigned ? 1 : 0 })
    .map((task) => {
      let customFields = {};
      try {
        customFields = JSON.parse(task.processInstanceCustomFields || "{}");
      } catch {
        customFields = {};
      }
      const linkedTemplateIds = normalizeLinkedTemplateIds(customFields.linkedTemplateIds);
      return {
        ...task,
        linkedTemplateIds,
        primaryTemplateId: linkedTemplateIds[0] ?? null,
        templateBoundaryKey: getTaskWaveTemplateBoundaryKey(linkedTemplateIds),
      };
    })
    .sort(compareTaskWaveCandidates);
}

function buildTaskWaveQueuePlans(candidates) {
  const queues = new Map();
  for (const task of candidates) {
    const queueKey = getTaskWaveQueueKey(task);
    if (!queues.has(queueKey)) {
      queues.set(queueKey, {
        taskTemplateId: task.waveTaskTemplateId,
        processTemplateId: task.waveProcessTemplateId,
        processNodeId: task.processNodeId,
        executorId: task.executorId,
        maxTaskCount: Number(task.configuredWaveUnlimited) !== 0 ? null : Number(task.configuredWaveSize),
        tasks: [],
      });
    }
    queues.get(queueKey).tasks.push(task);
  }

  const plannedWaves = [];
  const plannedTaskIds = new Set();
  for (const queue of queues.values()) {
    if (
      queue.maxTaskCount !== null &&
      (!Number.isInteger(queue.maxTaskCount) || queue.maxTaskCount < 2 || queue.maxTaskCount > 100)
    ) {
      continue;
    }
    const templateGroups = new Map();
    for (const task of queue.tasks) {
      if (!templateGroups.has(task.templateBoundaryKey)) templateGroups.set(task.templateBoundaryKey, []);
      templateGroups.get(task.templateBoundaryKey).push(task);
    }
    for (const groupTasks of templateGroups.values()) {
      const groupSizes = [];
      if (queue.maxTaskCount === null) {
        if (groupTasks.length >= TASK_WAVE_MIN_TASK_COUNT) groupSizes.push(groupTasks.length);
      } else {
        let remaining = groupTasks.length;
        while (remaining >= queue.maxTaskCount) {
          groupSizes.push(queue.maxTaskCount);
          remaining -= queue.maxTaskCount;
        }
        if (remaining >= TASK_WAVE_MIN_TASK_COUNT) groupSizes.push(remaining);
      }
      let offset = 0;
      for (const groupSize of groupSizes) {
        const tasks = groupTasks.slice(offset, offset + groupSize);
        plannedWaves.push({ queue, tasks });
        tasks.forEach((task) => plannedTaskIds.add(task.id));
        offset += groupSize;
      }
    }
  }
  return {
    plannedWaves,
    plannedTaskIds,
    remainingTasks: candidates.filter((task) => !plannedTaskIds.has(task.id)),
  };
}

function appendCandidatesToCollectingWavesInTransaction(database, candidates, referenceAt) {
  const assignedTaskIds = new Set();
  const appendedWaves = [];
  const candidateGroups = new Map();
  for (const task of candidates) {
    const key = `${getTaskWaveQueueKey(task)}\u001f${task.templateBoundaryKey}`;
    if (!candidateGroups.has(key)) candidateGroups.set(key, []);
    candidateGroups.get(key).push(task);
  }
  const collectingWaves = database
    .prepare(
      `SELECT * FROM task_waves
       WHERE status = 'waiting'
         AND acceptingTasks = 1
       ORDER BY createdAt, id`,
    )
    .all();
  for (const wave of collectingWaves) {
    const key = [wave.taskTemplateId, wave.processTemplateId, wave.processNodeId, wave.executorId, wave.templateGroupKey].join("\u001f");
    const availableTasks = candidateGroups.get(key) ?? [];
    if (availableTasks.length === 0) continue;
    const selected = appendTasksToCollectingWaveInTransaction(database, wave, availableTasks, referenceAt);
    if (selected.length === 0) continue;
    selected.forEach((task) => assignedTaskIds.add(task.id));
    candidateGroups.set(key, availableTasks.slice(selected.length));
    appendedWaves.push({ waveId: wave.id, appendedTaskCount: selected.length });
  }
  return { assignedTaskIds, appendedWaves };
}

function generateEligibleTaskWavesInTransaction(database) {
  const createdAt = new Date().toISOString();
  const lockedExpiredCount = lockExpiredCollectingTaskWavesInTransaction(database, createdAt);
  const candidates = readEligibleTaskWaveCandidates(database);
  const appended = appendCandidatesToCollectingWavesInTransaction(database, candidates, createdAt);
  const remainingCandidates = candidates.filter((task) => !appended.assignedTaskIds.has(task.id));
  const plan = buildTaskWaveQueuePlans(remainingCandidates);
  const createdWaves = plan.plannedWaves.map(({ queue, tasks }) =>
    createTaskWaveInTransaction(database, queue, tasks, createdAt),
  );
  return {
    createdCount: createdWaves.length,
    createdWaves,
    candidateCount: candidates.length,
    appendedWaveCount: appended.appendedWaves.length,
    appendedWaves: appended.appendedWaves,
    lockedExpiredCount,
    assignedTaskCount: plan.plannedTaskIds.size + appended.assignedTaskIds.size,
    remainingTaskCount: plan.remainingTasks.length,
    remainingTasks: plan.remainingTasks.map((task) => ({
      taskId: task.id,
      businessCode: task.businessCode ?? "",
      reason: "当前相同行动标准、流程模板、关联模板、步骤和执行人的任务不足 2 项",
    })),
  };
}

export function generateEligibleTaskWaves() {
  const database = getDatabase();
  return database.transaction(() => generateEligibleTaskWavesInTransaction(database)).immediate();
}

function readEnabledTaskWaveGenerationSettings(database) {
  return database
    .prepare(
      `SELECT id AS processNodeId, name AS processNodeName, waveSize, waveUnlimited
       FROM process_template_nodes
       WHERE waveEnabled = 1
         AND COALESCE(stepType, 'execution') = 'execution'
         AND COALESCE(status, 'active') <> 'deleted'
       ORDER BY name, id`,
    )
    .all()
    .map((node) => ({
      processNodeId: node.processNodeId,
      processNodeName: node.processNodeName,
      maxTaskCount: Number(node.waveUnlimited) !== 0 ? null : Number(node.waveSize),
    }));
}

function countEligibleUnassignedWaveTasks(database) {
  return Number(
    database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM tasks t
         JOIN process_instances pi ON pi.id = t.processInstanceId
         JOIN process_template_nodes ptn ON ptn.id = t.processNodeId
         JOIN task_templates tt ON tt.id = pi.taskTemplateId
         JOIN process_templates pt ON pt.id = pi.templateId
         LEFT JOIN task_wave_items twi ON twi.taskId = t.id AND twi.isActive = 1
         WHERE t.status = 'todo'
           AND COALESCE(t.processInstanceId, '') <> ''
           AND COALESCE(t.processNodeId, '') <> ''
           AND COALESCE(t.executorId, '') <> ''
           AND COALESCE(t.taskType, 'execution') <> 'review'
           AND COALESCE(ptn.stepType, 'execution') = 'execution'
           AND ptn.waveEnabled = 1
           AND COALESCE(ptn.status, 'active') <> 'deleted'
           AND COALESCE(pi.status, '') NOT IN ('done', 'completed', 'canceled', 'cancelled', 'stopped', 'terminated')
           AND COALESCE(tt.status, 'active') <> 'deleted'
           AND COALESCE(pt.status, 'active') <> 'deleted'
           AND twi.taskId IS NULL`,
      )
      .get()?.count ?? 0,
  );
}

export function readTaskWaveRegenerationPreview() {
  const database = getDatabase();
  const countStatus = database.prepare("SELECT COUNT(*) AS count FROM task_waves WHERE status = @status");
  const collectingWaveCount = Number(
    database.prepare("SELECT COUNT(*) AS count FROM task_waves WHERE status = 'waiting' AND acceptingTasks = 1").get()?.count ?? 0,
  );
  const waitingWaveCount = Number(countStatus.get({ status: "waiting" })?.count ?? 0);
  const sourceTaskCount = Number(
    database
      .prepare(
        `SELECT COUNT(DISTINCT twi.taskId) AS count
         FROM task_wave_items twi
         JOIN task_waves tw ON tw.id = twi.waveId
         WHERE tw.status IN ('waiting_collect', 'waiting') AND twi.isActive = 1`,
      )
      .get()?.count ?? 0,
  );
  const unassignedNewTaskCount = countEligibleUnassignedWaveTasks(database);
  const regroupCandidates = readEligibleTaskWaveCandidates(database, true);
  const regroupPlan = buildTaskWaveQueuePlans(regroupCandidates);
  const regroupTaskCount = sourceTaskCount + unassignedNewTaskCount;
  const estimatedExcludedTaskCount = Math.max(0, regroupTaskCount - regroupCandidates.length);
  const isRunning =
    database.prepare("SELECT 1 FROM wave_regeneration_runs WHERE status = 'running' LIMIT 1").get() !== undefined;
  return {
    preservedDoneWaveCount: Number(countStatus.get({ status: "done" })?.count ?? 0),
    preservedDoingWaveCount: Number(countStatus.get({ status: "doing" })?.count ?? 0),
    waitingWaveCount,
    collectingWaveCount,
    sourceTaskCount,
    unassignedNewTaskCount,
    regroupTaskCount,
    estimatedWaveCount: regroupPlan.plannedWaves.length,
    estimatedUnassignedTaskCount: regroupPlan.remainingTasks.length + estimatedExcludedTaskCount,
    canRegenerate: !isRunning && (waitingWaveCount > 0 || unassignedNewTaskCount > 0),
    isRunning,
    generationSettings: readEnabledTaskWaveGenerationSettings(database),
  };
}

export function regenerateWaitingTaskWaves(options = {}) {
  const database = getDatabase();
  const createdBy = String(options.userId ?? "").trim();
  if (createdBy === "") throw new Error("无法确认本次重新生成的操作人。");
  const regenerate = database.transaction(() => {
    const now = new Date().toISOString();
    const latestCompleted = database
      .prepare(
        `SELECT completedAt
         FROM wave_regeneration_runs
         WHERE status = 'completed' AND completedAt IS NOT NULL
         ORDER BY completedAt DESC LIMIT 1`,
      )
      .get();
    if (
      latestCompleted?.completedAt &&
      Date.now() - new Date(latestCompleted.completedAt).getTime() < 5000
    ) {
      throw new Error("待执行波次刚刚完成重新生成，请刷新后查看。");
    }
    if (database.prepare("SELECT 1 FROM wave_regeneration_runs WHERE status = 'running' LIMIT 1").get()) {
      throw new Error("任务波次正在重新生成，请稍候。");
    }

    const preview = readTaskWaveRegenerationPreview();
    if (!preview.canRegenerate) throw new Error("当前没有需要重新组合的任务。");
    const waitingWaves = database
      .prepare("SELECT * FROM task_waves WHERE status IN ('waiting_collect', 'waiting') ORDER BY createdAt, id")
      .all();
    const runId = `wave-regeneration-${crypto.randomUUID()}`;
    database
      .prepare(
        `INSERT INTO wave_regeneration_runs (
           id, createdBy, createdAt, status, replacedWaveCount, sourceTaskCount, unassignedNewTaskCount
         ) VALUES (
           @id, @createdBy, @createdAt, 'running', @replacedWaveCount, @sourceTaskCount, @unassignedNewTaskCount
         )`,
      )
      .run({
        id: runId,
        createdBy,
        createdAt: now,
        replacedWaveCount: waitingWaves.length,
        sourceTaskCount: preview.sourceTaskCount,
        unassignedNewTaskCount: preview.unassignedNewTaskCount,
      });

    database
      .prepare(
        `UPDATE task_waves
         SET status = 'superseded',
             supersededAt = @now,
             supersededByGenerationId = @runId,
             supersededByUserId = @createdBy,
             supersedeReason = '重新生成待执行波次',
             updatedAt = @now
         WHERE status IN ('waiting_collect', 'waiting')`,
      )
      .run({ now, runId, createdBy });
    database
      .prepare(
        `UPDATE task_wave_items
         SET isActive = 0, removedAt = @now, removeReason = '重新生成待执行波次', updatedAt = @now
         WHERE isActive = 1
           AND waveId IN (SELECT id FROM task_waves WHERE supersededByGenerationId = @runId)`,
      )
      .run({ now, runId });

    const generated = generateEligibleTaskWavesInTransaction(database);
    const expectedPoolCount = preview.sourceTaskCount + preview.unassignedNewTaskCount;
    const excludedTaskCount = Math.max(0, expectedPoolCount - generated.candidateCount);
    const remainingTaskCount = generated.remainingTaskCount + excludedTaskCount;
    const unassigned = [
      ...generated.remainingTasks,
      ...(excludedTaskCount > 0
        ? [{ taskId: "", businessCode: "", reason: `${excludedTaskCount}项任务当前已不符合正式组波条件` }]
        : []),
    ];
    database
      .prepare(
        `UPDATE wave_regeneration_runs
         SET completedAt = @completedAt,
             status = 'completed',
             generatedWaveCount = @generatedWaveCount,
             remainingTaskCount = @remainingTaskCount,
             generatedWaveIds = @generatedWaveIds
         WHERE id = @id`,
      )
      .run({
        id: runId,
        completedAt: now,
        generatedWaveCount: generated.createdCount,
        remainingTaskCount,
        generatedWaveIds: JSON.stringify(generated.createdWaves.map((wave) => wave.id)),
      });
    return {
      runId,
      ...preview,
      replacedWaveCount: waitingWaves.length,
      regroupTaskCount: expectedPoolCount,
      generatedWaveCount: generated.createdCount,
      generatedWaves: generated.createdWaves,
      remainingTaskCount,
      unassigned,
    };
  });
  try {
    return regenerate.immediate();
  } catch (error) {
    const failedAt = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO wave_regeneration_runs (
           id, createdBy, createdAt, completedAt, status, errorSummary
         ) VALUES (
           @id, @createdBy, @createdAt, @completedAt, 'failed', @errorSummary
         )`,
      )
      .run({
        id: `wave-regeneration-${crypto.randomUUID()}`,
        createdBy,
        createdAt: failedAt,
        completedAt: failedAt,
        errorSummary: String(error?.message ?? "重新生成失败"),
      });
    throw error;
  }
}

function getTaskWaveSupersessionInfo(database, wave) {
  if (wave?.status !== "superseded" || !wave.supersededByGenerationId) return null;
  const run = database
    .prepare("SELECT * FROM wave_regeneration_runs WHERE id = @id LIMIT 1")
    .get({ id: wave.supersededByGenerationId });
  if (run === undefined) return null;
  let generatedWaveIds = [];
  try {
    generatedWaveIds = JSON.parse(run.generatedWaveIds || "[]");
  } catch {
    generatedWaveIds = [];
  }
  const generatedWaveCodes =
    generatedWaveIds.length === 0
      ? []
      : database
          .prepare(`SELECT businessCode FROM task_waves WHERE id IN (${generatedWaveIds.map(() => "?").join(", ")}) ORDER BY businessCode`)
          .all(...generatedWaveIds)
          .map((item) => item.businessCode);
  return { runId: run.id, createdAt: run.createdAt, generatedWaveCodes };
}

export function readTaskWavesForTaskIds(taskIds = []) {
  const visibleTaskIds = [...new Set(taskIds.map((id) => String(id ?? "").trim()).filter(Boolean))];
  if (visibleTaskIds.length === 0) return [];
  const visibleTaskIdSet = new Set(visibleTaskIds);
  const placeholders = visibleTaskIds.map(() => "?").join(", ");
  const waves = getDatabase()
    .prepare(
      `SELECT DISTINCT tw.*
       FROM task_waves tw
       JOIN task_wave_items twi ON twi.waveId = tw.id
        AND (twi.isActive = 1 OR tw.status = 'superseded')
       WHERE twi.taskId IN (${placeholders})
       ORDER BY tw.createdAt DESC, tw.id DESC`,
    )
    .all(...visibleTaskIds);
  const readTaskIds = getDatabase().prepare(
    `SELECT taskId
     FROM task_wave_items
     WHERE waveId = @waveId
       AND (isActive = 1 OR @includeHistory = 1)
     ORDER BY sortOrder, id`,
  );
  const database = getDatabase();
  return waves.map((wave) => {
    const taskIds = readTaskIds
      .all({ waveId: wave.id, includeHistory: wave.status === "superseded" ? 1 : 0 })
      .map((item) => item.taskId);
    const tasks = taskIds
      .filter((taskId) => visibleTaskIdSet.has(taskId))
      .map((taskId) => readExistingItem("tasks", taskId))
      .filter(Boolean);
    return {
      ...wave,
      ...getTaskWaveTiming(wave, tasks),
      taskIds,
      tasks,
      supersession: getTaskWaveSupersessionInfo(database, wave),
    };
  });
}

export function readTaskWaveDetailForTaskIds(waveId, taskIds = []) {
  const visibleTaskIds = new Set(taskIds.map((id) => String(id ?? "").trim()).filter(Boolean));
  if (visibleTaskIds.size === 0) return null;
  const wave = getDatabase().prepare("SELECT * FROM task_waves WHERE id = @id LIMIT 1").get({ id: waveId });
  if (wave === undefined) return null;
  const allItems = getDatabase()
    .prepare(
      `SELECT *
       FROM task_wave_items
       WHERE waveId = @waveId
         AND (isActive = 1 OR @includeHistory = 1)
       ORDER BY sortOrder, id`,
    )
    .all({ waveId, includeHistory: wave.status === "superseded" ? 1 : 0 })
    .map((item) => {
      let resultDraft = {};
      try {
        resultDraft = JSON.parse(item.resultDraft || "{}");
      } catch {
        resultDraft = {};
      }
      return { ...item, linkedTemplateIds: normalizeLinkedTemplateIds(item.linkedTemplateIds), resultDraft };
    });
  const items = allItems.filter((item) => visibleTaskIds.has(item.taskId));
  if (items.length === 0) return null;
  const timingTasks = allItems.map((item) => readExistingItem("tasks", item.taskId)).filter(Boolean);
  const tasks = items.map((item) => readExistingItem("tasks", item.taskId)).filter(Boolean);
  return {
    ...wave,
    ...getTaskWaveTiming(wave, timingTasks),
    items,
    tasks,
    supersession: getTaskWaveSupersessionInfo(getDatabase(), wave),
  };
}

const activeTaskWaveStatuses = new Set(["waiting_collect", "waiting", "doing", "pending_acceptance"]);

function readActiveTaskWaveForTask(taskId) {
  return getDatabase()
    .prepare(
      `SELECT tw.id, tw.businessCode, tw.status, tw.executorId
       FROM task_wave_items twi
       JOIN task_waves tw ON tw.id = twi.waveId
       WHERE twi.taskId = @taskId
         AND twi.isActive = 1
         AND tw.status IN ('waiting_collect', 'waiting', 'doing', 'pending_acceptance')
       LIMIT 1`,
    )
    .get({ taskId }) ?? null;
}

function ensureTaskIsNotLockedByWave(taskId, operationName) {
  const wave = readActiveTaskWaveForTask(taskId);
  if (wave !== null) throw new Error(`任务已加入波次 ${wave.businessCode}，请在任务波次中${operationName}。`);
}

function readTaskWaveForOperation(database, waveId) {
  const wave = database.prepare("SELECT * FROM task_waves WHERE id = @id LIMIT 1").get({ id: waveId });
  if (wave === undefined) throw new Error("未找到任务波次。");
  const items = database
    .prepare("SELECT * FROM task_wave_items WHERE waveId = @waveId AND isActive = 1 ORDER BY sortOrder, id")
    .all({ waveId })
    .map((item) => {
      let resultDraft = {};
      try {
        resultDraft = JSON.parse(item.resultDraft || "{}");
      } catch {
        resultDraft = {};
      }
      return { ...item, resultDraft };
    });
  if (items.length === 0) throw new Error("任务波次没有有效成员。");
  const tasks = items.map((item) => {
    const task = readExistingItem("tasks", item.taskId);
    if (task === null) throw new Error(`波次成员任务不存在：${item.taskId}`);
    return task;
  });
  return { wave, items, tasks };
}

function ensureTaskWaveOperationPermission(wave, options = {}, managementOnly = false) {
  if (options.canManage === true) return;
  if (managementOnly) throw new Error("你没有权限取消任务波次。");
  if (String(options.userId ?? "") === "" || wave.executorId !== options.userId) {
    throw new Error("只有波次执行人或任务管理人员可以执行该操作。");
  }
}

function refreshTaskWaveStatusInTransaction(database, waveId, referenceAt = new Date().toISOString()) {
  const wave = database.prepare("SELECT * FROM task_waves WHERE id = @id LIMIT 1").get({ id: waveId });
  if (wave === undefined || wave.status === "canceled") return wave ?? null;
  const statuses = database
    .prepare(
      `SELECT t.status
       FROM task_wave_items twi
       JOIN tasks t ON t.id = twi.taskId
       WHERE twi.waveId = @waveId AND twi.isActive = 1`,
    )
    .all({ waveId })
    .map((row) => row.status);
  if (statuses.length === 0) return wave;
  let status = wave.status;
  if (statuses.every((item) => item === "done")) status = "done";
  else if (statuses.some((item) => item === "doing")) status = "doing";
  else if (statuses.some((item) => item === "pending_acceptance")) status = "pending_acceptance";
  else if (statuses.every((item) => item === "todo")) status = "waiting";
  const completedAt = status === "done" ? wave.completedAt ?? referenceAt : null;
  database
    .prepare("UPDATE task_waves SET status = @status, completedAt = @completedAt, updatedAt = @updatedAt WHERE id = @id")
    .run({ id: waveId, status, completedAt, updatedAt: referenceAt });
  return database.prepare("SELECT * FROM task_waves WHERE id = @id").get({ id: waveId });
}

export function refreshTaskWaveStatusForTask(taskId) {
  const database = getDatabase();
  const wave = readActiveTaskWaveForTask(taskId);
  if (wave === null) return null;
  return refreshTaskWaveStatusInTransaction(database, wave.id);
}

function normalizeTaskWaveDraft(value) {
  const draft = value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    resultText: String(draft.resultText ?? ""),
    submitFormData:
      draft.submitFormData !== null && typeof draft.submitFormData === "object" && !Array.isArray(draft.submitFormData)
        ? draft.submitFormData
        : {},
    submitFiles: Array.isArray(draft.submitFiles) ? draft.submitFiles : [],
    submitLinks: Array.isArray(draft.submitLinks) ? draft.submitLinks.map((item) => String(item ?? "").trim()).filter(Boolean) : [],
  };
}

export function startTaskWave(waveId, options = {}) {
  const database = getDatabase();
  return database.transaction(() => {
    const { wave, items, tasks } = readTaskWaveForOperation(database, waveId);
    ensureTaskWaveOperationPermission(wave, options);
    if (wave.status !== "waiting") throw new Error("只有待执行波次可以开始。");
    if (items.length !== Number(wave.taskCount)) throw new Error("波次成员数量已变化，不能开始。");
    for (const task of tasks) {
      if (task.status !== "todo") throw new Error(`${task.name} 当前不是待执行状态，波次不能开始。`);
      if (task.executorId !== wave.executorId) throw new Error(`${task.name} 的执行人已变化，波次不能开始。`);
    }
    const now = new Date().toISOString();
    const unitDurationMinutes = resolveTaskWaveUnitDurationMinutes(wave, tasks);
    if (unitDurationMinutes === null) throw new Error("该步骤未设置有效执行时限，无法开始波次");
    const waveDurationMinutes = unitDurationMinutes * items.length;
    const deadlineAt = new Date(new Date(now).getTime() + waveDurationMinutes * 60000).toISOString();
    for (const task of tasks) {
      insertItem("tasks", { ...task, status: "doing", startDate: task.startDate ?? now, updatedAt: now });
    }
    database
      .prepare(
        `UPDATE task_waves
         SET status = 'doing',
             acceptingTasks = 0,
             collectUntil = NULL,
             lockedAt = @now,
             startedAt = @now,
             unitDurationMinutes = @unitDurationMinutes,
             waveDurationMinutes = @waveDurationMinutes,
             deadlineAt = @deadlineAt,
             updatedAt = @now
         WHERE id = @id`,
      )
      .run({ id: wave.id, now, unitDurationMinutes, waveDurationMinutes, deadlineAt });
    return database.prepare("SELECT * FROM task_waves WHERE id = @id").get({ id: wave.id });
  }).immediate();
}

export function saveTaskWaveDraft(waveId, drafts = [], options = {}) {
  const database = getDatabase();
  return database.transaction(() => {
    const { wave, items } = readTaskWaveForOperation(database, waveId);
    ensureTaskWaveOperationPermission(wave, options);
    if (!["doing", "pending_acceptance"].includes(wave.status)) throw new Error("当前波次不能保存工作结果草稿。");
    const itemByTaskId = new Map(items.map((item) => [item.taskId, item]));
    const now = new Date().toISOString();
    for (const entry of Array.isArray(drafts) ? drafts : []) {
      const taskId = String(entry?.taskId ?? "").trim();
      if (!itemByTaskId.has(taskId)) throw new Error(`任务 ${taskId} 不属于当前波次。`);
      database
        .prepare("UPDATE task_wave_items SET resultDraft = @resultDraft, updatedAt = @updatedAt WHERE waveId = @waveId AND taskId = @taskId AND isActive = 1")
        .run({ waveId, taskId, resultDraft: JSON.stringify(normalizeTaskWaveDraft(entry?.resultDraft)), updatedAt: now });
    }
    return { updatedAt: now, updatedCount: (Array.isArray(drafts) ? drafts : []).length };
  }).immediate();
}

function taskWaitsForReviewStep(task) {
  const orderedTasks = getOrderedProcessInstanceTasks(task.processInstanceId);
  const index = orderedTasks.findIndex((item) => item.id === task.id);
  const nextTask = orderedTasks[index + 1];
  return nextTask?.taskType === "review" && nextTask.reviewTargetTaskId === task.id;
}

export function submitTaskWave(waveId, drafts = [], options = {}) {
  const database = getDatabase();
  return database.transaction(() => {
    const { wave, items, tasks } = readTaskWaveForOperation(database, waveId);
    ensureTaskWaveOperationPermission(wave, options);
    if (wave.status !== "doing") throw new Error("只有执行中的波次可以提交。");
    if (items.length !== Number(wave.taskCount)) throw new Error("波次成员数量已变化，不能提交。");
    const incomingDrafts = new Map(
      (Array.isArray(drafts) ? drafts : []).map((entry) => [String(entry?.taskId ?? "").trim(), normalizeTaskWaveDraft(entry?.resultDraft)]),
    );
    const now = new Date().toISOString();
    const submissions = [];
    for (let index = 0; index < tasks.length; index += 1) {
      const task = tasks[index];
      if (task.executorId !== wave.executorId) throw new Error(`${task.name} 的执行人已变化，波次不能提交。`);
      if (["done", "pending_acceptance"].includes(task.status)) continue;
      if (task.status !== "doing") throw new Error(`${task.name} 当前不是执行中状态，波次不能提交。`);
      const draft = incomingDrafts.get(task.id) ?? normalizeTaskWaveDraft(items[index].resultDraft);
      const candidate = {
        ...task,
        ...draft,
        resultAttachments: draft.submitFiles,
      };
      const validationError = validateTaskSubmission(candidate);
      if (validationError !== "") throw new Error(`${task.businessCode || task.name}：${validationError}。`);
      submissions.push({ task, draft, candidate });
    }
    if (submissions.length === 0) throw new Error("当前波次没有需要重新提交的任务。");

    const affectedProcessInstanceIds = new Set();
    for (const { task, draft, candidate } of submissions) {
      const nextStatus = task.needAcceptance || taskWaitsForReviewStep(task) ? "pending_acceptance" : "done";
      const previousSubmission =
        task.submittedAt
          ? {
              submittedAt: task.submittedAt,
              submittedBy: task.submittedBy ?? null,
              resultText: task.resultText ?? "",
              resultAttachments: task.resultAttachments ?? [],
              submitFormData: task.submitFormData ?? {},
              submitFiles: task.submitFiles ?? [],
              submitLinks: task.submitLinks ?? [],
            }
          : null;
      const customFields = {
        ...(task.customFields ?? {}),
        ...(previousSubmission === null
          ? {}
          : {
              submissionVersions: [
                ...(Array.isArray(task.customFields?.submissionVersions) ? task.customFields.submissionVersions : []),
                previousSubmission,
              ],
            }),
      };
      insertItem("tasks", {
        ...candidate,
        customFields,
        submittedAt: now,
        submittedBy: options.userId,
        status: nextStatus,
        completedAt: nextStatus === "done" ? now : null,
        updatedAt: now,
      });
      database
        .prepare(
          `UPDATE task_wave_items
           SET resultDraft = @resultDraft, updatedAt = @updatedAt, submittedAt = @submittedAt
           WHERE waveId = @waveId AND taskId = @taskId AND isActive = 1`,
        )
        .run({ waveId, taskId: task.id, resultDraft: JSON.stringify(draft), updatedAt: now, submittedAt: now });
      affectedProcessInstanceIds.add(task.processInstanceId);
    }
    for (const processInstanceId of affectedProcessInstanceIds) {
      refreshProcessTaskReadinessInTransaction(processInstanceId, now);
    }
    database
      .prepare("UPDATE task_waves SET submittedAt = @submittedAt, updatedAt = @submittedAt WHERE id = @id")
      .run({ id: wave.id, submittedAt: now });
    const updatedWave = refreshTaskWaveStatusInTransaction(database, wave.id, now);
    return {
      wave: { ...updatedWave, ...getTaskWaveTiming({ ...updatedWave, submittedAt: now }, tasks, now) },
      submittedTaskIds: submissions.map((item) => item.task.id),
    };
  }).immediate();
}

export function cancelTaskWave(waveId, cancelReason, options = {}) {
  const database = getDatabase();
  return database.transaction(() => {
    const { wave, tasks } = readTaskWaveForOperation(database, waveId);
    ensureTaskWaveOperationPermission(wave, options, true);
    if (wave.status !== "waiting") throw new Error("只有待执行波次可以取消。");
    const reason = String(cancelReason ?? "").trim();
    if (reason === "") throw new Error("请填写取消原因。");
    if (tasks.some((task) => task.status !== "todo")) throw new Error("波次成员状态已变化，不能取消。");
    const now = new Date().toISOString();
    database
      .prepare("UPDATE task_waves SET status = 'canceled', canceledAt = @now, cancelReason = @reason, updatedAt = @now WHERE id = @id")
      .run({ id: wave.id, now, reason });
    database
      .prepare(
        `UPDATE task_wave_items
         SET isActive = 0, removedAt = @now, removeReason = '波次取消', updatedAt = @now
         WHERE waveId = @waveId AND isActive = 1`,
      )
      .run({ waveId, now });
    return database.prepare("SELECT * FROM task_waves WHERE id = @id").get({ id: wave.id });
  }).immediate();
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
  const submitError = validateTaskSubmission(task);
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
    const canceledProcessInstanceIds = [];
    const changedTaskIds = [];

    for (const selectedTask of sortedTasks) {
      let task = readExistingItem("tasks", selectedTask.id);
      if (task === null) throw new Error(`未找到任务：${selectedTask.id}`);
      ensureTaskIsNotLockedByWave(task.id, status === "done" ? "完成任务" : "取消任务");
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
    } else {
      for (const processInstanceId of affectedProcessInstanceIds) {
        const canceled = syncProcessInstanceCanceledFromTasksInTransaction(
          database,
          processInstanceId,
          now,
          "系统自动同步：所有未完成步骤已取消",
        );
        if (canceled) canceledProcessInstanceIds.push(processInstanceId);
      }
    }

    return {
      status,
      taskIds,
      changedTaskIds,
      canceledProcessInstanceIds,
      updatedAt: now,
    };
  });
  const result = updateBatch();
  generateEligibleTaskWaves();
  return result;
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
    return normalizePermissions(person.permissions, person.authRole).permissions.manage === true;
  }).length;
  if (permissionAdminCount < 1) throw new Error("系统至少需要保留一个权限管理员。");

  const replace = database.transaction(() => {
    database.prepare("DELETE FROM assistant_device_sessions").run();
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

function syncProcessInstanceCanceledFromTasksInTransaction(database, instanceId, updatedAt, cancelReason) {
  const instance = database
    .prepare("SELECT id, status FROM process_instances WHERE id = @id LIMIT 1")
    .get({ id: instanceId });
  if (instance === undefined || ["done", "completed", "canceled", "cancelled", "stopped", "terminated"].includes(instance.status)) {
    return false;
  }

  const taskCounts = database.prepare(`
    SELECT
      COUNT(*) AS totalCount,
      SUM(CASE WHEN status IN ('canceled', 'cancelled') THEN 1 ELSE 0 END) AS canceledCount,
      SUM(CASE WHEN status IN ('done', 'completed', 'canceled', 'cancelled') THEN 1 ELSE 0 END) AS terminalCount
    FROM tasks
    WHERE processInstanceId = @instanceId
  `).get({ instanceId });
  const totalCount = Number(taskCounts?.totalCount ?? 0);
  const canceledCount = Number(taskCounts?.canceledCount ?? 0);
  const terminalCount = Number(taskCounts?.terminalCount ?? 0);
  if (totalCount === 0 || canceledCount === 0 || terminalCount !== totalCount) return false;

  database.prepare(`
    UPDATE process_instances
    SET status = 'canceled',
        canceledAt = COALESCE(canceledAt, @updatedAt),
        cancelReason = COALESCE(NULLIF(cancelReason, ''), @cancelReason),
        updatedAt = @updatedAt
    WHERE id = @instanceId
  `).run({ instanceId, updatedAt, cancelReason });
  database.prepare(`
    UPDATE work_plans
    SET status = 'canceled',
        canceledAt = COALESCE(canceledAt, @updatedAt),
        updatedAt = @updatedAt
    WHERE processInstanceId = @instanceId
      AND status <> 'canceled'
  `).run({ instanceId, updatedAt });
  return true;
}

export function syncProcessInstanceCanceledFromTasks(instanceId, options = {}) {
  const normalizedInstanceId = String(instanceId ?? "").trim();
  if (normalizedInstanceId === "") return false;
  const updatedAt = options.updatedAt || new Date().toISOString();
  const cancelReason = String(options.cancelReason ?? "").trim() || "系统自动同步：所有未完成步骤已取消";
  return syncProcessInstanceCanceledFromTasksInTransaction(
    getDatabase(),
    normalizedInstanceId,
    updatedAt,
    cancelReason,
  );
}

export function reconcileAllCanceledProcessInstances(options = {}) {
  const database = getDatabase();
  const updatedAt = options.updatedAt || new Date().toISOString();
  const cancelReason = String(options.cancelReason ?? "").trim() || "系统自动修复：所有未完成步骤已取消";
  return database.transaction(() => {
    const instanceIds = database.prepare(`
      SELECT pi.id
      FROM process_instances pi
      WHERE pi.status NOT IN ('done', 'completed', 'canceled', 'cancelled', 'stopped', 'terminated')
        AND EXISTS (
          SELECT 1
          FROM tasks t
          WHERE t.processInstanceId = pi.id
            AND t.status IN ('canceled', 'cancelled')
        )
        AND NOT EXISTS (
          SELECT 1
          FROM tasks t
          WHERE t.processInstanceId = pi.id
            AND t.status NOT IN ('done', 'completed', 'canceled', 'cancelled')
        )
      ORDER BY pi.id
    `).all().map((row) => row.id);
    const repairedInstanceIds = instanceIds.filter((targetInstanceId) =>
      syncProcessInstanceCanceledFromTasksInTransaction(
        database,
        targetInstanceId,
        updatedAt,
        cancelReason,
      ),
    );
    return {
      candidateCount: instanceIds.length,
      repairedCount: repairedInstanceIds.length,
      repairedInstanceIds,
    };
  }).immediate();
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
    const actionStandardId = instance.taskTemplateId ?? instance.standardWorkId ?? "";
    const actionStandard = actionStandardId === "" ? null : readExistingItem("taskTemplates", actionStandardId);
    const processOwnerId = String(instance.ownerId ?? actionStandard?.ownerId ?? "").trim();
    const canStart =
      isAdmin === true ||
      (normalizedUserId !== "" && [instance.initiatorId, processOwnerId].includes(normalizedUserId));
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

export function launchWorkPlanWithProcess(
  workPlanId,
  { processInstance, tasks: generatedTasks = [], workPlan: launchedWorkPlan, productIds = [], initiatorId = "" },
) {
  const database = getDatabase();
  const trustedInitiatorId = String(initiatorId ?? "").trim();
  const trustedInitiator =
    trustedInitiatorId === ""
      ? null
      : readExistingItem("people", trustedInitiatorId);
  if (trustedInitiator === null || trustedInitiator.status === "inactive") {
    throw new Error("无法确认有效的实际发起人，请重新登录后再试。");
  }
  const existingWorkPlan = readExistingItem("workPlans", workPlanId);
  const incomingWorkPlan = launchedWorkPlan?.id === workPlanId ? launchedWorkPlan : null;
  const baseWorkPlan =
    existingWorkPlan ??
    (incomingWorkPlan === null
      ? null
      : { ...incomingWorkPlan, status: "future", processInstanceId: null, launchedAt: null });
  if (baseWorkPlan === null) throw new Error("未找到该待发起工作计划。");
  if (baseWorkPlan.processInstanceId || baseWorkPlan.status === "launched") throw new Error("该工作已经发起，不能重复发起。");
  if (!["future", "this_week"].includes(baseWorkPlan.status)) throw new Error("只有待发起工作计划可以发起。");
  if (!processInstance?.id) throw new Error("缺少已发起关键行动数据。");
  if (!Array.isArray(generatedTasks) || generatedTasks.length === 0) throw new Error("缺少标准步骤任务。");
  if (generatedTasks.some((task) => task.processInstanceId !== processInstance.id)) throw new Error("任务与已发起关键行动不匹配。");

  const now = new Date().toISOString();
  const nextProcessInstance = {
    ...processInstance,
    initiatorId: trustedInitiatorId,
    startedAt: null,
    dueDate: launchedWorkPlan?.dueDate ?? baseWorkPlan.dueDate ?? processInstance.dueDate ?? null,
    updatedAt: now,
  };
  const nextTasks = generatedTasks.map((task, index) => {
    const processNode = task.processNodeId
      ? readExistingItem("processTemplateNodes", task.processNodeId)
      : null;
    const configuredExecutorId = String(processNode?.executorId ?? "").trim();
    const fixedOwnerId =
      String(processNode?.ownerId ?? "").trim() ||
      (processNode?.ownerRule === "fixed_person" ? String(processNode?.defaultOwnerId ?? "").trim() : "");
    const executorId =
      configuredExecutorId === "initiator"
        ? trustedInitiatorId
        : configuredExecutorId || String(task.executorId ?? "").trim() || fixedOwnerId;
    if (executorId === "initiator") {
      throw new Error(`标准步骤“${task.name ?? ""}”的同发起人执行规则解析失败。`);
    }
    if ((task.taskType ?? "execution") === "execution") {
      const executor = executorId === "" ? null : readExistingItem("people", executorId);
      if (executor === null || executor.status === "inactive") {
        throw new Error(`标准步骤“${task.name ?? ""}”未能解析有效执行人，请先完善步骤配置。`);
      }
    }
    return {
      ...task,
      executorId,
      initiatorId: trustedInitiatorId,
      status: index === 0 ? "todo" : "waiting",
      readyAt: index === 0 ? now : null,
      startDate: null,
      dueDate: null,
      plannedWeek: null,
      updatedAt: now,
    };
  });
  const nextWorkPlan = {
    ...baseWorkPlan,
    ...(launchedWorkPlan ?? {}),
    id: workPlanId,
    workType: launchedWorkPlan?.workType ?? baseWorkPlan.workType ?? "normal",
    status: "launched",
    processInstanceId: processInstance.id,
    dueDate: launchedWorkPlan?.dueDate ?? baseWorkPlan.dueDate ?? processInstance.dueDate ?? null,
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
    for (const task of nextTasks) insertItem("tasks", task);
    insertItem("workPlans", nextWorkPlan);
    replaceActionProductsInTransaction(nextProcessInstance.id, productIds, now);
  });
  launch();
  generateEligibleTaskWaves();

  return { instance: nextProcessInstance, workPlan: nextWorkPlan, tasks: nextTasks };
}

function normalizeBatchDedupePart(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeBatchProductKey(productIds = []) {
  return [...new Set((Array.isArray(productIds) ? productIds : []).map(normalizeBatchDedupePart).filter(Boolean))]
    .sort()
    .join("|");
}

function buildBatchLaunchDedupeKey(dedupe = {}) {
  const parts = [
    dedupe.taskTemplateId,
    dedupe.goalId,
    dedupe.productKey ?? normalizeBatchProductKey(dedupe.productIds ?? (dedupe.productId ? [dedupe.productId] : [])),
    dedupe.templateId,
    dedupe.publishDate,
    dedupe.account,
    dedupe.contentTitle,
  ].map(normalizeBatchDedupePart);
  parts.push(parts.slice(2).every((value) => value === "") ? normalizeBatchDedupePart(dedupe.actionName) : "");
  return parts.join("|");
}

function hasExistingBatchLaunchDuplicate(dedupe = {}) {
  const taskTemplateId = String(dedupe.taskTemplateId ?? "").trim();
  const goalId = String(dedupe.goalId ?? "").trim();
  if (taskTemplateId === "" || goalId === "") return false;

  const database = getDatabase();
  const candidates = database
    .prepare(
      `SELECT wp.title, wp.customFields, wp.processInstanceId
       FROM work_plans wp
       WHERE wp.taskTemplateId = @taskTemplateId
         AND wp.goalId = @goalId
         AND COALESCE(wp.status, '') <> 'canceled'`,
    )
    .all({ taskTemplateId, goalId });
  const expectedKey = buildBatchLaunchDedupeKey(dedupe);
  return candidates.some((candidate) => {
    let fields = {};
    try {
      fields = JSON.parse(candidate.customFields || "{}");
    } catch {
      return false;
    }
    const productIds = database
      .prepare("SELECT productId FROM action_products WHERE actionId = @actionId ORDER BY productId")
      .all({ actionId: candidate.processInstanceId })
      .map((item) => item.productId);
    const templateId = Array.isArray(fields.linkedTemplateIds) ? fields.linkedTemplateIds[0] ?? "" : "";
    return buildBatchLaunchDedupeKey({
      taskTemplateId,
      goalId,
      productIds,
      templateId,
      publishDate: fields[dedupe.publishDateFieldId] ?? fields.publishDate ?? "",
      account: fields[dedupe.accountFieldId] ?? fields.account ?? "",
      contentTitle: fields[dedupe.contentTitleFieldId] ?? fields.title ?? "",
      actionName: candidate.title ?? "",
    }) === expectedKey;
  });
}

export function batchLaunchWorkPlans(rows = [], { userId = "" } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("没有可批量发起的有效数据。");
  if (rows.length > 200) throw new Error("单次最多批量发起 200 条关键行动。");

  const results = [];
  for (const row of rows) {
    const rowNumber = Number(row?.rowNumber) || null;
    try {
      const workPlan = row?.workPlan ?? {};
      const processInstance = row?.processInstance ?? {};
      const taskTemplate = readExistingItem("taskTemplates", workPlan.taskTemplateId);
      if (taskTemplate === null || taskTemplate.id !== "task-template-publish-content-note" || taskTemplate.status !== "active") {
        throw new Error("批量发起只能使用启用的“发布内容笔记”行动标准。");
      }
      if (
        !taskTemplate.defaultProcessTemplateId ||
        processInstance.templateId !== taskTemplate.defaultProcessTemplateId
      ) {
        throw new Error("发布内容笔记默认流程无效或与行动标准不一致。");
      }
      if (!readExistingItem("goals", workPlan.goalId)) throw new Error("对齐目标不存在。");
      const productIds = Array.isArray(row.productIds) ? [...new Set(row.productIds.filter(Boolean))] : [];
      const linkedTemplateIds = Array.isArray(workPlan.customFields?.linkedTemplateIds)
        ? [...new Set(workPlan.customFields.linkedTemplateIds.filter(Boolean))]
        : [];
      if (linkedTemplateIds.length > 1) throw new Error("每行最多关联一个模板。");
      if (linkedTemplateIds.length === 1) {
        const linkedTemplate = readExistingItem("templates", linkedTemplateIds[0]);
        if (linkedTemplate === null) throw new Error("关联模板不存在。");
        const platformTags = Array.isArray(linkedTemplate.tags?.platform) ? linkedTemplate.tags.platform : [];
        const usageTags = Array.isArray(linkedTemplate.tags?.usage) ? linkedTemplate.tags.usage : [];
        if (!platformTags.includes("小红书") || !usageTags.includes("笔记")) {
          throw new Error("关联模板不是可用于发布内容笔记的小红书笔记模板。");
        }
      }
      const dedupeProductIds = row.dedupe?.productIds ?? (row.dedupe?.productId ? [row.dedupe.productId] : []);
      if (normalizeBatchProductKey(dedupeProductIds) !== normalizeBatchProductKey(productIds)) {
        throw new Error("产品关联与重复判断数据不一致。");
      }
      if (normalizeBatchDedupePart(row.dedupe?.templateId) !== normalizeBatchDedupePart(linkedTemplateIds[0] ?? "")) {
        throw new Error("模板关联与重复判断数据不一致。");
      }
      if (hasExistingBatchLaunchDuplicate(row.dedupe) && row.forceDuplicate !== true) {
        results.push({ rowNumber, status: "skipped_duplicate", message: "数据库中已存在相同发布内容笔记。" });
        continue;
      }
      const now = new Date().toISOString();
      const auditFields = {
        ...(workPlan.customFields ?? {}),
        batchLaunchAudit: {
          importedAt: now,
          importedBy: String(userId ?? ""),
          rowNumber,
          forcedDuplicate: row.forceDuplicate === true,
        },
      };
      const launched = launchWorkPlanWithProcess(workPlan.id, {
        processInstance: { ...processInstance, customFields: auditFields },
        tasks: row.tasks,
        workPlan: { ...workPlan, customFields: auditFields },
        productIds,
        initiatorId: userId,
      });
      const savedInstance = readExistingItem("processInstances", launched.instance.id);
      results.push({
        rowNumber,
        status: "success",
        workPlanId: launched.workPlan.id,
        processInstanceId: launched.instance.id,
        businessCode: savedInstance?.businessCode ?? null,
        taskCount: launched.tasks.length,
        productLinked: productIds.length > 0,
        productCount: productIds.length,
        templateLinked: linkedTemplateIds.length === 1,
      });
    } catch (error) {
      results.push({ rowNumber, status: "failed", message: error.message || "批量发起失败。" });
    }
  }
  return results;
}

export function createResource(routeResource, item) {
  const resourceKey = routeResourceMap[routeResource];
  if (resourceKey === undefined) throw new Error(`Unknown resource: ${routeResource}`);
  if (resourceKey === "processTemplateNodes") item = normalizeAndValidateProcessTemplateNodeWave(item);
  if (resourceKey === "tasks" && item?.status === "todo" && !item?.readyAt) {
    item = { ...item, readyAt: item.createdAt ?? new Date().toISOString() };
  }
  if (resourceKey === "permissionTemplates") {
    const name = String(item.name ?? "").trim();
    if (name === "") throw new Error("权限模板名称不能为空。");
    const duplicated = getDatabase()
      .prepare("SELECT id FROM permission_templates WHERE name = @name LIMIT 1")
      .get({ name });
    if (duplicated !== undefined) throw new Error("权限模板名称不能重复。");
    const nextItem = { ...item, name };
    insertItem(resourceKey, nextItem);
    return nextItem;
  }
  if (resourceKey === "products") {
    const nextItem = normalizeAndValidateProduct(item);
    insertItem(resourceKey, nextItem);
    return nextItem;
  }
  if (resourceKey === "templates") {
    const createTemplate = getDatabase().transaction(() => {
      const nextItem = { ...item, businessCode: null };
      insertItem(resourceKey, nextItem);
      return readExistingItem(resourceKey, nextItem.id);
    });
    return createTemplate();
  }
  if (resourceKey === "taskTemplates") {
    const createTaskTemplate = getDatabase().transaction(() => {
      const nextItem = { ...item, businessCode: null };
      insertItem(resourceKey, nextItem);
      return readExistingItem(resourceKey, nextItem.id);
    });
    return createTaskTemplate();
  }
  const nextItem =
    resourceKey === "people"
      ? {
          ...item,
          permissions: item.permissions ?? createEmptyPermissions("self"),
          permissionTemplateId: item.permissionTemplateId ?? null,
          permissionOverrides: item.permissionOverrides ?? {},
        }
      : item;
  validatePersonPermissionTemplate(nextItem, resourceKey);
  insertItem(resourceKey, nextItem);
  if (resourceKey === "processTemplateNodes" || resourceKey === "tasks") generateEligibleTaskWaves();
  return nextItem;
}

export function updateResource(routeResource, id, item) {
  const resourceKey = routeResourceMap[routeResource];
  if (resourceKey === undefined) throw new Error(`Unknown resource: ${routeResource}`);
  if (resourceKey === "products") {
    const existingProduct = readExistingItem(resourceKey, id);
    if (existingProduct === null) throw new Error("产品不存在。");
    if (
      Object.prototype.hasOwnProperty.call(item ?? {}, "skuCode")
      && String(item.skuCode ?? "").trim() !== String(existingProduct.skuCode ?? "").trim()
    ) {
      throw new Error("SKU编码属于ERP关联关键字段，请使用SKU修改流程。");
    }
  }
  const mergedItem = mergeExistingItem(resourceKey, id, item);
  if (resourceKey === "tasks") {
    const existingTask = readExistingItem("tasks", id);
    const protectedFields = ["executorId", "processNodeId", "processInstanceId", "status"];
    const changesProtectedField = protectedFields.some(
      (field) => Object.prototype.hasOwnProperty.call(item ?? {}, field) && item[field] !== existingTask?.[field],
    );
    if (changesProtectedField) ensureTaskIsNotLockedByWave(id, "处理该任务");
  }
  if (resourceKey === "processTemplateNodes") Object.assign(mergedItem, normalizeAndValidateProcessTemplateNodeWave(mergedItem));
  if (resourceKey === "taskTemplates") {
    const existing = readExistingItem(resourceKey, id);
    if (existing === null) throw new Error("行动标准不存在。");
    mergedItem.businessCode = existing.businessCode;
  }
  if (resourceKey === "permissionTemplates") {
    const name = String(mergedItem.name ?? "").trim();
    if (name === "") throw new Error("权限模板名称不能为空。");
    const duplicated = getDatabase()
      .prepare("SELECT id FROM permission_templates WHERE name = @name AND id <> @id LIMIT 1")
      .get({ name, id });
    if (duplicated !== undefined) throw new Error("权限模板名称不能重复。");
    mergedItem.name = name;
  }
  if (resourceKey === "products") Object.assign(mergedItem, normalizeAndValidateProduct(mergedItem, id));
  validatePersonPermissionTemplate(mergedItem, resourceKey);
  const preservedItem = mergePreservedCustomFields(resourceKey, id, mergedItem);
  const nextItem = resourceKey === "tasks" ? markTaskOverdueOnce(preservedItem) : preservedItem;
  if (resourceKey === "tasks" && nextItem.status === "todo" && !nextItem.readyAt) {
    nextItem.readyAt = nextItem.createdAt ?? new Date().toISOString();
  }
  insertItem(resourceKey, nextItem);
  if (resourceKey === "processTemplateNodes" || resourceKey === "tasks") generateEligibleTaskWaves();
  return nextItem;
}

function normalizeSkuForComparison(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-US");
}

function readProductSkuChangeImpact(productId, newSkuCode) {
  const db = getDatabase();
  const product = db.prepare("SELECT id, skuCode, name FROM products WHERE id = @productId LIMIT 1").get({ productId });
  if (product === undefined) throw new Error("产品不存在。");
  const normalizedNewSkuCode = normalizeSkuForComparison(newSkuCode);
  if (normalizedNewSkuCode === "") throw new Error("新SKU编码不能为空。");

  const productConflict = db
    .prepare("SELECT id, skuCode, name FROM products WHERE lower(trim(skuCode)) = @normalized AND id <> @productId LIMIT 1")
    .get({ normalized: normalizedNewSkuCode, productId });
  const mappingConflict = db
    .prepare(`
      SELECT id, productId, merchantSkuCode
      FROM product_erp_mappings
      WHERE lower(trim(merchantSkuCode)) = @normalized AND productId <> @productId
      LIMIT 1
    `)
    .get({ normalized: normalizedNewSkuCode, productId });
  const platformConflict = db
    .prepare(`
      SELECT s.id, pem.productId, s.platformSkuCode
      FROM sales_link_skus s
      JOIN sales_link_sku_sales_object_relations rel
        ON rel.linkSkuId=s.id AND rel.status='active'
      JOIN sales_objects so
        ON so.id=rel.salesObjectId AND so.status='active'
      JOIN sales_object_structures sos
        ON sos.salesObjectId=so.id AND sos.status='active'
      JOIN sales_object_structure_components component
        ON component.structureId=sos.id AND component.status='active'
      JOIN product_erp_mappings pem
        ON pem.erpSkuId=component.erpSkuId AND pem.currentState='active'
      WHERE lower(trim(s.platformSkuCode)) = @normalized
        AND pem.productId <> @productId
      LIMIT 1
    `)
    .get({ normalized: normalizedNewSkuCode, productId });
  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM product_erp_mappings WHERE productId = @productId) AS erpMappingCount,
      (SELECT COUNT(DISTINCT s.id)
       FROM sales_link_skus s
       JOIN sales_link_sku_sales_object_relations rel
         ON rel.linkSkuId=s.id AND rel.status='active'
       JOIN sales_objects so
         ON so.id=rel.salesObjectId AND so.status='active'
       JOIN sales_object_structures sos
         ON sos.salesObjectId=so.id AND sos.status='active'
       JOIN sales_object_structure_components component
         ON component.structureId=sos.id AND component.status='active'
       JOIN product_erp_mappings pem
         ON pem.erpSkuId=component.erpSkuId AND pem.currentState='active'
       WHERE pem.productId = @productId) AS platformSkuCount,
      (SELECT COUNT(*) FROM product_daily_snapshots WHERE productId = @productId) AS historySnapshotCount,
      (SELECT COUNT(DISTINCT businessDate) FROM product_daily_snapshots WHERE productId = @productId) AS historyBusinessDayCount,
      (SELECT COUNT(*) FROM action_products WHERE productId = @productId) AS actionCount
  `).get({ productId });

  const conflicts = {
    product: productConflict ?? null,
    erpMapping: mappingConflict ?? null,
    platformSku: platformConflict ?? null,
  };
  const hasConflict = Object.values(conflicts).some(Boolean);
  const warnings = [];
  if (counts.platformSkuCount > 0) warnings.push(`该产品关联${counts.platformSkuCount}个平台SKU，平台编码不会自动修改。`);
  if (counts.historySnapshotCount > 0) warnings.push(`该产品有${counts.historySnapshotCount}条历史快照，历史SKU将保持不变。`);
  if (counts.actionCount > 0) warnings.push(`该产品关联${counts.actionCount}条关键行动，关系继续按产品ID保留。`);
  return {
    productId,
    productName: product.name,
    oldSkuCode: product.skuCode,
    newSkuCode: String(newSkuCode).trim(),
    ...counts,
    conflicts,
    hasConflict,
    warnings,
  };
}

export function previewProductSkuChange(productId, newSkuCode) {
  return readProductSkuChangeImpact(String(productId ?? "").trim(), newSkuCode);
}

export function changeProductSku(productId, input = {}) {
  const db = getDatabase();
  const change = db.transaction(() => {
    const id = String(productId ?? "").trim();
    const oldSkuCode = String(input.oldSkuCode ?? "").trim();
    const newSkuCode = String(input.newSkuCode ?? "").trim();
    const reason = String(input.reason ?? "").trim();
    const changedBy = String(input.changedBy ?? "").trim();
    const current = db.prepare("SELECT * FROM products WHERE id = @id LIMIT 1").get({ id });
    if (current === undefined) throw new Error("产品不存在。");
    if (String(current.skuCode ?? "").trim() !== oldSkuCode) {
      throw new Error("产品SKU已发生变化，请刷新后重新确认。");
    }
    if (normalizeSkuForComparison(oldSkuCode) === normalizeSkuForComparison(newSkuCode)) {
      throw new Error("新SKU编码必须与当前SKU不同。");
    }
    if (reason === "") throw new Error("请填写SKU修改原因。");
    if (changedBy === "") throw new Error("无法确认操作人，禁止修改SKU。");

    const impact = readProductSkuChangeImpact(id, newSkuCode);
    if (impact.conflicts.product) throw new Error("新SKU编码已被其他产品使用。");
    if (impact.conflicts.erpMapping) throw new Error("新SKU编码已被其他ERP映射使用。");
    if (impact.conflicts.platformSku) throw new Error("新SKU编码与其他产品的平台SKU关系冲突。");

    const changedAt = new Date().toISOString();
    db.prepare("UPDATE products SET skuCode = @newSkuCode, updatedAt = @changedAt WHERE id = @id")
      .run({ id, newSkuCode, changedAt });
    db.prepare(`
      UPDATE product_erp_mappings
      SET merchantSkuCode = @newSkuCode, updatedAt = @changedAt
      WHERE productId = @id
    `).run({ id, newSkuCode, changedAt });
    const audit = {
      id: `sku-change-${crypto.randomUUID()}`,
      productId: id,
      oldSkuCode,
      newSkuCode,
      reason,
      changedBy,
      impactJson: JSON.stringify(impact),
      changedAt,
    };
    db.prepare(`
      INSERT INTO product_sku_changes
        (id, productId, oldSkuCode, newSkuCode, reason, changedBy, impactJson, changedAt)
      VALUES
        (@id, @productId, @oldSkuCode, @newSkuCode, @reason, @changedBy, @impactJson, @changedAt)
    `).run(audit);
    return {
      product: readExistingItem("products", id),
      impact,
      audit: { ...audit, impactJson: impact },
    };
  });
  return change.immediate();
}

const productStatuses = new Set(["开发中", "待上架", "在售", "停售", "清仓", "已归档"]);

function normalizeAndValidateProcessTemplateNodeWave(item) {
  const stepType = item?.stepType === "review" ? "review" : "execution";
  const waveEnabled = stepType === "execution" && (item?.waveEnabled === true || item?.waveEnabled === 1 || item?.waveEnabled === "1");
  const waveUnlimited =
    waveEnabled && (item?.waveUnlimited === true || item?.waveUnlimited === 1 || item?.waveUnlimited === "1");
  const rawWaveSize = item?.waveSize === null || item?.waveSize === undefined || item?.waveSize === "" ? 10 : Number(item.waveSize);
  const waveSizeIsValid = Number.isInteger(rawWaveSize) && rawWaveSize >= 2 && rawWaveSize <= 100;
  if (waveEnabled && !waveUnlimited && !waveSizeIsValid) {
    throw new Error("波次任务数量上限必须是 2—100 的整数。");
  }
  return {
    ...item,
    stepType,
    waveEnabled,
    waveUnlimited,
    waveSize: waveSizeIsValid ? rawWaveSize : 10,
    waveTemplatePriority: true,
  };
}

function normalizeAndValidateProduct(item, existingId = "") {
  const skuCode = String(item?.skuCode ?? "").trim();
  const name = String(item?.name ?? "").trim();
  const status = String(item?.status ?? "开发中").trim();
  if (skuCode === "") throw new Error("SKU编码不能为空。");
  if (name === "") throw new Error("产品名称不能为空。");
  if (!productStatuses.has(status)) throw new Error("产品状态无效。");
  const duplicated = getDatabase()
    .prepare("SELECT id FROM products WHERE lower(skuCode) = lower(@skuCode) AND id <> @existingId LIMIT 1")
    .get({ skuCode, existingId });
  if (duplicated !== undefined) throw new Error("SKU编码不能重复。");
  return {
    ...item,
    skuCode,
    name,
    status,
    mainImage: String(item?.mainImage ?? "").trim() || null,
    galleryImages: Array.isArray(item?.galleryImages) ? item.galleryImages.filter(Boolean) : [],
  };
}

export function createProductImportBatch(item) {
  insertItem("productImportBatches", item);
  return item;
}

export function readProductImportBatch(id) {
  return readExistingItem("productImportBatches", id);
}

export function updateProductImportBatch(id, item) {
  const nextItem = mergeExistingItem("productImportBatches", id, item);
  insertItem("productImportBatches", nextItem);
  return nextItem;
}

export function findProductsBySkuCodes(skuCodes = []) {
  const values = [...new Set(skuCodes.map((value) => String(value ?? "").trim().toLowerCase()).filter(Boolean))];
  if (values.length === 0) return [];
  const placeholders = values.map(() => "?").join(", ");
  return getDatabase()
    .prepare(`SELECT * FROM products WHERE lower(skuCode) IN (${placeholders})`)
    .all(...values)
    .map((row) => decodeRow(row, resourceConfigs.products));
}

export function commitProductImportBatch(batchId, importedProducts, summary, committedAt = new Date().toISOString()) {
  const commit = getDatabase().transaction(() => {
    const batch = readExistingItem("productImportBatches", batchId);
    if (batch === null) throw new Error("导入记录不存在。");
    if (batch.status === "committed") {
      return { batch, products: findProductsBySkuCodes(importedProducts.map((item) => item.skuCode)), idempotent: true };
    }
    if (batch.status !== "validated") throw new Error("请先完成导入校验。");

    const nextProducts = importedProducts.map((item) => {
      const existingRow = getDatabase()
        .prepare("SELECT * FROM products WHERE lower(skuCode) = lower(@skuCode) LIMIT 1")
        .get({ skuCode: item.skuCode });
      const existing = existingRow === undefined ? null : decodeRow(existingRow, resourceConfigs.products);
      const nextItem = normalizeAndValidateProduct({
        ...(existing ?? {}),
        ...item,
        id: existing?.id ?? item.id,
        mainImage: item.mainImage || existing?.mainImage || null,
        galleryImages: item.galleryImages?.length ? item.galleryImages : existing?.galleryImages ?? [],
        ownerId: existing?.ownerId ?? item.ownerId ?? null,
        remark: item.remark ?? existing?.remark ?? "",
        createdAt: existing?.createdAt ?? item.createdAt ?? committedAt,
        updatedAt: committedAt,
        lastImportedAt: committedAt,
      }, existing?.id ?? "");
      insertItem("products", nextItem);
      return nextItem;
    });

    const nextBatch = {
      ...batch,
      status: "committed",
      summary,
      committedAt,
      updatedAt: committedAt,
    };
    insertItem("productImportBatches", nextBatch);
    return { batch: nextBatch, products: nextProducts, idempotent: false };
  });
  return commit();
}

function normalizeProductIds(productIds = []) {
  return [...new Set((Array.isArray(productIds) ? productIds : []).map((id) => String(id ?? "").trim()).filter(Boolean))];
}

function replaceActionProductsInTransaction(actionId, productIds, createdAt = new Date().toISOString()) {
  const ids = normalizeProductIds(productIds);
  const existingIds = new Set(
    getDatabase().prepare("SELECT productId,erpSkuId FROM action_products WHERE actionId = @actionId").all({ actionId })
      .flatMap((item) => [item.productId, item.erpSkuId]).filter(Boolean),
  );
  const identities = ids.map((identifier) => {
    const identity = getDatabase().prepare(`SELECT sku.id erpSkuId,mapping.productId,profile.businessStatus,product.status productStatus
      FROM erp_skus sku
      LEFT JOIN product_erp_mappings mapping ON mapping.id=(SELECT value.id FROM product_erp_mappings value
        WHERE value.erpSkuId=sku.id AND value.currentState='active' ORDER BY value.updatedAt DESC,value.id DESC LIMIT 1)
      LEFT JOIN products product ON product.id=mapping.productId
      LEFT JOIN product_business_profiles profile ON profile.erpSkuId=sku.id
      WHERE sku.id=? OR mapping.productId=? ORDER BY CASE WHEN sku.id=? THEN 0 ELSE 1 END LIMIT 1`).get(identifier, identifier, identifier)
      || getDatabase().prepare("SELECT id productId,NULL erpSkuId,status productStatus,NULL businessStatus FROM products WHERE id=?").get(identifier);
    if (!identity) throw new Error("存在未找到的关联产品。");
    if ((identity.businessStatus === "archived" || identity.productStatus === "已归档") && !existingIds.has(identity.erpSkuId) && !existingIds.has(identity.productId)) {
      throw new Error("已归档产品不能新增关联。");
    }
    return identity;
  });
  getDatabase().prepare("DELETE FROM action_products WHERE actionId = @actionId").run({ actionId });
  identities.forEach((identity, index) => {
    insertItem("actionProducts", {
      id: `action-product-${actionId}-${index}-${Date.now()}`,
      actionId,
      productId: identity.productId || null,
      erpSkuId: identity.erpSkuId || null,
      createdAt,
    });
  });
  return ids;
}

export function replaceActionProducts(actionId, productIds = []) {
  if (readExistingItem("processInstances", actionId) === null) throw new Error("未找到该关键行动。");
  const replace = getDatabase().transaction(() => replaceActionProductsInTransaction(actionId, productIds));
  return replace();
}

function validatePersonPermissionTemplate(person, resourceKey) {
  if (resourceKey !== "people" || !person.permissionTemplateId) return;
  const template = getPermissionTemplateById(person.permissionTemplateId);
  if (template === null || template.status === "inactive") {
    throw new Error("绑定的权限模板不存在或已停用。");
  }
}

export function batchLinkProcessInstanceTemplates(payload = {}) {
  const processInstanceIds = [...new Set((payload.processInstanceIds ?? []).map((id) => String(id ?? "").trim()).filter(Boolean))];
  const templateIds = [...new Set((payload.templateIds ?? []).map((id) => String(id ?? "").trim()).filter(Boolean))];
  if (processInstanceIds.length === 0) throw new Error("请选择需要关联模板的关键行动。");
  if (templateIds.length === 0) throw new Error("请选择需要关联的模板。");

  const batchLink = getDatabase().transaction(() => {
    const instances = processInstanceIds.map((id) => {
      const instance = readExistingItem("processInstances", id);
      if (instance === null) throw new Error("存在未找到的关键行动，批量关联已取消。");
      return instance;
    });
    templateIds.forEach((id) => {
      if (readExistingItem("templates", id) === null) throw new Error("存在未找到的模板，批量关联已取消。");
    });

    const updatedAt = new Date().toISOString();
    const updatedInstances = instances.map((instance) => {
      const customFields =
        instance.customFields !== null && typeof instance.customFields === "object" && !Array.isArray(instance.customFields)
          ? instance.customFields
          : {};
      const existingTemplateIds = Array.isArray(customFields.linkedTemplateIds)
        ? customFields.linkedTemplateIds.map((id) => String(id ?? "").trim()).filter(Boolean)
        : [];
      const updatedInstance = {
        ...instance,
        customFields: {
          ...customFields,
          linkedTemplateIds: [...new Set([...existingTemplateIds, ...templateIds])],
        },
        updatedAt,
      };
      insertItem("processInstances", updatedInstance);
      return updatedInstance;
    });

    return {
      processInstanceIds,
      templateIds,
      updatedCount: updatedInstances.length,
    };
  });

  return batchLink();
}

const taskWorkflowTransitions = {
  start: { from: new Set(["todo"]), to: new Set(["doing"]) },
  activate: { from: new Set(["waiting"]), to: new Set(["todo"]) },
  submit: { from: new Set(["doing"]), to: new Set(["pending_acceptance", "done"]) },
  approve: { from: new Set(["pending_acceptance"]), to: new Set(["done"]) },
  reject: { from: new Set(["pending_acceptance"]), to: new Set(["doing"]) },
  cancel: { from: new Set(["waiting", "todo", "doing", "pending_acceptance"]), to: new Set(["canceled"]) },
  restore: { from: new Set(["canceled"]), to: new Set(["todo"]) },
  return: { from: new Set(["todo", "doing", "pending_acceptance", "done"]), to: new Set(["waiting", "todo"]) },
  review_approve: { from: new Set(["todo", "doing"]), to: new Set(["done"]) },
  review_reject: { from: new Set(["todo", "doing"]), to: new Set(["waiting"]) },
};

export function updateTaskFromWorkflow(taskId, action, patch = {}) {
  const existing = readExistingItem("tasks", taskId);
  if (existing === null) throw new Error("未找到任务。");
  const transition = taskWorkflowTransitions[action];
  if (transition === undefined) throw new Error("未知的任务流程动作。");
  if (["start", "submit", "cancel", "restore"].includes(action)) {
    ensureTaskIsNotLockedByWave(taskId, action === "start" ? "开始执行" : action === "submit" ? "提交结果" : "处理该任务");
  }
  if (action === "activate") {
    const instance = readExistingItem("processInstances", existing.processInstanceId);
    if (instance === null || instance.status !== "running") throw new Error("所属关键行动尚未进入执行中。");
    const orderedTasks = getOrderedProcessInstanceTasks(existing.processInstanceId);
    const taskIndex = orderedTasks.findIndex((task) => task.id === existing.id);
    const previousTasksReady =
      taskIndex >= 0 &&
      orderedTasks.slice(0, taskIndex).every((task) => {
        if (
          existing.taskType === "review" &&
          task.id === existing.reviewTargetTaskId &&
          task.status === "pending_acceptance"
        ) {
          return true;
        }
        return task.status === "done";
      });
    if (!previousTasksReady) {
      throw new Error("前置步骤尚未完成，当前任务不能激活。");
    }
  }
  const nextStatus = String(patch.status ?? "").trim();
  if (!transition.from.has(existing.status) || !transition.to.has(nextStatus)) {
    throw new Error(`任务状态不能通过“${action}”从 ${existing.status} 变更为 ${nextStatus}。`);
  }
  const mergedItem = mergeExistingItem("tasks", taskId, patch);
  const preservedItem = mergePreservedCustomFields("tasks", taskId, mergedItem);
  const nextItem = markTaskOverdueOnce(preservedItem);
  if (nextItem.status === "todo" && !nextItem.readyAt) nextItem.readyAt = new Date().toISOString();
  insertItem("tasks", nextItem);
  refreshTaskWaveStatusForTask(taskId);
  generateEligibleTaskWaves();
  return nextItem;
}

export function readRouteResource(routeResource) {
  const resourceKey = routeResourceMap[routeResource];
  if (resourceKey === undefined) throw new Error(`Unknown resource: ${routeResource}`);
  return readResource(resourceKey);
}

export function readRouteResourceItem(routeResource, id) {
  const resourceKey = routeResourceMap[routeResource];
  if (resourceKey === undefined) throw new Error(`Unknown resource: ${routeResource}`);
  return readExistingItem(resourceKey, id);
}

export function closeDatabase() {
  if (db !== undefined) {
    db.close();
    db = undefined;
  }
}
