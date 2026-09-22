import { isContentNoteBodyField } from '../shared/contentNoteFields.js';
import crypto from "node:crypto";
import { getDatabase, launchWorkPlanWithProcess } from "./db.js";
import {
  keyActionReferenceImagesKey,
  linkKeyActionReferenceImagesInTransaction,
  resolveOwnedKeyActionReferenceImages,
} from "./keyActionReferenceAttachmentService.js";

const maximumTextLength = 2_000;
const legacyFieldPrefixes = ["发布内容笔记-", "新品上新-", "新品上架链接-", "库存清仓-"];

function launchError(message, status = 400, code = "key_action_launch_invalid") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function text(value, label, { required = false, maximum = maximumTextLength } = {}) {
  const normalized = String(value ?? "").trim();
  if (required && normalized === "") throw launchError(`${label}不能为空。`);
  if (normalized.length > maximum) throw launchError(`${label}不能超过${maximum}个字符。`);
  return normalized;
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeDateTime(value) {
  const normalized = text(value, "截止时间", { required: true, maximum: 40 });
  const parsed = new Date(normalized.length === 10 ? `${normalized}T23:00:00+08:00` : normalized);
  if (Number.isNaN(parsed.getTime())) throw launchError("截止时间必须是合法日期或日期时间。");
  return normalized.length === 10 ? `${normalized}T23:00:00+08:00` : parsed.toISOString();
}

function normalizeField(field = {}, index = 0) {
  let key = String(field.key ?? field.fieldId ?? field.id ?? `field-${index + 1}`);
  for (const prefix of legacyFieldPrefixes) if (key.startsWith(prefix)) key = key.slice(prefix.length);
  const typeMap = { multi: "multi_select", checkbox: "multi_select", attachment: "file" };
  return {
    ...field,
    key,
    label: String(field.label ?? "未命名字段"),
    type: typeMap[field.type] ?? field.type ?? "text",
    required: field.required === true,
    options: Array.isArray(field.options) ? field.options : [],
    sortOrder: Number.isFinite(Number(field.sortOrder ?? field.order)) ? Number(field.sortOrder ?? field.order) : index + 1,
  };
}

function readFormFields(database, taskTemplate) {
  const row = database.prepare(`SELECT formSchema FROM standard_work_forms WHERE standardWorkId=?
    ORDER BY COALESCE(updatedAt,createdAt,'') DESC,id DESC LIMIT 1`).get(taskTemplate.id);
  const latest = parseJson(row?.formSchema, {})?.fields;
  const source = Array.isArray(latest) && latest.length ? latest : parseJson(taskTemplate.formFields, []);
  return (Array.isArray(source) ? source : []).map(normalizeField).map(field => taskTemplate.id === 'task-template-publish-content-note' && isContentNoteBodyField(field) ? {...field,required:false} : field).sort((a, b) => a.sortOrder - b.sortOrder);
}

function isEmpty(value) {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

function fieldOptionValues(field) {
  return field.options.map((option) => String(
    option !== null && typeof option === "object" ? option.value ?? option.name ?? option.label ?? "" : option ?? "",
  )).filter(Boolean);
}

function validateCustomFields(database, fields, input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw launchError("自定义字段必须是对象。");
  const serialized = JSON.stringify(input);
  if (Buffer.byteLength(serialized, "utf8") > 64 * 1024) throw launchError("自定义字段总大小不能超过64KB。");
  const allowedKeys = new Set(fields.map((field) => field.key));
  const unknownKeys = Object.keys(input).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length) throw launchError(`存在行动标准未定义的字段：${unknownKeys.slice(0, 3).join("、")}`);
  const customFields = structuredClone(input);
  for (const field of fields) {
    const value = customFields[field.key];
    if (isEmpty(value)) {
      if (field.required) throw launchError(`${field.label}不能为空。`, 400, "key_action_required_field_missing");
      continue;
    }
    if (field.type === "multi_select") {
      const values = Array.isArray(value) ? value.map(String) : String(value).split(/,|，|\n/u).map((item) => item.trim()).filter(Boolean);
      if (field.options.length && values.some((item) => !fieldOptionValues(field).includes(item))) throw launchError(`${field.label}包含无效选项。`);
      customFields[field.key] = [...new Set(values)];
      continue;
    }
    if (value !== null && typeof value === "object") throw launchError(`${field.label}的值格式无效。`);
    if (String(value).length > 10_000) throw launchError(`${field.label}不能超过10000个字符。`);
    if (field.type === "number" && !Number.isFinite(Number(value))) throw launchError(`${field.label}必须是数字。`);
    if (field.type === "date" && Number.isNaN(Date.parse(`${value}T00:00:00+08:00`))) throw launchError(`${field.label}必须是合法日期。`);
    if (field.type === "url") {
      try {
        const url = new URL(String(value));
        if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error();
      } catch { throw launchError(`${field.label}必须是有效链接。`); }
    }
    if ((field.type === "select") && field.options.length && !fieldOptionValues(field).includes(String(value))) throw launchError(`${field.label}必须选择有效选项。`);
    if ((field.type === "person" || field.key === "interviewerId") && !database.prepare("SELECT 1 FROM persons WHERE id=? AND status<>'inactive'").get(String(value))) throw launchError(`${field.label}必须选择有效人员。`);
    if ((field.type === "department" || field.key === "departmentId") && !database.prepare("SELECT 1 FROM departments WHERE id=? AND status='active'").get(String(value))) throw launchError(`${field.label}必须选择有效部门。`);
    if (field.key === "storeId") {
      const store = database.prepare("SELECT id,name FROM stores WHERE id=? AND status='active'").get(String(value));
      if (!store) throw launchError(`${field.label}必须选择有效的启用店铺。`);
    }
    if (field.key === "account" && field.label.trim() === "发布账号") {
      const account = database.prepare("SELECT 1 FROM publishing_accounts WHERE name=? AND status='active'").get(String(value));
      if (!account && !fieldOptionValues(field).includes(String(value))) throw launchError(`${field.label}必须选择有效的启用账号。`);
    }
  }
  return customFields;
}

function resolveOwner(database, node, initiatorId, responsiblePersonId) {
  if (node.ownerId) return node.ownerId;
  if (node.ownerRule === "fixed_person") return node.defaultOwnerId;
  if (node.ownerRule === "initiator") return initiatorId;
  if (node.ownerRule === "launch_assign") return responsiblePersonId;
  if (node.ownerRule === "department_leader") return database.prepare("SELECT leaderId FROM departments WHERE id=?").get(node.ownerDepartmentId)?.leaderId ?? null;
  if (node.ownerRule === "fixed_position") return database.prepare(`SELECT id FROM persons WHERE departmentId=? AND positionId=? AND status='active' ORDER BY id LIMIT 1`).get(node.ownerDepartmentId, node.ownerPositionId)?.id ?? null;
  return null;
}

function readDuplicate(database, plan) {
  return database.prepare(`SELECT wp.id workPlanId,wp.title,wp.dueDate,wp.status,pi.id processInstanceId,pi.businessCode
    FROM work_plans wp LEFT JOIN process_instances pi ON pi.id=wp.processInstanceId
    WHERE wp.goalId=? AND wp.taskTemplateId=? AND lower(trim(COALESCE(wp.title,'')))=lower(trim(?))
      AND COALESCE(wp.dueDate,'')=COALESCE(?, '') AND COALESCE(wp.status,'')<>'canceled'
    ORDER BY wp.createdAt DESC LIMIT 1`).get(plan.goal.id, plan.taskTemplate.id, plan.title, plan.dueDate) ?? null;
}

function canonicalInput(plan) {
  return {
    goalId: plan.goal.id,
    taskTemplateId: plan.taskTemplate.id,
    title: plan.title,
    description: plan.description,
    dueDate: plan.dueDate,
    responsiblePersonId: plan.responsiblePerson.id,
    customFields: plan.customFields,
    productIds: plan.productIds,
    referenceImages: plan.referenceImages.map((attachment) => ({ id: attachment.id, sha256: attachment.sha256 })),
    processTemplateId: plan.processTemplate.id,
    processTemplateVersion: plan.processTemplate.version,
    nodeIds: plan.nodes.map((node) => node.id),
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export function fingerprintKeyActionLaunch(plan) {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(canonicalInput(plan)))).digest("hex");
}

export function prepareKeyActionLaunch(input, {
  initiatorId,
  assistantSessionId = "",
  visibleGoalIds = null,
  dataScope = "self",
  userDepartmentId = "",
} = {}) {
  const database = getDatabase();
  const goalId = text(input?.goalId, "所属目标", { required: true, maximum: 120 });
  const taskTemplateId = text(input?.taskTemplateId, "关键行动标准", { required: true, maximum: 120 });
  const title = text(input?.title, "本次关键行动标题", { required: true, maximum: 240 });
  const description = text(input?.description, "行动内容", { required: true });
  const dueDate = normalizeDateTime(input?.dueDate);
  const goal = database.prepare("SELECT * FROM goals WHERE id=? LIMIT 1").get(goalId);
  if (!goal || goal.status === "inactive") throw launchError("所属目标不存在、已停用或不在当前数据范围内。", 404, "key_action_goal_unavailable");
  if (visibleGoalIds && !visibleGoalIds.has(goal.id)) throw launchError("所属目标不在当前账号数据范围内。", 403, "key_action_goal_out_of_scope");
  const taskTemplate = database.prepare("SELECT * FROM task_templates WHERE id=? AND status='active' LIMIT 1").get(taskTemplateId);
  if (!taskTemplate) throw launchError("关键行动标准不存在或未启用。", 404, "key_action_standard_unavailable");
  const processTemplate = database.prepare("SELECT * FROM process_templates WHERE id=? AND status='active' LIMIT 1").get(taskTemplate.defaultProcessTemplateId);
  if (!processTemplate) throw launchError("该关键行动尚未绑定启用的标准流程。", 409, "key_action_process_unavailable");
  const nodes = database.prepare(`SELECT * FROM process_template_nodes WHERE templateId=? AND status='active'
    ORDER BY COALESCE(stepOrder,stageOrder,nodeOrder,1),id`).all(processTemplate.id);
  if (!nodes.length) throw launchError("该标准流程尚未配置启用步骤。", 409, "key_action_steps_unavailable");
  const actualInitiatorId = text(initiatorId, "实际发起人", { required: true, maximum: 120 });
  const initiator = database.prepare("SELECT id,name,departmentId,status FROM persons WHERE id=? AND status<>'inactive'").get(actualInitiatorId);
  if (!initiator) throw launchError("无法确认有效的实际发起人。", 403, "key_action_initiator_unavailable");
  const requestedResponsibleId = text(input?.responsiblePersonId, "负责人", { maximum: 120 });
  const fallbackResponsibleId = requestedResponsibleId || taskTemplate.ownerId || actualInitiatorId;
  const responsiblePerson = database.prepare("SELECT id,name,departmentId,status FROM persons WHERE id=? AND status<>'inactive'").get(fallbackResponsibleId);
  if (!responsiblePerson) throw launchError("负责人不存在或不可分配。", 400, "key_action_owner_unavailable");
  if (requestedResponsibleId && dataScope !== "all") {
    const visible = dataScope === "department"
      ? responsiblePerson.departmentId === userDepartmentId || responsiblePerson.id === actualInitiatorId
      : responsiblePerson.id === actualInitiatorId;
    if (!visible) throw launchError("负责人不在当前账号数据范围内。", 403, "key_action_owner_out_of_scope");
  }
  const fields = readFormFields(database, taskTemplate);
  const customFields = validateCustomFields(database, fields, input?.customFields ?? {});
  const productIds = [...new Set((Array.isArray(input?.productIds) ? input.productIds : []).map((value) => text(value, "产品ID", { maximum: 120 })).filter(Boolean))].sort();
  if (productIds.length > 100) throw launchError("一次最多关联100个产品。");
  for (const productId of productIds) if (!database.prepare("SELECT 1 FROM products WHERE id=?").get(productId)) throw launchError(`产品不存在：${productId}`);
  if (input?.referenceAttachmentIds !== undefined && !Array.isArray(input.referenceAttachmentIds)) {
    throw launchError("参考图附件ID必须是数组。", 400, "key_action_reference_image_invalid");
  }
  const referenceAttachmentIds = input?.referenceAttachmentIds ?? [];
  const referenceImages = referenceAttachmentIds.length === 0
    ? []
    : resolveOwnedKeyActionReferenceImages(referenceAttachmentIds, {
      ownerUserId: actualInitiatorId,
      ownerSessionId: assistantSessionId,
    });
  const plan = {
    goal, taskTemplate, processTemplate, nodes, initiator, responsiblePerson, title, description, dueDate,
    customFields, productIds, fields, referenceAttachmentIds: referenceImages.map((attachment) => attachment.id),
    referenceImages, assistantSessionId,
  };
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const review = (node.stepType ?? "execution") === "review";
    if (review && index === 0) throw launchError("审核步骤不能作为流程第一步。", 409, "key_action_invalid_process");
    const ownerId = review ? node.reviewerId : resolveOwner(database, node, actualInitiatorId, responsiblePerson.id);
    if (!ownerId || !database.prepare("SELECT 1 FROM persons WHERE id=? AND status<>'inactive'").get(ownerId)) throw launchError(`标准步骤“${node.name}”无法解析有效负责人。`, 409, "key_action_owner_unresolved");
    node.resolvedOwnerId = ownerId;
    node.resolvedExecutorId = review ? ownerId : (node.executorId === "initiator" ? actualInitiatorId : node.executorId || ownerId);
    if (!review && !database.prepare("SELECT 1 FROM persons WHERE id=? AND status<>'inactive'").get(node.resolvedExecutorId)) throw launchError(`标准步骤“${node.name}”无法解析有效执行人。`, 409, "key_action_executor_unresolved");
  }
  plan.duplicate = readDuplicate(database, plan);
  plan.fingerprint = fingerprintKeyActionLaunch(plan);
  return plan;
}

