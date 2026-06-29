import { GoalLevel, GoalType } from "./modelOptions.js";

function findGoal(goals, goalId) {
  return goals.find((goal) => goal.id === goalId) ?? null;
}

function hasAlignmentCycle(goal, goals) {
  const visitedGoalIds = new Set([goal.id]);
  let parentGoal = goal.parentGoalId === null ? null : findGoal(goals, goal.parentGoalId);

  while (parentGoal !== null) {
    if (visitedGoalIds.has(parentGoal.id)) return true;
    visitedGoalIds.add(parentGoal.id);
    parentGoal = parentGoal.parentGoalId === null ? null : findGoal(goals, parentGoal.parentGoalId);
  }

  return false;
}

export function validateGoals(goals) {
  const errors = [];

  goals.forEach((goal) => {
    if (goal.parentGoalId === goal.id) {
      errors.push(`${goal.id}: parentGoalId 不能指向自己`);
    }

    if (goal.level === GoalLevel.Company && goal.departmentId !== null) {
      errors.push(`${goal.id}: 公司目标的 departmentId 必须为空`);
    }

    if (goal.level === GoalLevel.Department && goal.departmentId === null) {
      errors.push(`${goal.id}: 部门目标必须设置 departmentId`);
    }

    if (goal.type === GoalType.Period) {
      if (goal.periodType === null || goal.periodValue === null) {
        errors.push(`${goal.id}: 周期目标必须设置周期类型和周期值`);
      }

      if (
        goal.metricName === null ||
        goal.metricUnit === null ||
        goal.metricDirection === null ||
        goal.targetValue === null ||
        goal.currentValue === null
      ) {
        errors.push(`${goal.id}: 周期目标必须设置完整指标`);
      }
    }

    if (goal.type === GoalType.Ultimate && (goal.periodType !== null || goal.periodValue !== null)) {
      errors.push(`${goal.id}: 终极目标不需要周期`);
    }

    if (goal.parentGoalId !== null && findGoal(goals, goal.parentGoalId) === null) {
      errors.push(`${goal.id}: parentGoalId 指向不存在的目标`);
    }

    if (hasAlignmentCycle(goal, goals)) {
      errors.push(`${goal.id}: 目标对齐关系形成循环`);
    }
  });

  return errors;
}
