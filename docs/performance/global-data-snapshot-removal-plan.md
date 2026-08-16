# V2-PERFORMANCE-006 全局数据快照拆除方案评估

## 1. 结论摘要

本次基于 Performance-005 审计、当前源码及只读数据库副本分析。未修改 `/api/data`、页面、业务代码或数据库。

`/api/data` 当前同时承担三种职责：

1. 未接入轻量 bootstrap 路由的页面启动数据；
2. 多模块共享的前端全局状态初始化；
3. 部分写操作完成后的全量状态刷新。

因此，拆除不能只把路由地址从 `/api/data` 换成 `/api/bootstrap`。如果不同时处理页面对 `state.*` 的隐式依赖和写后全量刷新，快照会从其它路径重新进入主流程。

当前最适合直接脱离快照的是财务中心和数据中心：二者已有完整专用 API，页面业务数据也没有依赖 `state.*`。任务、目标、关键行动、工作结果、模板和设置则需要先建立模块级读取契约。

推荐分三阶段：

- Phase 1：财务中心、数据中心直接脱离；任务中心建立分页列表接口并移除业务全集 bootstrap。
- Phase 2：目标、关键行动、工作结果建立摘要/列表/详情契约，逐步移除对共享任务与流程全集的依赖。
- Phase 3：模板和设置建立专用读取接口，并消除保存后的 `loadPersistentData()` 全量刷新。

目标不是立即删除 `/api/data`，而是先让生产业务路由对它零依赖，再将其降级为管理员诊断或最终退出对象。

## 2. `/api/data` 当前实现

### 2.1 服务端

`GET /api/data` 调用 `readAllData({ exclude: ["salesLinks", "salesLinkSkus"] })`，读取 `resourceConfigs` 中全部 36 类资源，仅将 `salesLinks` 和 `salesLinkSkus` 替换为空数组，再执行用户数据范围过滤并返回。

该接口不是按页面、字段、分页或日期范围读取。即使某页面只需要组织字典，也会读取任务、流程、产品、ERP货品、关系映射、模板、通知等资源。

`POST /api/data` 的全量覆盖保存已经被保护为默认拒绝，但 `GET /api/data` 仍是多个页面的读取基础。

### 2.2 前端路由选择

`loadPersistentData()` 仅对以下路由使用 `/api/bootstrap`：

- dashboard / dashboard-management
- products
- connectionCenter
- tasks / task-list
- scheduleBoard

其它路由统一回退 `/api/data`。路由切换时，如果一级模块变化，`main.js` 会再次调用 `loadPersistentData()`。

### 2.3 隐藏调用

除页面启动外，还发现以下隐藏依赖：

- 任务波次 start/draft/submit/cancel 完成后重新请求 `/api/data`。
- 设置页面部分保存动作后调用 `loadPersistentData()`。
- 模板中心部分保存动作后调用 `loadPersistentData()`。
- 若当前路由不在轻量清单，这些刷新仍回到 `/api/data`。
- 多个旧写 API 的响应仍返回 `filterDataByScope(readAllData(), user)`，即一次写操作可能携带新的全量快照。

这些调用必须纳入拆除验收，不能只检查首次打开页面。

## 3. 页面依赖清单

