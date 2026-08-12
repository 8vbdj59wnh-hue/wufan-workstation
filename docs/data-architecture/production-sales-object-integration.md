# V2-RELEASE-001 Sales Object生产兼容整合报告

## 1. 整合结论

基于生产提交`33f395564eee6f6bb62313fb9dce62bca5993b2d`创建后继分支，顺序整合V2-DATA-018、V2-DATA-022和V2-PRODUCT-003。未强制覆盖、未reset生产历史、未删除Legacy关系。

整合时保留了生产线已有的产品经营看板、SKU管理和数据库迁移，仅追加Sales Object Schema、读取门面及组合SKU管理入口。

## 2. 迁移内容

新增正式表：`sales_objects`、`sales_link_sku_sales_object_relations`、`sales_object_structures`、`sales_object_structure_components`，包含唯一active关系、唯一active结构、quantity>0、ERP外键、版本和有效期约束。

历史数据由`generateSalesObjectsFromMasterData`基于平台货品表和组合装明细精确生成；重复执行幂等。旧active mapping和Link Product Structure继续保留。

## 3. 隔离预演

在生产只读数据库副本中完成迁移和历史数据生成：

| 指标 | 结果 |
|---|---:|
| Sales Object | 6,365 |
| single | 2,722 |
| bundle | 3,643 |
| Link SKU active关联 | 31,769 |
| 结构 | 6,365 |
| 组件 | 10,425 |
| 最终ERP组件 | 2,842 |
| Product覆盖 | 2,842 / 2,842 |
| 新旧Resolver一致 | 31,765 |
| 新增权威解释 | 4 |
| 减少 | 0 |
| 冲突 | 0 |

Legacy资产在生成前后不变：mapping 43,316，Link Product Structure 10,949，销售日报事实11,548。

## 4. 业务回归

- Product Workspace：正常加载；
- SKU管理：列表正常；
- 组合SKU管理：3,643个bundle，列表按Sales Object去重，详情组件、Link反查和Product关联正确；
- 链接详情：Sales Object组件可用；
- 产品关联：通过读取门面返回Sales Object来源；
- 驾驶舱：4,485个链接正常读取；
- 销售额：1,327,063.9502，前后不变；
- 利润：624,038.6962，前后不变；
- 组合金额按源销售行计一次，不复制到组件。

`npm run check`通过，`integrity_check=ok`，`foreign_key_check=0`，源数据库SHA-256前后不变。

## 5. 发布与回滚方案

发布前必须使用现有发布工具：验证生产HEAD是本提交祖先、确认工作区干净、生成源码包SHA-256、备份生产数据库和源码、检查服务与5173/3001端口。历史数据生成需在备份后执行并复核固定数量与幂等。

回滚时停止新服务，恢复发布前源码提交和数据库备份，再恢复服务并验证健康接口。不得只删除新表后继续运行新代码。

## 6. 是否可发布

代码与隔离数据库预演已满足发布候选条件。当前任务按要求不发布生产；正式发布仍需执行生产备份、迁移预览、历史数据生成和发布后浏览器验证。
