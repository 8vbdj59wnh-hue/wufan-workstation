# 销售日报 Phase 3B-1 预览重算验收报告

## 1. 验收结论

销售关系确认后的日报预览重算能力已完成，并在生产数据库在线备份副本和真实文件上通过隔离验证。

重算由用户在预览详情页明确点击“重新计算预览”触发；系统不重新上传 Excel、不覆盖旧预览、不自动确认组合关系，也不写入 `connection_sku_sales_daily_facts`。

## 2. 重算机制

1. 校验原预览批次存在。
2. 校验当前预览链路中至少存在一条已人工批准的 single 候选。
3. 从原预览批次读取保存的 `rawDataJson` 原始行。
4. 重新执行店铺、链接、平台 SKU、ERP SKU、日报重复及 active V2关系检查。
5. 重新分类为 `ready`、`pending_relation` 或 `error`。
6. 已批准关系当前不是 active 时，分类为 `error/relation_conflict`。
7. 生成新的预览批次和预览行；旧批次及旧统计保持不变。
8. 为新 revision 重新生成仍待审核的候选；未确认 combo 继续保持待确认。

重算接口：

`POST /api/connection-data-foundation/sales-daily/:id/recalculate`

接口与页面均沿用现有销售日报导入权限 `requireLinkImport`，无权限用户由服务端拒绝。

## 3. Revision设计

Revision 使用新的 `connection_import_batches` 预览批次承载，不新增销售事实表，也不覆盖父批次。

每个预览摘要记录：

- `previewRevision`
- `rootBatchId`
- `parentBatchId`
- `recalculatedAt`
- `previousSummary`
- `changes.readyRows`
- `changes.pendingRelationRows`
- `changes.errorRows`
- `changes.readySalesAmount`
- `changes.readyProfitAmount`

首次上传为 Revision 1；每次人工重算递增。相同文件再次上传时恢复最新 revision，不退回 Revision 1。

## 4. 真实文件验证

- 文件：`7.9-8.9链接利润报表（SKU明细）.xlsx`
- SHA-256：`7abd4a0967b13e9299fd8605688c4d197ae3ecb15ca8e292ef67d27b7c92c281`
- 总行数：11,826
- 验证使用的 single 候选影响行数：25

| Revision | 场景 | ready | pending_relation | error | 销售额覆盖率 | 利润覆盖率 |
|---|---|---:|---:|---:|---:|---:|
| 1 | 原始预览 | 9,058 | 2,711 | 57 | 40.9555% | 40.6128% |
| 2 | 确认single后重算 | 9,083 | 2,686 | 57 | 41.0634% | 40.6281% |
| 3 | 无新增关系重复重算 | 9,083 | 2,686 | 57 | 41.0634% | 40.6281% |
| 4 | 确认关系停用后重算 | 9,058 | 2,686 | 82 | 40.9555% | 40.6128% |

Revision 2 相比 Revision 1：

- 新增可导入：25 行
- 减少待确认：25 行
- 新增可导入销售额：2,973.2596
- 新增可导入利润：143.1039

Revision 3 未新增关系，统计与 Revision 2 完全一致，变化均为 0。

Revision 4 在隔离数据库中将刚确认关系设为 inactive，用于模拟生产关系停用：对应25行从 ready 转为 `relation_conflict`，未退回普通 `pending_relation`。

## 5. 金额核对

每个 revision 都独立记录：

- sourceSalesAmount
- readySalesAmount
- pendingSalesAmount
- errorSalesAmount
- sourceProfitAmount
- readyProfitAmount
- pendingProfitAmount
- errorProfitAmount

核对规则：

`ready + pending_relation + error = source`

四个 revision 的销售额与利润差异均为 0 或浮点精度范围内的小于 `0.0001`，金额守恒验证通过。

## 6. 数据保护

| 数据 | 验证前 | 验证后 |
|---|---:|---:|
| 日报事实 | 0 | 0 |
| 旧周期销售事实 | 505 | 505 |
| V2映射 | 20,819 | 20,820 |
| sales_links | 9,051 | 9,051 |
| sales_link_skus | 33,073 | 33,073 |
| ERP SKU | 6,902 | 6,902 |
| products | 1,663 | 1,663 |
| ERP仓库库存事实 | 22,832 | 22,832 |
| ERP库存日汇总 | 7,832 | 7,832 |

V2映射仅增加 Phase 3A 人工确认的1条 single 关系。停用动作仅存在于隔离验证副本，用于验证 `relation_conflict`，未触碰生产。

抽样候选对应的 `sales_link_skus.erpSkuId` 与 `sales_link_skus.productId` 在重算前后逐行一致。

## 7. 页面结果

销售日报预览页面现在展示：

- 当前 Revision；
- 本次新增可导入行数；
- 本次减少待确认行数；
- 异常变化；
- 关系确认后的“需要重新计算”提示；
- 手动“重新计算预览”按钮。

重算期间按钮进入加载状态并防止重复点击。成功后页面切换到新 revision，并加载新 revision 的 ready 明细和待确认候选。

## 8. 工程与完整性检查

- `npm run check`：通过。
- `git diff --check`：通过。
- Phase 2 原预览与候选生成回归：通过。
- SQLite `integrity_check`：`ok`。
- SQLite `foreign_key_check`：0条异常。

## 9. 边界确认

- 未写日报事实。
- 未修改旧周期销售事实。
- 未自动重算；必须人工点击。
- 未自动确认combo。
- 未修改旧兼容字段。
- 未修改链接、ERP SKU、产品或库存。
- 未发布生产。
