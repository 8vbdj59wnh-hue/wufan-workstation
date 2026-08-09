# V2-LINK-012 LinkBusinessTable 能力评估

> 审计日期：2026-08-09  
> 审计基线：`2f2876fe9dbf1c36c31df5a4338c2a3642869b56`  
> 范围：真实生产代码、SQLite schema、生产只读数据覆盖、现有 Capability / Module / Workspace  
> 结论：**可建设，但不能把“字段存在”直接视为“全量可靠指标”。建议在现有 LinkDataTable 之上新增独立的经营分析查询契约，分阶段开放字段。**

## 1. 评估口径

本报告使用以下状态：

| 状态 | 含义 |
| --- | --- |
| A 已有 | 数据、唯一口径和可复用查询能力均已存在 |
| B 已有但需整理 | 已有数据和能力，但查询契约、时间口径、无数据语义或服务端排序尚未统一 |
| C 数据存在，缺查询能力 | 生产数据表已有字段，但当前 LinkDataTable 未提供该列对应的服务端聚合、排序或筛选 |
| D 无可靠数据 | 当前生产没有该字段，或实际覆盖不足以作为可靠经营指标 |
| E 业务需确认 | 存在两个及以上不同语义或规则，不能由技术实现自行选择 |

“无数据”与数值 `0` 严格区分。只有存在对应期间事实记录时，数值零才表示真实的零。

## 2. 当前能力

### 2.1 LinkDataTable 已有能力

当前 `QueryLinkDataTable` 已经支持：

- `mine` / `company` 权限范围；`company` 仅管理员可用；
- 7 日、30 日、自定义日期；
- 服务端分页，默认 50 条，允许 20–200 条；
- 名称、标题、平台商品 ID 搜索；
- 平台、店铺、档案状态筛选；
- 名称、平台、店铺、昨日/7 日/30 日/所选期间销售额、档案状态的服务端排序；
- 主图、名称、平台、店铺、商品 ID、负责人、销售额、增长、健康、医院、档案状态；
- 销售字段的 `hasData / noData` 语义；
- 字段显隐和顺序保存在当前浏览器 `localStorage`；
- 当前页的增长、健康、医院状态采用批量读取，不存在逐行 SQL 的典型 N+1。

现有模块可直接复用：

- `link_image`
- `link_data_table`
- `link_column_setting`
- `link_data_toolbar`

### 2.2 当前 LinkDataTable 与目标差距

当前能力仍是“简单链接数据列表”，不是完整经营分析表：

- 销售聚合只返回金额，未返回销量、成本、利润和利润率；
- 流量、转化数据未进入列表查询；
- 负责人、销售区间、利润区间、健康、增长等筛选未进入统一服务端查询；
- 增长、健康、医院状态在分页后补充，不能用于全量集合的正确服务端排序和筛选；
- 当前销售排序 SQL 使用 `COALESCE(..., 0)`，会把“无事实”和“真实为 0”放进同一排序值；LinkBusinessTable 必须修正该语义；
- “全部链接”仍有另一套列表、字段配置和筛选实现，不能简单复制为第三套实现；
- 当前字段配置只在单浏览器生效，不支持跨设备、默认视图或用户命名视图。

## 3. 生产数据覆盖基线

本次通过 SQLite `mode=ro` 对真实生产库做只读统计，没有写入数据库。

| 数据对象 | 行数 | 覆盖链接 | 日期范围 / 说明 |
| --- | ---: | ---: | --- |
| `connection_profiles` | 4,345 | 4,345 | 全部 `status=active` |
| `sales_links` | 9,051 | — | 其中 4,345 条已建立经营档案 |
| `connection_period_snapshots` | 6,615 | 2,181 | 2026-06-02 至 2026-08-07 |
| `connection_sku_sales_facts` | 505 | 268 | 2026-08-01 至 2026-08-02 |
| `finance_entries` | 0 | 0 | 当前无独立财务分录 |
| `connection_health_records` | 0 | 0 | 当前无持久化健康记录 |

平台经营快照字段覆盖：

