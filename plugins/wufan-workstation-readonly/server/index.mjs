#!/usr/bin/env node

import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_NAME = "wufan-workstation-assistant";
const SERVER_VERSION = "2.2.0";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_PAGE_SIZE = 100;
const MAX_REFERENCE_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_REFERENCE_IMAGE_COUNT = 9;

const objectSchema = (properties = {}, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const textProperty = (description, maxLength = 200) => ({ type: "string", description, maxLength });
const pageProperties = {
  page: { type: "integer", minimum: 1, default: 1 },
  pageSize: { type: "integer", minimum: 1, maximum: MAX_PAGE_SIZE, default: 20 },
};
const readAnnotations = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: true,
});
const launchAnnotations = Object.freeze({
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: true,
});
const contentWriteAnnotations = Object.freeze({
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: true,
});

function tool(name, title, description, inputSchema, request, annotations = readAnnotations) {
  return Object.freeze({
    definition: Object.freeze({ name, title, description, inputSchema, annotations }),
    request,
  });
}

function customTool(name, title, description, inputSchema, execute, annotations = contentWriteAnnotations) {
  return Object.freeze({
    definition: Object.freeze({ name, title, description, inputSchema, annotations }),
    execute,
  });
}

const keyActionLaunchProperties = {
  goalId: textProperty("所属目标ID", 120),
  taskTemplateId: textProperty("启用的关键行动标准ID", 120),
  title: textProperty("本次关键行动标题", 240),
  description: textProperty("行动内容", 2000),
  dueDate: textProperty("截止时间，使用YYYY-MM-DD或ISO日期时间", 40),
  responsiblePersonId: textProperty("负责人ID；仅用于标准中需要发起时指定负责人的步骤", 120),
  customFields: { type: "object", description: "行动标准正式表单字段，键名必须来自可发起行动标准或预览结果", additionalProperties: true },
  productIds: { type: "array", items: textProperty("产品ID", 120), maxItems: 100 },
  referenceAttachmentIds: { type: "array", items: textProperty("通过受控参考图上传工具取得的附件ID", 120), maxItems: MAX_REFERENCE_IMAGE_COUNT },
};

function keyActionBody(args, includeConfirmation = false) {
  const body = {
    goalId: cleanText(args.goalId, "goalId", { required: true, maxLength: 120 }),
    taskTemplateId: cleanText(args.taskTemplateId, "taskTemplateId", { required: true, maxLength: 120 }),
    title: cleanText(args.title, "title", { required: true, maxLength: 240 }),
    description: cleanText(args.description, "description", { required: true, maxLength: 2000 }),
    dueDate: cleanText(args.dueDate, "dueDate", { required: true, maxLength: 40 }),
    responsiblePersonId: cleanText(args.responsiblePersonId, "responsiblePersonId", { maxLength: 120 }),
    customFields: args.customFields ?? {},
    productIds: Array.isArray(args.productIds) ? [...new Set(args.productIds.map((value) => cleanText(value, "productId", { required: true, maxLength: 120 })))] : [],
    referenceAttachmentIds: Array.isArray(args.referenceAttachmentIds)
      ? [...new Set(args.referenceAttachmentIds.map((value) => cleanText(value, "referenceAttachmentId", { required: true, maxLength: 120 })))]
      : [],
  };
  if (!body.customFields || typeof body.customFields !== "object" || Array.isArray(body.customFields)) throw new Error("customFields必须是对象。");
  if (body.referenceAttachmentIds.length > MAX_REFERENCE_IMAGE_COUNT) throw new Error(`参考图片不能超过${MAX_REFERENCE_IMAGE_COUNT}张。`);
  if (includeConfirmation) body.confirmationToken = cleanText(args.confirmationToken, "confirmationToken", { required: true, maxLength: 4096 });
  return body;
}

