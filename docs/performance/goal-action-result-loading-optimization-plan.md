# V2-PERFORMANCE-010 目标、关键行动、工作结果数据加载优化方案评估

## 1. 结论摘要

目标管理、关键行动、工作结果仍是全局数据快照退出工作的核心遗留模块，但三者不应合并成一个新的“大工作管理快照”。它们共享目标、行动、任务身份和状态口径，读取契约仍应按页面职责拆分：

- 目标管理：轻量目标树/分页列表 → 单目标摘要 → 关联任务和关键行动按需分页。
- 关键行动：摘要 → 服务端筛选分页或可见日期窗口 → 行动详情按 scope 加载。
- 工作结果：管理摘要 → 当前 Tab 的分页列表 → 结果、周报、问题或人员明细按需加载。

当前生产只读审计基线中，目标管理和工作结果进入页面时都下载约 25.16 MB 的 `/api/data`；关键行动通过 `scheduleBoard` bootstrap 下载约 15.13 MB，虽然没有走 `/api/data`，仍把任务、流程实例和工作计划全集交给浏览器聚合。三者都不符合“列表分页、详情按需、Tab 懒加载、统计摘要”的原则。

建议按“公共只读规则提取 → 目标 → 关键行动 → 工作结果 → 移除快照回退”的顺序实施。每个阶段要求首次业务 JSON `<1 MB`，列表和详情接口 P50 `<500 ms`，同时冻结目标层级、行动流程、任务关系与评价规则。

本报告只分析源码、已有审计结果和只读数据基线；未修改代码、接口、数据库或业务数据。

## 2. 审计口径与范围

- 代码版本：`60a4b2996bc5085599e1f3a3136afdd7cf2f45f9`。
- 数据量基线沿用 Performance-005/006 的生产只读副本实测：`/api/data` 25,158,822 B；任务/行动业务全集约 15.13 MB。
- 任务中心已经在提交 `9c98b18` 中接入分页列表和按需详情。本报告只把任务视为目标、行动、工作结果的关联对象，不重复设计任务中心。
- “关键行动”指 `scheduleBoardPage.js` 中由 `workPlans + processInstances + tasks` 形成的行动管理页面；`processesPage.js` 主要是行动标准/流程模板管理，不应与行动实例列表混成同一读取接口。
- 数据量是未压缩 JSON，页面实际传输大小受 HTTP 压缩影响，但浏览器仍需承担解压、解析和内存成本。

## 3. 当前加载方式

### 3.1 路由与接口

|模块|进入页面的接口|启动数据|审计大小|用途|
|-|-|-:|-:|-|
|目标管理|`GET /api/data`|36 类全局资源；页面实际使用 goals、tasks、processInstances、workPlans 及组织/模板字典|约 25.16 MB|目标树、目标列表、所选目标详情、关联任务、关联行动、发起行动表单|
|关键行动|`GET /api/bootstrap?module=scheduleBoard`|默认公共资源 + goals、tasks、processInstances、workPlans、模板/节点、contentSchedules、actionProducts，并生成任务产品上下文|约 15.13 MB|时间格子、行动卡片/列表、进度、负责人、搜索、详情和操作判断|
|工作结果|`GET /api/data`|全局资源；页面实际使用 tasks、processInstances、workPlans、weeklyReports、weeklyReportProblems 及组织/模板/目标字典|约 25.16 MB|今日概览、指标、改善、人员/部门统计、周报、问题、人员档案|

三个模块进入后没有页面级分页请求。目标和工作结果直接依赖全局快照；关键行动虽然使用轻量入口名，返回内容仍是业务全集。

### 3.2 关键集合基线

Performance-005/008 的同一生产只读基线：

|集合|数量|JSON大小|三个模块中的用途|
|-|-:|-:|-|
|tasks|5,934|10,267,901 B|目标关联任务、行动进度/当前节点、工作结果评价和异常|
|processInstances|1,027|1,396,296 B|关键行动状态、编码、标题、周期和完成结果|
|workPlans|958|1,117,256 B|行动计划、目标归属、标准、来源与改善关系|
|processTemplateNodes|370|515,064 B|行动详情步骤、当前节点和表单要求；不应进入普通列表|
|notifications|2,623|1,290,521 B|应用壳通知；不是上述三个页面的业务列表数据|
|taskProductContexts|640|400,071 B|行动/任务详情的产品关系；不应进入首屏|
|actionProducts|640|146,008 B|行动关联产品；列表只需数量或少量摘要|
|taskTemplates|88|101,438 B|行动标准名称与发起选项|
|goals|14|7,335 B|目标树和行动/任务归属显示|

