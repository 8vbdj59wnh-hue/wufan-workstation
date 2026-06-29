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
  goals,
  people,
  positions,
  processInstances,
  processTemplateNodes,
  processTemplates,
  stores,
  taskTemplates,
  tasks,
  weeklyReportProblems,
  weeklyReports,
  workPlans,
} from "../src/data/mockData.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
export const dataDir = path.join(projectRoot, "data");
export const uploadsDir = path.join(projectRoot, "uploads");
export const databasePath = path.join(dataDir, "workstation.db");
const schemaPath = path.join(__dirname, "schema.sql");

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
      "importance",
      "urgency",
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
      "source",
      "processInstanceId",
      "processNodeId",
      "categoryId",
      "departmentId",
      "ownerId",
      "initiatorId",
      "description",
      "completionStandard",
      "reviewStandard",
      "outputRequirement",
      "importance",
      "urgency",
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
      "createdAt",
      "updatedAt",
      "completedAt",
    ],
    booleanFields: ["needAcceptance"],
    jsonFields: ["resultAttachments", "customFields", "submitFields", "submitFormData", "submitFiles", "submitLinks"],
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
      "importance",
      "urgency",
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
  "weekly-reports": "weeklyReports",
  "weekly-report-problems": "weeklyReportProblems",
  goals: "goals",
  "task-templates": "taskTemplates",
  tasks: "tasks",
  "process-templates": "processTemplates",
  "process-template-nodes": "processTemplateNodes",
  "process-instances": "processInstances",
  methodologies: "methodologies",
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
  weeklyReports,
  weeklyReportProblems,
  goals,
  taskTemplates,
  tasks,
  processTemplates,
  processTemplateNodes: processTemplateNodes.map((node) => ({
    reviewStandard: "按步骤完成标准和输出要求进行审核。",
    ...node,
  })),
  processInstances,
  methodologies: [],
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

function encodeItem(item, config) {
  const jsonFields = new Set(config.jsonFields ?? []);
  const booleanFields = new Set(config.booleanFields ?? []);
  const encoded = {};

  for (const column of config.columns) {
    let value = item[column] ?? null;
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

  return decoded;
}

function insertItem(resourceKey, item) {
  const config = resourceConfigs[resourceKey];
  const encoded = encodeItem(item, config);
  const columns = config.columns;
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
  ensureColumn("process_instances", "canceledAt", "TEXT");
  ensureColumn("process_instances", "cancelReason", "TEXT");
  ensureColumn("content_schedules", "workPlanId", "TEXT");
  ensureColumn("work_plans", "departmentId", "TEXT");
  ensureColumn("persons", "username", "TEXT");
  ensureColumn("persons", "passwordHash", "TEXT");
  ensureColumn("persons", "canLogin", "INTEGER DEFAULT 0");
  ensureColumn("persons", "authRole", "TEXT DEFAULT 'user'");
  ensureColumn("persons", "lastLoginAt", "TEXT");
  ensureColumn("persons", "mustChangePassword", "INTEGER DEFAULT 0");
  ensureColumn("persons", "permissions", "TEXT");
}

function publicUser(row) {
  if (row === undefined) return null;
  const role = row.authRole ?? "user";
  return {
    id: row.id,
    name: row.name,
    departmentId: row.departmentId,
    username: row.username,
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

  ensureDefaultAdmin();
}

export function readResource(resourceKey) {
  const config = resourceConfigs[resourceKey];
  if (config === undefined) throw new Error(`Unknown resource: ${resourceKey}`);
  const columns = config.columns.join(", ");
  return getDatabase()
    .prepare(`SELECT ${columns} FROM ${config.table}`)
    .all()
    .map((row) => decodeRow(row, config));
}

export function readAllData() {
  return Object.fromEntries(Object.keys(resourceConfigs).map((resourceKey) => [resourceKey, readResource(resourceKey)]));
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

export function cancelProcessInstance(instanceId, cancelReason = "") {
  const database = getDatabase();
  const instance = database.prepare("SELECT * FROM process_instances WHERE id = @id LIMIT 1").get({ id: instanceId });
  if (instance === undefined) throw new Error("未找到该已发起流程。");
  if (["done", "completed"].includes(instance.status)) throw new Error("已完成流程不能取消。");
  if (["canceled", "stopped"].includes(instance.status)) throw new Error("该流程已取消或已终止。");

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

export function createResource(routeResource, item) {
  const resourceKey = routeResourceMap[routeResource];
  if (resourceKey === undefined) throw new Error(`Unknown resource: ${routeResource}`);
  insertItem(resourceKey, item);
  return item;
}

export function updateResource(routeResource, id, item) {
  const resourceKey = routeResourceMap[routeResource];
  if (resourceKey === undefined) throw new Error(`Unknown resource: ${routeResource}`);
  insertItem(resourceKey, { ...item, id });
  return { ...item, id };
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
