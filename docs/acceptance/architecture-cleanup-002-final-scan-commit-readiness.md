# 《Architecture Cleanup-002 收尾验收报告》

## 一、结论

Architecture Cleanup-002 的经营数据中心退役链路已完成收尾扫描，自动验证通过，可以进入“选择性暂存并创建独立提交”的步骤。

当前工作区混有 Architecture Cleanup-001、Legacy Schema、Resolver、销售事实等其他任务修改。禁止整文件批量暂存混合文件，也禁止 `git add -A`。本报告仅确认提交边界，不执行暂存、提交或发布。

## 二、残留扫描结果

### 1. 已清零的正式运行依赖

- 正式模块清单中不存在 `dataCenter` 业务模块。
- `main.js` 不再静态导入 `dataCenterPage.js`。
- 服务端不存在 `/api/data-center/summary`、`trends`、`slow-moving`、`capital-occupation`、产品详情等旧经营 API。
- `dataCenterService` 不再包含经营查询实现，只保留明确退役标识。
- 正式经营权限不再读取 `dataCenter.view`，已改为 `operations.view`。
- 产品经营正式读取不依赖旧经营快照。

### 2. 有意保留的兼容残留

| 残留 | 位置 | 原因 | 状态 |
|---|---|---|---|
| `dataCenter` / `data-center` URL识别 | `src/main.js` | 将旧经营路由跳转产品中心，将旧同步路由跳转管理员数据中心 | 保留兼容 |
| `dataCenter.view`、`modules.dataCenter` | `src/permissions.js` | 将存量账号权限映射到 `operations.view` | 保留一个观察窗口 |
| `data-center` section | `src/utils/connectionCenterRoute.js` | 旧链接中心入口跳转产品中心 | 保留兼容 |
| `src/dataCenterPage.js` 文件名 | 动态模块 | 文件内容已是管理员同步中心；为降低本阶段风险未重命名 | 非业务残留 |
| `server/dataCenterService.js` | 服务端 | 仅保留退役边界常量，阻止重新加入运行逻辑 | 非运行依赖 |
| 测试中的旧名称 | Cleanup-002测试与验证脚本 | 验证旧入口、旧API和静态依赖不会回归 | 必须保留 |
| `.data-center-*` CSS类 | `src/styles.css` | 管理员同步、财务页面和链接数据页仍复用部分样式 | 暂不可删 |

### 3. 非模块残留

- `connectionCenterPage.js` 的 `dataCenterTab` 是链接数据更新页面的局部状态名，不是已退役模块引用。
- `connection-data-center-nav` 是数据更新页面样式名，不会加载经营数据中心。
- `adminDataCenter` 是正式保留的管理员同步模块，不属于退役对象。

### 4. 后续可选清理

- 观察期结束后，可把 `dataCenterPage.js` 重命名为 `adminDataCenterPage.js`。
- 可单独核对并删除不再被任何页面使用的旧产品卡片 CSS；当前不应与本提交混做。
- 存量权限全部迁移后，可另行评估移除 `dataCenter.view` 兼容映射。

## 三、提交分类

### A. Architecture Cleanup-002 代码与自动验证

以下为本任务链应提交的代码范围：

- `scripts/verify-finance-data-center-snapshot-removal.js`
- `server/aiOperationAssistantService.js`
- `server/dataCenterService.js`
- `server/erpFactSnapshots.js`
- `server/index.js` 中 Cleanup-002 的经营API退役、同步权限、经营权限相关补丁块
- `server/modules/products/index.js` 中 data center 导出退役补丁块
- `server/operationManagementService.js`
- `server/productBusinessClassification.js`
- `server/productBusinessReadModel.js`
- `server/productManagementV2Service.js` 中产品经营迁移补丁块
- `server/productV2Import.js`
- `src/appState.js` 中经营数据中心读取移除与 `adminDataCenter` 轻量模块补丁块
- `src/connectionCenterPage.js` 中平台货品导入直达能力补丁块
- `src/dashboardPage.js`
- `src/dataCenterPage.js`
- `src/main.js` 中 dataCenter退役、兼容重定向及 adminDataCenter动态加载补丁块
- `src/moduleLoader.js`
- `src/modules.js` 中 dataCenter → adminDataCenter 补丁块
- `src/operationDashboardPage.js`
- `src/permissions.js`
- `src/productCenterPage.js` 中产品经营迁移补丁块
- `src/services/connectionCenterService.js` 中平台货品导入门面补丁块
- `src/services/productCenterService.js`
- `src/settingsPage.js`
- `src/uiModules/salesBusinessDashboard.js`
- `src/utils/connectionCenterRoute.js`
- `tests/productBusinessReadModel.test.js`
- `tests/productBusinessMigration.test.js`
- `tests/linkCenterV2Cleanup.test.js` 中经营数据中心退役守卫补丁块

