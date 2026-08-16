# V2-PERFORMANCE-008 任务中心数据加载优化方案评估

## 1. 结论摘要

任务中心当前并不是单一 15.13 MB 请求，而是进入任务路由时并行加载：

- `GET /api/bootstrap?module=tasks`：15,534,553 bytes；
- `GET /api/task-waves`：217,935 bytes；
- 合计：15,752,488 bytes，约 15.75 MB（未压缩）。

其中任务全集 5,934 条，占 bootstrap 的 66.10%；流程实例、通知和工作计划合计占 24.49%。当前任务列表、筛选、排序、状态判断、关键行动归属、前序任务和波次判断都在浏览器基于全集计算，列表和详情没有真正分层。

推荐目标架构：

`任务最小 bootstrap → 服务端分页任务列表 → 当前任务详情按需 → 波次 Tab 按需 → 操作返回增量`

优化不能只是给 `state.tasks` 做前端分页。今天、我的、逾期、全部、权限范围、流程是否开始、波次超时、行动编码/模板编码搜索都必须在服务端以当前业务规则计算后再分页，否则 total、排序与页面结果会改变。

建议首次任务列表控制在 50 条，响应包含列表展示所需的派生摘要，不把 1,027 个流程实例、958 个工作计划、159 个波次和 640 条产品上下文全部下发。目标为首次业务 JSON 小于 1 MB，列表接口 P50 小于 500 ms、P95 小于 1 s。

本阶段只读分析，未修改代码、API或数据库。

## 2. 当前加载链

### 2.1 路由进入

进入 `#tasks` 或 `#task-list` 时：

1. `main.js` 调用 `loadPersistentData({ includeTaskWaves: true })`；
2. `appState.js` 并行请求 tasks bootstrap 和 task-waves；
3. 服务端 bootstrap 读取 common 资源，再附加 goals、tasks、process definitions、processInstances、workPlans、contentSchedules、actionProducts；
4. 服务端随后根据整个 scoped snapshot 批量生成 `taskProductContexts`；
5. 前端 `applyDataSnapshot` 深拷贝所有数组到全局 state；
6. `tasksPage.js` 从 `state.tasks` 进行筛选、排序并渲染所有匹配行/卡片；
7. 默认页面同时渲染列表和所选任务详情，详情也直接使用已下载全集。

### 2.2 当前请求

|请求|用途|是否按需|
|-|-|-|
|`/api/bootstrap?module=tasks`|任务、流程、工作计划、通知、模板、产品上下文等全集|否|
|`/api/task-waves`|所有当前用户可见波次摘要|否；进入任务列表也加载|
|`/api/task-waves/:id`|波次详情和成员结果|是，选中波次后加载|
|`/api/tasks/:id`|单任务详情|接口已存在，但当前主页面详情未使用；仍直接从 state 取|
|模板列表|编辑任务并打开模板选择器后加载|是|

## 3. 数据量分析

测试基线：生产数据库只读副本；管理员权限；原始 JSON 大小，不含静态资源和压缩。

|数据|数量|JSON大小|占任务 bootstrap|当前用途|
|-|-:|-:|-:|-|
|tasks|5,934|10,267,901 B|66.10%|列表、筛选、排序、详情、前序任务、流程进度、权限/操作判断|
|processInstances（关键行动实例）|1,027|1,396,296 B|8.99%|任务归属、行动标题/编码、截止时间、流程状态、详情|
|notifications|2,623|1,290,521 B|8.31%|全局通知铃铛；不是任务列表数据|
|workPlans|958|1,117,256 B|7.19%|行动截止时间、模板编码搜索、行动发起/改善关联|
|processTemplateNodes|370|515,064 B|3.32%|流程步骤排序、提交要求、流程进度、创建/编辑|
|taskProductContexts|640|400,071 B|2.58%|任务详情关联产品与图片|
|actionProducts|640|146,008 B|0.94%|行动关联产品；用于构造任务产品上下文|
|taskTemplates|88|101,438 B|0.65%|归属标准、表单字段、创建/编辑选项|
|contentSchedules|89|63,079 B|0.41%|发布内容/清仓等特定业务场景|
|templates|91|59,652 B|0.38%|视觉模板；当前已有弹窗打开时再加载逻辑，却仍进入 common|
|processTemplates|86|53,232 B|0.34%|关键行动流程名称、创建/编辑|
|people|16|41,818 B|0.27%|负责人、执行人显示和筛选|
|standardWorkForms|23|27,384 B|0.18%|详情/提交表单|
|issuesRequirements|36|25,896 B|0.17%|公共问题/需求能力，与任务首列无直接关系|
|goals|14|7,335 B|0.05%|任务筛选和归属显示；当前任务列表已隐藏目标筛选|
|其它小型组织/标签资源|—|约 20 KB|约0.1%|权限、字典和表单选项|
|taskWaves（独立响应）|159|217,935 B|不计入 bootstrap|波次 Tab、任务行波次锁定、超时状态|