任务、行动实例和工作计划三类已经超过 12.78 MB。真正问题不是 goals 本身，而是为显示目标或结果页面提前加载了完整执行链及无关的商品、ERP、通知、模板历史数据。

## 4. 前端首次使用与详情使用

### 4.1 目标管理

#### 列表/目标树首次需要

- `goalId`、业务编码、名称；
- 父目标 ID、层级、类型；
- 状态、周期；
- 负责人/部门摘要；
- 指标当前值、目标值、单位、达标方向；
- 轻量派生值：子目标数、关联任务数、关联关键行动数、完成进度；
- 当前用户的查看、编辑、停用、发起行动权限摘要。

目标对齐图需要完整的轻量树节点，但不需要每个目标的任务、流程实例、附件、表单或产品关系。当前只有约 14 个目标，全树接口是合理的；同时存在的“目标列表”仍应提供服务端分页，避免未来目标历史增长后全量渲染。

#### 详情按需需要

- 目标完整说明和指标信息；
- 关联任务列表；
- 关联关键行动列表及服务端派生的当前节点、进度和负责人；
- 用户进一步选择某个行动后才加载流程节点、任务、表单、附件和过程详情；
- 点击“发起关键行动”后才加载行动标准、流程模板、人员、部门、产品选择项和表单定义。

当前 `renderGoalDetail()` 在选中目标时直接从全量 `state.tasks` 和 `state.processInstances` 过滤，且选择行动后继续使用全局流程/任务全集渲染详情，属于详情数据提前加载。

### 4.2 关键行动

#### 列表/卡片/时间格子首次需要

- 行动 ID、编码、标题、状态、类型；
- 目标、行动标准、价值链分类摘要；
- 负责人、当前执行人、部门；
- 开始时间、截止时间、是否逾期；
- 当前步骤、完成步骤数/总步骤数；
- 关联产品数量/缩略图摘要；
- 服务端计算的可操作权限摘要。

当前 `buildRows()` 会遍历全部 `workPlans`，对每项查找 `processInstance`、筛选同流程 tasks，再计算进度、当前任务、负责人和时间位置。搜索行动编码/任务编码还会扫描 `processInstances` 和 `tasks` 全集。这些规则必须迁移到后端列表 Read Model 后再分页，不能简单前端 `slice()`。

时间格子视图不适合普通页码分页，应以可见日期窗口查询，例如当前 7 天或 14 天；无截止日期列单独分页。卡片和列表视图使用服务端分页，默认 50、最大 100。

#### 详情按需需要

- 行动完整基本信息和来源快照；
- 流程节点与各节点状态；
- 当前行动下任务；
- 公共/提交表单、结果、附件、动态记录；
- 产品关系；
- 经营改善结果等特定业务扩展。

这些内容只在打开详情或进入对应详情区块后请求。行动详情可以分 `summary / workflow / tasks / forms / attachments / business-result` scope，并按 scope 缓存。

### 4.3 工作结果

#### 首次需要

默认“工作结果”页面实际首先需要的是管理摘要，而不是任务全集：

- 今日新发起行动、完成行动、异常、完成改善数量；
- 当前周期任务/行动/改善摘要；
- 少量重点问题；
- 部门摘要与人员档案入口；
- 当前用户可见数据范围和筛选选项。

当前页面会在浏览器重复扫描 tasks、processInstances、workPlans 并计算今日概览、同比、准时率、逾期、返工、验收退回、改善状态和重点问题。不同 Tab 共享同一全局快照，切 Tab 不减少首次数据。

#### 列表/详情按需需要