|页面|是否依赖 `/api/data`|实际使用字段|现有专用能力|建议替代接口|
|-|-|-|-|-|
|目标管理|是，路由启动直接依赖|companies（间接）、departments、people、categories、stores、goals、tasks、taskTemplates、processTemplates、processTemplateNodes、processInstances、workPlans、products、templates|已有通用单资源写接口；缺目标列表/详情读取 API|`GET /api/goals?…` 分页；`GET /api/goals/:id?scope=summary|tasks|actions`；独立选项字典接口|
|关键行动/流程|是，路由启动直接依赖|categories、departments、goals、methodologies、people、positions、processInstances、processTemplateNodes、processTemplates、taskTemplates、tasks、workPlans|已有启动、取消、批量关联模板、执行人修改、工作计划启动等写接口；缺列表与详情读取契约|`GET /api/key-actions?…`；`GET /api/key-actions/:id?scope=…`；`GET /api/action-standards/options`|
|任务中心|首次路由不读 `/api/data`，但依赖约 15.13 MB 的全量 tasks bootstrap；任务波次操作后会回读 `/api/data`|categories、departments、goals、people、processInstances、processTemplates/nodes、publishingAccounts、stores、taskTemplates、tasks、templates、workPlans；另有 taskWaves/detail|已有 `GET /api/tasks/:id`、workflow、批量状态、task-waves 列表/详情；缺任务分页列表 API|`GET /api/tasks?filters&sort&page&pageSize`；详情继续用 `/api/tasks/:id`；波次动作返回受影响任务/波次增量，不再回传或刷新全量状态|
|工作结果/评价|是，路由启动直接依赖|departments、goals、people、positions、processInstances、processTemplateNodes、taskTemplates、tasks、weeklyReports、weeklyReportProblems、workPlans|缺统一结果摘要/列表 API；写入仍偏通用资源方式|`GET /api/work-results/summary`；按 Tab 提供 today、improvements、people、weekly-reports、problems 分页接口；详情按对象加载|
|财务中心|技术上是：主路由先执行 `/api/data`；页面业务代码不使用 `state.*`|页面自身实际不需要快照字段|statement、analysis、entries、import-batches、batch detail/commit、rules API 已完整存在|无需新增基础接口；路由改用最小公共 bootstrap，页面按当前 Tab 调已有财务 API；entries/batches/rules 后续补分页参数|
|数据中心|技术上是：主路由先执行 `/api/data`；页面业务代码不使用 `state.*`|页面自身实际不需要快照字段|summary、trends、slow-moving、capital-occupation、product detail、data-sync-center 已存在|无需全局快照；使用最小权限/用户 bootstrap + 当前 view 专用 API；同步批次/异常后续分页|
|模板中心|是，路由启动及部分保存后刷新依赖|methodologies、processInstances、processTemplateNodes、processTemplates、standardWorkForms、taskTemplates、tasks、templates、templateTagCategories、templateTags|已有版本列表、迭代、版本状态接口；缺模板资产列表/使用摘要 API|`GET /api/template-center/assets?category&…` 返回汇总后的资产；`GET /api/template-center/options`；版本接口保留；保存直接合并返回对象|
|设置|是，路由启动及部分保存后刷新依赖|companies、departments、positions、people、permissionTemplates、categories、stores、publishingAccounts、issuesRequirements、standardWorkForms、taskTemplates、templateTagCategories、templateTags|通用 create/update/delete 写接口存在；缺按设置 Tab 的读取接口|`GET /api/settings/bootstrap` 只含导航/权限；按 organization、permissions、taxonomy、accounts、forms 等 scope 读取；写 API 返回变更资源并局部更新|

### 3.1 不应混淆的情况

- 任务中心已经不直接在首次进入时调用 `/api/data`，但其 bootstrap 仍是业务全集，拆除目标不能只按 URL 判定成功。
- 财务中心和数据中心虽有专用 API，仍因 `main.js → loadPersistentData()` 先下载 `/api/data`，所以当前仍属于快照依赖页面。
- `/api/bootstrap` 目前的 `common` 也较宽，包含 notifications、任务/流程/模板定义等。它是过渡工具，不应复制出八个不同名称但同样庞大的快照。

## 4. 数据量分析

### 4.1 当前总体

只读副本按当前接口序列化逻辑测得：

- `/api/data` 顶层资源对象：36 类；其中 salesLinks、salesLinkSkus 被显式排除为零条。
- 当前用户范围下原始 JSON：25,158,822 bytes，约 25.16 MB（未压缩）。
- 当前大集合：tasks 5,934、products 2,958、productErpMappings 2,956、notifications 2,623、erpGoods 2,091、processInstances 1,027、workPlans 958、actionProducts 640、methodologies 378、processTemplateNodes 370。

### 4.2 主要体积来源

数据库行 JSON 的只读体积代理统计显示，主要来源顺序为：

|资源|条数|体积贡献判断|原因|
|-|-:|-|-|
|erpGoods|2,091|最大|货品档案字段多，包含较宽的 ERP 原始信息|
|tasks|5,934|最大|数量最多且含 customFields、提交表单、附件、结果等 JSON 字段|
|products|2,958|高|产品经营和内容字段较宽|
|productErpMappings|2,956|高|关系状态和 `latestStateJson`|
|processInstances|1,027|中高|流程状态及 customFields|
|notifications|2,623|中高|数量大，且进入所有 bootstrap common|
|workPlans|958|中高|工作计划及 customFields|
|processTemplateNodes|370|中|节点定义、提交字段 JSON|