### 3.1 主要体积结论

- tasks + processInstances + notifications + workPlans = bootstrap 的 90.59%。
- `taskProductContexts` 是对整个任务/行动范围计算的富详情数据，不应进入首屏列表。
- notifications 属于应用壳，不应把2,623条历史通知作为任务模块业务数据加载；首屏只需未读摘要和少量最近通知。
- 任务波次只占约218 KB，但它使任务列表的状态判断依赖波次全集，并在任意任务路由首入时加载。

## 4. 前端实际使用分析

## 4.1 列表展示

当前表格/卡片直接需要：

- task id、businessCode、name、taskType；
- status、reviewStatus；
- dueDate；
- ownerId、executorId；
- cover/image 摘要；
- 归属对象名称、关键行动标准名称、关键行动标题；
- 当前业务状态；
- 是否逾期及剩余时间；
- 是否属于 active wave、wave id/businessCode/status；
- 当前用户是否可编辑、取消、恢复、退回、开始、提交、验收；
- 当前页选择状态。

这些字段不要求前端持有完整 processInstance、workPlan、wave、process nodes 或全部同流程任务。服务端可以返回列表 Read Model：

```json
{
  "id": "...",
  "businessCode": "...",
  "name": "...",
  "taskType": "...",
  "status": "...",
  "businessStatus": { "status": "...", "label": "..." },
  "dueDate": "...",
  "owner": { "id": "...", "name": "..." },
  "executor": { "id": "...", "name": "...", "avatarUrl": "..." },
  "coverImage": "...",
  "belonging": {
    "objectName": "...",
    "standardWorkName": "...",
    "actionId": "...",
    "actionCode": "...",
    "actionTitle": "..."
  },
  "timing": { "overdue": false, "remainingMinutes": 120, "label": "剩余2小时" },
  "activeWave": { "id": "...", "businessCode": "...", "status": "..." },
  "availableActions": ["view", "start", "cancel"]
}
```

`availableActions` 应由服务端复用现有 `canViewTask/canOperateTask` 规则生成，页面不再用不完整摘要重新推导权限。

## 4.2 筛选

当前任务列表视图：

- 今天：未完成，且截止日为今天或状态为 doing；
- 我的：未完成，且 executor 为当前用户；
- 逾期：未完成且 `isTaskExecutionOverdue`；
- 全部：不限制视图，但默认隐藏 done/canceled；
- 关键词：任务名、任务编码、行动编码、模板编码、归属对象、标准名称、部门、人员；
- 状态、部门、负责人、执行人、逾期；
- 显示已完成、显示已取消。

服务端必须完整复刻这些规则。特别是：

- “任务编码/行动编码/模板编码”当前具有精确标识搜索分支；
- 模板编码搜索会扫描 processInstances 与 workPlans 的 linked template IDs；
- 流程任务只有在所属行动已出现执行证据时才显示；
- 清仓任务从普通任务列表排除；
- 逾期优先使用波次 deadline/submittedAt，再回退 task dueDate 和 overdue record；
- 权限过滤必须在分页和 total 计算之前完成。

这些规则适合抽取为服务端 Query Capability，而不是复制一份近似 SQL。

## 4.3 排序

当前支持：

- `remaining`：按截止/剩余时间规则排序；
- `name`：中文名称排序，并保持稳定原顺序。

排序必须在服务端分页前完成。需要为 null dueDate、wave deadline、已提交 wave、完成/取消状态定义与当前前端一致的 sort key。

## 4.4 状态计算

首屏状态当前依赖：

- task.status、task review 字段；
- 同一 processInstance 下所有任务，用于判断流程是否已经开始；
- process node 顺序，用于当前任务和退回规则；
- active wave 与 wave 时间，用于锁定、超时和剩余时间；
- processInstance/workPlan dueDate；
- customFields 中的 overdue record、return records 等。

建议列表接口只返回计算结果；完整证据保留在详情/操作服务端。不要为了在浏览器重算状态把整组任务和流程节点下发。

## 4.5 详情展示

详情需要但列表不需要的内容：