export function publicKeyActionLaunchPreview(plan) {
  return {
    fingerprint: plan.fingerprint,
    goal: { id: plan.goal.id, name: plan.goal.name },
    actionStandard: { id: plan.taskTemplate.id, name: plan.taskTemplate.name, completionStandard: plan.taskTemplate.completionStandard ?? "" },
    process: { id: plan.processTemplate.id, name: plan.processTemplate.name, version: plan.processTemplate.version },
    title: plan.title,
    description: plan.description,
    dueDate: plan.dueDate,
    responsiblePerson: { id: plan.responsiblePerson.id, name: plan.responsiblePerson.name },
    customFields: plan.customFields,
    formFields: plan.fields,
    productIds: plan.productIds,
    referenceImages: plan.referenceImages,
    steps: plan.nodes.map((node, index) => ({
      order: index + 1,
      name: node.name,
      type: (node.stepType ?? "execution") === "review" ? "review" : "execution",
      ownerId: node.resolvedOwnerId,
      executorId: node.resolvedExecutorId,
      completionStandard: node.completionStandard ?? "",
      reviewStandard: node.reviewStandard ?? "",
    })),
    duplicate: plan.duplicate,
    canLaunch: plan.duplicate === null,
  };
}

function id(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

export function launchPreparedKeyAction(plan) {
  if (plan.duplicate) throw launchError("发现同目标、同标准、同标题且同截止时间的现有行动，请修改内容或停止发起。", 409, "key_action_duplicate");
  const now = new Date().toISOString();
  const processInstanceId = id("process-instance");
  const workPlanId = id("work-plan");
  const referenceImages = plan.referenceImages.map((attachment) => ({ ...attachment, status: "active", expiresAt: null }));
  const launchCustomFields = referenceImages.length === 0
    ? plan.customFields
    : { ...plan.customFields, [keyActionReferenceImagesKey]: referenceImages };
  const tasks = [];
  for (let index = 0; index < plan.nodes.length; index += 1) {
    const node = plan.nodes[index];
    const review = (node.stepType ?? "execution") === "review";
    const previousExecution = [...tasks].reverse().find((task) => task.taskType === "execution") ?? null;
    tasks.push({
      id: id("task"), taskType: review ? "review" : "execution", name: node.name,
      goalId: plan.goal.id, source: "process", processInstanceId, processNodeId: node.id,
      categoryId: null, departmentId: node.departmentId ?? node.ownerDepartmentId ?? plan.taskTemplate.departmentId,
      ownerId: node.resolvedOwnerId, executorId: node.resolvedExecutorId, initiatorId: plan.initiator.id,
      description: node.description ?? "", completionStandard: node.completionStandard ?? "", reviewStandard: null,
      outputRequirement: null, startDate: null, readyAt: index === 0 ? now : null, dueDate: null, plannedWeek: null,
      needAcceptance: false, accepterId: null, status: index === 0 ? "todo" : "waiting", resultText: null,
      resultAttachments: [], submitType: review ? "none" : (node.submitType || "none"),
      submitDescription: review ? "" : (node.submitDescription ?? ""), submitFields: review ? [] : parseJson(node.submitFields, []),
      submitFormData: {}, submitFiles: [], submitLinks: [], submittedAt: null, submittedBy: null,
      taskTemplateId: null, customFields: referenceImages.length === 0 ? {} : { [keyActionReferenceImagesKey]: referenceImages }, displayTitle: null, coverImageUrl: null,
      reviewTargetTaskId: review ? previousExecution?.id ?? null : null, reviewTargetSnapshot: null,
      returnToNodeId: review ? node.returnToNodeId ?? previousExecution?.processNodeId ?? null : null,
      reviewStatus: review ? "pending" : null, reviewComment: null, reviewedAt: null,
      reviewerId: review ? node.resolvedOwnerId : null, requireRejectionReason: review ? Boolean(node.requireRejectionReason) : false,
      createdAt: now, updatedAt: now, completedAt: null,
    });
  }
  const processInstance = {
    id: processInstanceId, templateId: plan.processTemplate.id, taskTemplateId: plan.taskTemplate.id,
    templateVersion: plan.processTemplate.version, name: plan.title, goalId: plan.goal.id, initiatorId: plan.initiator.id,
    description: plan.description, status: "running", startedAt: null, dueDate: plan.dueDate,
    completedAt: null, stoppedAt: null, canceledAt: null, cancelReason: null, customFields: launchCustomFields,
    displayTitle: plan.title, coverImageUrl: null, createdAt: now, updatedAt: now,
  };
  const workPlan = {
    id: workPlanId, goalId: plan.goal.id, departmentId: plan.taskTemplate.departmentId,
    taskTemplateId: plan.taskTemplate.id, title: plan.title, customFields: launchCustomFields,
    coverImageUrl: null, workType: "normal", status: "launched", plannedWeek: null,
    dueDate: plan.dueDate, description: plan.description, processInstanceId, createdAt: now,
    updatedAt: now, launchedAt: now, canceledAt: null,
  };
  return launchWorkPlanWithProcess(workPlanId, {
    processInstance, tasks, workPlan, productIds: plan.productIds, initiatorId: plan.initiator.id,
    onPersisted: referenceImages.length === 0 ? null : () => {
      linkKeyActionReferenceImagesInTransaction({
        attachmentIds: plan.referenceAttachmentIds,
        ownerUserId: plan.initiator.id,
        ownerSessionId: plan.assistantSessionId,
        processInstanceId,
        workPlanId,
      });
    },
  });
}

export function readExistingPreparedKeyAction(plan) {
  if (!plan?.duplicate?.processInstanceId) return null;
  const instance = getDatabase().prepare("SELECT * FROM process_instances WHERE id=? LIMIT 1").get(plan.duplicate.processInstanceId);
  if (!instance) return null;
  const taskCount = Number(getDatabase().prepare("SELECT COUNT(*) count FROM tasks WHERE processInstanceId=?").get(instance.id)?.count ?? 0);
  return { instance, taskCount };
}

export function listLaunchableActionStandards({ keyword = "", page = 1, pageSize = 20, allowedTemplateIds = null } = {}) {
  const database = getDatabase();
  const normalizedKeyword = text(keyword, "搜索词", { maximum: 200 });
  const normalizedPage = Math.max(1, Number.parseInt(page, 10) || 1);
  const normalizedPageSize = Math.min(100, Math.max(1, Number.parseInt(pageSize, 10) || 20));
  const pattern = `%${normalizedKeyword}%`;
  const allowedIds = Array.isArray(allowedTemplateIds) ? [...new Set(allowedTemplateIds.map(String).filter(Boolean))] : null;
  const scopeSql = allowedIds === null ? "" : allowedIds.length ? ` AND t.id IN (${allowedIds.map(() => "?").join(",")})` : " AND 1=0";
  const where = `t.status='active' AND p.status='active' AND (?='' OR t.name LIKE ? OR COALESCE(t.businessCode,'') LIKE ?)${scopeSql}`;
  const queryArgs = [normalizedKeyword, pattern, pattern, ...(allowedIds ?? [])];
  const total = Number(database.prepare(`SELECT COUNT(*) count FROM task_templates t JOIN process_templates p ON p.id=t.defaultProcessTemplateId WHERE ${where}`).get(...queryArgs).count);
  const rows = database.prepare(`SELECT t.*,p.name processName,p.version processVersion FROM task_templates t
    JOIN process_templates p ON p.id=t.defaultProcessTemplateId WHERE ${where}
    ORDER BY t.name,t.id LIMIT ? OFFSET ?`).all(...queryArgs, normalizedPageSize, (normalizedPage - 1) * normalizedPageSize);
  return {
    page: normalizedPage, pageSize: normalizedPageSize, total,
    items: rows.map((row) => ({
      id: row.id, businessCode: row.businessCode, name: row.name, description: row.description,
      completionStandard: row.completionStandard, ownerId: row.ownerId, departmentId: row.departmentId,
      processTemplateId: row.defaultProcessTemplateId, processName: row.processName, processVersion: row.processVersion,
      formFields: readFormFields(database, row),
    })),
  };
}