| 字段 | 非空行数 | 结论 |
| --- | ---: | --- |
| 访客 | 6,168 | 部分链接/期间可用 |
| 浏览 | 6,168 | 部分链接/期间可用 |
| 加购 | 6,028 | 部分链接/期间可用 |
| 下单买家 | 4,768 | 覆盖不完整 |
| 支付买家 | 5,977 | 部分链接/期间可用 |
| 转化率 | 5,976 | 部分链接/期间可用 |
| 支付金额 | 5,977 | 部分链接/期间可用 |
| 支付件数 | 5,977 | 部分链接/期间可用 |
| 点击 | 0 | 当前生产不可用 |
| 收藏 | 5,105 | 只在部分平台模板的 `metricsJson` 中存在 |

因此 LinkBusinessTable 必须返回“数据日期、数据来源、字段级 `hasData`”，不能用一张快照的存在推断所有指标都有数据。

## 4. 字段矩阵

### 4.1 基础字段

| 字段 | Data 来源 | 当前 Capability | 状态 | 评估 |
| --- | --- | --- | --- | --- |
| 主图 | `connection_profiles.mainImage` | LinkImage / QueryLinkDataTable | A | 已有统一图片占位与错误回退 |
| 链接名称 | `connection_profiles.name`、`sales_links.title` | QueryLinkDataTable | A | 经营档案名称为当前列表主名称 |
| 平台 | `sales_shops.platform` | QueryLinkDataTable | A | 可筛选、可排序 |
| 店铺 | `sales_links.shopId → sales_shops` | QueryLinkDataTable | A | 可筛选、可排序 |
| 商品 ID | `sales_links.platformGoodsId` | QueryLinkDataTable | A | 可搜索，当前未作为独立筛选 |
| 负责人 | `connection_profiles.ownerId → persons` | 权限范围 / QueryLinkDataTable | B | 可展示；`company` 缺负责人服务端筛选 |
| 商品/SKU关系 | `sales_link_skus`、V2 映射 | 链接详情能力 | B | 可做关系筛选，但必须继续使用 V2 关系，不退回旧 `productId` 身份 |

### 4.2 销售字段

| 字段 | Data 来源 | 当前 Capability | 状态 | 评估 |
| --- | --- | --- | --- | --- |
| 销售额 | `connection_sku_sales_facts.salesAmount` | QueryLinkDataTable / LinkSalesRanking | A | 已支持期间聚合、分页、排序及 noData |
| 销量 | `connection_sku_sales_facts.shippedQuantity` | LinkSalesRanking、V3 Metrics | C | 数据完整存在于 505 条事实，表格查询尚未输出 |
| 支付件数 | `connection_period_snapshots.payQuantity` | Growth Capability | B | 平台口径，覆盖 2,181 个链接；不可与 ERP 发货销量混称“销量” |
| 买家数 | `connection_period_snapshots.payBuyerCount` | Growth Capability | C | 数据存在但缺表格查询、排序和筛选，且只有部分覆盖 |
| 客单价 | 可选 `payAmount / payBuyerCount` | 无唯一 Capability | E | 现有 `customerValue` 实际按 `payAmount / payQuantity`，更接近件单价；需确认客单价定义后才能开放 |
| 销售增长 | 销售事实两期或平台快照两期 | Growth / V3 Metrics | B | 已有回退组合逻辑，但需冻结列表的来源优先级和比较周期；当前不能全量服务端排序 |

建议 UI 明确区分：

- `ERP销售额 / ERP发货销量`：来自销售利润事实；
- `平台支付金额 / 平台支付件数 / 支付买家数`：来自平台经营快照。

禁止把两类数据在同一列中静默回退或相加。

### 4.3 流量字段

| 字段 | Data 来源 | 当前 Capability | 状态 | 评估 |
| --- | --- | --- | --- | --- |
| 展现 | 无统一 schema 字段 | 无 | D | `viewCount` 是商品浏览量，不应改名为展现量 |
| 访客 | `connection_period_snapshots.visitorCount` | Growth Capability | C | 数据存在，缺统一列表聚合/排序/筛选 |
| 点击 | `metricsJson.clickCount` 设计位 | 导入映射存在 | D | 生产非空覆盖为 0，不能作为可用指标 |
| 收藏 | `metricsJson.favoriteCount` | 导入映射存在 | C | 5,105 行有数据，但平台覆盖不一致，必须逐字段 noData |
| 加购 | `connection_period_snapshots.cartCount` | Growth Capability | C | 6,028 行有数据，需区分平台字段是人数还是件数 |

### 4.4 转化字段

