# 《Architecture Cleanup-001 API与前端入口收敛 Phase 4验收报告》

验收日期：2026-08-19
执行范围：前端导航、兼容路由、链接中心不可达页面、前端 API 门面、服务端 API 静态扫描、测试与脚本依赖、`/api/data` 调用评估。
数据边界：未修改数据库表、Legacy 数据、Sales Object 模型及正式业务规则。

## 1. 验收结论

Phase 4 通过。

- 已删除能够证明不可达的重复页面入口和前端死代码。
- 旧 URL 保留兼容跳转，不破坏书签和历史链接。
- 服务端 Legacy/410 API 全部保留，本阶段未删除任何 API。
- 正式 Sales Object 查询、Resolver 和写入链路未被修改。
- `/api/data` 仍存在真实调用，当前不能删除。
- 自动检查与业务回归均通过。

## 2. 前端入口收敛

| 对象 | 分类 | 本阶段处理 | 风险 |
|---|---|---|---|
| `dashboard` | 保留 | 继续作为驾驶舱统一入口 | 低 |
| `operationDashboard` | 兼容跳转 | 删除独立模块注册、`main.js` 重复静态导入、不可达 render/bind 分支；旧 hash 仍映射到 `dashboard` 的经营视图 | 低 |
| `assessment` 及 `assessment-*` | 兼容跳转 | 删除独立模块注册、`main.js` 重复静态导入、不可达 render/bind 分支；旧 hash 仍映射到 `dashboard` 的管理视图 | 低 |
| 经营数据中心 `dataCenter` | 隐藏兼容 | 从主导航隐藏；保留路由、权限和管理员深链，平台货品导入仍可由链接中心管理员入口进入 | 中 |
| `sales-relation-governance` | 保留 | 当前已是 Sales Object 审批入口，不按 Legacy 入口删除 | 低 |
| `sales-data-quality-governance` | 保留 | 当前数据质量/关系问题处理入口继续保留 | 低 |
| 旧外部数据 mapping 页面 | 删除 | 页面无路由、无 render 调用，已移除渲染、弹窗、事件和状态 | 低 |
| 旧单文件“生意参谋导入”页面 | 删除 | `renderImportPage` 无静态、动态或路由引用，已移除页面、事件和客户端请求门面 | 低 |

兼容策略：旧 hash 只重定向到当前统一页面，不再实例化旧页面；`dataCenter/platform-goods-excel` 保持管理员可访问。

## 3. 已清理死代码

### 已删除

- `renderImportPage`
- `renderImportRows`
- `renderImportStatus`
- `renderMappingPage`
- `renderMappingModal`
- `renderPendingConnections`
- 对应的旧页面状态、加载函数和 DOM 事件绑定
- `main.js` 中重复的 `assessmentPage`、`operationDashboardPage` 静态导入与不可达分支
- 仅服务于上述旧页面的前端 API 包装和 `connectionCenterService` 门面导出

### 删除依据

以上函数在删除前均只有定义或只被同一不可达代码簇引用；正式 `renderConnectionCenterPage` 的 section 分发不包含这些页面，路由也没有对应入口。

## 4. API扫描结果

静态扫描识别 `server/index.js` 中 303 个显式 `/api/*` 路由注册。由于通用资源路由、参数化 URL 和服务层封装存在，不能仅以字符串差集自动删除 API，本阶段采用“保留并分类”。

### 活跃

- Sales Object、产品中心、链接中心、任务中心、财务、数据同步、设置等当前页面调用的 API。
- 销售日报正式入口：`connection-data-foundation/sales-daily/*`。
- Product Structure/Sales Object 审批相关接口仍为当前关系治理入口，不属于删除对象。

### 兼容（保留）

当前共识别 8 处 HTTP 410 兼容保护：

1. 历史内容排期写入口；
2. 旧产品导入入口；
3. 数据同步中心旧销售预览写入口；
4. 数据同步中心旧销售提交入口；
5. 链接数据基础旧销售预览写入口；
6. 链接数据基础旧销售提交入口；
7. 旧店铺匹配预览入口；
8. 旧店铺匹配确认入口。

