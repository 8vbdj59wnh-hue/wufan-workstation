const DEVELOPMENT_MODULE_ID = "product_development";
const NEW_PRODUCT_PATTERN = /(新品开发|新产品开发|新品研发|产品研发|新品打样|产品打样|新品选品|新产品|研发|打样|选品)/;
const EXCLUDED_PATTERN = /(清仓|淘汰|归档|停售)/;
const TERMINAL_CANCELLED = new Set(["canceled", "cancelled", "stopped", "terminated"]);
const DONE_TASK_STATUSES = new Set(["done", "completed"]);
const STARTED_TASK_STATUSES = new Set(["doing", "pending_acceptance", "done", "completed"]);

function text(value) {
  return String(value ?? "").trim();
}

function fields(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function linkedWorkPlan(instance, workPlans) {
  return workPlans.find((item) => item.processInstanceId === instance.id)
    ?? workPlans.find((item) => item.id === instance.workPlanId)
    ?? null;
}

function linkedTaskTemplate(instance, workPlan, taskTemplates) {
  const templateId = text(instance.taskTemplateId || instance.standardWorkId || workPlan?.taskTemplateId);
  return taskTemplates.find((item) => item.id === templateId) ?? null;
}

function linkedProcessTemplate(instance, processTemplates) {
  return processTemplates.find((item) => item.id === instance.templateId) ?? null;
}

function isNewProductDevelopmentAction(instance, workPlan, taskTemplate, processTemplate) {
  const customFields = { ...fields(workPlan?.customFields), ...fields(instance.customFields) };
  const explicitStandard = taskTemplate?.id === "task-template-new-product-development"
    || NEW_PRODUCT_PATTERN.test(text(taskTemplate?.name));
  const moduleMatched = [
    customFields.valueModuleId,
    taskTemplate?.categoryId,
    workPlan?.categoryId,
    instance.categoryId,
  ].some((value) => text(value) === DEVELOPMENT_MODULE_ID);
  const searchText = [
    instance.name,
    instance.description,
    instance.displayTitle,
    workPlan?.title,
    workPlan?.description,
    taskTemplate?.name,
    taskTemplate?.description,
    processTemplate?.name,
    processTemplate?.purpose,
    customFields.productDirection,
    customFields.productName,
  ].map(text).filter(Boolean).join(" ");
  const actionText = [
    instance.name,
    instance.description,
    instance.displayTitle,
    workPlan?.title,
    workPlan?.description,
    customFields.productDirection,
    customFields.productName,
  ].map(text).filter(Boolean).join(" ");
  if (EXCLUDED_PATTERN.test(actionText) && !explicitStandard) return false;
  return explicitStandard || (moduleMatched && NEW_PRODUCT_PATTERN.test(searchText));
}

function actionBusinessStatus(instance, tasks) {
  const allDone = tasks.length > 0 && tasks.every((task) => DONE_TASK_STATUSES.has(text(task.status)));
  if (["done", "completed"].includes(text(instance.status)) || allDone) return { code: "done", label: "已完成" };
  if (tasks.some((task) => STARTED_TASK_STATUSES.has(text(task.status)))) return { code: "running", label: "执行中" };
  return { code: "pending", label: "待执行" };
}

function actionProgress(tasks) {
  const total = tasks.length;
  const completed = tasks.filter((task) => DONE_TASK_STATUSES.has(text(task.status))).length;
  return { total, completed, percentage: total ? Math.round((completed / total) * 100) : 0 };
}

export function getProductNewDevelopmentCenter(data = {}) {
  const processInstances = data.processInstances ?? [];
  const workPlans = data.workPlans ?? [];
  const tasks = data.tasks ?? [];
  const taskTemplates = data.taskTemplates ?? [];
  const processTemplates = data.processTemplates ?? [];
  const people = new Map((data.people ?? []).map((item) => [item.id, item]));
  const goals = new Map((data.goals ?? []).map((item) => [item.id, item]));
  const products = new Map((data.products ?? []).map((item) => [item.id, item]));
  const actionProducts = data.actionProducts ?? [];
  const productOptions = data.productOptions ?? [];
  const optionsByErpSku = new Map(productOptions.map((item) => [item.erpSkuId, item]));
  const optionsByLegacyProduct = new Map(productOptions.filter((item) => item.productId).map((item) => [item.productId, item]));

  const items = processInstances
    .filter((instance) => !TERMINAL_CANCELLED.has(text(instance.status)))
    .map((instance) => {
      const workPlan = linkedWorkPlan(instance, workPlans);
      const taskTemplate = linkedTaskTemplate(instance, workPlan, taskTemplates);
      const processTemplate = linkedProcessTemplate(instance, processTemplates);
      if (!isNewProductDevelopmentAction(instance, workPlan, taskTemplate, processTemplate)) return null;
      const actionTasks = tasks.filter((task) => task.processInstanceId === instance.id);
      const status = actionBusinessStatus(instance, actionTasks);
      const progress = actionProgress(actionTasks);
      const customFields = { ...fields(workPlan?.customFields), ...fields(instance.customFields) };
      const ownerId = text(instance.ownerId || taskTemplate?.ownerId || instance.initiatorId);
      const linkedProducts = actionProducts
        .filter((item) => item.actionId === instance.id)
        .map((item) => optionsByErpSku.get(item.erpSkuId) || optionsByLegacyProduct.get(item.productId) || products.get(item.productId))
        .filter(Boolean)
        .map((product) => ({
          id: product.erpSkuId || product.id,
          erpSkuId: product.erpSkuId || null,
          legacyProductId: product.productId || (!product.erpSkuId ? product.id : null),
          name: product.name,
          skuCode: product.skuCode,
          mainImage: product.mainImage,
          businessStatus: product.status || null,
        }));
      return {
        id: instance.id,
        businessCode: text(instance.businessCode),
        name: text(instance.displayTitle || instance.name || workPlan?.title || taskTemplate?.name) || "未命名新品开发行动",
        description: text(instance.description || workPlan?.description || taskTemplate?.description),
        productName: text(customFields.productName),
        productDirection: text(customFields.productDirection),
        status,
        progress,
        owner: { id: ownerId, name: text(people.get(ownerId)?.name) || "未设置" },
        initiatorName: text(people.get(instance.initiatorId)?.name) || "未设置",
        goal: { id: instance.goalId, name: text(goals.get(instance.goalId)?.name) || "未关联目标" },
        dueDate: text(instance.dueDate || workPlan?.dueDate || customFields.expectedDoneDate),
        createdAt: text(instance.createdAt || workPlan?.launchedAt || workPlan?.createdAt),
        coverImageUrl: text(instance.coverImageUrl || workPlan?.coverImageUrl),
        linkedProducts,
        standardName: text(taskTemplate?.name) || "新品开发",
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  const countByStatus = (status) => items.filter((item) => item.status.code === status).length;
  return {
    summary: {
      total: items.length,
      pending: countByStatus("pending"),
      running: countByStatus("running"),
      done: countByStatus("done"),
    },
    items,
    definitions: {
      source: "existing_key_actions",
      automaticActionCreation: false,
      automaticTaskCreation: false,
      recognition: "新品开发标准，或产品开发价值链中明确属于新品、研发、打样、选品的行动",
    },
  };
}