其中 `server/index.js`、`server/modules/products/index.js`、`server/productManagementV2Service.js`、`src/appState.js`、`src/main.js`、`src/modules.js`、`src/productCenterPage.js`、`src/services/connectionCenterService.js`、`tests/linkCenterV2Cleanup.test.js` 是混合文件，必须使用补丁方式选择性暂存。

### B. 文档

以下为 Architecture Cleanup-002 文档，但根据“只提交A”要求，本次代码提交应排除：

- `docs/acceptance/architecture-cleanup-002-data-center-entry-convergence-phase1.md`
- `docs/acceptance/architecture-cleanup-002-product-business-analysis-migration-phase2.md`
- `docs/acceptance/architecture-cleanup-002-product-center-legacy-scan-phase3a.md`
- `docs/acceptance/architecture-cleanup-002-product-business-system-migration-phase3.md`
- `docs/acceptance/architecture-cleanup-002-data-center-retirement-phase4.md`
- `docs/acceptance/architecture-cleanup-002-final-scan-commit-readiness.md`

### C. 其他任务修改

以下文件全部或部分属于 Architecture Cleanup-001、Legacy Schema、Resolver、销售事实单轨等任务，本次不得随提交带入：

- `package.json`
- `scripts/verify-sales-object-resolver-rollout-v2-data-020.js`
- `scripts/check-link-center-v2-cleanup.js`
- `scripts/verify-relation-write-single-track-phase3.js`
- `scripts/verify-resolver-single-read-phase2.js`
- `server/capabilities/*`
- `server/connectionDataFoundationService.js`
- `server/dataSyncCenterService.js` 中非 Cleanup-002 补丁
- `server/db.js`
- `server/linkSkuErpMappingService.js`
- `server/platformGoodsExcelDataSyncAdapter.js`
- `server/productLinkV2ReadService.js`
- `server/productStructureApplicationApprovalService.js`
- `server/salesComboReviewService.js`
- `server/salesDailyFactPreviewService.js`
- `server/salesDataQualityAnomalyGovernanceService.js`
- `server/salesFactDataSyncAdapter.js`
- `server/salesRelationCandidateService.js`
- `server/schema.sql`
- `server/wangdianPlatformGoodsSyncService.js`
- `tests/productLinkV2ReadService.test.js`
- `tests/resolveLinkSkuRelationRead.test.js`
- `tests/salesFactImportMigration.test.js`
- 全部 `architecture-cleanup-001-*` 报告

### D. 临时文件

当前 `git status` 未发现数据库、备份、uploads、日志或临时验证数据库进入未跟踪列表。未发现应提交的环境同步文件。

## 四、选择性提交要求

1. 纯 Cleanup-002 文件可以逐文件暂存。
2. 混合文件必须逐补丁块暂存并再次检查 staged diff。
3. 文档和其他任务文件保持未暂存。
4. 暂存后必须确认提交中不含数据库、uploads、备份、Legacy Schema退役代码或 Resolver 单轨任务修改。
5. 建议提交信息：`refactor: retire legacy operation data center`。

## 五、验证结果

- `npm run check`：通过。
- `npm run test:v2-cleanup`：6/6 通过。
- `npm run test:product-business`：6/6 通过。
- `git diff --check`：通过。
- 正式旧经营 API 扫描：0。
- 正式 `dataCenter` 模块注册：0。
- `main.js` 对 `dataCenterPage.js` 静态导入：0。

## 六、发布建议

代码具备独立提交条件，但当前不适合按文件整体提交，因为存在多个混合文件。应先完成补丁式暂存审计，再创建 Architecture Cleanup-002 独立提交。

提交后建议先部署开发环境验证旧路由、产品中心、链接中心和管理员同步中心；观察一个发布窗口后，再考虑权限兼容名称和文件名清理。当前不建议直接发布混合工作区。