前七类资源构成绝大多数快照体积。因为数据库 JSON 列在 SQL 文本统计中会发生转义膨胀，本报告不把该代理值伪装成网络响应的精确百分比；精确总响应以 25.16 MB 为准。拆除后的收益应通过实际接口 Content-Length/浏览器 transfer size 再验收。

从模块归属看，可归为四个主要体积组：

- 商品/ERP组：products、erpGoods、productErpMappings，是最大组；目标、财务、模板、设置完全不应加载。
- 任务/行动组：tasks、processInstances、workPlans，是第二大组；财务、数据中心、模板、设置不应加载，目标也只应按目标详情取关联数据。
- 通知组：notifications 2,623 条；不应作为每个模块的通用全集，可只返回未读摘要并分页读取历史。
- 模板/配置组：processTemplates、nodes、taskTemplates、templates、forms、methodologies；多数页面只需要少量选项或摘要。

## 5. 模块接口现状评估

### 5.1 可以直接替代

|模块|现有能力|结论|
|-|-|-|
|财务|利润表、分析、费用、批次、批次详情、规则均有 API|可以先移除 `/api/data`；Tab 懒加载和分页可作为同阶段必要收口|
|数据中心|趋势、滞销、资金、产品详情、同步中心均有 API|可以先移除 `/api/data`，业务数据无需新总接口|
|任务详情/波次|任务详情、workflow、批量状态、波次列表和详情均有 API|详情可复用；任务列表仍需新分页接口；波次动作返回需增量化|
|模板版本|版本列表、迭代和版本状态 API 已有|版本链可直接保留，但模板资产主页缺列表摘要 API|

### 5.2 需要新增读取契约

|模块|缺口|
|-|-|
|任务|缺服务端分页、筛选、排序列表；当前列表完全基于 `state.tasks`|
|目标|缺目标列表、目标详情、目标关联任务/行动的 scope API|
|关键行动|缺关键行动列表与详情读取；目前写操作接口较多，读仍依赖全局数组|
|工作结果|缺按 Tab 的摘要和分页明细 Capability/API|
|模板|缺服务端聚合的模板资产清单及使用次数摘要|
|设置|缺按设置领域读取的接口；只有通用资源写入能力|

### 5.3 Capability/Module 判断

当前产品、链接、销售和数据中心已有较成熟的 Capability/Service 边界；目标、任务、行动、模板、设置仍以 `appState + resourceConfigs` 作为事实上的读取 Module。拆除时应优先建立模块 Service，再由 API 调用；不要在路由层直接拼接数据库表，也不要把 `/api/data` 拆成多个无分页的大快照。

## 6. 正式拆除方案

### Phase 0：契约与观测冻结

目标：建立可验证基线，不改变业务结果。

- 为八个目标页面记录路由进入的请求、原始/压缩 JSON、服务端读取时间、浏览器解析时间。
- 冻结公共身份契约：current user、permission summary、必要导航信息。
- 规定模块接口不得返回未声明资源，不得以 `data: readAllData()` 兼容。
- 建立开发期守卫：业务模块新增 `/api/data` 调用或旧 API 返回全量 `data` 时测试失败。

验收：形成调用白名单和字段契约；不改变页面结果。

### Phase 1：高收益、低耦合模块

#### 1A 财务中心

- 路由只加载用户/权限最小信息。
- 页面初始只加载当前 Tab：overview/statement 使用 statement + analysis；expenses 使用 entries；import 使用 batches；rules 使用 rules。
- 费用、批次、规则增加服务端分页；导入预览按页读取。

理由：页面没有任何 `state.*` 依赖，专用 API 已完整，是最安全的快照拆除点。

#### 1B 数据中心

- 路由不加载 `/api/data`。
- 当前 view 继续调用 trends、slow-moving、capital-occupation 或 data-sync-center。
- 产品详情保持点击后读取。

理由：页面已经是模块数据模型，仅被全局启动机制拖累。

#### 1C 任务中心

- 新增任务列表分页接口，服务端执行权限过滤、筛选、排序。
- 列表响应只带当前页显示字段和少量关联摘要。
- 任务详情继续复用 `/api/tasks/:id`，缺失 scope 再补。
- 任务波次动作只返回波次和受影响任务，不再请求 `/api/data`。
- 选项字典单独缓存，流程模板/节点仅在创建或详情需要时加载。