| 字段 | Data 来源 | 当前 Capability | 状态 | 评估 |
| --- | --- | --- | --- | --- |
| 支付转化率 | `connection_period_snapshots.conversionRate` | Growth Capability | B | 有权威导入字段；跨行汇总当前按访客加权，需要保留来源口径 |
| 收藏转化 | 收藏与访客/点击的组合 | 无 | E | 分母未确认，且点击无生产数据；不可自行定义 |
| 加购转化 | 加购与访客/点击的组合 | 无 | E | 分母及“加购人数/件数”跨平台语义未统一 |

### 4.5 利润字段

| 字段 | Data 来源 | 当前 Capability | 状态 | 评估 |
| --- | --- | --- | --- | --- |
| 成本 | `connection_sku_sales_facts.costAmount` | V3 Metrics | C | 数据完整存在于当前销售事实，缺所选期间表格聚合 |
| 利润 | `connection_sku_sales_facts.profitAmount` | V3 Metrics | C | 可按所选期间聚合，不能混用当前为空的 `finance_entries` 净利润 |
| 利润率 | `SUM(profitAmount) / SUM(salesAmount)` | V3 Metrics | C | 应使用汇总后的比率，不平均行利润率；销售额无事实时返回 noData |

`finance_entries` 的净利润属于另一财务口径，当前生产为 0 行。LinkBusinessTable P0 应使用销售事实中的成本/利润，并明确标签；不得把两套利润语义合并。

### 4.6 经营状态

| 字段 | Data 来源 | 当前 Capability | 状态 | 评估 |
| --- | --- | --- | --- | --- |
| 增长状态 | Growth + V3 Metrics | `resolveConnectionGrowthDirection` | B | 已有规则；需在分页前形成可排序/筛选结果，不能前端重算 |
| 健康状态/健康分 | Growth Capability | 健康分析 | B | 当前可动态计算，但生产无持久化健康记录；查询必须复用现有规则 |
| 医院状态 | 诊断/改善/医院现有表 | `getConnectionHospitalStages` | B | 已有能力，需整理为可服务端筛选字段 |
| 档案状态 | `connection_profiles.status` | QueryLinkDataTable | A | 已有筛选与排序 |
| 等级 | `connection_profiles.level` | 档案更新能力 | E | 生产 4,345 条全部为 `new`；这是人工档案等级，不等于爆款/热销等经营分级，不应自行解释或自动计算 |

上述状态必须继续分列，禁止合并成一个“经营状态”。

## 5. 排序能力评估

### 5.1 当前已支持

- 名称、平台、店铺、档案状态；
- 昨日、7 日、30 日和所选期间销售额。

### 5.2 可安全补齐

以下字段可以在统一 SQL 聚合后进行服务端排序：

- ERP销量；
- ERP成本、利润、利润率；
- 平台支付金额、支付件数、买家数；
- 访客、浏览、收藏、加购、支付转化率。

必须规定 NULL 排序：无数据始终置后，不得用 `COALESCE(NULL, 0)` 冒充真实零。

### 5.3 需要整理后才能支持

- 销售增长：需要在 SQL 中得到当前期和对比期，而不是先分页再计算；
- 健康分/健康状态：需要复用现有公式形成批量结果，再在 LIMIT 前排序；
- 医院状态：需要基于现有诊断、改善状态的权威查询形成可连接结果；
- 等级：技术上可排序，但业务意义需先确认。

结论：目标中的任意可靠字段服务端排序可实现，但不能沿用“先分页、再补状态”的当前结构。

## 6. 筛选能力评估

| 筛选 | 当前状态 | 建议 |
| --- | --- | --- |
| 平台、店铺、档案状态 | 已有 | 直接复用 |
| 负责人 | 数据已有 | `company` 增加精确 ownerId 服务端筛选；`mine` 固定当前用户 |
| 商品 | 只有关键词/旧列表产品编码筛选 | 统一定义为商品 ID、链接名称；产品/SKU关系另列精确筛选 |
| 销售区间 | 缺失 | 对所选销售口径和日期范围做 HAVING/外层条件 |
| 利润区间 | 缺失 | 仅对有销售利润事实的链接筛选；无数据单独选项 |
| 健康状态 | 旧列表存在，LinkDataTable 缺失 | 复用现有健康规则，服务端筛选 |
| 增长状态 | 缺失 | 复用现有状态能力，服务端筛选 |
| 医院状态 | 缺失 | 复用医院阶段能力 |
| 昨日、7日、30日、自定义 | 7日/30日/自定义已有，昨日有独立销售列 | 统一为时间范围 preset，并保留昨日快捷项 |

