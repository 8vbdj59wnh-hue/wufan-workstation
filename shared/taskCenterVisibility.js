export function isImprovementActionTask(task, improvementProcessInstanceIds = new Set()) {
  const processInstanceId = String(task?.processInstanceId ?? "").trim();
  return processInstanceId !== "" && improvementProcessInstanceIds.has(processInstanceId);
}

export function shouldShowTaskInTaskCenter(task, filters = {}, improvementProcessInstanceIds = new Set()) {
  return filters.showImprovementTasks === true
    || !isImprovementActionTask(task, improvementProcessInstanceIds);
}