const referenceImageTypes = Object.freeze({
  ".jpg": { mimeType: "image/jpeg", matches: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  ".jpeg": { mimeType: "image/jpeg", matches: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  ".png": { mimeType: "image/png", matches: (bytes) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  ".webp": { mimeType: "image/webp", matches: (bytes) => bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP" },
});

function readReferenceImage(localPath) {
  const selectedPath = cleanText(localPath, "filePath", { required: true, maxLength: 4096 });
  const resolvedPath = path.resolve(selectedPath);
  let stat;
  try { stat = fs.lstatSync(resolvedPath); }
  catch { throw new Error("无法读取所选参考图片，请确认文件仍存在且当前用户有权读取。"); }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("参考图片必须是用户明确选择的普通本地文件，不能是目录或符号链接。");
  if (stat.size < 1 || stat.size > MAX_REFERENCE_IMAGE_BYTES) throw new Error("每张参考图片必须大于0字节且不超过5MB。");
  const extension = path.extname(resolvedPath).toLowerCase();
  const policy = referenceImageTypes[extension];
  if (!policy) throw new Error("参考图片只支持JPG、PNG和WebP。");
  let bytes;
  try { bytes = fs.readFileSync(resolvedPath); }
  catch { throw new Error("无法读取所选参考图片，请确认文件未被移动且当前用户有权读取。"); }
  if (!policy.matches(bytes)) throw new Error("参考图片实际内容与扩展名不符或文件已损坏。");
  return {
    bytes,
    name: path.basename(resolvedPath),
    mimeType: policy.mimeType,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

async function uploadReferenceImages(args, context) {
  const idempotencyKey = cleanText(args.idempotencyKey, "idempotencyKey", { required: true, maxLength: 120 });
  if (!Array.isArray(args.filePaths) || args.filePaths.length < 1 || args.filePaths.length > MAX_REFERENCE_IMAGE_COUNT) {
    throw new Error(`filePaths必须包含1至${MAX_REFERENCE_IMAGE_COUNT}张用户明确选择的图片。`);
  }
  const images = args.filePaths.map(readReferenceImage);
  const createdIds = [];
  const attachments = [];
  try {
    for (const [index, image] of images.entries()) {
      const formData = new FormData();
      formData.append("idempotencyKey", `${idempotencyKey}-${index + 1}-${image.sha256.slice(0, 24)}`);
      formData.append("image", new Blob([image.bytes], { type: image.mimeType }), image.name);
      const payload = await context.executeRequest({ method: "POST", path: "/api/key-actions/reference-images", formData });
      if (!payload?.attachment?.id) throw new Error("工作站未返回有效的参考图片附件ID。");
      attachments.push(payload.attachment);
      if (payload.created === true) createdIds.push(payload.attachment.id);
    }
  } catch (error) {
    if (createdIds.length > 0) {
      try {
        await context.executeRequest({ method: "POST", path: "/api/key-actions/reference-images/discard", body: { attachmentIds: createdIds } });
      } catch {}
    }
    throw error;
  }
  return {
    success: true,
    attachments,
    attachmentIds: attachments.map((attachment) => attachment.id),
    uploadedCount: createdIds.length,
    reusedCount: attachments.length - createdIds.length,
  };
}

function clampInteger(value, fallback, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function cleanText(value, name, { required = false, maxLength = 200 } = {}) {
  const text = String(value ?? "").trim();
  if (required && text === "") throw new Error(`${name}不能为空。`);
  if (text.length > maxLength) throw new Error(`${name}不能超过${maxLength}个字符。`);
  return text;
}

function cleanEnum(value, name, allowed, fallback = "") {
  const text = cleanText(value, name, { maxLength: 50 });
  if (text === "") return fallback;
  if (!allowed.includes(text)) throw new Error(`${name}不在允许范围内。`);
  return text;
}

function cleanDate(value, name) {
  const text = cleanText(value, name, { maxLength: 10 });
  if (text === "") return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new Error(`${name}必须使用YYYY-MM-DD格式。`);
  }
  return text;
}

function queryPath(pathname, values = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === "") continue;
    query.set(key, typeof value === "boolean" ? String(value) : String(value));
  }
  const suffix = query.toString();
  return suffix === "" ? pathname : `${pathname}?${suffix}`;
}

function pageArgs(args = {}, fallbackSize = 20) {
  return {
    page: clampInteger(args.page, 1),
    pageSize: clampInteger(args.pageSize, fallbackSize, 1, MAX_PAGE_SIZE),
  };
}

function taskFilters(args = {}) {
  const filters = {};
  for (const key of ["status", "source", "departmentId", "ownerId", "executorId", "overdue"]) {
    const value = cleanText(args[key], key, { maxLength: 100 });
    if (value !== "") filters[key] = value;
  }
  for (const key of ["showDone", "showCanceled", "showImprovementTasks"]) {
    if (typeof args[key] === "boolean") filters[key] = args[key];
  }
  return Object.keys(filters).length === 0 ? "" : JSON.stringify(filters);
}

function planningRequestBody(args = {}) {
  const items = Array.isArray(args.items) ? args.items : [];
  if (items.length < 1 || items.length > 100) throw new Error("items必须包含1至100条下周需求。");
  return {
    idempotencyKey: cleanText(args.idempotencyKey, "idempotencyKey", { required: true, maxLength: 120 }),
    items: items.map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`items[${index}]必须是对象。`);
      const productIds = Array.isArray(item.workstationProductIds)
        ? [...new Set(item.workstationProductIds.map((value) => cleanText(value, `items[${index}].workstationProductIds`, { required: true, maxLength: 120 })))]
        : [];
      if (productIds.length > 100) throw new Error(`items[${index}].workstationProductIds不能超过100项。`);
      const preferredTime = cleanText(item.preferredTime, `items[${index}].preferredTime`, { maxLength: 5 });
      if (preferredTime && !/^([01]\d|2[0-3]):[0-5]\d$/u.test(preferredTime)) throw new Error(`items[${index}].preferredTime必须使用HH:mm格式。`);
      return {
        accountId: cleanText(item.accountId, `items[${index}].accountId`, { required: true, maxLength: 120 }),
        column: cleanText(item.column, `items[${index}].column`, { required: true, maxLength: 120 }),
        workstationProductIds: productIds,
        noteFormat: cleanEnum(item.noteFormat, `items[${index}].noteFormat`, ["图文", "视频"]),
        preferredDate: cleanDate(item.preferredDate, `items[${index}].preferredDate`),
        preferredTime,
        notes: cleanText(item.notes, `items[${index}].notes`, { required: true, maxLength: 4000 }),
      };
    }),
  };
}

function fillPlanningRequestBody(args={}) {
  if(!Array.isArray(args.items)||!args.items.length||args.items.length>100)throw new Error('items必须包含1至100条空白需求。');
  return {idempotencyKey:cleanText(args.idempotencyKey,'idempotencyKey',{required:true,maxLength:120}),items:args.items.map(item=>{
    if(!item||Object.keys(item).some(k=>!['id','revision','notes','workstationProductIds','noteFormat'].includes(k))||!Number.isInteger(item.revision)||item.revision<1)throw new Error('补填必须使用原需求ID和版本，不可修改排期字段。');
    const normalized=planningRequestBody({idempotencyKey:args.idempotencyKey,items:[{accountId:'placeholder',column:'placeholder',notes:item.notes,workstationProductIds:item.workstationProductIds,noteFormat:item.noteFormat}]}).items[0];
    return {id:cleanText(item.id,'id',{required:true,maxLength:120}),revision:item.revision,notes:normalized.notes,workstationProductIds:normalized.workstationProductIds,noteFormat:normalized.noteFormat};
  })};
}

function cleanCopyText(value){
  if(typeof value!=='string')throw new Error('copyText必须显式传入字符串；不设正文请传空字符串。');
  if(value.length>20000)throw new Error('copyText过长。');
  if(value!==''&&!value.trim())throw new Error('正文不能只包含空白；不设正文请明确传入空字符串。');
  return value.trim();
}

const TOOL_SPECS = [
  tool("get_goal_center", "读取目标中心", "读取当前账号数据范围内的目标中心正式数据。", objectSchema(), () => ({ path: "/api/goal-center/bootstrap" })),
  tool("get_goal_detail", "读取目标详情", "按目标ID读取正式目标详情。", objectSchema({ goalId: textProperty("目标ID", 100) }, ["goalId"]), (args) => ({ path: `/api/goal-center/goals/${encodeURIComponent(cleanText(args.goalId, "goalId", { required: true, maxLength: 100 }))}/detail` })),
  tool("list_key_actions", "查询关键行动", "分页、搜索当前账号可见的关键行动。", objectSchema({ ...pageProperties, keyword: textProperty("关键字", 200) }), (args) => ({ path: queryPath("/api/schedule-board/page", { ...pageArgs(args), keyword: cleanText(args.keyword, "keyword") }) })),
  tool("list_launchable_action_standards", "查询可发起行动标准", "分页查询当前账号被授权发起的行动标准及其正式表单字段。", objectSchema({ ...pageProperties, keyword: textProperty("行动标准名称或编码", 200) }), (args) => ({ path: queryPath("/api/key-actions/launch-options", { ...pageArgs(args), keyword: cleanText(args.keyword, "keyword") }) })),
  customTool("upload_key_action_reference_images", "上传关键行动参考图片", "仅上传用户在当前对话中明确提供或选择的JPG、PNG或WebP图片，最多9张、每张不超过5MB。返回的附件ID用于关键行动预览和确认发起；不会创建行动、流程或任务。", objectSchema({
    idempotencyKey: textProperty("本次图片集合的稳定幂等键；重试时保持不变", 120),
    filePaths: { type: "array", items: textProperty("用户明确提供或选择的本地图片绝对路径", 4096), minItems: 1, maxItems: MAX_REFERENCE_IMAGE_COUNT },
  }, ["idempotencyKey", "filePaths"]), uploadReferenceImages),
  tool("discard_key_action_reference_images", "清理未使用的关键行动参考图片", "在用户取消发起或替换图片时，清理当前设备会话拥有且尚未被任何行动引用的暂存参考图片；已关联图片不会被删除。", objectSchema({
    attachmentIds: { type: "array", items: textProperty("待清理附件ID", 120), minItems: 1, maxItems: MAX_REFERENCE_IMAGE_COUNT },
  }, ["attachmentIds"]), (args) => {
    if (!Array.isArray(args.attachmentIds) || args.attachmentIds.length < 1 || args.attachmentIds.length > MAX_REFERENCE_IMAGE_COUNT) throw new Error(`attachmentIds必须包含1至${MAX_REFERENCE_IMAGE_COUNT}项。`);
    return { method: "POST", path: "/api/key-actions/reference-images/discard", body: { attachmentIds: [...new Set(args.attachmentIds.map((value) => cleanText(value, "attachmentId", { required: true, maxLength: 120 })))] } };
  }, contentWriteAnnotations),
  tool("preview_key_action_launch", "预览关键行动发起", "校验目标、行动标准、必填字段、负责人、截止时间和重复行动；不写入业务数据。返回的确认凭证仅在内容不变时有效15分钟。", objectSchema(keyActionLaunchProperties, ["goalId", "taskTemplateId", "title", "description", "dueDate"]), (args) => ({ method: "POST", path: "/api/key-actions/launch-preview", body: keyActionBody(args) })),
  tool("launch_key_action", "确认发起关键行动", "仅在用户已经查看预览并明确同意后调用。使用预览返回的确认凭证提交完全相同的内容。", objectSchema({ ...keyActionLaunchProperties, confirmationToken: textProperty("预览返回的短时确认凭证", 4096) }, ["goalId", "taskTemplateId", "title", "description", "dueDate", "confirmationToken"]), (args) => ({ method: "POST", path: "/api/key-actions/launch", body: keyActionBody(args, true) }), launchAnnotations),
  tool("list_tasks", "查询任务", "分页查询今天、我的、逾期或全部任务。", objectSchema({
    ...pageProperties,
    view: { type: "string", enum: ["today", "mine", "overdue", "all"], default: "today" },
    keyword: textProperty("任务名称、任务编码、行动编码或模板编码", 200),
    sort: { type: "string", enum: ["remaining", "name"], default: "remaining" },
    status: textProperty("任务状态", 50), source: textProperty("任务来源", 50),
    departmentId: textProperty("部门ID", 100), ownerId: textProperty("负责人ID", 100), executorId: textProperty("执行人ID", 100),
    overdue: { type: "string", enum: ["yes", "no"] }, showDone: { type: "boolean" }, showCanceled: { type: "boolean" }, showImprovementTasks: { type: "boolean" },
  }), (args) => ({ path: queryPath("/api/task-center/tasks", {
    ...pageArgs(args, 50), view: cleanEnum(args.view, "view", ["today", "mine", "overdue", "all"], "today"),
    keyword: cleanText(args.keyword, "keyword"), sort: cleanEnum(args.sort, "sort", ["remaining", "name"], "remaining"), filters: taskFilters(args),
  }) })),
  tool("get_task_detail", "读取任务详情", "按任务ID读取任务及其正式上下文。", objectSchema({ taskId: textProperty("任务ID", 100) }, ["taskId"]), (args) => ({ path: `/api/task-center/tasks/${encodeURIComponent(cleanText(args.taskId, "taskId", { required: true, maxLength: 100 }))}/detail` })),
  tool("list_work_results", "读取工作结果", "读取最近一段时间内当前账号可见的工作结果。", objectSchema({ days: { type: "integer", minimum: 1, maximum: 366, default: 30 } }), (args) => ({ path: queryPath("/api/work-results/initial", { days: clampInteger(args.days, 30, 1, 366) }) })),
  tool("list_products", "查询产品", "使用服务端分页和正式搜索字段查询产品，不加载全部产品数据。", objectSchema({
    ...pageProperties, search: textProperty("产品ID、ERP SKU编码、产品编码或名称", 200),
    status: textProperty("产品状态", 50), lifecycleStatus: textProperty("生命周期状态", 50), sort: textProperty("正式排序字段", 50),
  }), (args) => ({ path: queryPath("/api/product-center-v2/products", {
    ...pageArgs(args, 30), search: cleanText(args.search, "search"), status: cleanText(args.status, "status", { maxLength: 50 }),
    lifecycleStatus: cleanText(args.lifecycleStatus, "lifecycleStatus", { maxLength: 50 }), sort: cleanText(args.sort, "sort", { maxLength: 50 }),
  }) })),
  tool("get_product", "读取单个产品", "通过Product ID、ERP SKU编码或产品编码精确查询单个产品。", objectSchema({
    identifier: textProperty("精确标识", 200),
    by: { type: "string", enum: ["auto", "productId", "erpSkuCode", "productCode"], default: "auto" },
  }, ["identifier"]), (args) => ({ path: queryPath(`/api/product-center-v2/products/${encodeURIComponent(cleanText(args.identifier, "identifier", { required: true, maxLength: 200 }))}`, { by: cleanEnum(args.by, "by", ["auto", "productId", "erpSkuCode", "productCode"], "auto") }) })),
  tool("get_product_operating_summary", "读取产品经营摘要", "只读取产品汇报所需的正式聚合指标。", objectSchema({ days: { type: "integer", minimum: 1, maximum: 366, default: 30 } }), (args) => ({ path: queryPath("/api/product-center-v2/products/operating-summary", { days: clampInteger(args.days, 30, 1, 366) }) })),
  tool("list_erp_skus", "查询ERP SKU", "分页查询当前正式ERP SKU数据。", objectSchema({ ...pageProperties, search: textProperty("ERP SKU编码或名称", 200), status: textProperty("状态", 50) }), (args) => ({ path: queryPath("/api/product-center-v2/skus", { ...pageArgs(args), search: cleanText(args.search, "search"), status: cleanText(args.status, "status", { maxLength: 50 }) }) })),
  tool("list_links", "查询Link", "在正式权限和数据范围内分页、搜索、筛选Link明细。", objectSchema({
    ...pageProperties, keyword: textProperty("Link标题、编码或商品ID", 200), platform: textProperty("平台", 50),
    status: textProperty("状态", 50), shopId: textProperty("店铺ID", 100),
  }), (args) => ({ path: queryPath("/api/connections", {
    ...pageArgs(args), keyword: cleanText(args.keyword, "keyword"), platform: cleanText(args.platform, "platform", { maxLength: 50 }),
    status: cleanText(args.status, "status", { maxLength: 50 }), shopId: cleanText(args.shopId, "shopId", { maxLength: 100 }),
  }) })),
  tool("get_link_detail", "读取Link详情", "按Link ID读取正式经营详情或连接档案。", objectSchema({
    linkId: textProperty("Link ID", 100), detail: { type: "string", enum: ["core", "record"], default: "core" },
  }, ["linkId"]), (args) => {
    const id = encodeURIComponent(cleanText(args.linkId, "linkId", { required: true, maxLength: 100 }));
    const detail = cleanEnum(args.detail, "detail", ["core", "record"], "core");
    return { path: detail === "record" ? `/api/connections/${id}` : `/api/connections/${id}/core-detail` };
  }),
  tool("get_link_daily_sales", "读取Link经营数据", "读取一个Link在指定日期范围内的正式销售、成本和利润数据。", objectSchema({
    linkId: textProperty("Link ID", 100), startDate: textProperty("开始日期YYYY-MM-DD", 10), endDate: textProperty("结束日期YYYY-MM-DD", 10),
  }, ["linkId"]), (args) => ({ path: queryPath(`/api/connections/${encodeURIComponent(cleanText(args.linkId, "linkId", { required: true, maxLength: 100 }))}/daily-sales`, { startDate: cleanDate(args.startDate, "startDate"), endDate: cleanDate(args.endDate, "endDate") }) })),
  tool("list_link_business", "查询Link经营分析", "分页读取公司范围内正式Link经营分析。", objectSchema({
    ...pageProperties, keyword: textProperty("关键字", 200), range: textProperty("正式时间范围", 50), shopId: textProperty("店铺ID", 100),
  }), (args) => ({ path: queryPath("/api/link-business-table", { scope: "company", ...pageArgs(args), keyword: cleanText(args.keyword, "keyword"), range: cleanText(args.range, "range", { maxLength: 50 }), shopId: cleanText(args.shopId, "shopId", { maxLength: 100 }) }) })),
  tool("get_link_data_status", "读取Link数据状态", "读取正式Link数据更新时间和状态。", objectSchema({ shopId: textProperty("店铺ID", 100) }), (args) => ({ path: queryPath("/api/link-data-status", { shopId: cleanText(args.shopId, "shopId", { maxLength: 100 }) }) })),
  tool("get_data_sync_status", "读取数据中心状态", "纯只读获取最近同步状态、时间、结果和异常摘要，不触发同步。", objectSchema({ batchLimit: { type: "integer", minimum: 1, maximum: 50, default: 10 }, exceptionLimit: { type: "integer", minimum: 1, maximum: 100, default: 20 } }), (args) => ({ path: queryPath("/api/data-sync-center", { batchLimit: clampInteger(args.batchLimit, 10, 1, 50), exceptionLimit: clampInteger(args.exceptionLimit, 20, 1, 100) }) })),
  tool("get_anomaly_summary", "读取异常摘要", "读取异常记录数、去重业务对象、正常无需关系、主数据待完善、真实关系冲突和Legacy历史资产的正式分类事实。", objectSchema(), () => ({ path: "/api/data-sync-center/anomaly-summary" })),
  tool("get_operation_dashboard", "读取经营驾驶舱", "读取经营简报所需的正式驾驶舱汇总数据。", objectSchema(), () => ({ path: "/api/operation-dashboard" })),
  tool("get_sales_business_dashboard", "读取销售经营驾驶舱", "分页读取正式销售经营汇总。", objectSchema({ ...pageProperties, range: textProperty("时间范围，例如30d", 50), keyword: textProperty("关键字", 200) }), (args) => ({ path: queryPath("/api/sales-business-dashboard", { ...pageArgs(args), range: cleanText(args.range, "range", { maxLength: 50 }) || "30d", keyword: cleanText(args.keyword, "keyword") }) })),
  tool("get_notifications_summary", "读取通知摘要", "只读获取当前账号通知摘要，不改变已读状态。", objectSchema({ limit: { type: "integer", minimum: 1, maximum: 100, default: 20 } }), (args) => ({ path: queryPath("/api/notifications/summary", { limit: clampInteger(args.limit, 20, 1, 100) }) })),
  tool("get_content_product_selection", "读取选品确认", "按品牌ID或精确品牌名称读取内容中心已确认选品、可用账号和栏目。", objectSchema({ brand: textProperty("品牌ID或精确品牌名称", 120) }, ["brand"]), (args) => ({ path: queryPath("/api/content-center/planning/product-selection", { brand: cleanText(args.brand, "brand", { required: true, maxLength: 120 }) }) })),
  tool("list_content_column_schedule", "读取栏目排期", "按日期范围分页读取内容中心栏目排期及已保存需求；单次最多62天、每页最多100条。", objectSchema({
    ...pageProperties,
    startDate: textProperty("开始日期YYYY-MM-DD", 10),
    endDate: textProperty("结束日期YYYY-MM-DD", 10),
    brandId: textProperty("品牌ID", 120),
    accountId: textProperty("账号ID", 120),
    column: textProperty("栏目名称", 120),
  }, ["startDate", "endDate"]), (args) => ({ path: queryPath("/api/content-center/planning/schedule", {
    ...pageArgs(args, 50),
    startDate: cleanDate(args.startDate, "startDate"),
    endDate: cleanDate(args.endDate, "endDate"),
    brandId: cleanText(args.brandId, "brandId", { maxLength: 120 }),
    accountId: cleanText(args.accountId, "accountId", { maxLength: 120 }),
    column: cleanText(args.column, "column", { maxLength: 120 }),
  }) })),
  tool("revise_request_copy", "修订已有策划标题正文", "用户授权修订后按原需求ID和最新revision更新标题及正文。保留原需求、产品、排期和其他策划字段；记录前后文案，整批原子写入、幂等重试。已关联行动或版本变化拒绝。", objectSchema({
    idempotencyKey:textProperty("本次修订版本稳定幂等键，相同重试复用",120),
    items:{type:"array",minItems:1,maxItems:100,items:objectSchema({id:textProperty("原需求ID",120),revision:{type:"integer",minimum:1},title:textProperty("修订后完整标题",500),copyText:textProperty("修订后完整正文，保留需保留的评论区等原正文内容",20000)},["id","revision","title","copyText"])}
  },["idempotencyKey","items"]),args=>{
    if(!Array.isArray(args.items)||!args.items.length||args.items.length>100)throw new Error('请提交1至100条修订。');
    return {method:"POST",path:"/api/content-center/planning/requests/revise-copy",body:{idempotencyKey:cleanText(args.idempotencyKey,'idempotencyKey',{required:true,maxLength:120}),items:args.items.map(item=>{
      if(!item||Object.keys(item).some(k=>!['id','revision','title','copyText'].includes(k))||!Number.isInteger(item.revision)||item.revision<1)throw new Error('仅允许原需求ID、版本、标题和正文。');
      return {id:cleanText(item.id,'id',{required:true,maxLength:120}),revision:item.revision,title:cleanText(item.title,'title',{required:true,maxLength:500}),copyText:cleanCopyText(item.copyText)};
    })}};
  },contentWriteAnnotations),
  tool("revise_request_topics", "修订已有策划话题", "用户授权修订后按原需求ID和最新revision更新话题。保留原需求、产品、排期和其他策划字段；记录前后话题，整批原子写入、幂等重试。已关联行动或版本变化拒绝。", objectSchema({
    idempotencyKey:textProperty("本次修订版本稳定幂等键，相同重试复用",120),
    items:{type:"array",minItems:1,maxItems:100,items:objectSchema({id:textProperty("原需求ID",120),revision:{type:"integer",minimum:1},hashtags:textProperty("更新后的完整话题，包含需要保留的原话题",2000)},["id","revision","hashtags"])}
  },["idempotencyKey","items"]),args=>{
    if(!Array.isArray(args.items)||!args.items.length||args.items.length>100)throw new Error('请提交1至100条修订。');
    return {method:"POST",path:"/api/content-center/planning/requests/revise-topics",body:{idempotencyKey:cleanText(args.idempotencyKey,'idempotencyKey',{required:true,maxLength:120}),items:args.items.map(item=>{
      if(!item||Object.keys(item).some(k=>!['id','revision','hashtags'].includes(k))||!Number.isInteger(item.revision)||item.revision<1)throw new Error('仅允许原需求ID、版本、话题。');
      return {id:cleanText(item.id,'id',{required:true,maxLength:120}),revision:item.revision,hashtags:cleanText(item.hashtags,'hashtags',{required:true,maxLength:2000})};
    })}};
  },contentWriteAnnotations),
  tool("save_request_plans", "回填需求策划", "按原需求ID和revision，将执行稿写入尚无策划的已有需求。保留原需求文字、产品、模板、形式和排期，不发起行动。已有关联行动或策划、版本冲突均拒绝；整批原子写入和幂等重试。", objectSchema({
    idempotencyKey:textProperty("本次策划版本稳定幂等键，相同重试复用",120),
    items:{type:"array",minItems:1,maxItems:100,items:objectSchema({
      id:textProperty("原需求ID",120),revision:{type:"integer",minimum:1},title:textProperty("笔记标题",500),
      copyText:textProperty("完整正文；评论区互动可用独立小节标明",20000),hashtags:textProperty("话题",2000),
      imageScript:textProperty("封面文案、图文结构、逐图画面脚本",20000),materialNeeds:textProperty("素材需求",20000)
    },["id","revision","title","copyText"])}
  },["idempotencyKey","items"]),args=>{
    if(!Array.isArray(args.items)||!args.items.length||args.items.length>100)throw new Error('请提交1至100条策划。');
    return {method:"POST",path:"/api/content-center/planning/requests/plans",body:{idempotencyKey:cleanText(args.idempotencyKey,'idempotencyKey',{required:true,maxLength:120}),items:args.items.map(item=>{
      if(!item||Object.keys(item).some(k=>!['id','revision','title','copyText','hashtags','imageScript','materialNeeds'].includes(k))||!Number.isInteger(item.revision)||item.revision<1)throw new Error('仅允许原需求ID、版本和策划字段。');
      const result={id:cleanText(item.id,'id',{required:true,maxLength:120}),revision:item.revision};
      for(const [field,maxLength] of Object.entries({title:500,copyText:20000,hashtags:2000,imageScript:20000,materialNeeds:20000}))result[field]=field==='copyText'?cleanCopyText(item[field]):cleanText(item[field],field,{required:field==='title',maxLength});
      return result;
    })}};
  },contentWriteAnnotations),
  tool("expand_next_week_requests", "扩写已有下周需求", "按原ID和最新revision扩写已有栏目提示或需求文字，并添加品牌确认产品；保留已有产品及账号、栏目、形式、模板和排期。仅限未策划、未关联行动的草稿需求，整批原子性与幂等重试。", objectSchema({
    idempotencyKey:textProperty("稳定幂等键，同内容重试复用",120),
    items:{type:"array",minItems:1,maxItems:100,items:objectSchema({
      id:textProperty("原需求ID",120),revision:{type:"integer",minimum:1},
      notes:textProperty("扩写后的完整需求，保留原需求约束",4000),
      workstationProductIds:{type:"array",items:textProperty("要新增关联的品牌确认产品ID，不移除已有产品",120),maxItems:100}
    },["id","revision","notes","workstationProductIds"])}
  },["idempotencyKey","items"]), args=>{
    if(!Array.isArray(args.items)||!args.items.length||args.items.length>100)throw new Error('请提交1至100条需求。');
    return {method:"POST",path:"/api/content-center/planning/requests/expand",body:{idempotencyKey:cleanText(args.idempotencyKey,'idempotencyKey',{required:true,maxLength:120}),items:args.items.map(item=>{
      if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(k=>!['id','revision','notes','workstationProductIds'].includes(k))||!Number.isInteger(item.revision)||item.revision<1||typeof item.notes!=='string'||!Array.isArray(item.workstationProductIds)||item.workstationProductIds.length>100||item.workstationProductIds.some(id=>typeof id!=='string'))throw new Error('扩写仅允许原需求ID、版本、需求文字和新增产品ID数组。');
      return {id:cleanText(item.id,'id',{required:true,maxLength:120}),revision:item.revision,notes:cleanText(item.notes,'notes',{required:true,maxLength:4000}),workstationProductIds:[...new Set(item.workstationProductIds.map(id=>cleanText(id,'productId',{required:true,maxLength:120})))]};
    })}};
  },contentWriteAnnotations),
  tool("fill_next_week_requests", "补填空白下周需求", "按原需求ID和读取到的revision补填空白需求，保留账号、栏目、日期和时间；只关联品牌确认产品。已有内容或版本冲突整批拒绝；稳定幂等键支持安全重试。", objectSchema({
    idempotencyKey:textProperty("稳定幂等键，相同补填重试复用",120),
    items:{type:"array",minItems:1,maxItems:100,items:objectSchema({
      id:textProperty("原需求ID，由栏目排期查询取得",120),revision:{type:"integer",minimum:1},
      notes:textProperty("完整内容需求",4000),
      workstationProductIds:{type:"array",items:textProperty("品牌选品确认中的产品ID",120),maxItems:100},
      noteFormat:{type:"string",enum:["图文","视频"]}
    },["id","revision","notes"])}
  },["idempotencyKey","items"]), args=>({method:"POST",path:"/api/content-center/planning/requests/fill",body:fillPlanningRequestBody(args)}),contentWriteAnnotations),
  tool("save_next_week_requests", "保存下周需求", "将已完成策划的内容需求新增到内容中心下周需求。只允许关联品牌选品确认中的产品；幂等键防止重试重复写入。", objectSchema({
    idempotencyKey: textProperty("本次策划版本的稳定幂等键；相同内容重试必须复用", 120),
    items: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: objectSchema({
        accountId: textProperty("内容账号ID", 120),
        column: textProperty("该账号的固定栏目", 120),
        workstationProductIds: { type: "array", items: textProperty("选品确认中的产品ID", 120), maxItems: 100 },
        noteFormat: { type: "string", enum: ["图文", "视频"] },
        preferredDate: textProperty("期望发布日期YYYY-MM-DD", 10),
        preferredTime: textProperty("期望发布时间HH:mm", 5),
        notes: textProperty("完整内容需求", 4000),
      }, ["accountId", "column", "notes"]),
    },
  }, ["idempotencyKey", "items"]), (args) => ({ method: "POST", path: "/api/content-center/planning/requests", body: planningRequestBody(args) }), contentWriteAnnotations),
];

