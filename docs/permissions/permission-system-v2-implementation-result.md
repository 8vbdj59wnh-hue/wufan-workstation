# 权限体系 V2 实施与迁移结果

> 任务：V2-PERMISSION-002
>
> 实施基线：`e195c42f`（审计报告提交：`4ecf619a`）
>
> 生产状态：**未发布、未修改生产权限数据**
>
> 实施提交：本文所在独立提交（最终 Hash 以交付时 `git rev-parse HEAD` 为准）

## 1. 实施结论

- 正式权限目录由 88 项收敛为 **56 项**，减少 32 项（36.4%）。
- 前端、API、数据库权限归一化统一读取 `shared/permissions.js` 的 V2 定义。
- `links.health`、`links.manageHealth` 及客户中心、供应链中心、AI 经营助手等退役权限不再出现在正式配置 UI，也不再作为正式授权依据。
- 17 人、16 个有效登录账号、1 个有效权限模板已在生产数据库副本完成预览和实际迁移；普通用户非等价权限增加为 **0**。
- 生产库只执行了只读确认；生产人员和模板中 `permissionVersion=2` 的记录均为 **0**，符合“暂不发布生产”。

## 2. 88 → 56 正式权限目录

V2 共 20 个业务分组、56 个操作权限：

|分组|数量|正式权限|
|---|---:|---|
|经营驾驶舱|1|查看|
|目标|3|查看、管理、停用/重新启用|
|关键行动|3|查看、发起、管理|
|任务|5|查看、执行、管理、验收、取消|
|工作结果|3|查看、提交、管理|
|行动标准|3|查看、管理、发布/停用|
|模板中心|3|查看、管理、发布/停用|
|发布内容笔记|3|查看、管理、导出|
|产品|4|查看、管理、归档/恢复、导入|
|SKU|2|查看、管理 SKU 及关系|
|组合装|1|查看|
|经营链接|7|查看、管理档案与目标、刷新评级、诊断、改善、导入、关系管理|
|财务中心|4|查看、维护、规则配置、审批|
|数据中心|3|查看、执行、配置管理|
|组织|2|查看、管理|
|人员|3|查看、管理人员、管理登录账号|
|权限|1|管理权限|
|数据资产|1|查看数据资产地图|
|系统配置|1|管理业务配置|
|上传|3|图片、通用文件、行动标准附件|

数据范围继续独立使用 `self / department / all`；关键行动发起范围继续独立使用全部或指定标准，不被拆成操作权限 Key。

## 3. 删除、Legacy、合并和新增

### 不再进入正式配置

- Legacy：`links.health`、`links.manageHealth`。历史 JSON 可以被解析，但不会输出为 V2 正式权限。
- 退役模块：客户中心、供应链中心、AI 经营助手的模块权限和动作权限。
- 重复模块门禁：`modules.*` 整组退出正式目录，导航直接由业务 `*.view` 推导。
- 无运行依赖：`goals.viewDetail`、`goals.viewRelatedData`、`workPlans.batchOperate`、`tasks.viewForm`、`tasks.viewDetail`、`tasks.viewProcessProgress`、`processes.viewForm` 等。

### 合并与拆分

- `goals.create/edit/dragAlign` → `goals.manage`；停用单列 `goals.close`。
- `workPlans.*`、`processes.*` → `keyActions.*` 与 `actionStandards.*`。
- `assessment.*` → `workResults.*`，原第二套范围权限退出，统一使用 `dataScope`。
- `contentSchedules.*` → `contentNotes.view/manage/export`。
- `products.create/edit/archive` 拆为产品、SKU、组合装三个边界，并将批量导入独立为 `products.import`。
- `finance.manage` 拆为 `finance.maintain` 和 `finance.configureRules`。
- `settings.*` 按组织、人员、账号、权限、数据资产、系统配置和数据中心重新归属。

### 新的明确边界