这些接口继续返回明确迁移提示，不能在本阶段直接删除，否则旧客户端只会得到不透明的 404。

### 废弃候选（本阶段未删除）

| API族 | 当前判断 | 建议 |
|---|---|---|
| `/api/connection-data-mappings*` | 旧外部关系 UI 已移除，当前前端无调用 | 先记录访问日志；连续一个发布周期为零后删除写接口，再评估读接口 |
| `/api/connection-import-batches*` | 旧单文件导入 UI 已移除，当前前端无调用 | 保留历史批次读取/审计期；写接口先改为 410 后再删除 |
| `/api/connection-data-foundation/sales-facts*` | Legacy 只读/迁移兼容 | 继续保留只读与迁移预览；写端保持 410 |
| `/api/connection-data-foundation/shop-mappings*` | 已迁移至管理员同步入口 | 保留 410 兼容，后续统一清退 |
| `/api/products/import*` | 已由 ERP V2 导入替代 | 保留 410 兼容，后续统一清退 |

## 5. 测试与脚本依赖分类

| 类型 | 处理 | 示例 |
|---|---|---|
| 正式测试 | 迁移/保留 | `resolveLinkSkuRelationRead.test.js`、`linkCenterV2Cleanup.test.js` 使用 Sales Object fixture |
| Legacy兼容测试 | 保留 | `salesFactImportMigration.test.js` 验证旧事实只读及迁移语义 |
| Shadow/差异诊断脚本 | Legacy专用保留 | `compare-connection-*`、`compare-product-*` 只用于新旧结果比较，不进入正式请求 |
| 历史生产应用脚本 | 冻结候选 | `apply-product-structures-*`、`recover-auto-product-structures-*` 不应再作为日常执行入口 |
| 旧 Combo/Mapping 验证脚本 | 删除候选 | 在确认无发布/审计依赖后移入归档目录或从主检查清单移除 |

本阶段新增入口收敛测试，防止重复模块注册、重复静态导入和旧导入工作区回归。

## 6. `/api/data`评估

结论：仍被使用，不删除。

真实调用来源：

- `loadPersistentData`：对尚未迁移为轻量 bootstrap 的模块使用全局快照；
- 任务波次操作完成后的状态刷新；
- 设置页保存后的刷新；
- 模板中心操作后的刷新；
- `main.js` 登录、路由切换和初始化流程通过 `loadPersistentData` 间接调用。

当前已使用轻量 bootstrap 的路由包括驾驶舱、产品中心、链接中心、任务中心、关键行动、财务中心和数据中心。后续应先完成目标、行动标准、模板、设置的专用读取，再缩减 `/api/data`，不能直接删除。

## 7. 修改文件

- `src/modules.js`
- `src/main.js`
- `src/connectionCenterPage.js`
- `src/appState.js`
- `src/services/connectionCenterService.js`
- `tests/linkCenterV2Cleanup.test.js`
- 本报告

注意：工作区包含此前 Phase 2、Phase 3 及其他任务的未提交修改，本阶段没有提交，发布前必须按任务边界逐文件暂存。

## 8. 验证结果

- `npm run test:v2-cleanup`：通过，3/3。
- `npm run test:product-business`：通过，4/4。
- `npm run check`：通过。
- `git diff --check`：通过。
- 未执行数据库写入；测试使用临时隔离数据库。

## 9. 下一阶段建议

1. 为废弃候选 API 增加一个发布周期的调用日志，避免仅凭静态扫描删除外部调用。
2. 将旧 `connection-import-batches` 和 `connection-data-mappings` 写端统一改为 410，再进行真正的 API 删除。
3. 归档历史 Product Structure/Combo 生产脚本，使默认测试和运维入口只暴露 Sales Object 流程。
4. 继续拆除目标、模板、设置对 `/api/data` 的依赖；完成后再设计全局快照退场。
5. 待 Legacy API 无调用后开展 Phase 5：服务端兼容层退场，仍不先删除数据库资产。