const TOOL_BY_NAME = new Map(TOOL_SPECS.map((item) => [item.definition.name, item]));
export const TOOL_DEFINITIONS = Object.freeze(TOOL_SPECS.map((item) => item.definition));

function readOptionalJson(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("配置必须是JSON对象。");
    return value;
  } catch (error) {
    throw new Error(`无法读取工作站配置：${error.message}`);
  }
}

function configDirectory() {
  return process.env.WUFAN_WORKSTATION_CONFIG_DIR
    ? path.resolve(process.env.WUFAN_WORKSTATION_CONFIG_DIR)
    : path.join(os.homedir(), ".codex", "wufan-workstation");
}

function normalizeBaseUrl(value) {
  const source = cleanText(value, "baseUrl", { required: true, maxLength: 2048 });
  const parsed = new URL(source);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("工作站地址只允许HTTP或HTTPS。 ");
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("工作站地址不能包含凭据、查询参数或片段。");
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") + "/";
  return parsed;
}

export function loadSettings() {
  const directory = configDirectory();
  const config = readOptionalJson(path.join(directory, "config.json"));
  const baseUrl = normalizeBaseUrl(process.env.WUFAN_WORKSTATION_BASE_URL || config.baseUrl);
  const tokenFile = process.env.WUFAN_WORKSTATION_TOKEN_FILE
    ? path.resolve(process.env.WUFAN_WORKSTATION_TOKEN_FILE)
    : path.resolve(directory, config.tokenFile || "token.jwt");
  const refreshTokenFile = process.env.WUFAN_WORKSTATION_REFRESH_TOKEN_FILE
    ? path.resolve(process.env.WUFAN_WORKSTATION_REFRESH_TOKEN_FILE)
    : path.resolve(directory, config.refreshTokenFile || "refresh.token");
  const token = cleanText(process.env.WUFAN_WORKSTATION_TOKEN || (fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, "utf8") : ""), "JWT", { maxLength: 16_384 });
  const refreshToken = cleanText(fs.existsSync(refreshTokenFile) ? fs.readFileSync(refreshTokenFile, "utf8") : "", "设备续期凭证", { maxLength: 16_384 });
  if (!token && !refreshToken) throw new Error("缺少工作站访问凭证，请重新运行安装脚本授权这台设备。");
  return {
    baseUrl,
    token,
    tokenFile,
    refreshToken,
    refreshTokenFile,
    timeoutMs: clampInteger(config.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 120_000),
    maxResponseBytes: clampInteger(config.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES, 64 * 1024, 32 * 1024 * 1024),
  };
}

