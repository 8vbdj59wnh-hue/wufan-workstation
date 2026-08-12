# V2-DATA-022 Sales Object 正式切换验收报告

## 1. 修改范围

本阶段将以下 Link SKU → ERP组件读取接入统一 `ResolveLinkSkuRelationRead`：

- 链接详情组件与Product集合；
- 链接详情销售分析的ERP组成展示；
- Product Workspace产品关联链接；
- ERP SKU管理的链接数量、平台SKU数量、平台筛选与关联链接；
- 组合SKU管理；
- 经营驾驶舱的产品归因关系读取。

新增批量反向能力 `ResolveErpSkuSalesObjectLinks`，用于 ERP SKU/Product → Sales Object → Link SKU。它先从Sales Object组件索引候选，再整批调用统一门面校验，不逐产品查询。

## 2. 正式切换规则

正式业务scope为：`comboSkuManagement`、`linkDetail`、`linkSkuManagement`、`productWorkspace`、`productAssociations`。

每次读取仍双读旧Resolver和Sales Object Resolver：

- 一致或新模型新增权威解释：使用Sales Object结果；
- 减少或冲突：记录结构化日志并自动回退Legacy结果；
- Sales Object不完整：回退Legacy结果。

这保证正式读取以Sales Object为主，同时保留即时回滚保护。

## 3. 未改变的业务口径

- 销售额、销量、成本、利润继续读取 `connection_sku_sales_daily_facts`；
- LinkBusinessTable、LinkSalesRanking和LinkSalesDistribution仍直接聚合事实；
- 库存继续读取现有库存事实；
- Product身份继续由 `product_erp_mappings` 解释；
- bundle组件只提供ERP SKU和quantity，不继承销售金额或利润。

## 4. 隔离回归结果

| 项目 | 结果 |
|---|---:|
| daily facts | 11,548 |
| 销售额 | 1,327,063.9502 |
| 利润 | 624,038.6962 |
| Sales Object最终ERP组件 | 2,842 |
| 已有Product覆盖组件 | 2,842 |
| Product覆盖率 | 100% |
| active mappings（Legacy） | 43,316，未变化 |
| Link Product Structure（Legacy） | 10,949，未变化 |

实际调用验证通过：链接详情、链接日报展示、ERP SKU关联链接、Product Workspace、SKU列表、100条bundle管理以及经营驾驶舱。

新旧Resolver影子基线延续V2-DATA-019：31,765一致、4个新增、0减少、0冲突。正式回归日志只出现已知4个`added`差异，没有减少或冲突。

## 5. Legacy处理方式

以下资产保留，不删除、不冻结写入、不迁移历史内容：

- `sales_link_sku_erp_mappings`；
- `sales_link_sku_product_structures`；
- `sales_link_sku_product_structure_components`；
- 旧 `ResolveLinkSkuErpRelation`。

它们当前承担：双读比较、冲突回退、旧治理审批和审计。普通业务关系读取不再直接以它们作为最终解释，但治理与写入服务仍可按职责读取Legacy资产。

## 6. 数据保护

隔离执行前后：销售事实、active mapping、Link Product Structure、ERP SKU、Product、Product Mapping和库存计数均不变。

检查结果：`integrity_check=ok`，`foreign_key_check=0`。组合金额没有复制到组件。

## 7. 回滚

代码回滚可恢复到V2-DATA-020默认关闭门面；数据库无需恢复。由于Legacy关系和旧Resolver完整保留，出现`reduced/conflict`时当前代码也会自动按单个Link SKU回退。

## 8. 结论

Sales Object Resolver已正式接入指定业务读取，销售、利润、库存和产品档案数据均未修改。当前可以进入生产发布前检查，但暂不应删除或冻结Legacy关系资产。
