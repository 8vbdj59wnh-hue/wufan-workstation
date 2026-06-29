export const Status = Object.freeze({
  Active: "active",
  Inactive: "inactive",
});

export const PersonRole = Object.freeze({
  SystemAdmin: "system_admin",
  CompanyManager: "company_manager",
  DepartmentManager: "department_manager",
  Member: "member",
});

export const CategoryType = Object.freeze({
  Task: "task",
  Process: "process",
});

export const GoalLevel = Object.freeze({
  Company: "company",
  Department: "department",
});

export const GoalType = Object.freeze({
  Ultimate: "ultimate",
  Period: "period",
});

export const GoalPeriodType = Object.freeze({
  Year: "year",
  Quarter: "quarter",
  Month: "month",
});

export const MetricDirection = Object.freeze({
  GreaterThanOrEqual: "gte",
  LessThanOrEqual: "lte",
  Equal: "eq",
});

export const GoalStatus = Object.freeze({
  Active: "active",
  Completed: "completed",
  Stopped: "stopped",
  Inactive: "inactive",
});

export const TaskSource = Object.freeze({
  Direct: "direct",
  Process: "process",
});

export const TaskImportance = Object.freeze({
  Important: "important",
  NotImportant: "not_important",
});

export const TaskUrgency = Object.freeze({
  Urgent: "urgent",
  NotUrgent: "not_urgent",
});

export const TaskStatus = Object.freeze({
  Waiting: "waiting",
  Todo: "todo",
  Doing: "doing",
  PendingAcceptance: "pending_acceptance",
  Done: "done",
  Canceled: "canceled",
});

export const TaskTemplateStatus = Object.freeze({
  Active: "active",
  Inactive: "inactive",
});

export const ProcessTemplateStatus = Object.freeze({
  Active: "active",
  Inactive: "inactive",
});

export const ProcessTemplateNodeStatus = Object.freeze({
  Active: "active",
  Inactive: "inactive",
});

export const ProcessOwnerRule = Object.freeze({
  FixedPerson: "fixed_person",
  FixedPosition: "fixed_position",
  DepartmentLeader: "department_leader",
  Initiator: "initiator",
  LaunchAssign: "launch_assign",
});

export const ProcessAccepterRule = Object.freeze({
  None: "none",
  FixedPerson: "fixed_person",
  Initiator: "initiator",
  DepartmentLeader: "department_leader",
  LaunchAssign: "launch_assign",
});

export const ProcessInstanceStatus = Object.freeze({
  Running: "running",
  Done: "done",
  Stopped: "stopped",
});

export const ContentScheduleStatus = Object.freeze({
  PendingSubmit: "pending_submit",
  PendingProduction: "pending_production",
  PendingReview: "pending_review",
  PendingPublish: "pending_publish",
  Published: "published",
  Overdue: "overdue",
  Canceled: "canceled",
});

export const WorkPlanStatus = Object.freeze({
  Future: "future",
  ThisWeek: "this_week",
  Launched: "launched",
  Canceled: "canceled",
});

export const SubmitType = Object.freeze({
  None: "none",
  Form: "form",
  File: "file",
  Link: "link",
  FormFile: "form_file",
  FormLink: "form_link",
  FileLink: "file_link",
  FormFileLink: "form_file_link",
});

export const contentScheduleAccountOptions = Object.freeze([
  "半然小红书",
  "半然视频号",
  "半然公众号",
  "半然抖音",
  "阿柚",
  "小茉",
  "小满",
  "半然官方号",
]);

export const contentScheduleTypeOptions = Object.freeze([
  "图文笔记",
  "视频笔记",
  "买家秀",
  "电商视觉",
]);

export const contentSchedulePurposeOptions = Object.freeze([
  "种草引流",
  "场景教育",
  "审美表达",
  "信任建立",
  "品牌心智",
  "转化收割",
]);

export const contentScheduleAudienceOptions = Object.freeze([
  "路人",
  "兴趣人群",
  "新客",
  "老客",
  "流失顾客",
]);

export const personRoleNames = Object.freeze({
  [PersonRole.SystemAdmin]: "系统管理员",
  [PersonRole.CompanyManager]: "公司管理者",
  [PersonRole.DepartmentManager]: "部门负责人",
  [PersonRole.Member]: "普通员工",
});

export const categoryTypeNames = Object.freeze({
  [CategoryType.Task]: "工作分类",
  [CategoryType.Process]: "流程分类",
});

export const statusNames = Object.freeze({
  [Status.Active]: "启用",
  [Status.Inactive]: "停用",
});

export const goalLevelNames = Object.freeze({
  [GoalLevel.Company]: "公司目标",
  [GoalLevel.Department]: "部门目标",
});

