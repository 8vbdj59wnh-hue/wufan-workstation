# V2-PERFORMANCE-003 产品中心查询优化方案评估

## 1. 结论

产品中心 SKU 列表约 6 秒的主要瓶颈不在网络、响应体或当前页 SQL，而在列表查询分页之前对全部 6,902 个 active ERP SKU 执行 Sales Object 反向解析及新旧 Resolver 比较。

当前 SQL 已使用 `candidates` CTE 对主列表分页，但业务调用顺序仍是：

1. 查询全部 active ERP SKU ID；
2. 全量 `salesObjectLinkContext`；
3. 全量 `resolveErpSkuSalesObjectLinks`；
4. 新旧 Resolver 双读与差异日志；
5. 之后才执行当前页 SQL 并取 50 行。

因此，“SQL 分页”已存在，但“整条查询链分页优先”尚未实现。

## 2. 验证基线

本次使用当前生产数据副本只读复现，代码版本为 `d1e1700feec74aca5f4a9ade101c0a0ae4eb4363`。

| 项目 | 数值 |
|---|---:|
| active ERP SKU | 6,902 |
| 已建档列表总数 | 2,956（当前副本查询口径） |
| daily facts | 11,548 |
| active Sales Object components | 10,425 |
| 默认列表页大小 | 50 |
| 列表 JSON 大小 | 63,016 bytes |

## 3. 实测耗时

| 测量项 | 耗时 | 说明 |
|---|---:|---|
| `listProductCenterV2Skus` 默认 50 行 | 6,682.4ms | 用户可感知的服务端总耗时 |
| 全量 ERP SKU 反向 Resolver（6,902 SKU） | 6,013.6ms | 产生约 94.46MB 中间结果，发现 4 个已知 added 差异 |
| 当前页 Resolver（50 SKU） | 159.6ms | 同一能力缩小输入后的实测 |
| 已建档总数 SQL | 约 50ms | 只读 sqlite3 实测 |
| 候选页 50 行 SQL | 约 10ms | 筛选、排序、LIMIT/OFFSET |
| 50 SKU 销售批量聚合 | 约 1ms | 已命中 ERP/date 索引 |
| 50 SKU 库存批量读取 | 约 4ms | 已命中 SKU/date 索引 |
| Metadata 冷读 | 6,933.8ms | 平台 facet 再次触发全量 Resolver |
| Metadata 30 秒缓存命中 | <0.1ms | 现有内存缓存有效 |

阶段占比估算：

- Resolver/关系展开：约 90%；
- SQL、对象水合及其他服务开销：约 10%；
- 最终 JSON 串行化：响应仅 63KB，不构成主要瓶颈。

注：当前函数未内置分阶段计时点，因此 SQL/水合/序列化为独立只读探针和差额估算；不应将约 669ms 全部归因于 SQL。

## 4. 当前查询链分析

### 4.1 列表主链

`listProductCenterV2Skus` 首先取出全部 active ERP SKU ID，并调用 `salesObjectLinkContext(database, allErpSkuIds)`。该方法：

1. 根据 `sales_object_structure_components` 反查涉及的 Link SKU；
2. 每 500 个 Link SKU 调用读取门面；
3. 对 Sales Object 与 Legacy active mapping 进行 shadow compare；
4. 构建 ERP SKU -> Link SKU 的全量反向 Map；
5. 再查询 Link/SKU/店铺身份。

这个全量 Map 只在最后为 50 行填充 `linkCount`、`platformSkuCount` 和 `platforms`，大量结果不会进入响应。

### 4.2 SQL 链

主 SQL 已用 `candidates` CTE 先取当前页 ID，再查询展示字段。但仍有两类可扩展性问题：

- 库存日期、库存量、可发量、成本价、库存金额、月销量使用多个相关子查询；
- 销量、销售额、利润、销售指标重复聚合 daily facts。

现有数据量下，索引使这些查询尚快；但页大小、事实量或排序范围增大后，重复扫描会放大。

### 4.3 Metadata 链