理由：收益最大，但改造风险高于财务/数据中心，应在 1A/1B 后实施。

### Phase 2：目标、关键行动、工作结果

#### 2A 目标管理

- 目标列表分页；目标树可以使用轻量树节点接口，而非复用详情对象。
- 目标详情首开只读 summary；任务和关键行动 Tab 分别按需分页。
- 创建表单需要的人员、部门、模板作为 options 接口，按权限缓存。

#### 2B 关键行动

- 建立列表、统计摘要和详情 API。
- 流程模板/节点只在模板管理或发起行动时加载。
- 写操作响应只返回更新后的行动、任务或工作计划增量。

#### 2C 工作结果

- 每个 Tab 独立查询：今日概览、改善工作、人员结果、周报、问题。
- 统计卡片由后端聚合返回；明细分页。
- 避免在浏览器对所有 tasks/workPlans/processInstances 重复扫描。

三者共享对象多，应冻结统一 ID、状态和权限口径，但不能合并成新的“大工作管理快照”。

### Phase 3：模板、设置及最终退出

#### 3A 模板中心

- 服务端返回统一模板资产摘要，包含引用次数、最近使用时间，不再把 tasks/processInstances 下载到浏览器计算。
- 版本详情沿用现有按需 API。
- 保存后直接合并服务端返回对象，不调用 `loadPersistentData()`。

#### 3B 设置

- 仅加载当前设置 Tab 的数据；组织基础字典可建立带 ETag 的小型缓存。
- 权限、类目、账号、表单等分 scope 读取。
- 保存后更新对应 state slice，不重新加载全系统。

#### 3C `/api/data` 退出

- 所有生产路由与写后刷新零调用后，将 GET `/api/data` 标记 Legacy/Admin Diagnostic。
- 观察至少一个发布周期；确认日志中无生产页面调用。
- 最后再评估关闭或仅允许管理员诊断。此阶段仍不需要删除 `resourceConfigs` 或通用单资源写能力。

## 7. 前端状态改造原则

### 7.1 保留最小全局状态

建议继续全局同步持有：

- 当前用户和认证状态；
- 权限摘要；
- 导航所需公司/部门/人员简表（仅在确有全局展示时）；
- 小型、稳定、可缓存的枚举字典。

不应继续全局持有：

- tasks、processInstances、workPlans 全集；
- products、erpGoods、productErpMappings 全集；
- notifications 历史全集；
- 模板资产及使用关系全集；
- 周报、问题、内容排期历史全集。

### 7.2 模块数据容器

每个页面维护自己的：query、page、items、summary、detail cache、tab loaded status。切换路由时不清空其它模块缓存，但缓存必须有明确失效条件，不能由一次全局快照覆盖。

### 7.3 写后更新

写 API 返回：更新对象、版本号、必要的受影响摘要。前端只更新对应模块缓存；跨模块影响通过失效标记或轻量事件通知，不通过重新下载 25 MB 快照解决一致性。

### 7.4 页面跳转

跨模块跳转仅携带 objectId 和目标 route。目标模块加载后按 ID 请求详情。不得要求来源页面预先把目标模块全集装入 `state`。

## 8. 风险分析

### 8.1 权限风险

当前 `/api/data` 统一经过 `filterDataByScope`。拆成专用接口后，每个接口必须复用同一权限和数据范围规则，尤其是任务、目标、行动的部门/人员范围。不能依赖前端过滤。

控制措施：为每个新读接口建立管理员、普通用户、跨部门受限用户三组契约测试；列表 total 也必须按权限过滤后计算。

### 8.2 离线/服务异常

当前系统在数据库不可用时明确阻止进入业务页面，并不提供真实离线业务模式。拆除不应引入“用旧全局 state 继续操作”的伪离线行为。

控制措施：模块接口失败显示模块级错误；认证/bootstrap 失败仍阻断应用；只允许只读缓存提示，不允许离线写入。

### 8.3 页面跳转与跨模块动作

旧页面可能假定目标对象已经存在于 `state`，例如通知跳任务、目标跳任务、行动详情关联任务。

控制措施：所有跨模块 Action 改为 `load module → load detail(id) → select`；找不到对象时返回 404/无权限，而不是静默从旧 state 取值。

### 8.4 隐藏依赖

高风险隐藏点包括：

