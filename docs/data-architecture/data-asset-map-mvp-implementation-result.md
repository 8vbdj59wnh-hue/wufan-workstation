# V2-DATA-027 数据资产地图 MVP 验收报告

## 1. 实施结论

数据资产地图 MVP 已完成，入口位于“系统设置 → 数据管理 → 数据资产地图”。模块仅提供读取能力，没有新增业务表、写接口、编辑入口、同步入口或治理入口。

访问权限新增为 `settings.viewDataAssetMap`。管理员默认拥有该权限；数据管理员和开发维护人员可通过现有权限配置获得，普通用户默认不可见，后端所有接口同时执行同一权限校验。

## 2. 页面能力

- 总览：实时展示数据源、业务对象、数据库表、真相源对象数量和表分类。
- 数据源：服务端分页、搜索，展示名称、类型、用途和状态。
- 业务对象：服务端分页、搜索，展示定义、类型、实时数量及 `Source of Truth / Derived / Legacy` 标识。
- 关系地图：固定展示商品销售链、销售经营链和 ERP 库存链；节点数量在请求时实时聚合。
- 详情：点击后按需请求，展示定义、来源、数据表、逐表数量、上游、下游及字段关系。
- 所有返回结果包含 `generatedAt`，页面显示统计时间。

## 3. 数据来源与边界

后端只读 Capability 复用 V2-DATA-024/025/026 已确认的资产目录语义，并直接读取当前 Schema 和业务表统计。目录定义固定，所有业务数量由 SQL 在请求时计算，未硬编码任何统计结果。

未新增数据库表，未修改同步流程、字段映射、业务关系、销售事实、产品、ERP SKU 或权限体系结构。

## 4. 接口

- `GET /api/data-asset-map/overview`
- `GET /api/data-asset-map/sources`
- `GET /api/data-asset-map/sources/:id`
- `GET /api/data-asset-map/objects`
- `GET /api/data-asset-map/objects/:id`
- `GET /api/data-asset-map/graphs/:id`

列表最大 `pageSize=100`；详情和关系图按需读取。总览响应提供 `Server-Timing`。

## 5. 隔离验证

隔离数据库验证结果：

- 数据源目录：8 项。
- 业务对象目录：15 项。
- 当前隔离 Schema：125 张业务表。
- Source of Truth 对象：11 项。
- 总览聚合耗时：0.19ms，满足 `<500ms`。
- 数据源与业务对象分页：通过。
- 三张固定关系图：通过。
- 详情实时表数量：与直接数据库计数一致。
- 管理员默认可访问、普通用户默认不可访问：通过。
- Capability 调用前后全表行数快照一致：通过。
- `integrity_check`：`ok`。
- `foreign_key_check`：0 条。
- `npm run check`：通过。
- `git diff --check`：通过。

## 6. 当前状态

MVP 已具备提交条件。它用于理解数据，不承担修改、同步或治理职责。本次未发布生产。