Metadata 的品牌、类目、生命周期 facet 由 SQL 直接获取；平台 facet 却对全部 ERP SKU 再执行一次 `salesObjectLinkContext`。现有 30 秒进程内缓存只能加速重复请求，无法消除冷启动或缓存过期后的约 6.9 秒延迟。

## 5. 推荐目标链路

建议改为：

`筛选和排序 -> 获取当前页 ERP SKU ID -> 当前页 Sales Object 反查 -> 当前页销售/库存批量聚合 -> 水合 -> 返回`

具体原则：

1. 无平台筛选时，禁止在分页前构建全量关系 Map；
2. 先用 SQL 得到当前页 ID，仅解析这些 ID；
3. 平台筛选不应在 Node 内存中遍历 6,902 个 SKU，应使用 Sales Object 关系表与链接身份表的 `EXISTS`/JOIN 条件；
4. 列表页只返回当前页关系计数和平台集合；详细关系在详情请求中获取；
5. Metadata 平台 facet 改为直接 SQL distinct，不调用完整 Resolver。

## 6. Sales Object 与 Resolver 调整建议

当前 `productAssociations` 已是 Sales Object 正式启用 scope，但读取门面仍会同时获取 Legacy 结果、执行集合比较，并对 4 个已知 `added` 差异在每次全量读取时输出日志。

建议：

- 业务主查询对已正式切换的 scope 只读 Sales Object Resolver；
- 将 shadow compare 移到独立的定时校验、发布验证脚本或小比例采样；
- 差异应去重/限频，不应在每个列表请求重复记录相同对象；
- 保留可快速回退到 Legacy 的 feature flag，但回退能力不等于主链必须永久双读。

风险：当前仍有 4 个 `added` 差异。去除主链 shadow compare 前，应将它们固化为已审核的回归样本，确认 Sales Object 结果是期望真相。

## 7. SQL 调整建议

### 7.1 当前页聚合

将多个相关子查询改为当前页 ID 限定的聚合 CTE：

- `sales_agg`：按 `erpSkuId` 一次聚合 quantity/salesAmount/profitAmount；
- `latest_inventory`：通过窗口函数或 `MAX(businessDate)` + JOIN 一次取最新库存行；
- `link_agg`：从 Sales Object component/relation/link 表按当前页 ERP SKU 聚合 linkCount、platformSkuCount 和 platform。

这会避免每行多次扫描同一事实表，也便于记录分阶段耗时。

### 7.2 排序语义

`sales-desc`、`stock-desc`、`capital-desc` 要求对全部筛选结果排序，不能先随意分页再局部排序。实施时需在数据库中先以聚合指标排序并得到页 ID，再水合当前页，不得改变现有排序口径。

### 7.3 索引评估

现有关键索引已存在：

- daily facts：`(erpSkuId, saleDate)`；
- inventory summaries：SKU/date 索引；
- Sales Object components：ERP SKU 反向索引和 structure 索引；
- Link SKU -> Sales Object：active 唯一索引和 object 索引。

不建议在未执行新 SQL `EXPLAIN QUERY PLAN` 和实测前盲目新增索引。可能值得评估但不应在本阶段建立的索引包括：

- ERP SKU 列表常用筛选/排序的复合索引；
- 产品建档映射的 active + erpSkuId 覆盖索引；
- 若平台筛选 SQL 的计划仍不理想，再评估 relation/link identity 方向的复合索引。

## 8. 缓存建议

### 适合缓存

- 品牌、类目、生命周期、平台 facet；
- 建档/未建档总数与业务分区统计；
- ERP SKU/货品基础展示信息；
- Sales Object 结构和 ERP SKU -> Link 反向关系，但必须在 Sales Object/relation 变更后明确失效。

### 不应长时间缓存

- 当前销售额、利润、销量；
- 当前库存和库存资金；
- 依赖实时同步时点的数据状态。

优先应先消除全量工作，再引入缓存。否则缓存只会把 6 秒延迟变成周期性的 6 秒延迟，并引入一致性风险。

## 9. 性能目标与预计收益

### 目标

- 默认 50 行 SKU 列表：P50 < 500ms，P95 < 1s；
- 常用搜索/筛选：P95 < 1s；
- Metadata 冷读：< 500ms，热读 < 50ms；
- 列表响应维持 < 500KB；
- 查询数量随页大小固定，无 N+1。