- 完整 task 描述、完成标准、审核标准；
- 提交要求、表单 schema 与提交值；
- 结果说明、附件、文件、链接；
- 退回历史和前一步任务完整提交；
- 关键行动完整字段、附件、关联模板；
- 产品/ERP SKU 关联、图片；
- 流程节点、前后任务和当前操作规则；
- 审核任务的目标任务及提交结果；
- 方法论/标准步骤信息。

当前已有 `GET /api/tasks/:id`，但只返回任务资源本身，无法覆盖上述组合详情。建议保留兼容接口，同时新增或扩展 scope 化详情：

- `GET /api/tasks/:id?scope=summary`；
- `GET /api/tasks/:id?scope=execution`；
- `GET /api/tasks/:id?scope=submission`；
- `GET /api/tasks/:id?scope=relations`；
- 或一次返回任务详情 Read Model，但仅在用户点击/选中任务时请求。

如果页面仍默认显示列表下方首条详情，首屏会增加1次详情请求。为严格满足 <1 MB，建议默认只显示列表，点击任务再开详情；若产品要求必须默认详情，应只自动请求当前页第一条 summary，并延迟附件/关系 scope。

## 5. 服务端分页方案

## 5.1 接口契约

建议：

`GET /api/tasks?view=mine&page=1&pageSize=50&keyword=&status=&departmentId=&ownerId=&executorId=&overdue=&showDone=false&showCanceled=false&sort=remaining`

返回：

```json
{
  "success": true,
  "query": { "view": "mine", "page": 1, "pageSize": 50, "sort": "remaining" },
  "summary": {
    "today": 0,
    "mine": 0,
    "overdue": 0,
    "all": 0
  },
  "page": {
    "items": [],
    "total": 0,
    "page": 1,
    "pageSize": 50,
    "hasNext": false
  },
  "options": {
    "departments": [],
    "people": []
  },
  "dataVersion": "..."
}
```

视图数量可独立走 summary 接口，避免每次键入搜索都重算四个全局 count。默认页建议 50，最大 pageSize 100。

## 5.2 查询步骤

1. 根据用户权限生成可见任务范围；
2. 排除普通列表不应显示的清仓任务；
3. 应用 view 与 filters；
4. 计算业务状态、波次状态和排序键；
5. 计算 total；
6. 排序并分页；
7. 只对当前页水合人员、归属行动、模板名称、图片和 availableActions；
8. 返回轻量摘要。

不要先读取5,934条完整任务对象再在 Node 内分页。若第一版无法一次完成复杂 SQL，可先以最小列查询 + 服务端批量关系查询实现，但必须避免读取任务的大 JSON 字段和 N+1。

## 5.3 今天/我的/逾期/全部

|视图|服务端条件|注意事项|
|-|-|-|
|today|非 done/canceled；businessDate(dueDate)=today 或 status=doing|使用上海业务日期口径|
|mine|非 done/canceled；resolved executor=current person|executor 解析必须与 `getTaskExecutorId` 一致|
|overdue|非 done/canceled；computed overdue=true|先考虑 active/history wave 时间，再考虑 task dueDate/记录|
|all|权限范围内全部；默认隐藏 done/canceled|showDone/showCanceled 控制历史状态|

## 5.4 搜索与索引评估

不在本阶段新增索引，但实施前应对以下字段检查执行计划：

- tasks: status、dueDate、ownerId、executorId、departmentId、processInstanceId、businessCode；
- process_instances: businessCode、taskTemplateId、standardWorkId；
- work_plans: processInstanceId、taskTemplateId；
- task_waves 与成员表：taskId、status、deadlineAt；
- templates/business codes 的精确查询字段。

模糊关键词可先用受控 LIKE/FTS 方案评估；任务编码、行动编码、模板编码应优先走精确索引查询。

## 6. 关联数据加载设计

|关联数据|当前是否启动加载|目标策略|
|-|-|-|
|流程实例/关键行动|全量1,027条|列表只返回归属摘要；任务详情按 task.processInstanceId 取行动 summary；关键行动完整详情点击后加载|
|工作计划|全量958条|列表只返回计算后的 actionDeadline/template match 字段；详情或行动页面再加载|
|流程节点|全量370条|列表返回业务状态/步骤摘要；创建、编辑、详情需要时按 template/instance 批量加载|
|任务波次|全量159条，独立请求|任务列表行只水合当前页 active wave 摘要；波次 Tab 首次进入才分页加载；详情继续按 id|
|任务产品关系|全量640条上下文|列表只返回最多1张封面或 `hasProducts/productCount`；详情按 task/action 加载完整 Product/ERP 关系|
|actionProducts|全量640条|不进入任务首屏；服务端用于当前页封面水合或详情查询|
|通知|全量2,623条|应用壳只加载 unreadCount + 最近N条；历史通知分页，与任务列表解耦|
|模板/标准/表单|common 全量|列表只要标准名称摘要；任务创建/编辑、详情按需加载 options/schema|
|同流程其它任务|包含在5,934条全集|详情仅加载当前实例相关任务；列表由服务端返回 `executionStarted/currentStep/returnable` 派生值|

