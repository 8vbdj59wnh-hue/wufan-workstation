export function isImprovementActionTask(task) {
  return String(task?.source ?? "") === "process";
}

export function shouldShowTaskInTaskCenter(task, filters = {}) {
  return filters.showImprovementTasks === true || !isImprovementActionTask(task);
}