数值筛选必须支持三态：有数据范围、真实零、无数据。不能只提供 `min/max` 后把 NULL 排除得不透明。

## 7. 字段配置保存方案

### 7.1 当前 localStorage 是否足够

短期 P0 足够：

- 字段显隐；
- 字段顺序；
- 无数据库变更；
- 适合先验证全部链接经营分析表。

但它不适合作为长期方案：

- 换浏览器或设备后丢失；
- 无法区分 `mine/company` 或不同 Workspace；
- 无命名视图、默认视图和共享策略；
- 管理员无法发布公司标准视图；
- 清理浏览器数据即丢失。

### 7.2 长期 `link_table_views` 建议

后续可新增仅保存 UI 配置的表：

| 字段 | 说明 |
| --- | --- |
| `id` | 视图 ID |
| `userId` | 所属用户 |
| `workspaceKey` | 如 `all_links` / `my_links` |
| `name` | 视图名称 |
| `columnsJson` | 字段顺序、显隐、宽度 |
| `filtersJson` | 筛选条件 |
| `sortJson` | 排序字段和方向 |
| `dateRangeJson` | 日期预设或自定义范围 |
| `isDefault` | 用户默认视图 |
| `createdAt / updatedAt` | 审计时间 |

边界：只保存 UI 查询配置，不保存销售结果、健康结果、SQL、公式或权限。服务端仍须校验字段白名单和用户权限。共享视图可后置，不应进入基础版。

## 8. 性能评估

### 8.1 4,345 链接规模

规模本身适合 SQLite 服务端分页。现有销售分布能力已证明 4,345 个链接的销售聚合可在毫秒级完成，但 LinkBusinessTable 不应返回全部行；默认每页 50 条仍是正确边界。

### 8.2 当前查询计划观察

生产 `EXPLAIN QUERY PLAN` 显示：

- 销售事实聚合使用 `idx_connection_sku_sales_link_period` 扫描；
- 平台快照聚合使用 `idx_connection_period_snapshots_sales_link_period` 扫描；
- 聚合指标排序需要临时 B-Tree；
- 当前以 `substr(periodStart, 1, 10)` 过滤，不能充分利用日期范围索引；
- 当前事实仅 505 行、快照 6,615 行，性能尚可，但历史持续增长后会放大扫描成本。

### 8.3 推荐查询架构

新增 `QueryLinkBusinessTable`，而不是不断扩大页面私有查询：

1. 先确定权限范围、基础筛选和日期范围；
2. 根据请求字段白名单选择必要的聚合 CTE；
3. 销售事实与平台快照分别聚合，保持来源列独立；
4. 在 SQL 层完成条件、排序、总数和分页；
5. 只对当前页批量读取必要摘要，不读取 raw JSON；
6. 返回字段级 `hasData`、`dataDate`、`sourceType`；
7. 详情和历史趋势继续按需加载。

动态字段查询必须是服务端白名单选择预定义 SQL 片段，不能接受客户端 SQL、公式或任意字段名。

### 8.4 索引结论

当前不建议仅看到字段就新增索引。实现阶段应针对最终 SQL 再做 EXPLAIN 与基准测试。优先检查：

- 日期谓词是否可直接使用规范化日期文本，避免 `substr`；
- 销售事实按期间过滤后按 `salesLinkId` 聚合的索引顺序；
- 平台快照按期间、来源和链接聚合的索引顺序；
- `connection_profiles(ownerId,status)` 已存在，可复用 mine 范围；
- 数值聚合排序本身仍可能使用临时 B-Tree，不能靠盲目单列索引消除。

## 9. Capability 与 Module 设计

### 9.1 Data → Capability → Module → Workspace

```text
BusinessLink / ConnectionProfile
ConnectionSkuSalesFact
ConnectionPeriodSnapshot
ConnectionHealth / Hospital
        ↓
QueryLinkBusinessTable
        ↓
link_image
link_business_toolbar
link_indicator_setting
link_business_table
        ↓
全部链接 Workspace
```

### 9.2 QueryLinkBusinessTable

建议输入：

- `scope`: `mine | company`
- `dateRange`: `yesterday | 7d | 30d | custom`
- `page / pageSize`
- `keyword`
- `filters`: 基础、经营状态、数值区间、无数据选择
- `sort`: 单字段服务端排序；首版不做多列排序
- `fields`: 指标白名单

