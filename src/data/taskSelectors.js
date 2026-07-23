import { TaskStatus } from "./modelOptions.js";

const taskBusinessStatusDefinitions = Object.freeze({
  [TaskStatus.Waiting]: Object.freeze({
    status: TaskStatus.Waiting,
    label: "排队中",
  }),
  [TaskStatus.Todo]: Object.freeze({
    status: TaskStatus.Todo,
    label: "待执行",
  }),
  [TaskStatus.Doing]: Object.freeze({
    status: TaskStatus.Doing,
    label: "执行中",
  }),
  [TaskStatus.PendingAcceptance]: Object.freeze({
    status: TaskStatus.PendingAcceptance,
    label: "待审核",
  }),
  [TaskStatus.Done]: Object.freeze({
    status: TaskStatus.Done,
    label: "已完成",
  }),
  [TaskStatus.Canceled]: Object.freeze({
    status: TaskStatus.Canceled,
    label: "已取消",
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