- `links.rating`：只控制刷新/计算链接评级，读取评级仍使用 `links.view`。
- `links.manageRelations`：控制 Sales Object / ERP SKU 等关系治理。
- `people.manageAccounts`：只控制 username、password、canLogin、authRole 等登录字段。
- `tasks.execute / manage / accept / cancel`：替代单一 `tasks.changeStatus`。

## 4. P0 漏洞修复

### 4.1 只读权限不能写入

- 链接经营定位、目标、跟进、试点和关系治理写接口不再使用 `links.view`。
- GET 链接评级只读取持久化结果；刷新改为独立 POST，并要求 `links.rating`。
- 健康记录 POST 返回 410，不再从正式前端和链接模块导出生成函数。

### 4.2 模板查看与管理分离

- 模板读取使用 `templates.view`。
- 创建、编辑、迭代使用 `templates.manage`。
- 发布、停用和版本状态切换使用 `templates.publish`。
- 只有管理权限、没有发布权限时，新建初始版本保持未发布状态。

### 4.3 人员与账号边界

- 人员业务档案字段要求 `people.manage`。
- 登录账号字段要求 `people.manageAccounts`。
- 权限、模板绑定、个人覆盖要求 `permissions.manage`。
- 同一请求混入未授权字段时整体拒绝，不能通过人员编辑接口修改账号或权限。

### 4.4 任务状态权限

- `start / submit` → `tasks.execute`。
- `approve / reject / review_approve / review_reject` → `tasks.accept`。
- `cancel` → `tasks.cancel`。
- `return / activate / edit / restore` → `tasks.manage`。
- 未知流程动作返回 400；任务原状态机和对象级可操作规则保持不变。

## 5. 前后端统一结果

- 权限配置、导航、按钮显示、API `requirePermission`、通用资源写入规则均改用 V2 Key。
- 目标状态、行动标准状态、模板版本状态、产品生命周期、SKU 改码、链接关系等高风险动作使用各自正式 Key。
- 产品中心按照 `products.view`、`skus.view`、`combos.view` 分别展示子模块；导入使用 `products.import`，SKU 建档和改码使用 `skus.manage`。
- 全代码反向扫描只在 `shared/permissions.js` 的 Legacy 转换器中保留旧 Key；运行时代码未发现旧 Key 授权回退。
- 权限使用 Key 与 56 项目录比对后，仅存在非权限字段 `keyActions.launchTemplateIds`，未发现未知权限 Key。

## 6. 17 人迁移模拟与隔离实际结果

迁移策略为保守映射：合并权限使用旧权限交集，存在歧义时收窄；不通过 OR 自动扩大普通用户权限。所有人当前数据范围均为 `all`。

|人员|角色|旧有效 Key 数|V2 Key 数|退出/改名 Key 数|明确替换组数|非等价增权|
|---|---|---:|---:|---:|---:|---:|
|陈明|管理员|65|56|63|7|0|
|刘佳音|用户|87|43|77|8|0|
|章海彬|用户|78|42|74|9|0|
|章璐璐|用户|79|42|75|9|0|
|李莉莉|用户|76|38|73|7|0|
|章绍良|用户|79|42|75|9|0|
|吴琳玲|用户|40|20|37|4|0|
|吴袁|用户|48|26|38|5|0|
|梁玉婷|用户|48|26|38|5|0|
|陈启甜|用户|50|26|40|5|0|
|林元杰|用户|33|17|30|3|0|
|李艳|用户|36|20|32|4|0|
|高洁|用户|33|20|30|3|0|
|张小薇|用户|48|26|38|5|0|
|许兴炜|用户|48|26|38|5|0|
|温陈盛|用户|28|18|25|3|0|
|曾思洁|用户|32|20|29|4|0|

V2 有效权限形成 10 组实际配置：管理员 1 组；完整组织/权限管理员 4 组；渠道模板及个人岗位权限 5 组。逐人完整旧 Key、V2 Key、替换关系和校验摘要由迁移脚本的 JSON 报告生成；本次隔离结果中 `addedWithoutLegacyEvidence` 全部为空。

