# Combo Component Schema V1.1验证报告

## 1. 修订结论

Combo Component V1.1 已在生产备份副本上完成隔离迁移和约束验证。模型现在可以准确表达：

- 已发现组件、数量未确认：`quantity=NULL`、`quantitySource=NULL`；
- 人工确认组件数量：`quantity>0`、`quantitySource='manual_confirmation'`。

系统没有填入默认数量1，也没有读取日报quantity推导组合关系数量。

## 2. Schema修订

`sales_link_sku_combo_group_components` 调整如下：

| 字段 | V1.0 | V1.1 |
|---|---|---|
| quantity | REAL NOT NULL | REAL NULL |
| quantitySource | 无 | TEXT NULL |

字段约束：

- `quantity IS NULL OR quantity > 0`
- `quantitySource IS NULL OR quantitySource='manual_confirmation'`

V1.0迁移到V1.1时，已有正数quantity原值保留，但`quantitySource`保持NULL。这样既不丢失旧值，也不会把历史值冒充为人工确认结果；正式批准前仍须重新人工确认来源。

## 3. Approved完整性保护

跨表完整性由数据库触发器保护：

1. pending组包含NULL quantity组件时，更新为approved会失败；
2. pending组包含非人工确认来源的组件时，更新为approved会失败；
3. approved组不能新增或更新为未确认的included组件；
4. 所有included组件均为正数且来源为`manual_confirmation`后，允许批准。

该保护仅验证数据完整性，没有新增正式Combo确认流程，也没有创建正式mapping。

## 4. 隔离验证环境

- 源备份：`/private/tmp/wufan-sales-daily-preview-source.db`
- 源备份大小：383,500,288 bytes
- SHA-256：`f62eb61fd188152c3ae9431ee748870caaf9116f6c35875a26853396f7b6f57c`
- 验证数据库：临时复制生成，验证完成后自动删除
- 生产数据库：未连接、未迁移、未修改

## 5. 验证结果

| 验证项 | 结果 |
|---|---|
| NULL quantity组件可以保存 | 通过 |
| quantity=0失败 | 通过 |
| quantity<0失败 | 通过 |
| 非manual_confirmation来源失败 | 通过 |
| approved Group无法包含未确认quantity组件 | 通过 |
| 全部数量人工确认后允许approved | 通过 |
| approved后新增未确认组件失败 | 通过 |
| V1.0→V1.1迁移 | 通过 |
| V1.1重复迁移幂等 | 通过 |
| integrity_check | ok |
| foreign_key_check | 0条异常 |
| npm run check | 通过 |
| git diff --check | 通过 |

## 6. 数据保护

| 数据 | 验证前 | 验证后 |
|---|---:|---:|
| sales_link_sku_erp_mappings | 20,819 | 20,819 |
| connection_sku_sales_facts | 505 | 505 |
| connection_sku_sales_daily_facts | 0 | 0 |

未创建正式combo mapping，未修改旧V2 mapping，未写入日报事实。

## 7. 结论

Combo Component V1.1 已解决“组件已发现但数量尚未人工确认”的表达冲突，并为Phase 3A-4B提供了可靠草稿语义。

结论：**具备继续开发 Phase 3A-4B Combo审核工作台的Schema条件。**

本阶段未提交、未发布。