- `findName(state.people/departments/...)` 等显示辅助；
- 写操作后 API 返回 `data` 全量快照；
- settings/template 保存后显式 `loadPersistentData()`；
- 任务波次动作后的 `/api/data`；
- 前端统计依赖未声明的关联集合；
- `applyDataSnapshot` 对缺失字段的处理可能把未加载模块误清空。

控制措施：模块响应使用独立 apply 函数，不再把部分响应送入 `applyDataSnapshot`；开发期记录每个页面实际读取的 state key。

### 8.5 数据一致性风险

全量快照虽然低效，但天然让所有模块处于同一读取时点。模块化后不同缓存可能短暂版本不一致。

控制措施：响应携带 updatedAt/version；关键写操作使关联模块缓存失效；不要求所有读接口强事务快照，但金额、状态流转等关键详情必须在操作前服务端重校验。

## 9. 性能收益预估

### 9.1 可确定的上限收益

当前 `/api/data` 为 25.16 MB 未压缩。财务和数据中心页面业务本身不使用其中任何字段，因此移除后，它们的路由基础业务数据可减少接近 100%（认证/权限小响应除外）。

目标、模板、设置实际所需当前数据规模远小于商品、ERP和任务全集。排除 `erpGoods`、products、productErpMappings 以及无关任务/流程后，预计可减少 85%—98% 的路由 JSON；最终比例需以新接口实测为准。

任务中心当前 bootstrap 为 15.13 MB。若默认页 50 条并只返回关联摘要，保守预计可减少 90% 以上；详情按需加载后总会话流量取决于用户实际打开多少任务。

### 9.2 首次加载改善

收益来源不只是网络：

- 服务端减少全表读取和 JSON 序列化；
- 浏览器减少 JSON 下载、解析和深拷贝；
- `applyDataSnapshot` 不再克隆数千条对象；
- 页面不再扫描/排序无关全集；
- DOM 只对应当前页。

在局域网环境中，网络传输可能不是唯一主耗时，但 15—25 MB JSON 的序列化、解析和状态复制会形成稳定成本。拆除后，财务和数据中心应主要受各自专用 SQL/API 耗时控制；任务列表应以当前页查询耗时控制。

## 10. 验收标准

### 全局标准

1. 八个目标页面首次进入均不请求 `/api/data`。
2. 页面操作、保存、任务波次动作后也不请求 `/api/data`。
3. 生产业务 API 响应不再携带 `data: readAllData()`。
4. `/api/data` 访问日志在一个观察周期内仅允许明确的管理员诊断调用。
5. 权限、数据范围、状态流转和业务结果与改造前一致。

### 数据量标准

- 财务中心、数据中心基础快照下降 95% 以上。
- 目标、关键行动、工作结果、模板、设置路由首次 JSON 下降 85% 以上。
- 任务默认列表首次 JSON 下降 90% 以上，默认不超过 50 条任务。
- 任一列表禁止后端全量返回后前端 `slice` 冒充分页。

### 交互标准

- 隐藏 Tab 不发业务请求。
- 详情首次仅加载 summary；关联任务、行动、记录按 Tab/section 加载。
- 通知、目标、排期、流程跨模块跳转可按 ID 正常打开。
- 快速切换路由不让旧请求覆盖新页面。

### 稳定性标准

- 管理员、普通用户、受限用户的数据范围测试通过。
- 模块接口失败只影响对应模块；认证或最小 bootstrap 失败仍安全阻断。
- 重复查询结果稳定；写后局部状态正确；无需全局刷新即可看到变更。

## 11. 最终建议

可以进入分阶段实施，但不建议先删除 `/api/data` 或机械扩展现有 `/api/bootstrap`。最小安全路径是：

1. 先让已有专用 API 的财务、数据中心脱离；
2. 再以任务中心建立分页列表和局部状态更新范式；
3. 用同一范式迁移目标、关键行动、工作结果；
4. 最后处理模板、设置及所有写后全量刷新；
5. 经过调用日志观察后，才将 `/api/data` 正式降级或关闭。

该顺序能优先获得最大、可验证的性能收益，同时避免权限、跨模块跳转和写后一致性因一次性重构而失控。

## 12. 数据保护

- 未修改 `/api/data` 或任何 API。
- 未修改页面、业务逻辑或数据库。
- 未执行迁移、优化或生产发布。
- 本次仅新增本方案报告。
