# V2-PERFORMANCE-007 财务中心与数据中心脱离全局快照实施报告

## 1. 修改范围

本次仅调整财务中心和数据中心的路由启动数据来源，并增加防回归验证：

- `src/appState.js`
  - 将 `financeCenter`、`finance-center`、`dataCenter`、`data-center` 纳入轻量模块路由。
  - 兼容 Hash 路由名称映射到服务端标准模块名。
- `server/index.js`
  - 为 `financeCenter`、`dataCenter` 注册轻量 bootstrap。
  - 两个模块不附加业务资源，页面业务数据继续由专用 API 提供。
- `scripts/verify-finance-data-center-snapshot-removal.js`
  - 校验新旧路由均不会回落 `/api/data`。
  - 校验页面未引用全局快照，并继续使用专用 API。
- `package.json`
  - 将防回归脚本纳入 `npm run check`。

未修改财务、同步、导入、统计的业务口径，也未修改页面展示。

## 2. 原依赖

优化前，`loadPersistentData()` 只识别少数轻量模块。进入财务中心或数据中心时，路由不在清单中，因此启动阶段先请求：

`GET /api/data`

隔离生产副本实测：

- HTTP 200
- 返回 25,158,822 bytes（约 25.16 MB，未压缩）
- 本地隔离服务响应 436.3 ms

财务页面和数据中心页面本身均不使用该快照中的 `state.*` 业务集合，因此这 25.16 MB 属于纯前置冗余。

## 3. 新数据来源

### 财务中心

启动使用：

- `GET /api/bootstrap?module=financeCenter`

业务继续使用现有接口：

- `/api/finance/statement`
- `/api/finance/analysis`
- `/api/finance/entries`
- `/api/finance/import-batches`
- `/api/finance/rules`

财务中心页面未读取 `/api/data`，没有 `state.*` 业务依赖。

### 数据中心

启动使用：

- `GET /api/bootstrap?module=dataCenter`

业务继续使用：

- `/api/data-center/trends`
- `/api/data-center/slow-moving`
- `/api/data-center/capital-occupation`
- `/api/data-center/products/:productId`
- `/api/data-sync-center`
- 原有同步预览、导入和提交接口

数据状态、导入记录、同步状态和统计口径保持原实现。

## 4. 性能变化

测试环境：生产数据库只读副本的隔离复制，本地隔离 API 服务；结果为原始 JSON 大小和单次响应时间，不代表远程网络 P95。

### 启动数据

|请求|状态|大小|耗时|
|-|-:|-:|-:|
|优化前 `/api/data`|200|25,158,822 B|436.3 ms|
|财务 bootstrap|200|2,136,515 B|38.4 ms|
|数据中心 bootstrap|200|2,136,515 B|21.9 ms|

两个模块的启动数据均减少 23,022,307 bytes，下降约 91.51%。

剩余约 2.14 MB 来自现有公共 bootstrap（组织、权限、通知和公共模板等），不属于本阶段允许扩大的修改范围。

### 财务专用 API

当前隔离基线没有财务明细数据：

|接口|大小|耗时|
|-|-:|-:|
|statement|186 B|2.9 ms|
|analysis|69 B|1.9 ms|
|entries|27 B|1.1 ms|
|import-batches|27 B|1.1 ms|
|rules|27 B|1.1 ms|

财务业务接口合计 336 B；当前页面行为仍会并行请求上述五类数据，本阶段仅移除全局快照，不改变 Tab 加载逻辑。

### 数据中心专用 API

|接口|大小|耗时|
|-|-:|-:|
|trends（pageSize 48）|204 B|5.6 ms|
|data-sync-center|117,044 B|61.0 ms|

数据中心进入普通分析视图时只请求当前视图；同步中心在进入同步视图时按需请求。

## 5. 回归结果

### 财务中心

- 概览与利润表继续读取 statement/analysis。
- 明细继续读取 finance entries。
- 导入记录继续读取 import batches。
- 规则继续读取 finance rules。
- 权限中间件和财务计算服务未修改。
- 页面展示代码未修改。

### 数据中心

- 趋势、滞销、资金占用继续按当前视图查询。
- 产品分析详情继续点击后按需读取。
- 数据同步状态、批次、异常和导入流程继续使用 data-sync-center 专用接口。
- 管理员权限和数据中心权限未修改。
- 页面展示代码未修改。

### 全局快照保护

- 页面进入：两个标准路由和两个兼容路由均走轻量 bootstrap。
- 页面刷新：按当前 Hash 重新选择轻量 bootstrap。
- Tab 切换：页面事件不调用 `loadPersistentData` 或 `/api/data`。
- 页面内保存：财务和数据中心操作使用各自专用 API，不触发全局快照。

## 6. 数据保护与检查

- 使用隔离数据库复制进行 API 测量。
- 未修改财务数据、同步数据、数据库结构或业务规则。
- `PRAGMA integrity_check`：`ok`。
- `PRAGMA foreign_key_check`：0 条问题。
- `npm run check`：通过。
- `git diff --check`：通过。
- Legacy 链接关系写入检查：0 条风险。

## 7. 已知边界

- 公共 bootstrap 仍为约 2.14 MB，后续可单独收窄通知和公共模板，但不应混入本次最小改造。
- 财务页面仍在首次进入时并行读取五类财务数据；这是 Tab 懒加载的后续优化项，不影响本次“脱离 `/api/data`”验收。
- 数据同步中心响应当前约 117 KB，批次和异常继续增长后仍需服务端分页。

## 8. 结论

财务中心和数据中心已经从 `/api/data` 全局快照中脱离，页面业务数据全部保持原专用 API，权限、数据口径和展示逻辑不变。本次改造可以进入独立提交，暂不发布生产。