function redact(text, secrets = []) {
  let value = String(text ?? "");
  for (const secret of secrets) {
    if (secret) value = value.split(secret).join("[REDACTED]");
  }
  return value.slice(0, 1_000);
}

async function readLimitedBody(response, maximumBytes) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maximumBytes) throw new Error(`工作站响应超过${maximumBytes}字节安全上限。`);
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error(`工作站响应超过${maximumBytes}字节安全上限。`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function tokenExpiresSoon(token, marginMs = 5 * 60 * 1000) {
  if (!token) return true;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const expiry = Number(payload.exp);
    if (!Number.isFinite(expiry)) return true;
    const expiryMs = expiry < 1_000_000_000_000 ? expiry * 1000 : expiry;
    return expiryMs <= Date.now() + marginMs;
  } catch {
    return true;
  }
}

function saveAccessToken(settings, token) {
  fs.mkdirSync(path.dirname(settings.tokenFile), { recursive: true });
  fs.writeFileSync(settings.tokenFile, token, { encoding: "utf8", mode: 0o600 });
  try { fs.chmodSync(settings.tokenFile, 0o600); } catch {}
  settings.token = token;
}

let activeRefresh = null;
async function refreshAccessToken(settings, fetchImpl) {
  if (!settings.refreshToken) throw new Error("短期JWT已失效，且本机没有设备续期凭证，请重新运行安装脚本。");
  if (activeRefresh) return activeRefresh;
  activeRefresh = (async () => {
    const url = new URL("api/auth/device-sessions/refresh", settings.baseUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: settings.refreshToken }),
        redirect: "error",
        signal: controller.signal,
      });
      const raw = await readLimitedBody(response, Math.min(settings.maxResponseBytes, 1024 * 1024));
      let payload = {};
      try { payload = raw ? JSON.parse(raw) : {}; }
      catch { throw new Error(`工作站续期接口返回了无效JSON（HTTP ${response.status}）。`); }
      if (!response.ok || typeof payload?.token !== "string" || !payload.token) {
        throw new Error(payload?.message || `工作站设备续期失败（HTTP ${response.status}）。`);
      }
      saveAccessToken(settings, payload.token);
      return payload.token;
    } finally {
      clearTimeout(timer);
      activeRefresh = null;
    }
  })();
  return activeRefresh;
}

