# Architecture Cleanup-001 Legacy读取依赖解除 Phase 5D验收报告

## 一、验收结论

Phase 5D 已完成。正式业务中的 Link SKU → ERP组件关系读取已统一到 Sales Object；Legacy Resolver 仅保留诊断比较；旧周期销售事实只保留数据库归档与资产目录说明，不再提供业务读取或重新迁移入口。

本阶段未删除 Legacy 表、字段或历史数据，未修改销售事实、历史 mapping、旧 Product Structure 和 ERP SKU 数据。

## 二、读取迁移范围

| 场景 | 原读取来源 | 当前读取来源 | 结果 |
|---|---|---|---|
| 平台货品关系比较 | `sales_link_sku_erp_mappings` | Sales Object active relation + active structure + active components | 已迁移 |
| ERP用途候选关系证据 | `sales_link_sku_erp_mappings` | Sales Object active components | 已迁移 |
| 产品SKU影响检查 | Legacy active mapping | Sales Object组件经 `product_erp_mappings` 关联Product | 已迁移 |
| 货品结构审批预览与执行 | Legacy mapping实时快照 | Sales Object relation、structure及version | 已迁移 |
| 旧周期销售事实重新解析 | `connection_sku_sales_facts` | 不再提供迁移入口；新数据只走daily facts | 已关闭 |

## 三、Resolver隔离

- 正式读取门面：`ResolveLinkSkuRelationRead`。
- 正式返回来源：`sales_object`。
- `ResolveLinkSkuErpRelation` 已标记为 `diagnostic_only`。
- 旧 Resolver 仅在显式 `shadowCompare === true` 时执行，比较结果不影响正式返回。
- 自动门禁禁止其他正式服务直接导入旧 Resolver。

## 四、审批与审计解耦

新审批应用使用：

- `salesObjectId`
- `salesObjectStructureId`
- `salesObjectStructureVersion`
- Sales Object组件快照

审批项、批次、前一结构ID及关系模型写入 Sales Object relation/structure/component 的 `sourceReferenceJson`。历史 `productStructureId` 字段和旧审计记录继续保留，不删除、不改写；新流程不依赖其生成正式关系。

## 五、旧销售事实关闭

- 删除旧利润表“按日报模型重新解析”的服务端路由。
- 删除对应前端Service门面、页面按钮和事件。
- `connection_sku_sales_facts` 不再被正式服务读取或写入。
- 历史记录仍以只读归档形式存在。
- 正式利润表导入继续只写 `connection_sku_sales_daily_facts`，重复提交保持幂等。

## 六、生产副本只读核对

核对数据库：`data/workstation.db`。

| 指标 | 结果 |
|---|---:|
| daily facts | 11,548 |
| 销售额 | 1,327,063.9502 |
| 利润 | 624,038.6962 |
| 日期范围 | 2026-07-09 至 2026-08-09 |
| Sales Object | 6,365 |
| active Link SKU → Sales Object | 31,769 |
| active Sales Object Structure | 6,365 |
| Legacy mapping历史记录 | 43,320 |
| Legacy销售事实历史记录 | 12,422 |

关系集合对比：

| 指标 | 数量 |
|---|---:|
| Sales Object组件关系对 | 43,323 |
| Legacy active关系对 | 43,320 |
| 两者一致关系对 | 43,320 |
| Sales Object新增覆盖 | 3 |
| Legacy存在但Sales Object缺失 | 0 |

因此读取迁移不会降低关系覆盖，并可读取3个此前仅存在于Sales Object的关系对。销售事实表未发生变化，销售额和利润基线保持一致。

## 七、防回归与验证结果

- `npm run check`：通过。
- `npm run test:v2-cleanup`：5项通过。
- `npm run test:product-business`：4项通过。
- 销售事实单轨测试：2项通过。
- Legacy读取/写入静态门禁：0项风险。
- `git diff --check`：通过。
- SQLite `integrity_check`：`ok`。
- SQLite `foreign_key_check`：0项。

自动验证覆盖：

1. 正式业务代码不得读取Legacy mapping、Link Product Structure或旧周期销售事实；
2. 旧Resolver仅允许诊断门面调用；
3. 新审批只生成Sales Object关系及版本结构，Legacy数量不增长；
4. 正式销售导入只增加daily facts；
5. 重复导入新增0且返回幂等；
6. 产品关联、产品经营读取和Sales Object-only关系正常。

## 八、保留兼容资产

以下资产仍保留，不属于正式运行时来源：

- `sales_link_sku_erp_mappings`
- `sales_link_sku_product_structures`
- `sales_link_sku_product_structure_components`
- `connection_sku_sales_facts`
- `ResolveLinkSkuErpRelation`

保留用途仅限Schema兼容、历史数据归档、资产目录和显式诊断比较。后续删除前仍需单独执行数据归档、外部脚本清理与生产回滚验证。

## 九、最终状态

正式运行时关系来源已收口为 Sales Object。Phase 5D 验收通过，可进入下一阶段的Legacy外部脚本与Schema退役准备；本阶段未提交、未发布。