export const goalTypeNames = Object.freeze({
  [GoalType.Ultimate]: "终极目标",
  [GoalType.Period]: "周期目标",
});

export const goalPeriodTypeNames = Object.freeze({
  [GoalPeriodType.Year]: "年度",
  [GoalPeriodType.Quarter]: "季度",
  [GoalPeriodType.Month]: "月度",
});

export const metricDirectionNames = Object.freeze({
  [MetricDirection.GreaterThanOrEqual]: "大于等于",
  [MetricDirection.LessThanOrEqual]: "小于等于",
  [MetricDirection.Equal]: "等于",
});

export const goalStatusNames = Object.freeze({
  [GoalStatus.Active]: "进行中",
  [GoalStatus.Completed]: "已完成",
  [GoalStatus.Stopped]: "已终止",
  [GoalStatus.Inactive]: "停用",
});

export const taskSourceNames = Object.freeze({
  [TaskSource.Direct]: "标准工作发起",
  [TaskSource.Process]: "流程步骤生成",
});

export const taskImportanceNames = Object.freeze({
  [TaskImportance.Important]: "重要",
  [TaskImportance.NotImportant]: "不重要",
});

export const taskUrgencyNames = Object.freeze({
  [TaskUrgency.Urgent]: "紧急",
  [TaskUrgency.NotUrgent]: "不紧急",
});

export const taskStatusNames = Object.freeze({
  [TaskStatus.Waiting]: "待执行",
  [TaskStatus.Todo]: "待执行",
  [TaskStatus.Doing]: "执行中",
  [TaskStatus.PendingAcceptance]: "待审核",
  [TaskStatus.Done]: "已完成",
  [TaskStatus.Canceled]: "已取消",
});

export const submitTypeNames = Object.freeze({
  [SubmitType.None]: "无需提交",
  [SubmitType.Form]: "填写表单",
  [SubmitType.File]: "上传文件",
  [SubmitType.Link]: "填写链接",
  [SubmitType.FormFile]: "表单 + 文件",
  [SubmitType.FormLink]: "表单 + 链接",
  [SubmitType.FileLink]: "文件 + 链接",
  [SubmitType.FormFileLink]: "表单 + 文件 + 链接",
});

export const taskTemplateStatusNames = Object.freeze({
  [TaskTemplateStatus.Active]: "启用",
  [TaskTemplateStatus.Inactive]: "停用",
});

export const processTemplateStatusNames = Object.freeze({
  [ProcessTemplateStatus.Active]: "启用",
  [ProcessTemplateStatus.Inactive]: "停用",
});

export const processTemplateNodeStatusNames = Object.freeze({
  [ProcessTemplateNodeStatus.Active]: "启用",
  [ProcessTemplateNodeStatus.Inactive]: "停用",
});

export const processOwnerRuleNames = Object.freeze({
  [ProcessOwnerRule.FixedPerson]: "固定人员",
  [ProcessOwnerRule.FixedPosition]: "固定岗位",
  [ProcessOwnerRule.DepartmentLeader]: "部门负责人",
  [ProcessOwnerRule.Initiator]: "发起人",
  [ProcessOwnerRule.LaunchAssign]: "发起时指定",
});

export const processAccepterRuleNames = Object.freeze({
  [ProcessAccepterRule.None]: "无需验收",
  [ProcessAccepterRule.FixedPerson]: "固定人员",
  [ProcessAccepterRule.Initiator]: "发起人",
  [ProcessAccepterRule.DepartmentLeader]: "部门负责人",
  [ProcessAccepterRule.LaunchAssign]: "发起时指定",
});

export const processInstanceStatusNames = Object.freeze({
  [ProcessInstanceStatus.Running]: "进行中",
  [ProcessInstanceStatus.Done]: "已完成",
  [ProcessInstanceStatus.Stopped]: "已终止",
});

export const contentScheduleStatusNames = Object.freeze({
  [ContentScheduleStatus.PendingSubmit]: "待提交",
  [ContentScheduleStatus.PendingProduction]: "待制作",
  [ContentScheduleStatus.PendingReview]: "待审核",
  [ContentScheduleStatus.PendingPublish]: "待发布",
  [ContentScheduleStatus.Published]: "已发布",
  [ContentScheduleStatus.Overdue]: "已超时",
  [ContentScheduleStatus.Canceled]: "已取消",
});

export const workPlanStatusNames = Object.freeze({
  [WorkPlanStatus.Future]: "未来工作",
  [WorkPlanStatus.ThisWeek]: "本周工作",
  [WorkPlanStatus.Launched]: "已发起",
  [WorkPlanStatus.Canceled]: "已取消",
});