- 今日概览：点击某张卡后加载该分类的当天明细，分页；
- 改善工作：行动/工作计划摘要列表，打开后加载流程与任务详情；
- 人员/部门结果：服务端聚合列表，打开人员档案再加载其任务和行动明细；
- 周报：按周期、部门、状态分页；查看/编辑时加载完整周报；
- 问题：按状态、部门、类型分页；详情按 ID 加载；
- 评价与过程记录：只在具体任务/行动详情加载。

工作结果最适合采用“摘要 → 当前 Tab 列表 → 对象详情”三层契约，不能把统计摘要建立在浏览器持有执行全集的前提上。

## 5. `/api/data` 依赖清单

|模块|是否仍依赖 `/api/data`|实际读取字段|隐藏依赖|
|-|-|-|-|
|目标管理|是|companies（间接）、departments、people、categories、stores、goals、tasks、taskTemplates、processTemplates、processTemplateNodes、processInstances、workPlans、products、templates|发起行动表单、产品选择、行动详情仍假定相关集合已在 state|
|关键行动|否，但依赖等价的宽 `scheduleBoard` bootstrap|companies、departments、positions、people、categories、goals、tasks、processInstances、workPlans、taskTemplates、processTemplates/nodes、contentSchedules、actionProducts、taskProductContexts、templates、notifications 等公共项|所有列表派生值、编码搜索和详情都依赖全集；宽 bootstrap 是“快照换名”，不是完成拆除|
|工作结果|是|departments、goals、people、positions、processInstances、processTemplateNodes、taskTemplates、tasks、weeklyReports、weeklyReportProblems、workPlans|摘要、同比、问题和改善均在前端计算；写后直接更新全局数组|

三个模块不得继续把部分模块响应交给 `applyDataSnapshot()`，避免未返回的集合被错误清空或再次诱发全局刷新。应各自维护 query、pagination、summary、detail cache 和 tab loaded state。

## 6. 目标管理优化设计

### 6.1 推荐查询链

```text
权限/小型选项
→ 轻量目标树或分页目标列表
→ 选中目标 summary
→ 关联任务、关键行动分别按需分页
→ 选中行动后加载行动详情 scope
```

### 6.2 是否需要分页、摘要、详情

- 服务端分页：需要。用于目标列表和停用/历史目标；默认 50，最大 100。
- 轻量目标树：需要。为了保持父子层级，一次返回当前有效范围的轻量节点；不携带关联对象。
- 摘要接口：需要。返回目标指标、进度和关联数量，进度规则复用现有逻辑。
- 详情接口：需要。基础详情与 tasks/actions scope 分离。

### 6.3 API建议

|接口|用途|关键返回|
|-|-|-|
|`GET /api/goal-center/tree?includeInactive=false`|目标对齐图|轻量节点、层级、负责人/部门摘要、指标摘要|
|`GET /api/goal-center/goals?page&pageSize&keyword&status&level&ownerId&sort`|目标列表|当前页目标行、权限过滤后的 total|
|`GET /api/goal-center/goals/:id`|目标基础详情|目标完整字段、关联数量、权限摘要|
|`GET /api/goal-center/goals/:id/tasks?page&pageSize&status&sort`|关联任务|任务列表摘要；复用任务状态与权限规则|
|`GET /api/goal-center/goals/:id/key-actions?page&pageSize&status&sort`|关联关键行动|行动摘要、当前步骤、进度、负责人|
|`GET /api/goal-center/options?scope=create-action`|按需表单选项|人员、部门、可发起行动标准；仅打开表单时调用|

目标状态、父子校验、进度和权限过滤必须在服务端复用现有规则。前端只展示返回结果，不重新定义状态。

## 7. 关键行动优化设计

### 7.1 推荐查询链

```text
关键行动摘要
→ 当前视图查询
   ├─ 列表/卡片：服务端分页
   └─ 时间格子：可见日期窗口 + 无日期分页
→ 点击行动读取 summary
→ 进入详情区块读取 workflow/tasks/forms/attachments
```

### 7.2 列表 Read Model

建议返回单行完整展示摘要，而不是将 workPlan、processInstance、tasks 三套原始对象下发后再拼接：