### 可达性

仅将 Resolver 输入从 6,902 缩小到 50，实测便从 6,013.6ms 降到 159.6ms。再将双读移出主链、将销售/库存/关系改为当前页批量聚合后，默认列表 <500ms 是合理目标；若暂不移除当前页双读，也应能稳定在 1s 以内。

## 10. 实施顺序

### Phase 1：最小高收益改造

1. 先获取当前页 ERP SKU ID；
2. `salesObjectLinkContext` 仅接收当前页 ID；
3. 平台筛选改为 SQL `EXISTS`/JOIN；
4. Metadata 平台 facet 改为 SQL distinct；
5. 增加只读分阶段性能测试，验证结果集与改造前一致。

预期：默认列表从约 6.7s 降至 0.3–1.0s。

### Phase 2：Resolver 主链收口

1. 将已知 4 个 added 差异固化为回归用例；
2. 正式 scope 只读 Sales Object；
3. shadow compare 改为离线/采样执行；
4. 保留 feature flag 回退。

预期：降低 CPU、内存中间对象与重复日志，提高并发稳定性。

### Phase 3：SQL 聚合收口

1. 销售、库存、关系改为当前页批量 CTE/JOIN；
2. 对新 SQL 执行 `EXPLAIN QUERY PLAN`；
3. 仅对实测仍有扫描的路径增加索引；
4. 建立 P50/P95 基线和数据增长回归测试。

## 11. 风险与验收边界

- 平台、业务分区、销售、库存排序必须在全部筛选结果上计算，不能改成页内排序；
- `includeUnarchived=false` 的默认建档口径不变；
- Sales Object 只读切换必须保留 4 个已知差异的显式验证；
- 不得为了速度将销售或库存变为长时间脏缓存；
- 验收必须比较改造前后页面总数、每种筛选、全部排序和当前页行内容，不只测耗时。

## 12. 最终建议

建议进入实施，但先只做 Phase 1：将关系解析真正移到分页之后，同时将平台 facet/筛选改为直接 SQL。这是最小、最低风险、可以消除约 90% 当前耗时的方案。后续再单独完成 Resolver 双读退出和 SQL 聚合收口。

## 13. 数据与代码保护

本次仅执行生产数据副本的只读查询和服务调用。未修改业务代码，未修改数据库，未新增索引，未提交。

---

## V2-PERFORMANCE-004 实施验收补充

### 实施范围

- SKU 列表先执行全局筛选、排序和分页，再对当前页 ERP SKU 进行 Sales Object 反向解析；
- 列表关系读取仅执行 Sales Object Resolver，Legacy/shadow compare 仍保留在通用读取门面供后台诊断使用；
- 平台筛选改为 Sales Object 关系表的 SQL `EXISTS`；
- Metadata 的平台和店铺选项改为直接 SQL distinct，不执行全量 Resolver；
- 新增隔离库性能与口径回归脚本。

### 性能结果

7 次连续读取的实测结果：

| 场景 | 优化前 | P50 | P95 |
|---|---:|---:|---:|
| 默认50行 | 6,682.4ms | 81.1ms | 432.2ms（包含冷读） |
| 搜索 | - | 32.8ms | 58.2ms |
| 平台筛选 | - | 144.4ms | 244.6ms |
| 销售排序 | - | 134.3ms | 258.5ms |
| 库存排序 | - | 85.5ms | 91.2ms |
| 第2页 | - | 72.1ms | 75.5ms |
| Metadata | 6,933.8ms | 187.9ms（冷读） | - |

默认列表 P50 改善约 98.8%，P95 低于 1 秒。列表路径自动计数确认 Legacy Resolver SQL 为 0，Sales Object Resolver 批量查询为 12 次（回归脚本独立采集）。

### 回归结果

- 默认页、搜索、平台筛选、销售排序、库存排序、翻页通过；
- 列表的 Link SKU 数与 Link 数已和 Sales Object 正式关系直接 SQL 逐行核对；
- 销售指标、库存指标的 SQL 和口径未修改；
- 未增加表、索引或缓存系统，未修改业务数据。