需要人工确认后才能在未来增加的权限：普通用户的 `links.rating`、存在旧产品创建/编辑歧义时的 `products.manage`、`skus.manage`，以及没有完整旧管理证据的模板发布、行动标准发布。当前迁移均未自动补发。

## 7. 权限模板迁移

- 有效模板：1 个（“渠道部门”）。
- 模板已转换为 V2，正式启用 26 项权限。
- 模板不再包含 health、退役模块或 `modules.*`。
- 模板创建的新人员只会获得 V2 权限和 V2 个人覆盖，不会生成 Legacy Key。

## 8. 数据保护与迁移执行

- 一致性生产备份：`/Users/meiyounaichatouyuna/WufanWorkstationData/backups/workstation-pre-permission-v2-20260825-2225-consistent.db`
- 备份 SHA-256：`cbfb79391ec4ff42f306c6457d6fbf40b33b25c07f1471a69f6569397244a404`
- 备份校验：`integrity_check=ok`，`foreign_key_check=0`。
- 隔离副本预览：17 人、16 个有效账号、1 个模板，增权阻断项 0。
- 隔离副本应用：17 人和 1 个模板全部为 `permissionVersion=2`，完整性和外键正常。
- 目标 14、任务 7320、产品 2958、链接 10006、销售日事实 17571、财务记录 0，迁移前后行数一致。
- 迁移脚本只执行 `persons.permissions / permissionOverrides` 和 `permission_templates.permissions` 更新，不修改业务事实和状态。
- 生产库最终只读复核：人员 V2 记录 0、模板 V2 记录 0、`integrity_check=ok`，生产权限未迁移。

隔离浏览器启动时发现当前任务基线的既有轻量迁移器仍引用生产已退役的 3 个 Link Legacy 列。为完成页面验证，仅在第一份浏览器验证副本临时补齐这些列；生产库和最终权限迁移副本均未补列。该问题属于基线与后续 Link 退役提交的集成差异，不属于权限数据迁移，正式合并时应以当前主线的 Link 退役 Schema 为准。

## 9. 浏览器权限回归

在迁移后的生产副本执行管理员和受限账号真实浏览器验证：

- 管理员权限页显示 56 项正式权限、1 个已迁移模板。
- 页面不存在 `links.health`、`links.manageHealth`、客户中心、供应链中心、AI 经营助手权限。
- 受限账号直接访问 `#settings/permissions` 不显示权限配置，回落到允许的人员管理页。
- 受限账号只有 `templates.view` 时，模板中心可读，但没有上传、创建、发布、停用入口。
- 只有 `links.view` 时，链接中心无导入、评级刷新、编辑入口，也不显示综合健康评价。
- 只有 `tasks.view` 时，任务详情无执行、验收、取消、退回、恢复按钮。
- 人员管理者编辑弹窗不显示登录账号、密码和登录权限字段。
- 浏览器控制台错误：0。

## 10. 验收结果

|检查|结果|
|---|---|
|权限专项测试|14/14 通过|
|迁移预览与隔离应用|通过；17 人、1 模板、0 增权|
|`git diff --check`|通过|
|`integrity_check`|生产备份、隔离迁移前后、生产只读复核均为 `ok`|
|`foreign_key_check`|生产备份和隔离迁移前后均为 0|
|真实浏览器自动验证|通过|
|`npm run check`|静态检查、权限相关检查和前置门禁通过；最终仍停在审计已记录的目标中心隔离服务子进程被环境提前终止问题。服务已成功启动且 V2 `goals.view` 静态门禁验证通过，此问题不是本次权限逻辑失败。|

## 11. 发布状态

本任务只生成独立实现提交和可重复执行的显式迁移脚本，**未发布生产**。未来发布时必须在当前主线完成集成后重新运行预览；只有无普通用户增权阻断项时，才能在维护窗口对生产权限数据执行 `--apply`。