```json
{
  "keyActionId": "...",
  "actionCode": "...",
  "title": "...",
  "status": "...",
  "goal": { "id": "...", "name": "..." },
  "standard": { "id": "...", "name": "..." },
  "owner": { "id": "...", "name": "..." },
  "currentExecutor": { "id": "...", "name": "..." },
  "startAt": "...",
  "dueAt": "...",
  "overdue": false,
  "progress": { "completed": 2, "total": 5 },
  "currentStep": { "id": "...", "name": "..." },
  "productSummary": { "count": 2, "thumbnail": "..." },
  "availableActions": ["view", "edit"]
}
```

### 7.3 API建议

|接口|用途|
|-|-|
|`GET /api/key-action-center/summary?scope&from&to`|当前视图数量、逾期、运行中、待执行摘要|
|`GET /api/key-action-center/actions?page&pageSize&keyword&filters&sort`|列表与卡片服务端分页|
|`GET /api/key-action-center/timeline?from&to&filters`|仅返回可见日期窗口中的格子项目|
|`GET /api/key-action-center/no-due-date?page&pageSize&filters`|无截止日期行动分页|
|`GET /api/key-action-center/actions/:id`|行动基础详情|
|`GET /api/key-action-center/actions/:id/workflow`|流程节点与状态|
|`GET /api/key-action-center/actions/:id/tasks?page&pageSize`|行动任务|
|`GET /api/key-action-center/actions/:id/forms`|公共表单和提交要求|
|`GET /api/key-action-center/actions/:id/attachments?page&pageSize`|附件和过程记录|

`currentStep`、进度、负责人、逾期、可操作权限必须由现有 selector/权限规则抽成服务端共享只读函数。迁移过程中不要同时保留一套前端新算法。

## 8. 工作结果优化设计

### 8.1 推荐查询链

```text
当前用户数据范围 + 今日/当前周期摘要
→ 仅请求当前Tab
→ 列表服务端分页
→ 查看对象时按ID读取详情
```

### 8.2 API建议

|接口|用途|说明|
|-|-|-|
|`GET /api/work-results/overview?date`|今日概览与重点问题|服务端聚合，卡片只返回 count 和少量 top items|
|`GET /api/work-results/metrics?period&startDate&endDate&departmentId&personId&goalId`|同比与周期指标|统一时区、状态、评价规则|
|`GET /api/work-results/today/:category?page&pageSize`|今日概览分类明细|started-actions、completed-actions、exceptions、completed-improvements|
|`GET /api/work-results/improvements?page&pageSize&filters&sort`|改善工作列表|返回行动/任务摘要，不返回完整流程|
|`GET /api/work-results/people?page&pageSize&filters&sort`|人员结果列表|服务端聚合任务、行动和评价数量|
|`GET /api/work-results/departments?page&pageSize&filters&sort`|部门结果列表|服务端聚合并带周报状态|
|`GET /api/work-results/reports?page&pageSize&weekStart&departmentId&status`|周报列表|详情按 `/reports/:id` 读取|
|`GET /api/work-results/problems?page&pageSize&filters&sort`|问题列表|详情按 `/problems/:id` 读取|
|`GET /api/work-results/people/:id?scope=summary|tasks|actions`|人员档案详情|tasks/actions scope 独立分页|

### 8.3 摘要口径保护

下列规则不得在优化时重新定义：任务完成/取消判定、逾期判断、提交结果判定、返工与验收退回记录、改善工作来源与状态、人员/部门数据范围、周报周期和问题状态。建议先把现有纯计算函数提取为服务端可测试的 Domain Read Model，再接 API。

## 9. 性能目标与验收方法

|指标|目标|
|-|-:|
|三个模块首次业务 JSON|各 `<1 MB`|
|列表默认页大小|50|
|列表最大页大小|100|
|列表接口 P50|`<500 ms`|
|列表接口 P95|`<1 s`|
|基础详情 P50|`<500 ms`|
|隐藏 Tab 请求数|0|
|时间格子查询范围|仅当前可见日期窗口|
|列表返回的原始任务/流程全集|0|

验收必须在相同生产副本、相同管理员权限和相同筛选下比较：

