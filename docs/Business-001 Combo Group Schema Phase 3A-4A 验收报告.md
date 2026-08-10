# Business-001 Combo Group Schema Phase 3A-4A 验收报告

## 1. 验证范围与隔离保护

- 验证方式：复制生产备份后，仅在临时隔离数据库执行迁移与约束测试。
- 隔离源：`/private/tmp/wufan-sales-daily-preview-source.db`
- 隔离源大小：383,500,288 bytes。
- 隔离源 SHA-256：`f62eb61fd188152c3ae9431ee748870caaf9116f6c35875a26853396f7b6f57c`
- 临时验证库在测试结束后自动删除。
- 未连接、未迁移生产数据库；未创建正式 combo mapping；未写入销售日报事实。
- 本阶段未提交、未发布。

## 2. Schema结果

### sales_link_sku_combo_groups

已验证17个字段：

`id`、`salesLinkSkuId`、`groupCode`、`status`、`sourceType`、`sourceBatchId`、`sourceFileHash`、`sourceCandidateIdsJson`、`reviewedBy`、`reviewedAt`、`reviewNote`、`approvedAt`、`invalidatedAt`、`replacedGroupId`、`createdBy`、`createdAt`、`updatedAt`。

状态限制为：`pending`、`approved`、`rejected`、`inactive`、`conflict`。

补充约束：状态为 `approved` 时，`reviewedBy`、`reviewedAt`、`approvedAt` 必须完整，避免产生没有审核记录的正式审核组。

### sales_link_sku_combo_group_components

已验证10个字段：

`id`、`comboGroupId`、`erpSkuId`、`quantity`、`sortOrder`、`status`、`sourceCandidateId`、`decisionNote`、`createdAt`、`updatedAt`。

状态限制为：`included`、`excluded`；`quantity` 必须大于0。

### Mapping追溯字段

`sales_link_sku_erp_mappings` 新增可空 `comboGroupId` 外键，仅用于来源追溯，不承担组合集合定义。原有20,819条 single 映射均保持 `comboGroupId=NULL`，数量与内容未受影响。

## 3. 外键验证

| 关系 | 结果 |
|---|---|
| Combo Group → sales_link_skus | 通过 |
| Component → combo_groups | 通过 |
| Component → erp_skus | 通过 |
| Mapping → combo_group | 通过 |
| 非法平台SKU写入 | 已阻止 |
| 非法ERP SKU写入 | 已阻止 |
| 非法Combo Group写入 | 已阻止 |
| 删除被Group引用的平台SKU | 已阻止 |
| 删除被组件引用的ERP SKU | 已阻止 |
| 删除被组件引用的Combo Group | 已阻止 |

## 4. 唯一与状态约束验证

| 场景 | 预期 | 结果 |
|---|---|---|
| groupCode重复 | 失败 | 通过 |
| 同组重复ERP SKU | 失败 | 通过 |
| quantity=0 | 失败 | 通过 |
| quantity为负数 | 失败 | 通过 |
| Group非法status | 失败 | 通过 |
| Component非法status | 失败 | 通过 |
| 同一平台SKU两个approved组 | 失败 | 通过 |
| 同一平台SKU多个pending组 | 允许 | 通过 |
| approved缺审核字段 | 失败 | 通过 |

“同一平台SKU最多一个 approved 组”通过部分唯一索引实现；pending组不受该唯一索引限制。

## 5. 关系一致性模拟

隔离库模拟保存：

- ERP组件1 × 1
- ERP组件2 × 5

组件集合与预期 mapping 集合完全一致。测试只比较集合，没有向 `sales_link_sku_erp_mappings` 写入模拟记录，正式 mapping 新增数为0。

## 6. 幂等验证

同一隔离库连续执行两次初始化迁移后：

- 表定义一致；
- 字段数量一致；
- 索引名称与定义一致；
- `comboGroupId` 未重复添加；
- 测试数据未重复生成；
- 正式 mapping、周期销售事实、日报事实数量均未变化。

首次验证发现并修正了旧库兼容顺序：必须先补充 `comboGroupId`，再建立追溯索引。修正后旧库升级与重复迁移均通过。

## 7. 数据完整性与工程检查

- `SQLite integrity_check`：`ok`
- `SQLite foreign_key_check`：0条异常
- `npm run check`：通过
- `git diff --check`：通过

受保护数据数量：

| 数据 | 验证前 | 验证后 |
|---|---:|---:|
| sales_link_sku_erp_mappings | 20,819 | 20,819 |
| connection_sku_sales_facts | 505 | 505 |
| connection_sku_sales_daily_facts | 0 | 0 |

## 8. 结论

Combo Group与Component模型的字段、外键、唯一约束、状态约束、approved完整性约束、追溯字段及幂等迁移均已通过隔离验证。

结论：**可以进入 Combo 审核页面开发**。下一阶段仍应保持“先建立pending审核组、整体人工编辑、整体事务确认”的边界；在页面确认能力完成前，不应创建正式combo映射。
