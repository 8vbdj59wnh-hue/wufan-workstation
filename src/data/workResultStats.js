import { ProcessInstanceStatus, TaskStatus, WorkPlanStatus, WorkType } from "./modelOptions.js";
import { hasTaskOverdueRecord, isCanceledStatus, isDoneStatus, isTaskOverdue } from "./taskUtils.js";

export const UnassignedDepartmentId = "__unassigned_department__";

export function parseWorkResultDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value);
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? `${text}T00:00:00+08:00`
    : text.includes("T") || /[+-]\d{2}:\d{2}$/.test(text)
      ? text
      : `${text.replace(" ", "T")}+08:00`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseWorkResultDeadline(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const date = new Date(`${text}T23:59:59+08:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return parseWorkResultDate(text);
}

export function getTaskPeriodDate(task) {
  return task.completedAt ?? task.updatedAt ?? task.createdAt ?? task.dueDate;
}

export function getComparableTaskDate(task) {
  return parseWorkResultDate(getTaskPeriodDate(task)) ?? parseWorkResultDate(task.dueDate);
}

export function dateInWorkResultWindow(value, start, end) {
  const date = parseWorkResultDate(value);
  return date !== null && date >= start && date < end;
}

export function getTaskExecutorIds(task) {
  return new Set(
    [task.executorId, task.assigneeId, task.responsiblePersonId, task.responsiblePerson]
      .filter((value) => value !== null && value !== undefined && value !== ""),
  );
}

export function getTaskParticipantIds(task) {
  return new Set(
    [task.executorId, task.assigneeId, task.ownerId, task.responsiblePersonId, task.responsiblePerson]
      .filter((value) => value !== null && value !== undefined && value !== ""),
  );
}

export function isTaskExecutedByPerson(task, personId) {
  return getTaskExecutorIds(task).has(personId);
}

export function isTaskRelatedToPerson(task, personId) {
  return getTaskParticipantIds(task).has(personId);
}

export function getProcessInstanceByWorkPlan(dataState, workPlan) {
  return dataState.processInstances.find((instance) => instance.id === workPlan.processInstanceId) ?? null;
}

export function getProcessTasks(dataState, processInstanceId) {
  if (!processInstanceId) return [];
  return dataState.tasks
    .filter((task) => task.processInstanceId === processInstanceId)
    .sort((left, right) => {
      const leftNode = dataState.processTemplateNodes.find((node) => node.id === left.processNodeId);
      const rightNode = dataState.processTemplateNodes.find((node) => node.id === right.processNodeId);
      const leftOrder = Number(leftNode?.stepOrder ?? leftNode?.stageOrder ?? leftNode?.nodeOrder ?? 1);
      const rightOrder = Number(rightNode?.stepOrder ?? rightNode?.stageOrder ?? rightNode?.nodeOrder ?? 1);
      return leftOrder - rightOrder;
    });
}

export function getWorkPlanTasks(dataState, workPlan) {
  const processInstance = getProcessInstanceByWorkPlan(dataState, workPlan);
  return processInstance === null ? [] : getProcessTasks(dataState, processInstance.id);
}

export function isWorkPlanRelatedToPerson(dataState, workPlan, personId) {
  if ([workPlan.ownerId, workPlan.executorId, workPlan.assigneeId, workPlan.submitterId].includes(personId)) return true;
  if ([workPlan.customFields?.sourceExecutorId, workPlan.customFields?.sourceOwnerId].includes(personId)) return true;
  const processInstance = getProcessInstanceByWorkPlan(dataState, workPlan);
  if ([processInstance?.ownerId, processInstance?.executorId, processInstance?.submitterId].includes(personId)) return true;
  return getWorkPlanTasks(dataState, workPlan).some((task) => isTaskRelatedToPerson(task, personId));
}

export function getTaskReturnCount(task) {
  return Array.isArray(task.customFields?.returnRecords) ? task.customFields.returnRecords.length : 0;
}

export function getTaskReviewRejectCount(task) {
  return Array.isArray(task.customFields?.reviewRejectRecords) ? task.customFields.reviewRejectRecords.length : 0;
}

export function isTaskCompletedOnTime(task) {
  const completedAt = parseWorkResultDate(task.completedAt);
  const dueDate = parseWorkResultDeadline(task.dueDate);
  return completedAt !== null && dueDate !== null && completedAt <= dueDate;
}

export function isTaskOverdueForWorkResults(task, currentDate = new Date().toISOString().slice(0, 10)) {
  return hasTaskOverdueRecord(task) || isTaskOverdue(task, currentDate);
}

export function getWorkPlanRecordDate(workPlan) {
  return workPlan.launchedAt ?? workPlan.createdAt ?? workPlan.updatedAt ?? workPlan.dueDate;
}

export function getWorkPlanStatusLabel(workPlan, processInstance) {
  if (workPlan.status === WorkPlanStatus.Done || processInstance?.status === ProcessInstanceStatus.Done) return "已完成";
  if (workPlan.status === WorkPlanStatus.Canceled || processInstance?.status === ProcessInstanceStatus.Stopped || processInstance?.status === "canceled") return "已取消";
  if (workPlan.status === WorkPlanStatus.Launched) return "已发起";
  if (workPlan.status === WorkPlanStatus.ThisWeek) return "待发起工作计划";
  return "待发起工作计划";
}

export function isRectificationDone(workPlan, processInstance) {
  return workPlan.status === WorkPlanStatus.Done || processInstance?.status === ProcessInstanceStatus.Done;
}

export function isRectificationCanceled(workPlan, processInstance) {
  return workPlan.status === WorkPlanStatus.Canceled || processInstance?.status === ProcessInstanceStatus.Stopped || processInstance?.status === "canceled";
}

export function getPersonWorkPlans(dataState, personId) {
  return dataState.workPlans.filter((workPlan) => isWorkPlanRelatedToPerson(dataState, workPlan, personId));
}

export function getPersonTasks(dataState, personId) {
  return dataState.tasks.filter((task) => isTaskExecutedByPerson(task, personId));
}

export function getDepartmentWorkPlans(dataState, departmentId) {
  if (departmentId === UnassignedDepartmentId) {
    const knownDepartmentIds = new Set(dataState.departments.map((department) => department.id));
    return dataState.workPlans.filter((workPlan) => !workPlan.departmentId || !knownDepartmentIds.has(workPlan.departmentId));
  }
  return dataState.workPlans.filter((workPlan) => workPlan.departmentId === departmentId);
}

export function getDepartmentTasks(dataState, departmentId) {
  if (departmentId === UnassignedDepartmentId) {
    const knownDepartmentIds = new Set(dataState.departments.map((department) => department.id));
    return dataState.tasks.filter((task) => !task.departmentId || !knownDepartmentIds.has(task.departmentId));
  }
  return dataState.tasks.filter((task) => task.departmentId === departmentId);
}

function getScopedWorkResultData(dataState, { personId, departmentId } = {}) {
  if (personId) {
    return {
      workPlans: getPersonWorkPlans(dataState, personId),
      tasks: getPersonTasks(dataState, personId),
    };
  }
  if (departmentId) {
    return {
      workPlans: getDepartmentWorkPlans(dataState, departmentId),
      tasks: getDepartmentTasks(dataState, departmentId),
    };
  }
  return {
    workPlans: dataState.workPlans.slice(),
    tasks: dataState.tasks.slice(),
  };
}

export function getWorkResultSummary(dataState, { personId, departmentId, currentDate = new Date().toISOString().slice(0, 10) } = {}) {
  const { workPlans, tasks } = getScopedWorkResultData(dataState, { personId, departmentId });
  const normalWorks = workPlans.filter((workPlan) => workPlan.workType !== WorkType.Rectification);
  const rectificationWorks = workPlans.filter((workPlan) => workPlan.workType === WorkType.Rectification);
  const completedTasks = tasks.filter((task) => task.status === TaskStatus.Done);
  const completedWithDue = completedTasks.filter((task) => parseWorkResultDate(task.completedAt) !== null && parseWorkResultDeadline(task.dueDate) !== null);
  const rectificationRows = rectificationWorks.map((workPlan) => {
    const processInstance = getProcessInstanceByWorkPlan(dataState, workPlan);
    return { workPlan, processInstance };
  });
  const doneRectifications = rectificationRows.filter((row) => isRectificationDone(row.workPlan, row.processInstance));
  const activeRectifications = rectificationRows.filter((row) => !isRectificationDone(row.workPlan, row.processInstance) && !isRectificationCanceled(row.workPlan, row.processInstance));
  const overdueTaskIds = new Set(tasks.filter((task) => isTaskOverdueForWorkResults(task, currentDate)).map((task) => task.id));
  return {
    tasks,
    workPlans,
    normalWorks,
    rectificationWorks,
    completedTasks,
    completedTaskCount: completedTasks.length,
    completedWithDue,
    onTimeRate: completedWithDue.length === 0 ? null : (completedWithDue.filter(isTaskCompletedOnTime).length / completedWithDue.length) * 100,
    overdueCount: overdueTaskIds.size,
    returnCount: tasks.reduce((sum, task) => sum + getTaskReturnCount(task), 0),
    rejectCount: tasks.reduce((sum, task) => sum + getTaskReviewRejectCount(task), 0),
    rectificationCount: rectificationWorks.length,
    normalWorkCount: normalWorks.length,
    rectificationDoneCount: doneRectifications.length,
    rectificationActiveCount: activeRectifications.length,
    rectificationRate: normalWorks.length === 0 ? 0 : (rectificationWorks.length / normalWorks.length) * 100,
  };
}

export function getPeriodWorkResultSummary(dataState, { personId, departmentId, days, offsetDays = 0, now = new Date() } = {}) {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  end.setDate(end.getDate() - offsetDays);
  const start = new Date(end);
  start.setDate(end.getDate() - days + 1);
  start.setHours(0, 0, 0, 0);
  const { workPlans: baseWorkPlans, tasks: baseTasks } = getScopedWorkResultData(dataState, { personId, departmentId });
  const tasks = baseTasks.filter((task) => {
    const date = getComparableTaskDate(task);
    return date !== null && date >= start && date <= end;
  });
  const workPlans = baseWorkPlans.filter((workPlan) => dateInWorkResultWindow(getWorkPlanRecordDate(workPlan), start, end));
  return getWorkResultSummary(
    {
      ...dataState,
      tasks,
      workPlans,
    },
    { currentDate: end.toISOString().slice(0, 10) },
  );
}