## 7. 操作后刷新审计与局部更新

## 7.1 当前已局部更新的操作

以下大多已经返回单任务并替换 `state.tasks` 对象：

- 编辑任务；
- 开始/提交/取消/恢复；
- 提交结果；
- 审核通过/拒绝；
- 退回重做。

但分页后不能再把 `state.tasks` 视为全集。应改为更新当前页 item、详情 cache 和 summary；若变更后任务不再符合当前 filter，应从当前页移除并补取下一条。

## 7.2 当前仍触发大快照的操作

- `batchUpdateTaskStatus` 服务端返回 `data: filterDataByScope(readAllData())`，前端 `applyDataSnapshot`；
- 关键行动 start/cancel、work plan launch、batch launch、关联产品/模板等旧 API 仍可返回全量 data；
- 波次 start/draft/submit/cancel 后，前端明确重新加载 task-waves、wave detail，再请求 `/api/data`；
- 部分通用资源写 API 响应可能携带 data 并被 `applyDataSnapshot`。

## 7.3 目标局部更新契约

单任务操作返回：

```json
{
  "task": { "...完整或列表摘要...": "..." },
  "affectedTasks": [],
  "affectedAction": null,
  "affectedWave": null,
  "summaryDelta": { "mine": -1, "done": 1 },
  "dataVersion": "..."
}
```

批量操作返回每个 taskId 的结果和必要摘要；不要返回全局 data。

波次操作返回：

- 更新后的 wave；
- wave member task summaries；
- affectedTaskIds；
- 列表失效提示。

前端策略：

1. 更新详情 cache；
2. 更新当前页匹配项；
3. 若操作影响排序、状态或过滤条件，重新请求当前页；
4. 只失效相关 summary 和 wave list；
5. 永不调用 `/api/data` 或重新取任务全集。

“重新请求当前页”比复杂地在前端模拟分页补位更安全，返回体仍小于1 MB。

## 8. 首屏最小数据需求

任务中心首次进入默认 `mine + card + remaining`。最小首屏建议：

- 当前用户及权限摘要；
- people、departments 的轻量 options（当前仅16人/12部门，可缓存）；
- 任务视图 summary；
- 当前页50条任务列表摘要；
- 不加载 task waves 全表；
- 不加载 processInstances、workPlans、process nodes、actionProducts、taskProductContexts 全集；
- 不加载2,623条通知历史，只保留应用壳最近通知/未读数；
- 不加载详情，或只加载首条 summary。

按当前数据估算，即使每条列表摘要达到5—8 KB，50条也约250—400 KB；加 options、summary 和最小壳数据后，应稳定低于1 MB。

## 9. 实施顺序

### Phase A：查询契约与规则复用

- 把视图、过滤、权限、流程开始、逾期和波次状态规则抽成服务端 Query Capability。
- 建立新旧结果影子比较：四视图 total、前N条 ID、顺序、状态、可操作项必须一致。
- 不改页面业务逻辑。

验收：管理员与普通用户在 today/mine/overdue/all 的结果一致。

### Phase B：服务端分页任务列表

- 新增分页列表和 summary/options；
- 前端任务列表改用模块 store，不再把 `state.tasks` 当全集；
- 当前页列表/卡片保持相同字段和操作。

验收：搜索、筛选、排序、翻页、批量选择结果一致；P50 <500 ms。

### Phase C：详情按需

- 完善 task detail Read Model；
- 前序任务、行动、产品、附件、模板和表单按 scope 查询；
- 详情缓存按 task updatedAt/dataVersion 失效。

验收：普通任务、流程任务、审核任务、带产品/附件/模板任务完整回归。

### Phase D：波次与进度 Tab 分离

- task-waves 只在波次 Tab 进入时分页加载；
- 列表当前页通过批量关联得到 active wave 摘要；
- process-progress 独立成分页 Query，不再依赖任务全集。

验收：波次生成、开始、草稿、提交、取消、超时显示和权限不变。

### Phase E：操作增量化

- 移除任务和波次操作响应中的全量 data；
- 取消波次操作后的 `/api/data`；
- 写后重新请求当前页/当前详情，而非全量刷新。

验收：所有任务状态机、验收、退回、批量操作及行动联动正确。

