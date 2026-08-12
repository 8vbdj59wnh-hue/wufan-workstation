import { ProcessInstanceStatus, TaskSource, TaskStatus } from "./modelOptions.js";
import { hasTaskOverdueRecord, isCanceledStatus, isDoneStatus, isTaskOverdue } from "./taskUtils.js";

const currentTaskStatusRank = {
  [TaskStatus.Doing]: 1,
  [TaskStatus.Todo]: 2,
  [TaskStatus.PendingAcceptance]: 3,
  [TaskStatus.Waiting]: 4,
};

function getTasksForProcess(processInstanceId, appState) {
  if (processInstanceId === null || processInstanceId === undefined || processInstanceId === "") return [];
  return (appState.tasks ?? []).filter((task) => task.processInstanceId === processInstanceId);
}

function getProcessNode(task, appState) {
  return (appState.processTemplateNodes ?? []).find((node) => node.id === task.processNodeId) ?? null;
}

function getProcessNodeOrder(task, appState) {
  const node = getProcessNode(task, appState);
  return Number(node?.stepOrder ?? node?.stageOrder ?? node?.nodeOrder ?? task.stepOrder ?? task.stageOrder ?? task.nodeOrder ?? Number.MAX_SAFE_INTEGER);
}

function getTaskCreatedOrder(task) {
  return String(task.createdAt ?? task.startDate ?? task.dueDate ?? task.id ?? "");
}

export function sortProcessInstanceTasks(tasks, appState) {
  return [...tasks].sort((left, right) => {
    const orderDifference = getProcessNodeOrder(left, appState) - getProcessNodeOrder(right, appState);
    if (orderDifference !== 0) return orderDifference;
    return getTaskCreatedOrder(left).localeCompare(getTaskCreatedOrder(right));
  });
}

function getCurrentStatusRank(task) {
  return currentTaskStatusRank[task.status] ?? 99;
}

function getActiveProcessTasks(processInstanceId, appState) {
  return getTasksForProcess(processInstanceId, appState).filter((task) => !isDoneStatus(task.status) && !isCanceledStatus(task.status));
}

function hasTaskExecutionEvidence(task) {
  if ([TaskStatus.Doing, TaskStatus.PendingAcceptance, TaskStatus.Done].includes(task.status)) return true;
  if (task.completedAt || task.submittedAt) return true;
  if (typeof task.resultText === "string" && task.resultText.trim() !== "") return true;
  if (Array.isArray(task.resultAttachments) && task.resultAttachments.length > 0) return true;
  if (Array.isArray(task.submitFiles) && task.submitFiles.length > 0) return true;
  if (Array.isArray(task.submitLinks) && task.submitLinks.length > 0) return true;
  return false;
}

export function isTaskExecutionStarted(task, appState) {
  if (task === null || task === undefined) return false;
  const processInstanceId = String(task.processInstanceId ?? "").trim();
  const isProcessTask = task.source === TaskSource.Process || processInstanceId !== "";
  if (!isProcessTask) return true;
  if (processInstanceId === "") return true;

  const instance = getProcessInstance(processInstanceId, appState);
  if (instance === null) return true;

  return getTasksForProcess(processInstanceId, appState).some(hasTaskExecutionEvidence);
}

export function getProcessInstanceBusinessStatus(processInstanceId, appState) {
  const instance = getProcessInstance(processInstanceId, appState);
  const tasks = getTasksForProcess(processInstanceId, appState);
  const isDone =
    instance?.status === ProcessInstanceStatus.Done ||
    instance?.status === "completed" ||
    (tasks.length > 0 && tasks.every((task) => isDoneStatus(task.status)));

  if (isDone) return { status: "done", label: "已完成" };

  const executionStarted = tasks.some((task) => isTaskExecutionStarted(task, appState));
  if (!executionStarted) return { status: "pending", label: "待执行" };

  return { status: "running", label: "执行中" };
}

export function getCurrentProcessTask(processInstanceId, appState) {
  const activeTasks = getActiveProcessTasks(processInstanceId, appState);
  if (activeTasks.length === 0) return null;

  return [...activeTasks].sort((left, right) => {
    const statusDifference = getCurrentStatusRank(left) - getCurrentStatusRank(right);
    if (statusDifference !== 0) return statusDifference;
    const orderDifference = getProcessNodeOrder(left, appState) - getProcessNodeOrder(right, appState);
    if (orderDifference !== 0) return orderDifference;
    return getTaskCreatedOrder(left).localeCompare(getTaskCreatedOrder(right));
  })[0] ?? null;
}

