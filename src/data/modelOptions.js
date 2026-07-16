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

export const valueModuleList = Object.freeze([
  { id: "infrastructure_maintenance", name: "基础设施维护" },
  { id: "human_asset_management", name: "人力资产管理" },
  { id: "product_development", name: "产品开发与淘汰" },
  { id: "supply_chain_management", name: "供应链管理" },
  { id: "brand_marketing", name: "品牌营销" },
  { id: "channel_sales", name: "渠道销售" },
  { id: "customer_maintenance", name: "客户维护" },
]);

export const ValueModule = Object.freeze({
  InfrastructureMaintenance: valueModuleList[0].id,
  HumanAssetManagement: valueModuleList[1].id,
  ProductDevelopment: valueModuleList[2].id,
  SupplyChainManagement: valueModuleList[3].id,
  BrandMarketing: valueModuleList[4].id,
  ChannelSales: valueModuleList[5].id,
  CustomerMaintenance: valueModuleList[6].id,
});

export const valueModuleNames = Object.freeze(
  Object.fromEntries(valueModuleList.map((module) => [module.id, module.name])),
);

export function isValueModuleId(valueModuleId) {
  return valueModuleList.some((module) => module.id === valueModuleId);
}

export function getValueModuleName(valueModuleId, fallback = "基础设施维护") {
  return valueModuleNames[valueModuleId] ?? fallback;
}

export function inferValueModuleIdFromText(text) {
  const searchText = String(text ?? "").toLowerCase();

  if (/基础设施维护|基础设施|行政|财务|系统|设备|账号|数据|检查/.test(searchText)) return ValueModule.InfrastructureMaintenance;
  if (/人力资产管理|人力|人员|员工|招聘|入职|培训|绩效|考核|岗位/.test(searchText)) return ValueModule.HumanAssetManagement;
  if (/新品开发|产品开发与淘汰|产品开发|产品研发|产品包装|包装设计|生命周期|淘汰|研发|设计打样|打样|选品/.test(searchText)) return ValueModule.ProductDevelopment;
  if (/库存清仓|清仓|供应链管理|供应链|供应商|采购|库存|补货|仓库|交期|物流/.test(searchText)) return ValueModule.SupplyChainManagement;
  if (/发布内容|内容笔记|发布笔记|笔记|小红书|买家秀|拍摄|素材|投放|视觉|内容|品牌营销|品牌|营销/.test(searchText)) return ValueModule.BrandMarketing;
  if (/上架|上新|店铺|平台|渠道销售|渠道|销售|直播|私域|运营/.test(searchText)) return ValueModule.ChannelSales;
  if (/客户维护|客服|客户|老客|会员|复购|社群|售后|回访|退换|退款|客诉|维修/.test(searchText)) return ValueModule.CustomerMaintenance;

  return ValueModule.InfrastructureMaintenance;
}

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
  Deleted: "deleted",
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
  Done: "done",
  Canceled: "canceled",
});

export const WorkType = Object.freeze({
  Normal: "normal",
  Rectification: "rectification",
});

export const RectificationWorkTemplate = Object.freeze({
  TaskTemplateId: "task-template-rectification-work",
  ProcessTemplateId: "process-template-rectification-work",
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
  [CategoryType.Task]: "价值链模块",
  [CategoryType.Process]: "流程价值链模块",
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
  [ProcessTemplateNodeStatus.Deleted]: "已删除",
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
  [WorkPlanStatus.Done]: "已完成",
  [WorkPlanStatus.Canceled]: "已取消",
});

export const workTypeNames = Object.freeze({
  [WorkType.Normal]: "普通工作",
  [WorkType.Rectification]: "整改工作",
});