### Phase F：bootstrap 收口

- tasks bootstrap 只保留最小壳/选项，或完全改为 task module bootstrap；
- 通知历史、模板、流程定义从 common 拆出；
- 加入“任务路由不得下载 tasks/processInstances/workPlans 全集”的静态和网络回归测试。

## 10. 风险分析

### 10.1 状态逻辑变化风险（高）

`isTaskExecutionStarted` 当前通过同一流程所有任务的执行证据决定流程任务是否显示；逾期先看波次再看任务；退回需要前序任务和节点顺序。分页前必须将这些规则移到服务端统一实现，不能只用 task.status/dueDate 简化。

### 10.2 权限风险（高）

服务端已有 `readTaskAuthorizationResolver`、`filterTasksByScope`、`canViewTask`、`canOperateTask`。新列表必须复用这些规则，并在 total、summary、搜索结果和波次成员中一致执行。前端不得承担数据范围过滤。

### 10.3 流程规则风险（高）

流程节点、前后任务、当前任务、行动状态和工作计划互相关联。列表只返回摘要，但详情和操作前服务端仍必须读取完整关系并重新校验，不能相信客户端摘要。

### 10.4 验收与审核风险（高）

审核任务需要目标任务的提交表单、文件、链接和审核规则。详情 Read Model 必须一次或分 scope 返回完整证据；结果提交和审核操作不能因分页导致目标任务找不到。

### 10.5 波次规则风险（高）

任务处于 active wave 时禁止单独操作；波次时间决定逾期。当前页 wave 摘要必须与正式 wave 状态事务一致，操作前服务端重新读取并校验。

### 10.6 批量选择风险（中）

当前“全选”针对全部前端过滤结果。分页后必须明确为“选择本页”或实现服务端 selection token。若保持当前文案和语义，默认应选择当前页，并明确显示数量；不能把50条选择误当成全部匹配任务。

### 10.7 搜索兼容风险（中）

行动编码与模板编码搜索依赖 processInstances/workPlans 的关联字段，普通 SQL 名称搜索不足以兼容。应建立标识解析阶段，再进入任务查询。

### 10.8 并发与缓存风险（中）

任务状态变化频繁。列表摘要、详情和波次缓存需使用 updatedAt/dataVersion；写操作失败不得预先永久修改本地缓存。

## 11. 性能目标与验收

### 11.1 数据量

- 当前：15.53 MB bootstrap + 0.218 MB waves = 15.75 MB。
- 目标：任务默认首屏所有业务 JSON合计 <1 MB，减少至少93.65%。
- 默认列表：50条；最大100条。
- 详情、波次、模板和产品关系均不计入首次列表，按用户交互加载。

### 11.2 响应时间

- 任务列表 P50 <500 ms；P95 <1 s。
- summary/options P50 <200 ms。
- 任务详情 P50 <500 ms（不含附件文件下载）。
- 翻页、筛选和排序 P95 <1 s。

### 11.3 业务一致性

- today/mine/overdue/all 的 total、前后顺序和任务集合与旧逻辑一致；
- 权限范围一致；
- 任务状态、逾期、剩余时间和 availableActions 一致；
- 普通任务、流程任务、审核任务、清仓任务隔离一致；
- 完成、取消、提交、验收、退回、批量操作结果一致；
- 波次开始、保存、提交、取消和超时判断一致；
- 操作后不调用 `/api/data`，也不重新下载任务全集。

### 11.4 查询与渲染

- 服务端执行计划不得读取全部任务大 JSON 后再内存分页；
- 当前页关联水合必须批量查询，无 N+1；
- 前端 DOM 仅渲染当前页；
- 快速切换视图/筛选时，旧请求不得覆盖新结果；
- 相同查询可缓存但必须按用户权限和 dataVersion 隔离。

## 12. 最终建议

任务中心具备优化条件，但属于高业务风险改造，不能照搬产品中心的简单分页。最安全的最小路径是：先建立只读分页 Query Capability并做新旧影子比较，再切列表，随后切详情、波次和写后增量更新。

优先收益来自三点：

1. 不再传输5,934条完整任务；
2. 不再传输全部流程实例、工作计划和产品上下文；
3. 波次和通知历史从任务首屏拆离。

在保持现有状态机、权限、流程、验收和波次规则的前提下，首次数据从15.75 MB降至1 MB以内是现实目标。

## 13. 数据保护

- 未修改任务逻辑、API或页面。
- 未修改数据库或任何业务数据。
- 未执行索引、迁移、优化或发布。
- 本次仅新增评估报告。