export function getProcessProgress(processInstanceId, appState) {
  const tasks = sortProcessInstanceTasks(getTasksForProcess(processInstanceId, appState), appState);
  const current = getCurrentProcessTask(processInstanceId, appState);
  const total = tasks.length;
  const completed = tasks.filter((task) => isDoneStatus(task.status)).length;
  return {
    total,
    completed,
    current,
    percentage: total === 0 ? 0 : Math.round((completed / total) * 100),
    steps: tasks.map((task) => ({
      taskId: task.id,
      name: task.name ?? "未命名任务",
      status: task.status,
      isCurrent: current?.id === task.id,
      executorId: task.executorId ?? "",
      ownerId: task.ownerId ?? "",
      dueDate: task.dueDate ?? "",
    })),
  };
}

export function getCurrentExecutor(processInstanceId, appState) {
  const currentTask = getCurrentProcessTask(processInstanceId, appState);
  if (currentTask === null) return { personId: "", task: null, isFallback: false, source: "none" };
  if (currentTask.executorId) return { personId: currentTask.executorId, task: currentTask, isFallback: false, source: "executorId" };
  if (currentTask.ownerId) return { personId: currentTask.ownerId, task: currentTask, isFallback: true, source: "ownerId" };
  return { personId: "", task: currentTask, isFallback: false, source: "none" };
}

function getProcessInstance(processInstanceId, appState) {
  return (appState.processInstances ?? []).find((instance) => instance.id === processInstanceId) ?? null;
}

function getLinkedWorkPlan(instance, appState) {
  if (instance === null) return null;
  return (
    (appState.workPlans ?? []).find((workPlan) => workPlan.processInstanceId === instance.id) ??
    (appState.workPlans ?? []).find((workPlan) => workPlan.id === instance.workPlanId) ??
    null
  );
}

function getActionStandard(instance, workPlan, appState) {
  const standardId =
    instance?.taskTemplateId ??
    instance?.standardWorkId ??
    instance?.templateId ??
    workPlan?.taskTemplateId ??
    workPlan?.standardWorkId ??
    "";
  if (standardId === "") return null;
  return (appState.taskTemplates ?? []).find((template) => template.id === standardId) ?? null;
}

export function getProcessInstanceOwner(processInstanceId, appState) {
  const instance = getProcessInstance(processInstanceId, appState);
  if (instance === null) return { userId: "", source: "none" };

  if (instance.ownerId) return { userId: instance.ownerId, source: "processInstanceOwner" };

  const workPlan = getLinkedWorkPlan(instance, appState);
  const actionStandard = getActionStandard(instance, workPlan, appState);
  if (actionStandard?.ownerId) return { userId: actionStandard.ownerId, source: "standardOwner" };

  return { userId: "", source: "none" };
}

function isTerminalProcessStatus(status) {
  return (
    status === ProcessInstanceStatus.Done ||
    status === ProcessInstanceStatus.Canceled ||
    status === ProcessInstanceStatus.Stopped ||
    status === ProcessInstanceStatus.Terminated ||
    status === "canceled" ||
    status === "cancelled" ||
    status === "terminated"
  );
}

function isDueDateOverdue(dueDate, currentDate = new Date().toISOString()) {
  const rawValue = String(dueDate ?? "").trim();
  if (rawValue === "") return false;
  const dueTime = new Date(rawValue.length === 10 ? `${rawValue}T23:59:59+08:00` : rawValue).getTime();
  const currentTime = new Date(currentDate).getTime();
  return Number.isFinite(dueTime) && Number.isFinite(currentTime) && currentTime > dueTime;
}

export function isProcessInstanceOverdue(processInstanceId, appState, currentDate = new Date().toISOString()) {
  const instance = getProcessInstance(processInstanceId, appState);
  if (instance !== null && isTerminalProcessStatus(instance.status)) return false;

  const currentTask = getCurrentProcessTask(processInstanceId, appState);
  if (currentTask !== null) {
    if (hasTaskOverdueRecord(currentTask)) return true;
    if (currentTask.dueDate) return isTaskOverdue(currentTask, currentDate);
  }

  return isDueDateOverdue(instance?.dueDate, currentDate);
}
