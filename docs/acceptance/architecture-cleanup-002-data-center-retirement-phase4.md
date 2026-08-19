# 《Architecture Cleanup-002 经营数据中心正式退役 Phase 4 验收报告》

## 1. 验收结论

经营数据中心已从正式业务模块中退役。产品经营能力由产品中心承接，经营驾驶舱使用独立经营权限；管理员同步能力保留，并通过“设置 → 管理员数据中心”按需加载。旧 `dataCenter` 路由保留兼容重定向，不再加载经营数据中心业务模块。

本阶段未删除数据库表、历史数据或同步能力，未修改销售、库存、利润口径。

## 2. 修改范围

### 前端模块

- `src/modules.js`：移除 `dataCenter` 业务模块注册，增加隐藏的 `adminDataCenter` 管理员同步模块。
- `src/main.js`：移除经营数据中心静态加载和渲染分支；管理员同步模块改为路由级动态加载。
- `src/moduleLoader.js`：注册 `adminDataCenter` 动态模块适配器。
- `src/dataCenterPage.js`：退役产品趋势、长期滞销、资金占用和产品详情，仅保留管理员同步界面。
- `src/settingsPage.js`：管理员数据中心入口统一为 `#settings/admin-data-center`。

### 路由兼容

| 旧路由 | 新目标 | 处理结果 |
|---|---|---|
| `#dataCenter` | `#products` | 兼容重定向 |
| `#data-center` | `#products` | 兼容重定向 |
| `#dataCenter/*` 经营子路由 | `#products` | 兼容重定向 |
| `#dataCenter/sync` | `#settings/admin-data-center` | 兼容重定向 |
| `#dataCenter/platform-goods-excel` | `#settings/admin-data-center` | 兼容重定向 |

链接中心遗留 `data-center` section 同样转向产品中心，不再进入退役页面。

### API 与 Service

已从运行时路由移除以下经营数据中心旧 API：

- `/api/data-center/summary`
- `/api/data-center/trends`
- `/api/data-center/slow-moving`
- `/api/data-center/capital-occupation`
- `/api/data-center/products/:productId`

保留全部 `/api/data-sync-center*` 同步接口，继续使用现有 `dataSyncCenterService`。`dataCenterService` 已收敛为明确的退役边界，不再承载运行时经营查询；产品经营读取继续由产品中心正式读模型提供。

### 权限

- 经营驾驶舱从 `dataCenter.view` 拆分为 `operations.view`。
- 旧 `dataCenter.view` 仅在权限标准化时映射到 `operations.view`，用于存量账号兼容。
- 管理员同步入口要求管理员身份和 `settings.manageAdminDataCenter`，普通运营用户不可见。

## 3. 启动依赖结果

- `main.js` 不再静态导入 `dataCenterPage.js`。
- 正式模块清单不存在 `dataCenter`。
- `dataCenterPage.js` 仅由 `moduleLoader` 在管理员进入同步中心时动态导入。
- 首屏和普通经营路由不会加载管理员同步页面。

## 4. 回归验证

- 产品中心：旧 `#dataCenter` 实测重定向到 `#products`，页面正常显示产品列表及经营数据。
- 管理员同步：旧同步路由重定向到 `#settings/admin-data-center`；开发后端重新载入新模块注册后健康检查正常。
- 链接中心：未修改链接业务数据或同步能力，相关回归测试通过。
- 同步能力：`/api/data-sync-center*` 路由完整保留，权限边界不变更业务行为。
- 静态依赖扫描：未发现正式 `dataCenter` 模块注册、静态导入或 `/api/data-center` 业务路由残留。

## 5. 自动验证

- `npm run check`：通过。
- `npm run test:v2-cleanup`：6/6 通过。
- `npm run test:product-business`：6/6 通过。
- `git diff --check`：通过。
- API 健康检查：`status=ok`、`database=ok`。
- `PRAGMA integrity_check`：`ok`。
- `PRAGMA foreign_key_check`：无结果，表示无外键异常。

## 6. 数据保护结果

| 数据基线 | 验证值 |
|---|---:|
| 销售日报事实 | 11,548 |
| 销售额 | 1,327,063.9502 |
| 利润 | 624,038.6962 |
| Sales Object | 6,365 |
| Product | 2,958 |
| Link | 9,551 |

本阶段没有数据库写入、Schema删除或历史数据删除。

## 7. 保留兼容项与后续建议

- 保留旧路由重定向，建议至少跨一个正式发布观察窗口后再评估移除。
- 保留旧 `dataCenter.view` 权限映射，仅用于存量用户迁移，不应再作为新权限配置入口。
- `dataCenterPage.js` 当前只承载管理员同步界面；后续可在独立低风险任务中重命名为 `adminDataCenterPage.js`，本阶段不做无必要文件迁移。
- 旧数据库资产及历史数据不在本阶段退役范围。

## 8. 最终判断

通过。经营数据中心已不再作为业务模块加载，必要同步能力、管理员权限和旧路由兼容均得到保留，具备进入下一步提交审计条件。