建议输出：

- 当前页行；
- 分页总数；
- 字段定义与可用性；
- 数据日期和来源；
- 字段级 noData；
- 筛选选项；
- 当前用户实际 scope。

它应复用已有销售、增长、健康和医院能力的业务规则；可整理查询实现，但不得复制第二套计算口径。

### 9.3 标准 Module

| Module | 职责 | 复用/新增 |
| --- | --- | --- |
| `link_image` | 主图、占位、错误回退 | 直接复用 |
| `link_business_table` | 高密度经营分析表、服务端分页/排序、无数据展示 | 新增；可复用 LinkDataTable 表格基础样式和交互 |
| `link_indicator_setting` | 指标分组、显隐、顺序；显示指标覆盖说明 | 从 LinkColumnSetting 演进，不能另造不兼容配置 |
| `link_business_toolbar` | 搜索、日期、基础/经营筛选、视图入口 | 从 LinkDataToolbar 演进 |

不建议让 `link_business_table` 取代简单的 `link_data_table`：两者用途不同。可共享底层表格呈现和字段配置协议，但 LinkBusinessTable 需要更严格的指标来源与 noData 契约。

## 10. 开发顺序

### P0：可靠经营基础表

1. 冻结字段字典、来源标签和 noData 协议；
2. 建立 `QueryLinkBusinessTable`；
3. 接入基础字段、ERP销售额/销量、成本、利润、利润率；
4. 接入平台支付金额/件数/买家、访客、浏览、加购、转化率，并逐字段显示覆盖；
5. 服务端分页、搜索、基础筛选、数值区间、可靠字段排序；
6. 使用 localStorage 保存字段显隐/顺序；
7. 仅接入“全部链接”，保持 LinkDataTable 在“我的链接”稳定运行。

### P1：状态和高级筛选

1. 把现有增长、健康、医院状态整理为分页前可筛选/排序的查询结果；
2. 增加负责人、商品/SKU关系等精确筛选；
3. 优化日期索引与事实增长后的查询性能；
4. 增加字段覆盖说明和数据源提示。

### P2：持久化用户视图

1. 人工确认后新增 `link_table_views`；
2. 支持用户默认视图、命名视图和跨设备恢复；
3. 共享视图、复杂组合筛选后置。

### 暂不开发

- 点击（生产覆盖为 0）；
- 展现（没有统一字段，不能用浏览代替）；
- 收藏转化、加购转化（分母和跨平台语义未确认）；
- 提成、自定义公式、低代码报表；
- 自动链接评级；
- 把 ERP 销售与平台支付指标混合成一列。

## 11. 主要风险

1. **口径混淆**：ERP发货销量、平台支付件数、支付买家数不是同一指标。
2. **客单价误命名**：现有 `payAmount / payQuantity` 是件单价语义；买家客单价应另行确认。
3. **覆盖差异**：4,345 个经营链接中，平台快照覆盖 2,181 个，销售利润事实覆盖 268 个；大量 noData 是真实数据现状。
4. **状态重复实现**：若在表格 SQL 中重写增长/健康规则，会形成第二套业务口径。
5. **分页后计算**：当前状态在分页后补充，不能直接用于全量正确排序和筛选。
6. **NULL 被当成 0**：当前销售排序方式需要在经营表中修正。
7. **跨平台字段不一致**：收藏、加购等字段在不同模板中可能代表人数或件数。
8. **等级语义未冻结**：当前 `level` 全部为 `new`，不能解释为经营评级。
9. **历史增长后的扫描**：当前数据量小，但快照和事实持续增长，需要按最终 SQL 做索引验证。

## 12. 最终结论

LinkBusinessTable **具备建设基础**，推荐状态为“可进入 P0 开发，但字段分级开放”。

- 基础身份、权限、分页、搜索、日期和销售额能力已经成熟；
- 销量、成本、利润、利润率属于“数据已存在、缺统一表格查询”；
- 平台访客、浏览、加购、买家和转化具备部分覆盖，可作为带 noData 的可选指标；
- 点击、展现和衍生收藏/加购转化当前不可作为可靠功能；
- 长期用户视图表合理，但基础版应继续使用 localStorage，避免提前扩展数据库；
- 新能力必须复用现有销售事实、增长、健康和医院规则，不创建第二套经营计算。

本次只新增评估文档，没有修改代码、数据库、API、权限或任何业务规则。