1. 优化前后的目标树、列表 total、排序和指标一致；
2. 关键行动状态、进度、当前节点、负责人、逾期与时间位置一致；
3. 工作结果所有指标、同比、问题、改善、周报和人员/部门统计一致；
4. 管理员、部门范围、个人范围三种权限结果一致；
5. 首次请求体积、SQL耗时、聚合耗时、序列化耗时分别记录；
6. 页面保存、完成、取消、验收后只刷新当前摘要/当前页，不触发 `/api/data`；
7. 快速切换路由和 Tab 时旧请求不得覆盖新页面。

## 10. 风险与控制措施

|风险|影响|控制措施|
|-|-|-|
|目标树被错误分页|父子节点丢失，层级错误|树接口返回轻量完整节点；列表接口单独分页|
|前后端各自计算行动状态|同一行动出现不同状态|提取并复用现有 selector 规则；建立新旧结果逐项比较测试|
|任务分页后无法计算行动进度|进度或当前节点错误|行动 Read Model 在服务端聚合全部相关任务，只返回摘要；详情任务再分页|
|工作结果聚合口径漂移|评价、同比、改善数据变化|冻结状态集合、时间边界与数据范围；对全量旧结果做影子比较|
|权限只在前端过滤|total 或明细越权|所有列表和聚合先执行权限/数据范围过滤，再统计、排序、分页|
|模块缓存短暂不一致|操作后列表与详情不同步|写接口返回更新对象和受影响摘要；失效当前页/详情，不刷新全局快照|
|字典接口再次变成大快照|体积问题复发|按操作 scope 获取小型 options，并设置字段白名单和体积测试|
|历史附件/表单进入列表|响应随历史线性增长|列表契约禁止富文本、附件、动态、完整 customFields 和流程节点|

## 11. 实施顺序

### Phase 0：规则与基线冻结

- 固化目标层级、关键行动状态/进度/负责人、工作结果评价和权限范围的旧结果样本。
- 建立 `/api/data` 与宽 `scheduleBoard` bootstrap 的请求/字段基线。
- 提取只读 Domain 计算函数；不改变写入或状态机。

验收：相同输入的新 Read Model 与现有页面计算逐项一致。

### Phase 1：目标管理

- 建目标树、分页列表、基础详情、关联任务/行动接口。
- 发起行动选项在打开表单时加载。
- 目标路由从 `/api/data` 退出。

选择目标优先的原因：目标自身数据小、层级清晰，可先验证“全局 state → 模块缓存”模式，且风险低于行动和评价聚合。

### Phase 2：关键行动

- 建行动摘要、分页列表、时间窗口和无日期分页接口。
- 详情按 scope 加载。
- 取消 `scheduleBoard` bootstrap 中 tasks、processInstances、workPlans、process nodes、actionProducts 和 taskProductContexts 全集。

验收重点：时间格子、行动列表/卡片、搜索、进度、当前节点和权限完全一致。

### Phase 3：工作结果

- 建今日/周期摘要和各 Tab 独立接口。
- 周报、问题、改善、人员/部门结果分页，详情按需。
- 工作结果路由从 `/api/data` 退出。

工作结果最后实施，因为它同时依赖任务、行动、改善、周报和问题口径，可直接复用前两阶段稳定后的摘要能力。

### Phase 4：写后刷新与防回归

- 三个模块的写操作改为局部合并或刷新当前查询。
- 添加静态守卫：这些路由不得调用 `/api/data`；scheduleBoard bootstrap 不得再携带执行全集。
- 观察一个发布周期后，再评估 `/api/data` 的 Legacy/Admin 定位。

## 12. 最终建议

三个模块都应优化，但不能用一个统一大接口解决。目标管理采用“轻量树 + 分页列表 + scope详情”，关键行动采用“服务端 Read Model + 分页/日期窗口 + scope详情”，工作结果采用“服务端摘要 + Tab分页 + 对象详情”。

推荐第一实施批次只做目标管理；第二批处理关键行动；第三批处理工作结果。这样能够先移除两个 25.16 MB 全局快照入口，再拆除约 15.13 MB 的宽行动 bootstrap，同时把状态、流程、关系与评价风险隔离在各自阶段。

本阶段未实施任何优化，未修改数据库、业务逻辑、接口或生产数据。
