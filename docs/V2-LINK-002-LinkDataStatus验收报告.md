# V2-LINK-002 LinkDataStatus 数据更新摘要能力验收报告

## 实现结论

新增只读 Capability `LinkDataStatus`，没有新增数据表、迁移或业务数据。能力聚合现有经营链接导入批次、统一同步批次、异常记录及两类实际数据日期。

## 数据来源

| 摘要字段 | 真实来源 |
|---|---|
| 最新销售数据日期 | `connection_sku_sales_facts.periodEnd` 最大值 |
| 最新平台经营数据日期 | `connection_period_snapshots.periodEnd` 最大值 |
| 最新数据日期 | 两类事实日期及最近成功批次数据日期的最大值 |
| 最近更新时间 | 最近成功批次的 `completedAt/updatedAt` |
| 更新状态 | 既有批次状态只读映射 |
| 统一异常 | 相关 `data_sync_exceptions.status='open'` |
| 历史导入异常 | 相关 `connection_import_rows.status='error'` |

若历史导入批次已经接入统一 `data_sync_batches.sourceBatchId`，异常只按统一异常中心计算，避免同一异常重复计数。

相关统一任务范围：平台经营数据、真实销售、平台货品 Excel、旺店通平台关系。未把 ERP 货品和库存批次混入经营链接数据状态。

## 状态映射

- `updating`：存在 waiting/queued/running 批次。
- `failed`：最近一次执行为 failed/interrupted，且晚于最近成功。
- `updated_with_exceptions`：存在成功批次且仍有异常。
- `updated`：存在成功批次且无异常。
- `no_data`：没有成功批次和活动批次。

`preview_ready` 只是待人工确认，不被误判为失败，也不被视为业务数据已更新。

## 权限和输出边界

- API 复用现有链接读取权限，没有新增权限。
- 普通运营只获得业务摘要，不包含批次 ID、任务代码和技术来源明细。
- 管理员在同一接口附加技术明细，包含最近批次、来源日期和异常来源统计。

## 验证

- 隔离库完成成功批次、销售日期、平台日期、开放异常组合验证。
- 普通视角：最新数据 `2026-08-08`，状态 `updated_with_exceptions`，异常数 1，未暴露 details。
- 管理员视角：正确返回最近批次及统一异常来源。
- `integrity_check=ok`。
- `foreign_key_check=0`。
- 未修改生产数据库、导入逻辑、同步逻辑、字段映射或异常处理。
