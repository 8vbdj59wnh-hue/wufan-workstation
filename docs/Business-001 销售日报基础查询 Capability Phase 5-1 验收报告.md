# Business-001 销售日报基础查询 Capability Phase 5-1 验收报告

## 1. 查询能力

本阶段新增三个只读 Capability：

- `QueryDailySalesSummary`：按链接、链接 SKU、ERP SKU、产品及日期范围汇总销量、销售额、成本和利润。
- `QueryDailySalesTrend`：按自然日返回趋势，并显式补齐请求区间内的无数据日期。
- `QueryDailySalesBySku`：按链接查询其链接 SKU 经营汇总，同时返回每个链接 SKU 对应的 ERP SKU 集合。

所有查询只读取 `connection_sku_sales_daily_facts`。未读取旧周期事实 `connection_sku_sales_facts`，未重新解析链接 SKU—ERP SKU 关系，也不写入任何业务数据。

## 2. 返回结构

三个能力统一返回：

- `source: daily_fact_v1`
- `hasData`
- `dataStart`
- `dataEnd`
- `coverage.requestedDays`
- `coverage.dataDays`
- `coverage.ratio`

汇总能力同时返回 `quantity`、`salesAmount`、`costAmount`、`profitAmount`、`dataCount`。

趋势能力返回请求日期范围内的完整日期序列。无事实日期返回 `noData=true`，数值字段为 `null`；存在事实且指标真实为零时保留 `hasData=true` 和数值 `0`。

链接 SKU 分析返回 `salesLinkSkuId`、去重并稳定排序的 `erpSkuIds` 集合，以及销量、销售额、成本、利润和事实数量。

## 3. 聚合规则

- `salesLink`：直接按日报事实的 `salesLinkId` 聚合。
- `salesLinkSku`：直接按日报事实的 `salesLinkSkuId` 聚合。
- `erpSku`：直接按日报事实的 `erpSkuId` 聚合。
- `product`：日报事实通过 `product_erp_mappings` 中 `currentState='active'` 的有效关系归入产品；未建档 ERP SKU 的事实仍保留在事实表中，但不会被强制归入产品。
- 7日、30日或任意日期范围均直接在日报事实上执行数据库聚合，不生成新的周期事实。

## 4. 隔离验证结果

验证数据库为 Phase 4 隔离数据库副本，事实日期为 2026-07-09 至 2026-08-09，共 171 条日报事实。

| 验证项 | 结果 |
|---|---|
| 单链接汇总 | 55条事实，销售额 7,543.97，利润 2,722.2456，与直接 SQL 一致 |
| 单链接 SKU 汇总 | 32条事实，销售额 6,389.93，利润 2,298.857，与直接 SQL 一致 |
| 单 ERP SKU 汇总 | 82条事实，销售额 10,184.34，利润 3,719.5137，与直接 SQL 一致 |
| 产品聚合 | 82条事实，销售额 10,184.34，利润 3,719.5137，与有效产品映射聚合一致 |
| 链接下 SKU 分析 | 4个链接 SKU 分组，销售额合计 7,543.97，与链接汇总一致 |
| 趋势 | 返回完整32日序列；趋势汇总与链接汇总一致 |
| 无数据 | `hasData=false`，指标为 `null`，未错误显示为0 |
| 重复查询 | 返回结果逐字段一致 |
| 旧事实读取检查 | 未引用 `connection_sku_sales_facts` |

## 5. 性能与执行计划

查询在数据库端完成过滤、聚合和排序，没有加载全部日报事实后在内存筛选。

- 链接维度命中 `idx_connection_sku_sales_daily_link_date`。
- ERP SKU 维度命中 `idx_connection_sku_sales_daily_erp_date`。
- 产品维度先使用产品映射索引定位 ERP SKU，再命中 `idx_connection_sku_sales_daily_erp_date`。
- 链接下 SKU 查询按链接和日期范围执行数据库分组，仅在查询结果上组装 ERP SKU 集合。

## 6. 数据保护

查询前后逐表 SHA-256 摘要一致：

- 日报事实：171条，不变；
- V2 mappings：不变；
- ERP SKU：不变；
- ERP SKU用途：不变；
- Combo Group：不变。

数据库检查：

- `integrity_check`: `ok`
- `foreign_key_check`: 0项异常

## 7. 结论

Phase 5-1 已满足基础经营查询要求，可以进入页面展示阶段。页面接入时应继续直接消费这些 Capability，并保留 `noData` 与真实零值的区别；不得回退到旧周期事实或在页面层重新推导销售事实。
