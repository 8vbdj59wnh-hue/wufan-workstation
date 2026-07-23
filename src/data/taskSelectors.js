import { TaskStatus } from "./modelOptions.js";

const taskBusinessStatusDefinitions = Object.freeze({
  [TaskStatus.Waiting]: Object.freeze({
    status: "pending",
    label: "待处理",
    actionable: false,
  }),
  [TaskStatus.Todo]: Object.freeze({
    status: "pending",
    label: "待处理",
    actionable: true,
  }),
  [TaskStatus.Doing]: Object.freeze({
    status: "running",
    label: "进行中",
    actionable: true,
  }),
  [TaskStatus.PendingAcceptance]: Object.freeze({
    status: "review",
    label: "待审核",
    actionable: true,
  }),
  [TaskStatus.Done]: Object.freeze({
    status: "done",
    label: "已完成",
    actionable: false,
  }),
  [TaskStatus.Canceled]: Object.freeze({
    status: "cancelled",
    label: "已取消",
    actionable: false,
  }),
});

export function getTaskBusinessStatus(task) {
  const technicalStatus = task?.status ?? TaskStatus.Waiting;
  const definition = taskBusinessStatusDefinitions[technicalStatus] ?? taskBusinessStatusDefinitions[TaskStatus.Waiting];

  return {
    ...definition,
    technicalStatus,
  };
}