async function requestApi(url, request, settings, token, fetchImpl, signal) {
  const method = request.method ?? "GET";
  const multipart = request.formData instanceof FormData;
  return fetchImpl(url, {
    method,
    headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(method === "POST" && !multipart ? { "Content-Type": "application/json" } : {}) },
    ...(method === "POST" ? { body: multipart ? request.formData : JSON.stringify(request.body ?? {}) } : {}),
    redirect: "error",
    signal,
  });
}

async function executeApiRequest(request, settings, fetchImpl) {
  if (!request || typeof request.path !== "string" || !request.path.startsWith("/api/")) throw new Error("内部路由配置无效。");
  if (!new Set(["GET", "POST"]).has(request.method ?? "GET")) throw new Error("内部请求方法无效。");
  const url = new URL(request.path.replace(/^\/+/, ""), settings.baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
  try {
    let token = settings.token;
    if (settings.refreshToken && tokenExpiresSoon(token)) token = await refreshAccessToken(settings, fetchImpl);
    let response = await requestApi(url, request, settings, token, fetchImpl, controller.signal);
    if (response.status === 401 && settings.refreshToken) {
      try { await response.body?.cancel(); } catch {}
      token = await refreshAccessToken(settings, fetchImpl);
      response = await requestApi(url, request, settings, token, fetchImpl, controller.signal);
    }
    const raw = await readLimitedBody(response, settings.maxResponseBytes);
    let payload = {};
    if (raw !== "") {
      try { payload = JSON.parse(raw); }
      catch { throw new Error(`工作站返回了无效JSON（HTTP ${response.status}）。`); }
    }
    if (!response.ok) {
      const message = payload?.message || payload?.error || `工作站请求失败（HTTP ${response.status}）。`;
      throw new Error(redact(message, [token, settings.refreshToken]));
    }
    if (!payload || typeof payload !== "object") return { value: payload };
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("工作站请求超时。");
    throw new Error(redact(error?.message || error, [settings.token, settings.refreshToken]));
  } finally {
    clearTimeout(timer);
  }
}

export async function executeTool(name, args = {}, options = {}) {
  const spec = TOOL_BY_NAME.get(name);
  if (!spec) throw new Error(`未知工作站工具：${cleanText(name, "name", { maxLength: 100 })}`);
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("工具参数必须是对象。");
  const settings = options.settings || loadSettings();
  const fetchImpl = options.fetchImpl || fetch;
  const executeRequest = (request) => executeApiRequest(request, settings, fetchImpl);
  if (typeof spec.execute === "function") return spec.execute(args, { settings, fetchImpl, executeRequest });
  return executeRequest(spec.request(args));
}

function toolResult(name, payload) {
  return {
    content: [{ type: "text", text: `${name}执行成功。` }],
    structuredContent: payload,
  };
}

function errorToolResult(error) {
  return { isError: true, content: [{ type: "text", text: error?.message || "工作站请求失败。" }] };
}

async function handleRequest(message) {
  const method = message?.method;
  if (method === "initialize") {
    return {
      protocolVersion: String(message.params?.protocolVersion || "2025-06-18"),
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      instructions: "极简工作站正式受控助手。可读取内容中心选品确认与栏目排期，并在用户当前请求明确要求或授权时幂等新增下周需求或按原ID和版本补填空白需求、向已有需求回填空白策划字段或受控修订已有策划标题正文；只能关联选品确认中的产品。发起关键行动必须先查重并展示完整预览，只有用户在当前对话明确确认后才可提交。除受控扩写未策划需求文字并添加确认产品、补填空白需求、回填空白策划字段及受控修订标题正文外不得编辑、删除或排期内容，不得执行任务、同步、审批、导入、修改通知状态或权限，也不得访问数据库或服务器文件。列表先分页再按ID读取详情。",
    };
  }
  if (method === "ping") return {};
  if (method === "tools/list") return { tools: TOOL_DEFINITIONS };
  if (method === "tools/call") {
    try {
      const name = cleanText(message.params?.name, "工具名称", { required: true, maxLength: 100 });
      return toolResult(name, await executeTool(name, message.params?.arguments || {}));
    } catch (error) {
      return errorToolResult(error);
    }
  }
  throw Object.assign(new Error(`不支持的MCP方法：${method || "空"}`), { code: -32601 });
}

function writeMessage(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

export function startStdioServer() {
  process.stdin.setEncoding("utf8");
  let buffer = "";
  let chain = Promise.resolve();
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const newline = buffer.indexOf("\n");
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      chain = chain.then(async () => {
        let message;
        try { message = JSON.parse(line); }
        catch {
          writeMessage({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON解析失败。" } });
          return;
        }
        if (message.id === undefined || message.id === null) return;
        try {
          writeMessage({ jsonrpc: "2.0", id: message.id, result: await handleRequest(message) });
        } catch (error) {
          writeMessage({ jsonrpc: "2.0", id: message.id, error: { code: error.code || -32603, message: error.message || "MCP服务器错误。" } });
        }
      });
    }
  });
  process.stdin.resume();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) startStdioServer();
